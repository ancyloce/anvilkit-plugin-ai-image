/**
 * @file I1-9 `PostProcessPipeline` (PRD FR-024). Turns a raw AI-image output
 * (a `Blob`, `File`, or data URL) into a registered, validated, compressed asset
 * plus a registered thumbnail asset:
 *
 *   normalise → validate MIME → validate size → (optional) compress
 *             → register main → thumbnail → register thumbnail.
 *
 * Konva-free and dependency-clean by design — exactly like
 * {@link createMaskToAssetExporter}. The two host-specific concerns are
 * injected:
 *  - `upload` wraps the host's asset manager (this package never depends on
 *    `@anvilkit/plugin-asset-manager`).
 *  - `createCanvas` + `decodeImage` are the raster primitives; their browser
 *    defaults use `document.createElement("canvas")` + `createImageBitmap`, but
 *    tests inject fakes so the pipeline is unit-testable in a node env.
 *
 * Compression is opt-in (`compress`): re-encoding PNG→PNG is pointless, so the
 * main asset is the validated original unless a lossy `mimeType`/`quality` is
 * requested (e.g. the demo route asks for `image/webp`). The thumbnail is always
 * generated and registered as its own asset.
 */

export type PostProcessSource = Blob | File | string;

/** Result of an upload — only the asset id is needed (a superset is fine). */
export interface PostProcessUploadResult {
	id: string;
}

/**
 * Injected uploader. The host wraps `plugin-asset-manager`'s
 * `uploadAsset(ctx, file)` (whose `UploadResult` satisfies this shape).
 */
export type PostProcessUpload = (
	file: File,
) => Promise<PostProcessUploadResult>;

/** The 2D drawing surface the pipeline needs — satisfied by a real context. */
export interface ProcessCanvas2D {
	drawImage(
		image: CanvasImageSource,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
}

/** Minimal canvas the pipeline needs — satisfied by `HTMLCanvasElement`. */
export interface ProcessCanvas {
	width: number;
	height: number;
	getContext(contextId: "2d"): ProcessCanvas2D | null;
	toDataURL(type?: string, quality?: number): string;
}

export type ProcessCanvasFactory = (
	width: number,
	height: number,
) => ProcessCanvas;

/** A decoded, drawable image plus its intrinsic pixel dimensions. */
export interface DecodedImage {
	readonly image: CanvasImageSource;
	readonly width: number;
	readonly height: number;
}

/** Decodes a `File` into something drawable. Default uses `createImageBitmap`. */
export type ImageDecoder = (file: File) => Promise<DecodedImage>;

export type PostProcessErrorCode =
	| "unsupported-mime"
	| "too-large"
	| "no-2d-context"
	| "decode-failed";

/** Typed failure for the validation/raster steps (mirrors `CanvasCommandError`). */
export class PostProcessError extends Error {
	readonly code: PostProcessErrorCode;
	constructor(code: PostProcessErrorCode, message: string) {
		super(message);
		this.name = "PostProcessError";
		this.code = code;
	}
}

const DEFAULT_ACCEPTED_MIME_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/webp",
];
const DEFAULT_THUMBNAIL_MAX_EDGE = 256;
const DEFAULT_MAIN_FILENAME = "ai-image.png";
const DEFAULT_THUMBNAIL_FILENAME = "ai-image-thumb.png";

export interface PostProcessThumbnailOptions {
	/** Longest edge of the thumbnail in px. @default 256 */
	maxEdge?: number;
	/** Thumbnail encoding. @default `"image/png"` */
	mimeType?: string;
}

export interface PostProcessCompressOptions {
	/** Re-encode the main asset to this MIME (e.g. `"image/webp"`). */
	mimeType?: string;
	/** Encoder quality `0..1` for lossy targets. */
	quality?: number;
}

export interface PostProcessOptions {
	/** Registers a `File`, resolving to its asset id. Required. */
	upload: PostProcessUpload;
	/** Allowed MIME types; supports `"image/*"` wildcards. @default png/jpeg/webp */
	acceptedMimeTypes?: readonly string[];
	/** Reject inputs larger than this many bytes. Unset = no limit. */
	maxBytes?: number;
	/** Thumbnail sizing/encoding. */
	thumbnail?: PostProcessThumbnailOptions;
	/** Opt-in main-asset re-encode. Unset = register the validated original. */
	compress?: PostProcessCompressOptions;
	/** Override canvas creation (tests). @default `document.createElement` */
	createCanvas?: ProcessCanvasFactory;
	/** Override image decoding (tests). @default `createImageBitmap` */
	decodeImage?: ImageDecoder;
	/** Main upload file name. @default `"ai-image.png"` */
	filename?: string;
}

export interface PostProcessResult {
	/** Asset id of the registered (possibly compressed) full-size image. */
	assetId: string;
	/** Asset id of the registered thumbnail. */
	thumbnailAssetId: string;
	/** MIME type of the registered main asset. */
	mimeType: string;
	/** Byte size of the registered main asset. */
	bytes: number;
	/** Intrinsic width of the decoded source in px. */
	width: number;
	/** Intrinsic height of the decoded source in px. */
	height: number;
}

