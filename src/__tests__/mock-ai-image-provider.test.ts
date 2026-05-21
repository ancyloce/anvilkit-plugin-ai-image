import { describe, expect, it } from "vitest";
import { RetryableError } from "../job/retry.js";
import { createMockAiImageProvider } from "../mock/mock-ai-image-provider.js";
import type { AiImageJobRequest, AiLayerContext } from "../types/index.js";

const context: AiLayerContext = { artboardId: "ab-1" };

const requests: readonly AiImageJobRequest[] = [
	{ kind: "text-to-image", prompt: "a cat" },
	{ kind: "variation", sourceAssetId: "src-1" },
	{
		kind: "inpaint",
		sourceAssetId: "src-1",
		maskAssetId: "mask-1",
		prompt: "x",
	},
	{ kind: "bg-remove", sourceAssetId: "src-1" },
];

describe("createMockAiImageProvider", () => {
	it("returns a complete result with an asset id for each request kind", async () => {
		const provider = createMockAiImageProvider();

		for (const request of requests) {
			const result = await provider(request, context);
			expect(result.status).toBe("complete");
			expect(result.resultAssetId).toBeTruthy();
			expect(result.jobId).toBeTruthy();
			expect(result.finishedAt ?? 0).toBeGreaterThanOrEqual(result.startedAt);
		}
	});

	it("still resolves to complete after a simulated delay", async () => {
		const provider = createMockAiImageProvider({ delayMs: 5 });

		const result = await provider(
			{ kind: "text-to-image", prompt: "x" },
			context,
		);

		expect(result.status).toBe("complete");
	});

	it("accepts a custom resultAssetId resolver", async () => {
		const provider = createMockAiImageProvider({
			resultAssetId: (req) => `asset-for-${req.kind}`,
		});

		const result = await provider(
			{ kind: "bg-remove", sourceAssetId: "s" },
			context,
		);

		expect(result.resultAssetId).toBe("asset-for-bg-remove");
	});

	it("rejects with an AbortError when aborted during the delay", async () => {
		const provider = createMockAiImageProvider({ delayMs: 1_000 });
		const controller = new AbortController();

		const pending = provider({ kind: "text-to-image", prompt: "x" }, context, {
			signal: controller.signal,
		});
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const provider = createMockAiImageProvider();
		const controller = new AbortController();
		controller.abort();

		await expect(
			provider({ kind: "text-to-image", prompt: "x" }, context, {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("simulate:'error' resolves to a terminal error result", async () => {
		const provider = createMockAiImageProvider({ simulate: "error" });

		const result = await provider(
			{ kind: "bg-remove", sourceAssetId: "s" },
			context,
		);

		expect(result.status).toBe("error");
		expect(result.error?.code).toBe("MOCK_ERROR");
	});

	it("simulate:'retryable' throws a RetryableError", async () => {
		const provider = createMockAiImageProvider({ simulate: "retryable" });

		await expect(
			provider({ kind: "bg-remove", sourceAssetId: "s" }, context),
		).rejects.toBeInstanceOf(RetryableError);
	});
});
