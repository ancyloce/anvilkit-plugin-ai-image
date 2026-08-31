import { describe, expect, it, vi } from "vitest";
import {
	createAiImageJobSessionCoordinator,
	createMemoryAiImageJobSessionPersistence,
	createStorageAiImageJobSessionPersistence,
} from "../job/ai-image-job-session.js";
import type { AiImageJobResult } from "../types/index.js";

const request = { kind: "text-to-image", prompt: "a cat" } as const;
const context = { artboardId: "page-1" } as const;
const complete = (assetId = "result-1"): AiImageJobResult => ({
	jobId: "job-1",
	status: "complete",
	resultAssetId: assetId,
	startedAt: 0,
	finishedAt: 1,
});

describe("AI image job persistence and recovery (E7-T5)", () => {
	it("keeps a live job running while every panel subscriber is closed", () => {
		const coordinator = createAiImageJobSessionCoordinator({ now: () => 10 });
		const controller = new AbortController();
		const unsubscribe = coordinator.subscribe("doc-a", vi.fn());
		coordinator.begin({
			documentId: "doc-a",
			request,
			context,
			controller,
		});
		unsubscribe();

		expect(coordinator.get("doc-a")?.status).toBe("pending");
		expect(controller.signal.aborted).toBe(false);
		coordinator.settle("doc-a", complete());
		expect(coordinator.get("doc-a")?.status).toBe("complete");
	});

	it("isolates jobs by document when users switch documents", () => {
		const coordinator = createAiImageJobSessionCoordinator();
		const a = new AbortController();
		const b = new AbortController();
		coordinator.begin({ documentId: "doc-a", request, context, controller: a });
		coordinator.begin({ documentId: "doc-b", request, context, controller: b });

		coordinator.cancel("doc-b");
		expect(coordinator.get("doc-a")?.status).toBe("pending");
		expect(a.signal.aborted).toBe(false);
		expect(coordinator.get("doc-b")?.status).toBe("cancelled");
		expect(b.signal.aborted).toBe(true);
	});

	it("recovers completed work after reload and marks live-only work interrupted", () => {
		const persistence = createMemoryAiImageJobSessionPersistence();
		const beforeReload = createAiImageJobSessionCoordinator({
			persistence,
			now: () => 1,
		});
		beforeReload.begin({
			documentId: "pending-doc",
			request,
			context,
			controller: new AbortController(),
		});
		beforeReload.begin({
			documentId: "complete-doc",
			request,
			context,
			controller: new AbortController(),
		});
		beforeReload.settle("complete-doc", complete("ready-asset"));

		const afterReload = createAiImageJobSessionCoordinator({
			persistence,
			now: () => 2,
		});
		expect(afterReload.recover("pending-doc")).toMatchObject({
			status: "interrupted",
			error: { code: "RELOAD_INTERRUPTED", retryable: true },
		});
		expect(afterReload.recover("complete-doc")).toMatchObject({
			status: "complete",
			result: { resultAssetId: "ready-asset" },
		});
	});

	it("moves a network job to an offline retry state exactly once", () => {
		const coordinator = createAiImageJobSessionCoordinator();
		const controller = new AbortController();
		const abort = vi.spyOn(controller, "abort");
		coordinator.begin({
			documentId: "doc-a",
			request,
			context,
			controller,
			requiresNetwork: true,
		});

		coordinator.setOnline("doc-a", false);
		coordinator.setOnline("doc-a", false);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(coordinator.get("doc-a")).toMatchObject({
			status: "offline",
			error: { code: "OFFLINE", retryable: true },
		});
		coordinator.settle("doc-a", complete("late-result"));
		expect(coordinator.get("doc-a")?.status).toBe("offline");
	});

	it("revokes pending and completed results when permissions change", () => {
		const coordinator = createAiImageJobSessionCoordinator();
		const pendingController = new AbortController();
		coordinator.begin({
			documentId: "pending-doc",
			request,
			context,
			controller: pendingController,
		});
		coordinator.setPermission("pending-doc", false);
		expect(pendingController.signal.aborted).toBe(true);
		expect(coordinator.get("pending-doc")?.status).toBe("permission-denied");

		coordinator.begin({
			documentId: "complete-doc",
			request,
			context,
			controller: new AbortController(),
		});
		coordinator.settle("complete-doc", complete());
		coordinator.setPermission("complete-doc", false);
		expect(coordinator.get("complete-doc")).toMatchObject({
			status: "permission-denied",
			result: undefined,
			error: { code: "PERMISSION_REVOKED" },
		});
	});

	it("makes cancellation idempotent and ignores a late provider result", () => {
		const coordinator = createAiImageJobSessionCoordinator();
		const controller = new AbortController();
		const abort = vi.spyOn(controller, "abort");
		coordinator.begin({
			documentId: "doc-a",
			request,
			context,
			controller,
		});
		coordinator.cancel("doc-a");
		coordinator.cancel("doc-a");
		coordinator.settle("doc-a", complete("late-result"));

		expect(abort).toHaveBeenCalledTimes(1);
		expect(coordinator.get("doc-a")?.status).toBe("cancelled");
		expect(coordinator.get("doc-a")?.result).toBeUndefined();
	});

	it("never writes raw prompts, progress text, or provider asset ids to storage", () => {
		const records = new Map<string, string>();
		const persistence = createStorageAiImageJobSessionPersistence({
			storage: {
				getItem: (key) => records.get(key) ?? null,
				setItem: (key, value) => records.set(key, value),
				removeItem: (key) => records.delete(key),
			},
		});
		const coordinator = createAiImageJobSessionCoordinator({ persistence });
		coordinator.begin({
			documentId: "private-doc",
			request: {
				kind: "text-to-image",
				prompt: "confidential launch artwork",
				negativePrompt: "internal watermark",
			},
			context,
			controller: new AbortController(),
		});
		coordinator.progress("private-doc", {
			phase: "processing",
			progress: 0.5,
			message: "working on confidential launch artwork",
			updatedAt: 1,
		});
		coordinator.settle("private-doc", {
			...complete(),
			metadata: {
				providerAssetId: "provider-secret-id",
				safety: { status: "approved" },
			},
		});

		const serialized = [...records.values()].join("\n");
		expect(serialized).not.toContain("confidential launch artwork");
		expect(serialized).not.toContain("internal watermark");
		expect(serialized).not.toContain("provider-secret-id");
		expect(serialized).toContain('"inputsRedacted":true');
	});

	it("redacts in-memory prompts when the host retention deadline elapses", () => {
		vi.useFakeTimers();
		try {
			const coordinator = createAiImageJobSessionCoordinator({
				promptRetentionMs: 500,
			});
			coordinator.begin({
				documentId: "private-doc",
				request,
				context,
				controller: new AbortController(),
			});
			expect(coordinator.get("private-doc")?.request).toEqual(request);

			vi.advanceTimersByTime(500);
			expect(coordinator.get("private-doc")).toMatchObject({
				inputsRedacted: true,
				request: { kind: "text-to-image", prompt: "" },
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
