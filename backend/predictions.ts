type Alignment = Array<[templateIndex: number, dayIndex: number]>;

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return lower === upper
    ? sorted[lower]!
    : (sorted[lower]! + sorted[upper]!) / 2;
};

const gapPenalty = (template: number[], values: number[]) => {
  const headways = [template, values].flatMap((day) =>
    day.slice(1).map((value, index) => value - day[index]!).filter((value) => value > 0),
  );
  const typicalHeadway = median(headways) ?? 15;
  return Math.max(3, Math.min(30, typicalHeadway * 0.75));
};

const alignDay = (
  template: number[],
  values: number[],
  offset: number,
): Alignment => {
  const penalty = gapPenalty(template, values);
  const scores = Array.from({ length: template.length + 1 }, () =>
    Array<number>(values.length + 1).fill(0),
  );
  const steps = Array.from({ length: template.length + 1 }, () =>
    Array<"match" | "skipTemplate" | "skipDay" | null>(
      values.length + 1,
    ).fill(null),
  );

  for (let index = 1; index <= template.length; index += 1) {
    scores[index]![0] = scores[index - 1]![0] + penalty;
    steps[index]![0] = "skipTemplate";
  }
  for (let index = 1; index <= values.length; index += 1) {
    scores[0]![index] = scores[0]![index - 1] + penalty;
    steps[0]![index] = "skipDay";
  }

  for (let templateIndex = 1; templateIndex <= template.length; templateIndex += 1) {
    for (let dayIndex = 1; dayIndex <= values.length; dayIndex += 1) {
      const match =
        scores[templateIndex - 1]![dayIndex - 1] +
        Math.abs(
          (values[dayIndex - 1]! - template[templateIndex - 1]!) - offset,
        );
      const skipTemplate = scores[templateIndex - 1]![dayIndex] + penalty;
      const skipDay = scores[templateIndex]![dayIndex - 1] + penalty;
      const best = Math.min(match, skipTemplate, skipDay);
      scores[templateIndex]![dayIndex] = best;
      steps[templateIndex]![dayIndex] =
        best === match
          ? "match"
          : best === skipTemplate
            ? "skipTemplate"
            : "skipDay";
    }
  }

  const matches: Alignment = [];
  let templateIndex = template.length;
  let dayIndex = values.length;
  while (templateIndex > 0 || dayIndex > 0) {
    const step = steps[templateIndex]![dayIndex];
    if (step === "match") {
      matches.push([templateIndex - 1, dayIndex - 1]);
      templateIndex -= 1;
      dayIndex -= 1;
    } else if (step === "skipTemplate") {
      templateIndex -= 1;
    } else {
      dayIndex -= 1;
    }
  }
  return matches.reverse();
};

const chooseTemplateIndex = (days: number[][]) =>
  days.reduce(
    (bestIndex, values, index) =>
      values.length > days[bestIndex]!.length ? index : bestIndex,
    0,
  );

export const buildAlignedPredictionMinutes = (dayValues: number[][]) => {
  const days = dayValues
    .map((values) => values.filter(Number.isFinite).sort((a, b) => a - b))
    .filter((values) => values.length > 0);
  if (days.length === 0) return [];

  const templateIndex = chooseTemplateIndex(days);
  const template = days[templateIndex]!;
  const samplesBySlot = template.map((value) => [value]);

  days.forEach((values, index) => {
    if (index === templateIndex) return;
    const initialMatches = alignDay(template, values, 0);
    const offset = median(
      initialMatches.map(
        ([templateSlot, daySlot]) => values[daySlot]! - template[templateSlot]!,
      ),
    ) ?? 0;
    alignDay(template, values, offset).forEach(([templateSlot, daySlot]) => {
      samplesBySlot[templateSlot]?.push(values[daySlot]!);
    });
  });

  return samplesBySlot
    .map((samples) => median(samples))
    .filter((value): value is number => value !== null);
};
