import { nodePreset } from "@anvilkit/vitest-config/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	nodePreset,
	defineConfig({
		test: {
			name: "@anvilkit/plugin-ai-image",
			passWithNoTests: true,
			// The node preset's `include` only matches `.ts`. The React
			// panel/hook tests are `.tsx` and opt into jsdom per-file with a
			// `// @vitest-environment jsdom` directive; widen `include` so
			// they are collected, and load the shared cleanup + DOM polyfill
			// setup (harmless no-op under the node-env tests).
			include: [
				"src/**/*.{test,spec}.{ts,tsx}",
				"src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
			],
			setupFiles: ["./src/__tests__/setup-react.ts"],
		},
	}),
);
