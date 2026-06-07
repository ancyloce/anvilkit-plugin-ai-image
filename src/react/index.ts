"use client";

/**
 * @file React entry (`@anvilkit/plugin-ai-image/react`).
 *
 * The package's `.` entry stays headless; this optional subpath ships
 * the AI image sidebar surface (`AiImagePanel`, `useAiImage`) and the
 * self-registering `createAiImageSidebarPlugin` helper.
 */

export { AiImageI18nProvider } from "../i18n/provider.js";
export { AiImagePanel, type AiImagePanelProps } from "./ai-image-panel.js";
export {
	type CreateAiImageSidebarPluginOptions,
	createAiImageSidebarPlugin,
} from "./create-ai-image-sidebar-plugin.js";
export {
	type AiImageJobRunner,
	type UseAiImageOptions,
	type UseAiImageResult,
	useAiImage,
} from "./use-ai-image.js";
