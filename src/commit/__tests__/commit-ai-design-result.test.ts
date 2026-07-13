import {
	type AiDesignJobResult,
	applyCommand,
	type CanvasBatchCommand,
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { commitAiDesignResult } from "../commit-ai-design-result.js";

const FIXED_TS = "2026-05-21T00:00:00.000Z";
const now = () => FIXED_TS;

function buildFixture(): CanvasIR {
	const text = createText({
		id: "headline",
		bounds: { width: 200, height: 40 },
		text: "Original",
	});
	const page = createPage({ id: "page-1" });
	page.root = createGroup({
		id: "page-1-root",
		bounds: page.root.bounds,
		children: [text],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now });
}

function completeResult(command: CanvasBatchCommand): AiDesignJobResult {
	return {
		jobId: "job-1",
		status: "complete",
		payload: { kind: "command", command },
		startedAt: 0,
		finishedAt: 1,
	};
}

describe("commitAiDesignResult", () => {
	it("validates and commits a well-formed result", () => {
		const ir = buildFixture();
		const commit = vi.fn((cmd: CanvasBatchCommand) =>
			applyCommand(ir, cmd, { now }),
		);
		const result = completeResult({
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

		const outcome = commitAiDesignResult({ commit, result });

		expect(outcome.ok).toBe(true);
		expect(commit).toHaveBeenCalledTimes(1);
		if (!outcome.ok) throw new Error("expected success");
		const updated = outcome.committed.ir.pages[0]?.root.children.find(
			(n) => n.id === "headline",
		);
		expect(updated).toMatchObject({ text: "Rewritten" });
	});

	it("does not call commit for a non-complete job", () => {
		const commit = vi.fn();
		const outcome = commitAiDesignResult({
			commit,
			result: {
				jobId: "job-1",
				status: "error",
				error: { code: "PROVIDER_TIMEOUT", message: "timed out" },
				startedAt: 0,
			},
		});

		expect(outcome.ok).toBe(false);
		expect(commit).not.toHaveBeenCalled();
		if (outcome.ok) throw new Error("expected quarantine");
		expect(outcome.error.code).toBe("job-not-complete");
	});

	it("does not call commit for a payload with an invalid node", () => {
		const commit = vi.fn();
		const result = completeResult({
			type: "batch",
			commands: [
				{
					type: "node.create",
					parentId: "root",
					node: {
						id: "hallucinated",
						// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid to prove quarantine
						type: "made-up-kind" as any,
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 10, height: 10 },
						zIndex: 0,
					},
				},
			],
		});

		const outcome = commitAiDesignResult({ commit, result });

		expect(outcome.ok).toBe(false);
		expect(commit).not.toHaveBeenCalled();
		if (outcome.ok) throw new Error("expected quarantine");
		expect(outcome.error.code).toBe("invalid-payload");
	});

	it("rejects a non-function commit", () => {
		expect(() =>
			commitAiDesignResult({
				commit: undefined as never,
				result: completeResult({ type: "batch", commands: [] }),
			}),
		).toThrow(TypeError);
	});

	it("failed-job invariant (canvas-m4-005 rollup): a deliberately-failed job leaves the document byte-identical", () => {
		const ir = buildFixture();
		const before = structuredClone(ir);
		const commit = vi.fn((cmd: CanvasBatchCommand) =>
			applyCommand(ir, cmd, { now }),
		);

		// A mock provider failure — the exact scenario the rollup's failed-job
		// invariant names: "a deliberately-failed job (mock provider error)".
		const outcome = commitAiDesignResult({
			commit,
			result: {
				jobId: "job-failed",
				status: "error",
				error: { code: "MOCK_PROVIDER_ERROR", message: "simulated failure" },
				startedAt: 0,
				finishedAt: 1,
			},
		});

		expect(outcome.ok).toBe(false);
		expect(commit).not.toHaveBeenCalled();
		// `ir` was never touched — not merely "commit wasn't called", but the
		// live document object is provably unchanged.
		expect(ir).toEqual(before);
	});
});
