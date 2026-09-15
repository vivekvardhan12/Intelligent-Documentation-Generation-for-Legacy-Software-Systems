import React, { useState, useMemo } from 'react';
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
  LineChart,
  Line,
} from 'recharts';
import {
  BarChart3,
  PieChart,
  Activity,
  Zap,
  Layers,
  Columns2,
  ArrowLeftRight,
  Sliders,
  Check,
  Scale,
  Coins,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';
import { RunComparisonView } from './RunComparisonView';

interface EvaluationDashboardProps {
  experimentRun: ExperimentRun;
  runHistory: ExperimentRun[];
  onCopyRunParameters?: (run: ExperimentRun) => void;
}

export const EvaluationDashboard: React.FC<EvaluationDashboardProps> = ({
  experimentRun,
  runHistory,
  onCopyRunParameters,
}) => {
  const [viewMode, setViewMode] = useState<'visualizer' | 'comparison' | 'raw_trials'>('visualizer');
  const [selectedComparisonRunId, setSelectedComparisonRunId] = useState<string | undefined>();
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [activeChartTab, setActiveChartTab] = useState<'radar' | 'bar_ci' | 'paired_trials' | 'token_compliance'>('radar');

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

  const handleCopyParams = (run: ExperimentRun) => {
    if (onCopyRunParameters) {
      onCopyRunParameters(run);
    }
    setCopiedRunId(run.id);
    setTimeout(() => {
      setCopiedRunId(null);
    }, 2500);
  };

  const results = experimentRun.results;
  if (!results.code_only?.evaluation) return null;

  // Radar chart data for the 5 criteria
  const radarData = [
    {
      metric: 'Accuracy',
      code_only: (results.code_only?.evaluation?.accuracyScore || 0) * 10,
      few_shot_control: (results.few_shot_control?.evaluation?.accuracyScore || 0) * 10,
      call_graph: (results.call_graph?.evaluation?.accuracyScore || 0) * 10,
      git_history: (results.git_history?.evaluation?.accuracyScore || 0) * 10,
    },
    {
      metric: 'Param/Return',
      code_only: (results.code_only?.evaluation?.paramReturnScore || 0) * 10,
      few_shot_control: (results.few_shot_control?.evaluation?.paramReturnScore || 0) * 10,
      call_graph: (results.call_graph?.evaluation?.paramReturnScore || 0) * 10,
      git_history: (results.git_history?.evaluation?.paramReturnScore || 0) * 10,
    },
    {
      metric: 'Intent & "Why"',
      code_only: (results.code_only?.evaluation?.intentScore || 0) * 10,
      few_shot_control: (results.few_shot_control?.evaluation?.intentScore || 0) * 10,
      call_graph: (results.call_graph?.evaluation?.intentScore || 0) * 10,
      git_history: (results.git_history?.evaluation?.intentScore || 0) * 10,
    },
    {
      metric: 'Hallucination Res.',
      code_only: (results.code_only?.evaluation?.hallucinationScore || 0) * 10,
      few_shot_control: (results.few_shot_control?.evaluation?.hallucinationScore || 0) * 10,
      call_graph: (results.call_graph?.evaluation?.hallucinationScore || 0) * 10,
      git_history: (results.git_history?.evaluation?.hallucinationScore || 0) * 10,
    },
    {
      metric: 'Lexical Match (BLEU)',
      code_only: Math.round((results.code_only?.evaluation?.bleuScore || 0) * 100),
      few_shot_control: Math.round((results.few_shot_control?.evaluation?.bleuScore || 0) * 100),
      call_graph: Math.round((results.call_graph?.evaluation?.bleuScore || 0) * 100),
      git_history: Math.round((results.git_history?.evaluation?.bleuScore || 0) * 100),
    },
  ];

  const session = experimentRun.multiTrialSession;

  // Bar Chart comparison of Overall Quality
  const barData = [
    {
      name: 'Code Only',
      score: session?.armStats?.code_only?.mean ?? results.code_only?.evaluation?.overallQuality ?? 0,
      ciLower: session?.armStats?.code_only?.ci95.lower,
      ciUpper: session?.armStats?.code_only?.ci95.upper,
      color: '#64748b',
      role: 'Baseline Floor',
    },
    {
      name: 'Few-Shot Control',
      score: session?.armStats?.few_shot_control?.mean ?? results.few_shot_control?.evaluation?.overallQuality ?? 0,
      ciLower: session?.armStats?.few_shot_control?.ci95.lower,
      ciUpper: session?.armStats?.few_shot_control?.ci95.upper,
      color: '#4f46e5',
      role: 'Length Control',
    },
    {
      name: 'Call-Graph',
      score: session?.armStats?.call_graph?.mean ?? results.call_graph?.evaluation?.overallQuality ?? 0,
      ciLower: session?.armStats?.call_graph?.ci95.lower,
      ciUpper: session?.armStats?.call_graph?.ci95.upper,
      color: '#059669',
      role: 'Structural Context',
    },
    {
      name: 'Git-History',
      score: session?.armStats?.git_history?.mean ?? results.git_history?.evaluation?.overallQuality ?? 0,
      ciLower: session?.armStats?.git_history?.ci95.lower,
      ciUpper: session?.armStats?.git_history?.ci95.upper,
      color: '#d97706',
      role: 'Evolutionary Context',
    },
  ];

  // Paired trial differences data across T1..Tn
  const pairedTrialLineData = useMemo(() => {
    if (!session?.comparisons) return [];
    const cgPairs = session.comparisons.callGraphLift.pairs;
    const gitPairs = session.comparisons.gitHistoryLift.pairs;
    const lenPairs = session.comparisons.lengthEffect.pairs;

    return cgPairs.map((p, idx) => ({
      trial: `T${p.trialIndex}`,
      callGraphLift: p.difference,
      gitHistoryLift: gitPairs[idx]?.difference ?? 0,
      lengthEffect: lenPairs[idx]?.difference ?? 0,
    }));
  }, [session]);

  // Token budget compliance data
  const tokenComplianceData = useMemo(() => {
    const conditions: ContextCondition[] = ['code_only', 'few_shot_control', 'call_graph', 'git_history'];
    return conditions.map((c) => {
      const res = results[c];
      const tok = res?.tokens;
      return {
        arm: res?.title || c,
        requested: tok?.requestedBudget || (c === 'code_only' ? 0 : experimentRun.tokenBudget),
        actualInput: tok?.totalInputTokens || res?.promptPayload?.exactPromptTokens || 0,
        outputTokens: tok?.outputTokens || 75,
        compliancePct: tok?.compliancePercentage ?? 100,
      };
    });
  }, [results, experimentRun.tokenBudget]);

  const handleLaunchComparisonFromRow = (targetRunId: string) => {
    setSelectedComparisonRunId(targetRunId);
    setViewMode('comparison');
  };

  return (
    <div id="evaluation-dashboard" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-6">
      {/* Header with Dashboard View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Activity className="w-4 h-4 text-indigo-900" />
            <span>
              {viewMode === 'visualizer'
                ? 'Multi-Dimensional Analysis & Multi-Trial Statistics'
                : viewMode === 'raw_trials'
                ? 'Individual Paired Trial Observations'
                : 'Dedicated Side-by-Side Run Comparison'}
            </span>
          </h3>
          <p className="text-xs text-slate-500">
            {viewMode === 'visualizer'
              ? 'Multi-trial paired statistics (t-test, Wilcoxon, Holm-Bonferroni) and token budget compliance under identical prompt limits.'
              : viewMode === 'raw_trials'
              ? 'Raw observation matrix for every paired trial across all four arms.'
              : 'Direct side-by-side comparative analysis of metrics, dimensional profiles, and docstrings between any two experimental trials.'}
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
          {session?.rawTrials && session.rawTrials.length > 0 && (
            <button
              type="button"
              id="toggle-raw-trials-view"
              role="tab"
              aria-selected={viewMode === 'raw_trials'}
              onClick={() => setViewMode('raw_trials')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'raw_trials'
                  ? 'bg-white text-indigo-950 font-bold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
              <span>Raw Trials ({session.numTrials})</span>
            </button>
          )}
        </div>
      </div>

      {/* Conditional View: Active Run Visualizer vs Side-by-Side Comparison vs Raw Trials */}
      {viewMode === 'comparison' ? (
        <RunComparisonView
          runs={allRuns}
          defaultRunAId={selectedComparisonRunId || (allRuns.length > 1 ? allRuns[1].id : allRuns[0]?.id)}
          defaultRunBId={experimentRun.id}
          onCopyRunParameters={handleCopyParams}
        />
      ) : viewMode === 'raw_trials' && session?.rawTrials ? (
        /* Raw Trials Inspector */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
              <span>Full Paired Trial Raw Observations ({session.rawTrials.length} entries)</span>
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-2xs max-h-96">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold sticky top-0">
                <tr>
                  <th className="p-2.5">Trial #</th>
                  <th className="p-2.5">Pair ID</th>
                  <th className="p-2.5">Arm Condition</th>
                  <th className="p-2.5">Blind Candidate ID</th>
                  <th className="p-2.5">Input Tokens</th>
                  <th className="p-2.5">Quality Score</th>
                  <th className="p-2.5">BLEU</th>
                  <th className="p-2.5">Semantic</th>
                  <th className="p-2.5">Factuality</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {session.rawTrials.map((t, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold text-slate-800">T{t.trialIndex}</td>
                    <td className="p-2.5 text-slate-500">{t.pairId}</td>
                    <td className="p-2.5 font-sans font-bold">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          t.arm === 'code_only'
                            ? 'bg-slate-100 text-slate-800'
                            : t.arm === 'few_shot_control'
                            ? 'bg-indigo-100 text-indigo-900'
                            : t.arm === 'call_graph'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {t.arm}
                      </span>
                    </td>
                    <td className="p-2.5 text-indigo-700 font-bold">{t.anonymizedCandidateId || 'Blind'}</td>
                    <td className="p-2.5">{t.tokens.totalInputTokens}t</td>
                    <td className="p-2.5 font-bold text-slate-900">{t.evaluation?.overallQuality || '--'}</td>
                    <td className="p-2.5">{(t.evaluation?.bleuScore || 0).toFixed(2)}</td>
                    <td className="p-2.5">{(t.evaluation?.semanticSimilarity || 0).toFixed(2)}</td>
                    <td className="p-2.5 font-bold text-emerald-700">
                      {t.evaluation?.factuality ? `${t.evaluation.factuality.factualityScore}%` : '--'}
                    </td>
                    <td className="p-2.5">
                      <span className="text-emerald-700 font-bold">✓ {t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {/* Multi-Trial Descriptive Statistics Table */}
          {session?.armStats && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <Scale className="w-4 h-4 text-indigo-600" />
                  <span>Multi-Trial Descriptive Statistics (N = {session.numTrials} Paired Trials):</span>
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  95% Confidence Intervals | Judge: {session.judgeModel}
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="p-2.5">Arm Condition</th>
                      <th className="p-2.5">Mean Quality</th>
                      <th className="p-2.5">Median</th>
                      <th className="p-2.5">Std Dev</th>
                      <th className="p-2.5">95% CI</th>
                      <th className="p-2.5">BLEU</th>
                      <th className="p-2.5">ROUGE-L</th>
                      <th className="p-2.5">Semantic Sim</th>
                      <th className="p-2.5">Factuality</th>
                      <th className="p-2.5">Input Tokens</th>
                      <th className="p-2.5">Compliance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {(['code_only', 'few_shot_control', 'call_graph', 'git_history'] as ContextCondition[]).map((cond) => {
                      const stats = session.armStats[cond];
                      if (!stats) return null;
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
                              {stats.title}
                            </span>
                          </td>
                          <td className="p-2.5 font-bold text-slate-900 text-sm">
                            {stats.mean} <span className="text-[10px] font-normal text-slate-500">/ 100</span>
                          </td>
                          <td className="p-2.5 text-slate-700">{stats.median}</td>
                          <td className="p-2.5 text-slate-600">±{stats.sd}</td>
                          <td className="p-2.5 font-bold text-indigo-900">
                            [{stats.ci95.lower}, {stats.ci95.upper}]
                          </td>
                          <td className="p-2.5 text-slate-700">{stats.meanBLEU}</td>
                          <td className="p-2.5 text-slate-700">{stats.meanROUGEL}</td>
                          <td className="p-2.5 text-indigo-700 font-bold">{stats.meanSemantic}</td>
                          <td className="p-2.5 text-emerald-700 font-bold">{stats.meanFactuality}%</td>
                          <td className="p-2.5 text-slate-600">{stats.meanInputTokens}t</td>
                          <td className="p-2.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {stats.meanCompliancePct}%
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

          {/* Paired Hypothesis Differences Table */}
          {session?.comparisons && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Paired Hypothesis Comparisons & Holm-Bonferroni Corrections (FWER):</span>
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  Step-Down Correction Threshold α = 0.05
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="p-2.5">Hypothesis Comparison</th>
                      <th className="p-2.5">Mean Diff</th>
                      <th className="p-2.5">95% CI</th>
                      <th className="p-2.5">Paired t-test</th>
                      <th className="p-2.5">Wilcoxon W</th>
                      <th className="p-2.5">Holm-Adj p</th>
                      <th className="p-2.5">Cohen's d</th>
                      <th className="p-2.5">Interpretation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {[session.comparisons.callGraphLift, session.comparisons.gitHistoryLift, session.comparisons.lengthEffect].map(
                      (comp) => {
                        const isSig = comp.interpretation === 'SIGNIFICANT POSITIVE LIFT';
                        return (
                          <tr key={comp.id} className="hover:bg-slate-50">
                            <td className="p-2.5 font-sans font-bold text-slate-900">{comp.label}</td>
                            <td className="p-2.5 font-bold text-sm">
                              <span className={comp.meanDifference >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                                {comp.meanDifference >= 0 ? `+${comp.meanDifference}` : comp.meanDifference} pts
                              </span>
                            </td>
                            <td className="p-2.5 text-indigo-900 font-bold">
                              [{comp.ci95.lower}, {comp.ci95.upper}]
                            </td>
                            <td className="p-2.5 text-slate-700">
                              p = {comp.pValuetTest} (t = {comp.tStatistic})
                            </td>
                            <td className="p-2.5 text-slate-700">
                              p = {comp.pValueWilcoxon} (W = {comp.wStatistic})
                            </td>
                            <td className="p-2.5 font-black text-indigo-900 text-sm">
                              p = {comp.adjustedPValue}
                            </td>
                            <td className="p-2.5 text-slate-800">
                              d = {comp.effectSizeCohenD} (r = {comp.effectSizeWilcoxonR})
                            </td>
                            <td className="p-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold border ${
                                  isSig
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : comp.interpretation === 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT'
                                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                                    : 'bg-slate-100 text-slate-800 border-slate-300'
                                }`}
                              >
                                {comp.interpretation}
                              </span>
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                  Quality Score (95% CI)
                </button>
                {pairedTrialLineData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveChartTab('paired_trials')}
                    className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                      activeChartTab === 'paired_trials'
                        ? 'bg-indigo-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Paired Trial Lift (T1..Tn)
                  </button>
                )}
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

            {/* Tab 2: Quality Score Bar Chart with 95% CI */}
            {activeChartTab === 'bar_ci' && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Mean Composite Quality Score with 95% Confidence Intervals</span>
                  </span>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 25, right: 25, left: -10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        formatter={(val: any, _name: any, item: any) => [
                          `${val} / 100 (95% CI [${item.payload.ciLower ?? '--'}, ${item.payload.ciUpper ?? '--'}])`,
                          'Mean Quality',
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

            {/* Tab 3: Paired Trial Diffs Plot */}
            {activeChartTab === 'paired_trials' && pairedTrialLineData.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Paired Trial Delta Lift Trajectory across Trials (T1..Tn)</span>
                  </span>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pairedTrialLineData} margin={{ top: 20, right: 25, left: -10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="trial" tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        formatter={(val: any) => [`${val >= 0 ? '+' : ''}${val} pts`, 'Score Delta']}
                        contentStyle={{ borderRadius: '8px', fontSize: '12px', borderColor: '#cbd5e1' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="callGraphLift"
                        name="Call-Graph Lift (vs Control)"
                        stroke="#059669"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="gitHistoryLift"
                        name="Git-History Lift (vs Control)"
                        stroke="#d97706"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="lengthEffect"
                        name="Length Effect (Control vs Floor)"
                        stroke="#4f46e5"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 3 }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 4: Token Budget Compliance */}
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
                  <span>Session Trial History ({allRuns.length} runs recorded):</span>
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

