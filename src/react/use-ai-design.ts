"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { useCallback, useRef, useState } from "react";
import type { CommitAiDesignCommandFn } from "../commit/index.js";
import { commitAiDesignResult } from "../commit/index.js";
import type {
	AiDesignJobRequest,
	AiDesignJobResult,
	AiLayerContext,
} from "../types/index.js";

/**
 * A run-compatible design-job runner. `AiJobClient.run` (genericized in
 * canvas-m4-002) satisfies this signature.
 */
export type AiDesignJobRunner = (
	request: AiDesignJobRequest,
	context: AiLayerContext,
	options?: { signal?: AbortSignal },
) => Promise<AiDesignJobResult>;

export interface UseAiDesignOptions {
	/** Drives the job. Wire this to a design-typed `jobClient.run`. */
	readonly run: AiDesignJobRunner;
	/**
	 * Returns the live {@link AiLayerContext}, or `null` when there is
	 * nothing to operate on. Same contract as {@link useAiImage}'s option
	 * of the same name.
	 */
	readonly getLayerContext: () => AiLayerContext | null;
	/**
	 * Optional. When a job completes, its result is validated (canvas-m4-003's
	 * quarantine layer) and, only if valid, committed through the host's
	 * history store. Omitted means results are surfaced but never committed.
	 */
	readonly commit?: CommitAiDesignCommandFn;
}

export interface UseAiDesignResult {
	readonly status: "idle" | "pending";
	readonly result: AiDesignJobResult | null;
	readonly error: string | null;
	/** True when `getLayerContext()` currently yields no context. */
	readonly hasLayerContext: boolean;
	/** Submit a fully-built request. The caller (each action's own UI) constructs it. */
	readonly run: (request: AiDesignJobRequest) => void;
	readonly onCancel: () => void;
}

/**
 * Headless state container driving the FR-053 (canvas-m4-004) design
 * actions in {@link AiImagePanel} — rewrite selected text, generate layout
 * variants, apply brand kit via AI. Mirrors {@link useAiImage}'s
 * status/result/error/abort shape exactly, so job-status UX (pending,
 * cancel, error) behaves identically for design jobs; the one difference is
 * that each action builds its own {@link AiDesignJobRequest} externally and
 * passes it to `run`, since the three actions share no common field set the
 * way the five image ops do.
 */
export function useAiDesign(options: UseAiDesignOptions): UseAiDesignResult {
	const { run, getLayerContext, commit } = options;

	const [status, setStatus] = useState<"idle" | "pending">("idle");
	const [result, setResult] = useState<AiDesignJobResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const abortRef = useRef<AbortController | null>(null);

	const latest = useRef({ run, getLayerContext, commit });
	latest.current = { run, getLayerContext, commit };

	const safeLayerContext = (): AiLayerContext | null => {
		try {
			return latest.current.getLayerContext();
		} catch {
			return null;
		}
	};

	const hasLayerContext = safeLayerContext() !== null;

	const msg = useMsg();
	const msgRef = useRef(msg);
	msgRef.current = msg;

	const onCancel = useCallback((): void => {
		abortRef.current?.abort();
	}, []);

	const runRequest = useCallback((request: AiDesignJobRequest): void => {
		const snapshot = latest.current;
		const context = safeLayerContext();
		if (context === null) {
			setError(msgRef.current("aiImage.error.noContext"));
			return;
		}

		setError(null);
		setResult(null);
		setStatus("pending");

		// Supersede any in-flight run, mirroring `useAiImage`'s guard so a
		// superseded run can never write a stale result/error.
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
					return;
				}
				setResult(next);
				if (next.status === "error") {
					setError(
						next.error?.message ?? msgRef.current("aiImage.error.jobFailed"),
					);
					return;
				}

				const commitFn = snapshot.commit;
				if (!commitFn) return;
				const outcome = commitAiDesignResult({
					commit: commitFn,
					result: next,
				});
				if (!outcome.ok) {
					setError(outcome.error.message);
				}
			})
			.catch((err: unknown) => {
				if (abortRef.current !== controller) {
					return;
				}
				if (controller.signal.aborted) {
					return;
				}
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (abortRef.current === controller) {
					abortRef.current = null;
					setStatus("idle");
				}
			});
	}, []);

	return {
		status,
		result,
		error,
		hasLayerContext,
		run: runRequest,
		onCancel,
	};
}
