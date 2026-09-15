/**
 * Prompt construction under a fixed token budget.
 *
 * THE EXPERIMENTAL CONTRACT ENFORCED HERE
 * All four arms receive:
 *   - the identical system instruction,
 *   - the identical, untruncated target function,
 * and differ ONLY in their context block:
 *   - code_only        : no context at all (the floor)
 *   - few_shot_control : unrelated documentation examples, packed to `budget`
 *   - call_graph       : callers/callees/architecture, packed to `budget`
 *   - git_history      : commits/diffs/PR discussion, packed to `budget`
 *
 * Because the three non-floor arms are packed to the same budget, a quality
 * difference between them cannot be explained by prompt length. That is the
 * entire point, and it is why the target code is never truncated to make room
 * for context — doing so would vary the one input that must stay constant.
 *
 * WHAT CHANGED
 * The dead fifth "all-context" prompt was being built on every call — including
 * a `packAllContext` invocation that runs both other packers — and then thrown
 * away, since `ConditionPromptPayload` has no such arm. That was pure waste on
 * the slider's critical path.
 */

import { BenchmarkTarget, ConditionPromptPayload, ContextCondition } from '../types';
import { estimateTokenCount, StructuredContextPacker, TokenCounter } from './tokenCounter';

/**
 * The system instruction given to every arm, verbatim.
 *
 * Shared deliberately: varying the instruction per arm would introduce a
 * second uncontrolled variable alongside the context content.
 */
export const SHARED_SYSTEM_INSTRUCTION =
  `You are an expert software engineer and technical documentation specialist. ` +
  `Write a clean, high-precision, production-grade docstring / documentation comment ` +
  `for the following function. Do not repeat the entire function implementation; ` +
  `output only the docstring formatted appropriately for the programming language.`;

/**
 * Slack allowed when deciding whether the effective budget was capped.
 *
 * Packers cut at line boundaries, so an arm legitimately lands a few tokens
 * below its budget without being genuinely limited. Reporting that as a cap
 * would put a warning on screen for every run.
 */
const BUDGET_MATCH_TOLERANCE_TOKENS = 25;

/** Re-exported for callers that only need an estimate. */
export function estimateTokens(text: string): number {
  return estimateTokenCount(text);
}

/**
 * Truncates text to a token budget at a line boundary.
 * Thin wrapper retained for backwards compatibility with existing call sites.
 */
export function fitToTokenBudget(text: string, targetTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) return text;

  const ratio = targetTokens / currentTokens;
  const targetChars = Math.floor(text.length * ratio * 0.95);
  const truncated = text.slice(0, targetChars);
  return truncated.slice(0, truncated.lastIndexOf('\n')) || truncated;
}

/**
 * Builds the user prompt for an arm.
 *
 * The context block (if any) comes FIRST and the target function LAST, so the
 * function under test sits closest to the instruction — the position models
 * attend to most reliably. Keeping that ordering identical across arms removes
 * prompt position as a confound.
 */
function buildUserPrompt(
  target: BenchmarkTarget,
  contextBlock: string,
  taskDescription: string
): string {
  const codeFence = `\`\`\`${target.language}\n${target.targetCode}\n\`\`\``;

  if (!contextBlock) {
    return `Write the docstring for the following ${target.language} function:\n\n${codeFence}`;
  }

  return `${contextBlock}

---

### Target Function to Document:
${taskDescription}

${codeFence}`;
}

/** Static descriptive metadata for each arm, used by the UI. */
const ARM_METADATA: Record<
  ContextCondition,
  {
    title: string;
    description: string;
    badge: string;
    role: 'floor' | 'control' | 'treatment';
    taskDescription: string;
  }
> = {
  code_only: {
    title: 'Code Only',
    description: 'The baseline floor. The target function with zero extra tokens.',
    badge: 'Baseline Floor',
    role: 'floor',
    taskDescription: '',
  },
  few_shot_control: {
    title: 'Few-Shot Control',
    description:
      'The length control. Same token budget spent on unrelated (function, docstring) pairs.',
    badge: 'Length Control',
    role: 'control',
    taskDescription: 'Write the docstring for the following function:',
  },
  call_graph: {
    title: 'Call-Graph Context',
    description: 'Callers, callees, module architecture, filled to exact token budget.',
    badge: 'Structural Context',
    role: 'treatment',
    taskDescription:
      'Write the docstring for the following function based on its implementation and repository call-graph:',
  },
  git_history: {
    title: 'Git-History Context',
    description: 'Commit messages, diff hunks, PR intent, filled to exact token budget.',
    badge: 'Evolutionary Context',
    role: 'treatment',
    taskDescription:
      'Write the docstring for the following function based on its implementation and commit evolution history:',
  },
};

