export type {
	CommitAiDesignCommandFn,
	CommitAiDesignResultOptions,
	CommitAiDesignResultOutcome,
	CommitCanvasCommandFn,
	CommitImageReplaceOptions,
} from "./commit/index.js";
export { commitAiDesignResult, commitImageReplace } from "./commit/index.js";
export type {
	AiJobClient,
	AiJobClientOptions,
	AiJobPollFn,
	AiJobProviderFn,
	AiJobResultLike,
	AiJobRunOptions,
	RetryOptions,
} from "./job/index.js";
export { createAiJobClient, RetryableError } from "./job/index.js";
export type {
	CanvasFactory,
	DrawMaskOptions,
	MaskCanvas,
	MaskToAssetExporter,
	MaskToAssetExporterOptions,
	MaskUpload,
	MaskUploadResult,
	RasterizeMaskInput,
} from "./mask/exporter.js";
export {
	createMaskToAssetExporter,
	dataUrlToFile,
	drawMask,
	rasterizeMaskToDataUrl,
} from "./mask/exporter.js";
export type { MaskDimensions, MaskStroke } from "./mask/types.js";
export { createAiImagePlugin } from "./plugin.js";
// `createPostProcessPipeline` itself is intentionally subpath-only
// (`@anvilkit/plugin-ai-image/post-process`) to keep the main bundle lean;
// only its types are surfaced from the root entry.
export type {
	DecodedImage,
	ImageDecoder,
	PostProcessCompressOptions,
	PostProcessErrorCode,
	PostProcessOptions,
	PostProcessPipeline,
	PostProcessResult,
	PostProcessSource,
	PostProcessThumbnailOptions,
	PostProcessUpload,
	PostProcessUploadResult,
} from "./post-process/index.js";
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
	AiImagePluginInstance,
	AiImagePluginOptions,
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
} from "./types/index.js";
