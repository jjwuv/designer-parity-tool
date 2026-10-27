import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ApiClient } from './apiClientH.ts';
import { getEnvironment } from './authH.ts';
import {
	DEFAULT_CONCURRENCY,
	DEFAULT_MODEL_DETAILS_PATH,
	DEFAULT_REPORT_PATH,
	DEFAULT_SINGLE_MODEL_DETAILS_PATH,
	INCENTIVES_IMPORT_TOOL_TYPE,
	MAX_CONCURRENCY
} from './parityToolF.ts';
import {
	buildParityRow,
	createPipeProgress,
	getRowCountPair,
	listElements,
	listPipes,
	mapWithConcurrency,
	matchByIDAndName,
	REFRESH_FAILURE_LABEL
} from './parityToolH.ts';
import type { MatchedElement, ParityConfig, ParityRow, ParityTarget } from './parityToolI.ts';
import { buildStats, sortReport, writeHtmlReport } from './reportH.ts';
import { compareSnapshots, loadSnapshot, saveSnapshot, writeSnapshot } from './snapshotH.ts';

const USAGE = `Usage:
  Two models (live):
    node --experimental-strip-types src/index.ts [--config model-details.json] [--out report.html] [--concurrency 2]
    node --experimental-strip-types src/index.ts --a modelA.json --b modelB.json [--out report.html]
  Single model (save twice, then compare):
    node --experimental-strip-types src/index.ts save --label Hybrid --out snapshots/hybrid.json [--config model-details-single.json] [--concurrency 2] [--last-run-only | --refresh-previews]
    node --experimental-strip-types src/index.ts compare snapshots/hybrid.json snapshots/big.json [--out report.html]
  Reports go to reports/two/<orgID A>/<time>/ or reports/single/<orgID>/<time>/ unless --out is given.
  --concurrency is 1 to ${MAX_CONCURRENCY} (default ${DEFAULT_CONCURRENCY}).`;

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

const validateTarget = (target: ParityTarget | undefined, label: string, apiKeyVar: string): ParityTarget => {
	if (!target?.orgID || !target.env || !target.modelName) {
		throw new Error(`Target ${label} needs orgID, env and modelName.\n${USAGE}`);
	}
	getEnvironment(target.env);
	const apiKey = process.env[apiKeyVar];
	if (!apiKey) {
		throw new Error(`No Designer API key for target ${label}. Set ${apiKeyVar}.`);
	}
	return { ...target, apiKey };
};

const loadConfig = async (values: { config?: string; a?: string; b?: string }): Promise<ParityConfig> => {
	const configPath = values.config ?? (values.a || values.b ? undefined : DEFAULT_MODEL_DETAILS_PATH);
	const config: Partial<ParityConfig> = configPath
		? await readJson<ParityConfig>(configPath)
		: {
				a: values.a ? await readJson<ParityTarget>(values.a) : undefined,
				b: values.b ? await readJson<ParityTarget>(values.b) : undefined
			};
	return {
		a: validateTarget(config.a, 'A', 'designerParityModel1_apikey'),
		b: validateTarget(config.b, 'B', 'designerParityModel2_apikey')
	};
};

// Pipes and elements are compared only when both pipeID and name match on both sides.
const findMatchedElements = async (
	clientA: ApiClient,
	clientB: ApiClient,
	concurrency: number
): Promise<MatchedElement[]> => {
	const [pipesA, pipesB] = await Promise.all([listPipes(clientA), listPipes(clientB)]);
	const matchedPipes = matchByIDAndName(pipesA, pipesB, (pipe) => pipe.pipeID);
	console.log(`Pipes: A=${pipesA.length}, B=${pipesB.length}, matched=${matchedPipes.length}`);

	const elementsPerPipe = await mapWithConcurrency(matchedPipes, concurrency, async (pipe) => {
		const [elementsA, elementsB] = await Promise.all([
			listElements(clientA, pipe.pipeID),
			listElements(clientB, pipe.pipeID)
		]);
		return matchByIDAndName(elementsA, elementsB, (element) => element.elementID).map((element) => ({
			pipe,
			element
		}));
	});
	return elementsPerPipe.flat();
};

