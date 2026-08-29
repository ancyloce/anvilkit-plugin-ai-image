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
import type {
	AiDesignJobResult,
	AiImageJobResult,
	AiJobClient,
} from "../../types/index.js";
import { AiImagePanel } from "../ai-image-panel.js";
import { createAiImageSidebarPlugin } from "../create-ai-image-sidebar-plugin.js";
import { type AiDesignJobRunner, useAiDesign } from "../use-ai-design.js";
import { type AiImageJobRunner, useAiImage } from "../use-ai-image.js";

const ARTBOARD = () => ({ artboardId: "art-1" });
const ARTBOARD_WITH_IMAGE = () => ({
	artboardId: "art-1",
	selectedNodeId: "image-1",
	selectedNodeKind: "image" as const,
	selectedAssetId: "selected-asset",
});
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
		// Deferred so we can assert the run actually started (pending) before
		// it settles — otherwise a no-op onRun would pass against the
		// already-idle/null initial state.
		let resolveRun: ((r: AiImageJobResult) => void) | undefined;
		const run = vi.fn<AiImageJobRunner>(
			() =>
				new Promise<AiImageJobResult>((resolve) => {
					resolveRun = resolve;
				}),
		);
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD }),
		);
		act(() => result.current.onPromptChange("x"));

		act(() => result.current.onRun());
		expect(run).toHaveBeenCalledTimes(1);
		expect(result.current.status).toBe("pending");

		await act(async () => {
			resolveRun?.({ jobId: "j", status: "cancelled", startedAt: 0 });
		});
		await waitFor(() => expect(result.current.status).toBe("idle"));
		expect(result.current.result).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it("gates canRun on per-op required fields and a layer context", () => {
		const { result } = renderHook(() =>
			useAiImage({ run: vi.fn(), getLayerContext: ARTBOARD_WITH_IMAGE }),
		);
		// text-to-image needs a prompt.
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onPromptChange("hi"));
		expect(result.current.canRun).toBe(true);
		// variation needs a source asset id, not a prompt.
		act(() => result.current.onOpChange("variation"));
		// The selected image supplies its asset id without a duplicate manual input.
		expect(result.current.canRun).toBe(true);
		act(() => result.current.onSourceAssetIdChange("src-1"));
		expect(result.current.canRun).toBe(true);
	});

	it("gates canRun for the FR-050 image-editing ops (UX-006)", () => {
		const { result } = renderHook(() =>
			useAiImage({ run: vi.fn(), getLayerContext: ARTBOARD_WITH_IMAGE }),
		);

		// object-erase needs source + mask, no prompt.
		act(() => result.current.onOpChange("object-erase"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onSourceAssetIdChange("src-1"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onMaskAssetIdChange("mask-1"));
		expect(result.current.canRun).toBe(true);

		// generative-expand needs source + both target dimensions, no prompt.
		act(() => result.current.onOpChange("generative-expand"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onTargetWidthChange("1600"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onTargetHeightChange("900"));
		expect(result.current.canRun).toBe(true);

		// background-replace needs source + prompt.
		act(() => result.current.onOpChange("background-replace"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onPromptChange("a studio backdrop"));
		expect(result.current.canRun).toBe(true);
	});

	it("reports no layer context and blocks runs when getLayerContext returns null", () => {
		const run = vi.fn<AiImageJobRunner>();
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: NO_CONTEXT }),
		);
		act(() => result.current.onPromptChange("hi"));
		expect(result.current.hasLayerContext).toBe(false);
		expect(result.current.canRun).toBe(false);
		// Even invoked directly, onRun must not submit without a context.
		act(() => result.current.onRun());
		expect(run).not.toHaveBeenCalled();
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

function completeDesignResult(): AiDesignJobResult {
	return {
		jobId: "design-job-1",
		status: "complete",
		payload: {
			kind: "command",
			command: {
				type: "node.update",
				nodeId: "headline",
				kind: "text",
				patch: { text: "Rewritten" },
			},
		},
		startedAt: 0,
		finishedAt: 1,
	};
}

describe("useAiDesign (FR-053, canvas-m4-004)", () => {
	it("runs a design request and surfaces the completed result", async () => {
		const run = vi
			.fn<AiDesignJobRunner>()
			.mockResolvedValue(completeDesignResult());
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: ARTBOARD }),
		);

		await act(async () => {
			result.current.run({ kind: "rewrite-copy", nodeId: "headline" });
		});
		await waitFor(() => expect(result.current.result?.status).toBe("complete"));

		expect(result.current.status).toBe("idle");
		expect(result.current.error).toBeNull();
		expect(run).toHaveBeenCalledTimes(1);
		const [request, context] = run.mock.calls[0] ?? [];
		expect(request).toEqual({ kind: "rewrite-copy", nodeId: "headline" });
		expect(context).toEqual({ artboardId: "art-1" });
	});

	it("validates and commits a completed result through the injected commit", async () => {
		const run = vi
			.fn<AiDesignJobRunner>()
			.mockResolvedValue(completeDesignResult());
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: ARTBOARD, commit }),
		);

		await act(async () => {
			result.current.run({ kind: "rewrite-copy", nodeId: "headline" });
		});
		await waitFor(() => expect(result.current.status).toBe("idle"));

		expect(commit).toHaveBeenCalledTimes(1);
		expect(commit.mock.calls[0]?.[0]).toEqual({
			type: "batch",
			commands: [
				{
					type: "node.update",
					nodeId: "headline",
					kind: "text",
					patch: { text: "Rewritten" },
				},
			],
		});
	});

	it("surfaces a quarantined (invalid) result as an error and never calls commit", async () => {
		const invalidResult: AiDesignJobResult = {
			jobId: "j1",
			status: "complete",
			payload: {
				kind: "command",
				command: {
					type: "node.create",
					parentId: "root",
					node: {
						id: "bad",
						// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid to prove quarantine
						type: "made-up-kind" as any,
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 10, height: 10 },
						zIndex: 0,
					},
				},
			},
			startedAt: 0,
			finishedAt: 1,
		};
		const run = vi.fn<AiDesignJobRunner>().mockResolvedValue(invalidResult);
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: ARTBOARD, commit }),
		);

		await act(async () => {
			result.current.run({ kind: "rewrite-copy", nodeId: "headline" });
		});
		await waitFor(() => expect(result.current.error).not.toBeNull());
		expect(commit).not.toHaveBeenCalled();
	});

	it("surfaces a job-level error result", async () => {
		const errorResult: AiDesignJobResult = {
			jobId: "j1",
			status: "error",
			error: { code: "PROVIDER_TIMEOUT", message: "provider timed out" },
			startedAt: 0,
		};
		const run = vi.fn<AiDesignJobRunner>().mockResolvedValue(errorResult);
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: ARTBOARD }),
		);

		await act(async () => {
			result.current.run({ kind: "rewrite-copy", nodeId: "headline" });
		});
		await waitFor(() =>
			expect(result.current.error).toBe("provider timed out"),
		);
	});

	it("cancelling an in-flight run resolves to idle with no result/error", async () => {
		let captured: { signal?: AbortSignal } | undefined;
		const run: AiDesignJobRunner = (_req, _ctx, options) => {
			captured = options;
			return new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		};
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: ARTBOARD }),
		);

		act(() => result.current.run({ kind: "rewrite-copy", nodeId: "headline" }));
		expect(result.current.status).toBe("pending");

		await act(async () => {
			result.current.onCancel();
		});
		await waitFor(() => expect(result.current.status).toBe("idle"));
		expect(captured?.signal?.aborted).toBe(true);
		expect(result.current.error).toBeNull();
		expect(result.current.result).toBeNull();
	});

	it("does not call run without a layer context", () => {
		const run = vi.fn<AiDesignJobRunner>();
		const { result } = renderHook(() =>
			useAiDesign({ run, getLayerContext: NO_CONTEXT }),
		);
		expect(result.current.hasLayerContext).toBe(false);
		act(() => result.current.run({ kind: "rewrite-copy", nodeId: "headline" }));
		expect(run).not.toHaveBeenCalled();
		expect(result.current.error).not.toBeNull();
	});
});

