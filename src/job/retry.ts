/**
 * @file Local abort-aware retry helper for AI image jobs.
 *
 * Mirrors the pattern in `@anvilkit/plugin-asset-manager`'s
 * `src/utils/retry.ts` (full-jitter exponential backoff, abort-aware
 * sleep, `retryAfterMs` override) but is reimplemented here so
 * `@anvilkit/plugin-ai-image` stays dependency-free and within its
 * gzip budget — there is no `plugin-ai-image -> plugin-asset-manager`
 * edge in the Canvas Studio dependency graph.
 */

/**
 * Marks an error as transient — {@link withRetry} reschedules the
 * underlying call rather than rethrowing.
 *
 * Providers should throw `RetryableError` for recoverable conditions
 * (HTTP 5xx, network blips); non-retryable failures should surface as
 * a plain `Error` (which propagates) or as an `AiImageJobResult` with
 * `status: "error"` (which does not).
 *
 * The optional `retryAfterMs` overrides the next computed delay, useful
 * when a server returned a `Retry-After` header.
 */
export class RetryableError extends Error {
	readonly retryAfterMs?: number;

	constructor(
		message: string,
		options?: { readonly cause?: unknown; readonly retryAfterMs?: number },
	) {
		super(message);
		this.name = "RetryableError";

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
		if (options?.retryAfterMs !== undefined) {
			this.retryAfterMs = options.retryAfterMs;
		}
	}
}

export interface RetryOptions {
	/**
	 * Maximum number of retry attempts after the initial call.
	 * `maxRetries: 3` means up to 4 total invocations.
	 *
	 * @default 3
	 */
	readonly maxRetries?: number;
	/**
	 * Base delay in milliseconds. The actual delay grows exponentially
	 * (`baseDelayMs * 2^attempt`) and is then jittered.
	 *
	 * @default 250
	 */
	readonly baseDelayMs?: number;
	/**
	 * Cap on the computed backoff delay (before jitter).
	 *
	 * @default 8000
	 */
	readonly maxDelayMs?: number;
	/** Aborts both the in-flight call and any pending retry sleep. */
	readonly signal?: AbortSignal;
	/** Defaults to `Math.random`. Override for deterministic tests. */
	readonly jitter?: () => number;
	/** Defaults to a `setTimeout`-based, abort-aware sleep. */
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

/**
 * Run `fn` and retry on {@link RetryableError} with full-jitter
 * exponential backoff. Honors `signal` between attempts and during
 * sleep.
 *
 * Resolution order on each error:
 *  1. If the signal is aborted -> throw an `AbortError` immediately.
 *  2. If the error is not a `RetryableError` -> rethrow.
 *  3. If retries are exhausted -> rethrow the last error.
 *  4. Otherwise compute backoff, sleep, and try again.
 */
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		maxRetries = DEFAULT_MAX_RETRIES,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
		maxDelayMs = DEFAULT_MAX_DELAY_MS,
		signal,
		jitter = Math.random,
		sleep = defaultSleep,
	} = options;

	let attempt = 0;

	while (true) {
		throwIfAborted(signal);
		try {
			return await fn(attempt);
		} catch (error) {
			throwIfAborted(signal);
			if (!isRetryable(error) || attempt >= maxRetries) {
				throw error;
			}
			const delay = computeDelay({
				attempt,
				baseDelayMs,
				maxDelayMs,
				jitter,
				retryAfterMs: getRetryAfterMs(error),
			});
			await sleep(delay, signal);
			attempt += 1;
		}
	}
}

function isRetryable(error: unknown): error is RetryableError {
	if (error instanceof RetryableError) {
		return true;
	}
	// Cross-realm safe: fall back to the discriminator field if the
	// prototype check misses (e.g. an error from another realm).
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "RetryableError"
	);
}

/** True for a DOM/Node `AbortError` (cross-realm safe via the name field). */
export function isAbortError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

function getRetryAfterMs(error: unknown): number | undefined {
	if (
		error !== null &&
		typeof error === "object" &&
		typeof (error as { retryAfterMs?: unknown }).retryAfterMs === "number"
	) {
		return (error as { retryAfterMs: number }).retryAfterMs;
	}
	return undefined;
}

function computeDelay(input: {
	readonly attempt: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
	readonly jitter: () => number;
	readonly retryAfterMs: number | undefined;
}): number {
	if (input.retryAfterMs !== undefined) {
		return Math.max(0, input.retryAfterMs);
	}
	const exp = Math.min(
		input.maxDelayMs,
		input.baseDelayMs * 2 ** input.attempt,
	);
	// Full jitter on the upper half: random between exp/2 and exp.
	const half = exp / 2;
	return Math.floor(half + input.jitter() * half);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw makeAbortError(signal);
	}
}

/** Builds the canonical `AbortError` for an aborted signal. */
export function makeAbortError(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) {
		return reason;
	}
	if (typeof DOMException !== "undefined") {
		return new DOMException("Aborted", "AbortError");
	}
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}

/**
 * Abort-aware `setTimeout` sleep. Resolves after `ms`; rejects with an
 * `AbortError` if `signal` aborts first (or is already aborted). A
 * non-positive `ms` resolves immediately after an abort check.
 */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		throwIfAborted(signal);
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		let onAbort: (() => void) | undefined;
		const timer = setTimeout(() => {
			if (signal && onAbort) {
				signal.removeEventListener("abort", onAbort);
			}
			resolve();
		}, ms);
		if (signal) {
			const activeSignal = signal;
			onAbort = () => {
				clearTimeout(timer);
				reject(makeAbortError(activeSignal));
			};
			if (activeSignal.aborted) {
				clearTimeout(timer);
				reject(makeAbortError(activeSignal));
				return;
			}
			activeSignal.addEventListener("abort", onAbort, { once: true });
		}
	});
}