const compareRowCounts = async (
	clientA: ApiClient,
	clientB: ApiClient,
	matchedElements: MatchedElement[],
	concurrency: number
): Promise<ParityRow[]> => {
	let refreshFailures = 0;
	console.log('Row comparison starting...');
	const pipeEntries = new Map<string, { pipe: MatchedElement['pipe']; elementCount: number }>();
	matchedElements.forEach(({ pipe }) => {
		const entry = pipeEntries.get(pipe.pipeID) ?? { pipe, elementCount: 0 };
		entry.elementCount += 1;
		pipeEntries.set(pipe.pipeID, entry);
	});
	const progress = createPipeProgress([...pipeEntries.values()], 'Compared row counts');
	const rows = await mapWithConcurrency(matchedElements, concurrency, async (matched) => {
		let refreshFailed = false;
		const { countsA, countsB } = await getRowCountPair(clientA, clientB, matched, {
			onRefreshFailed: () => {
				refreshFailures += 1;
				refreshFailed = true;
			}
		});
		const row = buildParityRow(matched, countsA, countsB);
		const labels = [...(row.parity === 'No' ? ['not in parity'] : []), ...(refreshFailed ? [REFRESH_FAILURE_LABEL] : [])];
		progress.elementDone(matched.pipe.pipeID, ...labels);
		return row;
	});
	if (refreshFailures > 0) {
		console.warn(`Warning: ${refreshFailures} sample refresh(es) failed or timed out; those Preview counts may be stale.`);
	}
	return rows;
};

// In pipes with any mismatch, also show incentives_import rows that are in parity, for context.
const selectReportRows = (allRows: ParityRow[]): { mismatches: ParityRow[]; notFound: ParityRow[] } => {
	const mismatchedPipes = new Set(allRows.filter((row) => row.parity === 'No').map((row) => row.pipeID));
	const mismatches = sortReport(
		allRows.filter(
			(row) =>
				row.parity === 'No' ||
				(row.parity === 'Yes' && row.toolType === INCENTIVES_IMPORT_TOOL_TYPE && mismatchedPipes.has(row.pipeID))
		)
	);
	const notFound = sortReport(allRows.filter((row) => row.parity === 'NotFound'));
	return { mismatches, notFound };
};

const parseConcurrency = (value: string): number => {
	const concurrency = Number(value);
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
		throw new Error(`--concurrency must be a whole number from 1 to ${MAX_CONCURRENCY} (got '${value}').`);
	}
	return concurrency;
};

