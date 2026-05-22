/**
 * I1-8 mask types (PRD FR-022). A mask is a set of brush strokes painted over
 * a selected image; `MaskToAssetExporter` rasterises them to an alpha PNG and
 * uploads it, producing the `maskAssetId` an inpaint job consumes.
 */

/** A single brush stroke in mask-local pixel coordinates. */
export interface MaskStroke {
	id: string;
	/** Flat polyline `[x0, y0, x1, y1, …]`. A single point renders as a dot. */
	points: number[];
	/** Brush width in mask-local pixels. */
	width: number;
}

/** Output dimensions of the rasterised mask (typically the source image size). */
export interface MaskDimensions {
	width: number;
	height: number;
}
