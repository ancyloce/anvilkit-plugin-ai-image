import { describe, expect, it, vi } from "vitest";
import {
	createMaskToAssetExporter,
	dataUrlToFile,
	drawMask,
	type MaskCanvas,
	rasterizeMaskToDataUrl,
} from "../exporter.js";
import type { MaskStroke } from "../types.js";

interface Call {
	op: string;
	args: unknown[];
}

/** A recording 2D context — captures path ops + the style props the exporter sets. */
function recordingCtx() {
	const calls: Call[] = [];
	const style = {
		lineCap: "",
		lineJoin: "",
		strokeStyle: "",
		lineWidth: 0,
		globalCompositeOperation: "",
	};
	const ctx = {
		get lineCap() {
			return style.lineCap;
		},
		set lineCap(v: string) {
			style.lineCap = v;
		},
		get lineJoin() {
			return style.lineJoin;
		},
		set lineJoin(v: string) {
			style.lineJoin = v;
		},
		get strokeStyle() {
			return style.strokeStyle;
		},
		set strokeStyle(v: string) {
			style.strokeStyle = v;
		},
		get lineWidth() {
			return style.lineWidth;
		},
		set lineWidth(v: number) {
			calls.push({ op: "lineWidth", args: [v] });
			style.lineWidth = v;
		},
		get globalCompositeOperation() {
			return style.globalCompositeOperation;
		},
		set globalCompositeOperation(v: string) {
			style.globalCompositeOperation = v;
		},
		save: (...a: unknown[]) => calls.push({ op: "save", args: a }),
		restore: (...a: unknown[]) => calls.push({ op: "restore", args: a }),
		beginPath: (...a: unknown[]) => calls.push({ op: "beginPath", args: a }),
		moveTo: (...a: unknown[]) => calls.push({ op: "moveTo", args: a }),
		lineTo: (...a: unknown[]) => calls.push({ op: "lineTo", args: a }),
		stroke: (...a: unknown[]) => calls.push({ op: "stroke", args: a }),
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, style };
}

function fakeCanvas(
	ctxResult: CanvasRenderingContext2D | null,
	dataUrl = "data:image/png;base64,QUJD",
) {
	const sizes: { width: number; height: number } = { width: 0, height: 0 };
	const toDataURL = vi.fn(() => dataUrl);
	const canvas: MaskCanvas = {
		get width() {
			return sizes.width;
		},
		set width(v: number) {
			sizes.width = v;
		},
		get height() {
			return sizes.height;
		},
		set height(v: number) {
			sizes.height = v;
		},
		getContext: () => ctxResult,
		toDataURL,
	};
	return { canvas, sizes, toDataURL };
}

describe("drawMask", () => {
	it("issues round-capped white path ops for each stroke", () => {
		const { ctx, calls, style } = recordingCtx();
		const strokes: MaskStroke[] = [
			{ id: "s1", points: [0, 0, 10, 10, 20, 0], width: 8 },
			{ id: "s2", points: [5, 5, 5, 30], width: 4 },
		];
		drawMask(ctx, strokes);

		expect(style.lineCap).toBe("round");
		expect(style.lineJoin).toBe("round");
		expect(style.strokeStyle).toBe("#ffffff");
		expect(style.globalCompositeOperation).toBe("source-over");

		expect(calls.filter((c) => c.op === "beginPath")).toHaveLength(2);
		expect(calls.filter((c) => c.op === "stroke")).toHaveLength(2);
		const moveTos = calls.filter((c) => c.op === "moveTo");
		expect(moveTos[0]?.args).toEqual([0, 0]);
		const lineTos = calls.filter((c) => c.op === "lineTo").map((c) => c.args);
		// s1: (10,10) then (20,0); s2: (5,30).
		expect(lineTos).toEqual([
			[10, 10],
			[20, 0],
			[5, 30],
		]);
	});

	it("renders a single-point stroke as a dot (lineTo to the same point)", () => {
		const { ctx, calls } = recordingCtx();
		drawMask(ctx, [{ id: "dot", points: [12, 34], width: 6 }]);
		const lineTos = calls.filter((c) => c.op === "lineTo");
		expect(lineTos).toHaveLength(1);
		expect(lineTos[0]?.args).toEqual([12, 34]);
	});

	it("skips strokes with fewer than 2 coordinates", () => {
		const { ctx, calls } = recordingCtx();
		drawMask(ctx, [{ id: "bad", points: [1], width: 5 }]);
		expect(calls.filter((c) => c.op === "beginPath")).toHaveLength(0);
	});

	it("honours custom stroke colour + composite", () => {
		const { ctx, style } = recordingCtx();
		drawMask(ctx, [{ id: "s", points: [0, 0, 1, 1], width: 2 }], {
			strokeColor: "#abcdef",
			compositeOperation: "destination-out",
		});
		expect(style.strokeStyle).toBe("#abcdef");
		expect(style.globalCompositeOperation).toBe("destination-out");
	});
});

