import { writeFile } from 'node:fs/promises';
import { PREVIEW_ROW_CAP, REPORT_COLUMNS } from './parityToolF.ts';
import type { ParityRow, ParityTarget } from './parityToolI.ts';

const NOT_AVAILABLE = 'N/A';

export interface ReportStats {
	calculations: number;
	totalElements: number;
	inParity: number;
	notInParity: number;
	notFound: number;
}

// Header details shown when the report is built from two saved snapshots instead of a live comparison.
export interface SnapshotReportInfo {
	labelA: string;
	labelB: string;
	savedAtA: string;
	savedAtB: string;
	refreshFailures: number;
	lastRunOnly?: boolean;
	previewsStale?: boolean;
}

type Column = (typeof REPORT_COLUMNS)[number];

// Grouped by calculation (name, then pipeID), then element name.
export const sortReport = (rows: ParityRow[]): ParityRow[] =>
	[...rows].sort(
		(x, y) =>
			(x.calculationName ?? '').localeCompare(y.calculationName ?? '') ||
			x.pipeID.localeCompare(y.pipeID) ||
			x.elementName.localeCompare(y.elementName) ||
			x.elementID.localeCompare(y.elementID)
	);

export const buildStats = (rows: ParityRow[]): ReportStats => {
	const notInParity = rows.filter((row) => row.parity === 'No').length;
	const notFound = rows.filter((row) => row.parity === 'NotFound').length;
	return {
		calculations: new Set(rows.map((row) => row.pipeID)).size,
		totalElements: rows.length,
		inParity: rows.length - notInParity - notFound,
		notInParity,
		notFound
	};
};

// Per metric (Preview / Last Run):
//   ok      - counts equal, no highlight
//   bothNA  - no count on either side (never previewed/run): light grey
//   oneNA   - count on only one side (missing in the other model): dark red
//   diff    - both have counts but they differ: red
type MetricStatus = 'ok' | 'bothNA' | 'oneNA' | 'diff';

const isCapped = (count?: number): boolean => count !== undefined && count >= PREVIEW_ROW_CAP;

const metricStatus = (a?: number, b?: number, capped = false): MetricStatus => {
	if (a === undefined && b === undefined) return 'bothNA';
	if (a === undefined || b === undefined) return 'oneNA';
	if (capped && isCapped(a) && isCapped(b)) return 'ok';
	return a === b ? 'ok' : 'diff';
};

const columnStatus = (row: ParityRow, column: Column): MetricStatus | undefined => {
	if (column.startsWith('preview')) return metricStatus(row.previewA, row.previewB, true);
	if (column.startsWith('lastRun')) return metricStatus(row.lastRunA, row.lastRunB);
	return undefined;
};

const formatCell = (row: ParityRow, column: Column, lastRunOnly = false): string => {
	if (lastRunOnly && column === 'previewResults') return 'Not compared';
	if (column.endsWith('Results') && columnStatus(row, column) === 'bothNA') return 'Tool Not Found';
	// A capped Preview count is a lower bound, so with one side capped the delta is only a bound.
	if (column === 'previewResults' && row.previewA !== undefined && row.previewB !== undefined) {
		if (isCapped(row.previewA) && isCapped(row.previewB)) return 'Capped';
		if (isCapped(row.previewA)) return `≤ ${row.previewB - PREVIEW_ROW_CAP}`;
		if (isCapped(row.previewB)) return `≥ ${PREVIEW_ROW_CAP - row.previewA}`;
	}
	if (column === 'previewA' || column === 'previewB') {
		const value = row[column];
		if (isCapped(value)) return `${PREVIEW_ROW_CAP.toLocaleString('en-US')}+`;
	}
	const value = row[column];
	if (column === 'toolType' || column === 'calculationName') return value !== undefined ? String(value) : 'n/a';
	return value !== undefined ? String(value) : NOT_AVAILABLE;
};

const STATUS_CLASS: Record<MetricStatus, string | undefined> = {
	ok: undefined,
	bothNA: 'na',
	oneNA: 'missing',
	diff: 'bad'
};

const COUNT_COLUMNS: ReadonlySet<Column> = new Set(['previewA', 'previewB', 'lastRunA', 'lastRunB']);

const cellClass = (row: ParityRow, column: Column): string | undefined => {
	if (column === 'parity') return row.parity === 'No' ? 'bad' : undefined;
	const status = columnStatus(row, column);
	return status ? STATUS_CLASS[status] : undefined;
};

