/**
 * Application root — owns run parameters, run execution and run history.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. NO SEEDED FAKE RESULTS. The old component opened with ~290 lines of
 *    hand-authored docstrings and scores installed directly into live state,
 *    presented exactly like measured results. The app now starts empty and the
 *    sample dataset is opt-in and badged (see `src/data/demoSession.ts`).
 *
 * 2. TRIALS ARE CONFIGURABLE. `numTrials: 1` was hardwired at the call site,
 *    so the entire statistical layer — paired t-tests, Wilcoxon, Holm
 *    correction — could never produce a result, and every verdict rested on a
 *    single observation.
 *
 * 3. FAILURES ARE VISIBLE. A failed run was `console.error` and nothing else:
 *    the spinner stopped, stale results stayed on screen, and the user had no
 *    way to know. Errors now raise toasts carrying the server's own message.
 *
 * 4. RUNS ARE CANCELLABLE AND PERSISTED. An AbortController is threaded through
 *    every request, and history survives a page reload via localStorage.
 *
 * 5. THE CHART VIEWS ARE LAZY. Recharts is a large dependency rendered below
 *    the fold; it is now code-split so it does not block first paint.
 */

import React, { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { BenchmarkTarget, ExperimentRun } from './types';
import { BENCHMARK_TARGETS } from './data/benchmarkTargets';
import { createDemoSession } from './data/demoSession';
import { DEFAULT_JUDGE_MODEL, DEFAULT_MODEL } from './config/models';
import { buildConditionPrompts } from './utils/tokenBudget';
import { analyzeExperimentHypothesis } from './utils/metrics';
import { MultiTrialRunner, RunProgressSnapshot } from './utils/multiTrialRunner';
import { ApiError, isCancellation } from './utils/apiClient';
import { MIN_TRIALS_FOR_INFERENCE } from './utils/statistics';
import { useToasts } from './hooks/useToasts';
import { usePersistentRunHistory } from './hooks/usePersistentRunHistory';
import { Header } from './components/Header';
import { HypothesisBanner } from './components/HypothesisBanner';
import { BenchmarkSelector } from './components/BenchmarkSelector';
import { TokenBudgetController } from './components/TokenBudgetController';
import { HypothesisVerdictCard } from './components/HypothesisVerdictCard';
import { ConditionArmsComparison } from './components/ConditionArmsComparison';
import { ExportModal } from './components/ExportModal';
import { ResetConfirmModal } from './components/ResetConfirmModal';
import { RunProgressPanel } from './components/RunProgressPanel';
import { EmptyState } from './components/EmptyState';
import { Toaster } from './components/Toaster';

/**
 * The dashboard is code-split because it pulls in Recharts, comfortably the
 * largest dependency in the bundle, for a view that sits below the fold and is
 * empty until a run completes.
 */
const EvaluationDashboard = lazy(() =>
  import('./components/EvaluationDashboard').then((module) => ({
    default: module.EvaluationDashboard,
  }))
);

/** Default trial count: the minimum that permits a significance test. */
const DEFAULT_TRIALS = MIN_TRIALS_FOR_INFERENCE;

/** Default context token budget. */
const DEFAULT_TOKEN_BUDGET = 750;

/** Default sampling temperature — low, for reproducibility. */
const DEFAULT_TEMPERATURE = 0.2;

/** Placeholder shown while the dashboard chunk loads. */
const DashboardFallback: React.FC = () => (
  <div
    className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-xs text-slate-500"
    role="status"
  >
    Loading charts…
  </div>
);

export default function App() {
  // --- Run parameters ----------------------------------------------------
  const [selectedTarget, setSelectedTarget] = useState<BenchmarkTarget>(BENCHMARK_TARGETS[0]);
  const [tokenBudget, setTokenBudget] = useState<number>(DEFAULT_TOKEN_BUDGET);
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE);
  const [modelName, setModelName] = useState<string>(DEFAULT_MODEL);
  const [judgeModel, setJudgeModel] = useState<string>(DEFAULT_JUDGE_MODEL);
  const [numTrials, setNumTrials] = useState<number>(DEFAULT_TRIALS);

  // --- Execution state ---------------------------------------------------
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<RunProgressSnapshot | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  /**
   * Aborts the in-flight run. Held in a ref rather than state because changing
   * it must not trigger a re-render, and it is read from an async callback that
   * would otherwise close over a stale value.
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- Results -----------------------------------------------------------
  /** The run currently on display. Null until the first run or demo load. */
  const [activeRun, setActiveRun] = useState<ExperimentRun | null>(null);

  const { toasts, pushToast, dismissToast } = useToasts();
  const {
    runHistory,
    addRun,
    clearHistory,
    persistenceError,
    exportHistoryJson,
    importHistoryJson,
  } = usePersistentRunHistory();

  // --- Modals and transient UI ------------------------------------------
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState<{
    targetName: string;
    budget: number;
    temperature: number;
    model: string;
  } | null>(null);

  /**
   * Live prompt payloads for the controller's token-allocation preview.
   *
   * Memoized on (target, budget) so dragging the budget slider does not rebuild
   * four prompts per animation frame. The slider itself only commits on release
   * (see TokenBudgetController), so this recomputes once per settled value.
   */
  const promptPayloads = useMemo(
    () => buildConditionPrompts(selectedTarget, tokenBudget),
    [selectedTarget, tokenBudget]
  );

  /**
   * The previous run, for comparative deltas.
   *
   * Compared by id against the active run. The old implementation minted
   * `run-${Date.now()}` inside a `useMemo` that reran on every render, so the
   * id it compared against changed constantly and this lookup was unreliable.
   * Run ids are now assigned once, when the run is created.
   */
  const previousRun = useMemo(() => {
    if (runHistory.length === 0) return null;
    if (activeRun && runHistory[0]?.id === activeRun.id) {
      return runHistory.length > 1 ? runHistory[1] : null;
    }
    return runHistory[0];
  }, [runHistory, activeRun]);

  /** True when any displayed data is illustrative rather than measured. */
  const isShowingDemoData = activeRun?.isDemoData === true;

  /**
   * Executes the benchmark.
   *
   * Wrapped in `useCallback` so the memoized child components below do not
   * re-render on every parent render — without a stable identity, `React.memo`
   * on the dashboard and comparison views would never hold.
   */
  const handleRunBenchmark = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRunning(true);
    setIsCancelling(false);
    setRunStartedAt(Date.now());
    setProgress({
      phase: 'generating',
      trialsCompleted: 0,
      totalTrials: numTrials,
      requestsCompleted: 0,
      totalRequests: numTrials * 7 + 1,
      message: 'Starting benchmark…',
    });

    try {
      const session = await MultiTrialRunner.runExperimentSession({
        target: selectedTarget,
        tokenBudget,
        numTrials,
        modelName,
        temperature,
        judgeModel,
        onProgress: setProgress,
        signal: controller.signal,
      });

      const completedRun = MultiTrialRunner.convertToExperimentRun(session);
      setActiveRun(completedRun);
      addRun(completedRun);

      // Report the run's real outcome rather than implying success.
      if (session.status === 'failed') {
        pushToast({
          variant: 'error',
          title: 'Benchmark failed — no results were produced',
          description:
            session.errors?.join('\n') ??
            'Every arm failed. Check that GEMINI_API_KEY is valid and the model is available.',
        });
      } else if (session.status === 'partial_error') {
        pushToast({
          variant: 'warning',
          title: 'Benchmark completed with failures',
          description: `Some arms or trials did not produce a usable result and are excluded from the statistics.\n\n${
            session.errors?.slice(0, 3).join('\n') ?? ''
          }`,
        });
      } else if (numTrials < MIN_TRIALS_FOR_INFERENCE) {
        pushToast({
          variant: 'info',
          title: `Descriptive results only (${numTrials} trial${numTrials === 1 ? '' : 's'})`,
          description: `Significance testing needs at least ${MIN_TRIALS_FOR_INFERENCE} paired trials. Raise the trial count to get p-values and confidence intervals.`,
        });
      } else {
        pushToast({
          variant: 'success',
          title: 'Benchmark complete',
          description: session.overallVerdict.headline,
        });
      }
    } catch (error: unknown) {
      if (isCancellation(error)) {
        pushToast({
          variant: 'info',
          title: 'Run cancelled',
          description: 'No results were recorded for the cancelled run.',
        });
      } else {
        // The real reason, surfaced where the user can see it. This path used
        // to be a bare console.error.
        pushToast({
          variant: 'error',
          title: 'Benchmark run failed',
          description:
            error instanceof ApiError
              ? error.displayMessage
              : error instanceof Error
                ? error.message
                : 'An unexpected error occurred.',
        });
      }
    } finally {
      abortControllerRef.current = null;
      setIsRunning(false);
      setIsCancelling(false);
      setProgress(null);
      setRunStartedAt(null);
    }
  }, [
    selectedTarget,
    tokenBudget,
    numTrials,
    modelName,
    temperature,
    judgeModel,
    addRun,
    pushToast,
  ]);

  /** Requests cancellation of the in-flight run. */
  const handleCancelRun = useCallback(() => {
    setIsCancelling(true);
    abortControllerRef.current?.abort();
  }, []);

  /** Loads the illustrative sample dataset, clearly flagged as such. */
  const handleLoadDemo = useCallback(() => {
    const session = createDemoSession(selectedTarget, tokenBudget);
    const demoRun = MultiTrialRunner.convertToExperimentRun(session);

    setActiveRun(demoRun);
    addRun(demoRun);
    pushToast({
      variant: 'warning',
      title: 'Sample data loaded',
      description:
        'These scores are illustrative and were not measured from a model. They are labelled as demo data throughout, including in exports.',
    });
  }, [selectedTarget, tokenBudget, addRun, pushToast]);

  /** Restores defaults and clears all results. */
  const handleConfirmReset = useCallback(() => {
    setSelectedTarget(BENCHMARK_TARGETS[0]);
    setTokenBudget(DEFAULT_TOKEN_BUDGET);
    setTemperature(DEFAULT_TEMPERATURE);
    setModelName(DEFAULT_MODEL);
    setJudgeModel(DEFAULT_JUDGE_MODEL);
    setNumTrials(DEFAULT_TRIALS);
    setActiveRun(null);
    clearHistory();
    setResetModalOpen(false);
    pushToast({
      variant: 'info',
      title: 'Experiment reset',
      description: 'Parameters restored to defaults and all run history cleared.',
    });
  }, [clearHistory, pushToast]);

  /** Copies a historical run's parameters back into the controller. */
  const handleCopyRunParameters = useCallback((run: ExperimentRun) => {
    setTokenBudget(run.tokenBudget);
    setTemperature(run.temperature);
    setModelName(run.modelName);

    if (run.multiTrialSession?.judgeModel) setJudgeModel(run.multiTrialSession.judgeModel);
    if (run.multiTrialSession?.numTrials) setNumTrials(run.multiTrialSession.numTrials);

    const target = BENCHMARK_TARGETS.find((t) => t.id === run.targetId);
    if (target) setSelectedTarget(target);

    setCopiedNotification({
      targetName: run.targetName,
      budget: run.tokenBudget,
      temperature: run.temperature,
      model: run.modelName,
    });

    // Scrolling is deferred a frame so the controller has re-rendered with the
    // new values before it is brought into view.
    requestAnimationFrame(() => {
      document
        .getElementById('token-budget-controller')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  /** Downloads the full run history as JSON for archiving or sharing. */
  const handleExportHistory = useCallback(() => {
    const blob = new Blob([exportHistoryJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `codedoc-isolator-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [exportHistoryJson]);

  /** Restores a previously exported history file. */
  const handleImportHistory = useCallback(
    (json: string) => {
      try {
        const count = importHistoryJson(json);
        pushToast({
          variant: 'success',
          title: `Imported ${count} run${count === 1 ? '' : 's'}`,
        });
      } catch (error: unknown) {
        pushToast({
          variant: 'error',
          title: 'Import failed',
          description: error instanceof Error ? error.message : 'The file could not be read.',
        });
      }
    },
    [importHistoryJson, pushToast]
  );

  /**
   * The displayed run, with its single-run analysis attached.
   *
   * A run produced by the multi-trial runner already carries statistically
   * corrected verdicts; `analyzeExperimentHypothesis` only fills in the
   * descriptive single-run summary when that is missing.
   */
  const displayRun = useMemo(() => {
    if (!activeRun) return null;
    if (activeRun.analysis) return activeRun;
    return { ...activeRun, analysis: analyzeExperimentHypothesis(activeRun) };
  }, [activeRun]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-indigo-900 selection:text-white">
      <Header
        onReset={() => setResetModalOpen(true)}
        onOpenExport={() => setExportModalOpen(true)}
        isRunning={isRunning}
        modelName={modelName}
        tokenBudget={tokenBudget}
        numTrials={numTrials}
        hasResults={displayRun !== null}
        isShowingDemoData={isShowingDemoData}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <HypothesisBanner />

        {/*
          Storage failures are shown inline rather than as a transient toast,
          because the consequence (results will not survive a reload) persists
          for the whole session.
        */}
        {persistenceError && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-300 text-amber-950 px-4 py-3 rounded-xl text-xs"
          >
            <strong className="font-bold">History not saved. </strong>
            {persistenceError}
          </div>
        )}

        <BenchmarkSelector
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          isRunning={isRunning}
        />

        {copiedNotification && (
          <div
            id="params-copied-banner"
            role="status"
            className="bg-emerald-50 border border-emerald-300 text-emerald-950 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800 font-bold text-xs"
                aria-hidden="true"
              >
                ✓
              </span>
              <div className="min-w-0">
                <span className="font-bold text-emerald-900">Parameters loaded: </span>
                <span className="text-emerald-800">
                  {copiedNotification.targetName} · {copiedNotification.budget} tokens · temp{' '}
                  {copiedNotification.temperature} · {copiedNotification.model}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCopiedNotification(null)}
              aria-label="Dismiss parameters notice"
              className="text-emerald-700 hover:text-emerald-950 text-base font-bold shrink-0 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-600 rounded px-1"
            >
              ×
            </button>
          </div>
        )}

        <TokenBudgetController
          tokenBudget={tokenBudget}
          onBudgetChange={setTokenBudget}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          model={modelName}
          onModelChange={setModelName}
          judgeModel={judgeModel}
          onJudgeModelChange={setJudgeModel}
          numTrials={numTrials}
          onNumTrialsChange={setNumTrials}
          promptPayloads={promptPayloads}
          target={selectedTarget}
          isRunning={isRunning}
          onRunBenchmark={handleRunBenchmark}
          progressMessage={progress?.message}
        />

        {isRunning && (
          <RunProgressPanel
            progress={progress}
            startedAt={runStartedAt}
            onCancel={handleCancelRun}
            isCancelling={isCancelling}
          />
        )}

        {displayRun ? (
          <>
            <HypothesisVerdictCard experimentRun={displayRun} previousRun={previousRun} />

            <ConditionArmsComparison
              results={displayRun.results}
              referenceDocstring={selectedTarget.referenceDocstring}
              isDemoData={isShowingDemoData}
            />

            <Suspense fallback={<DashboardFallback />}>
              <EvaluationDashboard
                experimentRun={displayRun}
                runHistory={runHistory}
                onCopyRunParameters={handleCopyRunParameters}
              />
            </Suspense>
          </>
        ) : (
          <EmptyState
            onRunBenchmark={handleRunBenchmark}
            onLoadDemo={handleLoadDemo}
            isRunning={isRunning}
            plannedTrials={numTrials}
          />
        )}
      </main>

      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        currentRun={displayRun}
        runHistory={runHistory}
        onExportHistory={handleExportHistory}
        onImportHistory={handleImportHistory}
      />

      <ResetConfirmModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleConfirmReset}
        currentTargetName={selectedTarget.name}
        currentBudget={tokenBudget}
        runCount={runHistory.length}
      />

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
