/**
 * Domain types for the Context Isolation benchmark.
 *
 * KEY DESIGN RULE IN THIS FILE: a score that was not measured has no value.
 *
 * The previous version modelled every statistic as a plain `number`, which
 * forced every failure path to invent a placeholder — `overallQuality: 78`,
 * `p = 1.0`, `hallucinationScore: 9.5`. Those placeholders were then rendered,
 * charted and exported as if they were measurements. Statistics that require a
 * minimum sample size are therefore `| null` here, and an arm that failed
 * carries no `evaluation` object at all rather than a zeroed one. The type
 * system now makes "we didn't measure this" impossible to confuse with
 * "we measured zero".
 */

export type ContextCondition = 'code_only' | 'few_shot_control' | 'call_graph' | 'git_history';

/**
 * How a token count was obtained.
 * ACTUAL = counted by the Gemini tokenizer via /api/gemini/count-tokens.
 * ESTIMATED = derived from the local ~3.8 chars/token heuristic.
 * The distinction is surfaced in the UI; it used to be claimed as ACTUAL while
 * only ever being ESTIMATED.
 */
export type TokenCountMethod = 'ACTUAL' | 'ESTIMATED';

export type ClaimClassification = 'SUPPORTED' | 'UNSUPPORTED' | 'UNCERTAIN';

/** A single testable assertion extracted from a generated docstring. */
export interface FactualityClaim {
  id: string;
  claim: string;
  classification: ClaimClassification;
  /** One sentence explaining the classification. */
  evidence: string;
  /** True when this arm's supplied context was sufficient to support the claim. */
  armContextSufficient?: boolean;
}

/** How a factuality score was produced. See FactualityEvaluation.method. */
export type FactualityMethod = 'llm_judge' | 'lexical_heuristic';

/**
 * Result of checking a docstring's claims against only the evidence its arm saw.
 *
 * This is the fairness control at the heart of the experiment: a true statement
 * about a caller is still UNSUPPORTED for an arm that was never shown the call
 * graph, because that arm guessed it.
 */
export interface FactualityEvaluation {
  /**
   * Which mechanism produced these numbers.
   *
   * 'llm_judge' is the real claim-by-claim check. 'lexical_heuristic' is the
   * offline fallback that scores vocabulary overlap between the docstring and
   * the available evidence — a genuinely different and much weaker measurement.
   * The two used to be returned interchangeably with no way to tell them apart,
   * so a run with a dead API showed heuristic word-overlap scores in the same
   * place, and the same styling, as judged factuality. The UI now labels them.
   */
  method: FactualityMethod;
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: number;
  uncertainClaims: number;
  /** 0-100. supported / total * 100. */
  factualityScore: number;
  /** 0-100. unsupported / total * 100. */
  unsupportedClaimRate: number;
  claims: FactualityClaim[];
}

/** Token accounting for one arm's request/response pair. */
export interface DetailedTokenCounts {
  systemInstructionTokens: number;
  targetCodeTokens: number;
  contextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Whether these numbers came from the tokenizer or the heuristic. */
  method: TokenCountMethod;
  requestedBudget: number;
  /** actual - requested. Negative means the packer under-filled the budget. */
  tokenDifference: number;
  /** (actual / requested) * 100. 100 when no budget was requested. */
  compliancePercentage: number;
}

/** How a semantic similarity score was produced. */
export type SemanticSimilarityMethod = 'embedding' | 'lexical_fallback';

/**
 * A completed judge evaluation of one docstring.
 *
 * An instance of this type means the judge really scored this candidate. If the
 * judge call failed, or omitted this candidate, the owning trial's `evaluation`
 * is left `undefined` and its `status` is `'failed'` — no object is fabricated.
 */
