import { describe, expect, it, vi } from "vitest";
import {
	createPostProcessPipeline,
	type ImageDecoder,
	PostProcessError,
	type ProcessCanvas,
	type ProcessCanvasFactory,
	thumbnailDimensions,
} from "../pipeline.js";

/** A decoder that ignores the file and reports fixed intrinsic dimensions. */
function fakeDecoder(width: number, height: number): ImageDecoder {
	return vi.fn(async () => ({
		image: {} as CanvasImageSource,
		width,
		height,
	}));
}

interface CreatedCanvas {
	width: number;
	height: number;
	drawImage: ReturnType<typeof vi.fn>;
	toDataURL: ReturnType<typeof vi.fn>;
}

/**
 * A canvas factory that records every canvas it creates (with the size it was
 * asked for) and the draw/encode calls made against it.
 */
function recordingCanvasFactory(
	dataUrl = "data:image/png;base64,QUJD",
	contextAvailable = true,
): { factory: ProcessCanvasFactory; created: CreatedCanvas[] } {
	const created: CreatedCanvas[] = [];
	const factory: ProcessCanvasFactory = (width, height) => {
		const drawImage = vi.fn();
		const toDataURL = vi.fn((_type?: string, _quality?: number) => dataUrl);
		const record: CreatedCanvas = { width, height, drawImage, toDataURL };
		created.push(record);
		const canvas: ProcessCanvas = {
			width,
			height,
			getContext: () => (contextAvailable ? { drawImage } : null),
			toDataURL,
		};
		return canvas;
	};
	return { factory, created };
}

function pngFile(name = "out.png", type = "image/png", size = 16): File {
	const bytes = new Uint8Array(size);
	return new File([bytes], name, { type });
}

describe("thumbnailDimensions", () => {
	it("caps the longest edge while preserving aspect ratio", () => {
		expect(thumbnailDimensions(800, 600, 256)).toEqual({
			width: 256,
			height: 192,
		});
		expect(thumbnailDimensions(600, 800, 256)).toEqual({
			width: 192,
			height: 256,
		});
	});

	it("leaves images already within the cap untouched", () => {
		expect(thumbnailDimensions(100, 50, 256)).toEqual({
			width: 100,
			height: 50,
		});
	});

	it("falls back to a square for degenerate dimensions", () => {
		expect(thumbnailDimensions(0, 0, 256)).toEqual({ width: 256, height: 256 });
	});
});

describe("createPostProcessPipeline — validation", () => {
	it("rejects an unsupported MIME type with code `unsupported-mime`", async () => {
		const pipeline = createPostProcessPipeline({
			upload: vi.fn(async () => ({ id: "x" })),
			decodeImage: fakeDecoder(10, 10),
			createCanvas: recordingCanvasFactory().factory,
		});
		await expect(
			pipeline.process(pngFile("note.txt", "text/plain", 4)),
		).rejects.toMatchObject({ code: "unsupported-mime" });
	});

	it("rejects an oversize input with code `too-large`", async () => {
		const pipeline = createPostProcessPipeline({
			upload: vi.fn(async () => ({ id: "x" })),
			maxBytes: 8,
			decodeImage: fakeDecoder(10, 10),
			createCanvas: recordingCanvasFactory().factory,
		});
		await expect(
			pipeline.process(pngFile("big.png", "image/png", 64)),
		).rejects.toBeInstanceOf(PostProcessError);
	});

	it("accepts MIME wildcards", async () => {
		const pipeline = createPostProcessPipeline({
			upload: vi.fn(async () => ({ id: "ok" })),
			acceptedMimeTypes: ["image/*"],
			decodeImage: fakeDecoder(10, 10),
			createCanvas: recordingCanvasFactory().factory,
		});
		await expect(
			pipeline.process(pngFile("a.webp", "image/webp", 4)),
		).resolves.toMatchObject({ assetId: "ok" });
	});

	it("throws when no 2D context is available", async () => {
		const { factory } = recordingCanvasFactory(
			"data:image/png;base64,QUJD",
			false,
		);
		const pipeline = createPostProcessPipeline({
			upload: vi.fn(async () => ({ id: "x" })),
			decodeImage: fakeDecoder(10, 10),
			createCanvas: factory,
		});
		await expect(pipeline.process(pngFile())).rejects.toMatchObject({
			code: "no-2d-context",
		});
	});

	it("throws a TypeError when `upload` is not a function", () => {
		expect(() =>
			createPostProcessPipeline({ upload: undefined as never }),
		).toThrow(TypeError);
	});
});

