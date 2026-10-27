import { refreshSample } from './sampleH.ts';
import { ApiError, type ApiClient } from './apiClientH.ts';
import {
	DEFAULT_PORT,
	INCENTIVES_EXPORT_TOOL_TYPE,
	INCENTIVES_IMPORT_TOOL_TYPE,
	LAST_RUN_REQUEST_TYPE,
	PLANBUILDER_ITEMS_PATH,
	PREVIEW_REQUEST_TYPE,
	PREVIEW_ROW_CAP,
	PREVIEW_ZERO_RETRIES,
	PREVIEW_ZERO_RETRY_DELAY_MS
} from './parityToolF.ts';
import type {
	ElementSummary,
	GraphElementResponse,
	MatchedElement,
	PagedResponse,
	ParityRow,
	PipeResponse,
	PipeSummary,
	PlanBuilderItem,
	PlanBuilderItemsResponse,
	RowCounts
} from './parityToolI.ts';

/** Runs `worker` over `items` with at most `limit` in flight, preserving input order in the result. */
export const mapWithConcurrency = async <T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const runNext = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await worker(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
	return results;
};

/**
 * Prints "<verb> for pipe n/total: <pipeID>, <calculation name> (k elements, ...)" once all of a pipe's elements
 * are done. `elementDone` takes optional tallies (e.g. "Preview refresh failure(s)") shown on that pipe's line.
 */
export const REFRESH_FAILURE_LABEL = 'Preview refresh failure(s)';

export const createPipeProgress = (pipes: { pipe: PipeSummary; elementCount: number }[], verb: string) => {
	const remaining = new Map(pipes.map(({ pipe, elementCount }) => [pipe.pipeID, elementCount]));
	const tallies = new Map<string, Map<string, number>>();
	let pipesDone = 0;
	const report = ({ pipe, elementCount }: { pipe: PipeSummary; elementCount: number }): void => {
		pipesDone += 1;
		const notes = [...(tallies.get(pipe.pipeID) ?? new Map<string, number>())].map(([label, count]) => `, ${count} ${label}`);
		console.log(
			`${verb} for pipe ${pipesDone}/${pipes.length}: ${pipe.pipeID}, ${pipe.calculationName ?? pipe.name} ` +
				`(${elementCount} element${elementCount === 1 ? '' : 's'}${notes.join('')})`
		);
	};
	const byID = new Map(pipes.map((entry) => [entry.pipe.pipeID, entry]));
	return {
		reportEmptyPipes: (): void => pipes.filter(({ elementCount }) => elementCount === 0).forEach(report),
		elementDone: (pipeID: string, ...labels: string[]): void => {
			const pipeTallies = tallies.get(pipeID) ?? new Map<string, number>();
			labels.forEach((label) => pipeTallies.set(label, (pipeTallies.get(label) ?? 0) + 1));
			tallies.set(pipeID, pipeTallies);
			const left = (remaining.get(pipeID) ?? 1) - 1;
			remaining.set(pipeID, left);
			const entry = byID.get(pipeID);
			if (left === 0 && entry) report(entry);
		}
	};
};

/** Maps each calculation's pipeID to its Designer calculation name, from the Plan Builder items list. */
export const getCalculationNames = async (client: ApiClient): Promise<Map<string, string>> => {
	const response = await client.getDesigner<PlanBuilderItemsResponse | PlanBuilderItem[]>(PLANBUILDER_ITEMS_PATH);
	const items = Array.isArray(response) ? response : (response.results ?? response.items ?? []);
	const names = new Map<string, string>();
	items.forEach((item) => {
		const pipeID = item.calculation?.pipeId;
		const name = (item.calculation?.name ?? item.name ?? '').trim();
		if (item.itemType === 'Calculation' && pipeID && name) names.set(pipeID, name);
	});
	return names;
};

export const listPipes = async (client: ApiClient): Promise<PipeSummary[]> => {
	const [pipes, calculationNames] = await Promise.all([
		client.get<PipeResponse[]>('/pipes'),
		getCalculationNames(client)
	]);
	return pipes.map(({ pipeID, name }) => ({ pipeID, name, calculationName: calculationNames.get(pipeID) }));
};