export interface DocstringEvaluation {
  /** 1-10. Functional correctness of the description. */
  accuracyScore: number;
  /** 1-10. Completeness of parameter, type and return specifications. */
  paramReturnScore: number;
  /** 1-10. Capture of architectural purpose, edge cases and the 'why'. */
  intentScore: number;
  /** 1-10. 10 = no false claims; 1 = severe hallucination. */
  hallucinationScore: number;
  /** 0-100 composite. */
  overallQuality: number;
  /** 0-1 lexical n-gram overlap with the reference docstring. */
  bleuScore: number;
  /** 0-1 longest-common-subsequence F1 against the reference. */
  rougeLScore: number;
  /** 0-1 embedding cosine similarity. Absent if the embedding call failed. */
  semanticSimilarity?: number;
  /**
   * How `semanticSimilarity` was computed: 'embedding' uses real Gemini
   * embedding vectors, 'lexical_fallback' uses a token/trigram cosine that
   * approximates it offline. Distinguished for the same reason as
   * FactualityEvaluation.method — they are not the same measurement.
   */
  semanticSimilarityMethod?: SemanticSimilarityMethod;
  factuality?: FactualityEvaluation;
  wordCount: number;
  tokenCount: number;
  judgeCritique: string;
  keyInsightsFound: string[];
  hallucinationsIdentified: string[];
  judgeModel?: string;
  /** Label this candidate carried during blind judging, e.g. 'Candidate C'. */
  anonymizedCandidateId?: string;
}

/** A fully-built prompt for one experimental arm at a given token budget. */
export interface ConditionPromptPayload {
  condition: ContextCondition;
  title: string;
  description: string;
  badge: string;
  role: 'floor' | 'control' | 'treatment';
  /**
   * Context tokens actually allotted to this arm. 0 for the code-only floor.
   *
   * This is the EFFECTIVE budget, which may be lower than the user requested:
   * see `requestedTokenBudget` and `budgetLimitedBy`.
   */
  tokenBudget: number;
  /** The budget the user asked for, before any capping. */
  requestedTokenBudget: number;
  /**
   * Names the arm whose available context capped the effective budget, when
   * the effective budget is below the requested one.
   *
   * WHY THIS EXISTS: the treatment arms can only supply as much context as
   * their target actually has. Left uncapped, the few-shot control — which has
   * an effectively unlimited example pool — filled 740 of a 750-token budget
   * while both treatment arms managed only ~375, so the "length-matched
   * control" carried twice the tokens of the arms it was supposed to match.
   * The budget is now capped to what every context arm can genuinely supply,
   * and this field records why, so the UI can say so rather than implying a
   * match that does not hold.
   */
  budgetLimitedBy?: ContextCondition;
  exactPromptTokens: number;
  systemInstruction: string;
  userPrompt: string;
  contextTokensAllocated: number;
  targetCodeTokensAllocated: number;
  /** The packed context text actually inserted into the prompt. */
  contextSnippetUsed: string;
  detailedTokens?: DetailedTokenCounts;
}

/** Per-arm result as displayed in the side-by-side comparison. */
export interface ConditionResult {
  condition: ContextCondition;
  title: string;
  role: 'floor' | 'control' | 'treatment';
  generatedDocstring: string;
  rawResponse: string;
  promptPayload: ConditionPromptPayload;
  latencyMs: number;
  /** Absent when generation or judging failed for this arm. */
  evaluation?: DocstringEvaluation;
  status: 'idle' | 'generating' | 'evaluating' | 'completed' | 'error';
  /** Real API error text, shown in the UI instead of being logged and dropped. */
  errorMessage?: string;
  tokens?: DetailedTokenCounts;
}

/** One arm's outcome within one trial — the atomic unit of the dataset. */
export interface RawTrialResult {
  experimentId: string;
  trialIndex: number;
  /** Groups the arms of a single trial so differences can be paired. */
  pairId: string;
  targetId: string;
  arm: ContextCondition;
  model: string;
  modelVersion?: string;
  temperature: number;
  requestedTokenBudget: number;
  tokens: DetailedTokenCounts;
  generatedDocstring: string;
  rawResponse: string;
  latencyMs: number;
  /** 'failed' rows are excluded from every aggregate and reported as failures. */
  status: 'completed' | 'failed';
  errorMessage?: string;
  evaluation?: DocstringEvaluation;
  judgeModel?: string;
  anonymizedCandidateId?: string;
}

