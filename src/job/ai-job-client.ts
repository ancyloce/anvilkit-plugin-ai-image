/**
 * @file `AiJobClient` — drives an `AiImageProvider` (or, generically, any
 * design-job provider with the same shape) with cancellation,
 * transient-failure retry, and optional status polling.
 *
 * Task I1-5 of the Canvas Studio plan. The abort contract here (abort
 * resolves to a `cancelled` result rather than throwing) is consumed
 * by I1-10's `CanvasAiPlaceholderNode`, which renders from a terminal
 * `AiImageJobStatus`.
 *
 * Genericized in canvas-m4-002 (FR-051) so the identical retry/abort/poll
 * algorithm drives `AiDesignJobRequest`/`AiDesignJobResult` (canvas-m4-001)
 * too, instead of duplicating it. Every exported type defaults its type
 * parameters to the original image-job types, so every pre-existing bare
 * `AiJobClient`/`AiJobClientOptions`/etc. usage is unchanged.
 */

import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiLayerContext,
} from "@anvilkit/canvas-core";
import {
	defaultSleep,
	isAbortError,
	type RetryOptions,
	withRetry,
} from "./retry.js";

/** The minimal shape every job result (image or design) shares — enough for retry/abort/poll to drive it generically. */
export interface AiJobResultLike {
	jobId: string;
	status: "pending" | "complete" | "error" | "cancelled";
	startedAt: number;
	finishedAt?: number;
}

/**
 * Polls a previously-submitted job for its latest status. Supplied by
 * hosts that run AI work as an async background job; omitted for the
 * synchronous (and mock) path, where the first provider result is
 * already terminal.
 */
export type AiJobPollFn<TResult extends AiJobResultLike = AiImageJobResult> = (
	jobId: string,
	options?: { signal?: AbortSignal },
) => Promise<TResult>;

/** A provider function shaped like `AiImageProvider`, generic over the request/result/context types. */
export type AiJobProviderFn<
	TRequest = AiImageJobRequest,
	TResult extends AiJobResultLike = AiImageJobResult,
	TContext = AiLayerContext,
> = (
	request: TRequest,
	context: TContext,
	options?: { signal?: AbortSignal },
) => Promise<TResult>;

export interface AiJobClientOptions<
	TRequest = AiImageJobRequest,
	TResult extends AiJobResultLike = AiImageJobResult,
	TContext = AiLayerContext,
> {
	/** Host-supplied provider (from `@anvilkit/canvas-core`). */
	readonly provider: AiJobProviderFn<TRequest, TResult, TContext>;
	/**
	 * Optional poller for async jobs. When the provider returns a
	 * non-terminal `status: "pending"` and `poll` is set, the client
	 * polls until terminal, aborted, or timed out. No `poll` means the
	 * first provider result is returned as-is.
	 */
	readonly poll?: AiJobPollFn<TResult>;
	/**
	 * Delay between poll attempts, in ms. Only used when `poll` is set.
	 *
	 * @default 1000
	 */
	readonly pollIntervalMs?: number;
	/**
	 * Wall-clock budget for the poll loop, in ms. When exceeded, the
	 * client resolves to an `error` result with code `TIMEOUT`. Does
	 * not bound the initial provider call (the provider/host owns that
	 * via its own `AbortSignal`). Unset means poll until terminal or
	 * aborted.
	 */
	readonly pollTimeoutMs?: number;
	/** Max retry attempts after the initial call. @default 3 */
	readonly maxRetries?: number;
	/** Base backoff delay in ms. @default 250 */
	readonly baseDelayMs?: number;
	/** Cap on the backoff delay before jitter, in ms. @default 8000 */
	readonly maxDelayMs?: number;
	/** Jitter source; override for deterministic tests. @default Math.random */
	readonly jitter?: () => number;
	/** Sleep impl; override for deterministic tests. @default setTimeout-based */
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** Clock source; override for deterministic tests. @default Date.now */
	readonly now?: () => number;
}

export interface AiJobRunOptions {
	/** Aborts the in-flight provider call, retry sleeps, and polling. */
	readonly signal?: AbortSignal;
}

