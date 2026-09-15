/**
 * Token estimation, context packing and token accounting.
 *
 * WHY TOKEN PACKING IS THE HEART OF THIS EXPERIMENT
 * The whole design rests on every non-floor arm receiving the SAME number of
 * context tokens. If the call-graph arm quietly gets 900 tokens while the
 * few-shot control gets 700, any difference in output quality is confounded by
 * length — precisely the confound the benchmark exists to rule out. The packers
 * below are therefore not a convenience; they are the experimental control.
 *
 * WHAT CHANGED
 * `estimateTokenCount` is now memoized. It was being called eight or more times
 * per `buildConditionPrompts` on the *same* strings (the shared system
 * instruction and the target code are re-estimated once per arm, plus again
 * inside each `computeDetailedTokens`), and each call runs a regex over the
 * full text. Since the slider rebuilds all four payloads on every step, that
 * repeated work landed directly on the UI's critical path.
 */

import { BenchmarkTarget, DetailedTokenCounts, TokenCountMethod } from '../types';
import { DEFAULT_MODEL } from '../config/models';
import { postJson } from './apiClient';

/**
 * Bounded memoization cache for token estimates.
 *
 * Keyed by the exact text. A cap is enforced because prompt text can be large
 * and a user dragging the budget slider generates many distinct strings — an
 * unbounded cache would be a slow memory leak in a long session.
 */
const tokenEstimateCache = new Map<string, number>();

/** Maximum entries retained before the cache is cleared. */
const TOKEN_CACHE_MAX_ENTRIES = 500;

/**
 * Estimates token count with a subword heuristic (~3.8 characters per token).
 *
 * HOW THE HEURISTIC WORKS
 * Words and punctuation are extracted separately, because tokenizers split on
 * punctuation. Any token longer than six characters is assumed to break into
 * roughly `length / 4` subword pieces — which is why identifiers like
 * `refill_rate_per_sec` cost more than their word count suggests. The final
 * 1.05 factor accounts for the special tokens a real tokenizer adds.
 *
 * This is an APPROXIMATION. Where a real count matters (results, exports,
 * budget-compliance checks) the tokenizer's own `usageMetadata` is used instead
 * and the accounting is labelled 'ACTUAL'; this heuristic is labelled
 * 'ESTIMATED'. The two must never be presented as the same thing.
 *
 * Complexity: O(text length) on a cache miss, O(1) on a hit.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  const cached = tokenEstimateCache.get(text);
  if (cached !== undefined) return cached;

  const wordsAndPunctuation = text.match(/[\w]+|[^\s\w]/g) || [];
  let subwordCount = 0;

  for (const token of wordsAndPunctuation) {
    subwordCount += token.length > 6 ? Math.ceil(token.length / 4) : 1;
  }

  const estimate = Math.max(1, Math.round(subwordCount * 1.05));

  // Simple eviction: clear wholesale when full. A full LRU would cost more in
  // bookkeeping than it saves for this access pattern, where the working set
  // is a handful of repeatedly-reused strings.
  if (tokenEstimateCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    tokenEstimateCache.clear();
  }
  tokenEstimateCache.set(text, estimate);

  return estimate;
}

/** Clears the estimate cache. Exposed for tests and memory-sensitive callers. */
export function clearTokenEstimateCache(): void {
  tokenEstimateCache.clear();
}

/**
 * Truncates text so that its ESTIMATED token count is at most `targetTokens`.
 *
 * WHY THIS IS NOT A SIMPLE PROPORTIONAL SLICE
 * The previous implementation scaled the character count by
 * `targetTokens / currentTokens * 0.95` and returned the result unverified.
 * But `estimateTokenCount` is deliberately NON-LINEAR in character count:
 * punctuation costs a token each and identifiers over six characters cost
 * `length / 4`. So for text denser in punctuation or long identifiers than the
 * average, a proportional slice still lands over budget — measurably so. In
 * practice the few-shot control arm was packing 294 tokens against a 250-token
 * budget (17% over) and 759 against 750.
 *
 * That matters more here than a percentage suggests: the fixed token budget IS
 * the experimental control. An arm that quietly receives more tokens than its
 * peers reintroduces the exact length confound the benchmark exists to
 * eliminate.
 *
 * This version therefore VERIFIES the result and shrinks until it genuinely
 * fits, via binary search on the character count (O(log n) estimates, each
 * O(n) — negligible at these sizes), then trims back to a line boundary and
 * re-verifies.
 */
