import {
	applyCommand,
	type CanvasImageNode,
	type CanvasImageReplaceCommand,
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	findNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { commitImageReplace } from "../commit-image-replace.js";

const FIXED_TS = "2026-05-21T00:00:00.000Z";
const now = () => FIXED_TS;

/** Minimal IR: one page holding a single image node `imgA` at `asset-1`. */
function buildFixture(): CanvasIR {
	const image = createImage({
		id: "imgA",
		bounds: { width: 300, height: 200 },
		assetId: "asset-1",
	});
	const page = createPage({ id: "page-1" });
	page.root = createGroup({
		id: "page-1-root",
		bounds: page.root.bounds,
		children: [image],
	});
	const ir = createCanvasIR({ id: "ir-1", pages: [page], now });
	ir.assets["asset-1"] = { id: "asset-1", uri: "data:image/png;base64,AAA" };
	ir.assets["asset-2"] = { id: "asset-2", uri: "data:image/png;base64,BBB" };
	return ir;
}

describe("commitImageReplace", () => {
	it("builds an image.replace command and commits it through the injected fn", () => {
		const ir = buildFixture();
		const commit = vi.fn((cmd: CanvasImageReplaceCommand) =>
			applyCommand(ir, cmd, { now }),
		);

		const result = commitImageReplace({
			commit,
			nodeId: "imgA",
			fromAssetId: "asset-1",
			toAssetId: "asset-2",
		});

		// The emitted command is well-formed.
		expect(commit).toHaveBeenCalledTimes(1);
		expect(commit.mock.calls[0]?.[0]).toEqual({
			type: "image.replace",
			nodeId: "imgA",
			fromAssetId: "asset-1",
			toAssetId: "asset-2",
		});

		// The engine applied it: the node now points at asset-2.
		const img = findNode(result.ir, "imgA")?.node as CanvasImageNode;
		expect(img.assetId).toBe("asset-2");
	});

	it("produces an undoable swap (inverse restores the original asset)", () => {
		const ir = buildFixture();
		const commit = (cmd: CanvasImageReplaceCommand) =>
			applyCommand(ir, cmd, { now });

		const forward = commitImageReplace({
			commit,
			nodeId: "imgA",
			fromAssetId: "asset-1",
			toAssetId: "asset-2",
		});
		expect(forward.inverse).toEqual({
			type: "image.replace",
			nodeId: "imgA",
			fromAssetId: "asset-2",
			toAssetId: "asset-1",
		});

		const undone = applyCommand(forward.ir, forward.inverse, { now });
		const img = findNode(undone.ir, "imgA")?.node as CanvasImageNode;
		expect(img.assetId).toBe("asset-1");
	});

	it("rejects empty ids and a non-function commit", () => {
		const commit = vi.fn();
		expect(() =>
			commitImageReplace({
				commit,
				nodeId: "",
				fromAssetId: "asset-1",
				toAssetId: "asset-2",
			}),
		).toThrow(TypeError);
		expect(() =>
			commitImageReplace({
				commit,
				nodeId: "imgA",
				fromAssetId: " ",
				toAssetId: "asset-2",
			}),
		).toThrow(TypeError);
		expect(() =>
			commitImageReplace({
				commit: undefined as never,
				nodeId: "imgA",
				fromAssetId: "asset-1",
				toAssetId: "asset-2",
			}),
		).toThrow(TypeError);
		expect(commit).not.toHaveBeenCalled();
	});
});
