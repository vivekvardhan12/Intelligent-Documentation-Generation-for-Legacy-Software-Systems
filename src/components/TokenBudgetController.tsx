import React, { useState, useMemo } from 'react';
import { ConditionPromptPayload, ContextCondition } from '../types';
import { Play, Sliders, CheckSquare, Layers, Clock, Zap, ArrowRight, Coins, Info, HelpCircle } from 'lucide-react';

interface TokenBudgetControllerProps {
  tokenBudget: number;
  onBudgetChange: (budget: number) => void;
  temperature: number;
  onTemperatureChange: (temp: number) => void;
  model: string;
  onModelChange: (model: string) => void;
  numTrials?: number;
  onNumTrialsChange?: (trials: number) => void;
  judgeModel?: string;
  onJudgeModelChange?: (judgeModel: string) => void;
  promptPayloads: Record<ContextCondition, ConditionPromptPayload>;
  isRunning: boolean;
  onRunBenchmark: () => void;
  currentStep: 'idle' | 'generating' | 'evaluating' | 'completed';
  activeTrial?: number;
  totalTrials?: number;
}

interface ModelPricingConfig {
  inputPerMillionUSD: number;
  outputPerMillionUSD: number;
  displayName: string;
}

const MODEL_PRICING: Record<string, ModelPricingConfig> = {
  'gemini-3.7-flash': {
    inputPerMillionUSD: 0.10, // $0.10 per 1M prompt tokens
    outputPerMillionUSD: 0.40, // $0.40 per 1M output tokens
    displayName: 'Gemini 3.7 Flash',
  },
  'gemini-3.1-flash-lite': {
    inputPerMillionUSD: 0.075, // $0.075 per 1M prompt tokens
    outputPerMillionUSD: 0.30, // $0.30 per 1M output tokens
    displayName: 'Gemini 3.1 Flash-Lite',
  },
};

const DEFAULT_PRICING: ModelPricingConfig = {
  inputPerMillionUSD: 0.10,
  outputPerMillionUSD: 0.40,
  displayName: 'Gemini Flash',
};

