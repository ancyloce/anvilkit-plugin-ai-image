import type { MaskDimensions, MaskStroke } from "./types.js";

/**
 * I1-8 `MaskToAssetExporter` (PRD FR-022). Rasterises mask strokes to an alpha
 * PNG and uploads it via an injected uploader, returning a `maskAssetId`.
 *
 * Konva-free by design: drawing uses the plain Canvas 2D API so the exporter is
 * unit-testable in a node env (via an injected canvas factory) and carries no
 * react-konva dependency. The uploader is injected too — this package never
 * depends on `@anvilkit/plugin-asset-manager`; the host wires
 * `upload = (file) => uploadAsset(ctx, file)`.
 */

export interface DrawMaskOptions {
	/** Stroke colour. Default `"#ffffff"` — opaque white on a transparent canvas. */
	strokeColor?: string;
	/** Canvas composite mode. Default `"source-over"`. */
	compositeOperation?: GlobalCompositeOperation;
}

/**
 * Paint `strokes` onto a 2D context with round caps/joins. The canvas is
 * assumed transparent on entry, so the result is white strokes over alpha — a
 * standard inpaint mask. Pure aside from the `ctx` mutations.
 */
export function drawMask(
	ctx: CanvasRenderingContext2D,
	strokes: readonly MaskStroke[],
	opts: DrawMaskOptions = {},
): void {
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.strokeStyle = opts.strokeColor ?? "#ffffff";
	ctx.globalCompositeOperation = opts.compositeOperation ?? "source-over";
	for (const stroke of strokes) {
		const pts = stroke.points;
		if (pts.length < 2) continue;
		ctx.beginPath();
		ctx.lineWidth = stroke.width;
		ctx.moveTo(pts[0] as number, pts[1] as number);
		for (let i = 2; i + 1 < pts.length; i += 2) {
			ctx.lineTo(pts[i] as number, pts[i + 1] as number);
		}
		// A single point is a dot: a zero-length segment renders as a filled
		// circle under the round line cap.
		if (pts.length === 2) {
			ctx.lineTo(pts[0] as number, pts[1] as number);
		}
		ctx.stroke();
	}
	ctx.restore();
}

/** Minimal canvas surface the exporter needs — satisfied by `HTMLCanvasElement`. */
export interface MaskCanvas {
	width: number;
	height: number;
	getContext(contextId: "2d"): CanvasRenderingContext2D | null;
	toDataURL(type?: string): string;
}

export type CanvasFactory = (width: number, height: number) => MaskCanvas;

const defaultCanvasFactory: CanvasFactory = (width, height) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
};

export interface RasterizeMaskInput {
	strokes: readonly MaskStroke[];
	width: number;
	height: number;
	draw?: DrawMaskOptions;
	/** Override canvas creation (tests). Defaults to `document.createElement`. */
	createCanvas?: CanvasFactory;
}

/** Rasterise strokes to an `image/png` data URL with an alpha background. */
export function rasterizeMaskToDataUrl(input: RasterizeMaskInput): string {
	const create = input.createCanvas ?? defaultCanvasFactory;
	const canvas = create(input.width, input.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("MaskToAssetExporter: 2D canvas context is unavailable.");
	}
	drawMask(ctx, input.strokes, input.draw);
	return canvas.toDataURL("image/png");
}

/** Decode a (base64 or percent-encoded) data URL into a `File`. */
export function dataUrlToFile(dataUrl: string, filename: string): File {
	const comma = dataUrl.indexOf(",");
	if (!dataUrl.startsWith("data:") || comma === -1) {
		throw new Error("dataUrlToFile: input is not a data URL.");
	}
	const header = dataUrl.slice(5, comma); // e.g. "image/png;base64"
	const mime = header.split(";")[0] || "application/octet-stream";
	const payload = dataUrl.slice(comma + 1);
	// Annotate the buffer kind: `BlobPart`/`BufferSource` requires an
	// `ArrayBuffer`-backed view, not the default `Uint8Array<ArrayBufferLike>`.
	let bytes: Uint8Array<ArrayBuffer>;
	if (header.includes(";base64")) {
		const binary = atob(payload);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} else {
		const decoded = decodeURIComponent(payload);
		bytes = new Uint8Array(decoded.length);
		for (let i = 0; i < decoded.length; i++) {
			bytes[i] = decoded.charCodeAt(i);
		}
	}
	return new File([bytes], filename, { type: mime });
}

/** Result of an upload — only the asset id is needed (a superset is fine). */
export interface MaskUploadResult {
	id: string;
}

/**
 * Injected uploader. The host wraps `plugin-asset-manager`'s
 * `uploadAsset(ctx, file)` (whose `UploadResult` satisfies `MaskUploadResult`).
 */
export type MaskUpload = (file: File) => Promise<MaskUploadResult>;

export interface MaskToAssetExporterOptions {
	upload: MaskUpload;
	createCanvas?: CanvasFactory;
	/** Uploaded file name. Default `"mask.png"`. */
	filename?: string;
	draw?: DrawMaskOptions;
}

export interface MaskToAssetExporter {
	/** Rasterise + upload `strokes`, resolving to the stored mask asset id. */
	exportMask(
		strokes: readonly MaskStroke[],
		dimensions: MaskDimensions,
	): Promise<string>;
}

export function createMaskToAssetExporter(
	options: MaskToAssetExporterOptions,
): MaskToAssetExporter {
	if (typeof options.upload !== "function") {
		throw new TypeError(
			"createMaskToAssetExporter: `upload` must be a function.",
		);
	}
	return {
		async exportMask(strokes, dimensions) {
			const dataUrl = rasterizeMaskToDataUrl({
				strokes,
				width: dimensions.width,
				height: dimensions.height,
				draw: options.draw,
				createCanvas: options.createCanvas,
			});
			const file = dataUrlToFile(dataUrl, options.filename ?? "mask.png");
			const result = await options.upload(file);
			return result.id;
		},
	};
}