const escapeHtml = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:24px;color:#222}
h1{font-size:20px;margin:0 0 16px}
table{border-collapse:collapse;font-size:13px}
table.info{margin-bottom:12px;min-width:640px}
table.results{width:100%;margin-top:16px}
th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
th{background:#f0f0f0}
table.info th.title{background:#333;color:#fff;font-size:14px}
table.info td.label{background:#f0f0f0;font-weight:600;width:200px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.bad,tr.mismatch td{background:#fce8e6;color:#c5221f}
tr.mismatch td.missing,td.missing{background:#ffcc80;color:#8a4500}
tr.mismatch td.na,td.na{background:#eeeeee;color:#777}
td.diff-count{font-weight:700}
tr.group-start td{border-top:3px solid #666}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
table.legend{min-width:380px}
table.legend th.title{background:#333;color:#fff;font-size:14px}
table.legend td.swatch{width:70px}
h2{font-size:16px;margin:28px 0 4px}
.meta{color:#555;font-size:12px;margin-top:4px}
`;

const NOT_FOUND_COLUMNS = ['calculationName', 'pipeID', 'elementName', 'toolType', 'elementID'] as const;

const LEGEND = [
	'<tr><th>Color</th><th>Model A / Model B</th><th>Results</th></tr>',
	'<tr><td class="swatch na">Grey</td><td>N/A in both models</td><td>Tool Not Found</td></tr>',
	'<tr><td class="swatch missing">Orange</td><td>N/A in one model, real count in the other</td><td>N/A</td></tr>',
	'<tr><td class="swatch bad">Red</td><td>Counts exist in both but differ</td><td>B minus A</td></tr>',
	'<tr><td class="swatch">None</td><td>Counts match</td><td>0</td></tr>',
	'<tr><td class="swatch" colspan="3">Preview counts are capped at 10,000: shown as "10,000+"; two capped counts are treated as a match.</td></tr>'
].join('\n');

export const writeHtmlReport = async (
	path: string,
	mismatchRows: ParityRow[],
	notFoundRows: ParityRow[],
	targetA: ParityTarget,
	targetB: ParityTarget,
	stats: ReportStats,
	snapshotInfo?: SnapshotReportInfo
): Promise<void> => {
	const infoRow = (label: string, value: string): string =>
		`<tr><td class="label">${label}</td><td colspan="2">${escapeHtml(value)}</td></tr>`;
	const modelRow = (label: string, a: string, b: string): string =>
		`<tr><td class="label">${label}</td><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`;

	const info = [
		`<tr><th></th><th>Model A</th><th>Model B</th></tr>`,
		snapshotInfo
			? modelRow('Snapshot', snapshotInfo.labelA, snapshotInfo.labelB)
			: modelRow('engineMode', 'Hybrid', 'Big'),
		...(snapshotInfo ? [modelRow('Saved', snapshotInfo.savedAtA, snapshotInfo.savedAtB)] : []),
		modelRow('Environment', targetA.env, targetB.env),
		modelRow('Model name', targetA.modelName, targetB.modelName),
		modelRow('Org ID', targetA.orgID, targetB.orgID),
		infoRow('Calculations compared', String(stats.calculations)),
		infoRow(
			'Total elements compared',
			`${stats.totalElements} (tools in parity: ${stats.inParity}, tools not in parity: ${stats.notInParity}, tools not found in either model: ${stats.notFound})`
		),
		...(snapshotInfo?.lastRunOnly ? [infoRow('Preview', 'Not compared (saved with --last-run-only)')] : []),
		...(snapshotInfo && !snapshotInfo.lastRunOnly && snapshotInfo.previewsStale
			? [infoRow('Preview', 'Stored samples, not regenerated: Preview mismatches may be stale (save with --refresh-previews to rebuild)')]
			: []),
		...(snapshotInfo && snapshotInfo.refreshFailures > 0
			? [infoRow('Preview refresh failures', `${snapshotInfo.refreshFailures} (those Preview counts may be stale)`)]
			: []),
		infoRow('Generated', new Date().toLocaleString())
	].join('\n');

	let previousPipe: string | undefined;
	const body = mismatchRows
		.map((row) => {
			const groupStart = row.pipeID !== previousPipe;
			previousPipe = row.pipeID;
			const cells = REPORT_COLUMNS.map((column) => {
				const classes = [];
				if (column !== 'calculationName' && column !== 'pipeID' && column !== 'elementName' && column !== 'toolType' && column !== 'elementID' && column !== 'parity') {
					classes.push('num');
				}
				const status = cellClass(row, column);
				if (status) classes.push(status);
				if ((status === 'bad' || status === 'missing') && COUNT_COLUMNS.has(column)) classes.push('diff-count');
				const attr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
				return `<td${attr}>${escapeHtml(formatCell(row, column, snapshotInfo?.lastRunOnly))}</td>`;
			});
			const rowClasses = [groupStart ? 'group-start' : '', row.parity === 'No' ? 'mismatch' : ''].filter(Boolean);
			return `<tr${rowClasses.length > 0 ? ` class="${rowClasses.join(' ')}"` : ''}>${cells.join('')}</tr>`;
		})
		.join('\n');

	const notFoundBody = notFoundRows
		.map((row, index) => {
			const groupStart = index === 0 || row.pipeID !== notFoundRows[index - 1].pipeID;
			const cells = NOT_FOUND_COLUMNS.map((column) => `<td>${escapeHtml(String(row[column] ?? 'n/a'))}</td>`);
			return `<tr${groupStart ? ' class="group-start"' : ''}>${cells.join('')}</tr>`;
		})
		.join('\n');
	const notFoundSection =
		notFoundRows.length === 0
			? '<p class="meta">None.</p>'
			: `<table class="results">
<thead><tr>${NOT_FOUND_COLUMNS.map((column) => `<th>${column}</th>`).join('')}</tr></thead>
<tbody>
${notFoundBody}
</tbody></table>`;

	const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Parity Report</title><style>${STYLE}</style></head>
<body>
<h1>Parity Report</h1>
<div class="top">
<table class="info">
${info}
</table>
<table class="legend">
${LEGEND}
</table>
</div>
<table class="results">
<thead><tr>${REPORT_COLUMNS.map((column) => `<th>${column}</th>`).join('')}</tr></thead>
<tbody>
${body}
</tbody></table>
<h2>Tools not found in either model (${notFoundRows.length})</h2>
<div class="meta">No Preview or Last Run row count exists in either model, so these are not counted as mismatches.</div>
${notFoundSection}
</body></html>
`;
	await writeFile(path, html, 'utf8');
};
