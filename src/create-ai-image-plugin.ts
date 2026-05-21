import type {
	StudioPlugin,
	StudioPluginMeta,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImagePluginInstance,
	AiImagePluginOptions,
	AiLayerContext,
} from "./types.js";

const META: StudioPluginMeta = {
	id: "@anvilkit/plugin-ai-image",
	name: "AI Image",
	version: "0.1.0",
	coreVersion: "^0.1.0-alpha",
	description:
		"AI image generation for the Canvas Studio editor — text-to-image, variation, inpaint, background removal.",
};

function assertValidOptions(opts: AiImagePluginOptions): void {
	if (typeof opts.provider !== "function") {
		throw new TypeError(
			"@anvilkit/plugin-ai-image: options.provider must be a function (AiImageProvider). Got " +
				typeof opts.provider,
		);
	}
}

export function createAiImagePlugin(
	opts: AiImagePluginOptions,
): StudioPlugin & AiImagePluginInstance {
	assertValidOptions(opts);

	async function submit(
		request: AiImageJobRequest,
		context: AiLayerContext,
		options?: { signal?: AbortSignal },
	): Promise<AiImageJobResult> {
		return opts.provider(request, context, options);
	}

	const plugin: StudioPlugin & AiImagePluginInstance = {
		meta: META,
		register(_ctx): StudioPluginRegistration {
			return {
				meta: META,
				hooks: {},
			};
		},
		submit,
	};

	return plugin;
}
