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
	AiImageCapability,
	AiImageCostMetadata,
	AiImageGenerativeExpandRequest,
	AiImageGenerativeFillRequest,
	AiImageInpaintRequest,
	AiImageInputConstraints,
	AiImageJobError,
	AiImageJobErrorCategory,
	AiImageJobKind,
	AiImageJobProgress,
	AiImageJobRequest,
	AiImageJobResult,
	AiImageJobStatus,
	AiImageObjectEraseRequest,
	AiImageProvider,
	AiImageProviderAdapter,
	AiImageProviderDescriptor,
	AiImageProviderOptions,
	AiImageResultMetadata,
	AiImageSafetyOutcome,
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
