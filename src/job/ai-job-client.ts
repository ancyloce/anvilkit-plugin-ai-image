/**
 * @file `AiJobClient` — drives an `AiImageProvider` with cancellation,
 * transient-failure retry, and optional status polling.
 *
 * Task I1-5 of the Canvas Studio plan. The abort contract here (abort
 * resolves to a `cancelled` result rather than throwing) is consumed
 * by I1-10's `CanvasAiPlaceholderNode`, which renders from a terminal
 * `AiImageJobStatus`.
 */

import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImageJobStatus,
	AiImageProvider,
	AiLayerContext,
} from "@anvilkit/canvas-core";
import {
	defaultSleep,
	isAbortError,
	type RetryOptions,
	withRetry,
} from "./retry.js";

/**
 * Polls a previously-submitted job for its latest status. Supplied by
 * hosts that run AI work as an async background job; omitted for the
 * synchronous (and mock) path, where the first provider result is
 * already terminal.
 */
export type AiJobPollFn = (
	jobId: string,
	options?: { signal?: AbortSignal },
) => Promise<AiImageJobResult>;

export interface AiJobClientOptions {
	/** Host-supplied AI image provider (from `@anvilkit/canvas-core`). */
	readonly provider: AiImageProvider;
	/**
	 * Optional poller for async jobs. When the provider returns a
	 * non-terminal `status: "pending"` and `poll` is set, the client
	 * polls until terminal, aborted, or timed out. No `poll` means the
	 * first provider result is returned as-is.
	 */
	readonly poll?: AiJobPollFn;
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

export interface AiJobClient {
	/**
	 * Submit a job and resolve to its terminal {@link AiImageJobResult}.
	 *
	 * - Transient failures (provider throws `RetryableError`) are retried
	 *   with full-jitter backoff.
	 * - Aborting `options.signal` resolves to a `cancelled` result.
	 * - A non-terminal result is polled to terminal when `poll` is set.
	 * - Non-retryable thrown errors propagate (reject).
	 */
	run(
		request: AiImageJobRequest,
		context: AiLayerContext,
		options?: AiJobRunOptions,
	): Promise<AiImageJobResult>;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;

const TERMINAL_STATUSES: ReadonlySet<AiImageJobStatus> = new Set([
	"complete",
	"error",
	"cancelled",
]);

function isTerminal(status: AiImageJobStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

let fallbackJobCounter = 0;

/** A jobId for the abort-before-first-result case, where none exists yet. */
function nextFallbackJobId(): string {
	fallbackJobCounter += 1;
	return `ai-job-cancelled-${fallbackJobCounter}`;
}

export function createAiJobClient(options: AiJobClientOptions): AiJobClient {
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
			"createAiJobClient: options.provider must be a function (AiImageProvider). Got " +
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

	function cancelled(jobId: string, startedAt: number): AiImageJobResult {
		return { jobId, status: "cancelled", startedAt, finishedAt: now() };
	}

	async function pollToTerminal(
		pollFn: AiJobPollFn,
		initial: AiImageJobResult,
		startedAt: number,
		signal: AbortSignal | undefined,
	): Promise<AiImageJobResult> {
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
				};
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

			let result: AiImageJobResult;
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
