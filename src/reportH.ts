import { writeFile } from 'node:fs/promises';
import { REPORT_COLUMNS } from './parityToolF.ts';
import type { ParityRow, ParityTarget } from './parityToolI.ts';

const NOT_AVAILABLE = 'N/A';

export const describeTarget = (target: ParityTarget): string =>
	`${target.env} / ${target.modelName} / ${target.orgID}`;

// Mismatches first, then by pipe and element name.
export const sortReport = (rows: ParityRow[]): ParityRow[] =>
	[...rows].sort(
		(x, y) =>
			x.parity.localeCompare(y.parity) ||
			x.pipeName.localeCompare(y.pipeName) ||
			x.elementName.localeCompare(y.elementName)
	);

const formatCell = (row: ParityRow, column: (typeof REPORT_COLUMNS)[number]): string => {
	const value = row[column];
	if (value !== undefined) return String(value);
	return row.parity === 'No' ? NOT_AVAILABLE : '';
};

const escapeCsv = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const writeCsvReport = async (
	path: string,
	rows: ParityRow[],
	targetA: ParityTarget,
	targetB: ParityTarget
): Promise<void> => {
	const lines = [
		`# A: ${describeTarget(targetA)}`,
		`# B: ${describeTarget(targetB)}`,
		REPORT_COLUMNS.join(','),
		...rows.map((row) => REPORT_COLUMNS.map((column) => escapeCsv(formatCell(row, column))).join(','))
	];
	await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
};

export const printReport = (rows: ParityRow[], targetA: ParityTarget, targetB: ParityTarget): void => {
	const mismatchCount = rows.filter((row) => row.parity === 'No').length;
	console.log(`\nParity Report\n  A: ${describeTarget(targetA)}\n  B: ${describeTarget(targetB)}`);
	console.log(`  Compared elements: ${rows.length}, mismatches: ${mismatchCount}\n`);
	console.table(
		rows.map((row) => Object.fromEntries(REPORT_COLUMNS.map((column) => [column, formatCell(row, column)])))
	);
};
