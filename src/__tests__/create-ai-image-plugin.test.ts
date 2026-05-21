import { describe, expect, it, vi } from "vitest";
import { createAiImagePlugin } from "../create-ai-image-plugin.js";
import type { AiImageJobResult, AiImageProvider } from "../types.js";

const noopResult: AiImageJobResult = {
	jobId: "job-test",
	status: "complete",
	resultAssetId: "asset-test",
	startedAt: 0,
	finishedAt: 1,
};

const noopProvider: AiImageProvider = async () => noopResult;

describe("createAiImagePlugin", () => {
	it("returns a plugin with meta and register()", () => {
		const plugin = createAiImagePlugin({ provider: noopProvider });

		expect(plugin.meta.id).toBe("@anvilkit/plugin-ai-image");
		expect(plugin.meta.name).toBe("AI Image");
		expect(typeof plugin.register).toBe("function");
	});

	it("register() returns an empty registration with echoed meta", () => {
		const plugin = createAiImagePlugin({ provider: noopProvider });

		// biome-ignore lint/suspicious/noExplicitAny: ctx is unused by the I1-4 stub
		const registration = plugin.register({} as any);

		expect(registration).toMatchObject({
			meta: plugin.meta,
			hooks: {},
		});
	});

	it("submit() delegates to the host-supplied provider", async () => {
		const provider = vi.fn(noopProvider);
		const plugin = createAiImagePlugin({ provider });

		const result = await plugin.submit(
			{ kind: "text-to-image", prompt: "a cat" },
			{ artboardId: "ab-1" },
		);

		expect(result).toEqual(noopResult);
		expect(provider).toHaveBeenCalledTimes(1);
		expect(provider).toHaveBeenCalledWith(
			{ kind: "text-to-image", prompt: "a cat" },
			{ artboardId: "ab-1" },
			undefined,
		);
	});

	it("throws on a non-function provider", () => {
		expect(() =>
			// biome-ignore lint/suspicious/noExplicitAny: deliberately bad input
			createAiImagePlugin({ provider: "not-a-fn" as any }),
		).toThrow(TypeError);
	});
});
