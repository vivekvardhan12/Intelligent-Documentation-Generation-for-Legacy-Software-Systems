export type ContextCondition = 'code_only' | 'few_shot_control' | 'call_graph' | 'git_history';

export type TokenCountMethod = 'ACTUAL' | 'ESTIMATED';

export type ClaimClassification = 'SUPPORTED' | 'UNSUPPORTED' | 'UNCERTAIN';

export interface FactualityClaim {
  id: string;
  claim: string;
  classification: ClaimClassification;
  evidence: string;
  armContextSufficient: boolean;
}

export interface FactualityEvaluation {
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: number;
  uncertainClaims: number;
  factualityScore: number; // 0-100 (supported / total * 100)
  unsupportedClaimRate: number; // 0-100 (unsupported / total * 100)
  claims: FactualityClaim[];
}

export interface DetailedTokenCounts {
  systemInstructionTokens: number;
  targetCodeTokens: number;
  contextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  method: TokenCountMethod;
  requestedBudget: number;
  tokenDifference: number; // actual - requested
  compliancePercentage: number; // (actual / requested) * 100
}

export interface DocstringEvaluation {
  accuracyScore: number; // 1-10 (functional correctness)
  paramReturnScore: number; // 1-10 (parameter, type & return spec)
  intentScore: number; // 1-10 (architectural purpose, edge cases & 'why')
  hallucinationScore: number; // 1-10 (10 = zero hallucination, 1 = severe hallucination)
  overallQuality: number; // 0-100 scaled
  bleuScore: number; // 0-1 (lexical n-gram overlap)
  rougeLScore: number; // 0-1 (longest common subsequence)
  semanticSimilarity?: number; // 0-1 (embedding cosine similarity)
  factuality?: FactualityEvaluation;
  wordCount: number;
  tokenCount: number;
  judgeCritique: string;
  keyInsightsFound: string[];
  hallucinationsIdentified: string[];
  judgeModel?: string;
  anonymizedCandidateId?: string; // 'Candidate A', 'Candidate B', etc. during blind eval
}

export interface ConditionPromptPayload {
  condition: ContextCondition;
  title: string;
  description: string;
  badge: string;
  role: 'floor' | 'control' | 'treatment';
  tokenBudget: number;
  exactPromptTokens: number;
  systemInstruction: string;
  userPrompt: string;
  contextTokensAllocated: number;
  targetCodeTokensAllocated: number;
  contextSnippetUsed: string;
  detailedTokens?: DetailedTokenCounts;
}

export interface ConditionResult {
  condition: ContextCondition;
  title: string;
  role: 'floor' | 'control' | 'treatment';
  generatedDocstring: string;
  rawResponse: string;
  promptPayload: ConditionPromptPayload;
  latencyMs: number;
  evaluation?: DocstringEvaluation;
  status: 'idle' | 'generating' | 'evaluating' | 'completed' | 'error';
  errorMessage?: string;
  tokens?: DetailedTokenCounts;
}

export interface RawTrialResult {
  experimentId: string;
  trialIndex: number;
  pairId: string; // e.g. EXP-174000-T1
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
  status: 'completed' | 'failed';
  errorMessage?: string;
  evaluation?: DocstringEvaluation;
  judgeModel?: string;
  anonymizedCandidateId?: string;
}

export interface ArmAggregateStats {
  arm: ContextCondition;
  title: string;
  role: 'floor' | 'control' | 'treatment';
  n: number;
  failedCount: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  ci95: [number, number];
  meanBLEU: number;
  meanROUGEL: number;
  meanSemantic: number;
  meanFactuality: number;
  meanInputTokens: number;
  tokenMethod: TokenCountMethod;
  meanCompliancePct: number;
}

export type StatisticalInterpretation =
  | 'SIGNIFICANT POSITIVE LIFT'
  | 'POSITIVE BUT NOT STATISTICALLY SIGNIFICANT'
  | 'NO MEANINGFUL DIFFERENCE'
  | 'NEGATIVE / DEGRADED';

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
  n: number;
  meanDifference: number;
  medianDifference: number;
  sdDifference: number;
  ci95: [number, number];
  tStatistic: number;
  pValuetTest: number;
  wStatistic: number;
  pValueWilcoxon: number;
  primaryPValue: number;
  adjustedPValue: number; // Holm-Bonferroni corrected
  effectSizeCohenD: number;
  effectSizeWilcoxonR: number;
  interpretation: StatisticalInterpretation;
  narrative: string;
}

export interface MultiTrialExperimentSession {
  experimentId: string;
  timestamp: number;
  targetId: string;
  targetName: string;
  language: string;
  numTrials: number;
  tokenBudget: number;
  modelName: string;
  judgeModel: string;
  temperature: number;
  status: 'running' | 'completed' | 'partial_error';
  rawTrials: RawTrialResult[];
  armStats: Record<ContextCondition, ArmAggregateStats>;
  comparisons: {
    lengthEffect: PairedDifferenceStats; // FewShot vs CodeOnly
    callGraphLift: PairedDifferenceStats; // CallGraph vs FewShot
    gitHistoryLift: PairedDifferenceStats; // GitHistory vs FewShot
    allContextLift?: PairedDifferenceStats; // AllContext vs FewShot
  };
  overallVerdict: {
    headline: string;
    summaryNarrative: string;
    callGraphStatus: StatisticalInterpretation;
    gitHistoryStatus: StatisticalInterpretation;
    lengthEffectStatus: StatisticalInterpretation;
  };
}

export interface BenchmarkTarget {
  id: string;
  name: string;
  language: 'python' | 'typescript' | 'go' | 'rust';
  category: string;
  description: string;
  difficulty: 'Standard' | 'Subtle Bug History' | 'Deep Call Graph' | 'High Architectural Complexity';
  targetCode: string;
  referenceDocstring: string;
  groundTruthIntent: string; // The subtle hidden "why" that only call-graph or git-history reveals
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
  fewShotControlExamples: {
    language: string;
    domain: string;
    code: string;
    docstring: string;
  }[];
}

export interface ExperimentRun {
  id: string;
  timestamp: number;
  targetId: string;
  targetName: string;
  language: string;
  tokenBudget: number; // e.g. 500, 1000, 1500
  modelName: string;
  temperature: number;
  trialIndex: number;
  results: Record<ContextCondition, ConditionResult>;
  multiTrialSession?: MultiTrialExperimentSession;
  rawTrials?: RawTrialResult[];
  analysis?: {
    lengthEffectDelta: number; // FewShot Control - Code Only
    callGraphContentLift: number; // Call Graph - FewShot Control
    gitHistoryContentLift: number; // Git History - FewShot Control
    callGraphVerdict: 'length_confounded' | 'genuine_lift' | 'degraded';
    gitHistoryVerdict: 'length_confounded' | 'genuine_lift' | 'degraded';
    summaryNarrative: string;
  };
}

export interface TokenBudgetConfig {
  budget: number; // total prompt budget for context
  temperature: number;
  model: string;
  numTrials: number;
}