// Without --out, each report gets its own folder so earlier reports are kept:
// reports/<single|two>/<orgID of model A>/<YYYY-MM-DD_HHMMSS>/parity-report.html
const resolveReportPath = async (out: string | undefined, mode: 'single' | 'two', orgID: string): Promise<string> => {
	const pad = (value: number) => String(value).padStart(2, '0');
	const now = new Date();
	const runFolder =
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
		`${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	const path = out ?? join('reports', mode, orgID.replace(/[^A-Za-z0-9._-]/g, '_'), runFolder, DEFAULT_REPORT_PATH);
	await mkdir(dirname(path), { recursive: true });
	return path;
};

type CliValues = { config?: string; a?: string; b?: string; out?: string; label?: string; 'last-run-only': boolean; 'refresh-previews': boolean };

const runLive = async (values: CliValues, concurrency: number): Promise<void> => {
	const { a, b } = await loadConfig(values);
	for (const [name, target] of [['A', a], ['B', b]] as const) {
		console.log(
			`Running Designer Parity Tool (model ${name}) for OrgID: ${target.orgID} ModelName: ${target.modelName} in ENV: ${target.env}`
		);
	}
	const clientA = new ApiClient(a);
	const clientB = new ApiClient(b);

	const matchedElements = await findMatchedElements(clientA, clientB, concurrency);
	console.log(`Elements matched: ${matchedElements.length}`);

	const allRows = await compareRowCounts(clientA, clientB, matchedElements, concurrency);
	const { mismatches, notFound } = selectReportRows(allRows);
	const out = await resolveReportPath(values.out, 'two', a.orgID);
	await writeHtmlReport(out, mismatches, notFound, a, b, buildStats(allRows));
	console.log(`Report written to ${out}`);
};

const runSave = async (values: CliValues, concurrency: number): Promise<void> => {
	if (values['last-run-only'] && values['refresh-previews']) {
		throw new Error('Use either --last-run-only or --refresh-previews, not both.');
	}
	if (!values.label) throw new Error(`save needs --label, e.g. --label Hybrid.\n${USAGE}`);
	if (!values.out) throw new Error(`save needs --out, e.g. --out snapshots/hybrid.json.\n${USAGE}`);
	const path = values.config ?? DEFAULT_SINGLE_MODEL_DETAILS_PATH;
	const config = await readJson<Partial<ParityTarget> & Partial<ParityConfig>>(path);
	if (config.a || config.b) {
		throw new Error(`${path} is in the two-model format ("a"/"b"). save expects one model: { "orgID", "env", "modelName" }.`);
	}
	const target = validateTarget(config as ParityTarget, 'model', 'designerParityModel1_apikey');
	const snapshot = await saveSnapshot(new ApiClient(target), target, values.label, concurrency, {
		lastRunOnly: values['last-run-only'],
		refreshPreviews: values['refresh-previews']
	});
	await writeSnapshot(values.out, snapshot);
	console.log(`Snapshot written to ${values.out}`);
};

const runCompare = async (values: CliValues, files: string[]): Promise<void> => {
	if (files.length !== 2) throw new Error(`compare needs two snapshot files.\n${USAGE}`);
	const [a, b] = await Promise.all(files.map(loadSnapshot));
	if (a.target.orgID !== b.target.orgID || a.target.modelName !== b.target.modelName) {
		console.warn(
			`Warning: the snapshots are from different models (${a.target.modelName} / ${a.target.orgID} vs ${b.target.modelName} / ${b.target.orgID}).`
		);
	}
	const allRows = compareSnapshots(a, b);
	const { mismatches, notFound } = selectReportRows(allRows);
	const out = await resolveReportPath(values.out, 'single', a.target.orgID);
	await writeHtmlReport(out, mismatches, notFound, a.target, b.target, buildStats(allRows), {
		labelA: a.label,
		labelB: b.label,
		savedAtA: new Date(a.savedAt).toLocaleString(),
		savedAtB: new Date(b.savedAt).toLocaleString(),
		refreshFailures: a.refreshFailures.length + b.refreshFailures.length,
		lastRunOnly: a.lastRunOnly || b.lastRunOnly,
		previewsStale: a.previewsRefreshed === false || b.previewsRefreshed === false
	});
	console.log(`Report written to ${out}`);
};

const main = async (): Promise<void> => {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			config: { type: 'string' },
			a: { type: 'string' },
			b: { type: 'string' },
			out: { type: 'string' },
			concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
			'last-run-only': { type: 'boolean', default: false },
			'refresh-previews': { type: 'boolean', default: false },
			label: { type: 'string' },
			help: { type: 'boolean', short: 'h' }
		}
	});
	if (values.help) {
		console.log(USAGE);
		return;
	}

	const [command, ...rest] = positionals;
	if (command === 'compare') return runCompare(values, rest);
	const concurrency = parseConcurrency(values.concurrency);
	if (command === 'save') return runSave(values, concurrency);
	if (command !== undefined) throw new Error(`Unknown command '${command}'.\n${USAGE}`);
	return runLive(values, concurrency);
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
