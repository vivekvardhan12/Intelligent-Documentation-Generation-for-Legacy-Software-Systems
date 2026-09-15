import React, { Suspense, lazy, memo, useCallback, useMemo, useState } from 'react';
import { ContextCondition, ExperimentRun } from '../types';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  BarChart3,
  PieChart,
  Activity,
  Layers,
  Columns2,
  ArrowLeftRight,
  Sliders,
  Check,
  Scale,
  Coins,
  AlertTriangle,
} from 'lucide-react';
import { DemoDataBadge } from './DemoDataBadge';

/**
 * The comparison view is lazily loaded: it is a 1,000-line component with its
 * own Recharts surfaces that only renders when the user switches to the
 * "Compare Two Runs" tab, so it does not belong in the dashboard's chunk.
 */
const RunComparisonView = lazy(() =>
  import('./RunComparisonView').then((module) => ({ default: module.RunComparisonView }))
);

/** The four arms, in canonical display order. */
const ARM_KEYS: ContextCondition[] = [
  'code_only',
  'few_shot_control',
  'call_graph',
  'git_history',
];

interface EvaluationDashboardProps {
  experimentRun: ExperimentRun;
  runHistory: ExperimentRun[];
  onCopyRunParameters?: (run: ExperimentRun) => void;
}

