// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
	StudioCopilotPanel,
	StudioPluginContext,
} from "@anvilkit/core/types";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createAiJobClient } from "../../job/index.js";
import { createMockAiImageProvider } from "../../mock/index.js";
import type { AiImageJobResult, AiJobClient } from "../../types/index.js";
import { AiImagePanel } from "../ai-image-panel.js";
import { createAiImageSidebarPlugin } from "../create-ai-image-sidebar-plugin.js";
import { type AiImageJobRunner, useAiImage } from "../use-ai-image.js";

const ARTBOARD = () => ({ artboardId: "art-1" });
const NO_CONTEXT = () => null;

function completeResult(resultAssetId = "asset-1"): AiImageJobResult {
	return {
		jobId: "job-1",
		status: "complete",
		resultAssetId,
		startedAt: 0,
		finishedAt: 1,
	};
}

/** A panel needs only `run`; cast a stub to the interface. */
function fakeJobClient(run: AiImageJobRunner = vi.fn()): AiJobClient {
	return { run } as AiJobClient;
}

describe("useAiImage", () => {
	it("runs a text-to-image job and surfaces the result", async () => {
		const run = vi.fn<AiImageJobRunner>().mockResolvedValue(completeResult());
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD }),
		);

		act(() => result.current.onPromptChange("a cat"));
		expect(result.current.canRun).toBe(true);

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() =>
			expect(result.current.result?.resultAssetId).toBe("asset-1"),
		);

		expect(result.current.status).toBe("idle");
		expect(result.current.error).toBeNull();
		expect(run).toHaveBeenCalledTimes(1);
		const [request, context, options] = run.mock.calls[0] ?? [];
		expect(request).toEqual({ kind: "text-to-image", prompt: "a cat" });
		expect(context).toEqual({ artboardId: "art-1" });
		expect(options?.signal).toBeInstanceOf(AbortSignal);
	});

	it("surfaces a rejected run as an error and returns to idle", async () => {
		const run = vi.fn<AiImageJobRunner>().mockRejectedValue(new Error("boom"));
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD }),
		);
		act(() => result.current.onPromptChange("x"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(result.current.error).toBe("boom"));
		expect(result.current.status).toBe("idle");
		expect(result.current.result).toBeNull();
	});

	it("treats a reject-on-abort run as a cancel, not an error", async () => {
		let captured: { signal?: AbortSignal } | undefined;
		const run: AiImageJobRunner = (_req, _ctx, options) => {
			captured = options;
			return new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		};
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD }),
		);
		act(() => result.current.onPromptChange("x"));
		act(() => result.current.onRun());
		expect(result.current.status).toBe("pending");

		await act(async () => {
			result.current.onCancel();
		});
		await waitFor(() => expect(result.current.status).toBe("idle"));
		expect(captured?.signal?.aborted).toBe(true);
		expect(result.current.error).toBeNull();
		expect(result.current.result).toBeNull();
	});

	it("treats a resolve-with-cancelled result as a cancel", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue({ jobId: "j", status: "cancelled", startedAt: 0 });
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD }),
		);
		act(() => result.current.onPromptChange("x"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(result.current.status).toBe("idle"));
		expect(result.current.result).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it("gates canRun on per-op required fields and a layer context", () => {
		const { result } = renderHook(() =>
			useAiImage({ run: vi.fn(), getLayerContext: ARTBOARD }),
		);
		// text-to-image needs a prompt.
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onPromptChange("hi"));
		expect(result.current.canRun).toBe(true);
		// variation needs a source asset id, not a prompt.
		act(() => result.current.onOpChange("variation"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onSourceAssetIdChange("src-1"));
		expect(result.current.canRun).toBe(true);
	});

	it("reports no layer context and blocks runs when getLayerContext returns null", () => {
		const { result } = renderHook(() =>
			useAiImage({ run: vi.fn(), getLayerContext: NO_CONTEXT }),
		);
		act(() => result.current.onPromptChange("hi"));
		expect(result.current.hasLayerContext).toBe(false);
		expect(result.current.canRun).toBe(false);
	});

	it("integrates with a real AiJobClient over the mock provider", async () => {
		const provider = createMockAiImageProvider({ resultAssetId: "mock-asset" });
		const client = createAiJobClient({
			provider,
			sleep: async () => {
				/* resolve instantly — no real timers in tests */
			},
			jitter: () => 0,
		});
		const { result } = renderHook(() =>
			useAiImage({
				run: (request, context, options) =>
					client.run(request, context, options),
				getLayerContext: ARTBOARD,
			}),
		);
		act(() => result.current.onPromptChange("a cat"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() =>
			expect(result.current.result?.resultAssetId).toBe("mock-asset"),
		);
	});
});