export const TokenBudgetController: React.FC<TokenBudgetControllerProps> = ({
  tokenBudget,
  onBudgetChange,
  temperature,
  onTemperatureChange,
  model,
  onModelChange,
  numTrials = 5,
  onNumTrialsChange,
  judgeModel = 'gemini-3.7-flash',
  onJudgeModelChange,
  promptPayloads,
  isRunning,
  onRunBenchmark,
  currentStep,
  activeTrial = 1,
  totalTrials = 5,
}) => {
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  const [showCostBreakdownModal, setShowCostBreakdownModal] = useState(false);

  const budgetOptions = [250, 500, 750, 1000, 1500, 2000];

  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;

  // 4 concurrent conditions
  const conditions: ContextCondition[] = ['code_only', 'few_shot_control', 'call_graph', 'git_history'];

  // Token consumption metrics per arm
  const armMetrics = useMemo(() => {
    return conditions.map((cond) => {
      const payload = promptPayloads[cond];
      const promptTok = payload?.exactPromptTokens || 0;
      const targetTok = payload?.targetCodeTokensAllocated || 0;
      const ctxTok = payload?.contextTokensAllocated || 0;
      // An average generated docstring is ~75 output tokens
      const estOutputTok = 75;
      const totalArmTok = promptTok + estOutputTok;

      // Cost calculation in USD and cents
      const armInputCostUSD = (promptTok * pricing.inputPerMillionUSD) / 1_000_000;
      const armOutputCostUSD = (estOutputTok * pricing.outputPerMillionUSD) / 1_000_000;
      const armTotalCostUSD = armInputCostUSD + armOutputCostUSD;
      const armCostCents = armTotalCostUSD * 100;

      return {
        condition: cond,
        title: payload?.title || cond,
        promptTok,
        targetTok,
        ctxTok,
        estOutputTok,
        totalArmTok,
        armCostCents,
        armTotalCostUSD,
      };
    });
  }, [promptPayloads, pricing]);

  // Aggregate consumption across the four concurrent prompt requests (single trial)
  const totalPromptTokens = useMemo(() => {
    return armMetrics.reduce((sum, arm) => sum + arm.promptTok, 0);
  }, [armMetrics]);

  const totalOutputTokens = useMemo(() => {
    return armMetrics.reduce((sum, arm) => sum + arm.estOutputTok, 0);
  }, [armMetrics]);

  const totalCombinedTokensPerTrial = totalPromptTokens + totalOutputTokens;
  const sessionMultiplier = numTrials || 1;
  const totalSessionTokens = totalCombinedTokensPerTrial * sessionMultiplier;

  // Aggregate cost calculations
  const totalPromptCostUSD = (totalPromptTokens * pricing.inputPerMillionUSD) / 1_000_000;
  const totalOutputCostUSD = (totalOutputTokens * pricing.outputPerMillionUSD) / 1_000_000;
  const singleTrialCostUSD = totalPromptCostUSD + totalOutputCostUSD;
  const totalSessionCostUSD = singleTrialCostUSD * sessionMultiplier;

  // Cost in cents (¢): 1 USD = 100 cents
  const totalCostCents = totalSessionCostUSD * 100;
  const singleTrialCostCents = singleTrialCostUSD * 100;
  const promptCostCents = totalPromptCostUSD * 100 * sessionMultiplier;
  const outputCostCents = totalOutputCostUSD * 100 * sessionMultiplier;

  // Approximate runs achievable per $1.00 USD
  const runsPerDollar = totalSessionCostUSD > 0 ? Math.floor(1 / totalSessionCostUSD) : 0;

  return (
    <div id="token-budget-controller" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top Controller Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Token Budget Control */}
        <div className="space-y-2 flex-1 max-w-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-indigo-900" />
              <label htmlFor="token-budget-range" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Fixed Context Token Budget
              </label>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-indigo-900 text-white shadow-2xs">
              {tokenBudget} tokens
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <input
              id="token-budget-range"
              type="range"
              min={250}
              max={2000}
              step={250}
              value={tokenBudget}
              disabled={isRunning}
              onChange={(e) => onBudgetChange(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:opacity-50"
            />
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-slate-400 font-semibold mr-1">Presets:</span>
            {budgetOptions.map((b) => (
              <button
                key={b}
                id={`preset-budget-${b}`}
                disabled={isRunning}
                onClick={() => onBudgetChange(b)}
                className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-all ${
                  tokenBudget === b
                    ? 'bg-indigo-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                } disabled:opacity-50`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* Middle: Secondary Configs & Estimated Token Cost Display */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Paired Trials Selector */}
          <div>
            <label htmlFor="select-trials-count" className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Paired Trials (N)
            </label>
            <div id="select-trials-count" className="flex items-center space-x-1">
              {[3, 5, 10].map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onNumTrialsChange && onNumTrialsChange(t)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded-md border transition-all ${
                    numTrials === t
                      ? 'bg-indigo-900 text-white border-indigo-950 shadow-2xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  } disabled:opacity-50 cursor-pointer`}
                >
                  {t}x
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="select-temperature" className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Temperature
            </label>
            <select
              id="select-temperature"
              value={temperature}
              disabled={isRunning}
              onChange={(e) => onTemperatureChange(Number(e.target.value))}
              className="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-600 focus:outline-hidden disabled:opacity-50 shadow-2xs"
            >
              <option value={0.0}>0.0 (Deterministic)</option>
              <option value={0.2}>0.2 (Recommended)</option>
              <option value={0.5}>0.5 (Balanced)</option>
              <option value={0.7}>0.7 (Exploratory)</option>
            </select>
          </div>

          <div>
            <label htmlFor="select-model-name" className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Benchmark Model
            </label>
            <select
              id="select-model-name"
              value={model}
              disabled={isRunning}
              onChange={(e) => onModelChange(e.target.value)}
              className="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-600 focus:outline-hidden disabled:opacity-50 shadow-2xs"
            >
              <option value="gemini-3.7-flash">gemini-3.7-flash (Default)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast)</option>
            </select>
          </div>

          {/* Dedicated Estimated Token Cost Display */}
          <div
            id="estimated-token-cost-display"
            className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/90 flex items-center space-x-3 shadow-2xs"
            title={`${pricing.displayName}: $${pricing.inputPerMillionUSD}/1M input, $${pricing.outputPerMillionUSD}/1M output. Session cost (${numTrials} trials): ~${totalCostCents.toFixed(4)}¢`}
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-100/90 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                  Estimated Token Cost
                </span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {numTrials * 4} Requests ({numTrials} Trials)
                </span>
              </div>
              <div className="flex items-baseline space-x-1.5 font-mono">
                <span className="text-sm font-extrabold text-slate-900">
                  ~{totalCostCents < 0.01 ? totalCostCents.toFixed(4) : totalCostCents.toFixed(3)}¢
                </span>
                <span className="text-[10px] text-slate-500 font-sans">
                  ({totalSessionTokens.toLocaleString()} tok)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Primary Run Button */}
        <div className="shrink-0 flex items-center">
          <button
            id="run-benchmark-btn"
            disabled={isRunning}
            onClick={onRunBenchmark}
            className={`w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md ${
              isRunning
                ? 'bg-slate-800 text-slate-300 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98 shadow-indigo-200 cursor-pointer'
            }`}
          >
            {isRunning ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>
                  Trial {activeTrial} of {totalTrials}:{' '}
                  {currentStep === 'generating'
                    ? 'Generating 4 Arms...'
                    : 'Double-Blind Judging...'}
                </span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Paired Benchmark ({numTrials} Trials)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Token Budget Balance Inspector & Cost Breakdown Ribbon */}
      <div className="pt-3 border-t border-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Prompt Token Allocation & Cost Breakdown (4 Concurrent Arms):</span>
          </span>

          <div className="flex items-center space-x-3 text-[11px]">
            <span className="font-mono text-slate-500 hidden sm:inline">
              Rate: <span className="font-semibold text-slate-700">${pricing.inputPerMillionUSD}/M prompt</span>
            </span>
            <button
              type="button"
              id="toggle-cost-details-btn"
              onClick={() => setShowCostBreakdownModal(!showCostBreakdownModal)}
              className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center space-x-1 cursor-pointer"
            >
              <Coins className="w-3 h-3 text-indigo-600" />
              <span>{showCostBreakdownModal ? 'Hide Cost Math' : 'Cost Breakdown Details'}</span>
            </button>
          </div>
        </div>

        {/* Expandable Cost Math Details */}
        {showCostBreakdownModal && (
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-2 text-[11px]">
              <div>
                <span className="font-bold text-slate-800">{pricing.displayName} Pricing Formula</span>
                <span className="text-slate-500 ml-2">
                  (Input: ${pricing.inputPerMillionUSD}/M tokens | Output: ${pricing.outputPerMillionUSD}/M tokens)
                </span>
              </div>
              <span className="text-emerald-700 font-bold">
                Total Benchmark Cost: ~{totalCostCents.toFixed(4)}¢ (${totalSessionCostUSD.toFixed(6)})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="bg-white p-2 rounded border border-slate-200">
                <span className="text-slate-500 block text-[10px]">Prompt Tokens (4 Requests)</span>
                <span className="font-bold text-slate-800">{totalPromptTokens.toLocaleString()} tok</span>
                <span className="text-slate-500 block text-[10px] mt-0.5">
                  Cost: ~{promptCostCents.toFixed(4)}¢
                </span>
              </div>
              <div className="bg-white p-2 rounded border border-slate-200">
                <span className="text-slate-500 block text-[10px]">Est. Output Docstrings (4)</span>
                <span className="font-bold text-slate-800">~{totalOutputTokens.toLocaleString()} tok</span>
                <span className="text-slate-500 block text-[10px] mt-0.5">
                  Cost: ~{outputCostCents.toFixed(4)}¢
                </span>
              </div>
              <div className="bg-white p-2 rounded border border-emerald-200 bg-emerald-50/30">
                <span className="text-emerald-800 block text-[10px] font-bold">Execution Efficiency</span>
                <span className="font-bold text-emerald-950">~{runsPerDollar.toLocaleString()} runs</span>
                <span className="text-emerald-700 block text-[10px] mt-0.5">per $1.00 USD spent</span>
              </div>
            </div>
          </div>
        )}

        {/* 4-Arm Allocation Cards with per-arm cost tag */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {armMetrics.map((arm) => {
            const isControlOrTreatment = arm.condition !== 'code_only';

            return (
              <div
                key={arm.condition}
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                  arm.condition === 'code_only'
                    ? 'bg-slate-50 border-slate-200'
                    : arm.condition === 'few_shot_control'
                    ? 'bg-indigo-50/50 border-indigo-200'
                    : arm.condition === 'call_graph'
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : 'bg-amber-50/50 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span className="truncate text-slate-800">{arm.title}</span>
                  <div className="flex items-center space-x-1.5 font-mono">
                    <span className="text-slate-900">{arm.promptTok} tok</span>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                      ~{arm.armCostCents.toFixed(4)}¢
                    </span>
                  </div>
                </div>

                {/* Progress bar breakdown */}
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${Math.min(100, (arm.targetTok / (arm.promptTok || 1)) * 100)}%` }}
                    className="bg-slate-600 h-full"
                    title={`Target code: ~${arm.targetTok} tokens`}
                  />
                  {arm.ctxTok > 0 && (
                    <div
                      style={{ width: `${Math.min(100, (arm.ctxTok / (arm.promptTok || 1)) * 100)}%` }}
                      className={
                        arm.condition === 'few_shot_control'
                          ? 'bg-indigo-600 h-full'
                          : arm.condition === 'call_graph'
                          ? 'bg-emerald-600 h-full'
                          : 'bg-amber-500 h-full'
                      }
                      title={`Context allocation: ~${arm.ctxTok} tokens`}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Code: {arm.targetTok}t</span>
                  <span className="font-semibold text-slate-700">
                    Ctx: {arm.ctxTok}t {isControlOrTreatment ? `(= ${tokenBudget})` : '(0)'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

