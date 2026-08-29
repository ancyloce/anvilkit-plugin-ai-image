"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type CommitCanvasCommandFn,
	commitImageReplace,
} from "../commit/commit-image-replace.js";
import type {
	AiImageCapability,
	AiImageJobError,
	AiImageJobKind,
	AiImageJobProgress,
	AiImageJobRequest,
	AiImageJobResult,
	AiLayerContext,
} from "../types/index.js";

/**
 * A run-compatible job runner. Both `AiJobClient.run` (which adds
 * abort + retry + status polling) and the headless
 * `AiImagePluginInstance.submit` satisfy this signature, so a host may
 * inject either. The hook stays agnostic — it only needs something that
 * turns a request + layer context into a result, honoring an
 * `AbortSignal`.
 */
export type AiImageJobRunner = (
	request: AiImageJobRequest,
	context: AiLayerContext,
	options?: {
		signal?: AbortSignal;
		onProgress?: (progress: AiImageJobProgress) => void;
	},
) => Promise<AiImageJobResult>;

export type AiImageApplyMode = "replace" | "insert-copy";

export interface AiImageResultPreview {
	readonly request: AiImageJobRequest;
	readonly context: AiLayerContext;
	readonly originalAssetId: string | null;
	readonly result: Extract<AiImageJobResult, { status: "complete" }>;
}

export interface UseAiImageOptions {
	/**
	 * Drives the job. Wire this to `jobClient.run` (recommended — keeps
	 * the I1-5 abort/retry/poll behavior) or to a headless
	 * `plugin.submit`.
	 */
	readonly run: AiImageJobRunner;
	/**
	 * Returns the live {@link AiLayerContext} for the active artboard /
	 * selection, or `null` when there is nothing to operate on. Injected
	 * by the host because this package must not depend on
	 * `@anvilkit/canvas-editor`; the closure reads the host's selection
	 * state without the panel subscribing to any editor store. May throw
	 * before the host has wired it (e.g. before `onInit`); the hook
	 * treats a throw the same as `null`.
	 */
	readonly getLayerContext: () => AiLayerContext | null;
	/** Op selected on first render. Defaults to `"text-to-image"`. */
	readonly defaultOp?: AiImageJobKind;
	/** Detailed provider availability and input constraints for the visible ops. */
	readonly capabilities?: readonly AiImageCapability[];
	/** Host application seam for explicit replace/insert-copy application. */
	readonly applyResult?: (
		preview: AiImageResultPreview,
		mode: AiImageApplyMode,
	) => Promise<void> | void;
	/**
	 * Optional. When a non-`text-to-image` job completes against the selected
	 * node, commit an `image.replace` through the host's history store. Injected
	 * because this package must not depend on `@anvilkit/canvas-editor`; wire it
	 * to e.g. `(cmd) => historyStore.getState().commit(currentIr, cmd)`. When
	 * omitted, results are surfaced but never committed (unchanged behavior).
	 */
	readonly commit?: CommitCanvasCommandFn;
	/**
	 * Optional. Transform a completed result into the final asset id to commit —
	 * e.g. run `createPostProcessPipeline` (validate / compress / thumbnail /
	 * register) and return the registered asset id. When omitted, the provider's
	 * `resultAssetId` is committed as-is.
	 */
	readonly postProcess?: (
		result: AiImageJobResult,
		request: AiImageJobRequest,
		context: AiLayerContext,
	) => Promise<string>;
}

