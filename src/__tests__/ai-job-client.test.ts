import { describe, expect, it, vi } from "vitest";
import { createAiJobClient } from "../job/ai-job-client.js";
import { RetryableError } from "../job/retry.js";
import { createMockAiImageProvider } from "../mock/mock-ai-image-provider.js";
import type {
	AiDesignJobRequest,
	AiDesignJobResult,
	AiDesignProvider,
	AiImageJobRequest,
	AiImageJobResult,
	AiImageProvider,
	AiJobPollFn,
	AiLayerContext,
} from "../types/index.js";

const request: AiImageJobRequest = { kind: "text-to-image", prompt: "a cat" };
const context: AiLayerContext = { artboardId: "ab-1" };

/** Deterministic options that remove all real timers/jitter from tests. */
const deterministic = {
	sleep: async () => {
		/* resolve instantly — no real timers in tests */
	},
	jitter: () => 0,
} as const;

function completeResult(jobId = "job-1"): AiImageJobResult {
	return {
		jobId,
		status: "complete",
		resultAssetId: "asset-1",
		startedAt: 0,
		finishedAt: 1,
	};
}

describe("createAiJobClient", () => {
	it("throws on a non-function provider", () => {
		expect(() =>
			// biome-ignore lint/suspicious/noExplicitAny: deliberately bad input
			createAiJobClient({ provider: "nope" as any }),
		).toThrow(TypeError);
	});

	it("resolves to the provider's terminal result (one attempt)", async () => {
		const provider = vi.fn<AiImageProvider>(async () => completeResult());
		const client = createAiJobClient({ provider, ...deterministic });

		const result = await client.run(request, context);

		expect(result).toEqual(completeResult());
		expect(provider).toHaveBeenCalledTimes(1);
		expect(provider).toHaveBeenCalledWith(request, context, {
			signal: undefined,
		});
	});

	it("retries on RetryableError, then succeeds", async () => {
		let attempts = 0;
		const provider: AiImageProvider = async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new RetryableError("transient");
			}
			return completeResult();
		};
		const client = createAiJobClient({
			provider,
			maxRetries: 3,
			...deterministic,
		});

		const result = await client.run(request, context);

		expect(result.status).toBe("complete");
		expect(attempts).toBe(3);
	});

	it("rethrows once retries are exhausted", async () => {
		let attempts = 0;
		const provider: AiImageProvider = async () => {
			attempts += 1;
			throw new RetryableError("always");
		};
		const client = createAiJobClient({
			provider,
			maxRetries: 2,
			...deterministic,
		});

		await expect(client.run(request, context)).rejects.toBeInstanceOf(
			RetryableError,
		);
		expect(attempts).toBe(3); // initial + 2 retries
	});

	it("propagates non-retryable thrown errors", async () => {
		const provider: AiImageProvider = async () => {
			throw new Error("fatal");
		};
		const client = createAiJobClient({ provider, ...deterministic });

		await expect(client.run(request, context)).rejects.toThrow("fatal");
	});

	it("returns a cancelled result when the signal is already aborted", async () => {
		const provider = vi.fn<AiImageProvider>(async () => completeResult());
		const client = createAiJobClient({ provider, ...deterministic });
		const controller = new AbortController();
		controller.abort();

		const result = await client.run(request, context, {
			signal: controller.signal,
		});

		expect(result.status).toBe("cancelled");
		expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
		expect(provider).not.toHaveBeenCalled();
	});

	it("returns a cancelled result when aborted mid-flight", async () => {
		const controller = new AbortController();
		// Resolves only when aborted — exercises the in-flight cancel path.
		const provider: AiImageProvider = (_req, _ctx, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		const client = createAiJobClient({ provider, ...deterministic });

		const pending = client.run(request, context, { signal: controller.signal });
		controller.abort();
		const result = await pending;

		expect(result.status).toBe("cancelled");
	});

	it("returns a non-terminal result as-is when no poll is configured", async () => {
		const provider: AiImageProvider = async () => ({
			jobId: "job-pending",
			status: "pending",
			startedAt: 0,
		});
		const client = createAiJobClient({ provider, ...deterministic });

		const result = await client.run(request, context);

		expect(result.status).toBe("pending");
	});

	it("polls a pending job until it reaches a terminal status", async () => {
		const provider: AiImageProvider = async () => ({
			jobId: "job-async",
			status: "pending",
			startedAt: 0,
		});
		let polls = 0;
		const poll: AiJobPollFn = vi.fn(async (jobId) => {
			polls += 1;
			return polls < 2
				? { jobId, status: "pending", startedAt: 0 }
				: {
						jobId,
						status: "complete",
						resultAssetId: "asset-async",
						startedAt: 0,
						finishedAt: 2,
					};
		});
		const client = createAiJobClient({
			provider,
			poll,
			pollIntervalMs: 1,
			...deterministic,
		});

		const result = await client.run(request, context);

		expect(result.status).toBe("complete");
		expect(result.resultAssetId).toBe("asset-async");
		expect(poll).toHaveBeenCalledTimes(2);
	});

	it("returns a TIMEOUT error result when polling exceeds pollTimeoutMs", async () => {
		let clock = 0;
		const now = () => clock;
		const provider: AiImageProvider = async () => ({
			jobId: "job-slow",
			status: "pending",
			startedAt: now(),
		});
		const poll: AiJobPollFn = async (jobId) => {
			clock += 100;
			return { jobId, status: "pending", startedAt: 0 };
		};
		const client = createAiJobClient({
			provider,
			poll,
			pollIntervalMs: 1,
			pollTimeoutMs: 250,
			now,
			...deterministic,
		});

		const result = await client.run(request, context);

		expect(result.status).toBe("error");
		expect(result.error?.code).toBe("TIMEOUT");
	});

	it("returns a cancelled result when aborted during polling", async () => {
		const controller = new AbortController();
		const provider: AiImageProvider = async () => ({
			jobId: "job-cancel-poll",
			status: "pending",
			startedAt: 0,
		});
		const poll: AiJobPollFn = async (jobId) => {
			controller.abort();
			return { jobId, status: "pending", startedAt: 0 };
		};
		const client = createAiJobClient({
			provider,
			poll,
			pollIntervalMs: 1,
			...deterministic,
		});

		const result = await client.run(request, context, {
			signal: controller.signal,
		});

		expect(result.status).toBe("cancelled");
	});

	it("integrates with the mock provider (complete + cancelled paths)", async () => {
		const ok = await createAiJobClient({
			provider: createMockAiImageProvider({ delayMs: 5 }),
		}).run(request, context);
		expect(ok.status).toBe("complete");
		expect(ok.resultAssetId).toBeTruthy();

		const controller = new AbortController();
		const pending = createAiJobClient({
			provider: createMockAiImageProvider({ delayMs: 1_000 }),
		}).run(request, context, { signal: controller.signal });
		controller.abort();
		expect((await pending).status).toBe("cancelled");
	});
});

