/**
 * Multi-trial paired experiment runner — the engine of the benchmark.
 *
 * EXPERIMENTAL DESIGN IN ONE PARAGRAPH
 * Each trial generates one docstring per arm from the same target function at
 * the same token budget, grades all of them blind, then records the difference
 * between each treatment arm and the length-matched control. Because the arms
 * within a trial share everything except their context CONTENT, the difference
 * isolates the effect of content from the effect of prompt length. Repeating
 * this over several trials turns a single anecdote into a paired sample that
 * can actually be tested.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. NO FABRICATED SCORES. The old code filled every gap with a literal:
 *    `accuracyScore: blindEval.accuracyScore ?? 8.0` and, worse,
 *    `intentScore: blindEval.intentScore ?? (arm === 'code_only' ? 5.2 : ... 9.0)`
 *    — a hardcoded ordering that reproduced the hypothesis. A failed or
 *    unscored arm now produces a trial with `status: 'failed'` and NO
 *    evaluation object, excluded from every aggregate and reported to the user.
 *
 * 2. REAL PER-DIMENSION AGGREGATION. `ArmAggregateStats` now carries the mean
 *    of each rubric dimension, so the radar chart plots what the judge scored.
 *    Previously the adapter set accuracy, paramReturn and intent all to
 *    `mean / 10` and hallucination to a constant 9.5, drawing three identical
 *    spokes while the real per-dimension scores sat unused in `rawTrials`.
 *
 * 3. PARALLELISM. Factuality checks for the four arms ran in a sequential
 *    `for` loop — four full network round trips per trial, for four completely
 *    independent calls. They now run concurrently. Trials themselves run with
 *    bounded concurrency instead of strictly one at a time.
 *
 * 4. REAL TOKEN COUNTS. Token accounting uses the tokenizer's `usageMetadata`
 *    from the generation response when available, and is labelled ESTIMATED
 *    when it falls back to the local heuristic. It used to claim 'ACTUAL'
 *    unconditionally while always being the heuristic.
 *
 * 5. CANCELLABLE. An AbortSignal is threaded through every request so a long
 *    run can be stopped, preserving whatever trials already completed.
 */

import {
  ArmAggregateStats,
  BenchmarkTarget,
  ConditionResult,
  ContextCondition,
  DetailedTokenCounts,
  DocstringEvaluation,
  ExperimentRun,
  MultiTrialExperimentSession,
  PairedDifferenceStats,
  RawTrialResult,
  StatisticalInterpretation,
} from '../types';
import { DEFAULT_JUDGE_MODEL, DEFAULT_MODEL } from '../config/models';
import { buildConditionPrompts } from './tokenBudget';
import { calculateBLEU, calculateROUGEL } from './metrics';
import { batchComputeSemanticSimilarity } from './semanticSimilarity';
import { FactualityEvaluator } from './factualityEvaluator';
import { GeminiJudgeProvider } from './judgeProvider';
import { TokenCounter } from './tokenCounter';
import { ApiError, isCancellation, postJson, throwIfCancelled } from './apiClient';
import { DEFAULT_TRIAL_CONCURRENCY, mapWithConcurrency } from './concurrency';
import {
  classifyInterpretation,
  cohensDPaired,
  confidenceInterval95,
  generateComparisonNarrative,
  holmBonferroniCorrection,
  mean,
  median,
  pairedTTest,
  standardDeviation,
  wilcoxonSignedRankTest,
} from './statistics';

/** The four arms, in canonical display order. */
export const ARM_ORDER: readonly ContextCondition[] = [
  'code_only',
  'few_shot_control',
  'call_graph',
  'git_history',
];

/** Display titles for each arm. */
const ARM_TITLES: Record<ContextCondition, string> = {
  code_only: 'Code Only',
  few_shot_control: 'Few-Shot Control',
  call_graph: 'Call-Graph Context',
  git_history: 'Git-History Context',
};

/**
 * Each arm's experimental role.
 * floor     = no extra context at all (lower bound)
 * control   = same token count as the treatments, zero repository information
 * treatment = real repository context under the identical token budget
 */
const ARM_ROLES: Record<ContextCondition, 'floor' | 'control' | 'treatment'> = {
  code_only: 'floor',
  few_shot_control: 'control',
  call_graph: 'treatment',
  git_history: 'treatment',
};

/** Phases of a single trial, in execution order. */
export type TrialPhase = 'generating' | 'evaluating' | 'factuality' | 'aggregating';

/** Human-readable label for each phase, shown in the progress panel. */
export const PHASE_LABELS: Record<TrialPhase, string> = {
  generating: 'Generating docstrings',
  evaluating: 'Blind judge scoring',
  factuality: 'Checking factual claims',
  aggregating: 'Computing statistics',
};

/**
 * Network requests issued per trial: 1 generation (all arms), 1 blind judge,
 * 1 embedding batch, and one factuality check per arm. Used to size the
 * progress bar so it advances smoothly rather than jumping between phases.
 */
const REQUESTS_PER_TRIAL = 3 + ARM_ORDER.length;

