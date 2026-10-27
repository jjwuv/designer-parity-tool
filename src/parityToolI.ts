export interface EnvironmentConfig {
	uiUrl: string;
	designerApiUrl: string;
	apiUrl: string;
}

export interface ParityTarget {
	orgID: string;
	env: string;
	modelName: string;
	// Always filled from designerParityModel1_apikey / designerParityModel2_apikey; any value in the config file is ignored.
	apiKey?: string;
}

export interface ParityConfig {
	a: ParityTarget;
	b: ParityTarget;
}

export interface EltSession {
	authorization: string;
	apiUrl: string;
	expiresAt: number;
}

export interface PipeSummary {
	pipeID: string;
	name: string;
	// Designer calculation name; ELT pipe names are not human readable.
	calculationName?: string;
}

export interface ElementSummary {
	elementID: string;
	name: string;
	toolType: string;
}

export interface RowCounts {
	preview?: number;
	lastRun?: number;
}

export interface MatchedElement {
	pipe: PipeSummary;
	element: ElementSummary;
}

export interface ParityRow {
	calculationName?: string;
	pipeID: string;
	elementName: string;
	toolType?: string;
	elementID: string;
	// NotFound: no Preview or Last Run count in either model (tool never previewed/run on both sides).
	parity: 'Yes' | 'No' | 'NotFound';
	previewA?: number;
	previewB?: number;
	previewResults?: number;
	lastRunA?: number;
	lastRunB?: number;
	lastRunResults?: number;
}

// Raw API shapes, limited to the fields the tool reads.
export interface PipeResponse {
	pipeID: string;
	name: string;
}

export interface PlanBuilderItem {
	itemType?: string;
	name?: string;
	calculation?: {
		name?: string;
		pipeId?: string | null;
	};
}

export interface PlanBuilderItemsResponse {
	results?: PlanBuilderItem[];
	items?: PlanBuilderItem[];
}

export interface GraphElementResponse {
	elementID: string;
	toolType?: string;
	nameOverride?: string;
}

// Single-model mode: one model's row counts saved to a file, compared later against another snapshot.
export interface SnapshotElement extends ElementSummary, RowCounts {}

export interface SnapshotPipe extends PipeSummary {
	elements: SnapshotElement[];
}

export interface Snapshot {
	label: string;
	savedAt: string;
	target: Omit<ParityTarget, 'apiKey'>;
	pipes: SnapshotPipe[];
	// "<pipeID>/<elementID>" of elements whose Preview sample could not be regenerated; their Preview may be stale.
	refreshFailures: string[];
	// Saved with --last-run-only: no Preview counts, so compare checks Last Run only.
	lastRunOnly?: boolean;
	// Saved with --refresh-previews: Preview samples were regenerated before reading. Otherwise they may be stale.
	previewsRefreshed?: boolean;
}

export interface PagedResponse<T> {
	items: T[];
	continuationToken?: string;
}
