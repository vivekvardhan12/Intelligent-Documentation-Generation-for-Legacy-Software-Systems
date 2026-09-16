import React, { useState, useEffect, useMemo } from 'react';
import { BenchmarkTarget, ConditionPromptPayload, ConditionResult, ContextCondition, ExperimentRun } from './types';
import { BENCHMARK_TARGETS } from './data/benchmarkTargets';
import { buildConditionPrompts } from './utils/tokenBudget';
import { calculateBLEU, calculateROUGEL, analyzeExperimentHypothesis } from './utils/metrics';
import { MultiTrialRunner } from './utils/multiTrialRunner';
import { MultiTrialExperimentSession } from './types';
import { Header } from './components/Header';
import { HypothesisBanner } from './components/HypothesisBanner';
import { BenchmarkSelector } from './components/BenchmarkSelector';
import { TokenBudgetController } from './components/TokenBudgetController';
import { HypothesisVerdictCard } from './components/HypothesisVerdictCard';
import { ConditionArmsComparison } from './components/ConditionArmsComparison';
import { EvaluationDashboard } from './components/EvaluationDashboard';
import { ExportModal } from './components/ExportModal';
import { ResetConfirmModal } from './components/ResetConfirmModal';

const getDefaultResults = (): Record<ContextCondition, ConditionResult> => {
  const initialPayloads = buildConditionPrompts(BENCHMARK_TARGETS[0], 750);
  return {
    code_only: {
      condition: 'code_only',
      title: 'Code Only',
      role: 'floor',
      generatedDocstring: `"""Attempts to consume a specific cost quota of tokens for a given partition key.

Updates bucket balance based on elapsed monotonic time and handles burst debt if permitted.

Args:
    key: Unique identity shard string key.
    cost: Number of tokens requested (default: 1).
    max_tokens: Maximum capacity ceiling of the bucket (default: 100).
    refill_rate_per_sec: Tokens added per second (default: 10.0).
    allow_burst_debt: Whether deficit consumption is permitted (default: False).

Returns:
    tuple[bool, float, int]: (is_allowed, reset_or_retry_delay_sec, remaining_or_debt_tokens).
"""`,
      rawResponse: '',
      promptPayload: initialPayloads.code_only,
      latencyMs: 840,
      status: 'completed',
      evaluation: {
        accuracyScore: 8.8,
        paramReturnScore: 8.5,
        intentScore: 5.2,
        hallucinationScore: 9.5,
        overallQuality: 78,
        bleuScore: 0.42,
        rougeLScore: 0.58,
        wordCount: 52,
        tokenCount: 68,
        judgeCritique: 'Accurately documents arguments and return tuple structure from code signature, but completely misses the critical hypervisor clock drift rationale and Redis failover intent.',
        keyInsightsFound: ['Token bucket math', 'Burst debt argument', 'Monotonic time update'],
        hallucinationsIdentified: []
      }
    },
    few_shot_control: {
      condition: 'few_shot_control',
      title: 'Few-Shot Control',
      role: 'control',
      generatedDocstring: `"""Evaluates and consumes token capacity for key-based rate limiting with debt allowance.

Thread-safely recharges available bucket tokens using monotonic elapsed time. Supports bounded overdraft
for high-priority requests while decrementing accrued deficit upon subsequent refills.

Args:
    key: Unique identity shard partition key.
    cost: Quantity of tokens requested for consumption (default: 1).
    max_tokens: Maximum capacity of the token bucket (default: 100).
    refill_rate_per_sec: Rate of continuous token replenishment per second (default: 10.0).
    allow_burst_debt: Enables temporary overdraft up to 50% max capacity (default: False).

Returns:
    A 3-tuple (allowed, retry_after, balance):
        - allowed: True if request is admitted; False otherwise.
        - retry_after: Delay in seconds until full recharge or needed tokens exist.
        - balance: Current remaining tokens or negative debt.
"""`,
      rawResponse: '',
      promptPayload: initialPayloads.few_shot_control,
      latencyMs: 910,
      status: 'completed',
      evaluation: {
        accuracyScore: 9.0,
        paramReturnScore: 9.2,
        intentScore: 6.4,
        hallucinationScore: 9.6,
        overallQuality: 84,
        bleuScore: 0.51,
        rougeLScore: 0.65,
        wordCount: 78,
        tokenCount: 95,
        judgeCritique: 'Demonstrates improved docstring formatting and clearer parameter breakdown due to in-context few-shot demonstration length, but still lacks repo-specific root cause awareness.',
        keyInsightsFound: ['Thread-safe lock awareness', 'Structured tuple return formatting', '50% burst debt ceiling'],
        hallucinationsIdentified: []
      }
    },
    call_graph: {
      condition: 'call_graph',
      title: 'Call-Graph Context',
      role: 'treatment',
      generatedDocstring: `"""Evaluates rate limit quota on the API gateway data plane with Enterprise burst overdraft support.

Acts as the core token consumption primitive invoked by AuthGatewayMiddleware and TieredBillingInterceptor.
Thread-safely locks the partition shard using an FNV-1a striped mutex, refills tokens based on elapsed monotonic
time, and returns RFC 6585 compliant retry delays for HTTP 429 serialization.

Args:
    key: Unique identity shard key (e.g. client API token or tenant UUID).
    cost: Number of tokens to consume for the incoming RPC (default: 1).
    max_tokens: Peak burst capacity of the token bucket (default: 100).
    refill_rate_per_sec: Steady-state token replenishment rate per second (default: 10.0).
    allow_burst_debt: When True (Enterprise SLA), allows overdraft up to 50% capacity.

Returns:
    tuple[bool, float, int]:
        - bool: True if admitted, False if rejected for 429 response.
        - float: Retry delay or full reset interval in seconds.
        - int: Remaining quota balance or active debt deficit.
"""`,
      rawResponse: '',
      promptPayload: initialPayloads.call_graph,
      latencyMs: 960,
      status: 'completed',
      evaluation: {
        accuracyScore: 9.5,
        paramReturnScore: 9.5,
        intentScore: 9.2,
        hallucinationScore: 9.8,
        overallQuality: 94,
        bleuScore: 0.68,
        rougeLScore: 0.77,
        wordCount: 96,
        tokenCount: 122,
        judgeCritique: 'Excellent architectural grounding. Identifies that this function sits in the L4 ingress proxy gateway, connects with AuthGatewayMiddleware for HTTP 429 Retry-After calculation, and uses striped mutexes.',
        keyInsightsFound: ['AuthGatewayMiddleware caller role', 'RFC 6585 HTTP 429 Retry-After link', 'FNV-1a shard mutex context'],
        hallucinationsIdentified: []
      }
    },
    git_history: {
      condition: 'git_history',
      title: 'Git-History Context',
      role: 'treatment',
      generatedDocstring: `"""Thread-safely consumes token quota with hypervisor clock drift protection and amortized burst overdraft.

Replenishes bucket tokens over elapsed monotonic time, clamping duration to non-negative values to prevent
token loss during hypervisor clock synchronization steps. Supports burst debt consumption for Enterprise
workloads to prevent 429 drop spikes during sub-second traffic surges.

Args:
    key: Shard partition identity key.
    cost: Tokens required for this operation (default: 1).
    max_tokens: Maximum token ceiling (default: 100).
    refill_rate_per_sec: Tokens generated per continuous second (default: 10.0).
    allow_burst_debt: If True, allows debt accumulation up to 50% capacity for burst absorption.

Returns:
    tuple[bool, float, int]:
        - allowed (bool): True if operation can proceed.
        - reset_or_retry (float): Seconds until full recovery or required balance.
        - remaining (int): Available token balance or negative overdraft.
"""`,
      rawResponse: '',
      promptPayload: initialPayloads.git_history,
      latencyMs: 940,
      status: 'completed',
      evaluation: {
        accuracyScore: 9.6,
        paramReturnScore: 9.4,
        intentScore: 9.6,
        hallucinationScore: 9.7,
        overallQuality: 95,
        bleuScore: 0.72,
        rougeLScore: 0.79,
        wordCount: 92,
        tokenCount: 118,
        judgeCritique: 'Outstanding capture of subtle engineering intent. Correctly explains why elapsed time is clamped (Xen/KVM hypervisor clock sync stepping) and the business reason for burst debt during load bursts.',
        keyInsightsFound: ['Hypervisor clock synchronization clamp', 'Sub-second traffic surge burst absorption', 'Debt amortization logic'],
        hallucinationsIdentified: []
      }
    }
  };
};

