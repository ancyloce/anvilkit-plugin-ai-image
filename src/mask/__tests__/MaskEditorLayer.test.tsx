// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface El {
	type: string;
	props: Record<string, unknown>;
}
const elements: El[] = [];
function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		elements.push({ type, props });
		const { children } = props as { children?: ReactNode };
		return <div data-konva={type}>{children}</div>;
	};
}
vi.mock("react-konva", () => ({
	Layer: makeMock("Layer"),
	Group: makeMock("Group"),
	Rect: makeMock("Rect"),
	Line: makeMock("Line"),
}));

import { MaskEditorLayer } from "../MaskEditorLayer.js";
import type { MaskStroke } from "../types.js";

const lineEls = () => elements.filter((e) => e.type === "Line");
const first = (type: string) => elements.find((e) => e.type === type);

function stageEvent(x: number | null, y = 0) {
	return {
		target: {
			getStage: () => ({
				getPointerPosition: () => (x === null ? null : { x, y }),
			}),
		},
	};
}

const BOUNDS = { x: 10, y: 20, width: 100, height: 80 };

describe("MaskEditorLayer", () => {
	beforeEach(() => {
		elements.length = 0;
	});

	it("renders the mask-edit layer with a bounds-translated group", () => {
		render(
			<MaskEditorLayer
				bounds={BOUNDS}
				strokes={[]}
				onStrokeStart={vi.fn()}
				onStrokeExtend={vi.fn()}
				onStrokeEnd={vi.fn()}
			/>,
		);
		expect(first("Layer")?.props.name).toBe("mask-edit-layer");
		const group = first("Group");
		expect(group?.props.x).toBe(10);
		expect(group?.props.y).toBe(20);
	});

	it("renders one round-capped Line per stroke", () => {
		const strokes: MaskStroke[] = [
			{ id: "a", points: [1, 2, 3, 4], width: 8 },
			{ id: "b", points: [5, 6], width: 4 },
		];
		render(
			<MaskEditorLayer
				bounds={BOUNDS}
				strokes={strokes}
				strokeColor="rgba(255,255,255,0.6)"
				onStrokeStart={vi.fn()}
				onStrokeExtend={vi.fn()}
				onStrokeEnd={vi.fn()}
			/>,
		);
		const lines = lineEls();
		expect(lines).toHaveLength(2);
		expect(lines[0]?.props.points).toEqual([1, 2, 3, 4]);
		expect(lines[0]?.props.strokeWidth).toBe(8);
		expect(lines[0]?.props.stroke).toBe("rgba(255,255,255,0.6)");
		expect(lines[0]?.props.lineCap).toBe("round");
		expect(lines[0]?.props.lineJoin).toBe("round");
		expect(lines[0]?.props.globalCompositeOperation).toBe("source-over");
		expect(lines[0]?.props.listening).toBe(false);
	});

	it("forwards bounds-local points through the stroke callbacks", () => {
		const onStrokeStart = vi.fn();
		const onStrokeExtend = vi.fn();
		const onStrokeEnd = vi.fn();
		render(
			<MaskEditorLayer
				bounds={BOUNDS}
				strokes={[]}
				onStrokeStart={onStrokeStart}
				onStrokeExtend={onStrokeExtend}
				onStrokeEnd={onStrokeEnd}
			/>,
		);
		const rect = first("Rect");
		expect(rect).toBeDefined();
		(rect?.props.onMouseDown as (e: unknown) => void)(stageEvent(30, 50));
		// Stage point (30,50) minus bounds origin (10,20) → local (20,30).
		expect(onStrokeStart).toHaveBeenCalledWith({ x: 20, y: 30 });
		(rect?.props.onMouseMove as (e: unknown) => void)(stageEvent(40, 60));
		expect(onStrokeExtend).toHaveBeenCalledWith({ x: 30, y: 40 });
		(rect?.props.onMouseUp as () => void)();
		expect(onStrokeEnd).toHaveBeenCalledTimes(1);
	});

	it("ignores pointer events when the stage has no pointer position", () => {
		const onStrokeStart = vi.fn();
		render(
			<MaskEditorLayer
				bounds={BOUNDS}
				strokes={[]}
				onStrokeStart={onStrokeStart}
				onStrokeExtend={vi.fn()}
				onStrokeEnd={vi.fn()}
			/>,
		);
		const rect = first("Rect");
		(rect?.props.onMouseDown as (e: unknown) => void)(stageEvent(null));
		expect(onStrokeStart).not.toHaveBeenCalled();
	});
});
