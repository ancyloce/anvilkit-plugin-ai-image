export { createAiImagePlugin } from "./plugin.js";
export { createAiJobClient, RetryableError } from "./job/index.js";
export { commitImageReplace } from "./commit/index.js";
export type {
	CommitCanvasCommandFn,
	CommitImageReplaceOptions,
} from "./commit/index.js";
export {
	createMaskToAssetExporter,
	dataUrlToFile,
	drawMask,
	rasterizeMaskToDataUrl,
} from "./mask/exporter.js";
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
export type { MaskDimensions, MaskStroke } from "./mask/types.js";
export type {
	AiJobClient,
	AiJobClientOptions,
	AiJobPollFn,
	AiJobRunOptions,
	RetryOptions,
} from "./job/index.js";
export type {
	AiImageBgRemoveRequest,
	AiImageInpaintRequest,
	AiImageJobError,
	AiImageJobKind,
	AiImageJobRequest,
	AiImageJobResult,
	AiImageJobStatus,
	AiImagePluginInstance,
	AiImagePluginOptions,
	AiImageProvider,
	AiImageProviderOptions,
	AiImageTextToImageRequest,
	AiImageUpscaleRequest,
	AiImageVariationRequest,
	AiLayerBounds,
	AiLayerContext,
} from "./types/index.js";
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
