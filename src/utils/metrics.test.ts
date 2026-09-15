/**
 * Tests for the lexical similarity metrics and single-run analysis.
 *
 * BLEU and ROUGE-L are the deterministic counterweight to the LLM judge: they
 * return the same answer forever for the same inputs, so a reader can check
 * whether a claimed "lift" also appears in a measure that cannot have an
 * opinion. That only holds if they are correct, hence these tests.
 */

import { describe, expect, it } from 'vitest';
import { calculateBLEU, calculateROUGEL, analyzeExperimentHypothesis } from './metrics';
import { ConditionResult, ContextCondition, ExperimentRun } from '../types';

describe('calculateBLEU', () => {
  it('scores identical text at or near 1', () => {
    const text = 'consumes token quota with clock drift protection';
    expect(calculateBLEU(text, text)).toBeCloseTo(1, 2);
  });

  it('scores completely unrelated text near 0', () => {
    const score = calculateBLEU('alpha beta gamma delta', 'one two three four');
    expect(score).toBeLessThan(0.05);
  });

  it('returns 0 when either side is empty', () => {
    expect(calculateBLEU('', 'reference text here')).toBe(0);
    expect(calculateBLEU('candidate text here', '')).toBe(0);
  });

  it('ignores punctuation and case', () => {
    const a = calculateBLEU('Token Bucket, consumes!', 'token bucket consumes');
    const b = calculateBLEU('token bucket consumes', 'token bucket consumes');
    expect(a).toBeCloseTo(b, 5);
  });

  it('penalizes a candidate shorter than the reference', () => {
    const reference = 'consumes token quota with hypervisor clock drift protection and burst debt';
    const short = calculateBLEU('consumes token quota', reference);
    const full = calculateBLEU(reference, reference);
    expect(short).toBeLessThan(full);
  });

  it('does not reward repeating one correct phrase (clipping)', () => {
    // Without clipped n-gram counts, repetition would inflate precision.
    const reference = 'token bucket consumes quota safely';
    const repeated = calculateBLEU(
      'token bucket token bucket token bucket token bucket',
      reference
    );
    expect(repeated).toBeLessThan(0.5);
  });

  it('stays within [0, 1]', () => {
    const cases: [string, string][] = [
      ['a', 'a b c d e f g'],
      ['a b c d e f g', 'a'],
      ['x', 'y'],
    ];
    for (const [candidate, reference] of cases) {
      const score = calculateBLEU(candidate, reference);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('calculateROUGEL', () => {
  it('scores identical text at 1', () => {
    const text = 'refills bucket tokens over elapsed monotonic time';
    expect(calculateROUGEL(text, text)).toBeCloseTo(1, 5);
  });

  it('returns 0 for no shared tokens', () => {
    expect(calculateROUGEL('alpha beta', 'gamma delta')).toBe(0);
  });

  it('returns 0 when either side is empty', () => {
    expect(calculateROUGEL('', 'anything')).toBe(0);
    expect(calculateROUGEL('anything', '')).toBe(0);
  });

  it('matches a hand-computed LCS', () => {
    // Candidate "a b c d", reference "a c d" -> LCS is "a c d", length 3.
    // precision = 3/4, recall = 3/3 = 1, beta = 1.2:
    //   F = (1 + 1.44) * 0.75 * 1 / (1.44 * 0.75 + 1) = 1.83 / 2.08 = 0.8798
    expect(calculateROUGEL('a b c d', 'a c d')).toBeCloseTo(0.8798, 3);
  });

  it('rewards in-order matches over out-of-order ones', () => {
    const reference = 'one two three four five';
    const inOrder = calculateROUGEL('one two three four five', reference);
    const reversed = calculateROUGEL('five four three two one', reference);
    expect(inOrder).toBeGreaterThan(reversed);
  });

  it('tolerates inserted words between matches', () => {
    // This is why LCS is used rather than n-gram precision: good documentation
    // adds qualifiers, which adjacency-based metrics punish heavily.
    const score = calculateROUGEL('the token bucket', 'the bucket');
    expect(score).toBeGreaterThan(0.7);
  });

  it('stays within [0, 1]', () => {
    const score = calculateROUGEL('a b c', 'c b a x y z');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

/** Builds a minimal ConditionResult carrying only a composite score. */
function armWithScore(
  condition: ContextCondition,
  overallQuality: number | null
): ConditionResult {
  return {
    condition,
    title: condition,
    role: condition === 'code_only' ? 'floor' : condition === 'few_shot_control' ? 'control' : 'treatment',
    generatedDocstring: overallQuality === null ? '' : 'a docstring',
    rawResponse: '',
    promptPayload: {
      condition,
      title: condition,
      description: '',
      badge: condition,
      role: 'treatment',
      tokenBudget: 750,
      requestedTokenBudget: 750,
      exactPromptTokens: 800,
      systemInstruction: '',
      userPrompt: '',
      contextTokensAllocated: 750,
      targetCodeTokensAllocated: 50,
      contextSnippetUsed: '',
    },
    latencyMs: 900,
    status: overallQuality === null ? 'error' : 'completed',
    evaluation:
      overallQuality === null
        ? undefined
        : {
            accuracyScore: 9,
            paramReturnScore: 9,
            intentScore: 8,
            hallucinationScore: 9.5,
            overallQuality,
            bleuScore: 0.5,
            rougeLScore: 0.6,
            wordCount: 50,
            tokenCount: 80,
            judgeCritique: '',
            keyInsightsFound: [],
            hallucinationsIdentified: [],
          },
  };
}

/** Builds a run from four composite scores; null marks a failed arm. */
function runWithScores(scores: Record<ContextCondition, number | null>): ExperimentRun {
  return {
    id: 'test-run',
    timestamp: Date.now(),
    targetId: 'target',
    targetName: 'target',
    language: 'python',
    tokenBudget: 750,
    modelName: 'test-model',
    temperature: 0.2,
    trialIndex: 1,
    results: {
      code_only: armWithScore('code_only', scores.code_only),
      few_shot_control: armWithScore('few_shot_control', scores.few_shot_control),
      call_graph: armWithScore('call_graph', scores.call_graph),
      git_history: armWithScore('git_history', scores.git_history),
    },
  };
}

describe('analyzeExperimentHypothesis', () => {
  it('reports genuine lift when both context arms clear the threshold', () => {
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: 84, call_graph: 94, git_history: 95 })
    );
    expect(analysis!.lengthEffectDelta).toBeCloseTo(6, 1);
    expect(analysis!.callGraphContentLift).toBeCloseTo(10, 1);
    expect(analysis!.callGraphVerdict).toBe('genuine_lift');
    expect(analysis!.gitHistoryVerdict).toBe('genuine_lift');
  });

  it('reports length confounding when context arms match the control', () => {
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: 88, call_graph: 89, git_history: 87 })
    );
    expect(analysis!.callGraphVerdict).toBe('length_confounded');
    expect(analysis!.gitHistoryVerdict).toBe('length_confounded');
    expect(analysis!.summaryNarrative).toMatch(/prompt length/i);
  });

  it('reports degradation when a context arm scores well below the control', () => {
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: 90, call_graph: 80, git_history: 91 })
    );
    expect(analysis!.callGraphVerdict).toBe('degraded');
  });

  it('reports insufficient_data for a failed arm rather than scoring it zero', () => {
    // REGRESSION TEST. The old code read `evaluation?.overallQuality || 0`, so
    // a failed arm became a genuine score of 0 — which made every other arm
    // look like an enormous improvement over it.
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: 84, call_graph: null, git_history: 95 })
    );
    expect(analysis!.callGraphVerdict).toBe('insufficient_data');
    expect(analysis!.callGraphContentLift).toBe(0);
    // The arm that did succeed is still assessed normally.
    expect(analysis!.gitHistoryVerdict).toBe('genuine_lift');
  });

  it('refuses any comparison when the control arm failed', () => {
    // The length-matched control is the reference point that separates content
    // from length; without it nothing is interpretable.
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: null, call_graph: 94, git_history: 95 })
    );
    expect(analysis!.callGraphVerdict).toBe('insufficient_data');
    expect(analysis!.gitHistoryVerdict).toBe('insufficient_data');
    expect(analysis!.summaryNarrative).toMatch(/control/i);
  });

  it('notes that a single pass is not a significance test', () => {
    const analysis = analyzeExperimentHypothesis(
      runWithScores({ code_only: 78, few_shot_control: 84, call_graph: 94, git_history: 95 })
    );
    expect(analysis!.summaryNarrative).toMatch(/single generation pass/i);
  });
});
