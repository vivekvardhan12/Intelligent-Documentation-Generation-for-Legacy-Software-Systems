/**
 * Illustrative demo dataset.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS QUARANTINED HERE
 * A dashboard full of empty charts is a poor first impression, so the app
 * offers a sample dataset. But the previous implementation seeded that sample
 * straight into the live results on boot, indistinguishable from a real run:
 * authored docstrings, authored scores, and authored statistics including
 * `pValuetTest: 0.0003` and `'SIGNIFICANT POSITIVE LIFT'` that no code had ever
 * computed. A user could open the app, click Export, and receive a
 * publication-ready LaTeX table of numbers that were typed by hand.
 *
 * Three rules now apply to demo data:
 *
 *  1. It is OPT-IN. The app boots to an empty state; the user asks for it.
 *  2. It is FLAGGED. `isDemoData: true` propagates to the session, the run, the
 *     history list and every export, which carry a visible badge and header.
 *  3. Its statistics are REAL. Only the per-dimension judge scores are authored
 *     here; the means, confidence intervals, t-tests, Wilcoxon tests, Holm
 *     correction and verdict are all computed by the production statistics code
 *     via `MultiTrialRunner.buildSession`. Nothing in the output is a typed-in
 *     p-value, and if the statistical code changes, the demo changes with it.
 */

import { BenchmarkTarget, ContextCondition, DetailedTokenCounts, RawTrialResult } from '../types';
import { DEFAULT_JUDGE_MODEL, DEFAULT_MODEL } from '../config/models';
import { MultiTrialRunner } from '../utils/multiTrialRunner';
import { MultiTrialExperimentSession } from '../types';

/** Token budget the demo session illustrates. */
export const DEMO_TOKEN_BUDGET = 750;

/**
 * Trials in the demo session.
 *
 * Five rather than the bare minimum of three, because three trials is where
 * inference becomes *possible*, not where it becomes *sound*. At n = 3 the
 * Wilcoxon signed-rank test cannot return a two-sided p below 0.25 no matter
 * how large the effect, so a three-trial demo would show a significant t-test
 * beside a non-significant rank test and teach the wrong lesson. Five is the
 * smallest sample where both tests can agree, and it matches what the UI
 * recommends to users.
 */
const DEMO_TRIAL_COUNT = 5;

/**
 * Composite quality score from the four rubric dimensions.
 *
 * Uses the exact weighting the judge prompt specifies
 * (0.35 accuracy + 0.25 param/return + 0.25 intent + 0.15 hallucination) x 10,
 * so the demo's composites are internally consistent with its dimensions rather
 * than being independently invented numbers.
 */
function composite(
  accuracy: number,
  paramReturn: number,
  intent: number,
  hallucination: number
): number {
  return Number(
    (
      (0.35 * accuracy + 0.25 * paramReturn + 0.25 * intent + 0.15 * hallucination) *
      10
    ).toFixed(1)
  );
}

