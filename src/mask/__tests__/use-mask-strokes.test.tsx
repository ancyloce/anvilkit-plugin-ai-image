// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMaskStrokes } from "../use-mask-strokes.js";

describe("useMaskStrokes", () => {
	it("builds one stroke across start → extend → end", () => {
		let seq = 0;
		const { result } = renderHook(() =>
			useMaskStrokes({ brushSize: 12, generateId: () => `s${(seq += 1)}` }),
		);
		act(() => result.current.onStrokeStart({ x: 1, y: 2 }));
		act(() => result.current.onStrokeExtend({ x: 3, y: 4 }));
		act(() => result.current.onStrokeEnd());
		expect(result.current.strokes).toEqual([
			{ id: "s1", points: [1, 2, 3, 4], width: 12 },
		]);
	});

	it("treats extend without an active stroke as a no-op", () => {
		const { result } = renderHook(() => useMaskStrokes());
		act(() => result.current.onStrokeExtend({ x: 1, y: 1 }));
		expect(result.current.strokes).toEqual([]);
	});

	it("starts a fresh stroke after the previous one ends", () => {
		let seq = 0;
		const { result } = renderHook(() =>
			useMaskStrokes({ generateId: () => `s${(seq += 1)}` }),
		);
		act(() => result.current.onStrokeStart({ x: 0, y: 0 }));
		act(() => result.current.onStrokeEnd());
		act(() => result.current.onStrokeStart({ x: 5, y: 5 }));
		expect(result.current.strokes).toHaveLength(2);
		expect(result.current.strokes[1]?.id).toBe("s2");
	});

	it("clear() drops all strokes and the active stroke", () => {
		const { result } = renderHook(() => useMaskStrokes());
		act(() => result.current.onStrokeStart({ x: 0, y: 0 }));
		act(() => result.current.clear());
		expect(result.current.strokes).toEqual([]);
		// A subsequent extend after clear is inert (active stroke was reset).
		act(() => result.current.onStrokeExtend({ x: 9, y: 9 }));
		expect(result.current.strokes).toEqual([]);
	});

	it("setBrushSize controls the width of the next stroke", () => {
		const { result } = renderHook(() =>
			useMaskStrokes({ brushSize: 8, generateId: () => "s" }),
		);
		act(() => result.current.setBrushSize(40));
		act(() => result.current.onStrokeStart({ x: 0, y: 0 }));
		expect(result.current.strokes.at(-1)?.width).toBe(40);
	});
});
