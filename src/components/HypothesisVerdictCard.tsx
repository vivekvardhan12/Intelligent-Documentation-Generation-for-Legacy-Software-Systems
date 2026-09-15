import React from 'react';
import { ExperimentRun } from '../types';
import {
  Award,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Scale,
  Activity,
  Zap,
  ShieldCheck,
} from 'lucide-react';

interface HypothesisVerdictCardProps {
  experimentRun: ExperimentRun;
  previousRun?: ExperimentRun | null;
}

export interface ScoreChange {
  pct: number;
  formatted: string;
  rawDelta: number;
  isPositive: boolean;
  isNegative: boolean;
  isFlat: boolean;
}

export const calculatePctChange = (current: number, previous?: number): ScoreChange | null => {
  if (previous === undefined || previous === null || previous === 0) return null;
  const rawDelta = current - previous;
  const pct = ((current - previous) / previous) * 100;
  const isPositive = pct > 0.05;
  const isNegative = pct < -0.05;
  const isFlat = !isPositive && !isNegative;
  const formatted = `${isPositive ? '+' : ''}${pct.toFixed(1)}%`;
  return { pct, formatted, rawDelta, isPositive, isNegative, isFlat };
};

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

export const HypothesisVerdictCard: React.FC<HypothesisVerdictCardProps> = ({
  experimentRun,
  previousRun,
}) => {
  const analysis = experimentRun.analysis;
  const results = experimentRun.results;

  if (!analysis || !results) return null;

  const floorScore = results.code_only?.evaluation?.overallQuality || 0;
  const controlScore = results.few_shot_control?.evaluation?.overallQuality || 0;
  const callGraphScore = results.call_graph?.evaluation?.overallQuality || 0;
  const gitHistoryScore = results.git_history?.evaluation?.overallQuality || 0;

  // Previous scores for comparison
  const prevFloorScore = previousRun?.results?.code_only?.evaluation?.overallQuality;
  const prevControlScore = previousRun?.results?.few_shot_control?.evaluation?.overallQuality;
  const prevCallGraphScore = previousRun?.results?.call_graph?.evaluation?.overallQuality;
  const prevGitHistoryScore = previousRun?.results?.git_history?.evaluation?.overallQuality;
  const prevBudget = previousRun?.tokenBudget;

  const budgetChanged = prevBudget !== undefined && prevBudget !== experimentRun.tokenBudget;
  const budgetDeltaPct = prevBudget ? (((experimentRun.tokenBudget - prevBudget) / prevBudget) * 100).toFixed(0) : null;
  const compLabel = budgetChanged ? `vs ${prevBudget}t` : 'vs prev run';

  // Overall drift metric
  const avgCurrentQuality = (floorScore + controlScore + callGraphScore + gitHistoryScore) / 4;
  const avgPrevQuality =
    prevFloorScore !== undefined && prevControlScore !== undefined && prevCallGraphScore !== undefined && prevGitHistoryScore !== undefined
      ? (prevFloorScore + prevControlScore + prevCallGraphScore + prevGitHistoryScore) / 4
      : undefined;
  const overallQualityDrift = calculatePctChange(avgCurrentQuality, avgPrevQuality);

  return (
    <div id="hypothesis-verdict-card" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
      {/* Header & Meta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center space-x-2">
            <Award className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Scientific Hypothesis Verdict & Confound Isolation
            </h2>
          </div>
          {previousRun && (
            <p className="text-xs text-slate-500 mt-0.5 flex items-center space-x-1.5 font-sans">
              <span>Comparing against prior trial:</span>
              <span className="font-semibold text-slate-700">{previousRun.targetName} ({prevBudget} tokens)</span>
            </p>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-1.5">
          {budgetChanged && (
            <span className="text-xs font-mono font-bold text-slate-800 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md flex items-center space-x-1.5 shadow-2xs">
              <span className="text-slate-600">Budget: {prevBudget}t</span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="text-indigo-900">{experimentRun.tokenBudget}t</span>
              {budgetDeltaPct && (
                <span className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                  Number(budgetDeltaPct) > 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : Number(budgetDeltaPct) < 0
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {Number(budgetDeltaPct) > 0 ? (
                    <ArrowUp className="w-3 h-3 text-emerald-700 stroke-[2.5]" />
                  ) : Number(budgetDeltaPct) < 0 ? (
                    <ArrowDown className="w-3 h-3 text-rose-700 stroke-[2.5]" />
                  ) : (
                    <Minus className="w-2.5 h-2.5 text-slate-500 stroke-[2.5]" />
                  )}
                  <span>{Number(budgetDeltaPct) > 0 ? `+${budgetDeltaPct}%` : `${budgetDeltaPct}%`}</span>
                </span>
              )}
            </span>
          )}
          <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-md">
            Budget: {experimentRun.tokenBudget} tokens | Target: {experimentRun.targetName}
          </span>
        </div>
      </div>

      {/* Performance Drift Matrix vs Previous Run Ribbon */}
      {previousRun && (
        <div className="bg-slate-50/90 border border-slate-200/90 rounded-lg p-3 sm:p-3.5 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-2">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Performance Drift vs Previous Run
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                ({prevBudget}t → {experimentRun.tokenBudget}t)
              </span>
            </div>

            {overallQualityDrift && (
              <div className="flex items-center space-x-1.5 text-xs">
                <span className="text-slate-500 font-sans">Mean Quality Drift:</span>
                <span className={`inline-flex items-center space-x-1 font-mono font-bold px-2 py-0.5 rounded text-[11px] border ${
                  overallQualityDrift.isPositive
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : overallQualityDrift.isNegative
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  <DirectionalTrendArrow change={overallQualityDrift} size="xs" />
                  <span>{overallQualityDrift.formatted}</span>
                  <span className="font-normal font-sans text-[10px] text-slate-500">
                    ({overallQualityDrift.rawDelta >= 0 ? `+${overallQualityDrift.rawDelta.toFixed(1)}` : overallQualityDrift.rawDelta.toFixed(1)} pts)
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* 4-Arm Quick Drift Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {/* Floor */}
            <div className="bg-white p-2.5 rounded-md border border-slate-200 flex flex-col justify-between space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 font-medium">Floor (Code-Only)</span>
                <span className="font-mono font-bold text-slate-900">{floorScore}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="text-[10px] text-slate-400 font-mono">prev {prevFloorScore || '—'}</span>
                <ScoreTrendBadge current={floorScore} previous={prevFloorScore} label="" className="py-0 px-1 text-[10px]" />
              </div>
            </div>

            {/* Few-Shot Control */}
            <div className="bg-white p-2.5 rounded-md border border-indigo-100 flex flex-col justify-between space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-indigo-900 font-medium">Few-Shot Control</span>
                <span className="font-mono font-bold text-indigo-950">{controlScore}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-indigo-50">
                <span className="text-[10px] text-slate-400 font-mono">prev {prevControlScore || '—'}</span>
                <ScoreTrendBadge current={controlScore} previous={prevControlScore} label="" className="py-0 px-1 text-[10px]" />
              </div>
            </div>

            {/* Call-Graph */}
            <div className="bg-white p-2.5 rounded-md border border-emerald-100 flex flex-col justify-between space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-emerald-900 font-medium">Call-Graph</span>
                <span className="font-mono font-bold text-emerald-950">{callGraphScore}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-emerald-50">
                <span className="text-[10px] text-slate-400 font-mono">prev {prevCallGraphScore || '—'}</span>
                <ScoreTrendBadge current={callGraphScore} previous={prevCallGraphScore} label="" className="py-0 px-1 text-[10px]" />
              </div>
            </div>

            {/* Git-History */}
            <div className="bg-white p-2.5 rounded-md border border-amber-100 flex flex-col justify-between space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-amber-900 font-medium">Git-History</span>
                <span className="font-mono font-bold text-amber-950">{gitHistoryScore}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-amber-50">
                <span className="text-[10px] text-slate-400 font-mono">prev {prevGitHistoryScore || '—'}</span>
                <ScoreTrendBadge current={gitHistoryScore} previous={prevGitHistoryScore} label="" className="py-0 px-1 text-[10px]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Trial Statistical Significance Panel */}
      {experimentRun.multiTrialSession && (
        <div className="bg-indigo-950/90 text-white rounded-xl p-4 sm:p-5 border border-indigo-900 shadow-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-indigo-800/80">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-indigo-300">
                    Inferential Statistics (N = {experimentRun.multiTrialSession.numTrials} Paired Trials)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-800/80 text-indigo-200 border border-indigo-700">
                    Holm-Bonferroni Corrected
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mt-0.5">
                  {experimentRun.multiTrialSession.overallVerdict.headline}
                </h3>
              </div>
            </div>
            <div className="text-right font-mono text-xs text-indigo-300 shrink-0">
              <span>Judge: {experimentRun.multiTrialSession.judgeModel} (Blind)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Call-Graph Paired Stats */}
            {(() => {
              const cg = experimentRun.multiTrialSession.comparisons.callGraphLift;
              const isSig = cg.interpretation === 'SIGNIFICANT POSITIVE LIFT';
              return (
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">Call-Graph vs Control</span>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        isSig
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                          : 'bg-amber-950 text-amber-300 border-amber-700'
                      }`}
                    >
                      {cg.interpretation}
                    </span>
                  </div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-xl font-bold font-mono text-white">
                      {cg.meanDifference >= 0 ? `+${cg.meanDifference}` : cg.meanDifference} pts
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      95% CI [{cg.ci95.lower}, {cg.ci95.upper}]
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 space-y-0.5 border-t border-slate-800 pt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Paired t-test:</span>
                      <span>p = {cg.pValuetTest} (t = {cg.tStatistic})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Wilcoxon W:</span>
                      <span>p = {cg.pValueWilcoxon} (W = {cg.wStatistic})</span>
                    </div>
                    <div className="flex justify-between font-bold text-indigo-300">
                      <span>Holm-Adjusted p:</span>
                      <span>p = {cg.adjustedPValue}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cohen's d:</span>
                      <span>d = {cg.effectSizeCohenD} (r = {cg.effectSizeWilcoxonR})</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Git-History Paired Stats */}
            {(() => {
              const git = experimentRun.multiTrialSession.comparisons.gitHistoryLift;
              const isSig = git.interpretation === 'SIGNIFICANT POSITIVE LIFT';
              return (
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400">Git-History vs Control</span>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        isSig
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                          : 'bg-amber-950 text-amber-300 border-amber-700'
                      }`}
                    >
                      {git.interpretation}
                    </span>
                  </div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-xl font-bold font-mono text-white">
                      {git.meanDifference >= 0 ? `+${git.meanDifference}` : git.meanDifference} pts
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      95% CI [{git.ci95.lower}, {git.ci95.upper}]
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 space-y-0.5 border-t border-slate-800 pt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Paired t-test:</span>
                      <span>p = {git.pValuetTest} (t = {git.tStatistic})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Wilcoxon W:</span>
                      <span>p = {git.pValueWilcoxon} (W = {git.wStatistic})</span>
                    </div>
                    <div className="flex justify-between font-bold text-indigo-300">
                      <span>Holm-Adjusted p:</span>
                      <span>p = {git.adjustedPValue}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cohen's d:</span>
                      <span>d = {git.effectSizeCohenD} (r = {git.effectSizeWilcoxonR})</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Length Confound Paired Stats */}
            {(() => {
              const len = experimentRun.multiTrialSession.comparisons.lengthEffect;
              return (
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-400">Length Effect (Control vs Floor)</span>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700">
                      Confound Lift
                    </span>
                  </div>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-xl font-bold font-mono text-white">
                      {len.meanDifference >= 0 ? `+${len.meanDifference}` : len.meanDifference} pts
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      95% CI [{len.ci95.lower}, {len.ci95.upper}]
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 space-y-0.5 border-t border-slate-800 pt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Paired t-test:</span>
                      <span>p = {len.pValuetTest} (t = {len.tStatistic})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Wilcoxon W:</span>
                      <span>p = {len.pValueWilcoxon} (W = {len.wStatistic})</span>
                    </div>
                    <div className="flex justify-between font-bold text-indigo-300">
                      <span>Holm-Adjusted p:</span>
                      <span>p = {len.adjustedPValue}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cohen's d:</span>
                      <span>d = {len.effectSizeCohenD}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 3-Column Delta Breakdown matching Professional Polish Spec */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Column 1: Length Effect (Control vs Floor) */}
        <div className="bg-indigo-50/70 p-4 rounded-lg space-y-2.5 border border-indigo-100 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider flex items-center space-x-1.5">
                <Scale className="w-3.5 h-3.5 text-indigo-600" />
                <span>1. Length Confound Lift</span>
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-200/80 text-indigo-900">
                {analysis.lengthEffectDelta >= 0 ? `+${analysis.lengthEffectDelta}` : analysis.lengthEffectDelta} pts
              </span>
            </div>

            <div className="flex items-baseline justify-between flex-wrap gap-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-indigo-900 font-mono">
                  {controlScore}
                </span>
                <span className="text-xs text-indigo-700 font-mono font-medium">
                  vs Floor ({floorScore})
                </span>
              </div>
              <ScoreTrendBadge current={controlScore} previous={prevControlScore} label={compLabel} />
            </div>

            <p className="text-xs text-indigo-900 leading-relaxed">
              Gain achieved solely from adding {experimentRun.tokenBudget} tokens of unrelated few-shot code formatting (0 repo info).
            </p>
          </div>

          {prevControlScore !== undefined && (
            <div className="pt-2 border-t border-indigo-100/80 text-[11px] font-mono text-indigo-800 flex items-center justify-between">
              <span className="text-indigo-700">Prior Quality: {prevControlScore}/100</span>
              <span className="font-semibold flex items-center space-x-1">
                <span>{controlScore - prevControlScore >= 0 ? `+${controlScore - prevControlScore}` : controlScore - prevControlScore} pts</span>
                {(() => {
                  const chg = calculatePctChange(controlScore, prevControlScore);
                  if (!chg) return null;
                  return (
                    <span className={`inline-flex items-center space-x-0.5 px-1 py-0.2 rounded text-[10px] ${
                      chg.isPositive ? 'text-emerald-700 font-bold' : chg.isNegative ? 'text-rose-700 font-bold' : 'text-slate-500'
                    }`}>
                      <DirectionalTrendArrow change={chg} size="xs" />
                      <span>({chg.formatted})</span>
                    </span>
                  );
                })()}
              </span>
            </div>
          )}
        </div>

        {/* Column 2: Call-Graph Net Lift */}
        <div
          className={`p-4 rounded-lg space-y-2.5 border flex flex-col justify-between ${
            analysis.callGraphVerdict === 'genuine_lift'
              ? 'bg-emerald-50/70 border-emerald-200/80'
              : analysis.callGraphVerdict === 'length_confounded'
              ? 'bg-amber-50/70 border-amber-200/80'
              : 'bg-rose-50/70 border-rose-200/80'
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                <span>2. Call-Graph Net Semantic Lift</span>
              </span>
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  analysis.callGraphVerdict === 'genuine_lift'
                    ? 'bg-emerald-200/80 text-emerald-900'
                    : 'bg-slate-200 text-slate-800'
                }`}
              >
                {analysis.callGraphContentLift >= 0
                  ? `+${analysis.callGraphContentLift}`
                  : analysis.callGraphContentLift}{' '}
                pts
              </span>
            </div>

            <div className="flex items-baseline justify-between flex-wrap gap-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-emerald-900 font-mono">
                  {callGraphScore}
                </span>
                <span className="text-xs text-emerald-800 font-mono font-medium">
                  vs Control ({controlScore})
                </span>
              </div>
              <ScoreTrendBadge current={callGraphScore} previous={prevCallGraphScore} label={compLabel} />
            </div>

            <div className="flex items-center space-x-1.5 pt-0.5">
              {analysis.callGraphVerdict === 'genuine_lift' ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                  <span>Genuine Context Lift</span>
                </span>
              ) : analysis.callGraphVerdict === 'length_confounded' ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span>Length Confounded</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>Degraded / Distracted</span>
                </span>
              )}
            </div>
          </div>

          {prevCallGraphScore !== undefined && (
            <div className="pt-2 border-t border-emerald-200/60 text-[11px] font-mono text-emerald-800 flex items-center justify-between">
              <span>Prior Quality: {prevCallGraphScore}/100</span>
              <span className="font-semibold flex items-center space-x-1">
                <span>{callGraphScore - prevCallGraphScore >= 0 ? `+${callGraphScore - prevCallGraphScore}` : callGraphScore - prevCallGraphScore} pts</span>
                {(() => {
                  const chg = calculatePctChange(callGraphScore, prevCallGraphScore);
                  if (!chg) return null;
                  return (
                    <span className={`inline-flex items-center space-x-0.5 px-1 py-0.2 rounded text-[10px] ${
                      chg.isPositive ? 'text-emerald-700 font-bold' : chg.isNegative ? 'text-rose-700 font-bold' : 'text-slate-500'
                    }`}>
                      <DirectionalTrendArrow change={chg} size="xs" />
                      <span>({chg.formatted})</span>
                    </span>
                  );
                })()}
              </span>
            </div>
          )}
        </div>

        {/* Column 3: Git-History Net Lift */}
        <div
          className={`p-4 rounded-lg space-y-2.5 border flex flex-col justify-between ${
            analysis.gitHistoryVerdict === 'genuine_lift'
              ? 'bg-amber-50/70 border-amber-200/80'
              : analysis.gitHistoryVerdict === 'length_confounded'
              ? 'bg-slate-50 border-slate-200'
              : 'bg-rose-50/70 border-rose-200/80'
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                <span>3. Git-History Net Semantic Lift</span>
              </span>
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  analysis.gitHistoryVerdict === 'genuine_lift'
                    ? 'bg-amber-200/80 text-amber-900'
                    : 'bg-slate-200 text-slate-800'
                }`}
              >
                {analysis.gitHistoryContentLift >= 0
                  ? `+${analysis.gitHistoryContentLift}`
                  : analysis.gitHistoryContentLift}{' '}
                pts
              </span>
            </div>

            <div className="flex items-baseline justify-between flex-wrap gap-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-slate-900 font-mono">
                  {gitHistoryScore}
                </span>
                <span className="text-xs text-slate-600 font-mono font-medium">
                  vs Control ({controlScore})
                </span>
              </div>
              <ScoreTrendBadge current={gitHistoryScore} previous={prevGitHistoryScore} label={compLabel} />
            </div>

            <div className="flex items-center space-x-1.5 pt-0.5">
              {analysis.gitHistoryVerdict === 'genuine_lift' ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  <CheckCircle className="w-3 h-3 text-amber-600" />
                  <span>Genuine Context Lift</span>
                </span>
              ) : analysis.gitHistoryVerdict === 'length_confounded' ? (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                  <AlertTriangle className="w-3 h-3 text-slate-600" />
                  <span>Length Confounded</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>Degraded / Distracted</span>
                </span>
              )}
            </div>
          </div>

          {prevGitHistoryScore !== undefined && (
            <div className="pt-2 border-t border-slate-200 text-[11px] font-mono text-slate-700 flex items-center justify-between">
              <span>Prior Quality: {prevGitHistoryScore}/100</span>
              <span className="font-semibold flex items-center space-x-1">
                <span>{gitHistoryScore - prevGitHistoryScore >= 0 ? `+${gitHistoryScore - prevGitHistoryScore}` : gitHistoryScore - prevGitHistoryScore} pts</span>
                {(() => {
                  const chg = calculatePctChange(gitHistoryScore, prevGitHistoryScore);
                  if (!chg) return null;
                  return (
                    <span className={`inline-flex items-center space-x-0.5 px-1 py-0.2 rounded text-[10px] ${
                      chg.isPositive ? 'text-emerald-700 font-bold' : chg.isNegative ? 'text-rose-700 font-bold' : 'text-slate-500'
                    }`}>
                      <DirectionalTrendArrow change={chg} size="xs" />
                      <span>({chg.formatted})</span>
                    </span>
                  );
                })()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Statistical Significance & Holm-Bonferroni Panel (When Multi-Trial Session Exists) */}
      {experimentRun.multiTrialSession?.comparisons && (
        <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-indigo-950 font-bold text-xs uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-indigo-700" />
              <span>Multi-Trial Statistical Rigor (N = {experimentRun.multiTrialSession.numTrials} Paired Trials)</span>
            </div>
            <span className="text-[11px] font-mono font-medium text-indigo-800">
              Holm-Bonferroni FWER α = 0.05 | Judge: {experimentRun.multiTrialSession.judgeModel}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Call Graph Lift */}
            {(() => {
              const comp = experimentRun.multiTrialSession.comparisons.callGraphLift;
              const isSig = comp.interpretation === 'SIGNIFICANT POSITIVE LIFT';
              return (
                <div className="p-3 bg-white rounded-lg border border-indigo-100 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800">Call-Graph Lift</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isSig ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {isSig ? 'p < 0.05 (Sig)' : 'Not Sig'}
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-indigo-950">
                    Δ = {comp.meanDifference >= 0 ? `+${comp.meanDifference}` : comp.meanDifference} pts
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 space-y-0.5">
                    <div>t = {comp.tStatistic} (p = {comp.pValuetTest})</div>
                    <div>Holm p_adj = <strong className="text-indigo-900">{comp.adjustedPValue}</strong></div>
                    <div>Cohen's d = {comp.effectSizeCohenD} (r = {comp.effectSizeWilcoxonR})</div>
                  </div>
                </div>
              );
            })()}

            {/* Git History Lift */}
            {(() => {
              const comp = experimentRun.multiTrialSession.comparisons.gitHistoryLift;
              const isSig = comp.interpretation === 'SIGNIFICANT POSITIVE LIFT';
              return (
                <div className="p-3 bg-white rounded-lg border border-indigo-100 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800">Git-History Lift</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isSig ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {isSig ? 'p < 0.05 (Sig)' : 'Not Sig'}
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-indigo-950">
                    Δ = {comp.meanDifference >= 0 ? `+${comp.meanDifference}` : comp.meanDifference} pts
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 space-y-0.5">
                    <div>t = {comp.tStatistic} (p = {comp.pValuetTest})</div>
                    <div>Holm p_adj = <strong className="text-indigo-900">{comp.adjustedPValue}</strong></div>
                    <div>Cohen's d = {comp.effectSizeCohenD} (r = {comp.effectSizeWilcoxonR})</div>
                  </div>
                </div>
              );
            })()}

            {/* Length Confound Effect */}
            {(() => {
              const comp = experimentRun.multiTrialSession.comparisons.lengthEffect;
              return (
                <div className="p-3 bg-white rounded-lg border border-indigo-100 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800">Length Effect</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                      Confound Baseline
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-indigo-950">
                    Δ = {comp.meanDifference >= 0 ? `+${comp.meanDifference}` : comp.meanDifference} pts
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 space-y-0.5">
                    <div>t = {comp.tStatistic} (p = {comp.pValuetTest})</div>
                    <div>Holm p_adj = <strong className="text-indigo-900">{comp.adjustedPValue}</strong></div>
                    <div>Cohen's d = {comp.effectSizeCohenD} (r = {comp.effectSizeWilcoxonR})</div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Synthesis Narrative Box */}
      <div className="p-4 sm:p-5 rounded-xl bg-slate-900 text-slate-100 text-xs sm:text-sm space-y-2 border border-slate-800">
        <div className="flex items-center space-x-2 text-indigo-300 font-bold text-xs uppercase tracking-wider">
          <Info className="w-4 h-4" />
          <span>Empirical Finding & Conclusion</span>
        </div>
        <p className="text-slate-200 leading-relaxed font-sans">
          {analysis.summaryNarrative}
        </p>
      </div>
    </div>
  );
};
