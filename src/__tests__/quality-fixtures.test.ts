import { describe, expect, it } from "vitest";
import {
	AI_IMAGE_QUALITY_FIXTURES,
	type AiImageQualityObservation,
	evaluateAiImageQualityFixture,
} from "../evaluation/quality-fixtures.js";

const passing: AiImageQualityObservation = {
	"alpha-edge-max-delta": 0.04,
	"boundary-object-iou": 0.98,
	"text-similarity": 0.99,
	"face-count": 1,
	"face-identity-similarity": 0.94,
	"seam-max-delta": 0.03,
};

describe("AI image quality fixtures (E7-T7)", () => {
	it("covers every quality category named by the plan with unique assets", () => {
		expect(AI_IMAGE_QUALITY_FIXTURES.map(({ category }) => category)).toEqual([
			"transparent-edges",
			"boundary-objects",
			"image-typography",
			"faces",
			"expansion-seams",
		]);
		expect(new Set(AI_IMAGE_QUALITY_FIXTURES.map(({ id }) => id)).size).toBe(5);
		for (const fixture of AI_IMAGE_QUALITY_FIXTURES) {
			expect(fixture.sourceDataUrl).toMatch(/^data:image\/svg\+xml,/);
			expect(fixture.expectedDataUrl).toMatch(/^data:image\/svg\+xml,/);
			expect(fixture.criteria.length).toBeGreaterThan(0);
		}
	});

	it("accepts observations that satisfy every fixture threshold", () => {
		for (const fixture of AI_IMAGE_QUALITY_FIXTURES) {
			expect(evaluateAiImageQualityFixture(fixture, passing)).toEqual({
				fixtureId: fixture.id,
				passed: true,
				issues: [],
			});
		}
	});

	it("reports deterministic diagnostics for missing and failed metrics", () => {
		const faceFixture = AI_IMAGE_QUALITY_FIXTURES.find(
			({ category }) => category === "faces",
		);
		if (!faceFixture) throw new Error("missing face fixture");
		expect(
			evaluateAiImageQualityFixture(faceFixture, {
				"face-count": 2,
				"face-identity-similarity": 0.5,
			}),
		).toEqual({
			fixtureId: "single-face-identity-v1",
			passed: false,
			issues: [
				{
					metric: "face-count",
					reason: "not-equal",
					expected: 1,
					actual: 2,
				},
				{
					metric: "face-identity-similarity",
					reason: "below-minimum",
					expected: 0.9,
					actual: 0.5,
				},
			],
		});

		const seamFixture = AI_IMAGE_QUALITY_FIXTURES.at(-1);
		if (!seamFixture) throw new Error("missing seam fixture");
		expect(evaluateAiImageQualityFixture(seamFixture, {})).toMatchObject({
			passed: false,
			issues: [{ metric: "seam-max-delta", reason: "missing" }],
		});
	});
});