// Edges and notes have no toolType; only tool nodes have row counts.
export const listElements = async (client: ApiClient, pipeID: string): Promise<ElementSummary[]> => {
	const elements: ElementSummary[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await client.get<PagedResponse<GraphElementResponse>>(`/pipes/${pipeID}/elements/v2`, {
			continuationToken
		});
		page.items.forEach((item) => {
			if (item.toolType) {
				elements.push({ elementID: item.elementID, toolType: item.toolType, name: item.nameOverride ?? item.toolType });
			}
		});
		continuationToken = page.continuationToken;
	} while (continuationToken);
	return elements;
};

/** Returns the items present on both sides with the same ID and the same name. */
export const matchByIDAndName = <T extends { name: string }>(a: T[], b: T[], getID: (item: T) => string): T[] => {
	const bByID = new Map(b.map((item) => [getID(item), item]));
	return a.filter((item) => bByID.get(getID(item))?.name === item.name);
};

// A missing rowcount file (element never previewed / run) surfaces as a 4xx; report it as undefined.
const getRowCount = async (
	client: ApiClient,
	pipeID: string,
	element: ElementSummary,
	requestType: string
): Promise<number | undefined> => {
	try {
		const count = await client.get<number | string>('/results/fast-count', {
			pipeID,
			elementID: element.elementID,
			port: DEFAULT_PORT,
			requestType,
			isIncentivesExport: element.toolType === INCENTIVES_EXPORT_TOOL_TYPE ? 'true' : undefined
		});
		const parsed = Number(count);
		return Number.isNaN(parsed) ? undefined : parsed;
	} catch (error) {
		if (error instanceof ApiError && error.status >= 400 && error.status < 500) return undefined;
		throw error;
	}
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A Preview of 0 may just be a sample that hasn't finished loading, so re-check a few times.
const getPreviewCount = async (
	client: ApiClient,
	pipeID: string,
	element: ElementSummary,
	retryZero = true
): Promise<number | undefined> => {
	let count = await getRowCount(client, pipeID, element, PREVIEW_REQUEST_TYPE);
	for (let attempt = 0; retryZero && count === 0 && attempt < PREVIEW_ZERO_RETRIES; attempt += 1) {
		await sleep(PREVIEW_ZERO_RETRY_DELAY_MS);
		count = await getRowCount(client, pipeID, element, PREVIEW_REQUEST_TYPE);
	}
	return count;
};

const getRowCounts = async (
	client: ApiClient,
	matched: MatchedElement,
	retryZeroPreview: boolean
): Promise<RowCounts> => {
	const { pipe, element } = matched;
	const previewPromise = getPreviewCount(client, pipe.pipeID, element, retryZeroPreview);
	const lastRunPromise = getRowCount(client, pipe.pipeID, element, LAST_RUN_REQUEST_TYPE);
	return { preview: await previewPromise, lastRun: await lastRunPromise };
};

/**
 * Regenerates the element's Preview sample, then reads Preview and Last Run counts from one model.
 * Elements with no stored Preview count (never previewed) are not regenerated; their Preview stays N/A.
 */
export const getRefreshedRowCounts = async (
	client: ApiClient,
	matched: MatchedElement
): Promise<{ counts: RowCounts; refreshed: boolean; skipped: boolean }> => {
	const { pipe, element } = matched;
	const storedPreview = await getPreviewCount(client, pipe.pipeID, element, false);
	if (storedPreview === undefined) {
		const lastRun = await getRowCount(client, pipe.pipeID, element, LAST_RUN_REQUEST_TYPE);
		return { counts: { preview: undefined, lastRun }, refreshed: true, skipped: true };
	}
	const refreshed = await refreshSample(client, pipe.pipeID, element.elementID);
	return { counts: await getRowCounts(client, matched, true), refreshed, skipped: false };
};

/** Reads the stored Preview and Last Run counts without regenerating the Preview sample (it may be stale). */
export const getStoredRowCounts = (client: ApiClient, matched: MatchedElement): Promise<RowCounts> =>
	getRowCounts(client, matched, true);

/** Reads only the Last Run count; no Preview sample is read or regenerated. */
export const getLastRunCount = async (client: ApiClient, matched: MatchedElement): Promise<RowCounts> => ({
	lastRun: await getRowCount(client, matched.pipe.pipeID, matched.element, LAST_RUN_REQUEST_TYPE)
});

const isSameCount = (a?: number, b?: number): boolean => a !== undefined && a === b;

// Preview counts are capped, so two capped counts are equivalent even if the true totals differ.
const isSamePreview = (a?: number, b?: number): boolean =>
	isSameCount(a, b) || (a !== undefined && b !== undefined && a >= PREVIEW_ROW_CAP && b >= PREVIEW_ROW_CAP);

const getDelta = (a?: number, b?: number): number | undefined =>
	a !== undefined && b !== undefined ? b - a : undefined;

export interface RowCountOptions {
	onRefreshFailed?: (matched: MatchedElement) => void;
}

// Equal (or both capped), or never previewed on either side: nothing to refresh.
const isPreviewSettled = (a?: number, b?: number): boolean =>
	isSamePreview(a, b) || (a === undefined && b === undefined);

/**
 * Reads Preview and Last Run counts from both models. If the two Preview counts disagree, the Preview samples
 * are regenerated (as the UI does) to rule out stale samples, and only the Preview is re-read. Matching counts
 * are left alone.
 */
export const getRowCountPair = async (
	clientA: ApiClient,
	clientB: ApiClient,
	matched: MatchedElement,
	options: RowCountOptions = {}
): Promise<{ countsA: RowCounts; countsB: RowCounts }> => {
	const { pipe, element } = matched;
	// A zero that disagrees with the other side is refreshed below, so skip the slow zero re-checks here.
	let [countsA, countsB] = await Promise.all([
		getRowCounts(clientA, matched, false),
		getRowCounts(clientB, matched, false)
	]);

	if (!isPreviewSettled(countsA.preview, countsB.preview)) {
		const refreshed = await Promise.all([
			refreshSample(clientA, pipe.pipeID, element.elementID),
			refreshSample(clientB, pipe.pipeID, element.elementID)
		]);
		if (refreshed.includes(false)) options.onRefreshFailed?.(matched);
		const [previewA, previewB] = await Promise.all([
			getPreviewCount(clientA, pipe.pipeID, element, false),
			getPreviewCount(clientB, pipe.pipeID, element, false)
		]);
		countsA = { ...countsA, preview: previewA };
		countsB = { ...countsB, preview: previewB };
	}
	return { countsA, countsB };
};

/** Parity is Yes only when both Preview and Last Run counts exist and match; counts are kept only for No rows and incentives_import rows; NotFound rows have no counts anywhere. */
export const buildParityRow = (matched: MatchedElement, countsA: RowCounts, countsB: RowCounts): ParityRow => {
	const { pipe, element } = matched;
	const row: ParityRow = {
		calculationName: pipe.calculationName,
		pipeID: pipe.pipeID,
		elementName: element.name,
		toolType: element.toolType,
		elementID: element.elementID,
		parity: 'Yes'
	};
	// Neither Preview nor Last Run exists in either model: not a mismatch, reported separately.
	if (
		countsA.preview === undefined &&
		countsB.preview === undefined &&
		countsA.lastRun === undefined &&
		countsB.lastRun === undefined
	) {
		return { ...row, parity: 'NotFound' };
	}
	// Edge case: neither model has a Preview (never previewed) but Last Run exists and is equal on both sides.
	const isPreviewMissingOnBoth = countsA.preview === undefined && countsB.preview === undefined;
	const isParity = isPreviewMissingOnBoth
		? isSameCount(countsA.lastRun, countsB.lastRun)
		: isSamePreview(countsA.preview, countsB.preview) && isSameCount(countsA.lastRun, countsB.lastRun);
	// incentives_import counts are kept even in parity, so they can be shown alongside mismatches in the same pipe.
	if (isParity && element.toolType !== INCENTIVES_IMPORT_TOOL_TYPE) return row;

	return {
		...row,
		parity: isParity ? 'Yes' : 'No',
		previewA: countsA.preview,
		previewB: countsB.preview,
		previewResults: getDelta(countsA.preview, countsB.preview),
		lastRunA: countsA.lastRun,
		lastRunB: countsB.lastRun,
		lastRunResults: getDelta(countsA.lastRun, countsB.lastRun)
	};
};
