/**
 * Statistical inference for paired experimental comparisons.
 *
 * THE CENTRAL RULE OF THIS MODULE: never return a number that the sample size
 * cannot support. Every inferential function returns `null` instead of a
 * placeholder when its assumptions are unmet, and sets a `note` explaining why.
 *
 * WHY THAT MATTERS HERE
 * The previous version had two paths that manufactured significance:
 *
 *   1. `pairedTTest` returned `{ tStatistic: 99, pValue: 0.0001 }` whenever the
 *      standard deviation was zero. Zero variance means the t-statistic is
 *      literally `meanDiff / 0` — undefined. Reporting p = 0.0001 for it turned
 *      the *least* informative possible sample into the app's most confident
 *      verdict, and it fired on any run where the judge returned identical
 *      scores twice.
 *
 *   2. With a single trial it returned `p = 1.0` and `confidenceInterval95`
 *      returned `[mean, mean]`. Those are not results; they are shapes that fit
 *      the UI. A "95% CI" of [10.0, 10.0] from one observation reads as
 *      extraordinary precision when it actually means no information at all.
 *
 * Both are gone. Below the minimum sample size the honest answer is "unknown",
 * and the UI renders that as a neutral panel rather than a verdict.
 */

import { StatisticalInterpretation } from '../types';

/**
 * Minimum paired trials required before any significance test is reported.
 *
 * Three is the practical floor for the paired tests used here: the Wilcoxon
 * signed-rank test cannot produce a two-sided p-value below 0.25 with fewer
 * than three non-zero pairs, and a t-test on two points has one degree of
 * freedom and a critical value of 12.7 — so wide that it is near-useless.
 * Three is a minimum, not a recommendation; 5-10 is advisable for real claims,
 * and the UI says so.
 */
export const MIN_TRIALS_FOR_INFERENCE = 3;

/** Computes the arithmetic mean. Returns 0 for an empty sample. */
export function mean(values: number[]): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Computes the median. Returns 0 for an empty sample. */
export function median(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Sample standard deviation with Bessel's correction (n - 1 denominator).
 *
 * Returns `null` for n < 2 rather than 0: a single observation has no spread to
 * measure, and returning 0 would claim perfect consistency from one data point.
 */
export function standardDeviation(values: number[]): number | null {
  if (!values || values.length < 2) return null;
  const m = mean(values);
  const sumSquareDiffs = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSquareDiffs / (values.length - 1));
}

/**
 * Two-tailed critical t-values at 95% confidence (alpha = 0.05), keyed by
 * degrees of freedom. Values beyond df = 30 converge on the normal 1.96.
 */
const T_CRITICAL_95: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  25: 2.06,
  30: 2.042,
};

/** Returns the critical t-value for `df`, interpolating gaps in the table. */
export function getTCritical(df: number): number {
  if (df <= 0) return 1.96;
  if (T_CRITICAL_95[df]) return T_CRITICAL_95[df];
  if (df > 30) return 1.96;

  const keys = Object.keys(T_CRITICAL_95)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df > keys[i] && df < keys[i + 1]) {
      const low = keys[i];
      const high = keys[i + 1];
      const frac = (df - low) / (high - low);
      return T_CRITICAL_95[low] + frac * (T_CRITICAL_95[high] - T_CRITICAL_95[low]);
    }
  }
  return 1.96;
}

/**
 * 95% confidence interval for the sample mean.
 *
 * Returns `null` below MIN_TRIALS_FOR_INFERENCE. The old implementation
 * returned `[m, m]` for a single value, which renders as a zero-width interval
 * — the visual signature of a perfectly precise estimate, from one data point.
 */
export function confidenceInterval95(values: number[]): [number, number] | null {
  if (!values || values.length < MIN_TRIALS_FOR_INFERENCE) return null;

  const m = mean(values);
  const sd = standardDeviation(values);
  if (sd === null) return null;

  const n = values.length;
  const margin = getTCritical(n - 1) * (sd / Math.sqrt(n));

  return [Number((m - margin).toFixed(2)), Number((m + margin).toFixed(2))];
}

/** Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF. */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Lanczos approximation of ln(Gamma(x)) (Numerical Recipes coefficients).
 *
 * The literals are written in their exactly-representable double form; the
 * source previously carried values that silently rounded when parsed.
 */
