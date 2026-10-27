import { ENVIRONMENTS, JWT_TOKEN_PATH, TOKEN_EXPIRY_BUFFER_MS } from './parityToolF.ts';
import type { EltSession, EnvironmentConfig, ParityTarget } from './parityToolI.ts';

interface JwtTokenResponse {
	token?: string;
	orgID?: string;
	apiUrl?: string;
}

const getJwtExpiry = (token: string): number => {
	try {
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
		return payload.exp ? payload.exp * 1000 : Number.MAX_SAFE_INTEGER;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
};

export const getEnvironment = (env: string): EnvironmentConfig => {
	const config = ENVIRONMENTS[env];
	if (!config) {
		throw new Error(`Unknown env '${env}'. Expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
	}
	return config;
};

/**
 * Gets an ELT session for one target the way api-test-automation's DesignerLib does: the Designer
 * API key as `Bearer <key>` plus the `Model` header on GET api/v1/symon/jwttoken, which returns an
 * ELT token that ELT accepts as `BearerCustomJwt <token>`.
 */
export class TokenProvider {
	private readonly target: ParityTarget;
	private readonly environment: EnvironmentConfig;
	private session?: EltSession;
	private pending?: Promise<EltSession>;

	private static readonly sharedProviders = new Map<string, TokenProvider>();

	private constructor(target: ParityTarget) {
		this.target = target;
		this.environment = getEnvironment(target.env);
	}

	static forTarget(target: ParityTarget): TokenProvider {
		const key = `${target.env}|${target.orgID}|${target.modelName}`;
		let provider = TokenProvider.sharedProviders.get(key);
		if (!provider) {
			provider = new TokenProvider(target);
			TokenProvider.sharedProviders.set(key, provider);
		}
		return provider;
	}

	async getSession(forceRefresh = false): Promise<EltSession> {
		const isFresh = this.session && this.session.expiresAt - TOKEN_EXPIRY_BUFFER_MS > Date.now();
		if (!this.session || !isFresh || forceRefresh) {
			if (!this.pending) {
				this.pending = this.createSession().finally(() => {
					this.pending = undefined;
				});
			}
			this.session = await this.pending;
		}
		return this.session;
	}

	/** GET against the Designer API itself (not ELT), authenticated with the Designer API key and Model header. */
	async getDesigner<T>(path: string): Promise<T> {
		const response = await fetch(`${this.environment.designerApiUrl}/${path}`, {
			headers: {
				Authorization: this.getDesignerAuthorization(),
				Model: this.target.modelName,
				'Content-Type': 'application/json'
			}
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`GET ${path} failed for '${this.target.env}' (${response.status}): ${text}`);
		}
		return JSON.parse(text) as T;
	}

	private getDesignerAuthorization(): string {
		const { env } = this.target;
		const { apiKey } = this.target;
		if (!apiKey) {
			throw new Error(`No Designer API key for env '${env}'.`);
		}
		return /^Bearer\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
	}

	private async createSession(): Promise<EltSession> {
		const { env, modelName, orgID } = this.target;
		const response = await fetch(`${this.environment.designerApiUrl}/${JWT_TOKEN_PATH}`, {
			headers: {
				Authorization: this.getDesignerAuthorization(),
				Model: modelName,
				'Content-Type': 'application/json'
			}
		});
		const text = await response.text();
		let body: JwtTokenResponse | undefined;
		try {
			body = JSON.parse(text) as JwtTokenResponse;
		} catch {
			body = undefined;
		}
		if (!response.ok || !body?.token) {
			throw new Error(`GET ${JWT_TOKEN_PATH} failed for '${env}' (${response.status}): ${text}`);
		}
		if (body.orgID && body.orgID !== orgID) {
			throw new Error(`Model '${modelName}' on '${env}' belongs to org ${body.orgID}, not ${orgID}.`);
		}
		return {
			authorization: `BearerCustomJwt ${body.token}`,
			apiUrl: (body.apiUrl ?? this.environment.apiUrl).replace(/\/+$/, ''),
			expiresAt: getJwtExpiry(body.token)
		};
	}
}
