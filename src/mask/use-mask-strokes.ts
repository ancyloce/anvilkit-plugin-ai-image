"use client";

import { useCallback, useRef, useState } from "react";
import type { MaskStroke } from "./types.js";

export interface MaskPoint {
	x: number;
	y: number;
}

export interface UseMaskStrokesOptions {
	/** Initial brush width in mask-local px. Default `24`. */
	brushSize?: number;
	/** Id generator for new strokes (inject for deterministic tests). */
	generateId?: () => string;
}

export interface UseMaskStrokesResult {
	readonly strokes: MaskStroke[];
	readonly brushSize: number;
	readonly setBrushSize: (next: number) => void;
	/** Begin a stroke at `point` (mask-local coords). */
	readonly onStrokeStart: (point: MaskPoint) => void;
	/** Append `point` to the in-progress stroke (no-op if none active). */
	readonly onStrokeExtend: (point: MaskPoint) => void;
	/** Finish the in-progress stroke. */
	readonly onStrokeEnd: () => void;
	/** Drop all strokes. */
	readonly clear: () => void;
}

let autoSeq = 0;

function createMaskStrokeId(): string {
	return `mask-stroke-${(autoSeq += 1)}`;
}

/**
 * Local-state controller for {@link MaskEditorLayer} (PRD FR-022: "captures
 * strokes (local state, no global writes)"). Owns the stroke list + brush size;
 * never touches the canvas IR/history. Pair its `strokes` with
 * {@link MaskToAssetExporter} to produce a `maskAssetId`.
 */
export function useMaskStrokes(
	options: UseMaskStrokesOptions = {},
): UseMaskStrokesResult {
	const generateId = options.generateId ?? createMaskStrokeId;
	const [strokes, setStrokes] = useState<MaskStroke[]>([]);
	const [brushSize, setBrushSize] = useState(options.brushSize ?? 24);
	const activeIdRef = useRef<string | null>(null);

	const onStrokeStart = useCallback(
		(point: MaskPoint) => {
			const id = generateId();
			activeIdRef.current = id;
			setStrokes((prev) => [
				...prev,
				{ id, points: [point.x, point.y], width: brushSize },
			]);
		},
		[brushSize, generateId],
	);

	const onStrokeExtend = useCallback((point: MaskPoint) => {
		const id = activeIdRef.current;
		if (id === null) return;
		setStrokes((prev) =>
			prev.map((s) =>
				s.id === id ? { ...s, points: [...s.points, point.x, point.y] } : s,
			),
		);
	}, []);

	const onStrokeEnd = useCallback(() => {
		activeIdRef.current = null;
	}, []);

	const clear = useCallback(() => {
		activeIdRef.current = null;
		setStrokes([]);
	}, []);

	return {
		strokes,
		brushSize,
		setBrushSize,
		onStrokeStart,
		onStrokeExtend,
		onStrokeEnd,
		clear,
	};
}
