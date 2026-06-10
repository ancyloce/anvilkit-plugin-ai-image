/**
 * @file The `aiImage` registry entry (pure data — no React).
 *
 * The AI image panel ships via the `./react` subpath and is mounted in-chrome
 * by `createAiImageSidebarPlugin` (via `ctx.registerCopilotPanel`); it resolves
 * `useMsg("aiImage.*")` against core's `EditorI18nProvider` once that factory's
 * `register()` contributes this entry. Standalone host mounts wrap in
 * {@link AiImageI18nProvider}. The panel's label props still override per-mount
 * — these are the localizable defaults. Message content lives in
 * `i18n/messages/<locale>.json`; English ships inline and other locales
 * lazy-load.
 */

import type { RegistryEntry } from "@anvilkit/core/i18n";

// Messages live at the plugin-root `i18n/messages/` (shipped via the package
// `files`). Imported from outside `src/` so the bundleless rslib build keeps
// them external `.json` — same pattern as `meta/config.json`.
import enMessages from "../../i18n/messages/en.json" with { type: "json" };

/** Static lazy-pack map (avoids a dynamic template `import()` under rslib). */
const LOCALE_PACKS: Readonly<
	Record<string, () => Promise<{ readonly default: Record<string, string> }>>
> = {
	zh: () => import("../../i18n/messages/zh.json", { with: { type: "json" } }),
	ja: () => import("../../i18n/messages/ja.json", { with: { type: "json" } }),
	ko: () => import("../../i18n/messages/ko.json", { with: { type: "json" } }),
};

/** The registry entry contributed to the catalog (core prepends `studio.*`). */
export const AI_IMAGE_ENTRY: RegistryEntry = {
	namespace: "aiImage",
	en: enMessages,
	loadMessages: async (locale) => {
		const pack = LOCALE_PACKS[locale];
		return pack === undefined ? {} : (await pack()).default;
	},
};

/** Exact key union for the `AnvilkitMessages` augmentation. */
export type AiImageMessageKey = keyof typeof enMessages;
