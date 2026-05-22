import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rslib/core";

export default defineConfig({
	source: {
		entry: {
			index: [
				"./src/**/*.{ts,tsx}",
				"!./src/**/*.{test,spec}.{ts,tsx}",
				"!./src/**/__tests__/**",
			],
		},
	},
	lib: [
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "esm",
		},
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "cjs",
		},
	],
	output: {
		target: "web",
		externals: [
			"@anvilkit/canvas-core",
			"@anvilkit/core",
			"@anvilkit/ui",
			"@anvilkit/utils",
			"@puckeditor/core",
			"konva",
			"react",
			"react-dom",
			"react-konva",
		],
	},
	plugins: [pluginReact()],
});
