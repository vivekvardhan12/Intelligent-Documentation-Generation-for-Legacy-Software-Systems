import React, { useState, useMemo } from 'react';
import { ExperimentRun, ContextCondition } from '../types';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import {
  ArrowLeftRight,
  Scale,
  GitFork,
  History,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Sparkles,
  Zap,
  Sliders,
  Check,
} from 'lucide-react';
import {
  calculatePctChange,
  DirectionalTrendArrow,
  ScoreTrendBadge,
  ScoreChange,
} from './HypothesisVerdictCard';

interface RunComparisonViewProps {
  runs: ExperimentRun[];
  defaultRunAId?: string;
  defaultRunBId?: string;
  onCopyRunParameters?: (run: ExperimentRun) => void;
}

export const RunComparisonView: React.FC<RunComparisonViewProps> = ({
  runs,
  defaultRunAId,
  defaultRunBId,
  onCopyRunParameters,
}) => {
  // Ensure we have at least 2 distinct runs to compare
  const availableRuns = useMemo(() => {
    // Filter out duplicates by ID
    const seen = new Set<string>();
    const unique: ExperimentRun[] = [];
    for (const r of runs) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        unique.push(r);
      }
    }
    return unique;
  }, [runs]);

  // Initial selection: Run A as baseline (older/default), Run B as comparison (newer/active)
  const [selectedRunAId, setSelectedRunAId] = useState<string>(() => {
    if (defaultRunAId && availableRuns.some((r) => r.id === defaultRunAId)) {
      return defaultRunAId;
    }
    // Pick the second run as reference baseline if available, else first
    return availableRuns.length > 1 ? availableRuns[1].id : availableRuns[0]?.id || '';
  });

  const [selectedRunBId, setSelectedRunBId] = useState<string>(() => {
    if (defaultRunBId && availableRuns.some((r) => r.id === defaultRunBId)) {
      return defaultRunBId;
    }
    return availableRuns[0]?.id || '';
  });

  // Selected arm for side-by-side docstring inspection
  const [inspectCondition, setInspectCondition] = useState<ContextCondition>('call_graph');
  const [isDocstringsExpanded, setIsDocstringsExpanded] = useState<boolean>(true);

  // Radar condition mode: compare mean of all arms or a specific condition
  const [radarCondition, setRadarCondition] = useState<'mean' | ContextCondition>('mean');
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const handleCopyParams = (run: ExperimentRun) => {
    if (onCopyRunParameters) {
      onCopyRunParameters(run);
    }
    setCopiedRunId(run.id);
    setTimeout(() => {
      setCopiedRunId(null);
    }, 2500);
  };

  // Lookup selected runs
  const runA = useMemo(() => {
    return availableRuns.find((r) => r.id === selectedRunAId) || availableRuns[0];
  }, [availableRuns, selectedRunAId]);

  const runB = useMemo(() => {
    return (
      availableRuns.find((r) => r.id === selectedRunBId) ||
      availableRuns[1] ||
      availableRuns[0]
    );
  }, [availableRuns, selectedRunBId]);

  // Handler to swap Run A and Run B
  const handleSwapRuns = () => {
    const temp = selectedRunAId;
    setSelectedRunAId(selectedRunBId);
    setSelectedRunBId(temp);
  };

  // If insufficient runs
  if (availableRuns.length < 2) {
    return (
      <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <Layers className="w-10 h-10 text-slate-400 mx-auto" />
        <h4 className="text-base font-semibold text-slate-800">
          Need at least two trials to compare
        </h4>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Execute an additional benchmark run with a different token budget or target to enable side-by-side comparative analysis.
        </p>
      </div>
    );
  }

  // Token budget delta
  const budgetDelta = runB.tokenBudget - runA.tokenBudget;
  const budgetPctChange = calculatePctChange(runB.tokenBudget, runA.tokenBudget);

  // Score extracts
  const scoresA = {
    floor: runA.results.code_only?.evaluation?.overallQuality || 0,
    control: runA.results.few_shot_control?.evaluation?.overallQuality || 0,
    callGraph: runA.results.call_graph?.evaluation?.overallQuality || 0,
    gitHistory: runA.results.git_history?.evaluation?.overallQuality || 0,
  };

  const scoresB = {
    floor: runB.results.code_only?.evaluation?.overallQuality || 0,
    control: runB.results.few_shot_control?.evaluation?.overallQuality || 0,
    callGraph: runB.results.call_graph?.evaluation?.overallQuality || 0,
    gitHistory: runB.results.git_history?.evaluation?.overallQuality || 0,
  };

  // Mean score across 4 arms
  const meanScoreA = Math.round((scoresA.floor + scoresA.control + scoresA.callGraph + scoresA.gitHistory) / 4);
  const meanScoreB = Math.round((scoresB.floor + scoresB.control + scoresB.callGraph + scoresB.gitHistory) / 4);
  const meanScoreChange = calculatePctChange(meanScoreB, meanScoreA);

  // Lift analysis extracts
  const analysisA = runA.analysis;
  const analysisB = runB.analysis;

  const lengthEffectA = analysisA?.lengthEffectDelta ?? (scoresA.control - scoresA.floor);
  const lengthEffectB = analysisB?.lengthEffectDelta ?? (scoresB.control - scoresB.floor);
  const lengthEffectChange = calculatePctChange(lengthEffectB, lengthEffectA);

  const callGraphLiftA = analysisA?.callGraphContentLift ?? (scoresA.callGraph - scoresA.control);
  const callGraphLiftB = analysisB?.callGraphContentLift ?? (scoresB.callGraph - scoresB.control);
  const callGraphLiftChange = calculatePctChange(callGraphLiftB, callGraphLiftA);

  const gitHistoryLiftA = analysisA?.gitHistoryContentLift ?? (scoresA.gitHistory - scoresA.control);
  const gitHistoryLiftB = analysisB?.gitHistoryContentLift ?? (scoresB.gitHistory - scoresB.control);
  const gitHistoryLiftChange = calculatePctChange(gitHistoryLiftB, gitHistoryLiftA);

  // Grouped Bar Chart Data
  const barChartData = [
    {
      condition: 'Code Only (Floor)',
      role: 'Floor',
      runA: scoresA.floor,
      runB: scoresB.floor,
      delta: scoresB.floor - scoresA.floor,
    },
    {
      condition: 'Few-Shot (Control)',
      role: 'Control',
      runA: scoresA.control,
      runB: scoresB.control,
      delta: scoresB.control - scoresA.control,
    },
    {
      condition: 'Call-Graph',
      role: 'Treatment',
      runA: scoresA.callGraph,
      runB: scoresB.callGraph,
      delta: scoresB.callGraph - scoresA.callGraph,
    },
    {
      condition: 'Git-History',
      role: 'Treatment',
      runA: scoresA.gitHistory,
      runB: scoresB.gitHistory,
      delta: scoresB.gitHistory - scoresA.gitHistory,
    },
  ];

  // Radar Chart Data (5 dimensions)
  const getRadarValues = (run: ExperimentRun) => {
    if (radarCondition === 'mean') {
      const arms: ContextCondition[] = ['code_only', 'few_shot_control', 'call_graph', 'git_history'];
      const avg = (fn: (e: any) => number) => {
        const sum = arms.reduce((acc, arm) => acc + fn(run.results[arm]?.evaluation || {}), 0);
        return Math.round((sum / arms.length) * 10);
      };
      const avgBleu = () => {
        const sum = arms.reduce((acc, arm) => acc + ((run.results[arm]?.evaluation?.bleuScore || 0) * 100), 0);
        return Math.round(sum / arms.length);
      };
      return {
        accuracy: avg((e) => e.accuracyScore || 0),
        paramReturn: avg((e) => e.paramReturnScore || 0),
        intent: avg((e) => e.intentScore || 0),
        hallucination: avg((e) => e.hallucinationScore || 0),
        bleu: avgBleu(),
      };
    } else {
      const e = run.results[radarCondition]?.evaluation || {};
      return {
        accuracy: Math.round((e.accuracyScore || 0) * 10),
        paramReturn: Math.round((e.paramReturnScore || 0) * 10),
        intent: Math.round((e.intentScore || 0) * 10),
        hallucination: Math.round((e.hallucinationScore || 0) * 10),
        bleu: Math.round((e.bleuScore || 0) * 100),
      };
    }
  };

  const radarA = getRadarValues(runA);
  const radarB = getRadarValues(runB);

  const radarChartData = [
    { metric: 'Accuracy', runA: radarA.accuracy, runB: radarB.accuracy },
    { metric: 'Param/Return', runA: radarA.paramReturn, runB: radarB.paramReturn },
    { metric: 'Intent & "Why"', runA: radarA.intent, runB: radarB.intent },
    { metric: 'Hallucination Res.', runA: radarA.hallucination, runB: radarB.hallucination },
    { metric: 'Lexical Match (BLEU)', runA: radarA.bleu, runB: radarB.bleu },
  ];

  // Arms list for the detailed comparison table
  const armRows: {
    key: ContextCondition;
    name: string;
    role: string;
    icon: React.ReactNode;
    colorBadge: string;
  }[] = [
    {
      key: 'code_only',
      name: 'Code Only',
      role: 'Floor',
      icon: <Cpu className="w-3.5 h-3.5 text-slate-600" />,
      colorBadge: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    {
      key: 'few_shot_control',
      name: 'Few-Shot Control',
      role: 'Length Control',
      icon: <Scale className="w-3.5 h-3.5 text-indigo-600" />,
      colorBadge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    },
    {
      key: 'call_graph',
      name: 'Call-Graph Context',
      role: 'Structural Treatment',
      icon: <GitFork className="w-3.5 h-3.5 text-emerald-600" />,
      colorBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    {
      key: 'git_history',
      name: 'Git-History Context',
      role: 'Evolutionary Treatment',
      icon: <History className="w-3.5 h-3.5 text-amber-600" />,
      colorBadge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
  ];

  // Helper to format date / timestamp
  const formatRunLabel = (r: ExperimentRun, idx: number) => {
    const isCurrent = r.id.startsWith('run-') && !r.id.includes('baseline');
    return `Trial #${r.trialIndex || idx + 1}: ${r.targetName} (${r.tokenBudget}t) - ${r.modelName}${isCurrent ? ' [Active]' : ''}`;
  };

  return (
    <div id="side-by-side-run-comparison" className="space-y-6">
      {/* 1. Selector Bar */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-slate-900 flex items-center space-x-1.5 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Select Two Runs to Compare</span>
            </span>
            <p className="text-xs text-slate-500">
              Select any reference trial (A) and comparison trial (B) to evaluate performance drift across token budgets or targets.
            </p>
          </div>

          {/* Quick preset buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              id="swap-runs-button"
              onClick={handleSwapRuns}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all shadow-2xs cursor-pointer"
              title="Swap Baseline (A) and Comparison (B)"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600" />
              <span>Swap A ⇄ B</span>
            </button>
          </div>
        </div>

        {/* Dual Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Run A Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="compare-run-a-select"
              className="text-xs font-semibold text-slate-700 flex items-center justify-between"
            >
              <span className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-500 inline-block"></span>
                <span>Run A (Baseline Reference)</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">{runA.tokenBudget} tokens</span>
            </label>
            <select
              id="compare-run-a-select"
              value={selectedRunAId}
              onChange={(e) => setSelectedRunAId(e.target.value)}
              className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 shadow-2xs"
            >
              {availableRuns.map((r, idx) => (
                <option key={`run-a-${r.id}`} value={r.id}>
                  {formatRunLabel(r, idx)}
                </option>
              ))}
            </select>
          </div>

          {/* Run B Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="compare-run-b-select"
              className="text-xs font-semibold text-indigo-900 flex items-center justify-between"
            >
              <span className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block"></span>
                <span>Run B (Comparison Candidate)</span>
              </span>
              <div className="flex items-center space-x-1">
                <span className="text-[11px] font-mono text-indigo-700 font-bold">{runB.tokenBudget} tokens</span>
                {budgetPctChange && (
                  <span
                    className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                      budgetDelta > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : budgetDelta < 0
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    <DirectionalTrendArrow change={budgetPctChange} size="xs" />
                    <span>{budgetPctChange.formatted}</span>
                  </span>
                )}
              </div>
            </label>
            <select
              id="compare-run-b-select"
              value={selectedRunBId}
              onChange={(e) => setSelectedRunBId(e.target.value)}
              className="w-full text-xs font-mono bg-white border border-indigo-300 rounded-lg px-3 py-2 text-indigo-950 font-medium focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 shadow-2xs"
            >
              {availableRuns.map((r, idx) => (
                <option key={`run-b-${r.id}`} value={r.id}>
                  {formatRunLabel(r, idx)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. Side-by-Side Trial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card A */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
          <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-100 text-slate-700 uppercase">
                  Run A (Reference)
                </span>
                <span className="text-xs font-semibold text-slate-900">{runA.targetName}</span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                Budget: <span className="font-bold text-slate-800">{runA.tokenBudget}t</span> | Model: {runA.modelName} | Temp: {runA.temperature}
              </p>
              <div className="pt-1.5">
                <button
                  type="button"
                  id={`copy-params-card-a-${runA.id}`}
                  onClick={() => handleCopyParams(runA)}
                  title={`Update controller to Run A configuration (${runA.tokenBudget} tokens, Temp ${runA.temperature}, ${runA.modelName})`}
                  className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium border transition-all cursor-pointer ${
                    copiedRunId === runA.id
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {copiedRunId === runA.id ? (
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
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 font-mono block">Mean Quality</span>
              <span className="text-xl font-bold font-mono text-slate-800">{meanScoreA}/100</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
            <div className="bg-slate-50 p-2 rounded border border-slate-100">
              <span className="text-[10px] text-slate-400 block">Floor</span>
              <span className="font-bold text-slate-700">{scoresA.floor}</span>
            </div>
            <div className="bg-indigo-50/60 p-2 rounded border border-indigo-100/80">
              <span className="text-[10px] text-indigo-500 block">FewShot</span>
              <span className="font-bold text-indigo-800">{scoresA.control}</span>
            </div>
            <div className="bg-emerald-50/60 p-2 rounded border border-emerald-100/80">
              <span className="text-[10px] text-emerald-500 block">CallGraph</span>
              <span className="font-bold text-emerald-800">{scoresA.callGraph}</span>
            </div>
            <div className="bg-amber-50/60 p-2 rounded border border-amber-100/80">
              <span className="text-[10px] text-amber-500 block">GitHist</span>
              <span className="font-bold text-amber-800">{scoresA.gitHistory}</span>
            </div>
          </div>
        </div>

        {/* Card B */}
        <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/20 shadow-2xs space-y-3">
          <div className="flex items-start justify-between border-b border-indigo-100 pb-2.5">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-indigo-100 text-indigo-900 uppercase">
                  Run B (Comparison)
                </span>
                <span className="text-xs font-semibold text-slate-900">{runB.targetName}</span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                Budget: <span className="font-bold text-indigo-950">{runB.tokenBudget}t</span> | Model: {runB.modelName} | Temp: {runB.temperature}
              </p>
              <div className="pt-1.5">
                <button
                  type="button"
                  id={`copy-params-card-b-${runB.id}`}
                  onClick={() => handleCopyParams(runB)}
                  title={`Update controller to Run B configuration (${runB.tokenBudget} tokens, Temp ${runB.temperature}, ${runB.modelName})`}
                  className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium border transition-all cursor-pointer ${
                    copiedRunId === runB.id
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-white hover:bg-indigo-100 text-indigo-900 border-indigo-200'
                  }`}
                >
                  {copiedRunId === runB.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span className="font-bold text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Sliders className="w-3 h-3 text-indigo-700" />
                      <span>Copy Run Parameters</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 font-mono block">Mean Quality</span>
              <div className="flex items-center justify-end space-x-1.5">
                <span className="text-xl font-bold font-mono text-indigo-950">{meanScoreB}/100</span>
                {meanScoreChange && (
                  <ScoreTrendBadge current={meanScoreB} previous={meanScoreA} label="" className="py-0 px-1 text-[10px]" />
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
            <div className="bg-white p-2 rounded border border-slate-200">
              <span className="text-[10px] text-slate-400 block">Floor</span>
              <span className="font-bold text-slate-700">{scoresB.floor}</span>
              {scoresB.floor !== scoresA.floor && (
                <span className={`text-[10px] block font-bold ${scoresB.floor > scoresA.floor ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {scoresB.floor - scoresA.floor > 0 ? `+${scoresB.floor - scoresA.floor}` : scoresB.floor - scoresA.floor}
                </span>
              )}
            </div>
            <div className="bg-white p-2 rounded border border-indigo-200">
              <span className="text-[10px] text-indigo-500 block">FewShot</span>
              <span className="font-bold text-indigo-800">{scoresB.control}</span>
              {scoresB.control !== scoresA.control && (
                <span className={`text-[10px] block font-bold ${scoresB.control > scoresA.control ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {scoresB.control - scoresA.control > 0 ? `+${scoresB.control - scoresA.control}` : scoresB.control - scoresA.control}
                </span>
              )}
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <span className="text-[10px] text-emerald-500 block">CallGraph</span>
              <span className="font-bold text-emerald-800">{scoresB.callGraph}</span>
              {scoresB.callGraph !== scoresA.callGraph && (
                <span className={`text-[10px] block font-bold ${scoresB.callGraph > scoresA.callGraph ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {scoresB.callGraph - scoresA.callGraph > 0 ? `+${scoresB.callGraph - scoresA.callGraph}` : scoresB.callGraph - scoresA.callGraph}
                </span>
              )}
            </div>
            <div className="bg-white p-2 rounded border border-amber-200">
              <span className="text-[10px] text-amber-500 block">GitHist</span>
              <span className="font-bold text-amber-800">{scoresB.gitHistory}</span>
              {scoresB.gitHistory !== scoresA.gitHistory && (
                <span className={`text-[10px] block font-bold ${scoresB.gitHistory > scoresA.gitHistory ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {scoresB.gitHistory - scoresA.gitHistory > 0 ? `+${scoresB.gitHistory - scoresA.gitHistory}` : scoresB.gitHistory - scoresA.gitHistory}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Research Hypothesis Net Lift Comparative Deltas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Metric 1: Length Confound Lift */}
        <div className="p-4 rounded-lg bg-indigo-50/60 border border-indigo-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center space-x-1.5">
              <Scale className="w-3.5 h-3.5 text-indigo-600" />
              <span>1. Length Confound Lift</span>
            </span>
            {lengthEffectChange && (
              <ScoreTrendBadge
                current={lengthEffectB}
                previous={lengthEffectA}
                label="B vs A"
                className="text-[10px] py-0 px-1.5"
              />
            )}
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div className="space-y-0.5">
              <span className="text-[11px] text-slate-500 font-mono block">Run A → Run B</span>
              <div className="flex items-baseline space-x-2 font-mono">
                <span className="text-sm font-semibold text-slate-600">+{lengthEffectA} pts</span>
                <span className="text-xs text-slate-400">→</span>
                <span className="text-lg font-bold text-indigo-900">+{lengthEffectB} pts</span>
              </div>
            </div>
            <div className="text-right font-mono">
              <span className="text-[10px] text-slate-500 block">Net Delta</span>
              <span
                className={`text-sm font-bold ${
                  lengthEffectB - lengthEffectA >= 0 ? 'text-indigo-700' : 'text-slate-600'
                }`}
              >
                {lengthEffectB - lengthEffectA >= 0 ? `+${lengthEffectB - lengthEffectA}` : lengthEffectB - lengthEffectA} pts
              </span>
            </div>
          </div>
          <p className="text-[11px] text-indigo-800/80 leading-normal">
            Gain from prompt token expansion alone without repository knowledge.
          </p>
        </div>

        {/* Metric 2: Call-Graph Net Lift */}
        <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center space-x-1.5">
              <GitFork className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Call-Graph Net Lift</span>
            </span>
            {callGraphLiftChange && (
              <ScoreTrendBadge
                current={callGraphLiftB}
                previous={callGraphLiftA}
                label="B vs A"
                className="text-[10px] py-0 px-1.5"
              />
            )}
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div className="space-y-0.5">
              <span className="text-[11px] text-slate-500 font-mono block">Run A → Run B</span>
              <div className="flex items-baseline space-x-2 font-mono">
                <span className="text-sm font-semibold text-slate-600">
                  {callGraphLiftA >= 0 ? `+${callGraphLiftA}` : callGraphLiftA} pts
                </span>
                <span className="text-xs text-slate-400">→</span>
                <span className="text-lg font-bold text-emerald-900">
                  {callGraphLiftB >= 0 ? `+${callGraphLiftB}` : callGraphLiftB} pts
                </span>
              </div>
            </div>
            <div className="text-right font-mono">
              <span className="text-[10px] text-slate-500 block">Lift Delta</span>
              <span
                className={`text-sm font-bold ${
                  callGraphLiftB - callGraphLiftA >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {callGraphLiftB - callGraphLiftA >= 0 ? `+${callGraphLiftB - callGraphLiftA}` : callGraphLiftB - callGraphLiftA} pts
              </span>
            </div>
          </div>
          <p className="text-[11px] text-emerald-800/80 leading-normal">
            Net genuine lift of structural call relationships isolated from length effect.
          </p>
        </div>

        {/* Metric 3: Git-History Net Lift */}
        <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center space-x-1.5">
              <History className="w-3.5 h-3.5 text-amber-600" />
              <span>3. Git-History Net Lift</span>
            </span>
            {gitHistoryLiftChange && (
              <ScoreTrendBadge
                current={gitHistoryLiftB}
                previous={gitHistoryLiftA}
                label="B vs A"
                className="text-[10px] py-0 px-1.5"
              />
            )}
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div className="space-y-0.5">
              <span className="text-[11px] text-slate-500 font-mono block">Run A → Run B</span>
              <div className="flex items-baseline space-x-2 font-mono">
                <span className="text-sm font-semibold text-slate-600">
                  {gitHistoryLiftA >= 0 ? `+${gitHistoryLiftA}` : gitHistoryLiftA} pts
                </span>
                <span className="text-xs text-slate-400">→</span>
                <span className="text-lg font-bold text-amber-900">
                  {gitHistoryLiftB >= 0 ? `+${gitHistoryLiftB}` : gitHistoryLiftB} pts
                </span>
              </div>
            </div>
            <div className="text-right font-mono">
              <span className="text-[10px] text-slate-500 block">Lift Delta</span>
              <span
                className={`text-sm font-bold ${
                  gitHistoryLiftB - gitHistoryLiftA >= 0 ? 'text-amber-700' : 'text-rose-700'
                }`}
              >
                {gitHistoryLiftB - gitHistoryLiftA >= 0 ? `+${gitHistoryLiftB - gitHistoryLiftA}` : gitHistoryLiftB - gitHistoryLiftA} pts
              </span>
            </div>
          </div>
          <p className="text-[11px] text-amber-800/80 leading-normal">
            Net genuine lift of temporal commit diffs and rationale comments isolated from length.
          </p>
        </div>
      </div>

      {/* 4. Comparative Visualizations: Grouped Bar & Radar Overlay */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Visual 1: Grouped Bar Chart (Run A vs Run B) */}
        <div id="comparison-bar-chart" className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Condition Overall Quality (Run A vs Run B)
            </span>
            <div className="flex items-center space-x-3 text-xs font-mono">
              <span className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-400"></span>
                <span className="text-slate-600">Run A ({runA.tokenBudget}t)</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600"></span>
                <span className="text-indigo-900 font-bold">Run B ({runB.tokenBudget}t)</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} margin={{ top: 15, right: 15, left: -15, bottom: 15 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="condition" tick={{ fill: '#334155', fontSize: 11, fontWeight: 500 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  formatter={(val: any, name: string) => [
                    `${val} / 100`,
                    name === 'runA' ? `Run A (${runA.tokenBudget}t)` : `Run B (${runB.tokenBudget}t)`,
                  ]}
                  labelStyle={{ fontWeight: 600, color: '#0f172a' }}
                  contentStyle={{ borderRadius: '8px', fontSize: '12px', borderColor: '#cbd5e1' }}
                />
                <Bar name="runA" dataKey="runA" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar name="runB" dataKey="runB" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Visual 2: Comparative Radar Chart Overlay */}
        <div id="comparison-radar-chart" className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Evaluation Criteria Profile Overlay
            </span>
            <div className="flex items-center space-x-1 bg-white p-1 rounded-md border border-slate-200 text-[10px]">
              <span className="text-slate-400 px-1">Scope:</span>
              <button
                type="button"
                onClick={() => setRadarCondition('mean')}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  radarCondition === 'mean' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Mean
              </button>
              <button
                type="button"
                onClick={() => setRadarCondition('call_graph')}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  radarCondition === 'call_graph' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Call-Graph
              </button>
              <button
                type="button"
                onClick={() => setRadarCondition('git_history')}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  radarCondition === 'git_history' ? 'bg-amber-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Git-History
              </button>
            </div>
          </div>

          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarChartData} outerRadius="72%">
                <PolarGrid stroke="#cbd5e1" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#334155', fontSize: 10, fontWeight: 600 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#94a3b8" />
                <Radar
                  name={`Run A (${runA.tokenBudget}t)`}
                  dataKey="runA"
                  stroke="#64748b"
                  fill="#64748b"
                  fillOpacity={0.15}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
                <Radar
                  name={`Run B (${runB.tokenBudget}t)`}
                  dataKey="runB"
                  stroke="#4f46e5"
                  fill="#4f46e5"
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 5. Detailed Arm-by-Arm Comparative Metrics Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Side-by-Side Arm Evaluation Matrix</span>
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            Direct differential: Run B ({runB.tokenBudget}t) vs Run A ({runA.tokenBudget}t)
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs bg-white">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
              <tr>
                <th className="p-3">Condition & Role</th>
                <th className="p-3 text-center">Run A Score</th>
                <th className="p-3 text-center">Run B Score</th>
                <th className="p-3 text-center">Quality Delta</th>
                <th className="p-3 text-center">Accuracy (/10)</th>
                <th className="p-3 text-center">Intent (/10)</th>
                <th className="p-3 text-center">Halluc. (/10)</th>
                <th className="p-3 text-center">BLEU Match</th>
                <th className="p-3 text-center">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {armRows.map((arm) => {
                const resA = runA.results[arm.key];
                const resB = runB.results[arm.key];
                const scoreA = resA?.evaluation?.overallQuality || 0;
                const scoreB = resB?.evaluation?.overallQuality || 0;
                const chg = calculatePctChange(scoreB, scoreA);

                const accA = resA?.evaluation?.accuracyScore || 0;
                const accB = resB?.evaluation?.accuracyScore || 0;

                const intA = resA?.evaluation?.intentScore || 0;
                const intB = resB?.evaluation?.intentScore || 0;

                const halA = resA?.evaluation?.hallucinationScore || 0;
                const halB = resB?.evaluation?.hallucinationScore || 0;

                const bleuA = Math.round((resA?.evaluation?.bleuScore || 0) * 100);
                const bleuB = Math.round((resB?.evaluation?.bleuScore || 0) * 100);

                const latA = resA?.latencyMs || 0;
                const latB = resB?.latencyMs || 0;

                return (
                  <tr key={arm.key} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-sans">
                      <div className="flex items-center space-x-2">
                        {arm.icon}
                        <span className="font-semibold text-slate-900">{arm.name}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${arm.colorBadge}`}>
                          {arm.role}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-center font-bold text-slate-700">{scoreA}</td>
                    <td className="p-3 text-center font-bold text-indigo-950 bg-indigo-50/30">{scoreB}</td>
                    <td className="p-3 text-center">
                      {chg ? (
                        <div className="inline-flex items-center space-x-1 font-bold">
                          <span
                            className={
                              chg.isPositive ? 'text-emerald-700' : chg.isNegative ? 'text-rose-700' : 'text-slate-500'
                            }
                          >
                            {chg.rawDelta >= 0 ? `+${chg.rawDelta}` : chg.rawDelta} pts
                          </span>
                          <span
                            className={`inline-flex items-center space-x-0.5 px-1 rounded text-[10px] ${
                              chg.isPositive ? 'bg-emerald-100 text-emerald-800' : chg.isNegative ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <DirectionalTrendArrow change={chg} size="xs" />
                            <span>{chg.formatted}</span>
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-slate-500">{accA}</span>
                      <span className="text-slate-300 mx-1">→</span>
                      <span className="font-bold text-slate-800">{accB}</span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-slate-500">{intA}</span>
                      <span className="text-slate-300 mx-1">→</span>
                      <span className="font-bold text-slate-800">{intB}</span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-slate-500">{halA}</span>
                      <span className="text-slate-300 mx-1">→</span>
                      <span className="font-bold text-slate-800">{halB}</span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-slate-500">{bleuA}%</span>
                      <span className="text-slate-300 mx-1">→</span>
                      <span className="font-bold text-slate-800">{bleuB}%</span>
                    </td>
                    <td className="p-3 text-center text-slate-500">
                      {latA}ms → <span className="text-slate-800 font-semibold">{latB}ms</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. Side-by-Side Docstring Output Inspector */}
      <div id="docstring-side-by-side-inspector" className="border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Generated Docstring Text Comparison
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {/* Condition selector */}
            <div className="flex items-center space-x-1 bg-white p-1 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setInspectCondition('code_only')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  inspectCondition === 'code_only' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Code Only
              </button>
              <button
                type="button"
                onClick={() => setInspectCondition('few_shot_control')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  inspectCondition === 'few_shot_control' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Few-Shot
              </button>
              <button
                type="button"
                onClick={() => setInspectCondition('call_graph')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  inspectCondition === 'call_graph' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Call-Graph
              </button>
              <button
                type="button"
                onClick={() => setInspectCondition('git_history')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  inspectCondition === 'git_history' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Git-History
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsDocstringsExpanded(!isDocstringsExpanded)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 cursor-pointer"
              title={isDocstringsExpanded ? 'Collapse' : 'Expand'}
            >
              {isDocstringsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {isDocstringsExpanded && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50">
            {/* Run A Docstring */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center space-x-1.5 font-mono">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    <span>Run A ({runA.tokenBudget}t) Generated Output</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Quality: <strong className="text-slate-800">{runA.results[inspectCondition]?.evaluation?.overallQuality || 0}/100</strong>
                  </span>
                </div>
                <div className="bg-slate-900 rounded-md p-3 text-slate-100 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {runA.results[inspectCondition]?.generatedDocstring || '(No generated output recorded)'}
                </div>
              </div>

              {/* Insights */}
              <div className="pt-2 border-t border-slate-100 text-[11px] space-y-1 font-sans">
                <span className="text-slate-500 font-medium block">Key Insights Captured:</span>
                <div className="flex flex-wrap gap-1">
                  {runA.results[inspectCondition]?.evaluation?.keyInsightsFound?.map((ins, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[10px] font-mono">
                      ✓ {ins}
                    </span>
                  )) || <span className="text-slate-400 italic">None identified</span>}
                </div>
              </div>
            </div>

            {/* Run B Docstring */}
            <div className="bg-white p-4 rounded-lg border border-indigo-200 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                  <span className="text-xs font-bold text-indigo-950 flex items-center space-x-1.5 font-mono">
                    <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                    <span>Run B ({runB.tokenBudget}t) Generated Output</span>
                  </span>
                  <span className="text-[11px] font-mono text-indigo-900">
                    Quality: <strong className="text-indigo-950">{runB.results[inspectCondition]?.evaluation?.overallQuality || 0}/100</strong>
                  </span>
                </div>
                <div className="bg-slate-900 rounded-md p-3 text-indigo-100 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed border border-indigo-950">
                  {runB.results[inspectCondition]?.generatedDocstring || '(No generated output recorded)'}
                </div>
              </div>

              {/* Insights */}
              <div className="pt-2 border-t border-indigo-100 text-[11px] space-y-1 font-sans">
                <span className="text-slate-500 font-medium block">Key Insights Captured:</span>
                <div className="flex flex-wrap gap-1">
                  {runB.results[inspectCondition]?.evaluation?.keyInsightsFound?.map((ins, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-900 border border-indigo-200 text-[10px] font-mono">
                      ✓ {ins}
                    </span>
                  )) || <span className="text-slate-400 italic">None identified</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