/** A snapshot of run progress, suitable for direct rendering. */
export interface RunProgressSnapshot {
  phase: TrialPhase;
  /** Trials fully finished. */
  trialsCompleted: number;
  totalTrials: number;
  /** Network requests finished, for a fine-grained progress bar. */
  requestsCompleted: number;
  totalRequests: number;
  /** Ready-to-display status line. */
  message: string;
}

export type TrialProgressCallback = (progress: RunProgressSnapshot) => void;

/** Parameters for a full experiment session. */
export interface RunExperimentParams {
  target: BenchmarkTarget;
  /** Context tokens granted identically to every non-floor arm. */
  tokenBudget: number;
  /** Paired trials to run. 3+ enables significance testing. */
  numTrials: number;
  modelName: string;
  temperature: number;
  judgeModel?: string;
  /** Trials to run simultaneously. Defaults to DEFAULT_TRIAL_CONCURRENCY. */
  trialConcurrency?: number;
  onProgress?: TrialProgressCallback;
  signal?: AbortSignal;
}

/** Per-arm generation outcome as returned by /api/gemini/generate-arms. */
interface GeneratedArm {
  generatedDocstring: string;
  rawResponse: string;
  latencyMs: number;
  status: 'completed' | 'error';
  errorMessage?: string;
  usage: {
    promptTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
}

interface GenerateArmsResponse {
  results?: Record<string, GeneratedArm>;
}

/** Everything one trial produced, including its failures. */
interface TrialOutcome {
  trials: RawTrialResult[];
  errors: string[];
}

export class MultiTrialRunner {
  /**
   * Runs a complete experiment session and computes its full analysis.
   *
   * Trials execute with bounded concurrency; each trial's four arms are
   * generated in one request and their factuality checks run in parallel. A
   * failure inside one trial does not abort the session — the trial is recorded
   * as failed and the remaining trials still contribute, because a partial
   * sample is analysable so long as the shortfall is visible.
   *
   * @throws RequestCancelledError if `signal` is aborted.
   */
  static async runExperimentSession(
    params: RunExperimentParams
  ): Promise<MultiTrialExperimentSession> {
    const {
      target,
      tokenBudget,
      numTrials,
      modelName = DEFAULT_MODEL,
      temperature = 0.2,
      judgeModel = DEFAULT_JUDGE_MODEL,
      trialConcurrency = DEFAULT_TRIAL_CONCURRENCY,
      onProgress,
      signal,
    } = params;

    const trialCount = Math.max(1, Math.floor(numTrials));
    const experimentId = `EXP-${Date.now()}`;
    const judgeProvider = new GeminiJudgeProvider(judgeModel);

    // Progress bookkeeping. These counters are shared across concurrent trials;
    // incrementing them is safe because JavaScript runs one task at a time.
    const totalRequests = trialCount * REQUESTS_PER_TRIAL + 1;
    let requestsCompleted = 0;
    let trialsCompleted = 0;

    const report = (phase: TrialPhase, extraMessage?: string) => {
      if (!onProgress) return;
      onProgress({
        phase,
        trialsCompleted,
        totalTrials: trialCount,
        requestsCompleted,
        totalRequests,
        message:
          extraMessage ??
          (trialCount > 1
            ? `${PHASE_LABELS[phase]} — trial ${Math.min(trialsCompleted + 1, trialCount)} of ${trialCount}`
            : PHASE_LABELS[phase]),
      });
    };

    const countRequest = (phase: TrialPhase) => {
      requestsCompleted++;
      report(phase);
    };

    report('generating');

    // Prompts are deterministic for a given (target, budget), so they are built
    // once and reused by every trial instead of being rebuilt per trial.
    const promptPayloads = buildConditionPrompts(target, tokenBudget);

    const trialIndices = Array.from({ length: trialCount }, (_, i) => i + 1);
    const sessionErrors: string[] = [];

    const outcomes = await mapWithConcurrency(
      trialIndices,
      trialConcurrency,
      async (trialIndex) => {
        throwIfCancelled(signal);
        return MultiTrialRunner.runSingleTrial({
          experimentId,
          trialIndex,
          target,
          promptPayloads,
          modelName,
          temperature,
          judgeModel,
          judgeProvider,
          signal,
          onRequestComplete: countRequest,
          onTrialComplete: () => {
            trialsCompleted++;
          },
        });
      }
    );

    const allRawTrials: RawTrialResult[] = [];
    for (const outcome of outcomes) {
      allRawTrials.push(...outcome.trials);
      sessionErrors.push(...outcome.errors);
    }

    report('aggregating');

    return MultiTrialRunner.buildSession({
      experimentId,
      timestamp: Date.now(),
      targetId: target.id,
      targetName: target.name,
      language: target.language,
      numTrials: trialCount,
      tokenBudget,
      modelName,
      judgeModel,
      temperature,
      rawTrials: allRawTrials,
      sessionErrors,
    });
  }

