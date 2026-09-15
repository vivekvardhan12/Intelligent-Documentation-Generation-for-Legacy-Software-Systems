/**
 * Cost Estimation — client-side spend projection for a benchmark session.
 *
 * WHY THIS FILE EXISTS
 * The old estimator (inline in TokenBudgetController) counted only the four
 * docstring-GENERATION calls. A single benchmark trial actually issues nine
 * billed requests:
 *
 *   4x generate    — one per experimental arm
 *   1x blind judge — re-sends the target code, the reference docstring AND all
 *                    four candidate docstrings, so it is the single largest
 *                    prompt in the whole run
 *   4x factuality  — one per arm, each re-sending that arm's context evidence
 *   1x embedding   — five texts for the semantic-similarity metric
 *
 * Counting only the first four understated real spend several-fold, and the
 * figure was never multiplied by the trial count. Since the trials control now
 * lets a user launch a 10-trial run (~90 billed calls), an honest estimate
 * matters: it is the only warning before the money is spent.
 *
 * Every number below is an ESTIMATE derived from the token heuristic, not a
 * measurement. The UI labels it as such.
 */

import { estimateTokenCount } from '../utils/tokenCounter';
import { getModelConfig } from './models';

/**
 * USD to INR conversion.
 *
 * Hardcoding a rate is unavoidable without a live FX feed, but it is now
 * overridable at build time (`VITE_USD_TO_INR=88.5 npm run build`) and labelled
 * as approximate everywhere it is displayed, rather than being described in a
 * comment as "the standard exchange rate".
 */
export const USD_TO_INR: number = Number(import.meta.env?.VITE_USD_TO_INR) || 87.0;

/**
 * Typical length of a generated docstring, in tokens.
 * Used where we must predict an output size before the call is made.
 */
export const AVG_DOCSTRING_OUTPUT_TOKENS = 75;

/**
 * Fixed size of the blind-judge rubric: the scoring criteria, the framing
 * paragraphs and the JSON schema instructions in `/api/gemini/evaluate-blind-arms`.
 * Measured once against the prompt template in server.ts.
 */
const JUDGE_RUBRIC_OVERHEAD_TOKENS = 480;

/** Structured evaluation output per candidate (scores + critique + arrays). */
const JUDGE_OUTPUT_TOKENS_PER_CANDIDATE = 120;

/** Fixed framing text in the factuality prompt, excluding the evidence itself. */
const FACTUALITY_PROMPT_OVERHEAD_TOKENS = 180;

/** Typical claim-list JSON returned by a factuality check. */
const FACTUALITY_OUTPUT_TOKENS = 220;

/**
 * Embeddings are billed differently from generation (and are free on several
 * tiers). Rather than mis-apply the generation price table, we count the tokens
 * for transparency and price them at zero, flagged in the UI.
 */
const EMBEDDING_COST_PER_MILLION_USD = 0;

/** One row of the cost table: a group of calls of the same kind. */
export interface CostBreakdownLine {
  /** What these calls do, e.g. 'Docstring generation (4 arms)'. */
  label: string;
  /** How many API requests this line represents across the whole session. */
  calls: number;
  /** Total prompt tokens billed for this line. */
  inputTokens: number;
  /** Total completion tokens billed for this line. */
  outputTokens: number;
  /** Line cost in US dollars. */
  costUSD: number;
  /** Line cost converted at USD_TO_INR. */
  costINR: number;
  /** Set when the line is counted but not priced (embeddings). */
  unpriced?: boolean;
}

/** Complete projection for a session, plus the per-trial unit cost. */
export interface SessionCostEstimate {
  lines: CostBreakdownLine[];
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUSD: number;
  totalINR: number;
  /** Cost of a single trial, i.e. the session total divided by trial count. */
  perTrialUSD: number;
  perTrialINR: number;
  /** How many trials this projection covers. */
  numTrials: number;
}

/** Inputs needed to project a session's spend. */
export interface SessionCostInput {
  /** Prompt token count for each arm, in arm order. */
  armPromptTokens: number[];
  /** The function under test — sent in generation, judging and factuality. */
  targetCodeTokens: number;
  /** Gold docstring — sent to the judge for calibration. */
  referenceDocstringTokens: number;
  /** Per-arm repository context, re-sent to each factuality check. */
  armContextTokens: number[];
  /** Model generating the docstrings. */
  model: string;
  /** Model judging them (may differ from `model`). */
  judgeModel: string;
  /** Number of paired trials in the session. */
  numTrials: number;
}

/** Converts a token count and a per-million rate into dollars. */
function tokensToUSD(tokens: number, perMillionUSD: number): number {
  return (tokens * perMillionUSD) / 1_000_000;
}

/**
 * Projects the total billed cost of a benchmark session across all nine call
 * types per trial.
 *
 * Complexity is O(arms) — trivial — so this is safe to recompute on render,
 * though callers memoize it because its inputs come from prompt construction.
 */
