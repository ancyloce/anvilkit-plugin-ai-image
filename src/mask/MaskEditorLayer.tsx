"use client";

import type { AiLayerBounds } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { Group, Layer, Line, Rect } from "react-konva";
import type { MaskStroke } from "./types.js";
import type { MaskPoint } from "./use-mask-strokes.js";

export interface MaskEditorLayerProps {
	/** World rect of the target image the mask overlays. */
	bounds: AiLayerBounds;
	/** Strokes to render (mask-local coords). Controlled — see `useMaskStrokes`. */
	strokes: readonly MaskStroke[];
	/** Brush width preview for the cursor copy; strokes carry their own width. */
	brushSize?: number;
	/** Preview stroke colour. Default semi-transparent white (PRD FR-022). */
	strokeColor?: string;
	onStrokeStart: (point: MaskPoint) => void;
	onStrokeExtend: (point: MaskPoint) => void;
	onStrokeEnd: () => void;
}

// Base `Event` so the same handler satisfies both react-konva's mouse and
// touch handler props (onMouseDown wants MouseEvent, onTouchStart wants
// TouchEvent — both extend Event).
type MaskPointerEvent = Konva.KonvaEventObject<Event>;

const DEFAULT_STROKE_COLOR = "rgba(255,255,255,0.6)";

/**
 * I1-7/I1-8 mask-edit overlay (PRD FR-022). A react-konva
 * `<Layer name="mask-edit-layer">` rendered over the selected image's `bounds`
 * (via a translated `<Group>`, so stroke coords are mask-local). A transparent
 * hit `<Rect>` captures pointer strokes and forwards mask-local points to the
 * `onStroke*` callbacks — wire them to {@link useMaskStrokes}.
 *
 * Captures only; it never writes to the canvas IR/history. Mounting this onto a
 * live `<CanvasStudio>` stage is deferred integration (host-owned).
 */
export function MaskEditorLayer({
	bounds,
	strokes,
	strokeColor = DEFAULT_STROKE_COLOR,
	onStrokeStart,
	onStrokeExtend,
	onStrokeEnd,
}: MaskEditorLayerProps): React.JSX.Element {
	/** Stage pointer position translated into bounds-local coordinates. */
	const localPoint = (e: MaskPointerEvent): MaskPoint | null => {
		const stage = e.target?.getStage?.();
		const pos = stage?.getPointerPosition?.();
		if (!pos) return null;
		return { x: pos.x - bounds.x, y: pos.y - bounds.y };
	};

	const handleDown = (e: MaskPointerEvent) => {
		const p = localPoint(e);
		if (p) onStrokeStart(p);
	};
	const handleMove = (e: MaskPointerEvent) => {
		const p = localPoint(e);
		if (p) onStrokeExtend(p);
	};
	const handleUp = () => {
		onStrokeEnd();
	};

	return (
		<Layer name="mask-edit-layer">
			<Group x={bounds.x} y={bounds.y}>
				<Rect
					x={0}
					y={0}
					width={bounds.width}
					height={bounds.height}
					fill="rgba(0,0,0,0.001)"
					onMouseDown={handleDown}
					onMouseMove={handleMove}
					onMouseUp={handleUp}
					onMouseLeave={handleUp}
					onTouchStart={handleDown}
					onTouchMove={handleMove}
					onTouchEnd={handleUp}
				/>
				{strokes.map((stroke) => (
					<Line
						key={stroke.id}
						points={stroke.points}
						stroke={strokeColor}
						strokeWidth={stroke.width}
						lineCap="round"
						lineJoin="round"
						globalCompositeOperation="source-over"
						listening={false}
					/>
				))}
			</Group>
		</Layer>
	);
}