export interface PostProcessPipeline {
	/** Validate, compress, thumbnail, and register `source`. */
	process(source: PostProcessSource): Promise<PostProcessResult>;
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
	// `BlobPart`/`BufferSource` requires an `ArrayBuffer`-backed view, not the
	// default `Uint8Array<ArrayBufferLike>`.
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

/** Normalise any accepted source into a `File`. */
export function sourceToFile(
	source: PostProcessSource,
	filename: string,
): File {
	if (typeof source === "string") {
		return dataUrlToFile(source, filename);
	}
	if (source instanceof File) {
		return source;
	}
	// A bare `Blob` — wrap it so downstream consumers get a stable name.
	return new File([source], filename, {
		type: source.type || "application/octet-stream",
	});
}

function assertMimeAllowed(mime: string, accepted: readonly string[]): void {
	const ok = accepted.some(
		(entry) =>
			entry === mime ||
			(entry.endsWith("/*") && mime.startsWith(entry.slice(0, -1))),
	);
	if (!ok) {
		throw new PostProcessError(
			"unsupported-mime",
			`Unsupported image MIME type "${mime}". Accepted: ${accepted.join(", ")}.`,
		);
	}
}

function assertWithinSize(bytes: number, maxBytes: number | undefined): void {
	if (maxBytes !== undefined && bytes > maxBytes) {
		throw new PostProcessError(
			"too-large",
			`Image is ${bytes} bytes, exceeding the ${maxBytes}-byte limit.`,
		);
	}
}

/** Scale (w, h) so the longest edge is at most `maxEdge`, preserving aspect. */
export function thumbnailDimensions(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) {
		const edge = Math.max(1, Math.round(maxEdge));
		return { width: edge, height: edge };
	}
	const longest = Math.max(width, height);
	if (longest <= maxEdge) {
		return { width, height };
	}
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** Draw `decoded` at (w, h) onto a fresh canvas and read it back as a data URL. */
function rasterToDataUrl(
	decoded: DecodedImage,
	width: number,
	height: number,
	mimeType: string,
	quality: number | undefined,
	createCanvas: ProcessCanvasFactory,
): string {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new PostProcessError(
			"no-2d-context",
			"PostProcessPipeline: 2D canvas context is unavailable.",
		);
	}
	ctx.drawImage(decoded.image, 0, 0, width, height);
	return canvas.toDataURL(mimeType, quality);
}

const defaultCanvasFactory: ProcessCanvasFactory = (width, height) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
};

const defaultImageDecoder: ImageDecoder = async (file) => {
	if (typeof createImageBitmap !== "function") {
		throw new PostProcessError(
			"decode-failed",
			"PostProcessPipeline: createImageBitmap is unavailable; inject `decodeImage`.",
		);
	}
	try {
		const bitmap = await createImageBitmap(file);
		return { image: bitmap, width: bitmap.width, height: bitmap.height };
	} catch (err) {
		throw new PostProcessError(
			"decode-failed",
			`PostProcessPipeline: failed to decode image (${
				err instanceof Error ? err.message : String(err)
			}).`,
		);
	}
};

export function createPostProcessPipeline(
	options: PostProcessOptions,
): PostProcessPipeline {
	if (typeof options.upload !== "function") {
		throw new TypeError(
			"createPostProcessPipeline: `upload` must be a function.",
		);
	}

	const accepted = options.acceptedMimeTypes ?? DEFAULT_ACCEPTED_MIME_TYPES;
	const createCanvas = options.createCanvas ?? defaultCanvasFactory;
	const decodeImage = options.decodeImage ?? defaultImageDecoder;
	const filename = options.filename ?? DEFAULT_MAIN_FILENAME;
	const thumbMaxEdge = options.thumbnail?.maxEdge ?? DEFAULT_THUMBNAIL_MAX_EDGE;
	const thumbMime = options.thumbnail?.mimeType ?? "image/png";

	return {
		async process(source) {
			const file = sourceToFile(source, filename);
			assertMimeAllowed(file.type, accepted);
			assertWithinSize(file.size, options.maxBytes);

			const decoded = await decodeImage(file);

			// Main asset: re-encode only when a lossy compression target is asked
			// for; otherwise register the validated original untouched.
			let mainFile = file;
			if (options.compress) {
				const dataUrl = rasterToDataUrl(
					decoded,
					decoded.width,
					decoded.height,
					options.compress.mimeType ?? file.type,
					options.compress.quality,
					createCanvas,
				);
				mainFile = dataUrlToFile(dataUrl, filename);
			}
			const main = await options.upload(mainFile);

			const thumb = thumbnailDimensions(
				decoded.width,
				decoded.height,
				thumbMaxEdge,
			);
			const thumbDataUrl = rasterToDataUrl(
				decoded,
				thumb.width,
				thumb.height,
				thumbMime,
				undefined,
				createCanvas,
			);
			const thumbFile = dataUrlToFile(thumbDataUrl, DEFAULT_THUMBNAIL_FILENAME);
			const thumbnail = await options.upload(thumbFile);

			return {
				assetId: main.id,
				thumbnailAssetId: thumbnail.id,
				mimeType: mainFile.type,
				bytes: mainFile.size,
				width: decoded.width,
				height: decoded.height,
			};
		},
	};
}