export function estimateSessionCost(input: SessionCostInput): SessionCostEstimate {
  const {
    armPromptTokens,
    targetCodeTokens,
    referenceDocstringTokens,
    armContextTokens,
    model,
    judgeModel,
    numTrials,
  } = input;

  const genPricing = getModelConfig(model);
  const judgePricing = getModelConfig(judgeModel);
  const armCount = armPromptTokens.length;
  const trials = Math.max(1, numTrials);

  // 1. Generation: one call per arm, each billing its own prompt.
  const genInputPerTrial = armPromptTokens.reduce((sum, t) => sum + t, 0);
  const genOutputPerTrial = armCount * AVG_DOCSTRING_OUTPUT_TOKENS;
  const generationLine: CostBreakdownLine = {
    label: `Docstring generation (${armCount} arms)`,
    calls: armCount * trials,
    inputTokens: genInputPerTrial * trials,
    outputTokens: genOutputPerTrial * trials,
    costUSD:
      tokensToUSD(genInputPerTrial * trials, genPricing.inputPerMillionUSD) +
      tokensToUSD(genOutputPerTrial * trials, genPricing.outputPerMillionUSD),
    costINR: 0,
  };

  // 2. Blind judge: ONE call, but it carries the rubric, the target code, the
  //    reference docstring and every candidate docstring at once.
  const judgeInputPerTrial =
    JUDGE_RUBRIC_OVERHEAD_TOKENS +
    targetCodeTokens +
    referenceDocstringTokens +
    armCount * AVG_DOCSTRING_OUTPUT_TOKENS;
  const judgeOutputPerTrial = armCount * JUDGE_OUTPUT_TOKENS_PER_CANDIDATE;
  const judgeLine: CostBreakdownLine = {
    label: 'Blind judge evaluation (1 call, all candidates)',
    calls: trials,
    inputTokens: judgeInputPerTrial * trials,
    outputTokens: judgeOutputPerTrial * trials,
    costUSD:
      tokensToUSD(judgeInputPerTrial * trials, judgePricing.inputPerMillionUSD) +
      tokensToUSD(judgeOutputPerTrial * trials, judgePricing.outputPerMillionUSD),
    costINR: 0,
  };

  // 3. Factuality: one call per arm, each re-sending that arm's evidence so the
  //    claim check is isolated to what that arm was actually shown.
  const factualityInputPerTrial = armContextTokens.reduce(
    (sum, ctxTokens) =>
      sum +
      FACTUALITY_PROMPT_OVERHEAD_TOKENS +
      AVG_DOCSTRING_OUTPUT_TOKENS +
      targetCodeTokens +
      ctxTokens,
    0
  );
  const factualityOutputPerTrial = armCount * FACTUALITY_OUTPUT_TOKENS;
  const factualityLine: CostBreakdownLine = {
    label: `Factuality claim checks (${armCount} arms)`,
    calls: armCount * trials,
    inputTokens: factualityInputPerTrial * trials,
    outputTokens: factualityOutputPerTrial * trials,
    costUSD:
      tokensToUSD(factualityInputPerTrial * trials, judgePricing.inputPerMillionUSD) +
      tokensToUSD(factualityOutputPerTrial * trials, judgePricing.outputPerMillionUSD),
    costINR: 0,
  };

  // 4. Embeddings: the reference docstring plus one per candidate.
  const embedInputPerTrial =
    referenceDocstringTokens + armCount * AVG_DOCSTRING_OUTPUT_TOKENS;
  const embeddingLine: CostBreakdownLine = {
    label: 'Semantic similarity embeddings',
    calls: trials,
    inputTokens: embedInputPerTrial * trials,
    outputTokens: 0,
    costUSD: tokensToUSD(embedInputPerTrial * trials, EMBEDDING_COST_PER_MILLION_USD),
    costINR: 0,
    unpriced: true,
  };

  const lines = [generationLine, judgeLine, factualityLine, embeddingLine];
  for (const line of lines) {
    line.costINR = line.costUSD * USD_TO_INR;
  }

  const totalUSD = lines.reduce((sum, l) => sum + l.costUSD, 0);

  return {
    lines,
    totalCalls: lines.reduce((sum, l) => sum + l.calls, 0),
    totalInputTokens: lines.reduce((sum, l) => sum + l.inputTokens, 0),
    totalOutputTokens: lines.reduce((sum, l) => sum + l.outputTokens, 0),
    totalUSD,
    totalINR: totalUSD * USD_TO_INR,
    perTrialUSD: totalUSD / trials,
    perTrialINR: (totalUSD * USD_TO_INR) / trials,
    numTrials: trials,
  };
}

/**
 * Formats a rupee amount for display, widening precision for sub-paisa figures
 * so a cheap run does not render as a misleading "₹0.00".
 */
export function formatINR(amount: number): string {
  if (amount < 0.01) return `₹${amount.toFixed(4)}`;
  if (amount < 1) return `₹${amount.toFixed(3)}`;
  return `₹${amount.toFixed(2)}`;
}

/** Convenience helper for estimating a token count from raw text. */
export { estimateTokenCount };
