"use client";

/**
 * @file Standalone `aiImage` i18n provider + the `AnvilkitMessages` type
 * augmentation.
 *
 * {@link AiImageI18nProvider} wraps the host-mounted `./react` AI image panel
 * when it renders OUTSIDE `<Studio>` so its `useMsg("aiImage.*")` calls
 * resolve. In-chrome usage needs no wrapper —
 * `createAiImageSidebarPlugin().register()` contributes {@link AI_IMAGE_ENTRY}
 * to core's catalog.
 */

import { EditorI18nProvider } from "@anvilkit/core/i18n";
import type { ReactNode } from "react";

import { AI_IMAGE_ENTRY, type AiImageMessageKey } from "./entry.js";

export function AiImageI18nProvider({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<EditorI18nProvider entries={[AI_IMAGE_ENTRY]}>
			{children}
		</EditorI18nProvider>
	);
}

// Augment the public key registry so `useT("aiImage.*")` autocompletes.
declare module "@anvilkit/core/i18n" {
	interface AnvilkitMessages extends Record<AiImageMessageKey, string> {}
}