function logGamma(x: number): number {
  const coef = [
    76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155,
    0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += coef[j] / y;
  }
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

/**
 * Continued-fraction expansion used by the incomplete beta function
 * (Numerical Recipes `betacf`).
 *
 * Evaluated with the modified Lentz algorithm. The `d` initialization below
 * (`1 - qab*x/qap`) is the expansion's leading term: the previous
 * implementation started from `d = 0` and omitted it entirely, which is why
 * `studentTPValue(2.776, 4)` returned 0.035 where the true two-sided p is
 * 0.050 — roughly a 30% error on every p-value with 3 <= df < 30, i.e. on
 * exactly the sample sizes this benchmark produces.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-12;
  // Guards against division by a denominator that has underflowed to zero.
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;

    // Even step of the recurrence.
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + numerator / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    // Odd step of the recurrence.
    numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + numerator / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;

    const delta = d * c;
    h *= delta;

    // Converged once the correction factor reaches unity.
    if (Math.abs(delta - 1) < EPS) break;
  }

  return h;
}

/**
 * Regularized incomplete beta function I_x(a, b).
 *
 * Applies the symmetry relation I_x(a,b) = 1 - I_{1-x}(b,a) when x lies above
 * the continued fraction's fast-convergence region. Without that switch the
 * expansion converges slowly — or not usefully — for large x, which is the
 * second half of the bug described on `betaContinuedFraction`.
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // The beta prefactor, computed in log space to avoid overflow.
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-tailed p-value for a t-statistic at `df` degrees of freedom. */
export function studentTPValue(t: number, df: number): number {
  if (Number.isNaN(t) || df <= 0) return 1.0;
  const absT = Math.abs(t);
  if (absT === 0) return 1.0;

  // df = 1 is the Cauchy distribution, which has a closed form.
  if (df === 1) return 1 - (2 / Math.PI) * Math.atan(absT);

  // df = 2 also has a closed form.
  if (df === 2) return 1 - absT / Math.sqrt(2 + absT * absT);

  // Beyond df = 30 the normal approximation is accurate to ~3 decimals.
  if (df >= 30) return Math.max(0.0001, Math.min(1.0, 2 * (1 - normalCdf(absT))));

  // Otherwise use the exact relation to the incomplete beta function.
  const x = df / (df + absT * absT);
  return Math.max(0.0001, Math.min(1.0, incompleteBeta(x, df / 2, 0.5)));
}

/** Outcome of a paired t-test, with inference withheld when unsupported. */
export interface PairedTTestResult {
  /** Null when the test could not legitimately be computed. */
  tStatistic: number | null;
  pValue: number | null;
  /** Always available: a descriptive mean needs no assumptions. */
  meanDifference: number;
  sdDifference: number | null;
  /** Present when inference was withheld, explaining why. */
  note?: string;
}

/**
 * Paired t-test over an array of (treatment - control) differences.
 *
 * Refuses to produce a statistic in two cases, both of which the previous
 * implementation papered over:
 *
 *  - Sample too small (n < MIN_TRIALS_FOR_INFERENCE).
 *  - Zero variance, where `meanDiff / (0 / sqrt(n))` is a division by zero.
 *    Note this is NOT evidence of a strong effect — it more often indicates a
 *    saturated judge, a cached response, or scores quantized so coarsely that
 *    every trial lands on the same value.
 */
export function pairedTTest(differences: number[]): PairedTTestResult {
  const n = differences.length;
  const meanDiff = Number(mean(differences).toFixed(2));

  if (n < MIN_TRIALS_FOR_INFERENCE) {
    return {
      tStatistic: null,
      pValue: null,
      meanDifference: meanDiff,
      sdDifference: standardDeviation(differences),
      note:
        `n = ${n}. At least ${MIN_TRIALS_FOR_INFERENCE} paired trials are ` +
        `required for a significance test; only the descriptive difference is reported.`,
    };
  }

  const sdDiff = standardDeviation(differences);

  if (sdDiff === null || sdDiff === 0) {
    return {
      tStatistic: null,
      pValue: null,
      meanDifference: meanDiff,
      sdDifference: sdDiff,
      note:
        'Zero variance: every paired difference is identical, so the t-statistic ' +
        'is undefined (division by zero). This usually indicates a saturated or ' +
        'coarsely quantized judge rather than a strong effect.',
    };
  }

  const sem = sdDiff / Math.sqrt(n);
  const t = meanDiff / sem;

  return {
    tStatistic: Number(t.toFixed(4)),
    pValue: Number(studentTPValue(t, n - 1).toFixed(4)),
    meanDifference: meanDiff,
    sdDifference: Number(sdDiff.toFixed(2)),
  };
}

/** Outcome of a Wilcoxon signed-rank test. */
export interface WilcoxonResult {
  wStatistic: number | null;
  pValue: number | null;
  zScore: number | null;
  /** Rank-biserial style effect size r = |z| / sqrt(n). */
  effectSizeR: number | null;
  note?: string;
}

/**
 * Wilcoxon signed-rank test — the non-parametric companion to the t-test.
 *
 * Included because judge scores are ordinal-ish and not reliably normal, so a
 * rank-based test is the more defensible primary analysis for small samples.
 * Zero differences are dropped, as the standard procedure requires.
 */
export function wilcoxonSignedRankTest(differences: number[]): WilcoxonResult {
  const nonZero = differences.filter((d) => Math.abs(d) > 0.00001);
  const n = nonZero.length;

  if (differences.length < MIN_TRIALS_FOR_INFERENCE) {
    return {
      wStatistic: null,
      pValue: null,
      zScore: null,
      effectSizeR: null,
      note:
        `n = ${differences.length}. At least ${MIN_TRIALS_FOR_INFERENCE} paired ` +
        `trials are required.`,
    };
  }

  if (n === 0) {
    return {
      wStatistic: null,
      pValue: null,
      zScore: null,
      effectSizeR: null,
      note: 'All paired differences are exactly zero; there is no signed rank to test.',
    };
  }

  const items = nonZero.map((d) => ({
    absDiff: Math.abs(d),
    sign: d > 0 ? 1 : -1,
    rank: 0,
  }));

  items.sort((a, b) => a.absDiff - b.absDiff);

  // Assign ranks, averaging across ties.
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && items[j].absDiff === items[j + 1].absDiff) j++;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) items[k].rank = avgRank;
    i = j + 1;
  }

  let wPlus = 0;
  let wMinus = 0;
  for (const item of items) {
    if (item.sign > 0) wPlus += item.rank;
    else wMinus += item.rank;
  }

  const w = Math.min(wPlus, wMinus);

  // Normal approximation with continuity correction.
  const expectedW = (n * (n + 1)) / 4;
  const varianceW = (n * (n + 1) * (2 * n + 1)) / 24;
  const stdW = Math.sqrt(varianceW);
  const z = stdW > 0 ? (w - expectedW + 0.5) / stdW : 0;
  const pValue = 2 * normalCdf(-Math.abs(z));

  return {
    wStatistic: Number(w.toFixed(1)),
    pValue: Number(Math.max(0.0001, Math.min(1.0, pValue)).toFixed(4)),
    zScore: Number(z.toFixed(4)),
    effectSizeR: Number((Math.abs(z) / Math.sqrt(n)).toFixed(3)),
    note:
      n < differences.length
        ? `${differences.length - n} zero difference(s) excluded per standard procedure.`
        : undefined,
  };
}