export interface UseAiImageResult {
	readonly op: AiImageJobKind;
	readonly onOpChange: (op: AiImageJobKind) => void;
	readonly prompt: string;
	readonly onPromptChange: (next: string) => void;
	readonly negativePrompt: string;
	readonly onNegativePromptChange: (next: string) => void;
	readonly sourceAssetId: string;
	readonly onSourceAssetIdChange: (next: string) => void;
	readonly maskAssetId: string;
	readonly onMaskAssetIdChange: (next: string) => void;
	/** `generative-expand` only. Kept as raw strings; parsed when the request is built. */
	readonly targetWidth: string;
	readonly onTargetWidthChange: (next: string) => void;
	readonly targetHeight: string;
	readonly onTargetHeightChange: (next: string) => void;
	/** Optional seed, kept as a raw string; parsed when the request is built. */
	readonly seed: string;
	readonly onSeedChange: (next: string) => void;
	readonly status: "idle" | "pending";
	readonly applyStatus: "idle" | "applying";
	readonly progress: AiImageJobProgress | null;
	readonly result: AiImageJobResult | null;
	readonly preview: AiImageResultPreview | null;
	readonly error: string | null;
	readonly jobError: AiImageJobError | null;
	/** True when the active op's required fields are filled and a layer context exists. */
	readonly canRun: boolean;
	/** Actionable explanation for a disabled Run control. */
	readonly runDisabledReason: string | null;
	readonly canRetry: boolean;
	readonly canReplace: boolean;
	readonly canInsertCopy: boolean;
	/** True when `getLayerContext()` currently yields no context. */
	readonly hasLayerContext: boolean;
	readonly onRun: () => void;
	readonly onRetry: () => void;
	readonly onCancel: () => void;
	readonly onApply: (mode: AiImageApplyMode) => void;
	readonly onDiscard: () => void;
}

interface AiImageFields {
	readonly prompt: string;
	readonly negativePrompt: string;
	readonly sourceAssetId: string;
	readonly maskAssetId: string;
	readonly targetWidth: string;
	readonly targetHeight: string;
	readonly seed: string;
}

/** Parse the raw seed string into a finite integer, or `undefined`. */
function parseSeed(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return undefined;
	}
	const value = Number(trimmed);
	// Seeds are conventionally integers; `Number.isInteger` also rejects
	// NaN / Infinity, so a non-numeric or fractional seed is dropped.
	return Number.isInteger(value) ? value : undefined;
}

/** Parse a raw dimension string into a positive integer, or `undefined`. */
function parseDimension(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return undefined;
	}
	const value = Number(trimmed);
	return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Assemble a typed {@link AiImageJobRequest} from the active op + fields,
 * or `null` when a required field for that op is empty. Pure, so it
 * doubles as the `canRun` validator.
 */
function buildRequest(
	op: AiImageJobKind,
	fields: AiImageFields,
): AiImageJobRequest | null {
	const prompt = fields.prompt.trim();
	const source = fields.sourceAssetId.trim();
	const mask = fields.maskAssetId.trim();
	const seed = parseSeed(fields.seed);
	switch (op) {
		case "text-to-image": {
			if (prompt === "") {
				return null;
			}
			const negative = fields.negativePrompt.trim();
			return {
				kind: "text-to-image",
				prompt,
				...(negative === "" ? {} : { negativePrompt: negative }),
				...(seed === undefined ? {} : { seed }),
			};
		}
		case "variation": {
			if (source === "") {
				return null;
			}
			return {
				kind: "variation",
				sourceAssetId: source,
				...(seed === undefined ? {} : { seed }),
			};
		}
		case "inpaint": {
			if (source === "" || mask === "" || prompt === "") {
				return null;
			}
			return {
				kind: "inpaint",
				sourceAssetId: source,
				maskAssetId: mask,
				prompt,
				...(seed === undefined ? {} : { seed }),
			};
		}
		case "bg-remove": {
			if (source === "") {
				return null;
			}
			return { kind: "bg-remove", sourceAssetId: source };
		}
		case "upscale": {
			if (source === "") {
				return null;
			}
			return { kind: "upscale", sourceAssetId: source };
		}
		case "generative-fill": {
			if (source === "" || mask === "" || prompt === "") {
				return null;
			}
			return {
				kind: "generative-fill",
				sourceAssetId: source,
				maskAssetId: mask,
				prompt,
				...(seed === undefined ? {} : { seed }),
			};
		}
		case "generative-expand": {
			const width = parseDimension(fields.targetWidth);
			const height = parseDimension(fields.targetHeight);
			if (source === "" || width === undefined || height === undefined) {
				return null;
			}
			return {
				kind: "generative-expand",
				sourceAssetId: source,
				targetWidth: width,
				targetHeight: height,
				...(prompt === "" ? {} : { prompt }),
			};
		}
		case "object-erase": {
			if (source === "" || mask === "") {
				return null;
			}
			return { kind: "object-erase", sourceAssetId: source, maskAssetId: mask };
		}
		case "background-replace": {
			if (source === "" || prompt === "") {
				return null;
			}
			return {
				kind: "background-replace",
				sourceAssetId: source,
				prompt,
				...(seed === undefined ? {} : { seed }),
			};
		}
		default:
			return null;
	}
}

