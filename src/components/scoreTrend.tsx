/**
 * Score trend indicators shared between the verdict card and the comparison view.
 *
 * Components only — the percentage arithmetic lives in `utils/scoreChange` so
 * that this file exports nothing but components. React Fast Refresh only
 * hot-updates component-only modules; a mixed module forces a full page reload
 * on every edit, discarding any in-progress run.
 */

import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { ScoreChange, calculatePctChange } from '../utils/scoreChange';

/**
 * Visual directional trend indicator (up/down colored arrows)
 * Provides immediate feedback on performance drift.
 */
export const DirectionalTrendArrow: React.FC<{
  change: ScoreChange;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}> = ({ change, className = '', size = 'sm' }) => {
  const iconSize = size === 'xs' ? 'w-2.5 h-2.5' : size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3';
  const strokeClass = 'stroke-[2.5] shrink-0';

  if (change.isPositive) {
    return (
      <ArrowUp
        className={`${iconSize} text-emerald-600 ${strokeClass} ${className}`}
        aria-label="Performance gain"
      />
    );
  }
  if (change.isNegative) {
    return (
      <ArrowDown
        className={`${iconSize} text-rose-600 ${strokeClass} ${className}`}
        aria-label="Performance drift / degradation"
      />
    );
  }
  return (
    <Minus
      className={`${iconSize} text-slate-400 ${strokeClass} ${className}`}
      aria-label="Performance parity"
    />
  );
};

export const ScoreTrendBadge: React.FC<{
  current: number;
  previous?: number;
  label?: string;
  className?: string;
}> = ({ current, previous, label = 'vs prev run', className = '' }) => {
  if (previous === undefined || previous === null) return null;
  const change = calculatePctChange(current, previous);
  if (!change) return null;

  return (
    <div
      title={previous ? `Previous score: ${previous}/100 → Current: ${current}/100 (${change.formatted} ${label}, ${change.rawDelta >= 0 ? `+${change.rawDelta}` : change.rawDelta} pts)` : undefined}
      className={`inline-flex items-center space-x-1.5 text-[10px] sm:text-[11px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs transition-all ${
        change.isPositive
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : change.isNegative
          ? 'bg-rose-50 text-rose-800 border-rose-200'
          : 'bg-slate-100 text-slate-700 border-slate-200'
      } ${className}`}
    >
      {/* Visual Directional Trend Indicator (Up/Down Colored Arrow) */}
      <span
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
          change.isPositive
            ? 'bg-emerald-200/80'
            : change.isNegative
            ? 'bg-rose-200/80'
            : 'bg-slate-200'
        }`}
      >
        <DirectionalTrendArrow change={change} size="xs" />
      </span>
      <span>{change.formatted}</span>
      {label && <span className="text-[9px] font-sans font-normal text-slate-500">{label}</span>}
    </div>
  );
};
