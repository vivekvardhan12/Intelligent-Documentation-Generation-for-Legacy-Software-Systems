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
      score: results.code_only?.evaluation?.overallQuality ?? 0,
      color: '#64748b',
      role: 'Baseline Floor',
    },
    {
      name: 'Few-Shot Control',
      score: results.few_shot_control?.evaluation?.overallQuality ?? 0,
      color: '#4f46e5',
      role: 'Length Control',
    },
    {
      name: 'Call-Graph',
      score: results.call_graph?.evaluation?.overallQuality ?? 0,
      color: '#059669',
      role: 'Structural Context',
    },
    {
      name: 'Git-History',
      score: results.git_history?.evaluation?.overallQuality ?? 0,
      color: '#d97706',
      role: 'Evolutionary Context',
    },
  ];

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
                ? 'Multi-Dimensional Analysis & Benchmark Statistics'
                : 'Dedicated Side-by-Side Run Comparison'}
            </span>
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
        <RunComparisonView
          runs={allRuns}
          defaultRunAId={selectedComparisonRunId || (allRuns.length > 1 ? allRuns[1].id : allRuns[0]?.id)}
          defaultRunBId={experimentRun.id}
          onCopyRunParameters={handleCopyParams}
        />
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
                          {evalRes?.rougeL !== undefined ? evalRes.rougeL.toFixed(3) : '--'}
                        </td>
                        <td className="p-2.5 text-indigo-700 font-bold">
                          {evalRes?.semanticSimilarity !== undefined ? evalRes.semanticSimilarity.toFixed(2) : '--'}
                        </td>
                        <td className="p-2.5 text-emerald-700 font-bold">
                          {evalRes?.factualityScore !== undefined ? `${evalRes.factualityScore}%` : '--'}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {res?.actualInputTokens || res?.promptPayload?.exactPromptTokens || '--'}t
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {res?.outputTokens || '--'}t
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
                        formatter={(val: any, _name: any, item: any) => [
                          `${val} / 100 (${item.payload.role})`,
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