const getInitialBaselineRun = (): ExperimentRun => {
  const payloads = buildConditionPrompts(BENCHMARK_TARGETS[0], 500);
  const baselineResults: Record<ContextCondition, ConditionResult> = {
    code_only: {
      condition: 'code_only',
      title: 'Code Only',
      role: 'floor',
      generatedDocstring: `"""Attempts to consume a specific cost quota of tokens for a given partition key."""`,
      rawResponse: '',
      promptPayload: payloads.code_only,
      latencyMs: 790,
      status: 'completed',
      evaluation: {
        accuracyScore: 8.5,
        paramReturnScore: 8.2,
        intentScore: 4.9,
        hallucinationScore: 9.4,
        overallQuality: 76,
        bleuScore: 0.39,
        rougeLScore: 0.54,
        wordCount: 45,
        tokenCount: 55,
        judgeCritique: 'Accurate parameters but lacks intent depth.',
        keyInsightsFound: ['Token bucket math'],
        hallucinationsIdentified: [],
      },
    },
    few_shot_control: {
      condition: 'few_shot_control',
      title: 'Few-Shot Control',
      role: 'control',
      generatedDocstring: `"""Evaluates and consumes token capacity for key-based rate limiting with debt allowance."""`,
      rawResponse: '',
      promptPayload: payloads.few_shot_control,
      latencyMs: 840,
      status: 'completed',
      evaluation: {
        accuracyScore: 8.8,
        paramReturnScore: 8.9,
        intentScore: 5.9,
        hallucinationScore: 9.5,
        overallQuality: 81,
        bleuScore: 0.47,
        rougeLScore: 0.62,
        wordCount: 68,
        tokenCount: 82,
        judgeCritique: 'Clear few-shot formatting structure.',
        keyInsightsFound: ['Structured return formatting'],
        hallucinationsIdentified: [],
      },
    },
    call_graph: {
      condition: 'call_graph',
      title: 'Call-Graph Context',
      role: 'treatment',
      generatedDocstring: `"""Thread-safely evaluates rate limit quota on API gateway routes."""`,
      rawResponse: '',
      promptPayload: payloads.call_graph,
      latencyMs: 890,
      status: 'completed',
      evaluation: {
        accuracyScore: 9.2,
        paramReturnScore: 9.1,
        intentScore: 8.5,
        hallucinationScore: 9.6,
        overallQuality: 89,
        bleuScore: 0.61,
        rougeLScore: 0.71,
        wordCount: 78,
        tokenCount: 94,
        judgeCritique: 'Identified AuthGatewayMiddleware caller constraints.',
        keyInsightsFound: ['AuthGatewayMiddleware caller role'],
        hallucinationsIdentified: [],
      },
    },
    git_history: {
      condition: 'git_history',
      title: 'Git-History Context',
      role: 'treatment',
      generatedDocstring: `"""Thread-safely consumes token quota with clock sync protection."""`,
      rawResponse: '',
      promptPayload: payloads.git_history,
      latencyMs: 880,
      status: 'completed',
      evaluation: {
        accuracyScore: 9.3,
        paramReturnScore: 9.2,
        intentScore: 8.9,
        hallucinationScore: 9.6,
        overallQuality: 91,
        bleuScore: 0.65,
        rougeLScore: 0.74,
        wordCount: 80,
        tokenCount: 96,
        judgeCritique: 'Identified Xen/KVM hypervisor clock synchronization clamp.',
        keyInsightsFound: ['Hypervisor clock synchronization clamp'],
        hallucinationsIdentified: [],
      },
    },
  };

  const baselineSession = MultiTrialRunner.createBaselineMultiTrialSession(BENCHMARK_TARGETS[0], 500);

  const run: ExperimentRun = {
    id: 'run-baseline-500t',
    timestamp: Date.now() - 1000 * 60 * 10,
    targetId: BENCHMARK_TARGETS[0].id,
    targetName: BENCHMARK_TARGETS[0].name,
    language: BENCHMARK_TARGETS[0].language,
    tokenBudget: 500,
    modelName: 'gemini-3.7-flash',
    temperature: 0.2,
    trialIndex: 1,
    results: baselineResults,
    multiTrialSession: baselineSession,
    rawTrials: baselineSession.rawTrials,
  };
  run.analysis = analyzeExperimentHypothesis(run);
  return run;
};