/**
 * Aggregate statistics for one arm across the trials of a session.
 *
 * `sd` and `ci95` are nullable because they are undefined for a single
 * observation. Reporting a "95% CI" of [x, x] from one trial, as the previous
 * version did, presents a point estimate as an interval.
 */
export interface ArmAggregateStats {
  arm: ContextCondition;
  title: string;
  role: 'floor' | 'control' | 'treatment';
  /** Number of SUCCESSFUL trials contributing to these figures. */
  n: number;
  /** Trials that errored and are excluded from the means. */
  failedCount: number;
  mean: number;
  median: number;
  /** Sample SD. Null when n < 2. */
  sd: number | null;
  min: number;
  max: number;
  /** 95% CI of the mean. Null when n < MIN_TRIALS_FOR_INFERENCE. */
  ci95: [number, number] | null;

  /**
   * Per-dimension means.
   *
   * These exist so the radar chart can plot what the judge actually scored.
   * Previously the chart derived all four axes from the composite
   * (`mean / 10`, with hallucination hardcoded to 9.5), so it drew three
   * identical spokes and a constant while the real per-dimension scores sat
   * unused in `rawTrials`.
   */
  meanAccuracy: number;
  meanParamReturn: number;
  meanIntent: number;
  meanHallucination: number;

  meanBLEU: number;
  meanROUGEL: number;
  meanSemantic: number;
  meanFactuality: number;
  meanInputTokens: number;
  tokenMethod: TokenCountMethod;
  meanCompliancePct: number;
}

/**
 * Verdict for a paired comparison.
 *
 * 'INSUFFICIENT TRIALS' is the honest outcome below the minimum sample size for
 * inference. It replaces the old behaviour of reporting a verdict and a
 * confidence interval from a single observation.
 */
export type StatisticalInterpretation =
  | 'SIGNIFICANT POSITIVE LIFT'
  | 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT'
  | 'NO MEANINGFUL DIFFERENCE'
  | 'NEGATIVE / DEGRADED'
  | 'INSUFFICIENT TRIALS';

/**
 * A paired treatment-vs-control comparison across trials.
 *
 * Descriptive fields (`meanDifference`, `medianDifference`) are always present
 * because they are computable from any sample size. Inferential fields are
 * `null` until there are enough paired trials to support them.
 */
export interface PairedDifferenceStats {
  id: string;
  label: string;
  treatmentArm: ContextCondition;
  controlArm: ContextCondition;
  pairs: {
    pairId: string;
    trialIndex: number;
    treatmentScore: number;
    controlScore: number;
    difference: number;
  }[];
  /** Number of complete pairs (both arms succeeded). */
  n: number;

  // --- Descriptive: always available ---
  meanDifference: number;
  medianDifference: number;
  sdDifference: number | null;

  // --- Inferential: null below MIN_TRIALS_FOR_INFERENCE ---
  ci95: [number, number] | null;
  tStatistic: number | null;
  pValuetTest: number | null;
  wStatistic: number | null;
  pValueWilcoxon: number | null;
  primaryPValue: number | null;
  /** Holm-Bonferroni corrected p-value across the session's comparisons. */
  adjustedPValue: number | null;
  effectSizeCohenD: number | null;
  effectSizeWilcoxonR: number | null;

  interpretation: StatisticalInterpretation;
  narrative: string;
  /**
   * Set when inference was deliberately withheld, explaining why — e.g.
   * "n = 1; at least 3 paired trials are required" or "zero variance across
   * trials". Rendered in the UI so a blank p-value is never a mystery.
   */
  inferenceNote?: string;
}