describe("AiImagePanel", () => {
	it("renders the op selector and disables Run until the prompt is filled", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={ARTBOARD} />,
		);
		expect(screen.getByTestId("ak-module-ai-image")).toBeInTheDocument();
		expect(screen.getByTestId("ai-image-op-text-to-image")).toBeInTheDocument();
		expect(screen.getByTestId("ai-image-run")).toBeDisabled();

		fireEvent.change(screen.getByTestId("ai-image-prompt"), {
			target: { value: "a cat" },
		});
		expect(screen.getByTestId("ai-image-run")).toBeEnabled();
	});

	it("shows the no-context notice and blocks Run without a layer context", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={NO_CONTEXT} />,
		);
		expect(screen.getByTestId("ai-image-no-context")).toBeInTheDocument();
		expect(screen.getByTestId("ai-image-run")).toBeDisabled();
	});

	it("swaps the visible fields when the op changes", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={ARTBOARD} />,
		);
		expect(screen.getByTestId("ai-image-prompt")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("ai-image-op-variation"));
		expect(screen.getByTestId("ai-image-source")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-image-prompt")).toBeNull();
	});
});

describe("createAiImageSidebarPlugin", () => {
	function makeCtx(): {
		ctx: StudioPluginContext;
		registerCopilotPanel: ReturnType<typeof vi.fn>;
		unregister: ReturnType<typeof vi.fn>;
	} {
		const unregister = vi.fn();
		const registerCopilotPanel = vi.fn(() => unregister);
		const ctx = { registerCopilotPanel } as unknown as StudioPluginContext;
		return { ctx, registerCopilotPanel, unregister };
	}

	it("registers a copilot panel on onInit and unregisters once on onDestroy", async () => {
		const { ctx, registerCopilotPanel, unregister } = makeCtx();
		const plugin = createAiImageSidebarPlugin({
			jobClient: fakeJobClient(),
			getLayerContext: ARTBOARD,
		});
		const registration = await plugin.register(ctx);

		await registration.hooks?.onInit?.(ctx);
		expect(registerCopilotPanel).toHaveBeenCalledTimes(1);
		const panel = registerCopilotPanel.mock.calls[0]?.[0] as StudioCopilotPanel;
		expect(typeof panel.render).toBe("function");
		expect(isValidElement(panel.render())).toBe(true);

		await registration.hooks?.onDestroy?.(ctx);
		expect(unregister).toHaveBeenCalledTimes(1);
		// Idempotent — a second teardown does not double-unregister.
		await registration.hooks?.onDestroy?.(ctx);
		expect(unregister).toHaveBeenCalledTimes(1);
	});

	it("does not throw when the host omits registerCopilotPanel", async () => {
		const emptyCtx = {} as StudioPluginContext;
		const plugin = createAiImageSidebarPlugin({
			jobClient: fakeJobClient(),
			getLayerContext: NO_CONTEXT,
		});
		const registration = await plugin.register(emptyCtx);
		// `onInit`/`onDestroy` are synchronous here; just assert they no-op
		// cleanly when the optional `registerCopilotPanel` is absent.
		expect(() => registration.hooks?.onInit?.(emptyCtx)).not.toThrow();
		expect(() => registration.hooks?.onDestroy?.(emptyCtx)).not.toThrow();
	});
});
