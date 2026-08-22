import { expect, test } from "bun:test";
import { buildAlignedPredictionMinutes } from "./predictions";

test("keeps an irregular later arrival aligned after a missing observation", () => {
  const prediction = buildAlignedPredictionMinutes([
    [15 * 60 + 30, 15 * 60 + 45, 16 * 60 + 30],
    [15 * 60 + 32, 16 * 60 + 31],
    [15 * 60 + 31, 15 * 60 + 46, 16 * 60 + 31],
  ]);

  expect(prediction).toEqual([931, 945.5, 991]);
});

test("does not shift frequent arrivals after one missing point", () => {
  const prediction = buildAlignedPredictionMinutes([
    [540, 550, 560, 570],
    [541, 561, 571],
    [539, 549, 559, 569],
  ]);

  expect(prediction).toEqual([540, 549.5, 560, 570]);
});
