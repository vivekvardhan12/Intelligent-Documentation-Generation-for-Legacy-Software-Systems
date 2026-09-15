/**
 * Lexical similarity metrics and single-run hypothesis analysis.
 *
 * WHY LEXICAL METRICS AT ALL, GIVEN AN LLM JUDGE
 * The judge is the primary outcome measure, but it is itself a language model
 * and can drift or be inconsistent. BLEU and ROUGE-L are deterministic: they
 * give the same answer forever for the same inputs. Reporting them alongside
 * the judge lets a reader see whether a "lift" also shows up in a measure that
 * cannot have an opinion. They are weak on their own — a correct docstring
 * phrased differently from the reference scores poorly — which is exactly why
 * all three (BLEU, ROUGE-L, embedding similarity) are reported together.
 */

import { ContextCondition, ExperimentRun } from '../types';

/** Splits text into lowercase word tokens, discarding punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Counts n-grams of size `n` in a token list. */
function countNgrams(tokens: string[], n: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let i = 0; i <= tokens.length - n; i++) {
    const ngram = tokens.slice(i, i + n).join(' ');
    counts[ngram] = (counts[ngram] || 0) + 1;
  }
  return counts;
}

/**
 * BLEU score with clipped n-gram precision (n = 1..4) and a brevity penalty.
 *
 * HOW IT WORKS
 * For each n, count how many of the candidate's n-grams appear in the
 * reference, capped at the reference's own count for that n-gram (clipping —
 * this is what stops a candidate gaming the score by repeating one correct
 * phrase). Take the geometric mean of the four precisions, then multiply by a
 * brevity penalty so that a very short candidate cannot win on precision alone.
 *
 * Returns 0 when either side is empty. Complexity: O(candidate + reference).
 */
export function calculateBLEU(candidate: string, reference: string): number {
  if (!candidate || !reference) return 0;

  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);
  if (candTokens.length === 0 || refTokens.length === 0) return 0;

  const precisions: number[] = [];

  for (let n = 1; n <= 4; n++) {
    // Too short to contain any n-gram of this size: contribute a floor value
    // rather than zero, which would annihilate the geometric mean entirely.
    if (candTokens.length < n) {
      precisions.push(0.01);
      continue;
    }

    const candNgrams = countNgrams(candTokens, n);
    const refNgrams = countNgrams(refTokens, n);

    let matchCount = 0;
    let totalCandNgrams = 0;
    for (const [ngram, count] of Object.entries(candNgrams)) {
      totalCandNgrams += count;
      matchCount += Math.min(count, refNgrams[ngram] || 0);
    }

    const precision = totalCandNgrams > 0 ? matchCount / totalCandNgrams : 0.01;
    // Floored so that log(0) never produces -Infinity below.
    precisions.push(Math.max(precision, 0.001));
  }

  const logSum = precisions.reduce((acc, p) => acc + Math.log(p), 0) / 4;
  const geometricMean = Math.exp(logSum);

  // Brevity penalty: no penalty when the candidate is at least as long as the
  // reference, exponential decay when it is shorter.
  const candidateLength = candTokens.length;
  const referenceLength = refTokens.length;
  const brevityPenalty =
    candidateLength > referenceLength ? 1.0 : Math.exp(1 - referenceLength / candidateLength);

  return Math.min(1.0, Math.max(0.0, brevityPenalty * geometricMean));
}

/**
 * ROUGE-L: F-measure over the Longest Common Subsequence.
 *
 * WHY LCS RATHER THAN N-GRAMS
 * LCS rewards words appearing in the right ORDER without requiring them to be
 * adjacent, so it tolerates the inserted qualifiers that good documentation
 * tends to add ("the bucket" vs "the token bucket"), which n-gram precision
 * punishes.
 *
 * Uses two rolling rows rather than a full (m+1) x (n+1) matrix: the DP
 * recurrence only ever reads the previous row, so memory is O(min side) instead
 * of O(m x n). Time remains O(m x n).
 *
 * `beta = 1.2` weights recall slightly above precision, matching the standard
 * ROUGE-L formulation.
 */
export function calculateROUGEL(candidate: string, reference: string): number {
  if (!candidate || !reference) return 0;

  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);

  const m = candTokens.length;
  const n = refTokens.length;
  if (m === 0 || n === 0) return 0;

  let previousRow = new Array<number>(n + 1).fill(0);
  let currentRow = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    currentRow[0] = 0;
    for (let j = 1; j <= n; j++) {
      currentRow[j] =
        candTokens[i - 1] === refTokens[j - 1]
          ? previousRow[j - 1] + 1
          : Math.max(previousRow[j], currentRow[j - 1]);
    }
    // Swap the rows instead of reallocating.
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }

  const lcsLength = previousRow[n];
  const precision = lcsLength / m;
  const recall = lcsLength / n;
  if (precision + recall === 0) return 0;

  const beta = 1.2;
  const betaSquared = beta * beta;
  const fMeasure =
    ((1 + betaSquared) * precision * recall) / (betaSquared * precision + recall);

  return Math.min(1.0, Math.max(0.0, fMeasure));
}

/**
 * Minimum composite-score gap treated as a meaningful single-run difference.
 *
 * This is a DESCRIPTIVE threshold for the single-run view, not a significance
 * test. It exists because a 1-2 point wobble in an LLM judge's composite score
 * is noise, so calling it a "lift" would be misleading. Any real claim comes
 * from the multi-trial statistics, not from this constant.
 */
