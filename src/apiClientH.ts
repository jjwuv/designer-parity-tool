import { TokenProvider } from './authH.ts';
import { MAX_RETRIES, ORG_HEADER, REQUEST_TIMEOUT_MS, RETRY_BASE_DELAY_MS } from './parityToolF.ts';
import type { ParityTarget } from './parityToolI.ts';

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Authenticated GET client for one target (env + org), with retries and one re-login on 401. */
export class ApiClient {
	readonly target: ParityTarget;
	private readonly tokenProvider: TokenProvider;

	constructor(target: ParityTarget) {
		this.target = target;
		this.tokenProvider = TokenProvider.forTarget(target);
	}

	async get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
		const params = new URLSearchParams();
		Object.entries(query).forEach(([key, value]) => {
			if (value !== undefined) params.set(key, value);
		});
		const queryString = params.size > 0 ? `?${params.toString()}` : '';

		let hasReauthenticated = false;
		for (let attempt = 0; ; attempt += 1) {
			let response: Response | undefined;
			const session = await this.tokenProvider.getSession();
			try {
				response = await fetch(`${session.apiUrl}${path}${queryString}`, {
					headers: {
						Authorization: session.authorization,
						[ORG_HEADER]: this.target.orgID,
						'Content-Type': 'application/json'
					},
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
				});
			} catch (error) {
				if (attempt >= MAX_RETRIES) throw error;
			}

			if (response?.ok) return (await response.json()) as T;

			if (response?.status === 401 && !hasReauthenticated) {
				hasReauthenticated = true;
				await this.tokenProvider.getSession(true);
			} else if (response && (!isRetryableStatus(response.status) || attempt >= MAX_RETRIES)) {
				throw new ApiError(response.status, `GET ${path} failed (${response.status}): ${await response.text()}`);
			} else {
				await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
			}
		}
	}
}
