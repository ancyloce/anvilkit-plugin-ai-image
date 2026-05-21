import type {
	StudioPlugin,
	StudioPluginMeta,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import config from "../meta/config.json";
import type {
	AiImageJobRequest,
	AiImageJobResult,
	AiImagePluginInstance,
	AiImagePluginOptions,
	AiLayerContext,
} from "./types/index.js";

const META: StudioPluginMeta = config;

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
