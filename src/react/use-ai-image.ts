"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	commitImageReplace,
	type CommitCanvasCommandFn,
} from "../commit/commit-image-replace.js";
import type {
	AiImageJobKind,
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
	options?: { signal?: AbortSignal },
) => Promise<AiImageJobResult>;

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
	readonly result: AiImageJobResult | null;
	readonly error: string | null;
	/** True when the active op's required fields are filled and a layer context exists. */
	readonly canRun: boolean;
	/** True when `getLayerContext()` currently yields no context. */
	readonly hasLayerContext: boolean;
	readonly onRun: () => void;
	readonly onCancel: () => void;
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
	const [result, setResult] = useState<AiImageJobResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const abortRef = useRef<AbortController | null>(null);

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
			run,
			getLayerContext,
			commit,
			postProcess,
		};
	}, [
		commit,
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

	let hasLayerContext = false;
	try {
		hasLayerContext = getLayerContext() !== null;
	} catch {
		hasLayerContext = false;
	}
	const canRun =
		status === "idle" &&
		hasLayerContext &&
		buildRequest(op, {
			prompt,
			negativePrompt,
			sourceAssetId,
			maskAssetId,
			targetWidth,
			targetHeight,
			seed,
		}) !== null;

	// `onRun` keeps stable `[]` deps via the `latest` ref; the msg resolver
	// rides along in a ref so error fallbacks localize without re-creating it.
	const msg = useMsg();
	const msgRef = useRef(msg);
	useEffect(() => {
		msgRef.current = msg;
	}, [msg]);

	const onCancel = useCallback((): void => {
		abortRef.current?.abort();
	}, []);

	const onRun = useCallback((): void => {
		const snapshot = latest.current;
		const request = buildRequest(snapshot.op, snapshot);
		if (request === null) {
			return;
		}
		const context = safeLayerContext();
		if (context === null) {
			setError(msgRef.current("aiImage.error.noContext"));
			return;
		}

		setError(null);
		setResult(null);
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
			.run(request, context, { signal: controller.signal })
			.then(async (next) => {
				if (abortRef.current !== controller) {
					return;
				}
				if (next.status === "cancelled") {
					// User-cancelled — leave the form intact, surface nothing.
					return;
				}
				setResult(next);
				if (next.status === "error") {
					setError(
						next.error?.message ?? msgRef.current("aiImage.error.jobFailed"),
					);
					return;
				}

				// Opt-in round-trip: for ops that target an existing node, commit
				// an `image.replace` swapping its asset for the (optionally
				// post-processed) result. No-op unless the host injected `commit`
				// and the layer context names a selected node.
				if (next.status !== "complete" || !next.resultAssetId) {
					return;
				}
				const commitFn = snapshot.commit;
				const sourceAssetId = requestSourceAssetId(request);
				const nodeId = context.selectedNodeId;
				if (!commitFn || sourceAssetId === null || !nodeId) {
					return;
				}
				try {
					let toAssetId = next.resultAssetId;
					if (snapshot.postProcess) {
						toAssetId = await snapshot.postProcess(next, request, context);
						if (abortRef.current !== controller) {
							return;
						}
					}
					await commitImageReplace({
						commit: commitFn,
						nodeId,
						fromAssetId: sourceAssetId,
						toAssetId,
					});
				} catch (err) {
					if (abortRef.current !== controller) {
						return;
					}
					setError(err instanceof Error ? err.message : String(err));
				}
			})
			.catch((err: unknown) => {
				if (abortRef.current !== controller) {
					return;
				}
				// An aborted run is a deliberate cancel, not an error.
				if (controller.signal.aborted) {
					return;
				}
				setError(err instanceof Error ? err.message : String(err));
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

	return {
		op,
		onOpChange: setOp,
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
		result,
		error,
		canRun,
		hasLayerContext,
		onRun,
		onCancel,
	};
}