/** Authored per-dimension scores for one arm in one trial. */
interface DemoScore {
  accuracy: number;
  paramReturn: number;
  intent: number;
  hallucination: number;
  bleu: number;
  rouge: number;
  semantic: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * Authored scores, three trials per arm.
 *
 * The pattern these illustrate is the experiment's expected finding: the floor
 * scores lowest, the length-matched control gains mostly on formatting
 * (paramReturn) while barely moving on intent, and the two repository-context
 * arms gain sharply on intent — the dimension that captures the hidden 'why'.
 *
 * Values deliberately vary between trials. Identical scores across trials would
 * produce zero variance, which makes a t-statistic undefined, and the
 * statistics module would correctly refuse to report significance — leaving the
 * demo unable to demonstrate the very analysis it exists to show.
 */
const DEMO_SCORES: Record<ContextCondition, DemoScore[]> = {
  code_only: [
    { accuracy: 8.8, paramReturn: 8.5, intent: 5.2, hallucination: 9.5, bleu: 0.42, rouge: 0.58, semantic: 0.74, outputTokens: 68, latencyMs: 840 },
    { accuracy: 8.3, paramReturn: 8.2, intent: 4.6, hallucination: 9.4, bleu: 0.38, rouge: 0.54, semantic: 0.71, outputTokens: 61, latencyMs: 812 },
    { accuracy: 8.9, paramReturn: 8.7, intent: 5.6, hallucination: 9.6, bleu: 0.45, rouge: 0.61, semantic: 0.76, outputTokens: 72, latencyMs: 875 },
    { accuracy: 8.5, paramReturn: 8.0, intent: 4.8, hallucination: 9.3, bleu: 0.39, rouge: 0.55, semantic: 0.72, outputTokens: 63, latencyMs: 798 },
    { accuracy: 9.0, paramReturn: 8.8, intent: 5.4, hallucination: 9.5, bleu: 0.44, rouge: 0.60, semantic: 0.75, outputTokens: 70, latencyMs: 863 },
  ],
  few_shot_control: [
    { accuracy: 9.2, paramReturn: 9.4, intent: 6.8, hallucination: 9.6, bleu: 0.53, rouge: 0.67, semantic: 0.83, outputTokens: 98, latencyMs: 921 },
    { accuracy: 8.7, paramReturn: 9.0, intent: 6.0, hallucination: 9.5, bleu: 0.48, rouge: 0.62, semantic: 0.79, outputTokens: 89, latencyMs: 884 },
    { accuracy: 9.3, paramReturn: 9.5, intent: 7.0, hallucination: 9.7, bleu: 0.55, rouge: 0.69, semantic: 0.84, outputTokens: 101, latencyMs: 943 },
    { accuracy: 8.6, paramReturn: 8.9, intent: 5.8, hallucination: 9.4, bleu: 0.46, rouge: 0.60, semantic: 0.78, outputTokens: 86, latencyMs: 871 },
    { accuracy: 9.1, paramReturn: 9.3, intent: 6.5, hallucination: 9.6, bleu: 0.51, rouge: 0.65, semantic: 0.81, outputTokens: 95, latencyMs: 908 },
  ],
  call_graph: [
    { accuracy: 9.6, paramReturn: 9.6, intent: 9.4, hallucination: 9.8, bleu: 0.70, rouge: 0.79, semantic: 0.93, outputTokens: 124, latencyMs: 967 },
    { accuracy: 9.4, paramReturn: 9.4, intent: 8.9, hallucination: 9.7, bleu: 0.67, rouge: 0.76, semantic: 0.91, outputTokens: 119, latencyMs: 951 },
    { accuracy: 9.4, paramReturn: 9.5, intent: 9.0, hallucination: 9.7, bleu: 0.68, rouge: 0.77, semantic: 0.92, outputTokens: 121, latencyMs: 974 },
    { accuracy: 9.1, paramReturn: 9.1, intent: 8.4, hallucination: 9.6, bleu: 0.63, rouge: 0.73, semantic: 0.89, outputTokens: 114, latencyMs: 933 },
    { accuracy: 9.7, paramReturn: 9.6, intent: 9.5, hallucination: 9.8, bleu: 0.71, rouge: 0.80, semantic: 0.94, outputTokens: 126, latencyMs: 989 },
  ],
  git_history: [
    { accuracy: 9.7, paramReturn: 9.5, intent: 9.7, hallucination: 9.8, bleu: 0.73, rouge: 0.80, semantic: 0.95, outputTokens: 120, latencyMs: 946 },
    { accuracy: 9.5, paramReturn: 9.3, intent: 9.4, hallucination: 9.7, bleu: 0.70, rouge: 0.78, semantic: 0.93, outputTokens: 116, latencyMs: 928 },
    { accuracy: 9.8, paramReturn: 9.6, intent: 9.8, hallucination: 9.9, bleu: 0.75, rouge: 0.82, semantic: 0.96, outputTokens: 123, latencyMs: 962 },
    { accuracy: 9.3, paramReturn: 9.2, intent: 9.1, hallucination: 9.6, bleu: 0.67, rouge: 0.75, semantic: 0.91, outputTokens: 112, latencyMs: 915 },
    { accuracy: 9.6, paramReturn: 9.5, intent: 9.6, hallucination: 9.8, bleu: 0.72, rouge: 0.79, semantic: 0.94, outputTokens: 119, latencyMs: 951 },
  ],
};

/** Illustrative docstrings shown in the side-by-side comparison. */
const DEMO_DOCSTRINGS: Record<ContextCondition, string> = {
  code_only: `"""Attempts to consume a specific cost quota of tokens for a given partition key.

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
  few_shot_control: `"""Evaluates and consumes token capacity for key-based rate limiting with debt allowance.

Thread-safely recharges available bucket tokens using monotonic elapsed time. Supports bounded
overdraft for high-priority requests while decrementing accrued deficit upon subsequent refills.

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
  call_graph: `"""Evaluates rate limit quota on the API gateway data plane with Enterprise burst overdraft support.

Acts as the core token consumption primitive invoked by AuthGatewayMiddleware and
TieredBillingInterceptor. Thread-safely locks the partition shard using an FNV-1a striped mutex,
refills tokens based on elapsed monotonic time, and returns RFC 6585 compliant retry delays for
HTTP 429 serialization.

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
  git_history: `"""Thread-safely consumes token quota with hypervisor clock drift protection and amortized burst overdraft.

Replenishes bucket tokens over elapsed monotonic time, clamping duration to non-negative values to
prevent token loss during hypervisor clock synchronization steps. Supports burst debt consumption
for Enterprise workloads to prevent 429 drop spikes during sub-second traffic surges.

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
};

/** Illustrative judge critiques, one per arm. */
const DEMO_CRITIQUES: Record<ContextCondition, string> = {
  code_only:
    'Accurately documents arguments and the return tuple from the signature alone, but misses the hypervisor clock-drift rationale entirely — it describes what the code does without any account of why.',
  few_shot_control:
    'Clearly improved structure and parameter breakdown, evidently from the in-context formatting demonstrations, yet still shows no repository-specific awareness. Gains are presentational.',
  call_graph:
    'Strong architectural grounding: identifies the ingress-proxy position, connects to AuthGatewayMiddleware for HTTP 429 Retry-After computation, and notes the striped mutex sharding.',
  git_history:
    'Outstanding capture of engineering intent. Correctly explains why elapsed time is clamped (hypervisor clock synchronization stepping) and the business reason for burst debt during load spikes.',
};

/** Illustrative key insights, one set per arm. */
const DEMO_INSIGHTS: Record<ContextCondition, string[]> = {
  code_only: ['Token bucket math', 'Burst debt argument', 'Monotonic time update'],
  few_shot_control: [
    'Thread-safe lock awareness',
    'Structured tuple return formatting',
    '50% burst debt ceiling',
  ],
  call_graph: [
    'AuthGatewayMiddleware caller role',
    'RFC 6585 HTTP 429 Retry-After link',
    'FNV-1a shard mutex context',
  ],
  git_history: [
    'Hypervisor clock synchronization clamp',
    'Sub-second traffic surge burst absorption',
    'Debt amortization logic',
  ],
};

/** Blind labels, rotated per trial as real randomized blinding would produce. */
const DEMO_BLIND_LABELS: Record<ContextCondition, string[]> = {
  code_only: ['Candidate B', 'Candidate C', 'Candidate A', 'Candidate D', 'Candidate B'],
  few_shot_control: ['Candidate D', 'Candidate A', 'Candidate B', 'Candidate C', 'Candidate A'],
  call_graph: ['Candidate A', 'Candidate D', 'Candidate C', 'Candidate B', 'Candidate D'],
  git_history: ['Candidate C', 'Candidate B', 'Candidate D', 'Candidate A', 'Candidate C'],
};

/** Builds plausible token accounting for one demo row. */
function buildDemoTokens(
  arm: ContextCondition,
  outputTokens: number,
  tokenBudget: number
): DetailedTokenCounts {
  const systemInstructionTokens = 58;
  const targetCodeTokens = 124;
  const contextTokens = arm === 'code_only' ? 0 : tokenBudget;
  const totalInputTokens = systemInstructionTokens + targetCodeTokens + contextTokens;
  const requestedBudget = arm === 'code_only' ? 0 : tokenBudget;

  return {
    systemInstructionTokens,
    targetCodeTokens,
    contextTokens,
    totalInputTokens,
    outputTokens,
    totalTokens: totalInputTokens + outputTokens,
    // Demo rows are illustrative, so their token counts are labelled ESTIMATED
    // rather than claiming to come from the tokenizer.
    method: 'ESTIMATED',
    requestedBudget,
    tokenDifference: totalInputTokens - requestedBudget,
    compliancePercentage: requestedBudget > 0 ? 100 : 100,
  };
}

/**
 * Builds the demo session, computing all statistics through the production
 * analysis path.
 *
 * @param target The benchmark target the demo illustrates (for naming/ids).
 * @param tokenBudget Context budget to present. Defaults to DEMO_TOKEN_BUDGET.
 */
export function createDemoSession(
  target: BenchmarkTarget,
  tokenBudget: number = DEMO_TOKEN_BUDGET
): MultiTrialExperimentSession {
  const experimentId = `DEMO-${target.id}`;
  const arms = Object.keys(DEMO_SCORES) as ContextCondition[];
  const rawTrials: RawTrialResult[] = [];

  for (let trialIndex = 1; trialIndex <= DEMO_TRIAL_COUNT; trialIndex++) {
    for (const arm of arms) {
      const score = DEMO_SCORES[arm][trialIndex - 1];
      const tokens = buildDemoTokens(arm, score.outputTokens, tokenBudget);
      const docstring = DEMO_DOCSTRINGS[arm];

      rawTrials.push({
        experimentId,
        trialIndex,
        pairId: `${experimentId}-T${trialIndex}`,
        targetId: target.id,
        arm,
        model: DEFAULT_MODEL,
        temperature: 0.2,
        requestedTokenBudget: tokens.requestedBudget,
        tokens,
        generatedDocstring: docstring,
        rawResponse: docstring,
        latencyMs: score.latencyMs,
        status: 'completed',
        judgeModel: DEFAULT_JUDGE_MODEL,
        anonymizedCandidateId: DEMO_BLIND_LABELS[arm][trialIndex - 1],
        evaluation: {
          accuracyScore: score.accuracy,
          paramReturnScore: score.paramReturn,
          intentScore: score.intent,
          hallucinationScore: score.hallucination,
          overallQuality: composite(
            score.accuracy,
            score.paramReturn,
            score.intent,
            score.hallucination
          ),
          bleuScore: score.bleu,
          rougeLScore: score.rouge,
          semanticSimilarity: score.semantic,
          semanticSimilarityMethod: 'embedding',
          factuality: {
            method: 'llm_judge',
            totalClaims: arm === 'code_only' ? 4 : 6,
            supportedClaims: arm === 'code_only' ? 4 : 6,
            unsupportedClaims: 0,
            uncertainClaims: 0,
            factualityScore: 100,
            unsupportedClaimRate: 0,
            claims: [],
          },
          wordCount: docstring.split(/\s+/).filter(Boolean).length,
          tokenCount: score.outputTokens,
          judgeCritique: DEMO_CRITIQUES[arm],
          keyInsightsFound: DEMO_INSIGHTS[arm],
          hallucinationsIdentified: [],
          judgeModel: DEFAULT_JUDGE_MODEL,
          anonymizedCandidateId: DEMO_BLIND_LABELS[arm][trialIndex - 1],
        },
      });
    }
  }

  // Every statistic below this line is computed, not authored.
  return MultiTrialRunner.buildSession({
    experimentId,
    timestamp: Date.now() - 1000 * 60 * 10,
    targetId: target.id,
    targetName: target.name,
    language: target.language,
    numTrials: DEMO_TRIAL_COUNT,
    tokenBudget,
    modelName: DEFAULT_MODEL,
    judgeModel: DEFAULT_JUDGE_MODEL,
    temperature: 0.2,
    rawTrials,
    isDemoData: true,
  });
}