  /**
   * Computes a complete session — aggregates, paired comparisons, multiple-
   * comparison correction and verdict — from raw trial rows.
   *
   * WHY THIS IS PUBLIC AND SEPARATE FROM THE RUNNER
   * The demo dataset goes through this exact function. Previously the seeded
   * demo session carried hand-written statistics (`pValuetTest: 0.0003`,
   * `adjustedPValue: 0.0009`, `'SIGNIFICANT POSITIVE LIFT'`) that no code had
   * computed, so the boot screen displayed a significance claim produced by
   * nothing but a text editor. Routing demo data through the real analysis
   * means its statistics are genuinely derived from its scores, and any change
   * to the statistical code is reflected in the demo automatically.
   */
  static buildSession(args: {
    experimentId: string;
    timestamp?: number;
    targetId: string;
    targetName: string;
    language: string;
    numTrials: number;
    tokenBudget: number;
    modelName: string;
    judgeModel: string;
    temperature: number;
    rawTrials: RawTrialResult[];
    sessionErrors?: string[];
    isDemoData?: boolean;
  }): MultiTrialExperimentSession {
    const { rawTrials, numTrials: trialCount } = args;
    const sessionErrors = args.sessionErrors ?? [];

    // --- Aggregate per arm -------------------------------------------------
    const armStats = {} as Record<ContextCondition, ArmAggregateStats>;
    for (const arm of ARM_ORDER) {
      armStats[arm] = MultiTrialRunner.computeArmStats(arm, rawTrials, trialCount);
    }

    // --- Paired comparisons ------------------------------------------------
    const lengthEffect = MultiTrialRunner.buildPairedComparison(
      'length_effect',
      'Length Effect (Few-Shot Control vs Code-Only Floor)',
      'few_shot_control',
      'code_only',
      rawTrials,
      trialCount
    );
    const callGraphLift = MultiTrialRunner.buildPairedComparison(
      'call_graph_lift',
      'Call-Graph Lift (vs Length Control)',
      'call_graph',
      'few_shot_control',
      rawTrials,
      trialCount
    );
    const gitHistoryLift = MultiTrialRunner.buildPairedComparison(
      'git_history_lift',
      'Git-History Lift (vs Length Control)',
      'git_history',
      'few_shot_control',
      rawTrials,
      trialCount
    );

    // --- Multiple-comparison correction ------------------------------------
    // Three comparisons at alpha = 0.05 carry ~14% family-wise error; Holm
    // controls that. Comparisons whose p-value is null (too few trials) are
    // excluded from the family so they do not inflate the correction applied
    // to the tests that were genuinely run.
    const adjustedPMap = holmBonferroniCorrection([
      { id: callGraphLift.id, pValue: callGraphLift.pValuetTest },
      { id: gitHistoryLift.id, pValue: gitHistoryLift.pValuetTest },
      { id: lengthEffect.id, pValue: lengthEffect.pValuetTest },
    ]);

    for (const comparison of [callGraphLift, gitHistoryLift, lengthEffect]) {
      comparison.adjustedPValue = adjustedPMap[comparison.id] ?? null;
      comparison.interpretation = classifyInterpretation(
        comparison.adjustedPValue,
        comparison.meanDifference,
        comparison.ci95
      );
      comparison.narrative = generateComparisonNarrative(
        comparison.label,
        comparison.interpretation,
        comparison.meanDifference,
        comparison.ci95,
        comparison.pValuetTest,
        comparison.adjustedPValue,
        comparison.effectSizeCohenD,
        comparison.n,
        comparison.inferenceNote
      );
    }

    const overallVerdict = MultiTrialRunner.buildOverallVerdict(
      callGraphLift,
      gitHistoryLift,
      lengthEffect,
      trialCount
    );

    // A session is only 'completed' if nothing went wrong. Anything else is
    // surfaced so the user can tell a clean run from a degraded one.
    const failedTrialCount = rawTrials.filter((t) => t.status === 'failed').length;
    const status: MultiTrialExperimentSession['status'] =
      failedTrialCount === rawTrials.length && rawTrials.length > 0
        ? 'failed'
        : failedTrialCount > 0 || sessionErrors.length > 0
          ? 'partial_error'
          : 'completed';

    return {
      experimentId: args.experimentId,
      timestamp: args.timestamp ?? Date.now(),
      targetId: args.targetId,
      targetName: args.targetName,
      language: args.language,
      numTrials: trialCount,
      tokenBudget: args.tokenBudget,
      modelName: args.modelName,
      judgeModel: args.judgeModel,
      temperature: args.temperature,
      status,
      rawTrials,
      armStats,
      comparisons: { lengthEffect, callGraphLift, gitHistoryLift },
      overallVerdict,
      isDemoData: args.isDemoData,
      errors: sessionErrors.length > 0 ? Array.from(new Set(sessionErrors)) : undefined,
    };
  }

