"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Alert, AlertDescription, AlertTitle } from "@anvilkit/ui/alert";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import { Label } from "@anvilkit/ui/label";
import { Progress } from "@anvilkit/ui/progress";
import { Textarea } from "@anvilkit/ui/textarea";
import type { CSSProperties, ReactElement } from "react";
import { useState } from "react";

import type {
	CommitAiDesignCommandFn,
	CommitCanvasCommandFn,
} from "../commit/index.js";
import type {
	AiDesignJobKind,
	AiDesignJobRequest,
	AiDesignJobResult,
	AiImageCapability,
	AiImageJobKind,
	AiImageProviderDescriptor,
	AiJobClient,
	AiLayerContext,
	AiProviderCapabilities,
	BrandKitDefinition,
} from "../types/index.js";
import { useAiDesign } from "./use-ai-design.js";
import { type UseAiImageOptions, useAiImage } from "./use-ai-image.js";

/**
 * Op order in the selector — text-to-image is first-class. The four
 * FR-050 (canvas-m4-001) image-editing ops are last, in the order UX-006
 * names them (remove/replace/expand background, plus fill/erase as the
 * mask-driven siblings of inpaint).
 */
const OP_ORDER: readonly AiImageJobKind[] = [
	"text-to-image",
	"variation",
	"inpaint",
	"bg-remove",
	"upscale",
	"generative-fill",
	"generative-expand",
	"object-erase",
	"background-replace",
];

const DEFAULT_OP_LABELS: Record<AiImageJobKind, string> = {
	"text-to-image": "Text to image",
	variation: "Variation",
	inpaint: "Inpaint",
	"bg-remove": "Remove background",
	upscale: "Upscale",
	"generative-fill": "Generative fill",
	"generative-expand": "Generative expand",
	"object-erase": "Erase object",
	"background-replace": "Replace background",
};

const DEFAULT_PROMPT_EXAMPLES: Partial<
	Record<AiImageJobKind, readonly string[]>
> = {
	"text-to-image": [
		"Editorial product photo on a soft neutral background",
		"Paper-cut landscape with warm sunrise colors",
	],
	"generative-expand": ["Continue the scene naturally beyond the edges"],
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
	/**
	 * Which ops the host's provider actually supports (FR-051,
	 * canvas-m4-002). When set, the op selector only shows ops in
	 * `capabilities.imageOps`; omitted keeps the pre-M4 behavior of showing
	 * every built-in op regardless of provider support.
	 */
	readonly capabilities?: AiProviderCapabilities;
	/** Detailed discovery result with availability, constraints, and costs. */
	readonly providerDescriptor?: AiImageProviderDescriptor;
	/** Document-scoped persistence, recovery, connectivity, and permission state. */
	readonly jobSession?: UseAiImageOptions["jobSession"];
	/** Content-free lifecycle and apply/discard telemetry. */
	readonly telemetry?: UseAiImageOptions["telemetry"];
	/** Op selected on first render. Defaults to `"text-to-image"`. */
	readonly defaultOp?: AiImageJobKind;
	/**
	 * Optional — forwarded to {@link useAiImage}. Commits an `image.replace`
	 * when a non-`text-to-image` job completes against the selected node.
	 */
	readonly commit?: CommitCanvasCommandFn;
	/** Explicit host adapter for applying a preview as a replace or inserted copy. */
	readonly applyResult?: UseAiImageOptions["applyResult"];
	/** Resolves a document or provider asset id into previewable image bytes. */
	readonly resolveAssetUrl?: (assetId: string) => string | undefined;
	/**
	 * Optional — forwarded to {@link useAiImage}. Transforms a completed result
	 * into the final asset id to commit (e.g. via `createPostProcessPipeline`).
	 */
	readonly postProcess?: UseAiImageOptions["postProcess"];
	/**
	 * Drives the FR-053 (canvas-m4-004) design actions — rewrite selected
	 * text, generate layout variants, apply brand kit via AI. Omitted hides
	 * the whole design-actions section (pre-M4 hosts see unchanged behavior).
	 */
	readonly designJobClient?: AiJobClient<
		AiDesignJobRequest,
		AiDesignJobResult,
		AiLayerContext
	>;
	/** Validates then commits a completed design job's result (canvas-m4-003's bridge). */
	readonly designCommit?: CommitAiDesignCommandFn;
	/** Required for the "apply brand kit via AI" action; omitted hides that one action. */
	readonly brandKit?: BrandKitDefinition;
	// Injected i18n copy (English defaults). This external plugin does not
	// consume core's `studio.module.*` i18n store.
	readonly title?: string;
	readonly promptPlaceholder?: string;
	readonly runLabel?: string;
	readonly cancelLabel?: string;
	readonly retryLabel?: string;
	readonly replaceLabel?: string;
	readonly insertCopyLabel?: string;
	readonly discardLabel?: string;
	readonly opLabels?: Partial<Record<AiImageJobKind, string>>;
	readonly examples?: Partial<Record<AiImageJobKind, readonly string[]>>;
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

const previewStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	gap: "8px",
};