/**
 * Generates the complete prompt payload for every experimental arm.
 *
 * THE LENGTH CONTROL IS ENFORCED HERE, NOT ASSUMED
 *
 * The naive approach — pack each arm to the requested budget independently —
 * does not produce a length-matched comparison, because the arms do not have
 * equal amounts of material to draw on. A target's call graph and commit
 * history are finite: once packed, they are whatever size they are. The
 * few-shot example pool, by contrast, can fill any budget.
 *
 * Measured on the shipped targets at the default 750-token budget, that gap
 * was severe:
 *
 *     few_shot_control   740 tokens  (99% of budget)
 *     call_graph         376 tokens  (50%)
 *     git_history        372 tokens  (50%)
 *
 * At a 2000-token budget the control carried six times the treatment arms.
 * A control with twice the tokens of the arms it is controlling for is not a
 * length control — and the experiment's entire claim rests on that match.
 *
 * So the effective budget is capped to what EVERY context arm can actually
 * supply, and all three are then packed to that same figure. The cost is a
 * small trim of the larger treatment arm; the benefit is that "identical token
 * budget" becomes a true statement. Where the cap bites, it is reported
 * through `requestedTokenBudget` and `budgetLimitedBy` so the UI can explain
 * that raising the budget further will not help this target.
 *
 * @param target Function under test, with its isolated context sources.
 * @param budget Context tokens requested for each non-floor arm.
 *
 * Complexity: O(total context length). The treatment arms are packed twice —
 * once to measure their capacity, once at the capped budget — which is cheap
 * because token estimates are memoized.
 */
export function buildConditionPrompts(
  target: BenchmarkTarget,
  budget: number
): Record<ContextCondition, ConditionPromptPayload> {
  const targetCodeTokens = estimateTokens(target.targetCode);

  // Step 1: discover how much context each TREATMENT arm can actually supply
  // at the requested budget. These are the arms with finite material.
  const callGraphCapacity = estimateTokens(
    StructuredContextPacker.packCallGraph(target, budget)
  );
  const gitHistoryCapacity = estimateTokens(
    StructuredContextPacker.packGitHistory(target, budget)
  );

  // Step 2: the effective budget is what every context arm can meet.
  const effectiveBudget = Math.min(budget, callGraphCapacity, gitHistoryCapacity);

  // Record which arm imposed the cap, for display. Only set when the cap
  // actually bites — a small tolerance absorbs line-boundary rounding.
  let budgetLimitedBy: ContextCondition | undefined;
  if (effectiveBudget < budget - BUDGET_MATCH_TOLERANCE_TOKENS) {
    budgetLimitedBy =
      callGraphCapacity <= gitHistoryCapacity ? 'call_graph' : 'git_history';
  }

  // Step 3: pack every context arm to the SAME effective budget.
  const contextBlocks: Record<ContextCondition, string> = {
    code_only: '',
    few_shot_control: StructuredContextPacker.packFewShotControl(target, effectiveBudget),
    call_graph: StructuredContextPacker.packCallGraph(target, effectiveBudget),
    git_history: StructuredContextPacker.packGitHistory(target, effectiveBudget),
  };

  const payloads = {} as Record<ContextCondition, ConditionPromptPayload>;

  for (const condition of Object.keys(ARM_METADATA) as ContextCondition[]) {
    const metadata = ARM_METADATA[condition];
    const contextBlock = contextBlocks[condition];
    const userPrompt = buildUserPrompt(target, contextBlock, metadata.taskDescription);

    // The floor arm has a context budget of zero by definition — it is the
    // reference point for what no additional context achieves.
    const isFloor = condition === 'code_only';
    const armBudget = isFloor ? 0 : effectiveBudget;

    payloads[condition] = {
      condition,
      title: metadata.title,
      description: metadata.description,
      badge: metadata.badge,
      role: metadata.role,
      tokenBudget: armBudget,
      requestedTokenBudget: isFloor ? 0 : budget,
      budgetLimitedBy: isFloor ? undefined : budgetLimitedBy,
      exactPromptTokens: estimateTokens(SHARED_SYSTEM_INSTRUCTION + userPrompt),
      systemInstruction: SHARED_SYSTEM_INSTRUCTION,
      userPrompt,
      contextTokensAllocated: contextBlock ? estimateTokens(contextBlock) : 0,
      targetCodeTokensAllocated: targetCodeTokens,
      contextSnippetUsed: contextBlock || '(None - Zero extra tokens)',
      detailedTokens: TokenCounter.computeDetailedTokens({
        systemInstruction: SHARED_SYSTEM_INSTRUCTION,
        targetCode: target.targetCode,
        contextText: contextBlock,
        requestedBudget: armBudget,
      }),
    };
  }

  return payloads;
}
