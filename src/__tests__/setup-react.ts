/**
 * @file Per-file setup loaded by every test via `setupFiles`.
 *
 * Runs `@testing-library/react`'s `cleanup()` after each test so the
 * jsdom DOM does not leak between cases. Also polyfills the minimum
 * Web-API shape the React panel (and any `@anvilkit/core` import) needs
 * so jsdom mounts don't crash on first load. Mirrors
 * `plugin-design-system/src/__tests__/setup-react.ts` and
 * `packages/core/vitest.setup.ts`.
 *
 * The node-env tests (`ai-job-client`, `mock-ai-image-provider`,
 * `create-ai-image-plugin`) also load this file, but the polyfills
 * no-op when `Element` / `window` are absent and `cleanup()` is inert
 * when nothing was rendered.
 */

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverStub {
	observe(): void {
		// intentionally empty — the panel under test never inspects the
		// ResizeObserver callback, only that the constructor exists.
	}
	unobserve(): void {
		// intentionally empty (see observe).
	}
	disconnect(): void {
		// intentionally empty (see observe).
	}
}

if (
	typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver ===
	"undefined"
) {
	(globalThis as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
		ResizeObserverStub;
}

if (
	typeof window !== "undefined" &&
	typeof (window as { matchMedia?: unknown }).matchMedia !== "function"
) {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			onchange: null,
			dispatchEvent: () => false,
		}),
	});
}

if (
	typeof Element !== "undefined" &&
	typeof (Element.prototype as { getAnimations?: unknown }).getAnimations !==
		"function"
) {
	Object.defineProperty(Element.prototype, "getAnimations", {
		writable: true,
		configurable: true,
		value: () => [],
	});
}

afterEach(() => {
	cleanup();
});
