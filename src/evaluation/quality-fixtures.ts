import type { AiImageJobKind } from "../types/index.js";

export type AiImageQualityCategory =
	| "transparent-edges"
	| "boundary-objects"
	| "image-typography"
	| "faces"
	| "expansion-seams";

export type AiImageQualityMetric =
	| "alpha-edge-max-delta"
	| "boundary-object-iou"
	| "text-similarity"
	| "face-count"
	| "face-identity-similarity"
	| "seam-max-delta";

export interface AiImageQualityCriterion {
	readonly metric: AiImageQualityMetric;
	readonly operator: "min" | "max" | "equal";
	readonly threshold: number;
}

export interface AiImageQualityFixture {
	readonly id: string;
	readonly category: AiImageQualityCategory;
	readonly taskKind: AiImageJobKind;
	readonly description: string;
	readonly sourceDataUrl: string;
	readonly expectedDataUrl: string;
	readonly criteria: readonly AiImageQualityCriterion[];
}

export type AiImageQualityObservation = Partial<
	Record<AiImageQualityMetric, number>
>;

export interface AiImageQualityEvaluationIssue {
	readonly metric: AiImageQualityMetric;
	readonly reason: "missing" | "below-minimum" | "above-maximum" | "not-equal";
	readonly expected: number;
	readonly actual?: number;
}

export interface AiImageQualityEvaluationResult {
	readonly fixtureId: string;
	readonly passed: boolean;
	readonly issues: readonly AiImageQualityEvaluationIssue[];
}

function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const transparentSource = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#f4f4f5"/><circle cx="64" cy="64" r="40" fill="#2563eb"/></svg>',
);
const transparentExpected = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="40" fill="#2563eb"/></svg>',
);
const boundaryObject = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><rect x="0" y="32" width="52" height="56" rx="8" fill="#e11d48"/><circle cx="140" cy="18" r="18" fill="#0f766e"/></svg>',
);
const typography = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#111827"/><text x="24" y="72" font-family="sans-serif" font-size="36" font-weight="700" fill="#fff">ANVIL 39</text></svg>',
);
const face = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#fde68a"/><circle cx="64" cy="60" r="38" fill="#d97706"/><circle cx="51" cy="54" r="4"/><circle cx="77" cy="54" r="4"/><path d="M48 76 Q64 88 80 76" fill="none" stroke="#111" stroke-width="4"/></svg>',
);
const expansionSource = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><defs><linearGradient id="g"><stop stop-color="#0ea5e9"/><stop offset="1" stop-color="#f0f9ff"/></linearGradient></defs><rect width="160" height="80" fill="url(#g)"/></svg>',
);
const expansionExpected = svgDataUrl(
	'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><defs><linearGradient id="g"><stop stop-color="#0369a1"/><stop offset=".5" stop-color="#0ea5e9"/><stop offset="1" stop-color="#f0f9ff"/></linearGradient></defs><rect width="240" height="80" fill="url(#g)"/></svg>',
);

/** Deterministic, synthetic fixtures safe to run without a paid provider. */
export const AI_IMAGE_QUALITY_FIXTURES: readonly AiImageQualityFixture[] = [
	{
		id: "transparent-edge-alpha-ramp-v1",
		category: "transparent-edges",
		taskKind: "bg-remove",
		description:
			"Background removal preserves soft alpha edges without a halo.",
		sourceDataUrl: transparentSource,
		expectedDataUrl: transparentExpected,
		criteria: [
			{ metric: "alpha-edge-max-delta", operator: "max", threshold: 0.08 },
		],
	},
	{
		id: "boundary-object-retention-v1",
		category: "boundary-objects",
		taskKind: "object-erase",
		description:
			"Objects touching image boundaries remain geometrically intact.",
		sourceDataUrl: boundaryObject,
		expectedDataUrl: boundaryObject,
		criteria: [
			{ metric: "boundary-object-iou", operator: "min", threshold: 0.95 },
		],
	},
	{
		id: "embedded-typography-preservation-v1",
		category: "image-typography",
		taskKind: "generative-expand",
		description: "Expansion does not rewrite typography embedded in the image.",
		sourceDataUrl: typography,
		expectedDataUrl: typography,
		criteria: [{ metric: "text-similarity", operator: "min", threshold: 0.98 }],
	},
	{
		id: "single-face-identity-v1",
		category: "faces",
		taskKind: "generative-expand",
		description: "Expansion preserves the face count and reference identity.",
		sourceDataUrl: face,
		expectedDataUrl: face,
		criteria: [
			{ metric: "face-count", operator: "equal", threshold: 1 },
			{
				metric: "face-identity-similarity",
				operator: "min",
				threshold: 0.9,
			},
		],
	},
	{
		id: "horizontal-expansion-seam-v1",
		category: "expansion-seams",
		taskKind: "generative-expand",
		description:
			"Expanded pixels join the source without a visible boundary seam.",
		sourceDataUrl: expansionSource,
		expectedDataUrl: expansionExpected,
		criteria: [{ metric: "seam-max-delta", operator: "max", threshold: 0.05 }],
	},
];

export function evaluateAiImageQualityFixture(
	fixture: AiImageQualityFixture,
	observation: AiImageQualityObservation,
): AiImageQualityEvaluationResult {
	const issues: AiImageQualityEvaluationIssue[] = [];
	for (const criterion of fixture.criteria) {
		const actual = observation[criterion.metric];
		if (actual === undefined || !Number.isFinite(actual)) {
			issues.push({
				metric: criterion.metric,
				reason: "missing",
				expected: criterion.threshold,
			});
			continue;
		}
		const failed =
			(criterion.operator === "min" && actual < criterion.threshold) ||
			(criterion.operator === "max" && actual > criterion.threshold) ||
			(criterion.operator === "equal" && actual !== criterion.threshold);
		if (!failed) continue;
		issues.push({
			metric: criterion.metric,
			reason:
				criterion.operator === "min"
					? "below-minimum"
					: criterion.operator === "max"
						? "above-maximum"
						: "not-equal",
			expected: criterion.threshold,
			actual,
		});
	}
	return { fixtureId: fixture.id, passed: issues.length === 0, issues };
}
