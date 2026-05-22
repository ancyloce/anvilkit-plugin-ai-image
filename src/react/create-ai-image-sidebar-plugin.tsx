"use client";

import type {
	StudioCopilotPanel,
	StudioPlugin,
	StudioPluginMeta,
	StudioSidebarUnregister,
} from "@anvilkit/core/types";

import type {
	AiImageJobKind,
	AiJobClient,
	AiLayerContext,
} from "../types/index.js";
import { AiImagePanel, type AiImagePanelProps } from "./ai-image-panel.js";

export interface CreateAiImageSidebarPluginOptions {
	/**
	 * Drives jobs (recommended: an {@link AiJobClient} — keeps the I1-5
	 * abort/retry/poll behavior). Passed straight to {@link AiImagePanel}.
	 */
	readonly jobClient: AiJobClient;
	/**
	 * Returns the live {@link AiLayerContext} (active artboard /
	 * selection), or `null` when there is nothing to operate on. The host
	 * owns this — the package must not depend on `@anvilkit/canvas-editor`,
	 * so the host closes over its own selection state. Defaults to
	 * `() => null`, which renders the panel's "no active artboard" state
	 * and disables Run.
	 */
	readonly getLayerContext?: () => AiLayerContext | null;
	/** Op selected on first render. Defaults to `"text-to-image"`. */
	readonly defaultOp?: AiImageJobKind;
	/** Injected i18n copy forwarded to {@link AiImagePanel}. */
	readonly labels?: Pick<
		AiImagePanelProps,
		| "title"
		| "promptPlaceholder"
		| "runLabel"
		| "cancelLabel"
		| "opLabels"
		| "noContextLabel"
	>;
}

const meta: StudioPluginMeta = {
	id: "@anvilkit/plugin-ai-image-sidebar",
	name: "AI Image",
	version: "0.1.0",
	coreVersion: "^0.1.0-alpha",
	description:
		"Registers the AI image generation panel with the StudioSidebar `copilot` module.",
};

/**
 * Self-registering Studio plugin that surfaces {@link AiImagePanel} in
 * the sidebar's `copilot` module. Mirrors the host-side
 * `createCopilotSidebarPlugin`: it builds a {@link StudioCopilotPanel}
 * and registers it on `onInit`, unregistering on `onDestroy`.
 *
 * **Single-occupancy caveat.** `registerCopilotPanel` is last-write-wins
 * (core's sidebar registry holds a single `copilotPanel`), so this panel
 * and `@anvilkit/plugin-ai-copilot`'s panel both claim the `copilot`
 * slot. In practice they live in different Studio contexts — the canvas
 * editor is a sibling mode that mounts separately from the Puck page
 * editor — but a host that registers BOTH in the same `<Studio>` mount
 * gets only the one registered last. Register exactly one per mount.
 */
export function createAiImageSidebarPlugin(
	options: CreateAiImageSidebarPluginOptions,
): StudioPlugin {
	const getLayerContext = options.getLayerContext ?? (() => null);
	const panel: StudioCopilotPanel = {
		render: () => (
			<AiImagePanel
				jobClient={options.jobClient}
				getLayerContext={getLayerContext}
				defaultOp={options.defaultOp}
				{...options.labels}
			/>
		),
	};

	return {
		meta,
		register() {
			let unregister: StudioSidebarUnregister | null = null;
			return {
				meta,
				hooks: {
					onInit: (ctx) => {
						unregister = ctx.registerCopilotPanel?.(panel) ?? null;
					},
					onDestroy: () => {
						unregister?.();
						unregister = null;
					},
				},
			};
		},
	};
}
