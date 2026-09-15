/**
 * Run parameter controller: token budget, trials, models, temperature, cost.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. TRIAL COUNT IS NOW EXPOSED. This is the single most consequential change
 *    in the UI. The runner has always accepted `numTrials`, but the app passed
 *    a hardcoded 1 — so the paired t-tests, Wilcoxon tests and Holm correction
 *    could never yield a result, and every verdict rested on one observation.
 *    The control carries inline guidance about what each count buys.
 *
 * 2. THE SLIDER COMMITS ON RELEASE. Dragging it previously fired a state update
 *    per step, and each update rebuilt all four prompt payloads (running the
 *    token heuristic over every context block) AND re-rendered four Recharts
 *    canvases below. The handle now updates a local draft while dragging and
 *    commits once on release, so the expensive work happens once per settled
 *    value instead of ~8 times per drag.
 *
 * 3. THE COST ESTIMATE IS HONEST. It previously counted only the four
 *    generation calls, ignoring the blind-judge call (the largest prompt in the
 *    run), the four factuality checks and the embedding call — and never
 *    multiplied by the trial count. See `src/config/pricing.ts`.
 */

import React, { memo, useMemo, useState } from 'react';
import { BenchmarkTarget, ConditionPromptPayload, ContextCondition } from '../types';
import { Play, Sliders, Layers, Coins, Repeat, Info } from 'lucide-react';
import { GEMINI_MODELS } from '../config/models';
import { estimateSessionCost, formatINR, USD_TO_INR, estimateTokenCount } from '../config/pricing';
import { MIN_TRIALS_FOR_INFERENCE } from '../utils/statistics';

export interface TokenBudgetControllerProps {
  tokenBudget: number;
  onBudgetChange: (budget: number) => void;
  temperature: number;
  onTemperatureChange: (temperature: number) => void;
  model: string;
  onModelChange: (model: string) => void;
  judgeModel: string;
  onJudgeModelChange: (judgeModel: string) => void;
  numTrials: number;
  onNumTrialsChange: (numTrials: number) => void;
  promptPayloads: Record<ContextCondition, ConditionPromptPayload>;
  target: BenchmarkTarget;
  isRunning: boolean;
  onRunBenchmark: () => void;
  /** Live status text while a run is in flight. */
  progressMessage?: string;
}

/** Selectable context budgets, in tokens. */
const BUDGET_PRESETS = [250, 500, 750, 1000, 1500, 2000] as const;

/** Selectable trial counts, with the statistical consequence of each. */
const TRIAL_OPTIONS: { value: number; label: string; hint: string }[] = [
  {
    value: 1,
    label: '1',
    hint: 'Single pass. Descriptive only — no p-values or confidence intervals can be computed.',
  },
  {
    value: 3,
    label: '3',
    hint: 'Minimum for a significance test. Wide confidence intervals; treat results as provisional.',
  },
  {
    value: 5,
    label: '5',
    hint: 'Recommended. Enough for the t-test and the rank test to agree on a clear effect.',
  },
  {
    value: 10,
    label: '10',
    hint: 'Strongest evidence available here, at roughly ten times the cost and runtime.',
  },
];

/** Temperature presets. */
const TEMPERATURE_OPTIONS = [
  { value: 0.0, label: '0.0 (Deterministic)' },
  { value: 0.2, label: '0.2 (Recommended)' },
  { value: 0.5, label: '0.5 (Balanced)' },
  { value: 0.7, label: '0.7 (Exploratory)' },
  { value: 1.0, label: '1.0 (High variance)' },
];

/** The four arms, in display order. */
const ARM_ORDER: ContextCondition[] = [
  'code_only',
  'few_shot_control',
  'call_graph',
  'git_history',
];

/** Per-arm colour scheme for the allocation cards. */
const ARM_STYLES: Record<ContextCondition, { card: string; bar: string }> = {
  code_only: { card: 'bg-slate-50 border-slate-200', bar: 'bg-slate-600' },
  few_shot_control: { card: 'bg-indigo-50/50 border-indigo-200', bar: 'bg-indigo-600' },
  call_graph: { card: 'bg-emerald-50/50 border-emerald-200', bar: 'bg-emerald-600' },
  git_history: { card: 'bg-amber-50/50 border-amber-200', bar: 'bg-amber-500' },
};

