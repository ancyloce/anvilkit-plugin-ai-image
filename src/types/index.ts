import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImageProvider,
	AiLayerContext,
} from "@anvilkit/canvas-core";

export type {
	AiDesignJobError,
	AiDesignJobKind,
	AiDesignJobPayload,
	AiDesignJobRequest,
	AiDesignJobResult,
	AiDesignJobStatus,
	AiDesignProvider,
	AiDesignProviderOptions,
	AiDesignQuarantineError,
	AiImageBackgroundReplaceRequest,
	AiImageBgRemoveRequest,
	AiImageGenerativeExpandRequest,
	AiImageGenerativeFillRequest,
	AiImageInpaintRequest,
	AiImageJobError,
	AiImageJobKind,
	AiImageJobRequest,
	AiImageJobResult,
	AiImageJobStatus,
	AiImageObjectEraseRequest,
	AiImageProvider,
	AiImageProviderOptions,
	AiImageTextToImageRequest,
	AiImageUpscaleRequest,
	AiImageVariationRequest,
	AiLayerBounds,
	AiLayerContext,
	AiProviderCapabilities,
	BrandKitDefinition,
} from "@anvilkit/canvas-core";
export type {
	AiJobClient,
	AiJobClientOptions,
	AiJobPollFn,
	AiJobProviderFn,
	AiJobResultLike,
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
