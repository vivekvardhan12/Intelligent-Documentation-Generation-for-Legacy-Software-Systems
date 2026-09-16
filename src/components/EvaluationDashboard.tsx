import React, { useState, useMemo } from 'react';
import { ExperimentRun } from '../types';
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
import { BarChart3, PieChart, Activity, Zap, Layers, Columns2, ArrowLeftRight, Sliders, Check } from 'lucide-react';
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

  // Bar Chart comparison of Overall Quality
  const barData = [
    {
      name: 'Code Only (Floor)',
      score: results.code_only?.evaluation?.overallQuality || 0,
      color: '#64748b', // slate-500
      role: 'Baseline Floor',
    },
    {
      name: 'Few-Shot Control',
      score: results.few_shot_control?.evaluation?.overallQuality || 0,
      color: '#4f46e5', // indigo-600
      role: 'Length Control',
    },
    {
      name: 'Call-Graph',
      score: results.call_graph?.evaluation?.overallQuality || 0,
      color: '#059669', // emerald-600
      role: 'Structural Context',
    },
    {
      name: 'Git-History',
      score: results.git_history?.evaluation?.overallQuality || 0,
      color: '#d97706', // amber-600
      role: 'Evolutionary Context',
    },
  ];

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
                ? 'Multi-Dimensional Analysis & Visual Metrics'
                : 'Dedicated Side-by-Side Run Comparison'}
            </span>
          </h3>
          <p className="text-xs text-slate-500">
            {viewMode === 'visualizer'
              ? 'Radar profile and composite quality distributions highlighting qualitative trade-offs under identical token expenditure.'
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Radar Comparison */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <PieChart className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Criterion Radar Profile (0-100)</span>
                </span>
              </div>

              <div className="h-64 w-full text-xs">
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

            {/* Chart 2: Overall Score Bar Chart */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Composite Quality Score vs Fixed Token Budget</span>
                </span>
              </div>

              <div className="h-64 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 20, right: 20, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fill: '#334155', fontSize: 11, fontWeight: 500 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${val} / 100`, 'Quality Score']}
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

