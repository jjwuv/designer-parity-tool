import type { ApiClient } from './apiClientH.ts';
import { DEFAULT_PORT, SAMPLE_POLL_INTERVAL_MS, SAMPLE_TIMEOUT_MS } from './parityToolF.ts';

// Subset of the computation service's Data response that we read.
interface SampleResponse {
	status: 'preparing' | 'running' | 'completed' | 'failed';
	progress?: number;
	continuationToken?: string;
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * Regenerates an element's Preview sample the same way the Designer UI does:
 * POST /computations/samples, poll GET /computations/samples/{id} until it completes, then delete it.
 * Completing the job rewrites the element's `default_sample_rowcount`, so a following fast-count is current.
 * Returns false if the sample failed or timed out (the Preview count is then whatever is stored).
 */
export const refreshSample = async (client: ApiClient, pipeID: string, elementID: string): Promise<boolean> => {
	const deadline = Date.now() + SAMPLE_TIMEOUT_MS;
	let sampleID: string | undefined;
	try {
		let response = await client.post<SampleResponse>('/computations/samples', {
			requestType: 'sample',
			pipeID,
			elementID,
			port: DEFAULT_PORT
		});
		sampleID = response.continuationToken;

		while (response.status !== 'completed') {
			if (response.status === 'failed' || !sampleID || Date.now() > deadline) return false;
			await sleep(SAMPLE_POLL_INTERVAL_MS);
			response = await client.get<SampleResponse>(`/computations/samples/${sampleID}`);
			sampleID = response.continuationToken ?? sampleID;
		}
		return true;
	} catch {
		return false;
	} finally {
		if (sampleID) await client.delete(`/computations/samples/${sampleID}`).catch(() => undefined);
	}
};
