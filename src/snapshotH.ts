import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiClient } from './apiClientH.ts';
import {
	buildParityRow,
	createPipeProgress,
	getLastRunCount,
	getRefreshedRowCounts,
	getStoredRowCounts,
	listElements,
	listPipes,
	mapWithConcurrency,
	matchByIDAndName,
	REFRESH_FAILURE_LABEL
} from './parityToolH.ts';

const NEVER_PREVIEWED_LABEL = 'never previewed (not regenerated)';
import type { ParityRow, ParityTarget, Snapshot, SnapshotElement, SnapshotPipe } from './parityToolI.ts';

export interface SaveOptions {
	// Read Last Run only; no Preview at all.
	lastRunOnly?: boolean;
	// Regenerate each previewed element's sample before reading it (slow). Otherwise stored Preview counts are used.
	refreshPreviews?: boolean;
}

/**
 * Reads every element's Preview and Last Run counts from one model. By default the stored Preview counts are
 * saved as-is (they may be stale); with refreshPreviews each previewed element's sample is regenerated first.
 */
export const saveSnapshot = async (
	client: ApiClient,
	target: ParityTarget,
	label: string,
	concurrency: number,
	{ lastRunOnly = false, refreshPreviews = false }: SaveOptions = {}
): Promise<Snapshot> => {
	const mode = lastRunOnly ? 'Last Run row counts' : refreshPreviews ? 'row counts (regenerating Previews)' : 'row counts';
	console.log(
		`Saving ${mode} ('${label}') for orgID: ${target.orgID}, modelName: ${target.modelName} in env: ${target.env}...`
	);
	const pipes = await listPipes(client);
	const elementsPerPipe = await mapWithConcurrency(pipes, concurrency, (pipe) => listElements(client, pipe.pipeID));
	const work = pipes.flatMap((pipe, index) => elementsPerPipe[index].map((element) => ({ pipe, element })));
	console.log(`Pipes: ${pipes.length}, Elements: ${work.length}`);

	const progress = createPipeProgress(
		pipes.map((pipe, index) => ({ pipe, elementCount: elementsPerPipe[index].length })),
		'Saved row counts'
	);
	progress.reportEmptyPipes();

	const refreshFailures: string[] = [];
	let neverPreviewed = 0;
	const counted = await mapWithConcurrency(work, concurrency, async (matched) => {
		const { counts, refreshed, skipped } = lastRunOnly
			? { counts: await getLastRunCount(client, matched), refreshed: true, skipped: false }
			: refreshPreviews
				? await getRefreshedRowCounts(client, matched)
				: { counts: await getStoredRowCounts(client, matched), refreshed: true, skipped: false };
		const { pipeID } = matched.pipe;
		if (!refreshed) refreshFailures.push(`${pipeID}/${matched.element.elementID}`);
		if (skipped) neverPreviewed += 1;
		progress.elementDone(
			pipeID,
			...(refreshed ? [] : [REFRESH_FAILURE_LABEL]),
			...(skipped ? [NEVER_PREVIEWED_LABEL] : [])
		);
		return { pipeID: matched.pipe.pipeID, element: { ...matched.element, ...counts } as SnapshotElement };
	});
	if (neverPreviewed > 0) {
		console.log(`Skipped Preview regeneration for ${neverPreviewed} of ${work.length} element(s) that were never previewed.`);
	}
	if (refreshFailures.length > 0) {
		console.warn(`Warning: ${refreshFailures.length} sample refresh(es) failed or timed out; those Preview counts may be stale.`);
	}

	const snapshotPipes: SnapshotPipe[] = pipes.map((pipe) => ({
		...pipe,
		elements: counted.filter((item) => item.pipeID === pipe.pipeID).map((item) => item.element)
	}));
	const { orgID, env, modelName } = target;
	return {
		label,
		savedAt: new Date().toISOString(),
		target: { orgID, env, modelName },
		pipes: snapshotPipes,
		refreshFailures,
		...(lastRunOnly ? { lastRunOnly: true } : {}),
		previewsRefreshed: !lastRunOnly && refreshPreviews
	};
};

export const writeSnapshot = async (path: string, snapshot: Snapshot): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(snapshot, null, '\t')}\n`, 'utf8');
};

export const loadSnapshot = async (path: string): Promise<Snapshot> => {
	const snapshot = JSON.parse(await readFile(path, 'utf8')) as Partial<Snapshot>;
	if (!snapshot.target?.orgID || !snapshot.target.modelName || !Array.isArray(snapshot.pipes)) {
		throw new Error(`${path} is not a snapshot file (expected target and pipes). Create one with the save command.`);
	}
	return {
		label: snapshot.label ?? path,
		savedAt: snapshot.savedAt ?? 'unknown',
		target: snapshot.target,
		pipes: snapshot.pipes,
		refreshFailures: snapshot.refreshFailures ?? [],
		lastRunOnly: snapshot.lastRunOnly === true,
		// Snapshots saved before this field existed always regenerated Previews.
		previewsRefreshed: snapshot.previewsRefreshed ?? true
	};
};

/**
 * Same matching as a live comparison: pipes and elements must match by ID and name in both snapshots.
 * If either snapshot is Last Run only, Preview is dropped on both sides and parity is decided by Last Run alone.
 */
export const compareSnapshots = (a: Snapshot, b: Snapshot): ParityRow[] => {
	const ignorePreview = a.lastRunOnly === true || b.lastRunOnly === true;
	const matchedPipes = matchByIDAndName(a.pipes, b.pipes, (pipe) => pipe.pipeID);
	const pipesB = new Map(b.pipes.map((pipe) => [pipe.pipeID, pipe]));
	console.log(`Pipes: A=${a.pipes.length}, B=${b.pipes.length}, matched=${matchedPipes.length}`);
	return matchedPipes.flatMap((pipeA) => {
		const pipeB = pipesB.get(pipeA.pipeID) as SnapshotPipe;
		const elementsB = new Map(pipeB.elements.map((element) => [element.elementID, element]));
		const { elements: _elements, ...pipe } = pipeA;
		return matchByIDAndName(pipeA.elements, pipeB.elements, (element) => element.elementID).map((elementA) => {
			const elementB = elementsB.get(elementA.elementID) as SnapshotElement;
			const { preview, lastRun, ...element } = elementA;
			return buildParityRow(
				{ pipe, element },
				{ preview: ignorePreview ? undefined : preview, lastRun },
				{ preview: ignorePreview ? undefined : elementB.preview, lastRun: elementB.lastRun }
			);
		});
	});
};