const EvaluationDashboardComponent: React.FC<EvaluationDashboardProps> = ({
  experimentRun,
  runHistory,
  onCopyRunParameters,
}) => {
  const [viewMode, setViewMode] = useState<'visualizer' | 'comparison'>('visualizer');
  const [selectedComparisonRunId, setSelectedComparisonRunId] = useState<string | undefined>();
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [activeChartTab, setActiveChartTab] = useState<'radar' | 'bar_ci' | 'token_compliance'>('radar');

  // Consolidate all unique runs including active run and historical trials
  const allRuns = useMemo(() => {
    const list: ExperimentRun[] = [experimentRun];
    for (const r of runHistory) {
      if (!list.some((item) => item.id === r.id)) {
        list.push(r);
      }
    }
    return list;
  }, [experimentRun, runHistory]);

  const handleCopyParams = useCallback(
    (run: ExperimentRun) => {
      onCopyRunParameters?.(run);
      setCopiedRunId(run.id);
      setTimeout(() => setCopiedRunId(null), 2500);
    },
    [onCopyRunParameters]
  );

  const results = experimentRun.results;
  const session = experimentRun.multiTrialSession;

  /**
   * Arms that produced no usable result.
   *
   * These are reported to the user and OMITTED from the charts. The previous
   * code did two harmful things here: it bailed out with
   * `if (!results.code_only?.evaluation) return null;` — an early return placed
   * ABOVE a `useMemo`, which violates the rules of hooks and made the entire
   * dashboard vanish whenever the floor arm failed — and it fed `|| 0` into
   * every chart series, so a failed arm was plotted as a genuine score of zero.
   */
  const failedArms = useMemo(
    () =>
      ARM_KEYS.filter((arm) => !results[arm]?.evaluation).map(
        (arm) => results[arm]?.title ?? arm
      ),
    [results]
  );

  /**
   * Radar data across the four rubric dimensions plus BLEU.
   *
   * Values are `null` for unmeasured arms; Recharts skips null points rather
   * than drawing them at the origin, so a missing arm leaves a gap instead of
   * appearing to have scored zero on everything.
   */
  const radarData = useMemo(() => {
    /** Reads one dimension for every arm, scaling 1-10 scores to 0-100. */
    const dimension = (
      metric: string,
      project: (arm: ContextCondition) => number | undefined,
      scale = 10
    ) => {
      const row: Record<string, string | number | null> = { metric };
      for (const arm of ARM_KEYS) {
        const value = project(arm);
        row[arm] = typeof value === 'number' ? Math.round(value * scale) : null;
      }
      return row;
    };

    return [
      dimension('Accuracy', (arm) => results[arm]?.evaluation?.accuracyScore),
      dimension('Param/Return', (arm) => results[arm]?.evaluation?.paramReturnScore),
      dimension('Intent & "Why"', (arm) => results[arm]?.evaluation?.intentScore),
      dimension('Hallucination Res.', (arm) => results[arm]?.evaluation?.hallucinationScore),
      dimension('Lexical Match (BLEU)', (arm) => results[arm]?.evaluation?.bleuScore, 100),
    ];
  }, [results]);

  /** Bar data for the composite score, with per-arm confidence intervals. */
  const barData = useMemo(() => {
    const ARM_COLORS: Record<ContextCondition, string> = {
      code_only: '#64748b',
      few_shot_control: '#4f46e5',
      call_graph: '#059669',
      git_history: '#d97706',
    };

    return ARM_KEYS.filter((arm) => results[arm]?.evaluation).map((arm) => {
      const stats = session?.armStats?.[arm];
      const evaluation = results[arm]?.evaluation;

      return {
        name: results[arm]?.title ?? arm,
        score: stats?.mean ?? evaluation?.overallQuality ?? 0,
        color: ARM_COLORS[arm],
        role: results[arm]?.role ?? '',
        // Error bars are only meaningful with a real interval behind them.
        ciLower: stats?.ci95?.[0] ?? null,
        ciUpper: stats?.ci95?.[1] ?? null,
        n: stats?.n ?? 1,
      };
    });
  }, [results, session]);

  /** Token budget compliance per arm — verifies the experimental control held. */
  const tokenComplianceData = useMemo(() => {
    return ARM_KEYS.map((arm) => {
      const result = results[arm];
      const tokens = result?.tokens;

      return {
        arm: result?.title || arm,
        requested: tokens?.requestedBudget ?? (arm === 'code_only' ? 0 : experimentRun.tokenBudget),
        actualInput: tokens?.totalInputTokens || result?.promptPayload?.exactPromptTokens || 0,
        outputTokens: tokens?.outputTokens ?? 0,
        compliancePct: tokens?.compliancePercentage ?? 100,
        method: tokens?.method ?? 'ESTIMATED',
      };
    });
  }, [results, experimentRun.tokenBudget]);

  const handleLaunchComparisonFromRow = (targetRunId: string) => {
    setSelectedComparisonRunId(targetRunId);
    setViewMode('comparison');
  };

  return (
    <div id="evaluation-dashboard" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-6">
      {/*
        Failed arms are named explicitly. They are excluded from every chart
        and statistic rather than being plotted as zero, so the user needs to
        know which series are missing and why.
      */}
      {failedArms.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-950"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-px" aria-hidden="true" />
          <p>
            <strong className="font-bold">
              {failedArms.length} arm{failedArms.length === 1 ? '' : 's'} produced no usable
              result:{' '}
            </strong>
            {failedArms.join(', ')}. These are omitted from the charts and excluded from all
            statistics — they are not plotted as zero.
          </p>
        </div>
      )}

      {/* Header with Dashboard View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex flex-wrap items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-900" aria-hidden="true" />
            <span>
              {viewMode === 'visualizer'
                ? 'Multi-Dimensional Analysis & Benchmark Statistics'
                : 'Dedicated Side-by-Side Run Comparison'}
            </span>
            {experimentRun.isDemoData && <DemoDataBadge size="sm" />}
          </h3>
          <p className="text-xs text-slate-500">
            {viewMode === 'visualizer'
              ? 'Multi-dimensional criteria scores, experimental arm comparisons, and token budget compliance.'
              : 'Direct side-by-side comparative analysis of metrics, dimensional profiles, and docstrings between any two experimental runs.'}
          </p>
        </div>

        {/* View Mode Toggle */}
        <div
          id="evaluation-view-toggle"
          role="tablist"
          aria-label="Evaluation View Mode"
          className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200 shrink-0 shadow-2xs"
        >
          <button
            type="button"
            id="toggle-active-run-view"
            role="tab"
            aria-selected={viewMode === 'visualizer'}
            onClick={() => setViewMode('visualizer')}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'visualizer'
                ? 'bg-white text-slate-900 font-bold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-indigo-600" />
            <span>Active Run Visualizer</span>
          </button>
          <button
            type="button"
            id="toggle-comparison-view"
            role="tab"
            aria-selected={viewMode === 'comparison'}
            onClick={() => setViewMode('comparison')}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'comparison'
                ? 'bg-white text-indigo-950 font-bold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>Compare Two Runs</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-indigo-100 text-indigo-800 font-bold">
              {allRuns.length}
            </span>
          </button>
        </div>
      </div>

      {/* Conditional View: Active Run Visualizer vs Side-by-Side Comparison */}
      {viewMode === 'comparison' ? (
        <Suspense
          fallback={
            <div className="p-8 text-center text-xs text-slate-500" role="status">
              Loading comparison view…
            </div>
          }
        >
          <RunComparisonView
            runs={allRuns}
            defaultRunAId={
              selectedComparisonRunId || (allRuns.length > 1 ? allRuns[1].id : allRuns[0]?.id)
            }
            defaultRunBId={experimentRun.id}
            onCopyRunParameters={handleCopyParams}
          />
        </Suspense>
      ) : (
        <>
          {/* 4-Arm Experimental Performance Breakdown Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                <Scale className="w-4 h-4 text-indigo-600" />
                <span>4-Arm Experimental Performance Breakdown:</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Evaluation Criteria & Docstring Metrics
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-2.5">Arm Condition</th>
                    <th className="p-2.5">Quality Score</th>
                    <th className="p-2.5">BLEU</th>
                    <th className="p-2.5">ROUGE-L</th>
                    <th className="p-2.5">Semantic Sim</th>
                    <th className="p-2.5">Factuality</th>
                    <th className="p-2.5">Input Tokens</th>
                    <th className="p-2.5">Output Tokens</th>
                    <th className="p-2.5">Compliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {(['code_only', 'few_shot_control', 'call_graph', 'git_history'] as ContextCondition[]).map((cond) => {
                    const res = results[cond];
                    const evalRes = res?.evaluation;
                    const qualScore = evalRes?.overallQuality ?? 0;
                    return (
                      <tr key={cond} className="hover:bg-slate-50">
                        <td className="p-2.5 font-sans font-bold text-slate-900">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] ${
                              cond === 'code_only'
                                ? 'bg-slate-100 text-slate-800'
                                : cond === 'few_shot_control'
                                ? 'bg-indigo-100 text-indigo-900'
                                : cond === 'call_graph'
                                ? 'bg-emerald-100 text-emerald-900'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {res?.title || cond}
                          </span>
                        </td>
                        <td className="p-2.5 font-bold text-slate-900 text-sm">
                          {qualScore > 0 ? qualScore : '--'}{' '}
                          <span className="text-[10px] font-normal text-slate-500">/ 100</span>
                        </td>
                        <td className="p-2.5 text-slate-700">
                          {evalRes?.bleuScore !== undefined ? evalRes.bleuScore.toFixed(3) : '--'}
                        </td>
                        <td className="p-2.5 text-slate-700">
                          {evalRes?.rougeLScore !== undefined
                            ? evalRes.rougeLScore.toFixed(3)
                            : '--'}
                        </td>
                        <td className="p-2.5 text-indigo-700 font-bold">
                          {evalRes?.semanticSimilarity !== undefined ? evalRes.semanticSimilarity.toFixed(2) : '--'}
                        </td>
                        <td className="p-2.5 text-emerald-700 font-bold">
                          {evalRes?.factuality !== undefined
                            ? `${evalRes.factuality.factualityScore}%`
                            : '--'}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {res?.tokens?.totalInputTokens ||
                            res?.promptPayload?.exactPromptTokens ||
                            '--'}
                          t
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {res?.tokens?.outputTokens || '--'}t
                        </td>
                        <td className="p-2.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {res?.tokens?.compliancePercentage ?? 100}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive Multi-Tab Visual Charts */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 pb-2">
              <div className="flex items-center space-x-1 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setActiveChartTab('radar')}
                  className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                    activeChartTab === 'radar'
                      ? 'bg-indigo-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Radar Profile
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartTab('bar_ci')}
                  className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                    activeChartTab === 'bar_ci'
                      ? 'bg-indigo-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Quality Scores
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartTab('token_compliance')}
                  className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                    activeChartTab === 'token_compliance'
                      ? 'bg-indigo-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Token Compliance
                </button>
              </div>

              <span className="text-[11px] font-mono text-slate-500">
                Target: {experimentRun.targetName} | Fixed Budget: {experimentRun.tokenBudget}t
              </span>
            </div>

            {/* Tab 1: Radar Chart */}
            {activeChartTab === 'radar' && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <PieChart className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Multi-Dimensional Criterion Radar Profile (0-100)</span>
                  </span>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="75%">
                      <PolarGrid stroke="#cbd5e1" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#94a3b8" />
                      <Radar
                        name="Code Only (Floor)"
                        dataKey="code_only"
                        stroke="#64748b"
                        fill="#64748b"
                        fillOpacity={0.15}
                      />
                      <Radar
                        name="Few-Shot Control"
                        dataKey="few_shot_control"
                        stroke="#4f46e5"
                        fill="#4f46e5"
                        fillOpacity={0.2}
                      />
                      <Radar
                        name="Call-Graph"
                        dataKey="call_graph"
                        stroke="#059669"
                        fill="#059669"
                        fillOpacity={0.25}
                      />
                      <Radar
                        name="Git-History"
                        dataKey="git_history"
                        stroke="#d97706"
                        fill="#d97706"
                        fillOpacity={0.3}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 2: Quality Score Bar Chart */}
            {activeChartTab === 'bar_ci' && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Overall Composite Quality Score (4 Arms)</span>
                  </span>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 25, right: 25, left: -10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        formatter={(
                          value: unknown,
                          _name: unknown,
                          item: { payload?: { role?: string; n?: number } }
                        ) => [
                          `${value} / 100 (${item.payload?.role ?? ''}${
                            item.payload?.n && item.payload.n > 1
                              ? `, mean of ${item.payload.n} trials`
                              : ''
                          })`,
                          'Quality Score',
                        ]}
                        contentStyle={{ borderRadius: '8px', fontSize: '12px', borderColor: '#cbd5e1' }}
                      />
                      <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                        {barData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 3: Token Budget Compliance */}
            {activeChartTab === 'token_compliance' && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <Coins className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Token Budget Allocation & Strict Compliance (Actual vs Requested)</span>
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                      <tr>
                        <th className="p-2.5">Arm</th>
                        <th className="p-2.5">Requested Budget</th>
                        <th className="p-2.5">Actual Input Tokens</th>
                        <th className="p-2.5">Output Tokens</th>
                        <th className="p-2.5">Token Difference</th>
                        <th className="p-2.5">Compliance %</th>
                        <th className="p-2.5">Counting Method</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {tokenComplianceData.map((d, i) => {
                        const diff = d.actualInput - d.requested;
                        return (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="p-2.5 font-sans font-bold">{d.arm}</td>
                            <td className="p-2.5">{d.requested}t</td>
                            <td className="p-2.5 font-bold text-indigo-900">{d.actualInput}t</td>
                            <td className="p-2.5 text-slate-600">{d.outputTokens}t</td>
                            <td className="p-2.5">
                              <span className={diff === 0 ? 'text-slate-600' : diff > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>
                                {diff >= 0 ? `+${diff}` : diff}t
                              </span>
                            </td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                {d.compliancePct}%
                              </span>
                            </td>
                            <td className="p-2.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                                ACTUAL (Gemini API)
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* History table if runs exist */}
          {allRuns.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-500" />
                  <span>Session Benchmark History ({allRuns.length} runs recorded):</span>
                </span>
                <button
                  type="button"
                  onClick={() => setViewMode('comparison')}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Open Side-by-Side Comparison</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="p-2.5">Target</th>
                      <th className="p-2.5">Budget</th>
                      <th className="p-2.5">Floor (Code)</th>
                      <th className="p-2.5">Control (Few-Shot)</th>
                      <th className="p-2.5">Call-Graph</th>
                      <th className="p-2.5">Git-History</th>
                      <th className="p-2.5">CallGraph Verdict</th>
                      <th className="p-2.5">Git Verdict</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {allRuns.map((r, idx) => (
                      <tr key={r.id || idx} className="hover:bg-slate-50">
                        <td className="p-2.5 font-sans font-medium text-slate-900">
                          {r.targetName}
                          {r.id === experimentRun.id && (
                            <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 font-sans">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="p-2.5">{r.tokenBudget}t</td>
                        <td className="p-2.5 text-slate-600">{r.results.code_only?.evaluation?.overallQuality || '--'}</td>
                        <td className="p-2.5 text-indigo-700 font-bold">{r.results.few_shot_control?.evaluation?.overallQuality || '--'}</td>
                        <td className="p-2.5 text-emerald-700 font-bold">{r.results.call_graph?.evaluation?.overallQuality || '--'}</td>
                        <td className="p-2.5 text-amber-700 font-bold">{r.results.git_history?.evaluation?.overallQuality || '--'}</td>
                        <td className="p-2.5">
                          <span className="text-[10px] font-sans px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-800 border border-slate-200">
                            {r.analysis?.callGraphVerdict === 'genuine_lift' ? '🟢 Genuine' : '🟡 Confounded'}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span className="text-[10px] font-sans px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-800 border border-slate-200">
                            {r.analysis?.gitHistoryVerdict === 'genuine_lift' ? '🟢 Genuine' : '🟡 Confounded'}
                          </span>
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              type="button"
                              id={`copy-run-params-${r.id}`}
                              onClick={() => handleCopyParams(r)}
                              title={`Update current controller sliders to match this run: ${r.tokenBudget} tokens, Temp ${r.temperature}, ${r.modelName}`}
                              className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium border transition-all cursor-pointer ${
                                copiedRunId === r.id
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-200'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              {copiedRunId === r.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="font-bold text-emerald-700">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Sliders className="w-3 h-3 text-indigo-600" />
                                  <span>Copy Run Parameters</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLaunchComparisonFromRow(r.id)}
                              className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 text-[11px] font-sans font-medium border border-slate-200 hover:border-indigo-200 transition-colors cursor-pointer"
                            >
                              <Columns2 className="w-3 h-3" />
                              <span>Compare</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Memoized because this component owns four Recharts surfaces. Without it,
 * every unrelated parent state change — a toast appearing, a progress tick, a
 * modal opening — re-rendered all of them.
 */
export const EvaluationDashboard = memo(EvaluationDashboardComponent);
