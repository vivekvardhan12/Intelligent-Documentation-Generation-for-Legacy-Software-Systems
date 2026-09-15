/**
 * Tests for prompt construction — the experiment's central control.
 *
 * The benchmark's entire claim rests on one invariant: the three context arms
 * receive the SAME number of context tokens, and every arm receives the SAME
 * system instruction and the SAME untruncated target function. If that
 * invariant breaks, a quality difference between arms is explained by prompt
 * length, which is precisely the confound the study exists to rule out. These
 * tests assert the invariant directly.
 */

import { describe, expect, it } from 'vitest';
import { SHARED_SYSTEM_INSTRUCTION, buildConditionPrompts, estimateTokens } from './tokenBudget';
import { BENCHMARK_TARGETS } from '../data/benchmarkTargets';
import { ContextCondition } from '../types';

const CONTEXT_ARMS: ContextCondition[] = ['few_shot_control', 'call_graph', 'git_history'];
const ALL_ARMS: ContextCondition[] = ['code_only', ...CONTEXT_ARMS];

describe('buildConditionPrompts', () => {
  const target = BENCHMARK_TARGETS[0];

  it('produces a payload for every arm', () => {
    const payloads = buildConditionPrompts(target, 750);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm]).toBeDefined();
      expect(payloads[arm].condition).toBe(arm);
    }
  });

  it('gives every arm the identical system instruction', () => {
    // Varying the instruction per arm would introduce a second uncontrolled
    // variable alongside the context content.
    const payloads = buildConditionPrompts(target, 750);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm].systemInstruction).toBe(SHARED_SYSTEM_INSTRUCTION);
    }
  });

  it('includes the target function untruncated in every arm', () => {
    // The target must never be trimmed to make room for context: it is the one
    // input that has to stay constant across arms.
    const payloads = buildConditionPrompts(target, 250);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm].userPrompt).toContain(target.targetCode);
    }
  });

  it('gives the floor arm no context at all', () => {
    const payloads = buildConditionPrompts(target, 750);
    expect(payloads.code_only.tokenBudget).toBe(0);
    expect(payloads.code_only.contextTokensAllocated).toBe(0);
  });

  it('assigns the identical effective budget to all three context arms', () => {
    // The invariant is that the three arms share ONE budget — not that it
    // equals what was requested. It is capped to what every arm can genuinely
    // supply, because an uncapped budget silently unmatched the control.
    for (const requested of [250, 500, 750, 1000, 1500, 2000]) {
      const payloads = buildConditionPrompts(target, requested);
      const budgets = CONTEXT_ARMS.map((arm) => payloads[arm].tokenBudget);

      expect(new Set(budgets).size, `arms disagreed on budget at ${requested}`).toBe(1);
      expect(budgets[0]).toBeGreaterThan(0);
      expect(budgets[0]).toBeLessThanOrEqual(requested);

      // The requested figure is preserved separately so the UI can show both.
      for (const arm of CONTEXT_ARMS) {
        expect(payloads[arm].requestedTokenBudget).toBe(requested);
      }
    }
  });

  it('keeps every context arm within its effective budget', () => {
    for (const requested of [250, 500, 750, 1000, 1500, 2000]) {
      const payloads = buildConditionPrompts(target, requested);
      for (const arm of CONTEXT_ARMS) {
        const effective = payloads[arm].tokenBudget;
        expect(
          payloads[arm].contextTokensAllocated,
          `${arm} exceeded its ${effective}-token effective budget`
        ).toBeLessThanOrEqual(effective);
        // The effective budget can be capped down, never raised above what
        // was asked for.
        expect(effective).toBeLessThanOrEqual(requested);
      }
    }
  });

  it('gives all three context arms genuinely matched lengths', () => {
    /*
     * THE CENTRAL ASSERTION OF THE WHOLE SUITE.
     *
     * REGRESSION TEST. Packing each arm to the requested budget independently
     * did NOT produce matched lengths, because the arms do not have equal
     * material to draw on: a target's call graph and commit history are
     * finite, while the few-shot example pool can fill any budget. Measured at
     * the default 750-token budget, the supposedly length-matched control
     * carried 740 tokens against ~375 for each treatment arm — twice the
     * tokens of the arms it was meant to control for, rising to six times at a
     * 2000-token budget.
     *
     * A control with twice the tokens of its treatments is not a length
     * control, and the benchmark's entire claim rests on that match.
     */
    for (const requested of [250, 500, 750, 1000, 1500, 2000]) {
      const payloads = buildConditionPrompts(target, requested);
      const sizes = CONTEXT_ARMS.map((arm) => payloads[arm].contextTokensAllocated);
      const spread = Math.max(...sizes) - Math.min(...sizes);
      const effective = payloads.call_graph.tokenBudget;

      // Within 15% of the effective budget. Packers cut at line boundaries, so
      // exact equality is neither achievable nor necessary — what matters is
      // that no arm has a length advantage large enough to explain a quality
      // difference.
      expect(
        spread,
        `spread ${spread} across arms at requested budget ${requested} (effective ${effective})`
      ).toBeLessThanOrEqual(Math.max(40, effective * 0.15));
    }
  });

  it('reports when the effective budget was capped, and by which arm', () => {
    // At a large requested budget the targets cannot supply enough context, so
    // the cap must bite AND be reported — otherwise the UI would claim a
    // 2000-token budget while delivering a few hundred.
    const payloads = buildConditionPrompts(target, 2000);
    expect(payloads.call_graph.requestedTokenBudget).toBe(2000);
    expect(payloads.call_graph.tokenBudget).toBeLessThan(2000);
    expect(payloads.call_graph.budgetLimitedBy).toBeDefined();
    expect(CONTEXT_ARMS).toContain(payloads.call_graph.budgetLimitedBy!);
  });

  it('does not report a cap when the budget is genuinely met', () => {
    // A small budget every arm can satisfy should produce no warning.
    const payloads = buildConditionPrompts(target, 250);
    expect(payloads.call_graph.budgetLimitedBy).toBeUndefined();
  });

  it('leaves the floor arm out of budget capping entirely', () => {
    const payloads = buildConditionPrompts(target, 2000);
    expect(payloads.code_only.tokenBudget).toBe(0);
    expect(payloads.code_only.requestedTokenBudget).toBe(0);
    expect(payloads.code_only.budgetLimitedBy).toBeUndefined();
  });

  it('scales context allocation with the budget below the cap', () => {
    // Above the cap, allocation plateaus at whatever the target can supply —
    // which is the honest behaviour, and why the cap is reported.
    const small = buildConditionPrompts(target, 100);
    const larger = buildConditionPrompts(target, 300);
    for (const arm of CONTEXT_ARMS) {
      expect(larger[arm].contextTokensAllocated).toBeGreaterThan(
        small[arm].contextTokensAllocated
      );
    }
  });

  it('keeps repository information out of the length control', () => {
    const payloads = buildConditionPrompts(target, 1000);
    const controlPrompt = payloads.few_shot_control.userPrompt;

    expect(controlPrompt).not.toContain(target.callGraphContext.modulePath);
    expect(controlPrompt).not.toContain(target.groundTruthIntent);
    for (const commit of target.gitHistoryContext.commits) {
      expect(controlPrompt).not.toContain(commit.hash);
    }
  });

  it('puts real repository context into the treatment arms', () => {
    const payloads = buildConditionPrompts(target, 1500);
    expect(payloads.call_graph.userPrompt).toContain('Call-Graph');
    expect(payloads.git_history.userPrompt).toContain('Git Commit History');
  });

  it('never leaks the hidden ground-truth intent into any prompt', () => {
    // The whole point is that the model must INFER the intent from context.
    // Handing it the answer would invalidate every arm at once.
    const payloads = buildConditionPrompts(target, 2000);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm].userPrompt).not.toContain(target.groundTruthIntent);
      expect(payloads[arm].systemInstruction).not.toContain(target.groundTruthIntent);
    }
  });

  it('never leaks the reference docstring into any prompt', () => {
    // The reference is the grading key. A prompt containing it would produce a
    // perfect BLEU score that measures nothing.
    const payloads = buildConditionPrompts(target, 2000);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm].userPrompt).not.toContain(target.referenceDocstring);
    }
  });

  it('is deterministic for identical inputs', () => {
    // The runner builds prompts once and reuses them across trials, which is
    // only valid if construction is deterministic.
    const first = buildConditionPrompts(target, 750);
    const second = buildConditionPrompts(target, 750);
    for (const arm of ALL_ARMS) {
      expect(second[arm].userPrompt).toBe(first[arm].userPrompt);
      expect(second[arm].exactPromptTokens).toBe(first[arm].exactPromptTokens);
    }
  });

  it('holds for every shipped benchmark target', () => {
    for (const shippedTarget of BENCHMARK_TARGETS) {
      const payloads = buildConditionPrompts(shippedTarget, 750);

      for (const arm of CONTEXT_ARMS) {
        expect(
          payloads[arm].contextTokensAllocated,
          `${shippedTarget.id}/${arm} exceeded its effective budget`
        ).toBeLessThanOrEqual(payloads[arm].tokenBudget);
      }

      // Arms must be matched for EVERY shipped target, not just the default.
      const sizes = CONTEXT_ARMS.map((arm) => payloads[arm].contextTokensAllocated);
      const spread = Math.max(...sizes) - Math.min(...sizes);
      const effective = payloads.call_graph.tokenBudget;
      expect(
        spread,
        `${shippedTarget.id}: arms differ by ${spread} tokens`
      ).toBeLessThanOrEqual(Math.max(40, effective * 0.15));
      for (const arm of ALL_ARMS) {
        expect(payloads[arm].userPrompt).toContain(shippedTarget.targetCode);
      }
    }
  });

  it('attaches token accounting to every payload', () => {
    const payloads = buildConditionPrompts(target, 750);
    for (const arm of ALL_ARMS) {
      expect(payloads[arm].detailedTokens).toBeDefined();
      expect(payloads[arm].detailedTokens!.method).toBe('ESTIMATED');
    }
  });
});

describe('estimateTokens', () => {
  it('delegates to the shared heuristic', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('some text here')).toBeGreaterThan(0);
  });
});
