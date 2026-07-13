/**
 * @file FR-052 (canvas-m4-003) commit wiring for design-level AI jobs. The
 * validation/quarantine logic itself lives in `@anvilkit/canvas-core`
 * (`validateAiDesignJobResult`); this is the thin, dependency-clean bridge a
 * host/editor calls to turn a design job's *result* into an actual document
 * change through the undoable command engine — validating first, so a failed
 * or malformed result never reaches `commit`.
 *
 * The `commit` callback is injected — this package never depends on
 * `@anvilkit/canvas-editor`. Mirrors `commit-image-replace.ts`'s pattern.
 */

import type {
	AiDesignJobResult,
	AiDesignQuarantineError,
	CanvasBatchCommand,
} from "@anvilkit/canvas-core";
import { validateAiDesignJobResult } from "@anvilkit/canvas-core";

/**
 * Commits a canvas command, returning whatever the host's history store
 * yields (typically the next `CanvasIR`, or a `CommandApplyResult`).
 * Injected so this package stays free of `@anvilkit/canvas-editor`.
 */
export type CommitAiDesignCommandFn<T = unknown> = (
	cmd: CanvasBatchCommand,
) => T;

export interface CommitAiDesignResultOptions<T = unknown> {
	/** Commits the validated command through the host's history store. */
	commit: CommitAiDesignCommandFn<T>;
	/** The design job's terminal result. */
	result: AiDesignJobResult;
}

export type CommitAiDesignResultOutcome<T = unknown> =
	| { ok: true; committed: T }
	| { ok: false; error: AiDesignQuarantineError };

/**
 * Validates `result` (canvas-m4-003's quarantine layer) and, only if it
 * passes, commits the normalized batch command through the injected
 * `commit`. A non-`"complete"` job or an invalid payload never reaches
 * `commit` at all — the caller gets a structured `error` back instead.
 */
export function commitAiDesignResult<T = unknown>(
	options: CommitAiDesignResultOptions<T>,
): CommitAiDesignResultOutcome<T> {
	const { commit, result } = options;
	if (typeof commit !== "function") {
		throw new TypeError("commitAiDesignResult: `commit` must be a function.");
	}

	const outcome = validateAiDesignJobResult(result);
	if (!outcome.ok) {
		return { ok: false, error: outcome.error };
	}
	return { ok: true, committed: commit(outcome.command) };
}