  /**
   * Executes one trial: generate all arms, judge blind, score similarity, and
   * check factual claims.
   *
   * Returns both the per-arm rows and any human-readable errors. Arms that
   * failed are returned with `status: 'failed'` and no evaluation, never with
   * substitute scores.
   */
  private static async runSingleTrial(args: {
    experimentId: string;
    trialIndex: number;
    target: BenchmarkTarget;
    promptPayloads: ReturnType<typeof buildConditionPrompts>;
    modelName: string;
    temperature: number;
    judgeModel: string;
    judgeProvider: GeminiJudgeProvider;
    signal?: AbortSignal;
    onRequestComplete: (phase: TrialPhase) => void;
    onTrialComplete: () => void;
  }): Promise<TrialOutcome> {
    const {
      experimentId,
      trialIndex,
      target,
      promptPayloads,
      modelName,
      temperature,
      judgeModel,
      judgeProvider,
      signal,
      onRequestComplete,
      onTrialComplete,
    } = args;

    const pairId = `${experimentId}-T${trialIndex}`;
    const errors: string[] = [];

    // --- 1. Generate every arm in one request ------------------------------
    let generatedArms: Record<string, GeneratedArm> = {};
    let generationError: string | null = null;

    try {
      const response = await postJson<GenerateArmsResponse>(
        '/api/gemini/generate-arms',
        {
          promptPayloads: Object.fromEntries(
            ARM_ORDER.map((arm) => [
              arm,
              {
                title: promptPayloads[arm].title,
                role: promptPayloads[arm].role,
                systemInstruction: promptPayloads[arm].systemInstruction,
                userPrompt: promptPayloads[arm].userPrompt,
              },
            ])
          ),
          model: modelName,
          temperature,
        },
        signal
      );
      generatedArms = response.results ?? {};
    } catch (error: unknown) {
      if (isCancellation(error)) throw error;
      generationError =
        error instanceof ApiError
          ? error.displayMessage
          : error instanceof Error
            ? error.message
            : 'Generation request failed';
      errors.push(`Trial ${trialIndex}: generation failed — ${generationError}`);
    }
    onRequestComplete('generating');

    const candidateDocs = {} as Record<ContextCondition, string>;
    for (const arm of ARM_ORDER) {
      candidateDocs[arm] = generatedArms[arm]?.generatedDocstring || '';
      const armError = generatedArms[arm]?.errorMessage;
      if (armError) errors.push(`Trial ${trialIndex}, ${ARM_TITLES[arm]}: ${armError}`);
    }

    // If nothing generated, there is nothing to judge or measure. Emit failed
    // rows for every arm and stop — issuing the remaining five requests would
    // only spend quota to grade empty strings.
    const anyContent = ARM_ORDER.some((arm) => candidateDocs[arm].trim().length > 0);
    if (!anyContent) {
      onRequestComplete('evaluating');
      onRequestComplete('factuality');
      for (let i = 0; i < ARM_ORDER.length; i++) onRequestComplete('factuality');
      onTrialComplete();

      return {
        trials: ARM_ORDER.map((arm) =>
          MultiTrialRunner.buildFailedTrial({
            experimentId,
            trialIndex,
            pairId,
            target,
            arm,
            promptPayloads,
            modelName,
            temperature,
            judgeModel,
            errorMessage:
              generatedArms[arm]?.errorMessage ||
              generationError ||
              'No docstring was generated for this arm.',
            latencyMs: generatedArms[arm]?.latencyMs ?? 0,
          })
        ),
        errors,
      };
    }

    // --- 2. Blind judge ----------------------------------------------------
    const blindResult = await judgeProvider.evaluateBlindArms({
      target,
      candidates: candidateDocs,
      judgeModel,
      signal,
    });
    onRequestComplete('evaluating');

    if (blindResult.errorMessage) {
      errors.push(`Trial ${trialIndex}: ${blindResult.errorMessage}`);
    }

    // --- 3. Semantic similarity (single batched request) -------------------
    const similarity = await batchComputeSemanticSimilarity(
      candidateDocs,
      target.referenceDocstring,
      signal
    );
    onRequestComplete('factuality');

    // --- 4. Factuality checks, all arms CONCURRENTLY ----------------------
    // These were previously awaited one at a time inside a loop: four
    // sequential round trips for four independent calls.
    const factualityResults = await Promise.all(
      ARM_ORDER.map(async (arm) => {
        const docstring = candidateDocs[arm];

        // Skip arms with no text: nothing to check, and no request to spend.
        if (docstring.trim().length === 0) {
          onRequestComplete('factuality');
          return null;
        }

        try {
          const factuality = await FactualityEvaluator.evaluateArmFactuality({
            armKey: arm,
            docstring,
            targetCode: target.targetCode,
            armContextText: promptPayloads[arm].contextSnippetUsed,
            model: judgeModel,
            signal,
          });
          onRequestComplete('factuality');
          return factuality;
        } catch (error: unknown) {
          if (isCancellation(error)) throw error;
          onRequestComplete('factuality');
          return null;
        }
      })
    );

    // --- 5. Assemble one row per arm --------------------------------------
    const trials: RawTrialResult[] = ARM_ORDER.map((arm, armIndex) => {
      const payload = promptPayloads[arm];
      const generated = generatedArms[arm];
      const docstring = candidateDocs[arm];
      const blindEval = blindResult.evaluations[arm];

      // An arm is usable only if it produced text AND the judge scored it.
      // Both conditions used to be papered over with default scores.
      if (!docstring || docstring.trim().length === 0) {
        return MultiTrialRunner.buildFailedTrial({
          experimentId,
          trialIndex,
          pairId,
          target,
          arm,
          promptPayloads,
          modelName,
          temperature,
          judgeModel,
          errorMessage:
            generated?.errorMessage ||
            generationError ||
            'No docstring was generated for this arm.',
          latencyMs: generated?.latencyMs ?? 0,
        });
      }

      if (
        !blindEval ||
        typeof blindEval.overallQuality !== 'number' ||
        typeof blindEval.accuracyScore !== 'number' ||
        typeof blindEval.paramReturnScore !== 'number' ||
        typeof blindEval.intentScore !== 'number' ||
        typeof blindEval.hallucinationScore !== 'number'
      ) {
        return MultiTrialRunner.buildFailedTrial({
          experimentId,
          trialIndex,
          pairId,
          target,
          arm,
          promptPayloads,
          modelName,
          temperature,
          judgeModel,
          errorMessage:
            blindResult.errorMessage ?? 'The judge returned no usable score for this arm.',
          latencyMs: generated?.latencyMs ?? 0,
          generatedDocstring: docstring,
          rawResponse: generated?.rawResponse ?? '',
        });
      }

      // Token accounting: prefer the tokenizer's own counts.
      const usage = generated?.usage;
      const hasRealCounts =
        typeof usage?.promptTokens === 'number' && typeof usage?.outputTokens === 'number';

      const tokens: DetailedTokenCounts = TokenCounter.computeDetailedTokens({
        systemInstruction: payload.systemInstruction,
        targetCode: target.targetCode,
        contextText: payload.contextSnippetUsed,
        outputDocstring: docstring,
        requestedBudget: payload.tokenBudget,
        method: hasRealCounts ? 'ACTUAL' : 'ESTIMATED',
        actualInputTokens: hasRealCounts ? (usage?.promptTokens ?? undefined) : undefined,
        actualOutputTokens: hasRealCounts ? (usage?.outputTokens ?? undefined) : undefined,
      });

      const factuality = factualityResults[armIndex] ?? undefined;
      const semanticScore = similarity.scores[arm];

      const evaluation: DocstringEvaluation = {
        accuracyScore: blindEval.accuracyScore,
        paramReturnScore: blindEval.paramReturnScore,
        intentScore: blindEval.intentScore,
        hallucinationScore: blindEval.hallucinationScore,
        overallQuality: blindEval.overallQuality,
        bleuScore: calculateBLEU(docstring, target.referenceDocstring),
        rougeLScore: calculateROUGEL(docstring, target.referenceDocstring),
        semanticSimilarity: typeof semanticScore === 'number' ? semanticScore : undefined,
        semanticSimilarityMethod:
          typeof semanticScore === 'number' ? similarity.method : undefined,
        factuality,
        wordCount: docstring.split(/\s+/).filter(Boolean).length,
        tokenCount: tokens.outputTokens,
        judgeCritique: blindEval.judgeCritique ?? 'No critique returned.',
        keyInsightsFound: blindEval.keyInsightsFound ?? [],
        hallucinationsIdentified: blindEval.hallucinationsIdentified ?? [],
        judgeModel,
        anonymizedCandidateId: blindResult.blindMap[arm],
      };

      return {
        experimentId,
        trialIndex,
        pairId,
        targetId: target.id,
        arm,
        model: modelName,
        temperature,
        requestedTokenBudget: payload.tokenBudget,
        tokens,
        generatedDocstring: docstring,
        rawResponse: generated?.rawResponse ?? '',
        latencyMs: generated?.latencyMs ?? 0,
        status: 'completed' as const,
        evaluation,
        judgeModel,
        anonymizedCandidateId: blindResult.blindMap[arm],
      };
    });

    onTrialComplete();
    return { trials, errors };
  }