describe("rasterizeMaskToDataUrl", () => {
	it("sizes the canvas to the requested dimensions and returns the PNG data URL", () => {
		const { ctx } = recordingCtx();
		const { canvas, sizes, toDataURL } = fakeCanvas(ctx);
		const url = rasterizeMaskToDataUrl({
			strokes: [{ id: "s", points: [0, 0, 4, 4], width: 3 }],
			width: 120,
			height: 80,
			createCanvas: () => {
				canvas.width = 120;
				canvas.height = 80;
				return canvas;
			},
		});
		expect(sizes).toEqual({ width: 120, height: 80 });
		expect(toDataURL).toHaveBeenCalledWith("image/png");
		expect(url).toBe("data:image/png;base64,QUJD");
	});

	it("throws when no 2D context is available", () => {
		const { canvas } = fakeCanvas(null);
		expect(() =>
			rasterizeMaskToDataUrl({
				strokes: [],
				width: 10,
				height: 10,
				createCanvas: () => canvas,
			}),
		).toThrow(/2D canvas context/);
	});
});

describe("dataUrlToFile", () => {
	it("decodes a base64 data URL into a File with the right type and bytes", () => {
		// "ABC" → base64 "QUJD"
		const file = dataUrlToFile("data:image/png;base64,QUJD", "mask.png");
		expect(file).toBeInstanceOf(File);
		expect(file.type).toBe("image/png");
		expect(file.name).toBe("mask.png");
		expect(file.size).toBe(3);
	});

	it("rejects non-data-URL input", () => {
		expect(() => dataUrlToFile("https://x/y.png", "mask.png")).toThrow(
			/not a data URL/,
		);
	});
});

describe("createMaskToAssetExporter", () => {
	it("rasterises, uploads a PNG File, and returns the asset id", async () => {
		const { ctx } = recordingCtx();
		const { canvas } = fakeCanvas(ctx, "data:image/png;base64,QUJD");
		const upload = vi.fn(async (_file: File) => ({ id: "mask-asset-1" }));
		const exporter = createMaskToAssetExporter({
			upload,
			createCanvas: () => canvas,
		});

		const id = await exporter.exportMask(
			[{ id: "s", points: [0, 0, 5, 5], width: 4 }],
			{
				width: 64,
				height: 64,
			},
		);

		expect(id).toBe("mask-asset-1");
		expect(upload).toHaveBeenCalledTimes(1);
		const uploaded = upload.mock.calls[0]?.[0] as File;
		expect(uploaded).toBeInstanceOf(File);
		expect(uploaded.type).toBe("image/png");
		expect(uploaded.name).toBe("mask.png");
	});

	it("still produces a (transparent) mask upload for zero strokes", async () => {
		const { ctx } = recordingCtx();
		const { canvas } = fakeCanvas(ctx);
		const upload = vi.fn(async () => ({ id: "empty-mask" }));
		const exporter = createMaskToAssetExporter({
			upload,
			createCanvas: () => canvas,
			filename: "m.png",
		});
		const id = await exporter.exportMask([], { width: 8, height: 8 });
		expect(id).toBe("empty-mask");
		expect((upload.mock.calls[0]?.[0] as File).name).toBe("m.png");
	});

	it("throws when `upload` is not a function", () => {
		expect(() =>
			createMaskToAssetExporter({ upload: undefined as never }),
		).toThrow(TypeError);
	});
});
