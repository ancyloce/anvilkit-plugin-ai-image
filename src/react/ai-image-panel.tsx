"use client";

import type { CSSProperties, ReactElement } from "react";

import type { CommitCanvasCommandFn } from "../commit/index.js";
import type {
	AiImageJobKind,
	AiJobClient,
	AiLayerContext,
} from "../types/index.js";
import { type UseAiImageOptions, useAiImage } from "./use-ai-image.js";

/** Op order in the selector — text-to-image is first-class. */
const OP_ORDER: readonly AiImageJobKind[] = [
	"text-to-image",
	"variation",
	"inpaint",
	"bg-remove",
	"upscale",
];

const DEFAULT_OP_LABELS: Record<AiImageJobKind, string> = {
	"text-to-image": "Text to image",
	variation: "Variation",
	inpaint: "Inpaint",
	"bg-remove": "Remove background",
	upscale: "Upscale",
};

export interface AiImagePanelProps {
	/**
	 * Drives jobs. Recommended: an {@link AiJobClient} (keeps the I1-5
	 * abort/retry/poll behavior). The panel calls `jobClient.run`.
	 */
	readonly jobClient: AiJobClient;
	/**
	 * Returns the live {@link AiLayerContext}, or `null` when there is no
	 * active artboard/selection. Injected by the host — this package does
	 * not depend on `@anvilkit/canvas-editor`.
	 */
	readonly getLayerContext: () => AiLayerContext | null;
	/** Op selected on first render. Defaults to `"text-to-image"`. */
	readonly defaultOp?: AiImageJobKind;
	/**
	 * Optional — forwarded to {@link useAiImage}. Commits an `image.replace`
	 * when a non-`text-to-image` job completes against the selected node.
	 */
	readonly commit?: CommitCanvasCommandFn;
	/**
	 * Optional — forwarded to {@link useAiImage}. Transforms a completed result
	 * into the final asset id to commit (e.g. via `createPostProcessPipeline`).
	 */
	readonly postProcess?: UseAiImageOptions["postProcess"];
	// Injected i18n copy (English defaults). This external plugin does not
	// consume core's `studio.module.*` i18n store.
	readonly title?: string;
	readonly promptPlaceholder?: string;
	readonly runLabel?: string;
	readonly cancelLabel?: string;
	readonly opLabels?: Partial<Record<AiImageJobKind, string>>;
	readonly noContextLabel?: string;
	readonly className?: string;
}

const containerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	height: "100%",
	padding: "8px",
	fontFamily: "inherit",
	fontSize: "12px",
	color: "var(--ak-studio-fg, inherit)",
};

const opListStyle: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "4px",
	flexShrink: 0,
};

function opButtonStyle(active: boolean): CSSProperties {
	return {
		padding: "4px 8px",
		borderRadius: "var(--ak-studio-radius-sm, 6px)",
		border: `1px solid var(--ak-studio-border, #d4d4d8)`,
		background: active ? "var(--ak-studio-accent, #2563eb)" : "transparent",
		color: active
			? "var(--ak-studio-accent-fg, #ffffff)"
			: "var(--ak-studio-fg, inherit)",
		fontSize: "11px",
		fontWeight: active ? 600 : 500,
		cursor: "pointer",
		fontFamily: "inherit",
	};
}

const bodyStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	flex: 1,
	minHeight: 0,
	overflow: "auto",
};

const labelStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "3px",
	fontSize: "11px",
	color: "var(--ak-studio-muted-fg, #71717a)",
};

const fieldStyle: CSSProperties = {
	width: "100%",
	boxSizing: "border-box",
	padding: "6px 8px",
	borderRadius: "var(--ak-studio-radius-sm, 6px)",
	border: "1px solid var(--ak-studio-border, #d4d4d8)",
	background: "var(--ak-studio-bg, #ffffff)",
	color: "var(--ak-studio-fg, inherit)",
	fontSize: "12px",
	fontFamily: "inherit",
};

const actionRowStyle: CSSProperties = {
	display: "flex",
	gap: "6px",
	flexShrink: 0,
};

function primaryButtonStyle(disabled: boolean): CSSProperties {
	return {
		padding: "6px 12px",
		borderRadius: "var(--ak-studio-radius-sm, 6px)",
		border: "none",
		background: "var(--ak-studio-accent, #2563eb)",
		color: "var(--ak-studio-accent-fg, #ffffff)",
		fontSize: "12px",
		fontWeight: 600,
		cursor: disabled ? "not-allowed" : "pointer",
		opacity: disabled ? 0.5 : 1,
		fontFamily: "inherit",
	};
}

const cancelButtonStyle: CSSProperties = {
	padding: "6px 12px",
	borderRadius: "var(--ak-studio-radius-sm, 6px)",
	border: "1px solid var(--ak-studio-border, #d4d4d8)",
	background: "transparent",
	color: "var(--ak-studio-fg, inherit)",
	fontSize: "12px",
	cursor: "pointer",
	fontFamily: "inherit",
};

const noticeStyle: CSSProperties = {
	fontSize: "11px",
	color: "var(--ak-studio-muted-fg, #71717a)",
};

