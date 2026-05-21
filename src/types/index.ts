import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImageProvider,
	AiLayerContext,
} from "@anvilkit/canvas-core";

export type {
	AiImageBgRemoveRequest,
	AiImageInpaintRequest,
	AiImageJobError,
	AiImageJobKind,
	AiImageJobRequest,
	AiImageJobResult,
	AiImageJobStatus,
	AiImageProvider,
	AiImageProviderOptions,
	AiImageTextToImageRequest,
	AiImageVariationRequest,
	AiLayerBounds,
	AiLayerContext,
} from "@anvilkit/canvas-core";
export type {
	AiJobClient,
	AiJobClientOptions,
	AiJobPollFn,
	AiJobRunOptions,
} from "../job/ai-job-client.js";
export type { RetryOptions } from "../job/retry.js";

export interface AiImagePluginOptions {
	provider: AiImageProvider;
}

export interface AiImagePluginInstance {
	submit(
		request: AiImageJobRequest,
		context: AiLayerContext,
		options?: { signal?: AbortSignal },
	): Promise<AiImageJobResult>;
}