describe("useAiImage — image.replace commit", () => {
	const ARTBOARD_WITH_NODE = () => ({
		artboardId: "art-1",
		selectedNodeId: "node-1",
	});

	it("commits image.replace when a variation completes against a selected node", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("ai-out"));
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD_WITH_NODE, commit }),
		);
		act(() => result.current.onOpChange("variation"));
		act(() => result.current.onSourceAssetIdChange("src-1"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

		expect(commit.mock.calls[0]?.[0]).toEqual({
			type: "image.replace",
			nodeId: "node-1",
			fromAssetId: "src-1",
			toAssetId: "ai-out",
		});
		expect(result.current.error).toBeNull();
	});

	it("does not commit for a text-to-image result (no node to replace)", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("ai-out"));
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD_WITH_NODE, commit }),
		);
		act(() => result.current.onPromptChange("a cat"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() =>
			expect(result.current.result?.resultAssetId).toBe("ai-out"),
		);
		expect(commit).not.toHaveBeenCalled();
	});

	it("commits the post-processed asset id when postProcess is provided", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("raw"));
		const commit = vi.fn();
		const postProcess = vi.fn().mockResolvedValue("processed");
		const { result } = renderHook(() =>
			useAiImage({
				run,
				getLayerContext: ARTBOARD_WITH_NODE,
				commit,
				postProcess,
			}),
		);
		act(() => result.current.onOpChange("bg-remove"));
		act(() => result.current.onSourceAssetIdChange("src-9"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

		expect(postProcess).toHaveBeenCalledTimes(1);
		expect(commit.mock.calls[0]?.[0]).toEqual({
			type: "image.replace",
			nodeId: "node-1",
			fromAssetId: "src-9",
			toAssetId: "processed",
		});
	});

	it("commits image.replace when an upscale completes against a selected node", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("ai-out"));
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD_WITH_NODE, commit }),
		);
		act(() => result.current.onOpChange("upscale"));
		expect(result.current.canRun).toBe(false);
		act(() => result.current.onSourceAssetIdChange("src-7"));
		expect(result.current.canRun).toBe(true);

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

		expect(run.mock.calls[0]?.[0]).toEqual({
			kind: "upscale",
			sourceAssetId: "src-7",
		});
		expect(commit.mock.calls[0]?.[0]).toEqual({
			type: "image.replace",
			nodeId: "node-1",
			fromAssetId: "src-7",
			toAssetId: "ai-out",
		});
		expect(result.current.error).toBeNull();
	});

	it("does not commit when no node is selected", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("ai-out"));
		const commit = vi.fn();
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD, commit }),
		);
		act(() => result.current.onOpChange("variation"));
		act(() => result.current.onSourceAssetIdChange("src-1"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() =>
			expect(result.current.result?.resultAssetId).toBe("ai-out"),
		);
		expect(commit).not.toHaveBeenCalled();
	});

	it("surfaces a commit failure as an error", async () => {
		const run = vi
			.fn<AiImageJobRunner>()
			.mockResolvedValue(completeResult("ai-out"));
		const commit = vi.fn(() => {
			throw new Error("commit boom");
		});
		const { result } = renderHook(() =>
			useAiImage({ run, getLayerContext: ARTBOARD_WITH_NODE, commit }),
		);
		act(() => result.current.onOpChange("variation"));
		act(() => result.current.onSourceAssetIdChange("src-1"));

		await act(async () => {
			result.current.onRun();
		});
		await waitFor(() => expect(result.current.error).toBe("commit boom"));
		expect(result.current.status).toBe("idle");
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
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_IMAGE}
			/>,
		);
		expect(screen.getByTestId("ai-image-prompt")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("ai-image-op-variation"));
		expect(screen.getByTestId("ai-image-source")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-image-prompt")).toBeNull();
	});

	it("shows every built-in op — including the FR-050 image-editing ops (UX-006) — when capabilities is omitted", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={ARTBOARD} />,
		);
		for (const kind of [
			"text-to-image",
			"variation",
			"inpaint",
			"bg-remove",
			"upscale",
			"generative-fill",
			"generative-expand",
			"object-erase",
			"background-replace",
		]) {
			expect(screen.getByTestId(`ai-image-op-${kind}`)).toBeInTheDocument();
		}
	});

	it("only shows ops in capabilities.imageOps when set (FR-051)", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD}
				capabilities={{ imageOps: ["text-to-image", "bg-remove"] }}
			/>,
		);
		expect(screen.getByTestId("ai-image-op-text-to-image")).toBeInTheDocument();
		expect(screen.getByTestId("ai-image-op-bg-remove")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-image-op-variation")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-inpaint")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-upscale")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-generative-fill")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-generative-expand")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-object-erase")).toBeNull();
		expect(screen.queryByTestId("ai-image-op-background-replace")).toBeNull();
	});

	it("dispatches a background-replace request (UX-006 'replace background')", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_IMAGE}
			/>,
		);
		fireEvent.click(screen.getByTestId("ai-image-op-background-replace"));
		fireEvent.change(screen.getByTestId("ai-image-source"), {
			target: { value: "src-1" },
		});
		fireEvent.change(screen.getByTestId("ai-image-prompt"), {
			target: { value: "a studio backdrop" },
		});
		expect(screen.getByTestId("ai-image-run")).toBeEnabled();
		expect(screen.queryByTestId("ai-image-mask")).toBeNull();
	});

	it("dispatches a generative-expand request with target dimensions (UX-006 'expand background')", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_IMAGE}
			/>,
		);
		fireEvent.click(screen.getByTestId("ai-image-op-generative-expand"));
		expect(screen.getByTestId("ai-image-run")).toBeDisabled();
		fireEvent.change(screen.getByTestId("ai-image-source"), {
			target: { value: "src-1" },
		});
		fireEvent.change(screen.getByTestId("ai-image-target-width"), {
			target: { value: "1600" },
		});
		fireEvent.change(screen.getByTestId("ai-image-target-height"), {
			target: { value: "900" },
		});
		expect(screen.getByTestId("ai-image-run")).toBeEnabled();
		expect(screen.queryByTestId("ai-image-seed")).toBeNull();
	});

	it("shows the mask field for generative-fill and object-erase, mirroring inpaint", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_IMAGE}
			/>,
		);
		fireEvent.click(screen.getByTestId("ai-image-op-generative-fill"));
		expect(screen.getByTestId("ai-image-mask")).toBeInTheDocument();
		expect(screen.getByTestId("ai-image-prompt")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("ai-image-op-object-erase"));
		expect(screen.getByTestId("ai-image-mask")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-image-prompt")).toBeNull();
	});

	it("actually submits the built request for each new op via jobClient.run", async () => {
		const run = vi.fn<AiImageJobRunner>().mockResolvedValue(completeResult());
		render(
			<AiImagePanel
				jobClient={fakeJobClient(run)}
				getLayerContext={ARTBOARD_WITH_IMAGE}
			/>,
		);

		fireEvent.click(screen.getByTestId("ai-image-op-generative-expand"));
		fireEvent.change(screen.getByTestId("ai-image-source"), {
			target: { value: "src-1" },
		});
		fireEvent.change(screen.getByTestId("ai-image-target-width"), {
			target: { value: "1600" },
		});
		fireEvent.change(screen.getByTestId("ai-image-target-height"), {
			target: { value: "900" },
		});
		await act(async () => {
			fireEvent.click(screen.getByTestId("ai-image-run"));
		});
		await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({
			kind: "generative-expand",
			sourceAssetId: "src-1",
			targetWidth: 1600,
			targetHeight: 900,
		});
	});

	it("fills the prompt from an example without starting a job", () => {
		const run = vi.fn<AiImageJobRunner>();
		render(
			<AiImagePanel
				jobClient={fakeJobClient(run)}
				getLayerContext={ARTBOARD}
				examples={{ "text-to-image": ["A paper-cut sunrise"] }}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "A paper-cut sunrise" }),
		);
		expect(screen.getByTestId("ai-image-prompt")).toHaveValue(
			"A paper-cut sunrise",
		);
		expect(run).not.toHaveBeenCalled();
	});

	it("disables image-editing tasks with an actionable selection requirement", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={ARTBOARD} />,
		);

		expect(screen.getByTestId("ai-image-op-bg-remove")).toBeDisabled();
		expect(
			screen.getByTestId("ai-image-selection-requirement"),
		).toHaveTextContent("Select an image");
	});

	it("uses discovered provider capabilities and explains temporary unavailability", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_IMAGE}
				providerDescriptor={{
					providerId: "fixture",
					capabilities: [
						{ kind: "text-to-image", available: true },
						{
							kind: "generative-expand",
							available: false,
							unavailableReason: "Upgrade the provider plan to expand images.",
						},
					],
				}}
			/>,
		);

		expect(
			screen.queryByTestId("ai-image-op-bg-remove"),
		).not.toBeInTheDocument();
		expect(screen.getByTestId("ai-image-op-generative-expand")).toBeDisabled();
		expect(screen.getByTestId("ai-image-op-generative-expand")).toHaveAttribute(
			"title",
			"Upgrade the provider plan to expand images.",
		);
	});

	it("renders provider progress and supports retry after a terminal error", async () => {
		let attempts = 0;
		const run = vi.fn<AiImageJobRunner>(async (_request, _context, options) => {
			attempts += 1;
			options?.onProgress?.({
				phase: "processing",
				progress: 0.6,
				updatedAt: attempts,
			});
			if (attempts === 1) {
				return {
					jobId: "job-1",
					status: "error",
					startedAt: 0,
					error: {
						code: "RATE_LIMITED",
						message: "Try again shortly.",
						category: "rate-limit",
						retryable: true,
					},
				};
			}
			return completeResult("asset-retried");
		});
		render(
			<AiImagePanel
				jobClient={fakeJobClient(run)}
				getLayerContext={ARTBOARD}
			/>,
		);
		fireEvent.change(screen.getByTestId("ai-image-prompt"), {
			target: { value: "a cat" },
		});

		fireEvent.click(screen.getByTestId("ai-image-run"));
		await waitFor(() =>
			expect(screen.getByTestId("ai-image-retry")).toBeInTheDocument(),
		);
		expect(screen.getByTestId("ai-image-error")).toHaveTextContent(
			"RATE_LIMITED",
		);

		fireEvent.click(screen.getByTestId("ai-image-retry"));
		await waitFor(() =>
			expect(screen.getByTestId("ai-image-result")).toHaveTextContent(
				"asset-retried",
			),
		);
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe("AiImagePanel — design actions (FR-053, canvas-m4-004)", () => {
	const ARTBOARD_WITH_TEXT_NODE = () => ({
		artboardId: "art-1",
		selectedNodeId: "headline",
		selectedNodeKind: "text" as const,
	});

	function fakeDesignJobClient(
		run: AiDesignJobRunner = vi.fn(),
	): AiJobClient<
		Parameters<AiDesignJobRunner>[0],
		AiDesignJobResult,
		Parameters<AiDesignJobRunner>[1]
	> {
		return { run } as never;
	}

	it("hides the whole design-actions section when designJobClient is omitted", () => {
		render(
			<AiImagePanel jobClient={fakeJobClient()} getLayerContext={ARTBOARD} />,
		);
		expect(screen.queryByTestId("ai-design-actions")).toBeNull();
	});

	it("shows all three design actions by default (capabilities omitted, brandKit provided)", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_TEXT_NODE}
				designJobClient={fakeDesignJobClient()}
				brandKit={{
					id: "b1",
					name: "Acme",
					logos: [],
					colors: [],
					fonts: [],
					typography: [],
					rules: [],
				}}
			/>,
		);
		expect(screen.getByTestId("ai-design-actions")).toBeInTheDocument();
		expect(screen.getByTestId("ai-design-rewrite-run")).toBeInTheDocument();
		expect(screen.getByTestId("ai-design-layout-run")).toBeInTheDocument();
		expect(screen.getByTestId("ai-design-brand-run")).toBeInTheDocument();
	});

	it("hides apply-brand when no brandKit is supplied", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_TEXT_NODE}
				designJobClient={fakeDesignJobClient()}
			/>,
		);
		expect(screen.queryByTestId("ai-design-brand-run")).toBeNull();
	});

	it("hides rewrite-copy when the selection is a non-text node kind", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={() => ({
					artboardId: "art-1",
					selectedNodeId: "img-1",
					selectedNodeKind: "image",
				})}
				designJobClient={fakeDesignJobClient()}
			/>,
		);
		expect(screen.queryByTestId("ai-design-rewrite-run")).toBeNull();
		// generate-layout-variants doesn't depend on selection kind.
		expect(screen.getByTestId("ai-design-layout-run")).toBeInTheDocument();
	});

	it("only shows design ops in capabilities.designOps when set (FR-051)", () => {
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_TEXT_NODE}
				designJobClient={fakeDesignJobClient()}
				capabilities={{ designOps: ["rewrite-copy"] }}
			/>,
		);
		expect(screen.getByTestId("ai-design-rewrite-run")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-design-layout-run")).toBeNull();
	});

	it("dispatches a rewrite-copy request with the selected node id and instruction", async () => {
		const run = vi
			.fn<AiDesignJobRunner>()
			.mockResolvedValue(completeDesignResult());
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD_WITH_TEXT_NODE}
				designJobClient={fakeDesignJobClient(run)}
			/>,
		);
		fireEvent.change(screen.getByTestId("ai-design-rewrite-instruction"), {
			target: { value: "punchier" },
		});
		await act(async () => {
			fireEvent.click(screen.getByTestId("ai-design-rewrite-run"));
		});
		await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({
			kind: "rewrite-copy",
			nodeId: "headline",
			instruction: "punchier",
		});
	});

	it("dispatches a generate-layout-variants request with the current artboard as sourcePageId", async () => {
		const run = vi
			.fn<AiDesignJobRunner>()
			.mockResolvedValue(completeDesignResult());
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD}
				designJobClient={fakeDesignJobClient(run)}
			/>,
		);
		fireEvent.change(screen.getByTestId("ai-design-layout-count"), {
			target: { value: "3" },
		});
		await act(async () => {
			fireEvent.click(screen.getByTestId("ai-design-layout-run"));
		});
		await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({
			kind: "generate-layout-variants",
			sourcePageId: "art-1",
			count: 3,
		});
	});

	it("dispatches an apply-brand request with the supplied brand kit", async () => {
		const run = vi
			.fn<AiDesignJobRunner>()
			.mockResolvedValue(completeDesignResult());
		const brandKit = {
			id: "b1",
			name: "Acme",
			logos: [],
			colors: [],
			fonts: [],
			typography: [],
			rules: [],
		};
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD}
				designJobClient={fakeDesignJobClient(run)}
				brandKit={brandKit}
			/>,
		);
		await act(async () => {
			fireEvent.click(screen.getByTestId("ai-design-brand-run"));
		});
		await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({
			kind: "apply-brand",
			brandKit,
			targetPageId: "art-1",
		});
	});

	it("shows pending status and a working cancel button for a design job", async () => {
		let capturedSignal: AbortSignal | undefined;
		const run: AiDesignJobRunner = (_req, _ctx, options) => {
			capturedSignal = options?.signal;
			return new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		};
		render(
			<AiImagePanel
				jobClient={fakeJobClient()}
				getLayerContext={ARTBOARD}
				designJobClient={fakeDesignJobClient(run)}
			/>,
		);
		fireEvent.click(screen.getByTestId("ai-design-layout-run"));
		expect(screen.getByTestId("ai-design-status")).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByTestId("ai-design-cancel"));
		});
		await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
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

	it("forwards designJobClient/brandKit to the rendered AiImagePanel (FR-053, canvas-m4-004)", async () => {
		const { ctx, registerCopilotPanel } = makeCtx();
		const plugin = createAiImageSidebarPlugin({
			jobClient: fakeJobClient(),
			getLayerContext: () => ({ artboardId: "art-1" }),
			designJobClient: { run: vi.fn() } as never,
			brandKit: {
				id: "b1",
				name: "Acme",
				logos: [],
				colors: [],
				fonts: [],
				typography: [],
				rules: [],
			},
		});
		const registration = await plugin.register(ctx);
		await registration.hooks?.onInit?.(ctx);

		const panel = registerCopilotPanel.mock.calls[0]?.[0] as StudioCopilotPanel;
		render(panel.render());
		expect(screen.getByTestId("ai-design-actions")).toBeInTheDocument();
		expect(screen.getByTestId("ai-design-brand-run")).toBeInTheDocument();
	});
});
