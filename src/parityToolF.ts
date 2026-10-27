import type { EnvironmentConfig } from './parityToolI.ts';

// Designer embeds ELT; each Designer env is backed by an ELT stage (see associatedIncentivesEnvName in api/stages.yml).
export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
	'designer-daily': {
		uiUrl: 'https://release2.spmdev.varicent.com',
		designerApiUrl: 'https://api.release2.spmdev.varicent.com',
		apiUrl: 'https://daily-api.wisepipe.com'
	},
	'designer-staging': {
		uiUrl: 'https://preview-staging.spmdev.varicent.com',
		designerApiUrl: 'https://api.preview-staging.spmdev.varicent.com',
		apiUrl: 'https://qa-staging-api.symon.ai'
	}
};

// Values of RequestType in api/computation/domain/src/dataRequest.ts, as used by the row viewer.
export const PREVIEW_REQUEST_TYPE = 'sample';
export const LAST_RUN_REQUEST_TYPE = 'pipe';

export const DEFAULT_PORT = 'default';

// The Preview (sample) row count file is written as min(10000, rows), so 10000 means "10,000 or more".
export const PREVIEW_ROW_CAP = 10000;
// A Preview count of 0 can be a sample that is still loading; re-check before trusting it.
export const PREVIEW_ZERO_RETRIES = 3;
export const PREVIEW_ZERO_RETRY_DELAY_MS = 3000;
export const INCENTIVES_EXPORT_TOOL_TYPE = 'incentives_export';
export const INCENTIVES_IMPORT_TOOL_TYPE = 'incentives_import';

// Sample regeneration (what the Designer UI does when an element's Preview is opened).
export const SAMPLE_POLL_INTERVAL_MS = 3000;
export const SAMPLE_TIMEOUT_MS = 10 * 60 * 1000;

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 4;
export const MAX_RETRIES = 4;
export const RETRY_BASE_DELAY_MS = 1000;
export const REQUEST_TIMEOUT_MS = 60000;

// Refresh the ELT token this long before its JWT expiry.
export const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

export const ORG_HEADER = 'wisepipe-org-id';
export const JWT_TOKEN_PATH = 'api/v1/symon/jwttoken';
export const DEFAULT_REPORT_PATH = 'parity-report.html';
export const DEFAULT_MODEL_DETAILS_PATH = 'model-details.json';
export const DEFAULT_SINGLE_MODEL_DETAILS_PATH = 'model-details-single.json';

export const PLANBUILDER_ITEMS_PATH = 'api/internal/planbuilder/items';

export const REPORT_COLUMNS = [
	'calculationName',
	'pipeID',
	'elementName',
	'toolType',
	'elementID',
	'parity',
	'previewA',
	'previewB',
	'previewResults',
	'lastRunA',
	'lastRunB',
	'lastRunResults'
] as const;
