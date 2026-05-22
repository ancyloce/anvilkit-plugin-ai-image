/**
 * @file I1-9 `image.replace` commit wiring. The command itself already lives in
 * `@anvilkit/canvas-core` (`applyImageReplace`); this is the thin, dependency-clean
 * bridge a host/editor calls to swap a selected image node's asset through the
 * undoable command engine.
 *
 * The `commit` callback is injected — this package never depends on
 * `@anvilkit/canvas-editor`. The host wires it to the editor's history store,
 * e.g. `commit = (cmd) => historyStore.getState().commit(currentIr, cmd)`. Only
 * the command *type* is imported from canvas-core, so this module carries no
 * canvas-core runtime.
 */

import type { CanvasImageReplaceCommand } from "@anvilkit/canvas-core";

/**
 * Applies a canvas command, returning whatever the host's history store yields
 * (typically the next `CanvasIR`, or a `CommandApplyResult`). Injected so this
 * package stays free of `@anvilkit/canvas-editor`.
 */
export type CommitCanvasCommandFn<T = unknown> = (
	cmd: CanvasImageReplaceCommand,
) => T;

export interface CommitImageReplaceOptions<T = unknown> {
	/** Commits the built command through the host's history store. */
	commit: CommitCanvasCommandFn<T>;
	/** Id of the image node to replace. */
	nodeId: string;
	/** The node's current `assetId` (the engine asserts this still matches). */
	fromAssetId: string;
	/** The new `assetId` to point the node at. */
	toAssetId: string;
}

function assertNonEmpty(label: string, value: string): void {
	if (typeof value !== "string" || value.trim() === "") {
		throw new TypeError(
			`commitImageReplace: \`${label}\` must be a non-empty string.`,
		);
	}
}

/**
 * Build a `CanvasImageReplaceCommand` and commit it through the injected
 * `commit`, returning the commit's result. The canvas-core engine validates the
 * node kind + `fromAssetId` and produces the inverse, so this swap is undoable.
 */
export function commitImageReplace<T = unknown>(
	options: CommitImageReplaceOptions<T>,
): T {
	const { commit, nodeId, fromAssetId, toAssetId } = options;
	if (typeof commit !== "function") {
		throw new TypeError("commitImageReplace: `commit` must be a function.");
	}
	assertNonEmpty("nodeId", nodeId);
	assertNonEmpty("fromAssetId", fromAssetId);
	assertNonEmpty("toAssetId", toAssetId);

	const command: CanvasImageReplaceCommand = {
		type: "image.replace",
		nodeId,
		fromAssetId,
		toAssetId,
	};
	return commit(command);
}
