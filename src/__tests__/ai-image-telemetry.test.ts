import { describe, expect, it, vi } from "vitest";
import { createAiImageTelemetry } from "../telemetry/ai-image-telemetry.js";

describe("AI image privacy-safe telemetry (E7-T6)", () => {
	it("captures task, duration, outcome, retry, and decision without content", () => {
		const emit = vi.fn();
		const telemetry = createAiImageTelemetry({ emit });
		telemetry.emit({
			name: "ai_image_task",
			phase: "finished",
			taskKind: "object-erase",
			timestamp: 20,
			durationMs: 15,
			outcome: "success",
			retryCount: 2,
		});
		telemetry.emit({
			name: "ai_image_task",
			phase: "decision",
			taskKind: "object-erase",
			timestamp: 22,
			durationMs: 17,
			decision: "discard",
			retryCount: 2,
		});

		expect(emit).toHaveBeenCalledTimes(2);
		expect(emit.mock.calls[0]?.[0]).toEqual({
			name: "ai_image_task",
			phase: "finished",
			taskKind: "object-erase",
			timestamp: 20,
			durationMs: 15,
			outcome: "success",
			retryCount: 2,
		});
	});

	it("drops prompt, media, asset, node, and document fields from untyped input", () => {
		const emit = vi.fn();
		const telemetry = createAiImageTelemetry({ emit });
		telemetry.emit({
			name: "ai_image_task",
			phase: "started",
			taskKind: "text-to-image",
			timestamp: 1,
			retryCount: 0,
			prompt: "private prompt",
			media: "data:image/png;base64,secret",
			assetId: "private-asset",
			nodeId: "private-node",
			documentId: "private-document",
		} as never);

		const serialized = JSON.stringify(emit.mock.calls[0]?.[0]);
		expect(serialized).not.toContain("private");
		expect(serialized).not.toContain("data:image");
	});

	it("rejects invalid durations before the sink sees them", () => {
		const emit = vi.fn();
		const telemetry = createAiImageTelemetry({ emit });
		expect(() =>
			telemetry.emit({
				name: "ai_image_task",
				phase: "finished",
				taskKind: "bg-remove",
				timestamp: 1,
				retryCount: 0,
				durationMs: -1,
				outcome: "error",
			}),
		).toThrow(/duration/);
		expect(emit).not.toHaveBeenCalled();
	});
});