const previewImageStyle: CSSProperties = {
	display: "block",
	width: "100%",
	aspectRatio: "1 / 1",
	objectFit: "contain",
	borderRadius: "var(--ak-studio-radius-sm, 6px)",
	background: "var(--ak-studio-muted, #f4f4f5)",
	outline: "1px solid color-mix(in srgb, currentColor 12%, transparent)",
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
		capabilities,
		providerDescriptor,
		jobSession,
		telemetry,
		defaultOp,
		commit,
		applyResult,
		resolveAssetUrl,
		postProcess,
		designJobClient,
		designCommit,
		brandKit,
		title,
		promptPlaceholder,
		runLabel,
		cancelLabel,
		retryLabel,
		replaceLabel,
		insertCopyLabel,
		discardLabel,
		opLabels,
		examples = DEFAULT_PROMPT_EXAMPLES,
		noContextLabel,
		className,
	} = props;

	const detailedCapabilities = providerDescriptor?.capabilities;
	const visibleOps = detailedCapabilities
		? OP_ORDER.filter((kind) =>
				detailedCapabilities.some((capability) => capability.kind === kind),
			)
		: capabilities?.imageOps
			? OP_ORDER.filter((kind) => capabilities.imageOps?.includes(kind))
			: OP_ORDER;
	const capabilityFor = (kind: AiImageJobKind): AiImageCapability | undefined =>
		detailedCapabilities?.find((capability) => capability.kind === kind);
	const resolvedDefaultOp =
		defaultOp && visibleOps.includes(defaultOp)
			? defaultOp
			: (visibleOps.find((kind) => capabilityFor(kind)?.available !== false) ??
				"text-to-image");

	const supportsDesignOp = (kind: AiDesignJobKind): boolean =>
		capabilities?.designOps ? capabilities.designOps.includes(kind) : true;

	const msg = useMsg();
	// Localizable defaults from the `aiImage.*` catalog; host props still win.
	const titleText = title ?? msg("aiImage.panel.title");
	const promptPlaceholderText =
		promptPlaceholder ?? msg("aiImage.panel.promptPlaceholder");
	const runLabelText = runLabel ?? msg("aiImage.panel.run");
	const cancelLabelText = cancelLabel ?? msg("aiImage.panel.cancel");
	const retryLabelText = retryLabel ?? msg("aiImage.panel.retry", "Retry task");
	const replaceLabelText =
		replaceLabel ?? msg("aiImage.preview.replace", "Replace original");
	const insertCopyLabelText =
		insertCopyLabel ?? msg("aiImage.preview.insertCopy", "Insert as copy");
	const discardLabelText =
		discardLabel ?? msg("aiImage.preview.discard", "Discard");
	const noContextLabelText = noContextLabel ?? msg("aiImage.panel.noContext");
	let selectedContext: AiLayerContext | null = null;
	try {
		selectedContext = getLayerContext();
	} catch {
		selectedContext = null;
	}

	const ai = useAiImage({
		run: (request, context, options) =>
			jobClient.run(request, context, options),
		getLayerContext,
		defaultOp: resolvedDefaultOp,
		capabilities: detailedCapabilities,
		jobSession,
		telemetry,
		applyResult,
		commit,
		postProcess,
	});
	const originalPreviewUrl = ai.preview?.originalAssetId
		? resolveAssetUrl?.(ai.preview.originalAssetId)
		: undefined;
	const resultPreviewUrl = ai.preview
		? resolveAssetUrl?.(ai.preview.result.resultAssetId)
		: undefined;

	const labelFor = (kind: AiImageJobKind): string =>
		opLabels?.[kind] ?? msg(`aiImage.op.${kind}`, DEFAULT_OP_LABELS[kind]);
	const unavailableReasonFor = (kind: AiImageJobKind): string | null => {
		const capability = capabilityFor(kind);
		if (capability && !capability.available) {
			return (
				capability.unavailableReason ??
				msg(
					"aiImage.requirement.providerUnavailable",
					"This provider does not currently support the selected task.",
				)
			);
		}
		if (
			kind !== "text-to-image" &&
			(!selectedContext?.selectedNodeId ||
				(selectedContext.selectedNodeKind !== undefined &&
					selectedContext.selectedNodeKind !== "image"))
		) {
			return msg(
				"aiImage.requirement.imageSelection",
				"Select an image on the active page to use this task.",
			);
		}
		return null;
	};
	const promptExamples = examples[ai.op] ?? [];
	const selectionRequirement =
		visibleOps.some((kind) => kind !== "text-to-image") &&
		(!selectedContext?.selectedNodeId ||
			(selectedContext.selectedNodeKind !== undefined &&
				selectedContext.selectedNodeKind !== "image"))
			? msg(
					"aiImage.requirement.imageSelection",
					"Select an image on the active page to use this task.",
				)
			: null;

	const showPrompt =
		ai.op === "text-to-image" ||
		ai.op === "inpaint" ||
		ai.op === "generative-fill" ||
		ai.op === "generative-expand" ||
		ai.op === "background-replace";
	const showNegativePrompt = ai.op === "text-to-image";
	const showSource = ai.op !== "text-to-image";
	const showMask =
		ai.op === "inpaint" ||
		ai.op === "generative-fill" ||
		ai.op === "object-erase";
	const showTargetSize = ai.op === "generative-expand";
	const showSeed =
		ai.op !== "bg-remove" &&
		ai.op !== "upscale" &&
		ai.op !== "generative-expand" &&
		ai.op !== "object-erase";

	// Design actions (FR-053, canvas-m4-004). Hooks always run (rules of
	// hooks); the section itself renders nothing when the host omitted
	// `designJobClient`.
	const design = useAiDesign({
		run: (request, context, options) => {
			if (!designJobClient) {
				throw new Error(
					"AiImagePanel: a design action fired without a designJobClient.",
				);
			}
			return designJobClient.run(request, context, options);
		},
		getLayerContext,
		commit: designCommit,
	});
	const [rewriteInstruction, setRewriteInstruction] = useState("");
	const [layoutVariantCount, setLayoutVariantCount] = useState("");

	const selectedKind = selectedContext?.selectedNodeKind;
	// Permissive when unknown (no selection info yet), matching the
	// capabilities-omitted convention elsewhere in this panel.
	const selectionLooksLikeText =
		selectedKind === undefined ||
		selectedKind === "text" ||
		selectedKind === "rich-text";

	return (
		<div
			data-testid="ak-module-ai-image"
			className={className}
			style={containerStyle}
		>
			<div
				role="group"
				aria-label={titleText}
				style={opListStyle}
				data-testid="ai-image-op-list"
			>
				{visibleOps.map((kind) => {
					const unavailableReason = unavailableReasonFor(kind);
					return (
						<Button
							key={kind}
							type="button"
							size="xs"
							variant={ai.op === kind ? "default" : "outline"}
							aria-pressed={ai.op === kind}
							disabled={unavailableReason !== null}
							title={unavailableReason ?? undefined}
							style={opButtonStyle(ai.op === kind)}
							onClick={() => ai.onOpChange(kind)}
							data-testid={`ai-image-op-${kind}`}
						>
							{labelFor(kind)}
						</Button>
					);
				})}
			</div>
			{visibleOps.length === 0 ? (
				<Alert data-testid="ai-image-provider-empty">
					<AlertTitle>
						{msg("aiImage.provider.emptyTitle", "No AI image tasks available")}
					</AlertTitle>
					<AlertDescription>
						{msg(
							"aiImage.provider.emptyDescription",
							"Configure a compatible provider to enable AI image tasks.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{selectionRequirement ? (
				<p data-testid="ai-image-selection-requirement" style={noticeStyle}>
					{selectionRequirement}
				</p>
			) : null}

			<div style={bodyStyle}>
				{showPrompt ? (
					<Label style={labelStyle}>
						{msg("aiImage.field.prompt")}
						<Textarea
							data-testid="ai-image-prompt"
							style={{ ...fieldStyle, minHeight: "64px", resize: "vertical" }}
							placeholder={promptPlaceholderText}
							value={ai.prompt}
							onChange={(event) => ai.onPromptChange(event.target.value)}
						/>
					</Label>
				) : null}

				{showPrompt && promptExamples.length > 0 ? (
					<div data-testid="ai-image-examples" style={opListStyle}>
						<span style={noticeStyle}>
							{msg("aiImage.panel.examples", "Try an example:")}
						</span>
						{promptExamples.map((example) => (
							<Button
								key={example}
								type="button"
								size="xs"
								variant="outline"
								onClick={() => ai.onPromptChange(example)}
							>
								{example}
							</Button>
						))}
					</div>
				) : null}

				{showNegativePrompt ? (
					<Label style={labelStyle}>
						{msg("aiImage.field.negativePrompt")}
						<Input
							data-testid="ai-image-negative-prompt"
							style={fieldStyle}
							value={ai.negativePrompt}
							onChange={(event) =>
								ai.onNegativePromptChange(event.target.value)
							}
						/>
					</Label>
				) : null}

				{showSource ? (
					<Label style={labelStyle}>
						{msg("aiImage.field.sourceAssetId")}
						<Input
							data-testid="ai-image-source"
							style={fieldStyle}
							value={ai.sourceAssetId}
							placeholder={selectedContext?.selectedAssetId}
							onChange={(event) => ai.onSourceAssetIdChange(event.target.value)}
						/>
					</Label>
				) : null}

				{showMask ? (
					<Label style={labelStyle}>
						{msg("aiImage.field.maskAssetId")}
						<Input
							data-testid="ai-image-mask"
							style={fieldStyle}
							value={ai.maskAssetId}
							onChange={(event) => ai.onMaskAssetIdChange(event.target.value)}
						/>
					</Label>
				) : null}

				{showTargetSize ? (
					<>
						<Label style={labelStyle}>
							{msg("aiImage.field.targetWidth")}
							<Input
								data-testid="ai-image-target-width"
								inputMode="numeric"
								style={fieldStyle}
								value={ai.targetWidth}
								onChange={(event) => ai.onTargetWidthChange(event.target.value)}
							/>
						</Label>
						<Label style={labelStyle}>
							{msg("aiImage.field.targetHeight")}
							<Input
								data-testid="ai-image-target-height"
								inputMode="numeric"
								style={fieldStyle}
								value={ai.targetHeight}
								onChange={(event) =>
									ai.onTargetHeightChange(event.target.value)
								}
							/>
						</Label>
					</>
				) : null}

				{showSeed ? (
					<Label style={labelStyle}>
						{msg("aiImage.field.seed")}
						<Input
							data-testid="ai-image-seed"
							inputMode="numeric"
							style={fieldStyle}
							value={ai.seed}
							onChange={(event) => ai.onSeedChange(event.target.value)}
						/>
					</Label>
				) : null}

				{!ai.hasLayerContext ? (
					<p data-testid="ai-image-no-context" style={noticeStyle}>
						{noContextLabelText}
					</p>
				) : null}

				{ai.status === "pending" ? (
					<div
						data-testid="ai-image-status"
						style={noticeStyle}
						aria-live="polite"
					>
						<p>
							{msg("aiImage.status.generating")}
							{ai.progress?.progress !== undefined
								? ` ${Math.round(ai.progress.progress * 100)}%`
								: ""}
						</p>
						<Progress
							data-testid="ai-image-progress"
							aria-label={msg("aiImage.status.progress", "AI image progress")}
							value={
								ai.progress?.progress === undefined
									? null
									: ai.progress.progress * 100
							}
						/>
					</div>
				) : null}

				{ai.preview ? (
					<section
						data-testid="ai-image-preview"
						aria-label={msg("aiImage.preview.title", "Review AI image result")}
						style={{ display: "flex", flexDirection: "column", gap: "8px" }}
					>
						<div style={previewStyle}>
							{ai.preview.originalAssetId ? (
								<figure style={{ margin: 0 }}>
									<figcaption style={noticeStyle}>
										{msg("aiImage.preview.original", "Original")}
									</figcaption>
									{originalPreviewUrl ? (
										<img
											data-testid="ai-image-preview-original"
											src={originalPreviewUrl}
											alt={msg("aiImage.preview.originalAlt", "Original image")}
											style={previewImageStyle}
										/>
									) : (
										<p style={resultStyle}>{ai.preview.originalAssetId}</p>
									)}
								</figure>
							) : null}
							<figure data-testid="ai-image-result" style={{ margin: 0 }}>
								<figcaption style={noticeStyle}>
									{msg("aiImage.preview.result", "Result")}
								</figcaption>
								{resultPreviewUrl ? (
									<img
										data-testid="ai-image-preview-result"
										src={resultPreviewUrl}
										alt={msg("aiImage.preview.resultAlt", "Generated result")}
										style={previewImageStyle}
									/>
								) : (
									<p style={resultStyle}>
										{msg("aiImage.result.prefix")}
										{ai.preview.result.resultAssetId}
									</p>
								)}
							</figure>
						</div>
						<div style={actionRowStyle}>
							<Button
								type="button"
								data-testid="ai-image-preview-replace"
								disabled={!ai.canReplace}
								onClick={() => ai.onApply("replace")}
							>
								{replaceLabelText}
							</Button>
							<Button
								type="button"
								data-testid="ai-image-preview-insert-copy"
								variant="outline"
								disabled={!ai.canInsertCopy}
								onClick={() => ai.onApply("insert-copy")}
							>
								{insertCopyLabelText}
							</Button>
							<Button
								type="button"
								data-testid="ai-image-preview-discard"
								variant="ghost"
								disabled={ai.applyStatus === "applying"}
								onClick={ai.onDiscard}
							>
								{discardLabelText}
							</Button>
						</div>
						{ai.applyStatus === "applying" ? (
							<p aria-live="polite" style={noticeStyle}>
								{msg("aiImage.preview.applying", "Applying result…")}
							</p>
						) : null}
					</section>
				) : null}

				{ai.error ? (
					<Alert
						data-testid="ai-image-error"
						style={errorStyle}
						variant="destructive"
					>
						<AlertTitle>
							{msg("aiImage.error.title", "AI image task failed")}
						</AlertTitle>
						<AlertDescription>
							{ai.error}
							{ai.jobError?.code ? ` (${ai.jobError.code})` : ""}
						</AlertDescription>
					</Alert>
				) : null}
			</div>

			<div style={actionRowStyle}>
				<Button
					type="button"
					data-testid="ai-image-run"
					disabled={!ai.canRun}
					aria-describedby={
						ai.runDisabledReason ? "ai-image-run-requirement" : undefined
					}
					style={primaryButtonStyle(!ai.canRun)}
					onClick={ai.onRun}
				>
					{runLabelText}
				</Button>
				{ai.status === "pending" ? (
					<Button
						type="button"
						data-testid="ai-image-cancel"
						variant="outline"
						style={cancelButtonStyle}
						onClick={ai.onCancel}
					>
						{cancelLabelText}
					</Button>
				) : ai.canRetry ? (
					<Button
						type="button"
						data-testid="ai-image-retry"
						variant="outline"
						onClick={ai.onRetry}
					>
						{retryLabelText}
					</Button>
				) : null}
			</div>
			{ai.runDisabledReason ? (
				<p id="ai-image-run-requirement" style={noticeStyle}>
					{ai.runDisabledReason}
				</p>
			) : null}

			{designJobClient ? (
				<div
					data-testid="ai-design-actions"
					style={{
						...bodyStyle,
						flex: "none",
						borderTop: "1px solid var(--ak-studio-border, #d4d4d8)",
						paddingTop: "8px",
					}}
				>
					{supportsDesignOp("rewrite-copy") && selectionLooksLikeText ? (
						<div
							style={{ display: "flex", flexDirection: "column", gap: "4px" }}
						>
							<label style={labelStyle}>
								{msg("aiImage.design.rewriteInstruction")}
								<input
									data-testid="ai-design-rewrite-instruction"
									style={fieldStyle}
									value={rewriteInstruction}
									onChange={(event) =>
										setRewriteInstruction(event.target.value)
									}
								/>
							</label>
							<button
								type="button"
								data-testid="ai-design-rewrite-run"
								disabled={
									design.status === "pending" ||
									!getLayerContext()?.selectedNodeId
								}
								style={primaryButtonStyle(
									design.status === "pending" ||
										!getLayerContext()?.selectedNodeId,
								)}
								onClick={() => {
									const context = getLayerContext();
									if (!context?.selectedNodeId) return;
									design.run({
										kind: "rewrite-copy",
										nodeId: context.selectedNodeId,
										...(rewriteInstruction.trim()
											? { instruction: rewriteInstruction.trim() }
											: {}),
									});
								}}
							>
								{msg("aiImage.design.rewriteRun")}
							</button>
						</div>
					) : null}

					{supportsDesignOp("generate-layout-variants") ? (
						<div
							style={{ display: "flex", flexDirection: "column", gap: "4px" }}
						>
							<label style={labelStyle}>
								{msg("aiImage.design.layoutVariantCount")}
								<input
									data-testid="ai-design-layout-count"
									inputMode="numeric"
									style={fieldStyle}
									value={layoutVariantCount}
									onChange={(event) =>
										setLayoutVariantCount(event.target.value)
									}
								/>
							</label>
							<button
								type="button"
								data-testid="ai-design-layout-run"
								disabled={design.status === "pending" || !ai.hasLayerContext}
								style={primaryButtonStyle(
									design.status === "pending" || !ai.hasLayerContext,
								)}
								onClick={() => {
									const context = getLayerContext();
									if (!context) return;
									const count = Number.parseInt(layoutVariantCount, 10);
									design.run({
										kind: "generate-layout-variants",
										sourcePageId: context.artboardId,
										...(Number.isInteger(count) ? { count } : {}),
									});
								}}
							>
								{msg("aiImage.design.layoutRun")}
							</button>
						</div>
					) : null}

					{supportsDesignOp("apply-brand") && brandKit ? (
						<button
							type="button"
							data-testid="ai-design-brand-run"
							disabled={design.status === "pending" || !ai.hasLayerContext}
							style={primaryButtonStyle(
								design.status === "pending" || !ai.hasLayerContext,
							)}
							onClick={() => {
								const context = getLayerContext();
								if (!context) return;
								design.run({
									kind: "apply-brand",
									brandKit,
									targetPageId: context.artboardId,
								});
							}}
						>
							{msg("aiImage.design.applyBrandRun")}
						</button>
					) : null}

					{design.status === "pending" ? (
						<p
							data-testid="ai-design-status"
							style={noticeStyle}
							aria-live="polite"
						>
							{msg("aiImage.status.generating")}
						</p>
					) : null}

					{design.status === "pending" ? (
						<button
							type="button"
							data-testid="ai-design-cancel"
							style={cancelButtonStyle}
							onClick={design.onCancel}
						>
							{cancelLabelText}
						</button>
					) : null}

					{design.result?.status === "complete" ? (
						<p data-testid="ai-design-result" style={resultStyle}>
							{msg("aiImage.design.resultApplied")}
						</p>
					) : null}

					{design.error ? (
						<p data-testid="ai-design-error" style={errorStyle} role="alert">
							{design.error}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