const errorStyle: CSSProperties = {
	fontSize: "11px",
	color: "var(--ak-studio-danger-fg, #dc2626)",
	wordBreak: "break-word",
};

const resultStyle: CSSProperties = {
	fontSize: "11px",
	color: "var(--ak-studio-fg, inherit)",
	wordBreak: "break-word",
};

/**
 * The AI-image sidebar surface. A presentational shell over
 * {@link useAiImage}: an op selector, the per-op input fields, a
 * Run/Cancel control, and a status/result/error region. Self-contained
 * inline styling (mirrors `DesignSystemPanel`) so the panel renders
 * consistently in the Studio sidebar without the consumer needing to
 * process Tailwind utilities from this package.
 */
export function AiImagePanel(props: AiImagePanelProps): ReactElement {
	const {
		jobClient,
		getLayerContext,
		defaultOp,
		commit,
		postProcess,
		title = "AI Image",
		promptPlaceholder = "Describe the image to generate…",
		runLabel = "Generate",
		cancelLabel = "Cancel",
		opLabels,
		noContextLabel = "Select an artboard to run AI image tools.",
		className,
	} = props;

	const ai = useAiImage({
		run: (request, context, options) =>
			jobClient.run(request, context, options),
		getLayerContext,
		defaultOp,
		commit,
		postProcess,
	});

	const labelFor = (kind: AiImageJobKind): string =>
		opLabels?.[kind] ?? DEFAULT_OP_LABELS[kind];

	const showPrompt = ai.op === "text-to-image" || ai.op === "inpaint";
	const showNegativePrompt = ai.op === "text-to-image";
	const showSource = ai.op !== "text-to-image";
	const showMask = ai.op === "inpaint";
	const showSeed = ai.op !== "bg-remove" && ai.op !== "upscale";

	return (
		<div
			data-testid="ak-module-ai-image"
			className={className}
			style={containerStyle}
		>
			<div
				role="group"
				aria-label={title}
				style={opListStyle}
				data-testid="ai-image-op-list"
			>
				{OP_ORDER.map((kind) => (
					<button
						key={kind}
						type="button"
						aria-pressed={ai.op === kind}
						style={opButtonStyle(ai.op === kind)}
						onClick={() => ai.onOpChange(kind)}
						data-testid={`ai-image-op-${kind}`}
					>
						{labelFor(kind)}
					</button>
				))}
			</div>

			<div style={bodyStyle}>
				{showPrompt ? (
					<label style={labelStyle}>
						Prompt
						<textarea
							data-testid="ai-image-prompt"
							style={{ ...fieldStyle, minHeight: "64px", resize: "vertical" }}
							placeholder={promptPlaceholder}
							value={ai.prompt}
							onChange={(event) => ai.onPromptChange(event.target.value)}
						/>
					</label>
				) : null}

				{showNegativePrompt ? (
					<label style={labelStyle}>
						Negative prompt
						<input
							data-testid="ai-image-negative-prompt"
							style={fieldStyle}
							value={ai.negativePrompt}
							onChange={(event) =>
								ai.onNegativePromptChange(event.target.value)
							}
						/>
					</label>
				) : null}

				{showSource ? (
					<label style={labelStyle}>
						Source asset id
						<input
							data-testid="ai-image-source"
							style={fieldStyle}
							value={ai.sourceAssetId}
							onChange={(event) => ai.onSourceAssetIdChange(event.target.value)}
						/>
					</label>
				) : null}

				{showMask ? (
					<label style={labelStyle}>
						Mask asset id
						<input
							data-testid="ai-image-mask"
							style={fieldStyle}
							value={ai.maskAssetId}
							onChange={(event) => ai.onMaskAssetIdChange(event.target.value)}
						/>
					</label>
				) : null}

				{showSeed ? (
					<label style={labelStyle}>
						Seed (optional)
						<input
							data-testid="ai-image-seed"
							inputMode="numeric"
							style={fieldStyle}
							value={ai.seed}
							onChange={(event) => ai.onSeedChange(event.target.value)}
						/>
					</label>
				) : null}

				{!ai.hasLayerContext ? (
					<p data-testid="ai-image-no-context" style={noticeStyle}>
						{noContextLabel}
					</p>
				) : null}

				{ai.status === "pending" ? (
					<p
						data-testid="ai-image-status"
						style={noticeStyle}
						aria-live="polite"
					>
						Generating…
					</p>
				) : null}

				{ai.result?.resultAssetId ? (
					<p data-testid="ai-image-result" style={resultStyle}>
						Result asset: {ai.result.resultAssetId}
					</p>
				) : null}

				{ai.error ? (
					<p data-testid="ai-image-error" style={errorStyle} role="alert">
						{ai.error}
					</p>
				) : null}
			</div>

			<div style={actionRowStyle}>
				<button
					type="button"
					data-testid="ai-image-run"
					disabled={!ai.canRun}
					style={primaryButtonStyle(!ai.canRun)}
					onClick={ai.onRun}
				>
					{runLabel}
				</button>
				{ai.status === "pending" ? (
					<button
						type="button"
						data-testid="ai-image-cancel"
						style={cancelButtonStyle}
						onClick={ai.onCancel}
					>
						{cancelLabel}
					</button>
				) : null}
			</div>
		</div>
	);
}