const TokenBudgetControllerComponent: React.FC<TokenBudgetControllerProps> = ({
  tokenBudget,
  onBudgetChange,
  temperature,
  onTemperatureChange,
  model,
  onModelChange,
  judgeModel,
  onJudgeModelChange,
  numTrials,
  onNumTrialsChange,
  promptPayloads,
  target,
  isRunning,
  onRunBenchmark,
  progressMessage,
}) => {
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  /**
   * Draft slider value, updated continuously while dragging.
   *
   * The committed value (`tokenBudget`) is what drives prompt construction, so
   * the expensive rebuild happens on release rather than on every step.
   */
  const [draftBudget, setDraftBudget] = useState(tokenBudget);
  const [lastSeenBudget, setLastSeenBudget] = useState(tokenBudget);

  // Sync the draft when the committed value changes from outside (for example
  // when a historical run's parameters are copied in). Adjusting state during
  // render is React's recommended alternative to a syncing effect — it avoids
  // the extra render pass an effect would cause.
  if (tokenBudget !== lastSeenBudget) {
    setLastSeenBudget(tokenBudget);
    setDraftBudget(tokenBudget);
  }

  const hasUncommittedBudget = draftBudget !== tokenBudget;

  /** Commits the dragged value, triggering the prompt rebuild exactly once. */
  const commitBudget = () => {
    if (draftBudget !== tokenBudget) onBudgetChange(draftBudget);
  };

  /**
   * The budget actually applied, which may be below what the user requested.
   *
   * A target's call graph and commit history are finite. Once the requested
   * budget exceeds what they can supply, the effective budget is capped so the
   * arms stay length-matched — see `buildConditionPrompts`. Showing only the
   * requested figure would claim a 2000-token budget while delivering a few
   * hundred, and would hide the fact that raising the slider further does
   * nothing for this target.
   */
  const effectiveBudget = promptPayloads.call_graph?.tokenBudget ?? tokenBudget;
  const budgetLimitedBy = promptPayloads.call_graph?.budgetLimitedBy;
  const isBudgetCapped = budgetLimitedBy !== undefined;

  /** Per-arm token allocation for the preview cards. */
  const armMetrics = useMemo(
    () =>
      ARM_ORDER.map((condition) => {
        const payload = promptPayloads[condition];
        return {
          condition,
          title: payload?.title ?? condition,
          promptTokens: payload?.exactPromptTokens ?? 0,
          targetTokens: payload?.targetCodeTokensAllocated ?? 0,
          contextTokens: payload?.contextTokensAllocated ?? 0,
        };
      }),
    [promptPayloads]
  );

  /**
   * Full-session cost projection across all nine calls per trial.
   *
   * Recomputed when the budget, models or trial count change — not on every
   * render — because it walks the prompt payloads.
   */
  const costEstimate = useMemo(
    () =>
      estimateSessionCost({
        armPromptTokens: armMetrics.map((arm) => arm.promptTokens),
        targetCodeTokens: estimateTokenCount(target.targetCode),
        referenceDocstringTokens: estimateTokenCount(target.referenceDocstring),
        armContextTokens: armMetrics.map((arm) => arm.contextTokens),
        model,
        judgeModel,
        numTrials,
      }),
    [armMetrics, target, model, judgeModel, numTrials]
  );

  const selectedTrialOption =
    TRIAL_OPTIONS.find((option) => option.value === numTrials) ?? TRIAL_OPTIONS[1];

  const belowInferenceThreshold = numTrials < MIN_TRIALS_FOR_INFERENCE;

  return (
    <section
      id="token-budget-controller"
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4"
      aria-label="Run parameters"
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        {/* Token budget */}
        <div className="space-y-2 flex-1 min-w-0 lg:max-w-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-indigo-900" aria-hidden="true" />
              <label
                htmlFor="token-budget-range"
                className="text-xs font-bold uppercase tracking-widest text-slate-500"
              >
                Fixed context token budget
              </label>
            </div>
            <span
              className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-indigo-900 text-white"
              title={
                isBudgetCapped
                  ? `${effectiveBudget} tokens applied (capped from ${tokenBudget} by available context)`
                  : `${draftBudget} tokens applied to each context arm`
              }
            >
              {draftBudget} tokens
              {isBudgetCapped && !hasUncommittedBudget && (
                <span className="ml-1 text-amber-300">→ {effectiveBudget}</span>
              )}
            </span>
          </div>

          <input
            id="token-budget-range"
            type="range"
            min={250}
            max={2000}
            step={250}
            value={draftBudget}
            disabled={isRunning}
            onChange={(event) => setDraftBudget(Number(event.target.value))}
            // Commit on release (mouse/touch) and on keyboard blur, so the
            // expensive prompt rebuild runs once per settled value.
            onPointerUp={commitBudget}
            onKeyUp={commitBudget}
            onBlur={commitBudget}
            aria-describedby="token-budget-help"
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-semibold mr-1">Presets:</span>
            {BUDGET_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                id={`preset-budget-${preset}`}
                disabled={isRunning}
                onClick={() => {
                  setDraftBudget(preset);
                  onBudgetChange(preset);
                }}
                aria-pressed={tokenBudget === preset}
                className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-all cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                  tokenBudget === preset
                    ? 'bg-indigo-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {preset}
              </button>
            ))}
          </div>

          <p id="token-budget-help" className="text-[11px] text-slate-500">
            {hasUncommittedBudget ? (
              <span className="text-indigo-700 font-semibold">
                Release to apply {draftBudget} tokens.
              </span>
            ) : (
              <>Applied identically to all three context arms — this is the length control.</>
            )}
          </p>

          {/*
            When the cap bites, say so plainly. The alternative — displaying the
            requested budget as though it had been met — is what previously let
            the control arm carry twice the tokens of the treatment arms while
            the UI claimed the budgets were identical.
          */}
          {isBudgetCapped && !hasUncommittedBudget && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-950">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" aria-hidden="true" />
              <span>
                <strong className="font-bold">
                  Effective budget: {effectiveBudget} of {tokenBudget} requested.
                </strong>{' '}
                This target&apos;s{' '}
                {budgetLimitedBy === 'call_graph' ? 'call-graph' : 'commit-history'} context
                cannot fill {tokenBudget} tokens, so all three arms are capped to{' '}
                {effectiveBudget} to keep them length-matched. Raising the budget further will
                not change this run.
              </span>
            </p>
          )}
        </div>

        {/* Trials */}
        <fieldset className="space-y-1.5 min-w-0">
          <legend className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
            <Repeat className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            Paired trials
          </legend>

          <div className="flex items-center gap-1.5" role="group" aria-label="Number of trials">
            {TRIAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isRunning}
                onClick={() => onNumTrialsChange(option.value)}
                aria-pressed={numTrials === option.value}
                title={option.hint}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                  numTrials === option.value
                    ? 'bg-indigo-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p
            className={`text-[11px] max-w-[15rem] ${
              belowInferenceThreshold ? 'text-amber-700 font-semibold' : 'text-slate-500'
            }`}
          >
            {selectedTrialOption.hint}
          </p>
        </fieldset>

        {/* Models and temperature */}
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <label
              htmlFor="select-temperature"
              className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
            >
              Temperature
            </label>
            <select
              id="select-temperature"
              value={temperature}
              disabled={isRunning}
              onChange={(event) => onTemperatureChange(Number(event.target.value))}
              className="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-600 focus:outline-hidden disabled:opacity-50"
            >
              {TEMPERATURE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="select-model-name"
              className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
            >
              Generator model
            </label>
            <select
              id="select-model-name"
              value={model}
              disabled={isRunning}
              onChange={(event) => onModelChange(event.target.value)}
              className="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-600 focus:outline-hidden disabled:opacity-50"
            >
              {GEMINI_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id} ({option.tier})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="select-judge-model"
              className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
            >
              Judge model
            </label>
            <select
              id="select-judge-model"
              value={judgeModel}
              disabled={isRunning}
              onChange={(event) => onJudgeModelChange(event.target.value)}
              aria-describedby="judge-model-help"
              className="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-600 focus:outline-hidden disabled:opacity-50"
            >
              {GEMINI_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                </option>
              ))}
            </select>
            <p id="judge-model-help" className="sr-only">
              Using a different model to judge than to generate reduces self-preference bias.
            </p>
          </div>
        </div>

        {/* Run */}
        <div className="shrink-0">
          <button
            id="run-benchmark-btn"
            type="button"
            disabled={isRunning}
            onClick={onRunBenchmark}
            aria-busy={isRunning}
            className={`w-full lg:w-auto inline-flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md ${
              isRunning
                ? 'bg-slate-800 text-slate-300 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98 shadow-indigo-200 cursor-pointer'
            } focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2`}
          >
            {isRunning ? (
              <>
                <span
                  className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                  aria-hidden="true"
                />
                <span className="truncate max-w-[12rem]">
                  {progressMessage ?? 'Running…'}
                </span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                <span>
                  Run {numTrials} {numTrials === 1 ? 'trial' : 'trials'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cost and allocation */}
      <div className="pt-3 border-t border-slate-100 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            Prompt allocation &amp; projected session cost
          </span>

          <div className="flex items-center gap-3 text-[11px]">
            <span
              id="estimated-token-cost-display"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 font-mono"
              title={`${costEstimate.totalCalls} API calls across ${numTrials} trial(s). Approximate: derived from the local token heuristic at ₹${(USD_TO_INR).toFixed(2)}/USD.`}
            >
              <Coins className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span className="font-extrabold text-slate-900">
                ~{formatINR(costEstimate.totalINR)}
              </span>
              <span className="text-slate-500">
                / {costEstimate.totalCalls} calls
              </span>
            </span>

            <button
              type="button"
              id="toggle-cost-details-btn"
              onClick={() => setShowCostBreakdown((open) => !open)}
              aria-expanded={showCostBreakdown}
              aria-controls="cost-breakdown-panel"
              className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 rounded px-1"
            >
              {showCostBreakdown ? 'Hide cost detail' : 'Cost detail'}
            </button>
          </div>
        </div>

        {showCostBreakdown && (
          <div
            id="cost-breakdown-panel"
            className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2"
          >
            <p className="flex items-start gap-1.5 text-[11px] text-slate-600">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" aria-hidden="true" />
              <span>
                Estimated from the local token heuristic, not measured — actual billing will
                differ. Converted at an approximate ₹{USD_TO_INR.toFixed(2)}/USD.
              </span>
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono min-w-[30rem]">
                <caption className="sr-only">
                  Projected cost by API call type for {numTrials} trials
                </caption>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th scope="col" className="py-1 pr-2 font-semibold">Call type</th>
                    <th scope="col" className="py-1 px-2 font-semibold text-right">Calls</th>
                    <th scope="col" className="py-1 px-2 font-semibold text-right">In</th>
                    <th scope="col" className="py-1 px-2 font-semibold text-right">Out</th>
                    <th scope="col" className="py-1 pl-2 font-semibold text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
                  {costEstimate.lines.map((line) => (
                    <tr key={line.label} className="border-t border-slate-200">
                      <td className="py-1 pr-2 font-sans">{line.label}</td>
                      <td className="py-1 px-2 text-right">{line.calls}</td>
                      <td className="py-1 px-2 text-right">
                        {line.inputTokens.toLocaleString()}
                      </td>
                      <td className="py-1 px-2 text-right">
                        {line.outputTokens.toLocaleString()}
                      </td>
                      <td className="py-1 pl-2 text-right">
                        {line.unpriced ? (
                          <span className="text-slate-400" title="Embeddings are not billed from the generation price table">
                            not priced
                          </span>
                        ) : (
                          formatINR(line.costINR)
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 font-bold">
                    <td className="py-1 pr-2 font-sans">
                      Total ({numTrials} {numTrials === 1 ? 'trial' : 'trials'})
                    </td>
                    <td className="py-1 px-2 text-right">{costEstimate.totalCalls}</td>
                    <td className="py-1 px-2 text-right">
                      {costEstimate.totalInputTokens.toLocaleString()}
                    </td>
                    <td className="py-1 px-2 text-right">
                      {costEstimate.totalOutputTokens.toLocaleString()}
                    </td>
                    <td className="py-1 pl-2 text-right text-emerald-800">
                      {formatINR(costEstimate.totalINR)}
                    </td>
                  </tr>
                  <tr className="text-slate-500">
                    <td className="py-1 pr-2 font-sans" colSpan={4}>
                      Per trial
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {formatINR(costEstimate.perTrialINR)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {armMetrics.map((arm) => {
            const styles = ARM_STYLES[arm.condition];
            const promptTokens = arm.promptTokens || 1;

            return (
              <div
                key={arm.condition}
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${styles.card}`}
              >
                <div className="flex items-center justify-between font-bold gap-2">
                  <span className="truncate text-slate-800">{arm.title}</span>
                  <span className="font-mono text-slate-900 shrink-0">
                    {arm.promptTokens} tok
                  </span>
                </div>

                {/* Stacked bar: target code versus injected context. */}
                <div
                  className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex"
                  role="img"
                  aria-label={`${arm.title}: ${arm.targetTokens} target code tokens, ${arm.contextTokens} context tokens`}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (arm.targetTokens / promptTokens) * 100)}%`,
                    }}
                    className="bg-slate-600 h-full"
                  />
                  {arm.contextTokens > 0 && (
                    <div
                      style={{
                        width: `${Math.min(100, (arm.contextTokens / promptTokens) * 100)}%`,
                      }}
                      className={`${styles.bar} h-full`}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Code: {arm.targetTokens}t</span>
                  <span className="font-semibold text-slate-700">
                    Ctx: {arm.contextTokens}t
                    {arm.condition === 'code_only' ? ' (floor)' : ` / ${effectiveBudget}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/**
 * Memoized so that unrelated parent state (toasts, modal open/close, progress
 * ticks) does not re-render the controller and its cost table.
 */
export const TokenBudgetController = memo(TokenBudgetControllerComponent);
