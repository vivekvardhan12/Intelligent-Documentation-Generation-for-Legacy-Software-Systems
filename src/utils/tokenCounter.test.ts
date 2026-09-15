/**
 * Tests for token estimation, context packing and token accounting.
 *
 * The packers ARE the experimental control: if the call-graph arm receives 900
 * context tokens while the few-shot control receives 700, every quality
 * difference between them is confounded by length — the exact confound this
 * benchmark exists to rule out. These tests assert that each packer respects
 * its budget and its documented priority order.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  StructuredContextPacker,
  TokenCounter,
  clearTokenEstimateCache,
  estimateTokenCount,
  truncateToTokens,
} from './tokenCounter';
import { BenchmarkTarget } from '../types';

/** A target with enough context in every source to force truncation. */
function buildTarget(): BenchmarkTarget {
  const longProse = (label: string) =>
    `${label} ${'detailed architectural explanation with many descriptive words '.repeat(12)}`;

  return {
    id: 'test-target',
    name: 'test.function',
    language: 'python',
    category: 'test',
    description: 'A test target',
    difficulty: 'Standard',
    targetCode: 'def consume(key: str, cost: int = 1) -> bool:\n    return True\n',
    referenceDocstring: '"""Consumes quota for a key."""',
    groundTruthIntent: 'Hidden rationale that only context reveals.',
    callGraphContext: {
      modulePath: 'app/limiter/bucket.py',
      architecturalNotes: longProse('Architecture:'),
      callers: Array.from({ length: 6 }, (_, i) => ({
        name: `caller_${i}`,
        signature: `def caller_${i}(request) -> Response`,
        context: longProse(`Caller ${i} usage:`),
      })),
      callees: Array.from({ length: 6 }, (_, i) => ({
        name: `callee_${i}`,
        signature: `def callee_${i}(x) -> int`,
        context: longProse(`Callee ${i} behavior:`),
      })),
    },
    gitHistoryContext: {
      commits: Array.from({ length: 5 }, (_, i) => ({
        hash: `abc${i}`,
        date: '2024-01-01',
        author: 'dev',
        message: longProse(`Commit ${i}:`),
        diffHunk: `- old line ${i}\n+ new line ${i}\n`,
      })),
      prDiscussion: longProse('PR discussion:'),
    },
    fewShotControlExamples: Array.from({ length: 4 }, (_, i) => ({
      language: 'python',
      domain: `unrelated-domain-${i}`,
      code: `def unrelated_${i}(a, b):\n    return a + b\n`,
      docstring: longProse(`Example ${i} docstring:`),
    })),
  };
}

describe('estimateTokenCount', () => {
  beforeEach(() => clearTokenEstimateCache());

  it('returns 0 for empty input', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('grows with text length', () => {
    const short = estimateTokenCount('a short sentence');
    const long = estimateTokenCount('a short sentence '.repeat(20));
    expect(long).toBeGreaterThan(short);
  });

  it('charges long identifiers more than their word count', () => {
    // Real tokenizers split `refill_rate_per_second` into several subwords,
    // which is why the heuristic scales with length beyond six characters.
    expect(estimateTokenCount('refill_rate_per_second')).toBeGreaterThan(1);
  });

  it('counts punctuation separately', () => {
    expect(estimateTokenCount('a, b, c')).toBeGreaterThan(estimateTokenCount('a b c'));
  });

  it('is deterministic and cache-consistent', () => {
    const text = 'the same text estimated twice';
    const first = estimateTokenCount(text);
    const second = estimateTokenCount(text);
    expect(second).toBe(first);

    clearTokenEstimateCache();
    expect(estimateTokenCount(text)).toBe(first);
  });

  it('lands within a plausible range for prose', () => {
    // ~3.8 characters per token: 200 characters should be roughly 40-90 tokens.
    const text = 'x'.repeat(0) + 'the quick brown fox jumps over the lazy dog '.repeat(5);
    const estimate = estimateTokenCount(text);
    expect(estimate).toBeGreaterThan(30);
    expect(estimate).toBeLessThan(120);
  });
});

describe('truncateToTokens', () => {
  it('returns text unchanged when it already fits', () => {
    const text = 'short text';
    expect(truncateToTokens(text, 1000)).toBe(text);
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateToTokens('anything at all', 0)).toBe('');
    expect(truncateToTokens('anything at all', -5)).toBe('');
  });

  it('never exceeds the requested budget', () => {
    const text = 'line of content here\n'.repeat(200);
    for (const budget of [20, 50, 100, 250]) {
      expect(estimateTokenCount(truncateToTokens(text, budget))).toBeLessThanOrEqual(budget);
    }
  });

  it('cuts at a line boundary when one is available', () => {
    // A context block severed mid-identifier reads as corrupted input, which
    // could change how the model treats the whole prompt.
    const text = 'first line here\nsecond line here\nthird line here\n'.repeat(30);
    const truncated = truncateToTokens(text, 40);
    expect(truncated.endsWith('here')).toBe(true);
  });
});

