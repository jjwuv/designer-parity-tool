export interface EnvironmentConfig {
	uiUrl: string;
	designerApiUrl: string;
	apiUrl: string;
}

export interface ParityTarget {
	orgID: string;
	env: string;
	modelName: string;
	// Designer API key for this target; otherwise PARITY_<ENV>_APIKEY / PARITY_APIKEY is used. Never commit it.
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
	pipeName: string;
	pipeID: string;
	elementName: string;
	elementID: string;
	parity: 'Yes' | 'No';
	previewA?: number;
	previewB?: number;
	previewDelta?: number;
	lastRunA?: number;
	lastRunB?: number;
	lastRunDelta?: number;
}

// Raw API shapes, limited to the fields the tool reads.
export interface PipeResponse {
	pipeID: string;
	name: string;
}

export interface GraphElementResponse {
	elementID: string;
	toolType?: string;
	nameOverride?: string;
}

export interface PagedResponse<T> {
	items: T[];
	continuationToken?: string;
}
