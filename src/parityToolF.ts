import type { EnvironmentConfig } from './parityToolI.ts';

// Designer embeds ELT; each Designer env is backed by an ELT stage (see associatedIncentivesEnvName in api/stages.yml).
const DESIGNER_DEV: EnvironmentConfig = {
	uiUrl: 'https://release2.spmdev.varicent.com',
	designerApiUrl: 'https://api.release2.spmdev.varicent.com',
	apiUrl: 'https://daily-api.wisepipe.com'
};

export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
	'designer-dev': DESIGNER_DEV,
	'designer-daily': DESIGNER_DEV,
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
export const INCENTIVES_EXPORT_TOOL_TYPE = 'incentives_export';

export const DEFAULT_CONCURRENCY = 5;
export const MAX_RETRIES = 4;
export const RETRY_BASE_DELAY_MS = 1000;
export const REQUEST_TIMEOUT_MS = 60000;

// Refresh the ELT token this long before its JWT expiry.
export const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

export const ORG_HEADER = 'wisepipe-org-id';
export const JWT_TOKEN_PATH = 'api/v1/symon/jwttoken';

export const DEFAULT_REPORT_PATH = 'parity-report.csv';

export const REPORT_COLUMNS = [
	'pipeName',
	'pipeID',
	'elementName',
	'elementID',
	'parity',
	'previewA',
	'previewB',
	'previewDelta',
	'lastRunA',
	'lastRunB',
	'lastRunDelta'
] as const;