export function truncateToTokens(text: string, targetTokens: number): string {
  if (targetTokens <= 0) return '';
  if (estimateTokenCount(text) <= targetTokens) return text;

  // Binary search for the longest character prefix that fits the budget.
  let low = 0;
  let high = text.length;
  let bestFit = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid);

    if (estimateTokenCount(candidate) <= targetTokens) {
      bestFit = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Prefer to end on a line boundary: a context block severed mid-identifier
  // or mid-diff-hunk reads as corrupted input and can change how the model
  // treats the entire prompt.
  const lastNewline = bestFit.lastIndexOf('\n');
  const atBoundary = lastNewline > 0 ? bestFit.slice(0, lastNewline) : bestFit;
  const trimmed = atBoundary.trim();

  // Trimming can only ever reduce the count, but verify rather than assume —
  // this function is the guarantee the experimental control rests on.
  return estimateTokenCount(trimmed) <= targetTokens ? trimmed : bestFit.trim();
}

/**
 * Packs each arm's context to a fixed token budget in priority order.
 *
 * Each packer spends the budget on its most informative material first, so that
 * truncation degrades the context gracefully instead of cutting off whatever
 * happened to be last.
 */
export class StructuredContextPacker {
  /**
   * Packs call-graph context: architecture first, then callers, then callees.
   *
   * Callers outrank callees (65% of the remaining budget) because knowing WHO
   * invokes a function reveals its purpose and contract, while its callees
   * mostly restate what the visible implementation already shows.
   */
  static packCallGraph(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    const header = `### Repository Call-Graph & Architectural Context:
- Module Path: ${target.callGraphContext.modulePath}
- Architectural Role: ${target.callGraphContext.architecturalNotes}

`;

    let callersSection = `#### Callers (Where this function is invoked):\n`;
    for (const caller of target.callGraphContext.callers) {
      callersSection += `- Caller: \`${caller.name}\`\n  Signature: \`${caller.signature}\`\n  Usage: ${caller.context}\n\n`;
    }

    let calleesSection = `#### Callees (Functions invoked by this function):\n`;
    for (const callee of target.callGraphContext.callees) {
      calleesSection += `- Callee: \`${callee.name}\`\n  Signature: \`${callee.signature}\`\n  Behavior: ${callee.context}\n\n`;
    }

    const full = header + callersSection + calleesSection;
    if (estimateTokenCount(full) <= budgetTokens) return full.trim();

    let packed = header;
    const callerBudget = Math.floor((budgetTokens - estimateTokenCount(header)) * 0.65);
    packed += truncateToTokens(callersSection, Math.max(10, callerBudget)) + '\n\n';

    const remainingTokens = budgetTokens - estimateTokenCount(packed);
    if (remainingTokens > 30) {
      packed += truncateToTokens(calleesSection, remainingTokens);
    }

    return truncateToTokens(packed, budgetTokens).trim();
  }

  /**
   * Packs git history: commits and their diffs first, then PR discussion.
   *
   * Commits get 70% of the budget because a diff hunk shows exactly what
   * changed and the message usually says why — the densest available source of
   * the hidden intent this arm is meant to reveal.
   */
  static packGitHistory(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    const header = `### Git Commit History & Pull Request Context:\n`;

    let commitsText = '';
    for (const commit of target.gitHistoryContext.commits) {
      commitsText += `Commit ${commit.hash} (${commit.date}) by ${commit.author}:
"${commit.message}"

Diff Patch:
\`\`\`diff
${commit.diffHunk}
\`\`\`\n\n`;
    }

    const prText = `Pull Request Discussion:
"${target.gitHistoryContext.prDiscussion}"\n`;

    const full = header + commitsText + prText;
    if (estimateTokenCount(full) <= budgetTokens) return full.trim();

    let packed = header;
    const commitBudget = Math.floor((budgetTokens - estimateTokenCount(header)) * 0.7);
    packed += truncateToTokens(commitsText, Math.max(10, commitBudget)) + '\n\n';

    const remainingTokens = budgetTokens - estimateTokenCount(packed);
    if (remainingTokens > 25) {
      packed += truncateToTokens(prText, remainingTokens);
    }

    return truncateToTokens(packed, budgetTokens).trim();
  }