export interface AiJobClient<
	TRequest = AiImageJobRequest,
	TResult extends AiJobResultLike = AiImageJobResult,
	TContext = AiLayerContext,
> {
	/**
	 * Submit a job and resolve to its terminal result.
	 *
	 * - Transient failures (provider throws `RetryableError`) are retried
	 *   with full-jitter backoff.
	 * - Aborting `options.signal` resolves to a `cancelled` result.
	 * - A non-terminal result is polled to terminal when `poll` is set.
	 * - Non-retryable thrown errors propagate (reject).
	 */
	run(
		request: TRequest,
		context: TContext,
		options?: AiJobRunOptions,
	): Promise<TResult>;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;

function isTerminal(status: AiJobResultLike["status"]): boolean {
	return status === "complete" || status === "error" || status === "cancelled";
}

let fallbackJobCounter = 0;

/** A jobId for the abort-before-first-result case, where none exists yet. */
function nextFallbackJobId(): string {
	fallbackJobCounter += 1;
	return `ai-job-cancelled-${fallbackJobCounter}`;
}

export function createAiJobClient<
	TRequest = AiImageJobRequest,
	TResult extends AiJobResultLike = AiImageJobResult,
	TContext = AiLayerContext,
>(
	options: AiJobClientOptions<TRequest, TResult, TContext>,
): AiJobClient<TRequest, TResult, TContext> {
	const {
		provider,
		poll,
		pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
		pollTimeoutMs,
		maxRetries,
		baseDelayMs,
		maxDelayMs,
		jitter,
		sleep = defaultSleep,
		now = Date.now,
	} = options;

	if (typeof provider !== "function") {
		throw new TypeError(
			"createAiJobClient: options.provider must be a function. Got " +
				typeof provider,
		);
	}

	const retryOptions: RetryOptions = {
		maxRetries,
		baseDelayMs,
		maxDelayMs,
		jitter,
		sleep,
	};

	function cancelled(jobId: string, startedAt: number): TResult {
		// Every job-result type this client drives (`AiImageJobResult`,
		// `AiDesignJobResult`) has a "cancelled" branch requiring exactly
		// these fields and nothing else — see `AiJobResultLike`.
		return {
			jobId,
			status: "cancelled",
			startedAt,
			finishedAt: now(),
		} as TResult;
	}

	async function pollToTerminal(
		pollFn: AiJobPollFn<TResult>,
		initial: TResult,
		startedAt: number,
		signal: AbortSignal | undefined,
	): Promise<TResult> {
		let current = initial;
		const deadline =
			pollTimeoutMs !== undefined ? now() + pollTimeoutMs : undefined;

		while (!isTerminal(current.status)) {
			if (signal?.aborted) {
				return cancelled(current.jobId, startedAt);
			}
			if (deadline !== undefined && now() >= deadline) {
				return {
					...current,
					status: "error",
					error: {
						code: "TIMEOUT",
						message: `AI job ${current.jobId} did not complete within ${pollTimeoutMs}ms`,
					},
					finishedAt: now(),
				} as TResult;
			}
			try {
				await sleep(pollIntervalMs, signal);
				current = await pollFn(current.jobId, { signal });
			} catch (error) {
				if (isAbortError(error) || signal?.aborted) {
					return cancelled(current.jobId, startedAt);
				}
				throw error;
			}
		}
		return current;
	}

	return {
		async run(request, context, runOptions) {
			const signal = runOptions?.signal;
			const startedAt = now();

			if (signal?.aborted) {
				return cancelled(nextFallbackJobId(), startedAt);
			}

			let result: TResult;
			try {
				result = await withRetry(() => provider(request, context, { signal }), {
					...retryOptions,
					signal,
				});
			} catch (error) {
				if (isAbortError(error) || signal?.aborted) {
					return cancelled(nextFallbackJobId(), startedAt);
				}
				throw error;
			}

			if (isTerminal(result.status) || poll === undefined) {
				return result;
			}

			return pollToTerminal(poll, result, startedAt, signal);
		},
	};
}
