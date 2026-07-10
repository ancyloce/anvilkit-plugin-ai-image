/**
 * @file Offline mock `AiImageProvider`, mirroring the structure of
 * `@anvilkit/plugin-ai-copilot`'s `mock/mock-generate-page.ts`: a
 * factory returning the provider fn, with a configurable simulated
 * latency and deterministic, per-`kind` results.
 *
 * Unlike the copilot mock, the simulated delay is abort-aware so the
 * cancellation path of {@link AiJobClient} is testable end-to-end.
 */

import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImageProvider,
} from "@anvilkit/canvas-core";
import { defaultSleep, RetryableError } from "../job/retry.js";

export interface CreateMockAiImageProviderOptions {
	/** Simulated provider latency in ms (abort-aware). @default 0 */
	readonly delayMs?: number;
	/**
	 * Asset id returned on success. A function receives the request so
	 * callers can vary the id per job. Defaults to a unique id derived
	 * from the request kind.
	 */
	readonly resultAssetId?: string | ((request: AiImageJobRequest) => string);
	/**
	 * Force a failure for exercising error/retry paths:
	 * - `"error"` resolves to a terminal `status: "error"` result.
	 * - `"retryable"` throws a `RetryableError` (drives `withRetry`).
	 */
	readonly simulate?: "error" | "retryable";
	/** Clock source; override for deterministic tests. @default Date.now */
	readonly now?: () => number;
}

let mockJobCounter = 0;

function resolveResultAssetId(
	request: AiImageJobRequest,
	resultAssetId: CreateMockAiImageProviderOptions["resultAssetId"],
): string {
	if (typeof resultAssetId === "function") {
		return resultAssetId(request);
	}
	if (typeof resultAssetId === "string") {
		return resultAssetId;
	}
	mockJobCounter += 1;
	return `mock-asset-${request.kind}-${mockJobCounter}`;
}

export function createMockAiImageProvider(
	opts: CreateMockAiImageProviderOptions = {},
): AiImageProvider {
	const delayMs = Math.max(0, opts.delayMs ?? 0);
	const now = opts.now ?? Date.now;

	return async (request, _context, options) => {
		const startedAt = now();
		// Abort-aware even when delayMs is 0: an already-aborted signal
		// rejects with an AbortError so the client maps it to cancelled.
		await defaultSleep(delayMs, options?.signal);

		if (opts.simulate === "retryable") {
			throw new RetryableError(
				"mock AI image provider: simulated transient failure",
			);
		}

		mockJobCounter += 1;
		const jobId = `mock-job-${mockJobCounter}`;

		if (opts.simulate === "error") {
			return {
				jobId,
				status: "error",
				error: {
					code: "MOCK_ERROR",
					message: "mock AI image provider: simulated failure",
				},
				startedAt,
				finishedAt: now(),
			};
		}

		const result: AiImageJobResult = {
			jobId,
			status: "complete",
			resultAssetId: resolveResultAssetId(request, opts.resultAssetId),
			startedAt,
			finishedAt: now(),
		};
		return result;
	};
}
