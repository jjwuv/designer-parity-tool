import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ApiClient } from './apiClientH.ts';
import { getEnvironment } from './authH.ts';
import { DEFAULT_CONCURRENCY, DEFAULT_REPORT_PATH } from './parityToolF.ts';
import {
	buildParityRow,
	getRowCounts,
	listElements,
	listPipes,
	mapWithConcurrency,
	matchByIDAndName
} from './parityToolH.ts';
import type { MatchedElement, ParityConfig, ParityRow, ParityTarget } from './parityToolI.ts';
import { printReport, sortReport, writeCsvReport } from './reportH.ts';

const USAGE = `Usage:
  node --experimental-strip-types src/index.ts --config parity.json [--out report.csv] [--concurrency 5]
  node --experimental-strip-types src/index.ts --a modelA.json --b modelB.json [--out report.csv]`;

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

const validateTarget = (target: ParityTarget | undefined, label: string): ParityTarget => {
	if (!target?.orgID || !target.env || !target.modelName) {
		throw new Error(`Target ${label} needs orgID, env and modelName.\n${USAGE}`);
	}
	getEnvironment(target.env);
	return target;
};

const loadConfig = async (values: { config?: string; a?: string; b?: string }): Promise<ParityConfig> => {
	const config: Partial<ParityConfig> = values.config
		? await readJson<ParityConfig>(values.config)
		: {
				a: values.a ? await readJson<ParityTarget>(values.a) : undefined,
				b: values.b ? await readJson<ParityTarget>(values.b) : undefined
			};
	return { a: validateTarget(config.a, 'A'), b: validateTarget(config.b, 'B') };
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
	let completed = 0;
	return mapWithConcurrency(matchedElements, concurrency, async (matched) => {
		const [countsA, countsB] = await Promise.all([getRowCounts(clientA, matched), getRowCounts(clientB, matched)]);
		completed += 1;
		if (completed % 50 === 0) console.log(`  Compared ${completed}/${matchedElements.length} elements`);
		return buildParityRow(matched, countsA, countsB);
	});
};

const main = async (): Promise<void> => {
	const { values } = parseArgs({
		options: {
			config: { type: 'string' },
			a: { type: 'string' },
			b: { type: 'string' },
			out: { type: 'string', default: DEFAULT_REPORT_PATH },
			concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
			help: { type: 'boolean', short: 'h' }
		}
	});
	if (values.help) {
		console.log(USAGE);
		return;
	}

	const { a, b } = await loadConfig(values);
	const concurrency = Math.max(1, Number(values.concurrency) || DEFAULT_CONCURRENCY);
	const clientA = new ApiClient(a);
	const clientB = new ApiClient(b);

	const matchedElements = await findMatchedElements(clientA, clientB, concurrency);
	console.log(`Elements to compare: ${matchedElements.length}`);

	const rows = sortReport(await compareRowCounts(clientA, clientB, matchedElements, concurrency));
	printReport(rows, a, b);
	await writeCsvReport(values.out, rows, a, b);
	console.log(`\nReport written to ${values.out}`);
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