/**
 * Paired Cohen's d: mean(differences) / sd(differences).
 *
 * Null when the sample is too small or has no variance — the same two cases
 * that make the t-statistic undefined. Previously this returned 0 for zero
 * variance, which reads as "no effect" when the truth is "not computable".
 */
export function cohensDPaired(differences: number[]): number | null {
  if (differences.length < MIN_TRIALS_FOR_INFERENCE) return null;
  const sd = standardDeviation(differences);
  if (sd === null || sd === 0) return null;
  return Number((mean(differences) / sd).toFixed(3));
}

/**
 * Holm-Bonferroni step-down correction, controlling the family-wise error rate.
 *
 * WHY THIS IS NEEDED: running three comparisons at alpha = 0.05 gives roughly a
 * 14% chance of at least one false positive. Holm fixes that while being
 * uniformly more powerful than plain Bonferroni.
 *
 * Tests whose p-value is `null` (inference withheld) are excluded from the
 * family entirely and map back to `null`. That is the correct treatment: a test
 * that was never performed must not inflate the correction factor applied to
 * the tests that were.
 */
export function holmBonferroniCorrection(
  tests: { id: string; pValue: number | null }[]
): Record<string, number | null> {
  const adjustedMap: Record<string, number | null> = {};
  for (const test of tests) adjustedMap[test.id] = null;

  const performed = tests.filter(
    (t): t is { id: string; pValue: number } => typeof t.pValue === 'number'
  );
  const m = performed.length;
  if (m === 0) return adjustedMap;

  const sorted = [...performed].sort((a, b) => a.pValue - b.pValue);

  // p'_i = min(1, max over j <= i of (m - j + 1) * p_j) — the running maximum
  // enforces monotonicity, so a corrected p-value never decreases down the list.
  let runningMax = 0;
  for (let i = 0; i < m; i++) {
    const remainingTests = m - i;
    const adjusted = Math.min(1.0, Math.max(runningMax, remainingTests * sorted[i].pValue));
    runningMax = adjusted;
    adjustedMap[sorted[i].id] = Number(adjusted.toFixed(4));
  }

  return adjustedMap;
}