  /**
   * Builds a failed trial row.
   *
   * Deliberately carries NO evaluation object. Every aggregate filters on
   * `status === 'completed'`, so a failed arm is excluded from means and from
   * paired differences rather than contributing a placeholder value.
   */
  private static buildFailedTrial(args: {
    experimentId: string;
    trialIndex: number;
    pairId: string;
    target: BenchmarkTarget;
    arm: ContextCondition;
    promptPayloads: ReturnType<typeof buildConditionPrompts>;
    modelName: string;
    temperature: number;
    judgeModel: string;
    errorMessage: string;
    latencyMs: number;
    generatedDocstring?: string;
    rawResponse?: string;
  }): RawTrialResult {
    const payload = args.promptPayloads[args.arm];

    return {
      experimentId: args.experimentId,
      trialIndex: args.trialIndex,
      pairId: args.pairId,
      targetId: args.target.id,
      arm: args.arm,
      model: args.modelName,
      temperature: args.temperature,
      requestedTokenBudget: payload.tokenBudget,
      tokens: TokenCounter.computeDetailedTokens({
        systemInstruction: payload.systemInstruction,
        targetCode: args.target.targetCode,
        contextText: payload.contextSnippetUsed,
        outputDocstring: args.generatedDocstring ?? '',
        requestedBudget: payload.tokenBudget,
        method: 'ESTIMATED',
      }),
      generatedDocstring: args.generatedDocstring ?? '',
      rawResponse: args.rawResponse ?? '',
      latencyMs: args.latencyMs,
      status: 'failed',
      errorMessage: args.errorMessage,
      judgeModel: args.judgeModel,
    };
  }