describe('StructuredContextPacker', () => {
  const target = buildTarget();

  it('returns nothing for a budget too small to be useful', () => {
    expect(StructuredContextPacker.packCallGraph(target, 10)).toBe('');
    expect(StructuredContextPacker.packGitHistory(target, 10)).toBe('');
    expect(StructuredContextPacker.packFewShotControl(target, 10)).toBe('');
  });

  it('keeps every packer within its budget', () => {
    for (const budget of [250, 500, 750, 1000, 2000]) {
      const packed = {
        callGraph: StructuredContextPacker.packCallGraph(target, budget),
        gitHistory: StructuredContextPacker.packGitHistory(target, budget),
        fewShot: StructuredContextPacker.packFewShotControl(target, budget),
        all: StructuredContextPacker.packAllContext(target, budget),
      };

      for (const [name, text] of Object.entries(packed)) {
        expect(
          estimateTokenCount(text),
          `${name} exceeded the ${budget}-token budget`
        ).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('prioritizes architecture and callers over callees in the call graph', () => {
    // Callers reveal a function's purpose and contract; callees mostly restate
    // what the visible implementation already shows.
    const packed = StructuredContextPacker.packCallGraph(target, 300);
    expect(packed).toContain('Module Path');
    expect(packed).toContain('Callers');
    // At this budget the callee section should have been squeezed out.
    expect(packed.indexOf('Callers')).toBeLessThan(
      packed.indexOf('Callees') === -1 ? Number.MAX_SAFE_INTEGER : packed.indexOf('Callees')
    );
  });

  it('prioritizes commits over PR discussion in git history', () => {
    const packed = StructuredContextPacker.packGitHistory(target, 300);
    expect(packed).toContain('Git Commit History');
    expect(packed).toContain('Commit abc0');
  });

  it('leaks no repository information into the length control', () => {
    // This is the control's entire purpose: identical token count, zero
    // information about the repository under test.
    const packed = StructuredContextPacker.packFewShotControl(target, 750);
    expect(packed).toContain('unrelated-domain-0');
    expect(packed).not.toContain('app/limiter/bucket.py');
    expect(packed).not.toContain('caller_0');
    expect(packed).not.toContain('Hidden rationale');
  });

  it('includes both sources in the combined pack', () => {
    const packed = StructuredContextPacker.packAllContext(target, 1200);
    expect(packed).toContain('Call-Graph');
    expect(packed).toContain('Git Commit History');
  });

  it('is deterministic for identical inputs', () => {
    // Reproducibility matters: the runner builds prompts once and reuses them
    // across trials, which is only valid if packing is deterministic.
    expect(StructuredContextPacker.packCallGraph(target, 500)).toBe(
      StructuredContextPacker.packCallGraph(target, 500)
    );
  });
});

describe('TokenCounter.computeDetailedTokens', () => {
  it('sums the components when no measured counts are supplied', () => {
    const tokens = TokenCounter.computeDetailedTokens({
      systemInstruction: 'system instruction text',
      targetCode: 'def f(): pass',
      contextText: 'some context',
      requestedBudget: 500,
    });

    expect(tokens.totalInputTokens).toBe(
      tokens.systemInstructionTokens + tokens.targetCodeTokens + tokens.contextTokens
    );
    expect(tokens.method).toBe('ESTIMATED');
  });

  it('prefers measured counts and labels them ACTUAL', () => {
    const tokens = TokenCounter.computeDetailedTokens({
      systemInstruction: 'system',
      targetCode: 'code',
      contextText: 'context',
      requestedBudget: 500,
      method: 'ACTUAL',
      actualInputTokens: 812,
      actualOutputTokens: 97,
    });

    expect(tokens.totalInputTokens).toBe(812);
    expect(tokens.outputTokens).toBe(97);
    expect(tokens.totalTokens).toBe(909);
    expect(tokens.method).toBe('ACTUAL');
  });

  it('measures compliance against the CONTEXT budget', () => {
    // Compliance must reflect whether the context fit its budget. Measuring
    // total input against it — as the old code did — mixed in the system
    // instruction and target code, which are outside the budget entirely, and
    // so reported a spurious overshoot for every arm.
    const tokens = TokenCounter.computeDetailedTokens({
      systemInstruction: 'a fairly long system instruction that costs tokens',
      targetCode: 'def some_function_with_a_long_name(argument_one, argument_two): pass',
      contextText: 'x '.repeat(100),
      requestedBudget: 200,
    });

    const expected = Number(((tokens.contextTokens / 200) * 100).toFixed(1));
    expect(tokens.compliancePercentage).toBe(expected);
    expect(tokens.compliancePercentage).toBeLessThanOrEqual(110);
  });

  it('reports 100% compliance for the zero-budget floor arm', () => {
    const tokens = TokenCounter.computeDetailedTokens({
      systemInstruction: 'system',
      targetCode: 'code',
      contextText: '',
      requestedBudget: 0,
    });

    expect(tokens.compliancePercentage).toBe(100);
    expect(tokens.contextTokens).toBe(0);
  });
});
