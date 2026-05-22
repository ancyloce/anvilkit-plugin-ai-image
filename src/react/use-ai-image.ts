"use client";

import { useCallback, useRef, useState } from "react";

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
	const { run, getLayerContext, defaultOp = "text-to-image" } = options;

	const [op, setOp] = useState<AiImageJobKind>(defaultOp);
	const [prompt, setPrompt] = useState("");
	const [negativePrompt, setNegativePrompt] = useState("");
	const [sourceAssetId, setSourceAssetId] = useState("");
	const [maskAssetId, setMaskAssetId] = useState("");
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
		seed,
		run,
		getLayerContext,
	});
	latest.current = {
		op,
		prompt,
		negativePrompt,
		sourceAssetId,
		maskAssetId,
		seed,
		run,
		getLayerContext,
	};

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

	const hasLayerContext = safeLayerContext() !== null;
	const canRun =
		status === "idle" &&
		hasLayerContext &&
		buildRequest(op, {
			prompt,
			negativePrompt,
			sourceAssetId,
			maskAssetId,
			seed,
		}) !== null;

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
			setError("No active artboard or selection to run against.");
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
			.then((next) => {
				if (abortRef.current !== controller) {
					return;
				}
				if (next.status === "cancelled") {
					// User-cancelled — leave the form intact, surface nothing.
					return;
				}
				setResult(next);
				if (next.status === "error") {
					setError(next.error?.message ?? "AI image job failed.");
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