  /**
   * Aggregates one arm's successful trials.
   *
   * Only `status === 'completed'` rows contribute. `failedCount` records the
   * shortfall so the UI can show "n = 3 of 5 trials" rather than implying a
   * full sample.
   */
  private static computeArmStats(
    arm: ContextCondition,
    allTrials: RawTrialResult[],
    requestedTrials: number
  ): ArmAggregateStats {
    const armTrials = allTrials.filter((t) => t.arm === arm && t.status === 'completed');
    const evaluations = armTrials
      .map((t) => t.evaluation)
      .filter((e): e is DocstringEvaluation => e !== undefined);

    const scores = evaluations.map((e) => e.overallQuality);
    const sd = standardDeviation(scores);

    /** Rounds a mean over a projected field, or 0 when there is no data. */
    const meanOf = (project: (e: DocstringEvaluation) => number | undefined, digits = 2) => {
      const values = evaluations
        .map(project)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return values.length > 0 ? Number(mean(values).toFixed(digits)) : 0;
    };

    return {
      arm,
      title: ARM_TITLES[arm],
      role: ARM_ROLES[arm],
      n: scores.length,
      failedCount: Math.max(0, requestedTrials - scores.length),
      mean: Number(mean(scores).toFixed(1)),
      median: Number(median(scores).toFixed(1)),
      sd: sd === null ? null : Number(sd.toFixed(2)),
      min: scores.length > 0 ? Math.min(...scores) : 0,
      max: scores.length > 0 ? Math.max(...scores) : 0,
      ci95: confidenceInterval95(scores),

      // The real per-dimension judge scores, preserved rather than derived
      // from the composite.
      meanAccuracy: meanOf((e) => e.accuracyScore, 1),
      meanParamReturn: meanOf((e) => e.paramReturnScore, 1),
      meanIntent: meanOf((e) => e.intentScore, 1),
      meanHallucination: meanOf((e) => e.hallucinationScore, 1),

      meanBLEU: meanOf((e) => e.bleuScore),
      meanROUGEL: meanOf((e) => e.rougeLScore),
      meanSemantic: meanOf((e) => e.semanticSimilarity),
      meanFactuality: meanOf((e) => e.factuality?.factualityScore, 1),
      meanInputTokens: Math.round(mean(armTrials.map((t) => t.tokens.totalInputTokens))),
      // ACTUAL only if every contributing trial had real tokenizer counts.
      tokenMethod:
        armTrials.length > 0 && armTrials.every((t) => t.tokens.method === 'ACTUAL')
          ? 'ACTUAL'
          : 'ESTIMATED',
      meanCompliancePct: Number(
        mean(armTrials.map((t) => t.tokens.compliancePercentage)).toFixed(1)
      ),
    };
  }

  /**
   * Builds a paired treatment-vs-control comparison.
   *
   * CRUCIAL: a trial contributes a pair only if BOTH arms succeeded. Pairing a
   * real score against a failed arm's placeholder is exactly the error that
   * made the old output untrustworthy — it would compare a measurement to a
   * constant and call the gap an effect.
   */
  private static buildPairedComparison(
    id: string,
    label: string,
    treatmentArm: ContextCondition,
    controlArm: ContextCondition,
    allTrials: RawTrialResult[],
    requestedTrials: number
  ): PairedDifferenceStats {
    const pairs: PairedDifferenceStats['pairs'] = [];

    for (let trialIndex = 1; trialIndex <= requestedTrials; trialIndex++) {
      const treatmentTrial = allTrials.find(
        (t) => t.trialIndex === trialIndex && t.arm === treatmentArm && t.status === 'completed'
      );
      const controlTrial = allTrials.find(
        (t) => t.trialIndex === trialIndex && t.arm === controlArm && t.status === 'completed'
      );

      // Incomplete pair: skipped entirely, not zero-filled.
      if (!treatmentTrial?.evaluation || !controlTrial?.evaluation) continue;

      const treatmentScore = treatmentTrial.evaluation.overallQuality;
      const controlScore = controlTrial.evaluation.overallQuality;

      pairs.push({
        pairId: treatmentTrial.pairId,
        trialIndex,
        treatmentScore,
        controlScore,
        difference: Number((treatmentScore - controlScore).toFixed(1)),
      });
    }

    const differences = pairs.map((p) => p.difference);
    const tTest = pairedTTest(differences);
    const wilcoxon = wilcoxonSignedRankTest(differences);
    const ci95 = confidenceInterval95(differences);

    return {
      id,
      label,
      treatmentArm,
      controlArm,
      pairs,
      n: pairs.length,
      meanDifference: Number(mean(differences).toFixed(2)),
      medianDifference: Number(median(differences).toFixed(2)),
      sdDifference: tTest.sdDifference === null ? null : Number(tTest.sdDifference.toFixed(2)),
      ci95,
      tStatistic: tTest.tStatistic,
      pValuetTest: tTest.pValue,
      wStatistic: wilcoxon.wStatistic,
      pValueWilcoxon: wilcoxon.pValue,
      primaryPValue: tTest.pValue,
      // Replaced with the Holm-corrected value by the caller.
      adjustedPValue: tTest.pValue,
      effectSizeCohenD: cohensDPaired(differences),
      effectSizeWilcoxonR: wilcoxon.effectSizeR,
      interpretation: 'INSUFFICIENT TRIALS',
      narrative: '',
      inferenceNote: tTest.note ?? wilcoxon.note,
    };
  }

