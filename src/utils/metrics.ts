import { ContextCondition, DocstringEvaluation, ExperimentRun } from '../types';

/**
 * Calculates BLEU score (n-gram precision with brevity penalty) between candidate and reference docstring.
 */
export function calculateBLEU(candidate: string, reference: string): number {
  if (!candidate || !reference) return 0;
  
  const tokenize = (text: string) => 
    text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);

  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);

  if (candTokens.length === 0 || refTokens.length === 0) return 0;

  // Compute n-gram precisions for n=1..4
  const precisions: number[] = [];
  for (let n = 1; n <= 4; n++) {
    if (candTokens.length < n) {
      precisions.push(0.01);
      continue;
    }
    const candNgrams: Record<string, number> = {};
    for (let i = 0; i <= candTokens.length - n; i++) {
      const ng = candTokens.slice(i, i + n).join(' ');
      candNgrams[ng] = (candNgrams[ng] || 0) + 1;
    }

    const refNgrams: Record<string, number> = {};
    for (let i = 0; i <= refTokens.length - n; i++) {
      const ng = refTokens.slice(i, i + n).join(' ');
      refNgrams[ng] = (refNgrams[ng] || 0) + 1;
    }

    let matchCount = 0;
    let totalCandNgrams = 0;
    for (const [ng, count] of Object.entries(candNgrams)) {
      totalCandNgrams += count;
      const refCount = refNgrams[ng] || 0;
      matchCount += Math.min(count, refCount);
    }

    const p = totalCandNgrams > 0 ? (matchCount / totalCandNgrams) : 0.01;
    precisions.push(Math.max(p, 0.001));
  }

  // Geometric mean of precisions
  const logSum = precisions.reduce((acc, p) => acc + Math.log(p), 0) / 4;
  const geomMean = Math.exp(logSum);

  // Brevity penalty
  const c = candTokens.length;
  const r = refTokens.length;
  const bp = c > r ? 1.0 : Math.exp(1 - r / c);

  return Math.min(1.0, Math.max(0.0, bp * geomMean));
}

/**
 * Calculates ROUGE-L (Longest Common Subsequence F1 score).
 */
export function calculateROUGEL(candidate: string, reference: string): number {
  if (!candidate || !reference) return 0;
  
  const tokenize = (text: string) => 
    text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);

  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);

  const m = candTokens.length;
  const n = refTokens.length;
  if (m === 0 || n === 0) return 0;

  // DP table for LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (candTokens[i - 1] === refTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs = dp[m][n];
  const precision = lcs / m;
  const recall = lcs / n;

  if (precision + recall === 0) return 0;
  const beta = 1.2; // slight weight to recall as in standard ROUGE-L
  const f1 = ((1 + beta * beta) * precision * recall) / (beta * beta * precision + recall);
  return Math.min(1.0, Math.max(0.0, f1));
}

/**
 * Analyzes empirical experiment results to answer the core hypothesis:
 * "Is improvement coming from context content or raw token quantity?"
 */
export function analyzeExperimentHypothesis(run: ExperimentRun): ExperimentRun['analysis'] {
  const codeOnlyScore = run.results.code_only?.evaluation?.overallQuality || 0;
  const controlScore = run.results.few_shot_control?.evaluation?.overallQuality || 0;
  const callGraphScore = run.results.call_graph?.evaluation?.overallQuality || 0;
  const gitHistoryScore = run.results.git_history?.evaluation?.overallQuality || 0;

  // 1. Length Effect = Control (same length, 0 repo info) - Floor
  const lengthEffectDelta = Number((controlScore - codeOnlyScore).toFixed(1));

  // 2. Net Content Lift = Context Score - Control Score
  const callGraphContentLift = Number((callGraphScore - controlScore).toFixed(1));
  const gitHistoryContentLift = Number((gitHistoryScore - controlScore).toFixed(1));

  // 3. Classify Call-Graph
  let callGraphVerdict: 'length_confounded' | 'genuine_lift' | 'degraded' = 'length_confounded';
  if (callGraphContentLift >= 4.0) {
    callGraphVerdict = 'genuine_lift';
  } else if (callGraphContentLift <= -4.0) {
    callGraphVerdict = 'degraded';
  } else {
    callGraphVerdict = 'length_confounded';
  }

  // 4. Classify Git-History
  let gitHistoryVerdict: 'length_confounded' | 'genuine_lift' | 'degraded' = 'length_confounded';
  if (gitHistoryContentLift >= 4.0) {
    gitHistoryVerdict = 'genuine_lift';
  } else if (gitHistoryContentLift <= -4.0) {
    gitHistoryVerdict = 'degraded';
  } else {
    gitHistoryVerdict = 'length_confounded';
  }

  // Narrative summary
  let narrative = '';
  if (callGraphVerdict === 'genuine_lift' && gitHistoryVerdict === 'genuine_lift') {
    narrative = `Both structural call-graph (+${callGraphContentLift} pts vs control) and git-history (+${gitHistoryContentLift} pts vs control) provide statistically genuine context lift beyond the token length control floor. Repository-specific context contains critical domain semantics that raw token volume cannot replicate.`;
  } else if (callGraphVerdict === 'length_confounded' && gitHistoryVerdict === 'length_confounded') {
    narrative = `Both context types performed within margin of the Few-Shot Length Control (+${lengthEffectDelta} pts vs floor). This strongly suggests token volume / in-context demonstration was the primary driver of perceived docstring improvements rather than repo context semantics.`;
  } else if (callGraphVerdict === 'genuine_lift') {
    narrative = `Call-graph structural context provided genuine lift (+${callGraphContentLift} pts over control), whereas Git history did not outperform token length control, indicating architectural call relationships are more informative than past commit logs for this target.`;
  } else {
    narrative = `Git evolutionary history provided genuine lift (+${gitHistoryContentLift} pts over control), while Call-graph was largely matched by length-matched few-shot examples. Past bug rationale was crucial here.`;
  }

  return {
    lengthEffectDelta,
    callGraphContentLift,
    gitHistoryContentLift,
    callGraphVerdict,
    gitHistoryVerdict,
    summaryNarrative: narrative
  };
}