/**
 * The asset a job operates on, or `null` for `text-to-image` (which has no
 * existing node to replace — placement is the editor's concern).
 */
function requestSourceAssetId(request: AiImageJobRequest): string | null {
	switch (request.kind) {
		case "variation":
		case "inpaint":
		case "bg-remove":
		case "upscale":
		case "generative-fill":
		case "generative-expand":
		case "object-erase":
		case "background-replace":
			return request.sourceAssetId;
		default:
			return null;
	}
}

/**
 * Headless state container for {@link AiImagePanel}.
 *
 * Owns the op selection, the per-op input fields, the pending status,
 * and the last result / error for a single AI-image surface. Translates
 * the panel's Run/Cancel into a `run(request, context, { signal })`
 * call with an {@link AbortController}, mirroring the
 * `.then/.catch/.finally` shape of `useAiCopilot`.
 */
export function useAiImage(options: UseAiImageOptions): UseAiImageResult {
	const {
		run,
		getLayerContext,
		defaultOp = "text-to-image",
		capabilities,
		applyResult,
		commit,
		postProcess,
	} = options;

	const [op, setOp] = useState<AiImageJobKind>(defaultOp);
	const [prompt, setPrompt] = useState("");
	const [negativePrompt, setNegativePrompt] = useState("");
	const [sourceAssetId, setSourceAssetId] = useState("");
	const [maskAssetId, setMaskAssetId] = useState("");
	const [targetWidth, setTargetWidth] = useState("");
	const [targetHeight, setTargetHeight] = useState("");
	const [seed, setSeed] = useState("");
	const [status, setStatus] = useState<"idle" | "pending">("idle");
	const [applyStatus, setApplyStatus] = useState<"idle" | "applying">("idle");
	const [progress, setProgress] = useState<AiImageJobProgress | null>(null);
	const [result, setResult] = useState<AiImageJobResult | null>(null);
	const [preview, setPreview] = useState<AiImageResultPreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [jobError, setJobError] = useState<AiImageJobError | null>(null);

	const abortRef = useRef<AbortController | null>(null);
	const previewRef = useRef<AiImageResultPreview | null>(null);

	// Keep the latest inputs + injected callbacks in a ref so `onRun` is
	// referentially stable and never reads a stale closure, regardless of
	// whether the host passes inline `run` / `getLayerContext`.
	const latest = useRef({
		op,
		prompt,
		negativePrompt,
		sourceAssetId,
		maskAssetId,
		targetWidth,
		targetHeight,
		seed,
		capabilities,
		applyResult,
		run,
		getLayerContext,
		commit,
		postProcess,
	});
	useEffect(() => {
		latest.current = {
			op,
			prompt,
			negativePrompt,
			sourceAssetId,
			maskAssetId,
			targetWidth,
			targetHeight,
			seed,
			capabilities,
			applyResult,
			run,
			getLayerContext,
			commit,
			postProcess,
		};
	}, [
		commit,
		capabilities,
		applyResult,
		getLayerContext,
		maskAssetId,
		negativePrompt,
		op,
		postProcess,
		prompt,
		run,
		seed,
		sourceAssetId,
		targetHeight,
		targetWidth,
	]);

	// Resolve the layer context defensively: a host may inject a getter
	// that throws before it is wired (the default factory does). A throw
	// is treated the same as "no context".
	const safeLayerContext = (): AiLayerContext | null => {
		try {
			return latest.current.getLayerContext();
		} catch {
			return null;
		}
	};

	let layerContext: AiLayerContext | null = null;
	try {
		layerContext = getLayerContext();
	} catch {
		layerContext = null;
	}
	const hasLayerContext = layerContext !== null;
	const request = buildRequest(op, {
		prompt,
		negativePrompt,
		sourceAssetId: sourceAssetId || layerContext?.selectedAssetId || "",
		maskAssetId,
		targetWidth,
		targetHeight,
		seed,
	});

	// `onRun` keeps stable `[]` deps via the `latest` ref; the msg resolver
	// rides along in a ref so error fallbacks localize without re-creating it.
	const msg = useMsg();
	const msgRef = useRef(msg);
	useEffect(() => {
		msgRef.current = msg;
	}, [msg]);

	const capability = capabilities?.find(({ kind }) => kind === op);
	const imageSelectionRequired = op !== "text-to-image";
	const runDisabledReason = (() => {
		if (status === "pending") {
			return msg("aiImage.requirement.pending", "Wait for the current job.");
		}
		if (!layerContext) {
			return msg("aiImage.panel.noContext", "Open a canvas page to continue.");
		}
		if (capability && !capability.available) {
			return (
				capability.unavailableReason ??
				msg(
					"aiImage.requirement.providerUnavailable",
					"This provider does not currently support the selected task.",
				)
			);
		}
		if (
			imageSelectionRequired &&
			(!layerContext.selectedNodeId ||
				(layerContext.selectedNodeKind !== undefined &&
					layerContext.selectedNodeKind !== "image"))
		) {
			return msg(
				"aiImage.requirement.imageSelection",
				"Select an image on the active page to use this task.",
			);
		}
		const maxPromptCharacters = capability?.constraints?.maxPromptCharacters;
		if (
			maxPromptCharacters !== undefined &&
			prompt.length > maxPromptCharacters
		) {
			return `Prompt must be ${maxPromptCharacters} characters or fewer.`;
		}
		if (!request) {
			return msg(
				"aiImage.requirement.inputs",
				"Complete the required inputs for this task.",
			);
		}
		return null;
	})();
	const canRun = runDisabledReason === null && applyStatus === "idle";
	const canRetry = status === "idle" && error !== null;
	const canReplace =
		preview !== null &&
		applyStatus === "idle" &&
		(Boolean(applyResult) ||
			(Boolean(commit) &&
				preview.originalAssetId !== null &&
				Boolean(preview.context.selectedNodeId)));
	const canInsertCopy =
		preview !== null && applyStatus === "idle" && Boolean(applyResult);

	const onCancel = useCallback((): void => {
		abortRef.current?.abort();
	}, []);

	const onRun = useCallback((): void => {
		const snapshot = latest.current;
		const context = safeLayerContext();
		if (context === null) {
			setError(msgRef.current("aiImage.error.noContext"));
			return;
		}
		const request = buildRequest(snapshot.op, {
			...snapshot,
			sourceAssetId: snapshot.sourceAssetId || context.selectedAssetId || "",
		});
		if (request === null) {
			return;
		}

		setError(null);
		setJobError(null);
		setResult(null);
		setPreview(null);
		previewRef.current = null;
		setProgress(null);
		setStatus("pending");

		// Supersede any in-flight run: abort it, then take ownership of
		// `abortRef`. Every completion handler below is gated on
		// `abortRef.current === controller`, so a superseded run can never
		// write a stale result/error or flip `status` to idle while a
		// newer run is still pending.
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		snapshot
			.run(request, context, {
				signal: controller.signal,
				onProgress: (nextProgress) => {
					if (abortRef.current === controller) {
						setProgress(nextProgress);
					}
				},
			})
			.then(async (next) => {
				if (abortRef.current !== controller) {
					return;
				}
				if (next.status === "cancelled") {
					// User-cancelled — leave the form intact, surface nothing.
					setProgress(null);
					return;
				}
				setResult(next);
				if (next.status === "error") {
					setJobError(next.error);
					setError(
						next.error?.message ?? msgRef.current("aiImage.error.jobFailed"),
					);
					return;
				}

				if (next.status !== "complete" || !next.resultAssetId) {
					return;
				}
				const nextPreview: AiImageResultPreview = {
					request,
					context,
					originalAssetId: requestSourceAssetId(request),
					result: next,
				};
				previewRef.current = nextPreview;
				setPreview(nextPreview);
			})
			.catch((err: unknown) => {
				if (abortRef.current !== controller) {
					return;
				}
				// An aborted run is a deliberate cancel, not an error.
				if (controller.signal.aborted) {
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				setJobError({
					code: "UNEXPECTED_PROVIDER_ERROR",
					message,
					category: "unknown",
					retryable: true,
				});
				setError(message);
			})
			.finally(() => {
				// Only the still-current run resets the shared status; a
				// superseded run leaves `pending` in place for its successor.
				if (abortRef.current === controller) {
					abortRef.current = null;
					setStatus("idle");
				}
			});
		// `latest` ref makes every dependency stable; intentionally `[]`.
	}, []);
	const onRetry = onRun;
	const onApply = useCallback((mode: AiImageApplyMode): void => {
		const currentPreview = previewRef.current;
		if (!currentPreview) return;
		const snapshot = latest.current;
		const apply = async (): Promise<void> => {
			if (snapshot.applyResult) {
				await snapshot.applyResult(currentPreview, mode);
				return;
			}
			if (mode !== "replace") {
				throw new Error("Insert copy requires an applyResult host adapter.");
			}
			const nodeId = currentPreview.context.selectedNodeId;
			const fromAssetId = currentPreview.originalAssetId;
			if (!snapshot.commit || !nodeId || !fromAssetId) {
				throw new Error("Replace requires a selected image and commit adapter.");
			}
			let toAssetId = currentPreview.result.resultAssetId;
			if (snapshot.postProcess) {
				toAssetId = await snapshot.postProcess(
					currentPreview.result,
					currentPreview.request,
					currentPreview.context,
				);
			}
			await commitImageReplace({
				commit: snapshot.commit,
				nodeId,
				fromAssetId,
				toAssetId,
			});
		};

		setApplyStatus("applying");
		setError(null);
		void apply()
			.then(() => {
				previewRef.current = null;
				setPreview(null);
				setResult(null);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => setApplyStatus("idle"));
	}, []);
	const onDiscard = useCallback((): void => {
		previewRef.current = null;
		setPreview(null);
		setResult(null);
		setError(null);
		setJobError(null);
	}, []);
	const onOpChange = useCallback((next: AiImageJobKind): void => {
		setOp(next);
		setError(null);
		setJobError(null);
		setResult(null);
		setPreview(null);
		previewRef.current = null;
		setProgress(null);
	}, []);

	return {
		op,
		onOpChange,
		prompt,
		onPromptChange: setPrompt,
		negativePrompt,
		onNegativePromptChange: setNegativePrompt,
		sourceAssetId,
		onSourceAssetIdChange: setSourceAssetId,
		maskAssetId,
		onMaskAssetIdChange: setMaskAssetId,
		targetWidth,
		onTargetWidthChange: setTargetWidth,
		targetHeight,
		onTargetHeightChange: setTargetHeight,
		seed,
		onSeedChange: setSeed,
		status,
		applyStatus,
		progress,
		result,
		preview,
		error,
		jobError,
		canRun,
		runDisabledReason,
		canRetry,
		canReplace,
		canInsertCopy,
		hasLayerContext,
		onRun,
		onRetry,
		onCancel,
		onApply,
		onDiscard,
	};
}