/**
 * Classifies a comparison into a reportable verdict.
 *
 * Requires BOTH a corrected p-value and a confidence interval. If either is
 * missing the verdict is 'INSUFFICIENT TRIALS' — the app no longer reaches a
 * conclusion from descriptive numbers alone.
 *
 * Significance additionally requires the CI to exclude zero, so a p-value that
 * squeaks under alpha while the interval straddles zero is not reported as a
 * lift.
 */
export function classifyInterpretation(
  adjustedPValue: number | null,
  meanDifference: number,
  ci95: [number, number] | null,
  alpha: number = 0.05
): StatisticalInterpretation {
  if (adjustedPValue === null || ci95 === null) return 'INSUFFICIENT TRIALS';

  const [ciLower, ciUpper] = ci95;

  if (adjustedPValue < alpha && meanDifference > 0 && ciLower > 0) {
    return 'SIGNIFICANT POSITIVE LIFT';
  }
  if (adjustedPValue < alpha && meanDifference < 0 && ciUpper < 0) {
    return 'NEGATIVE / DEGRADED';
  }
  if (meanDifference > 1.5) return 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT';
  if (meanDifference < -1.5) return 'NEGATIVE / DEGRADED';

  return 'NO MEANINGFUL DIFFERENCE';
}

/** Formats a p-value for display, or an em dash when none was computed. */
export function formatPValue(pValue: number | null): string {
  if (pValue === null) return '—';
  if (pValue < 0.001) return '< 0.001';
  return pValue.toFixed(3);
}

/** Formats a confidence interval for display, or an em dash when unavailable. */
export function formatCI(ci95: [number, number] | null): string {
  if (ci95 === null) return '—';
  return `[${ci95[0].toFixed(1)}, ${ci95[1].toFixed(1)}]`;
}

/** Formats a possibly-null numeric statistic to fixed precision. */
export function formatStat(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

/**
 * Builds a publication-style sentence describing a comparison.
 *
 * The 'INSUFFICIENT TRIALS' branch states the observed difference as plainly
 * descriptive and says exactly what is needed to test it — replacing the old
 * behaviour of narrating a verdict regardless of sample size.
 */
export function generateComparisonNarrative(
  label: string,
  interpretation: StatisticalInterpretation,
  meanDiff: number,
  ci95: [number, number] | null,
  pValue: number | null,
  adjustedP: number | null,
  cohenD: number | null,
  trialCount?: number,
  inferenceNote?: string
): string {
  const sign = meanDiff >= 0 ? '+' : '';
  const diffStr = `${sign}${meanDiff.toFixed(1)} pts`;

  if (interpretation === 'INSUFFICIENT TRIALS') {
    const nClause =
      typeof trialCount === 'number'
        ? `${trialCount} paired trial${trialCount === 1 ? '' : 's'}`
        : 'this sample';
    const reason = inferenceNote
      ? ` ${inferenceNote}`
      : ` At least ${MIN_TRIALS_FOR_INFERENCE} paired trials are required for a significance test.`;
    return (
      `${label} shows an observed difference of ${diffStr} across ${nClause}. ` +
      `This is a descriptive figure only — no p-value, confidence interval or ` +
      `effect size is reported.${reason}`
    );
  }

  const ciStr = `95% CI ${formatCI(ci95)}`;
  const pStr = `p = ${formatPValue(pValue)} (Holm-adj p = ${formatPValue(adjustedP)})`;
  const dStr = `d = ${formatStat(cohenD)}`;

  switch (interpretation) {
    case 'SIGNIFICANT POSITIVE LIFT':
      return `${label} demonstrated a statistically significant lift of ${diffStr} (${ciStr}, ${pStr}, ${dStr}). This confirms an information-content advantage beyond raw token length.`;
    case 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT':
      return `${label} showed an observed lift of ${diffStr} (${ciStr}, ${pStr}), but the difference did not reach significance under Holm-Bonferroni correction. More paired trials, or less noisy targets, are needed to rule out sample variance.`;
    case 'NO MEANINGFUL DIFFERENCE':
      return `${label} showed no meaningful divergence (${diffStr}, ${ciStr}, ${pStr}). Performance stayed within the length control's margin, indicating raw token volume explains the result.`;
    case 'NEGATIVE / DEGRADED':
      return `${label} degraded performance by ${diffStr} (${ciStr}, ${pStr}, ${dStr}). Irrelevant context or distractor tokens appear to have impaired documentation synthesis.`;
  }
}