  /**
   * Composes the session headline from the corrected comparisons.
   *
   * When inference was withheld the headline says so instead of declaring a
   * winner — the previous version always produced one of four confident
   * headlines regardless of whether any test had actually run.
   */
  private static buildOverallVerdict(
    callGraphLift: PairedDifferenceStats,
    gitHistoryLift: PairedDifferenceStats,
    lengthEffect: PairedDifferenceStats,
    requestedTrials: number
  ): MultiTrialExperimentSession['overallVerdict'] {
    const significant = (s: StatisticalInterpretation) => s === 'SIGNIFICANT POSITIVE LIFT';
    const cg = callGraphLift.interpretation;
    const git = gitHistoryLift.interpretation;

    let headline: string;
    let summaryNarrative: string;

    if (cg === 'INSUFFICIENT TRIALS' && git === 'INSUFFICIENT TRIALS') {
      headline = 'Descriptive Results Only — Not Enough Trials to Test Significance';
      summaryNarrative =
        `This session ran ${requestedTrials} trial${requestedTrials === 1 ? '' : 's'}, which is ` +
        `below the minimum needed for a paired significance test. The observed differences ` +
        `(call-graph ${callGraphLift.meanDifference >= 0 ? '+' : ''}${callGraphLift.meanDifference} pts, ` +
        `git-history ${gitHistoryLift.meanDifference >= 0 ? '+' : ''}${gitHistoryLift.meanDifference} pts ` +
        `versus the length-matched control) are descriptive only and could easily be sampling ` +
        `noise. Re-run with 3 or more trials — ideally 5-10 — to draw a conclusion.`;
    } else if (significant(cg) && significant(git)) {
      headline = 'Confirmed: Both Structural and Evolutionary Context Provide Genuine Semantic Lift';
      summaryNarrative =
        `Across ${callGraphLift.n} paired trials, both call-graph (+${callGraphLift.meanDifference} pts) ` +
        `and git-history (+${gitHistoryLift.meanDifference} pts) achieved statistically significant lift ` +
        `over the token-length control after Holm-Bonferroni correction. Raw token volume does not ` +
        `account for the improvement.`;
    } else if (significant(cg) || significant(git)) {
      const winner = significant(cg) ? 'Call-Graph' : 'Git-History';
      const winnerComparison = significant(cg) ? callGraphLift : gitHistoryLift;
      const other = significant(cg) ? gitHistoryLift : callGraphLift;
      headline = `Partial Confirmation: ${winner} Context Delivers Statistically Significant Lift`;
      summaryNarrative =
        `Across ${winnerComparison.n} paired trials, ${winner} context showed genuine semantic lift ` +
        `(+${winnerComparison.meanDifference} pts) beyond the length-matched control. The other context ` +
        `arm (${other.meanDifference >= 0 ? '+' : ''}${other.meanDifference} pts) did not reach ` +
        `significance after multiple-comparison correction.`;
    } else if (
      cg === 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT' ||
      git === 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT'
    ) {
      headline = 'Inconclusive: Positive Observed Lift Lacks Statistical Significance';
      summaryNarrative =
        `Positive directional gains appeared, but did not reach p < 0.05 after Holm-Bonferroni ` +
        `correction across ${Math.max(callGraphLift.n, gitHistoryLift.n)} paired trials. More trials ` +
        `are needed before claiming an effect.`;
    } else {
      headline = 'Confounded: Performance Explained Primarily by Prompt Token Length';
      summaryNarrative =
        `Neither structural nor evolutionary repository context significantly outperformed the ` +
        `length-matched few-shot control. On this target, the documentation improvement is ` +
        `attributable to in-context demonstration and prompt token count rather than to ` +
        `repository-specific information.`;
    }

    return {
      headline,
      summaryNarrative,
      callGraphStatus: cg,
      gitHistoryStatus: git,
      lengthEffectStatus: lengthEffect.interpretation,
    };
  }

