import { ApiError, type ApiClient } from './apiClientH.ts';
import {
	DEFAULT_PORT,
	INCENTIVES_EXPORT_TOOL_TYPE,
	LAST_RUN_REQUEST_TYPE,
	PREVIEW_REQUEST_TYPE
} from './parityToolF.ts';
import type {
	ElementSummary,
	GraphElementResponse,
	MatchedElement,
	PagedResponse,
	ParityRow,
	PipeResponse,
	PipeSummary,
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

export const listPipes = async (client: ApiClient): Promise<PipeSummary[]> => {
	const pipes = await client.get<PipeResponse[]>('/pipes');
	return pipes.map(({ pipeID, name }) => ({ pipeID, name }));
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

export const getRowCounts = async (client: ApiClient, matched: MatchedElement): Promise<RowCounts> => {
	const { pipe, element } = matched;
	const previewPromise = getRowCount(client, pipe.pipeID, element, PREVIEW_REQUEST_TYPE);
	const lastRunPromise = getRowCount(client, pipe.pipeID, element, LAST_RUN_REQUEST_TYPE);
	return { preview: await previewPromise, lastRun: await lastRunPromise };
};

const isSameCount = (a?: number, b?: number): boolean => a !== undefined && a === b;

const getDelta = (a?: number, b?: number): number | undefined =>
	a !== undefined && b !== undefined ? b - a : undefined;

/** Parity is Yes only when both Preview and Last Run counts exist and match; counts are kept only for No rows. */
export const buildParityRow = (matched: MatchedElement, countsA: RowCounts, countsB: RowCounts): ParityRow => {
	const { pipe, element } = matched;
	const row: ParityRow = {
		pipeName: pipe.name,
		pipeID: pipe.pipeID,
		elementName: element.name,
		elementID: element.elementID,
		parity: 'Yes'
	};
	const isParity =
		isSameCount(countsA.preview, countsB.preview) && isSameCount(countsA.lastRun, countsB.lastRun);
	if (isParity) return row;

	return {
		...row,
		parity: 'No',
		previewA: countsA.preview,
		previewB: countsB.preview,
		previewDelta: getDelta(countsA.preview, countsB.preview),
		lastRunA: countsA.lastRun,
		lastRunB: countsB.lastRun,
		lastRunDelta: getDelta(countsA.lastRun, countsB.lastRun)
	};
};