/** A complete multi-trial experiment session and its analysis. */
export interface MultiTrialExperimentSession {
  experimentId: string;
  timestamp: number;
  targetId: string;
  targetName: string;
  language: string;
  /** Trials REQUESTED. Successful counts per arm live in `armStats[arm].n`. */
  numTrials: number;
  tokenBudget: number;
  modelName: string;
  judgeModel: string;
  temperature: number;
  status: 'running' | 'completed' | 'partial_error' | 'failed' | 'cancelled';
  rawTrials: RawTrialResult[];
  armStats: Record<ContextCondition, ArmAggregateStats>;
  comparisons: {
    /** Few-shot control vs code-only floor: the effect of length alone. */
    lengthEffect: PairedDifferenceStats;
    /** Call-graph vs length-matched control: structural content lift. */
    callGraphLift: PairedDifferenceStats;
    /** Git-history vs length-matched control: evolutionary content lift. */
    gitHistoryLift: PairedDifferenceStats;
    allContextLift?: PairedDifferenceStats;
  };
  overallVerdict: {
    headline: string;
    summaryNarrative: string;
    callGraphStatus: StatisticalInterpretation;
    gitHistoryStatus: StatisticalInterpretation;
    lengthEffectStatus: StatisticalInterpretation;
  };
  /**
   * Marks hand-authored illustrative data rather than measured results.
   *
   * The app used to seed the dashboard with authored docstrings, authored
   * scores and even authored p-values, indistinguishable from a real run — a
   * user could export a publication-ready table of numbers nothing had
   * computed. Demo data is now flagged here and badged everywhere it appears.
   */
  isDemoData?: boolean;
  /** Human-readable errors encountered during the run, for display. */
  errors?: string[];
}

/** Every benchmark target carries its own isolated context sources. */
export interface BenchmarkTarget {
  id: string;
  name: string;
  language: 'python' | 'typescript' | 'go' | 'rust';
  category: string;
  description: string;
  difficulty: 'Standard' | 'Subtle Bug History' | 'Deep Call Graph' | 'High Architectural Complexity';
  targetCode: string;
  referenceDocstring: string;
  /** The hidden 'why' that only call-graph or git-history context reveals. */
  groundTruthIntent: string;
  callGraphContext: {
    modulePath: string;
    callers: { name: string; signature: string; context: string }[];
    callees: { name: string; signature: string; context: string }[];
    architecturalNotes: string;
  };
  gitHistoryContext: {
    commits: {
      hash: string;
      date: string;
      author: string;
      message: string;
      diffHunk: string;
    }[];
    prDiscussion: string;
  };
  /** Unrelated examples used to match token length without leaking repo info. */
  fewShotControlExamples: {
    language: string;
    domain: string;
    code: string;
    docstring: string;
  }[];
}

/** A single run as presented in the dashboard and history list. */
export interface ExperimentRun {
  id: string;
  timestamp: number;
  targetId: string;
  targetName: string;
  language: string;
  tokenBudget: number;
  modelName: string;
  temperature: number;
  trialIndex: number;
  results: Record<ContextCondition, ConditionResult>;
  multiTrialSession?: MultiTrialExperimentSession;
  rawTrials?: RawTrialResult[];
  analysis?: {
    /** Few-shot control minus code-only floor. */
    lengthEffectDelta: number;
    /** Call-graph minus length-matched control. */
    callGraphContentLift: number;
    /** Git-history minus length-matched control. */
    gitHistoryContentLift: number;
    callGraphVerdict: 'length_confounded' | 'genuine_lift' | 'degraded' | 'insufficient_data';
    gitHistoryVerdict: 'length_confounded' | 'genuine_lift' | 'degraded' | 'insufficient_data';
    summaryNarrative: string;
  };
  /** See MultiTrialExperimentSession.isDemoData. */
  isDemoData?: boolean;
}

/** User-controlled run parameters. */
export interface TokenBudgetConfig {
  /** Context token budget applied identically to every non-floor arm. */
  budget: number;
  temperature: number;
  model: string;
  /** Paired trials to run. 3+ enables significance testing. */
  numTrials: number;
}
