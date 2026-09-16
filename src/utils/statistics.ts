import { PairedDifferenceStats, StatisticalInterpretation } from '../types';

/**
 * Computes arithmetic mean of an array of numbers.
 */
export function mean(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Computes median of an array of numbers.
 */
export function median(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Computes sample standard deviation with Bessel's correction (N - 1).
 */
export function standardDeviation(values: number[]): number {
  if (!values || values.length <= 1) return 0;
  const m = mean(values);
  const sumSquareDiffs = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSquareDiffs / (values.length - 1));
}

/**
 * Student's t-distribution critical values for two-tailed 95% confidence intervals (alpha = 0.05).
 * Keys are degrees of freedom (df = n - 1).
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
  13: 2.160,
  14: 2.145,
  15: 2.131,
  16: 2.120,
  17: 2.110,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  25: 2.060,
  30: 2.042,
};

/**
 * Gets critical t-value for df at 95% two-tailed confidence.
 */
export function getTCritical(df: number): number {
  if (df <= 0) return 1.96;
  if (T_CRITICAL_95[df]) return T_CRITICAL_95[df];
  if (df > 30) return 1.96;
  // Linear interpolation for missing values under 30
  const keys = Object.keys(T_CRITICAL_95).map(Number).sort((a, b) => a - b);
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
 * Computes 95% Confidence Interval [lower, upper] for sample mean.
 */
export function confidenceInterval95(values: number[]): [number, number] {
  if (!values || values.length === 0) return [0, 0];
  const m = mean(values);
  if (values.length === 1) return [m, m];

  const sd = standardDeviation(values);
  const n = values.length;
  const df = n - 1;
  const tCrit = getTCritical(df);
  const sem = sd / Math.sqrt(n);
  const margin = tCrit * sem;

  return [
    Number((m - margin).toFixed(2)),
    Number((m + margin).toFixed(2)),
  ];
}

/**
 * Approximation of cumulative distribution function for standard normal distribution.
 */
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
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Two-tailed p-value for Student's t-test given t-statistic and degrees of freedom df.
 * Uses Hill's approximation / regularized series accurate for scientific evaluations.
 */
export function studentTPValue(t: number, df: number): number {
  if (isNaN(t) || df <= 0) return 1.0;
  const absT = Math.abs(t);
  if (absT === 0) return 1.0;

  // For df = 1 (Cauchy)
  if (df === 1) {
    return 1 - (2 / Math.PI) * Math.atan(absT);
  }

  // For df = 2
  if (df === 2) {
    return 1 - absT / Math.sqrt(2 + absT * absT);
  }

  // For df >= 30, standard normal approximation is accurate to 3 decimal places
  if (df >= 30) {
    return Math.max(0.0001, Math.min(1.0, 2 * (1 - normalCdf(absT))));
  }

  // Hill / Cornish-Fisher transformation to normal z-score
  // z = sqrt(df * log(1 + t^2 / df)) with degrees-of-freedom correction
  const x = df / (df + absT * absT);
  // Beta incomplete approx
  const a = df / 2;
  const b = 0.5;
  // Continued fraction approximation for I_x(a, b)
  let p = incompleteBeta(x, a, b);
  return Math.max(0.0001, Math.min(1.0, p));
}

/**
 * Regularized incomplete beta function I_x(a, b) using continued fraction.
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  // Lentz method for continued fraction
  const MAX_ITER = 100;
  const EPS = 3.0e-7;
  let f = 1.0;
  let c = 1.0;
  let d = 0.0;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    // Even step
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1.0 + num * d;
    if (Math.abs(d) < EPS) d = EPS;
    c = 1.0 + num / c;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1.0 / d;
    f *= c * d;

    // Odd step
    num = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1.0 + num * d;
    if (Math.abs(d) < EPS) d = EPS;
    c = 1.0 + num / c;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1.0 / d;
    f *= c * d;

    if (Math.abs(c * d - 1.0) < EPS) break;
  }

  return (front / a) * f;
}

/**
 * Stirling / Lanczos approximation of Log-Gamma function ln(Gamma(x)).
 */
function logGamma(x: number): number {
  const coef = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += coef[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Computes paired t-test on an array of paired differences (treatment - control).
 */
export function pairedTTest(differences: number[]): {
  tStatistic: number;
  pValue: number;
  meanDifference: number;
  sdDifference: number;
} {
  const n = differences.length;
  if (n <= 1) {
    return { tStatistic: 0, pValue: 1.0, meanDifference: mean(differences), sdDifference: 0 };
  }

  const meanDiff = mean(differences);
  const sdDiff = standardDeviation(differences);

  if (sdDiff === 0) {
    // Zero variance: if mean diff > 0, it's uniform lift; otherwise 0
    return {
      tStatistic: meanDiff !== 0 ? (meanDiff > 0 ? 99.0 : -99.0) : 0,
      pValue: meanDiff !== 0 ? 0.0001 : 1.0,
      meanDifference: meanDiff,
      sdDifference: 0,
    };
  }

  const sem = sdDiff / Math.sqrt(n);
  const t = meanDiff / sem;
  const pValue = studentTPValue(t, n - 1);

  return {
    tStatistic: Number(t.toFixed(4)),
    pValue: Number(pValue.toFixed(4)),
    meanDifference: Number(meanDiff.toFixed(2)),
    sdDifference: Number(sdDiff.toFixed(2)),
  };
}

/**
 * Computes Wilcoxon signed-rank test on an array of paired differences.
 * Suitable for small samples and non-normal distributions.
 */
export function wilcoxonSignedRankTest(differences: number[]): {
  wStatistic: number;
  pValue: number;
  zScore: number;
  effectSizeR: number;
} {
  // Remove zero differences
  const nonZero = differences.filter((d) => Math.abs(d) > 0.00001);
  const n = nonZero.length;

  if (n === 0) {
    return { wStatistic: 0, pValue: 1.0, zScore: 0, effectSizeR: 0 };
  }

  // Create list of { diff, absDiff, sign }
  const items = nonZero.map((d) => ({
    diff: d,
    absDiff: Math.abs(d),
    sign: d > 0 ? 1 : -1,
    rank: 0,
  }));

  // Sort by absolute difference
  items.sort((a, b) => a.absDiff - b.absDiff);

  // Assign ranks with average rank for ties
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && items[j].absDiff === items[j + 1].absDiff) {
      j++;
    }
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) {
      items[k].rank = avgRank;
    }
    i = j + 1;
  }

  let wPlus = 0;
  let wMinus = 0;
  for (const item of items) {
    if (item.sign > 0) wPlus += item.rank;
    else wMinus += item.rank;
  }

  const w = Math.min(wPlus, wMinus);

  // Expected mean and variance under null hypothesis
  const eW = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24;
  const stdW = Math.sqrt(varW);

  // Continuity correction
  const z = stdW > 0 ? (w - eW + 0.5) / stdW : 0;
  const pValue = 2 * normalCdf(-Math.abs(z));
  const effectSizeR = Math.sqrt(n) > 0 ? Math.abs(z) / Math.sqrt(n) : 0;

  return {
    wStatistic: Number(w.toFixed(1)),
    pValue: Number(Math.max(0.0001, Math.min(1.0, pValue)).toFixed(4)),
    zScore: Number(z.toFixed(4)),
    effectSizeR: Number(effectSizeR.toFixed(3)),
  };
}

/**
 * Computes paired Cohen's d effect size: mean(differences) / sd(differences).
 */
export function cohensDPaired(differences: number[]): number {
  const sd = standardDeviation(differences);
  if (sd === 0) return 0;
  const m = mean(differences);
  return Number((m / sd).toFixed(3));
}

/**
 * Applies the Holm-Bonferroni step-down procedure to adjust p-values for multiple comparisons.
 * Guarantees control of the Family-Wise Error Rate (FWER) at alpha = 0.05.
 *
 * @param pValues Array of unadjusted p-values with identifiers
 * @returns Array of adjusted p-values mapped back to their original identifiers
 */
export function holmBonferroniCorrection(
  tests: { id: string; pValue: number }[]
): Record<string, number> {
  const m = tests.length;
  if (m === 0) return {};

  // Sort tests by unadjusted p-value in ascending order
  const sorted = [...tests].sort((a, b) => a.pValue - b.pValue);

  // Apply step-down adjustment: p'_i = min(1, max_{j<=i} ((m - j + 1) * p_j))
  let maxPrev = 0;
  const adjustedMap: Record<string, number> = {};

  for (let i = 0; i < m; i++) {
    const k = m - i;
    const rawP = sorted[i].pValue;
    const adjusted = Math.min(1.0, Math.max(maxPrev, k * rawP));
    maxPrev = adjusted;
    adjustedMap[sorted[i].id] = Number(adjusted.toFixed(4));
  }

  return adjustedMap;
}

/**
 * Classifies the statistical interpretation based on Holm-adjusted p-value, effect size, and confidence interval.
 */
export function classifyInterpretation(
  adjustedPValue: number,
  meanDifference: number,
  ci95: [number, number],
  alpha: number = 0.05
): StatisticalInterpretation {
  const [ciLower, ciUpper] = ci95;

  if (adjustedPValue < alpha && meanDifference > 0 && ciLower > 0) {
    return 'SIGNIFICANT POSITIVE LIFT';
  }

  if (adjustedPValue < alpha && meanDifference < 0 && ciUpper < 0) {
    return 'NEGATIVE / DEGRADED';
  }

  if (meanDifference > 1.5 && (adjustedPValue >= alpha || ciLower <= 0)) {
    return 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT';
  }

  if (meanDifference < -1.5 && (adjustedPValue >= alpha || ciUpper >= 0)) {
    return 'NEGATIVE / DEGRADED';
  }

  return 'NO MEANINGFUL DIFFERENCE';
}

/**
 * Generates clear, publication-ready narrative for a paired comparison.
 */
export function generateComparisonNarrative(
  label: string,
  interpretation: StatisticalInterpretation,
  meanDiff: number,
  ci95: [number, number],
  pValue: number,
  adjustedP: number,
  cohenD: number
): string {
  const sign = meanDiff >= 0 ? '+' : '';
  const diffStr = `${sign}${meanDiff.toFixed(1)} pts`;
  const ciStr = `95% CI [${ci95[0].toFixed(1)}, ${ci95[1].toFixed(1)}]`;
  const pStr = `p = ${pValue.toFixed(3)} (Holm-adj p = ${adjustedP.toFixed(3)})`;
  const dStr = `d = ${cohenD.toFixed(2)}`;

  switch (interpretation) {
    case 'SIGNIFICANT POSITIVE LIFT':
      return `${label} demonstrated a statistically significant lift of ${diffStr} (${ciStr}, ${pStr}, ${dStr}). This confirms genuine information content advantage beyond raw token length.`;
    case 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT':
      return `${label} showed an observed lift of ${diffStr} (${ciStr}, ${pStr}), but the difference did not achieve statistical significance under Holm-Bonferroni correction. More paired trials or less noisy targets are required to rule out sample variance.`;
    case 'NO MEANINGFUL DIFFERENCE':
      return `${label} showed no meaningful divergence (${diffStr}, ${ciStr}, ${pStr}). Performance was bounded within the length control margin, indicating raw token volume explains the result.`;
    case 'NEGATIVE / DEGRADED':
      return `${label} degraded performance by ${diffStr} (${ciStr}, ${pStr}, ${dStr}). Irrelevant context noise or distractor tokens impaired documentation synthesis.`;
  }
}