describe("createPostProcessPipeline — register + thumbnail", () => {
	it("registers the validated original main asset + a downscaled thumbnail", async () => {
		const ids = ["asset-main", "asset-thumb"];
		const upload = vi.fn(async () => ({ id: ids.shift() as string }));
		const { factory, created } = recordingCanvasFactory();
		const decode = fakeDecoder(800, 600);
		const pipeline = createPostProcessPipeline({
			upload,
			decodeImage: decode,
			createCanvas: factory,
		});

		const result = await pipeline.process(pngFile("hero.png", "image/png", 16));

		expect(result).toEqual({
			assetId: "asset-main",
			thumbnailAssetId: "asset-thumb",
			mimeType: "image/png",
			bytes: 16,
			width: 800,
			height: 600,
		});
		expect(decode).toHaveBeenCalledTimes(1);
		expect(upload).toHaveBeenCalledTimes(2);
		// No compression → only the thumbnail canvas is created (256×192).
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ width: 256, height: 192 });
		expect(created[0]?.drawImage).toHaveBeenCalledWith(
			expect.anything(),
			0,
			0,
			256,
			192,
		);
		// Main upload is the untouched original; thumbnail is a fresh PNG File.
		const mainUpload = upload.mock.calls[0]?.[0] as File;
		const thumbUpload = upload.mock.calls[1]?.[0] as File;
		expect(mainUpload.name).toBe("hero.png");
		expect(thumbUpload.name).toBe("ai-image-thumb.png");
		expect(thumbUpload.type).toBe("image/png");
	});

	it("re-encodes the main asset when `compress` is requested", async () => {
		const ids = ["main-webp", "thumb"];
		const upload = vi.fn(async () => ({ id: ids.shift() as string }));
		const { factory, created } = recordingCanvasFactory(
			"data:image/webp;base64,QUJD",
		);
		const pipeline = createPostProcessPipeline({
			upload,
			decodeImage: fakeDecoder(400, 200),
			createCanvas: factory,
			compress: { mimeType: "image/webp", quality: 0.8 },
		});

		const result = await pipeline.process(pngFile("src.png", "image/png", 99));

		// Both a full-size compression canvas and a thumbnail canvas are created.
		expect(created).toHaveLength(2);
		expect(created[0]).toMatchObject({ width: 400, height: 200 });
		expect(created[0]?.toDataURL).toHaveBeenCalledWith("image/webp", 0.8);
		expect(created[1]).toMatchObject({ width: 256, height: 128 });
		// Main asset now reflects the re-encoded bytes/MIME, not the 99-byte input.
		const mainUpload = upload.mock.calls[0]?.[0] as File;
		expect(mainUpload.type).toBe("image/webp");
		expect(result.mimeType).toBe("image/webp");
		expect(result.bytes).toBe(mainUpload.size);
		expect(result.assetId).toBe("main-webp");
	});

	it("accepts a data URL source directly", async () => {
		const upload = vi.fn(async () => ({ id: "from-data-url" }));
		const pipeline = createPostProcessPipeline({
			upload,
			decodeImage: fakeDecoder(50, 50),
			createCanvas: recordingCanvasFactory().factory,
		});
		const result = await pipeline.process("data:image/png;base64,QUJD");
		expect(result.assetId).toBe("from-data-url");
		expect(result.mimeType).toBe("image/png");
		expect(result.bytes).toBe(3); // "ABC"
	});
});
