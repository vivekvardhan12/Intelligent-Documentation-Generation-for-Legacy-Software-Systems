export type ContextCondition = 'code_only' | 'few_shot_control' | 'call_graph' | 'git_history';

export interface DocstringEvaluation {
  accuracyScore: number; // 1-10 (functional correctness)
  paramReturnScore: number; // 1-10 (parameter, type & return spec)
  intentScore: number; // 1-10 (architectural purpose, edge cases & 'why')
  hallucinationScore: number; // 1-10 (10 = zero hallucination, 1 = severe hallucination)
  overallQuality: number; // 0-100 scaled
  bleuScore: number; // 0-1 (if ground truth available)
  rougeLScore: number; // 0-1 (if ground truth available)
  wordCount: number;
  tokenCount: number;
  judgeCritique: string;
  keyInsightsFound: string[];
  hallucinationsIdentified: string[];
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