describe("createAiJobClient — design-job parity (FR-051, canvas-m4-002)", () => {
	const designRequest: AiDesignJobRequest = {
		kind: "rewrite-copy",
		nodeId: "headline",
	};

	function completeDesignResult(jobId = "design-job-1"): AiDesignJobResult {
		return {
			jobId,
			status: "complete",
			payload: {
				kind: "command",
				command: { type: "batch", commands: [] },
			},
			startedAt: 0,
			finishedAt: 1,
		};
	}

	it("resolves to the design provider's terminal result — same client, different types", async () => {
		const provider = vi.fn<AiDesignProvider>(async () =>
			completeDesignResult(),
		);
		const client = createAiJobClient<
			AiDesignJobRequest,
			AiDesignJobResult,
			AiLayerContext
		>({ provider, ...deterministic });

		const result = await client.run(designRequest, context);

		expect(result).toEqual(completeDesignResult());
		expect(provider).toHaveBeenCalledWith(designRequest, context, {
			signal: undefined,
		});
	});

	it("retries a design job on RetryableError, then succeeds", async () => {
		let attempts = 0;
		const provider: AiDesignProvider = async () => {
			attempts += 1;
			if (attempts < 3) throw new RetryableError("transient");
			return completeDesignResult();
		};
		const client = createAiJobClient<
			AiDesignJobRequest,
			AiDesignJobResult,
			AiLayerContext
		>({ provider, maxRetries: 3, ...deterministic });

		const result = await client.run(designRequest, context);

		expect(result.status).toBe("complete");
		expect(attempts).toBe(3);
	});

	it("cancels an in-flight design job identically to an image job", async () => {
		const provider = vi.fn<AiDesignProvider>(async () =>
			completeDesignResult(),
		);
		const client = createAiJobClient<
			AiDesignJobRequest,
			AiDesignJobResult,
			AiLayerContext
		>({ provider, ...deterministic });
		const controller = new AbortController();
		controller.abort();

		const result = await client.run(designRequest, context, {
			signal: controller.signal,
		});

		expect(result.status).toBe("cancelled");
		expect(provider).not.toHaveBeenCalled();
	});

	it("polls a pending design job until terminal, same as the image-job path", async () => {
		const provider: AiDesignProvider = async () => ({
			jobId: "design-job-async",
			status: "pending",
			startedAt: 0,
		});
		let polls = 0;
		const poll: AiJobPollFn<AiDesignJobResult> = vi.fn(async (jobId) => {
			polls += 1;
			return polls < 2
				? { jobId, status: "pending", startedAt: 0 }
				: {
						jobId,
						status: "complete",
						payload: {
							kind: "command",
							command: { type: "batch", commands: [] },
						},
						startedAt: 0,
						finishedAt: 2,
					};
		});
		const client = createAiJobClient<
			AiDesignJobRequest,
			AiDesignJobResult,
			AiLayerContext
		>({ provider, poll, pollIntervalMs: 1, ...deterministic });

		const result = await client.run(designRequest, context);

		expect(result.status).toBe("complete");
		expect(poll).toHaveBeenCalledTimes(2);
	});
});