  /**
   * Packs the length control: real documentation examples from UNRELATED
   * domains, filled to the same token budget as the treatment arms.
   *
   * This arm is the experiment's most important control. It proves whether the
   * treatments win because of what their context SAYS or merely because their
   * prompts are longer and contain documentation-shaped text. The examples must
   * therefore be genuinely useful in form while carrying zero information about
   * this repository.
   */
  static packFewShotControl(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    let text = `### Reference Examples of Code Documentation Standards (from external projects):\n\n`;
    for (let i = 0; i < target.fewShotControlExamples.length; i++) {
      const example = target.fewShotControlExamples[i];
      text += `Example ${i + 1} [Domain: ${example.domain}]:\n\`\`\`${example.language}\n${example.code}\n\`\`\`\nDocstring:\n${example.docstring}\n\n`;
    }

    return truncateToTokens(text, budgetTokens).trim();
  }

  /**
   * Packs both repository context types, splitting the budget evenly.
   *
   * Provided for an optional fifth arm testing whether the two context types
   * are complementary or redundant. Splitting evenly keeps the total identical
   * to the single-source arms, preserving the length control.
   */
  static packAllContext(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 40) return '';

    const halfBudget = Math.floor(budgetTokens / 2);
    const callGraph = StructuredContextPacker.packCallGraph(target, halfBudget);
    const gitHistory = StructuredContextPacker.packGitHistory(target, halfBudget);

    return `${callGraph}\n\n---\n\n${gitHistory}`.trim();
  }
}

/** Token accounting utilities. */
export class TokenCounter {
  /**
   * Counts tokens with the official Gemini tokenizer, falling back to the
   * heuristic.
   *
   * The returned `method` tells the caller which it got, so an estimate is
   * never recorded as a measurement.
   */
  static async countTokens(
    text: string,
    model: string = DEFAULT_MODEL,
    signal?: AbortSignal
  ): Promise<{ tokens: number; method: TokenCountMethod }> {
    if (!text) return { tokens: 0, method: 'ACTUAL' };

    try {
      const data = await postJson<{ totalTokens?: number }>(
        '/api/gemini/count-tokens',
        { text, model },
        signal
      );

      if (typeof data.totalTokens === 'number') {
        return { tokens: data.totalTokens, method: 'ACTUAL' };
      }
    } catch {
      // Fall through to the heuristic; the caller sees method 'ESTIMATED'.
    }

    return { tokens: estimateTokenCount(text), method: 'ESTIMATED' };
  }

  /**
   * Builds a full token breakdown and budget-compliance report.
   *
   * `actualInputTokens` / `actualOutputTokens` should be supplied from the
   * generation response's `usageMetadata` when available; the per-component
   * split (system / code / context) remains heuristic because the API reports
   * only a single prompt total. `compliancePercentage` is the figure that
   * verifies the fixed-budget control actually held.
   */
  static computeDetailedTokens(params: {
    systemInstruction: string;
    targetCode: string;
    contextText: string;
    outputDocstring?: string;
    requestedBudget: number;
    method?: TokenCountMethod;
    actualInputTokens?: number;
    actualOutputTokens?: number;
  }): DetailedTokenCounts {
    const systemInstructionTokens = estimateTokenCount(params.systemInstruction);
    const targetCodeTokens = estimateTokenCount(params.targetCode);
    const contextTokens = estimateTokenCount(params.contextText);
    const outputTokens =
      params.actualOutputTokens ?? estimateTokenCount(params.outputDocstring || '');

    const totalInputTokens =
      params.actualInputTokens ?? systemInstructionTokens + targetCodeTokens + contextTokens;

    const requestedBudget = params.requestedBudget;

    return {
      systemInstructionTokens,
      targetCodeTokens,
      contextTokens,
      totalInputTokens,
      outputTokens,
      totalTokens: totalInputTokens + outputTokens,
      method: params.method || 'ESTIMATED',
      requestedBudget,
      tokenDifference: totalInputTokens - requestedBudget,
      // Compliance is measured against the CONTEXT budget, so an arm with no
      // budget (the floor) is reported as fully compliant rather than dividing
      // by zero.
      compliancePercentage:
        requestedBudget > 0
          ? Number(((contextTokens / requestedBudget) * 100).toFixed(1))
          : 100,
    };
  }
}