const SINGLE_RUN_MEANINGFUL_DELTA = 4.0;

/**
 * Analyzes one run's arms to summarize where the improvement came from.
 *
 * Reports `insufficient_data` when a required arm has no evaluation — because
 * an arm that failed cannot be compared. The previous implementation read
 * `evaluation?.overallQuality || 0`, turning a failed arm into a score of zero
 * and therefore into a spectacular apparent lift for every other arm.
 *
 * When the run carries a multi-trial session, that session's statistically
 * corrected verdicts take precedence; this function is the fallback for a
 * single generation pass.
 */
export function analyzeExperimentHypothesis(run: ExperimentRun): ExperimentRun['analysis'] {
  /** Returns an arm's composite score, or null if it was never measured. */
  const scoreOf = (arm: ContextCondition): number | null => {
    const quality = run.results?.[arm]?.evaluation?.overallQuality;
    return typeof quality === 'number' && Number.isFinite(quality) ? quality : null;
  };

  const codeOnly = scoreOf('code_only');
  const control = scoreOf('few_shot_control');
  const callGraph = scoreOf('call_graph');
  const gitHistory = scoreOf('git_history');

  // Without the length-matched control there is no baseline to isolate
  // against, which is the entire experimental design.
  if (control === null) {
    return {
      lengthEffectDelta: 0,
      callGraphContentLift: 0,
      gitHistoryContentLift: 0,
      callGraphVerdict: 'insufficient_data',
      gitHistoryVerdict: 'insufficient_data',
      summaryNarrative:
        'The few-shot length control produced no usable result, so no comparison is possible. ' +
        'The control arm is the reference point that separates context content from context ' +
        'length — without it, any difference between the other arms is uninterpretable.',
    };
  }

  const lengthEffectDelta =
    codeOnly === null ? 0 : Number((control - codeOnly).toFixed(1));
  const callGraphContentLift =
    callGraph === null ? 0 : Number((callGraph - control).toFixed(1));
  const gitHistoryContentLift =
    gitHistory === null ? 0 : Number((gitHistory - control).toFixed(1));

  /** Classifies one arm's descriptive gap against the control. */
  const classify = (
    armScore: number | null,
    lift: number
  ): 'genuine_lift' | 'degraded' | 'length_confounded' | 'insufficient_data' => {
    if (armScore === null) return 'insufficient_data';
    if (lift >= SINGLE_RUN_MEANINGFUL_DELTA) return 'genuine_lift';
    if (lift <= -SINGLE_RUN_MEANINGFUL_DELTA) return 'degraded';
    return 'length_confounded';
  };

  const callGraphVerdict = classify(callGraph, callGraphContentLift);
  const gitHistoryVerdict = classify(gitHistory, gitHistoryContentLift);

  // The narrative always states that a single run is descriptive, so this view
  // can never be mistaken for the statistical result.
  const trialNote =
    run.multiTrialSession && run.multiTrialSession.numTrials > 1
      ? ''
      : ' Note: this reflects a single generation pass — run multiple trials for a significance test.';

  let summaryNarrative: string;

  if (callGraphVerdict === 'insufficient_data' && gitHistoryVerdict === 'insufficient_data') {
    summaryNarrative =
      'Neither context arm produced a usable result, so no lift can be computed.' + trialNote;
  } else if (callGraphVerdict === 'genuine_lift' && gitHistoryVerdict === 'genuine_lift') {
    summaryNarrative =
      `Both structural call-graph (+${callGraphContentLift} pts) and git-history ` +
      `(+${gitHistoryContentLift} pts) scored above the length-matched control, suggesting the ` +
      `repository context carried information that token volume alone did not supply.` + trialNote;
  } else if (callGraphVerdict === 'length_confounded' && gitHistoryVerdict === 'length_confounded') {
    summaryNarrative =
      `Both context arms landed within ${SINGLE_RUN_MEANINGFUL_DELTA} points of the few-shot ` +
      `length control (which itself scored ${lengthEffectDelta >= 0 ? '+' : ''}${lengthEffectDelta} ` +
      `pts against the floor). On this run, prompt length and in-context demonstration explain ` +
      `the improvement rather than repository semantics.` + trialNote;
  } else if (callGraphVerdict === 'genuine_lift') {
    summaryNarrative =
      `Call-graph context scored +${callGraphContentLift} pts over the control while git-history ` +
      `did not clear the threshold, suggesting architectural call relationships were more ` +
      `informative than commit history for this target.` + trialNote;
  } else if (gitHistoryVerdict === 'genuine_lift') {
    summaryNarrative =
      `Git-history context scored +${gitHistoryContentLift} pts over the control while call-graph ` +
      `context was matched by the length-controlled few-shot examples. Past bug rationale ` +
      `appears to carry the decisive information here.` + trialNote;
  } else {
    summaryNarrative =
      `At least one context arm scored below the length-matched control, which can indicate ` +
      `distractor context: irrelevant repository detail crowding out the target function.` +
      trialNote;
  }

  return {
    lengthEffectDelta,
    callGraphContentLift,
    gitHistoryContentLift,
    callGraphVerdict,
    gitHistoryVerdict,
    summaryNarrative,
  };
}
