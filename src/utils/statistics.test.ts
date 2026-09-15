/**
 * Tests for the statistical inference layer.
 *
 * These are the highest-value tests in the project: this module decides what
 * the app is allowed to CLAIM. A regression here does not crash anything — it
 * silently produces a confident verdict from insufficient evidence, which is
 * exactly the failure the rewrite set out to remove. Several tests below exist
 * specifically to pin down bugs that previously shipped.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_TRIALS_FOR_INFERENCE,
  classifyInterpretation,
  cohensDPaired,
  confidenceInterval95,
  formatCI,
  formatPValue,
  formatStat,
  generateComparisonNarrative,
  getTCritical,
  holmBonferroniCorrection,
  mean,
  median,
  pairedTTest,
  standardDeviation,
  studentTPValue,
  wilcoxonSignedRankTest,
} from './statistics';

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for an empty sample', () => {
    expect(mean([])).toBe(0);
  });

  it('handles negative values', () => {
    expect(mean([-5, 5])).toBe(0);
  });
});

describe('median', () => {
  it('returns the middle value for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('returns 0 for an empty sample', () => {
    expect(median([])).toBe(0);
  });
});

describe('standardDeviation', () => {
  it('applies Bessel correction (n - 1 denominator)', () => {
    // Population SD of [2,4,4,4,5,5,7,9] is 2; the sample SD is larger.
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('returns null rather than 0 for a single observation', () => {
    // A single data point has no measurable spread. Returning 0 would assert
    // perfect consistency from one value — which is what the old code did.
    expect(standardDeviation([42])).toBeNull();
  });

  it('returns null for an empty sample', () => {
    expect(standardDeviation([])).toBeNull();
  });

  it('returns 0 for genuinely identical values', () => {
    expect(standardDeviation([5, 5, 5])).toBe(0);
  });
});

describe('getTCritical', () => {
  it('returns the textbook value for known degrees of freedom', () => {
    expect(getTCritical(1)).toBeCloseTo(12.706, 3);
    expect(getTCritical(4)).toBeCloseTo(2.776, 3);
    expect(getTCritical(30)).toBeCloseTo(2.042, 3);
  });

  it('interpolates between tabulated values', () => {
    const t22 = getTCritical(22);
    expect(t22).toBeLessThan(getTCritical(20));
    expect(t22).toBeGreaterThan(getTCritical(25));
  });

  it('converges on the normal critical value beyond df = 30', () => {
    expect(getTCritical(500)).toBeCloseTo(1.96, 2);
  });
});

describe('confidenceInterval95', () => {
  it('brackets the sample mean', () => {
    const ci = confidenceInterval95([10, 12, 14, 11, 13]);
    expect(ci).not.toBeNull();
    const [lower, upper] = ci!;
    expect(lower).toBeLessThan(12);
    expect(upper).toBeGreaterThan(12);
  });

  it('returns null below the inference threshold', () => {
    // The old implementation returned [m, m] for one value, rendering as a
    // zero-width "95% CI" — the visual signature of extreme precision derived
    // from a single observation.
    expect(confidenceInterval95([10])).toBeNull();
    expect(confidenceInterval95([10, 12])).toBeNull();
  });

  it('is available at exactly the threshold', () => {
    expect(confidenceInterval95([10, 12, 14])).not.toBeNull();
  });

  it('widens as variance increases', () => {
    const tight = confidenceInterval95([10, 10.1, 9.9])!;
    const wide = confidenceInterval95([2, 10, 18])!;
    expect(tight[1] - tight[0]).toBeLessThan(wide[1] - wide[0]);
  });
});

describe('studentTPValue', () => {
  it('returns 1.0 for a zero t-statistic', () => {
    expect(studentTPValue(0, 5)).toBe(1.0);
  });

  it('is symmetric in the sign of t', () => {
    expect(studentTPValue(2.5, 10)).toBeCloseTo(studentTPValue(-2.5, 10), 10);
  });

  it('matches the closed form at df = 1 (Cauchy)', () => {
    // Two-sided p for t = 1, df = 1 is exactly 0.5.
    expect(studentTPValue(1, 1)).toBeCloseTo(0.5, 6);
  });

  it('matches known critical values', () => {
    // t = 2.776 at df = 4 is the 5% two-sided critical value.
    expect(studentTPValue(2.776, 4)).toBeCloseTo(0.05, 2);
    // t = 2.228 at df = 10 likewise.
    expect(studentTPValue(2.228, 10)).toBeCloseTo(0.05, 2);
  });

  it('decreases as t grows', () => {
    expect(studentTPValue(5, 10)).toBeLessThan(studentTPValue(2, 10));
  });

  it('returns 1.0 for non-finite input', () => {
    expect(studentTPValue(NaN, 5)).toBe(1.0);
    expect(studentTPValue(2, 0)).toBe(1.0);
  });
});

describe('pairedTTest', () => {
  it('computes t and p for an adequate sample', () => {
    const result = pairedTTest([10, 9, 11, 10, 10]);
    expect(result.meanDifference).toBeCloseTo(10, 1);
    expect(result.tStatistic).not.toBeNull();
    expect(result.pValue).not.toBeNull();
    expect(result.pValue!).toBeLessThan(0.05);
    expect(result.note).toBeUndefined();
  });

  it('withholds inference below the trial threshold but still reports the mean', () => {
    const result = pairedTTest([10]);
    expect(result.tStatistic).toBeNull();
    expect(result.pValue).toBeNull();
    // The descriptive figure needs no assumptions, so it is still available.
    expect(result.meanDifference).toBe(10);
    expect(result.note).toContain(String(MIN_TRIALS_FOR_INFERENCE));
  });

  it('withholds inference at n = 2', () => {
    expect(pairedTTest([10, 10]).pValue).toBeNull();
  });

  it('refuses to report significance for zero variance', () => {
    // REGRESSION TEST. The old implementation returned a hardcoded
    // { tStatistic: 99, pValue: 0.0001 } whenever the SD was zero, turning the
    // least informative possible sample into the app's most confident verdict.
    // The t-statistic is meanDiff / 0 — undefined, not significant.
    const result = pairedTTest([10, 10, 10, 10, 10]);
    expect(result.tStatistic).toBeNull();
    expect(result.pValue).toBeNull();
    expect(result.sdDifference).toBe(0);
    expect(result.note).toMatch(/zero variance/i);
  });

  it('produces a negative t for a negative mean difference', () => {
    const result = pairedTTest([-8, -9, -7, -8]);
    expect(result.tStatistic!).toBeLessThan(0);
  });

  it('gives a non-significant p when the differences straddle zero', () => {
    const result = pairedTTest([5, -4, 3, -6, 2]);
    expect(result.pValue!).toBeGreaterThan(0.05);
  });
});

describe('wilcoxonSignedRankTest', () => {
  it('withholds inference below the trial threshold', () => {
    const result = wilcoxonSignedRankTest([3, 4]);
    expect(result.pValue).toBeNull();
    expect(result.note).toContain(String(MIN_TRIALS_FOR_INFERENCE));
  });

  it('cannot reach significance at n = 3, however large the effect', () => {
    // A property of the test, not a bug: with three positive pairs the
    // smallest attainable two-sided p is 0.25 exactly. This is why the demo
    // dataset uses five trials rather than three.
    const result = wilcoxonSignedRankTest([50, 60, 70]);
    expect(result.pValue!).toBeGreaterThan(0.05);
  });

  it('approaches significance with five consistent positive pairs', () => {
    const result = wilcoxonSignedRankTest([9, 12, 9, 11, 10]);
    expect(result.pValue!).toBeLessThan(0.1);
    expect(result.wStatistic).toBe(0);
  });

  it('excludes zero differences and reports doing so', () => {
    const result = wilcoxonSignedRankTest([5, 0, 6, 0, 7]);
    expect(result.note).toMatch(/zero difference/i);
  });

  it('returns nulls when every difference is zero', () => {
    const result = wilcoxonSignedRankTest([0, 0, 0, 0]);
    expect(result.pValue).toBeNull();
    expect(result.note).toMatch(/exactly zero/i);
  });

  it('gives an effect size between 0 and 1', () => {
    const result = wilcoxonSignedRankTest([4, 5, 6, 7, 8]);
    expect(result.effectSizeR!).toBeGreaterThan(0);
    expect(result.effectSizeR!).toBeLessThanOrEqual(1);
  });
});

describe('cohensDPaired', () => {
  it('is the mean difference over its standard deviation', () => {
    // mean = 10, sample SD = 1 -> d = 10.
    expect(cohensDPaired([9, 10, 11, 10, 10])).toBeCloseTo(14.14, 1);
  });

  it('returns null for zero variance rather than 0', () => {
    // 0 would read as "no effect"; the truth is "not computable".
    expect(cohensDPaired([5, 5, 5, 5])).toBeNull();
  });

  it('returns null below the trial threshold', () => {
    expect(cohensDPaired([5, 6])).toBeNull();
  });
});

describe('holmBonferroniCorrection', () => {
  it('scales the smallest p-value by the number of tests', () => {
    const adjusted = holmBonferroniCorrection([
      { id: 'a', pValue: 0.01 },
      { id: 'b', pValue: 0.04 },
      { id: 'c', pValue: 0.03 },
    ]);
    // Smallest (0.01) is multiplied by m = 3.
    expect(adjusted.a).toBeCloseTo(0.03, 4);
    // Next (0.03) by m - 1 = 2 -> 0.06.
    expect(adjusted.c).toBeCloseTo(0.06, 4);
    // Largest (0.04) by m - 2 = 1, but monotonicity holds it at 0.06.
    expect(adjusted.b).toBeCloseTo(0.06, 4);
  });

  it('enforces monotonicity down the sorted list', () => {
    const adjusted = holmBonferroniCorrection([
      { id: 'a', pValue: 0.02 },
      { id: 'b', pValue: 0.021 },
      { id: 'c', pValue: 0.9 },
    ]);
    expect(adjusted.a!).toBeLessThanOrEqual(adjusted.b!);
    expect(adjusted.b!).toBeLessThanOrEqual(adjusted.c!);
  });

  it('never exceeds 1.0', () => {
    const adjusted = holmBonferroniCorrection([
      { id: 'a', pValue: 0.5 },
      { id: 'b', pValue: 0.6 },
      { id: 'c', pValue: 0.7 },
    ]);
    for (const value of Object.values(adjusted)) {
      expect(value!).toBeLessThanOrEqual(1.0);
    }
  });

  it('excludes untested comparisons from the family size', () => {
    // A test that was never performed must not inflate the correction applied
    // to the tests that were. With one real p-value the family size is 1, so
    // the correction is a no-op.
    const adjusted = holmBonferroniCorrection([
      { id: 'tested', pValue: 0.04 },
      { id: 'skipped', pValue: null },
      { id: 'also-skipped', pValue: null },
    ]);
    expect(adjusted.tested).toBeCloseTo(0.04, 4);
    expect(adjusted.skipped).toBeNull();
    expect(adjusted['also-skipped']).toBeNull();
  });

  it('returns an empty map for no tests', () => {
    expect(holmBonferroniCorrection([])).toEqual({});
  });
});

describe('classifyInterpretation', () => {
  it('reports a significant lift when p is low and the CI excludes zero', () => {
    expect(classifyInterpretation(0.01, 8, [4, 12])).toBe('SIGNIFICANT POSITIVE LIFT');
  });

  it('refuses significance when the CI straddles zero', () => {
    // A p-value under alpha alongside an interval containing zero is
    // contradictory; the conservative reading wins.
    expect(classifyInterpretation(0.04, 8, [-1, 17])).toBe(
      'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT'
    );
  });

  it('reports degradation for a significant negative effect', () => {
    expect(classifyInterpretation(0.01, -8, [-12, -4])).toBe('NEGATIVE / DEGRADED');
  });

  it('reports insufficient trials when the p-value is missing', () => {
    expect(classifyInterpretation(null, 12, [4, 20])).toBe('INSUFFICIENT TRIALS');
  });

  it('reports insufficient trials when the CI is missing', () => {
    expect(classifyInterpretation(0.001, 12, null)).toBe('INSUFFICIENT TRIALS');
  });

  it('treats a small difference as no meaningful difference', () => {
    expect(classifyInterpretation(0.6, 0.4, [-2, 3])).toBe('NO MEANINGFUL DIFFERENCE');
  });
});

describe('display formatters', () => {
  it('renders an em dash for absent values', () => {
    expect(formatPValue(null)).toBe('—');
    expect(formatCI(null)).toBe('—');
    expect(formatStat(null)).toBe('—');
  });

  it('renders very small p-values with a threshold', () => {
    expect(formatPValue(0.00004)).toBe('< 0.001');
  });

  it('renders ordinary p-values to three decimals', () => {
    expect(formatPValue(0.0423)).toBe('0.042');
  });

  it('renders a confidence interval as a bracketed pair', () => {
    expect(formatCI([4.25, 12.5])).toBe('[4.3, 12.5]');
  });
});

describe('generateComparisonNarrative', () => {
  it('states plainly that no test was run for an insufficient sample', () => {
    const narrative = generateComparisonNarrative(
      'Call-Graph Lift',
      'INSUFFICIENT TRIALS',
      9.5,
      null,
      null,
      null,
      null,
      1
    );
    expect(narrative).toContain('9.5 pts');
    expect(narrative).toContain('descriptive');
    // It must not imply a statistical result.
    expect(narrative).not.toMatch(/\bsignificant\b/i);
  });

  it('reports a significant result with its statistics', () => {
    const narrative = generateComparisonNarrative(
      'Git-History Lift',
      'SIGNIFICANT POSITIVE LIFT',
      10.5,
      [8, 13],
      0.001,
      0.003,
      4.2,
      5
    );
    expect(narrative).toContain('significant');
    expect(narrative).toContain('+10.5 pts');
    expect(narrative).toContain('95% CI [8.0, 13.0]');
  });

  it('includes the supplied inference note when present', () => {
    const narrative = generateComparisonNarrative(
      'Length Effect',
      'INSUFFICIENT TRIALS',
      6,
      null,
      null,
      null,
      null,
      5,
      'Zero variance: every paired difference is identical.'
    );
    expect(narrative).toContain('Zero variance');
  });
});
