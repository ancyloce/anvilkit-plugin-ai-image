import type {
	AiImageJobErrorCategory,
	AiImageJobKind,
} from "../types/index.js";

export type AiImageTelemetryPhase = "started" | "finished" | "decision";
export type AiImageTelemetryOutcome =
	| "success"
	| "error"
	| "cancelled"
	| "policy-blocked"
	| "offline"
	| "permission-denied";
export type AiImageTelemetryDecision = "replace" | "insert-copy" | "discard";

/** Content-free by construction: no prompt, media, asset, node, or document fields. */
export interface AiImageTelemetryEvent {
	readonly name: "ai_image_task";
	readonly phase: AiImageTelemetryPhase;
	readonly taskKind: AiImageJobKind;
	readonly timestamp: number;
	readonly retryCount: number;
	readonly durationMs?: number;
	readonly outcome?: AiImageTelemetryOutcome;
	readonly decision?: AiImageTelemetryDecision;
	readonly errorCategory?: AiImageJobErrorCategory;
}

export interface AiImageTelemetrySink {
	emit(event: AiImageTelemetryEvent): void;
}

export interface AiImageTelemetry {
	emit(event: AiImageTelemetryEvent): void;
}

/**
 * Runtime allow-list complementing the content-free TypeScript contract. Even
 * an untyped caller cannot smuggle prompts or media into the host sink.
 */
export function createAiImageTelemetry(
	sink: AiImageTelemetrySink,
): AiImageTelemetry {
	return {
		emit(event) {
			if (!Number.isFinite(event.timestamp) || event.retryCount < 0) {
				throw new TypeError(
					"AI image telemetry timestamps and retries must be valid.",
				);
			}
			if (
				event.durationMs !== undefined &&
				(!Number.isFinite(event.durationMs) || event.durationMs < 0)
			) {
				throw new TypeError(
					"AI image telemetry duration must be non-negative.",
				);
			}
			sink.emit({
				name: "ai_image_task",
				phase: event.phase,
				taskKind: event.taskKind,
				timestamp: event.timestamp,
				retryCount: event.retryCount,
				...(event.durationMs !== undefined
					? { durationMs: event.durationMs }
					: {}),
				...(event.outcome ? { outcome: event.outcome } : {}),
				...(event.decision ? { decision: event.decision } : {}),
				...(event.errorCategory ? { errorCategory: event.errorCategory } : {}),
			});
		},
	};
}