  /**
   * Adapts a session into the single-run shape the comparison views consume.
   *
   * Uses the LATEST successful trial for each arm's displayed docstring, and
   * the session's aggregate means for its scores. Per-dimension values come
   * from the real aggregates — this method used to synthesize them from the
   * composite score.
   */
  static adaptSessionToExperimentRun(session: MultiTrialExperimentSession): ExperimentRun {
    const results = {} as Record<ContextCondition, ConditionResult>;

    for (const arm of ARM_ORDER) {
      const stats = session.armStats[arm];
      const armTrials = session.rawTrials.filter((t) => t.arm === arm);
      const successfulTrials = armTrials.filter((t) => t.status === 'completed');
      const latestTrial = successfulTrials[successfulTrials.length - 1];
      const latestAnyTrial = armTrials[armTrials.length - 1];

      // No successful trial: the arm is shown as an error with the real reason.
      if (!latestTrial?.evaluation) {
        results[arm] = {
          condition: arm,
          title: stats?.title ?? ARM_TITLES[arm],
          role: stats?.role ?? ARM_ROLES[arm],
          generatedDocstring: '',
          rawResponse: '',
          promptPayload: MultiTrialRunner.buildDisplayPayload(arm, latestAnyTrial),
          latencyMs: latestAnyTrial?.latencyMs ?? 0,
          status: 'error',
          errorMessage:
            latestAnyTrial?.errorMessage ?? 'This arm produced no usable result in any trial.',
          tokens: latestAnyTrial?.tokens,
        };
        continue;
      }

      results[arm] = {
        condition: arm,
        title: stats.title,
        role: stats.role,
        generatedDocstring: latestTrial.generatedDocstring,
        rawResponse: latestTrial.rawResponse,
        promptPayload: MultiTrialRunner.buildDisplayPayload(arm, latestTrial),
        latencyMs: latestTrial.latencyMs,
        status: 'completed',
        tokens: latestTrial.tokens,
        evaluation: {
          // Aggregate means across trials, per dimension, as measured.
          accuracyScore: stats.meanAccuracy,
          paramReturnScore: stats.meanParamReturn,
          intentScore: stats.meanIntent,
          hallucinationScore: stats.meanHallucination,
          overallQuality: stats.mean,
          bleuScore: stats.meanBLEU,
          rougeLScore: stats.meanROUGEL,
          semanticSimilarity: stats.meanSemantic,
          semanticSimilarityMethod: latestTrial.evaluation.semanticSimilarityMethod,
          factuality: latestTrial.evaluation.factuality,
          wordCount: latestTrial.evaluation.wordCount,
          tokenCount: stats.meanInputTokens,
          judgeCritique: latestTrial.evaluation.judgeCritique,
          keyInsightsFound: latestTrial.evaluation.keyInsightsFound,
          hallucinationsIdentified: latestTrial.evaluation.hallucinationsIdentified,
          judgeModel: session.judgeModel,
          anonymizedCandidateId: latestTrial.anonymizedCandidateId,
        },
      };
    }

    /** Maps a comparison's verdict onto the compact single-run vocabulary. */
    const toVerdict = (
      interpretation: StatisticalInterpretation
    ): 'genuine_lift' | 'degraded' | 'length_confounded' | 'insufficient_data' => {
      switch (interpretation) {
        case 'SIGNIFICANT POSITIVE LIFT':
          return 'genuine_lift';
        case 'NEGATIVE / DEGRADED':
          return 'degraded';
        case 'INSUFFICIENT TRIALS':
          return 'insufficient_data';
        default:
          return 'length_confounded';
      }
    };

    return {
      id: session.experimentId,
      timestamp: session.timestamp,
      targetId: session.targetId,
      targetName: session.targetName,
      language: session.language,
      tokenBudget: session.tokenBudget,
      modelName: session.modelName,
      temperature: session.temperature,
      trialIndex: session.numTrials,
      results,
      multiTrialSession: session,
      rawTrials: session.rawTrials,
      isDemoData: session.isDemoData,
      analysis: {
        lengthEffectDelta: Number(session.comparisons.lengthEffect.meanDifference.toFixed(1)),
        callGraphContentLift: Number(session.comparisons.callGraphLift.meanDifference.toFixed(1)),
        gitHistoryContentLift: Number(
          session.comparisons.gitHistoryLift.meanDifference.toFixed(1)
        ),
        callGraphVerdict: toVerdict(session.comparisons.callGraphLift.interpretation),
        gitHistoryVerdict: toVerdict(session.comparisons.gitHistoryLift.interpretation),
        summaryNarrative: session.overallVerdict.summaryNarrative,
      },
    };
  }

  /**
   * Reconstructs a minimal prompt payload for display from a trial row.
   *
   * Trial rows store token accounting rather than the full prompt text (which
   * would bloat persisted history), so the inspector shows counts and the arm's
   * identity rather than re-deriving the prompt.
   */
  private static buildDisplayPayload(
    arm: ContextCondition,
    trial: RawTrialResult | undefined
  ): ConditionResult['promptPayload'] {
    return {
      condition: arm,
      title: ARM_TITLES[arm],
      description: '',
      badge: arm,
      role: ARM_ROLES[arm],
      tokenBudget: trial?.requestedTokenBudget ?? 0,
      requestedTokenBudget: trial?.requestedTokenBudget ?? 0,
      exactPromptTokens: trial?.tokens.totalInputTokens ?? 0,
      systemInstruction: '',
      userPrompt: '',
      contextTokensAllocated: trial?.tokens.contextTokens ?? 0,
      targetCodeTokensAllocated: trial?.tokens.targetCodeTokens ?? 0,
      contextSnippetUsed: '',
      detailedTokens: trial?.tokens,
    };
  }

  /** Convenience alias retained for call-site readability. */
  static convertToExperimentRun(session: MultiTrialExperimentSession): ExperimentRun {
    return MultiTrialRunner.adaptSessionToExperimentRun(session);
  }
}