export default function App() {
  const [selectedTarget, setSelectedTarget] = useState<BenchmarkTarget>(BENCHMARK_TARGETS[0]);
  const [tokenBudget, setTokenBudget] = useState<number>(750);
  const [temperature, setTemperature] = useState<number>(0.2);
  const [modelName, setModelName] = useState<string>('gemini-3.7-flash');
  const [judgeModel, setJudgeModel] = useState<string>('gemini-3.7-flash');

  // Benchmark execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<'idle' | 'generating' | 'evaluating' | 'completed'>('idle');
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [resetModalOpen, setResetModalOpen] = useState<boolean>(false);
  const [runHistory, setRunHistory] = useState<ExperimentRun[]>(() => [getInitialBaselineRun()]);
  const [multiTrialSession, setMultiTrialSession] = useState<MultiTrialExperimentSession | undefined>(
    () => getInitialBaselineRun().multiTrialSession
  );
  const [copiedNotification, setCopiedNotification] = useState<{
    targetName: string;
    budget: number;
    temperature: number;
    model: string;
  } | null>(null);

  // Computed condition prompt payloads based on target and fixed budget
  const promptPayloads = useMemo(() => {
    return buildConditionPrompts(selectedTarget, tokenBudget);
  }, [selectedTarget, tokenBudget]);

  // Current condition results
  const [results, setResults] = useState<Record<ContextCondition, ConditionResult>>(() => getDefaultResults());

  // Current active experiment run for hypothesis evaluation
  const currentRun = useMemo<ExperimentRun>(() => {
    const run: ExperimentRun = {
      id: `run-${Date.now()}`,
      timestamp: Date.now(),
      targetId: selectedTarget.id,
      targetName: selectedTarget.name,
      language: selectedTarget.language,
      tokenBudget,
      modelName,
      temperature,
      trialIndex: runHistory.length + 1,
      results,
      multiTrialSession,
      rawTrials: multiTrialSession?.rawTrials,
    };
    run.analysis = analyzeExperimentHypothesis(run);
    return run;
  }, [selectedTarget, tokenBudget, modelName, temperature, results, runHistory.length, multiTrialSession]);

  // Derive previous run for comparative percentage delta calculations
  const previousRun = useMemo(() => {
    if (!runHistory || runHistory.length === 0) return null;
    // If runHistory[0] matches current active run, look at runHistory[1]
    if (runHistory[0]?.id === currentRun.id) {
      return runHistory.length > 1 ? runHistory[1] : null;
    }
    // Otherwise the most recent run in history is the previous run
    return runHistory[0];
  }, [runHistory, currentRun]);

  // Sync initial run to history
  useEffect(() => {
    if (runHistory.length === 0 && results.code_only?.evaluation) {
      setRunHistory([currentRun]);
    }
  }, []);

  // Update prompt payloads when target or budget changes
  useEffect(() => {
    setResults((prev) => ({
      code_only: { ...prev.code_only, promptPayload: promptPayloads.code_only },
      few_shot_control: { ...prev.few_shot_control, promptPayload: promptPayloads.few_shot_control },
      call_graph: { ...prev.call_graph, promptPayload: promptPayloads.call_graph },
      git_history: { ...prev.git_history, promptPayload: promptPayloads.git_history },
    }));
  }, [promptPayloads]);

  // Execute the 4-Arm Isolation Benchmark (Single run at a time)
  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setCurrentStep('generating');

    // Set generating status on cards
    setResults((prev) => ({
      code_only: { ...prev.code_only, status: 'generating' },
      few_shot_control: { ...prev.few_shot_control, status: 'generating' },
      call_graph: { ...prev.call_graph, status: 'generating' },
      git_history: { ...prev.git_history, status: 'generating' },
    }));

    try {
      const session = await MultiTrialRunner.runExperimentSession({
        target: selectedTarget,
        tokenBudget,
        numTrials: 1,
        modelName,
        temperature,
        judgeModel,
        onProgress: (_trial, _total, phase) => {
          setCurrentStep(phase === 'generating' ? 'generating' : 'evaluating');
        },
      });

      const newRun = MultiTrialRunner.convertToExperimentRun(session);
      setResults(newRun.results);
      setMultiTrialSession(session);
      setRunHistory((prev) => [newRun, ...prev]);
    } catch (err: any) {
      console.error('Benchmark run error:', err);
    } finally {
      setIsRunning(false);
      setCurrentStep('completed');
    }
  };

  const handleConfirmReset = () => {
    setSelectedTarget(BENCHMARK_TARGETS[0]);
    setTokenBudget(750);
    setTemperature(0.2);
    setModelName('gemini-3.7-flash');
    setJudgeModel('gemini-3.7-flash');
    setResults(getDefaultResults());
    const initialRun = getInitialBaselineRun();
    setRunHistory([initialRun]);
    setMultiTrialSession(initialRun.multiTrialSession);
    setCurrentStep('idle');
  };

  const handleCopyRunParameters = (run: ExperimentRun) => {
    setTokenBudget(run.tokenBudget);
    setTemperature(run.temperature);
    setModelName(run.modelName);
    if (run.multiTrialSession?.judgeModel) {
      setJudgeModel(run.multiTrialSession.judgeModel);
    }
    const target = BENCHMARK_TARGETS.find((t) => t.id === run.targetId);
    if (target) {
      setSelectedTarget(target);
    }
    setCopiedNotification({
      targetName: run.targetName,
      budget: run.tokenBudget,
      temperature: run.temperature,
      model: run.modelName,
    });
    // Smoothly scroll to the controller so the user immediately sees the updated sliders
    setTimeout(() => {
      const controllerEl = document.getElementById('token-budget-controller');
      if (controllerEl) {
        controllerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-indigo-900 selection:text-white">
      {/* Top Header */}
      <Header
        onReset={() => setResetModalOpen(true)}
        onOpenExport={() => setExportModalOpen(true)}
        isRunning={isRunning}
        modelName={modelName}
        tokenBudget={tokenBudget}
      />

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Scientific Confound Protocol Banner */}
        <HypothesisBanner />

        {/* Target Benchmark Function Selector */}
        <BenchmarkSelector
          selectedTarget={selectedTarget}
          onSelectTarget={(target) => setSelectedTarget(target)}
          isRunning={isRunning}
        />

        {/* Parameters Copied Feedback Notification */}
        {copiedNotification && (
          <div
            id="params-copied-banner"
            className="bg-emerald-50 border border-emerald-300 text-emerald-950 px-4 py-3 rounded-xl text-xs flex items-center justify-between shadow-2xs animate-in fade-in duration-200"
          >
            <div className="flex items-center space-x-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800 font-bold text-xs">
                ✓
              </span>
              <div>
                <span className="font-bold text-emerald-900">Run Parameters Loaded into Controller:</span>{' '}
                <span className="text-emerald-800">
                  Target: <strong className="text-emerald-950 font-mono font-semibold">{copiedNotification.targetName}</strong> | Budget:{' '}
                  <strong className="text-emerald-950 font-mono font-bold">{copiedNotification.budget} tokens</strong> | Temp:{' '}
                  <strong className="text-emerald-950 font-mono font-bold">{copiedNotification.temperature}</strong> | Model:{' '}
                  <strong className="text-emerald-950 font-mono font-semibold">{copiedNotification.model}</strong>
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCopiedNotification(null)}
              className="text-emerald-700 hover:text-emerald-950 text-base font-bold ml-3 cursor-pointer"
              title="Dismiss notice"
            >
              ×
            </button>
          </div>
        )}

        {/* Token Budget Slider & Execution Trigger */}
        <TokenBudgetController
          tokenBudget={tokenBudget}
          onBudgetChange={(b) => setTokenBudget(b)}
          temperature={temperature}
          onTemperatureChange={(t) => setTemperature(t)}
          model={modelName}
          onModelChange={(m) => setModelName(m)}
          judgeModel={judgeModel}
          onJudgeModelChange={(jm) => setJudgeModel(jm)}
          promptPayloads={promptPayloads}
          isRunning={isRunning}
          onRunBenchmark={handleRunBenchmark}
          currentStep={currentStep}
        />

        {/* The Central Scientific Hypothesis Verdict */}
        <HypothesisVerdictCard experimentRun={currentRun} previousRun={previousRun} />

        {/* 4-Arm Side-by-Side Generated Docstrings & Detailed Rubrics */}
        <ConditionArmsComparison
          results={results}
          referenceDocstring={selectedTarget.referenceDocstring}
        />

        {/* Multi-Dimensional Radar Charts, Score Graphs, & Trial History */}
        <EvaluationDashboard
          experimentRun={currentRun}
          runHistory={runHistory}
          onCopyRunParameters={handleCopyRunParameters}
        />
      </main>

      {/* Export Findings Modal */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        currentRun={currentRun}
        runHistory={runHistory}
      />

      {/* Reset Confirmation Modal */}
      <ResetConfirmModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleConfirmReset}
        currentTargetName={selectedTarget.name}
        currentBudget={tokenBudget}
        runCount={runHistory.length}
      />
    </div>
  );
}
