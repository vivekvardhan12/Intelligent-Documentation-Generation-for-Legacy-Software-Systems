/**
 * Percentage-change arithmetic for comparing a run against the previous one.
 *
 * A pure module, deliberately separate from the components that render it:
 * React Fast Refresh only hot-updates files that export components alone, so
 * mixing this helper in with the trend badges forced a full page reload — and
 * a loss of all in-progress run state — on every edit.
 */

/** A computed change between two scores, pre-formatted for display. */
export interface ScoreChange {
  /** Percentage change from previous to current. */
  pct: number;
  /** Signed, one-decimal percentage string, e.g. "+4.2%". */
  formatted: string;
  /** Absolute point difference. */
  rawDelta: number;
  isPositive: boolean;
  isNegative: boolean;
  /** True when the change is within the noise threshold either way. */
  isFlat: boolean;
}

/**
 * Threshold below which a change is treated as flat.
 *
 * Judge composites wobble by fractions of a point between identical runs, so
 * reporting a 0.01% "gain" as an improvement would be noise dressed up as a
 * signal.
 */
const FLAT_THRESHOLD_PCT = 0.05;

/**
 * Computes the change from `previous` to `current`.
 *
 * Returns null when there is no comparable baseline — no previous value, or a
 * previous value of zero, which would make the percentage infinite.
 */
export function calculatePctChange(current: number, previous?: number): ScoreChange | null {
  if (previous === undefined || previous === null || previous === 0) return null;

  const rawDelta = current - previous;
  const pct = (rawDelta / previous) * 100;
  const isPositive = pct > FLAT_THRESHOLD_PCT;
  const isNegative = pct < -FLAT_THRESHOLD_PCT;

  return {
    pct,
    formatted: `${isPositive ? '+' : ''}${pct.toFixed(1)}%`,
    rawDelta,
    isPositive,
    isNegative,
    isFlat: !isPositive && !isNegative,
  };
}
