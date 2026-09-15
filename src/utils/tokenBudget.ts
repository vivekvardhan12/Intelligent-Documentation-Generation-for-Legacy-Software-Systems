import { BenchmarkTarget, ConditionPromptPayload, ContextCondition } from '../types';
import { estimateTokenCount, StructuredContextPacker, TokenCounter } from './tokenCounter';

/**
 * Estimates token count using standard subword heuristic for code & prose (~3.8 chars/token).
 */
export function estimateTokens(text: string): number {
  return estimateTokenCount(text);
}

/**
 * Truncates or packs text so that its token count does not exceed targetTokens.
 */
export function fitToTokenBudget(text: string, targetTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= targetTokens) {
    return text;
  }
  const ratio = targetTokens / currentTokens;
  const targetChars = Math.floor(text.length * ratio * 0.95);
  const truncated = text.slice(0, targetChars);
  return truncated.slice(0, truncated.lastIndexOf('\n')) || truncated;
}

/**
 * Generates prompt payloads for all experimental conditions under a fixed token budget.
 */
export function buildConditionPrompts(
  target: BenchmarkTarget,
  budget: number,
  includeAllContext: boolean = true
): Record<ContextCondition, ConditionPromptPayload> {
  const codeTokens = estimateTokens(target.targetCode);

  // 1. Code Only (Floor)
  const codeOnlySystem = `You are an expert software engineer and technical documentation specialist. Write a clean, high-precision, production-grade docstring / documentation comment for the following function. Do not repeat the entire function implementation; output only the docstring formatted appropriately for the programming language.`;
  const codeOnlyUserPrompt = `Write the docstring for the following ${target.language} function:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 2. Few-Shot Control (Length Control - Zero repo semantic info, exact token budget)
  const trimmedFewShotContext = StructuredContextPacker.packFewShotControl(target, budget);
  const fewShotUserPrompt = `${trimmedFewShotContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 3. Call-Graph Context (Structural Repo Context - trimmed to exact budget)
  const trimmedCallGraphContext = StructuredContextPacker.packCallGraph(target, budget);
  const callGraphUserPrompt = `${trimmedCallGraphContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function based on its implementation and repository call-graph:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 4. Git-History Context (Evolutionary Repo Context - trimmed to exact budget)
  const trimmedGitHistoryContext = StructuredContextPacker.packGitHistory(target, budget);
  const gitHistoryUserPrompt = `${trimmedGitHistoryContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function based on its implementation and commit evolution history:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 5. All-Context (Combined Call-Graph and Git-History Context)
  const trimmedAllContext = StructuredContextPacker.packAllContext(target, budget);
  const allContextUserPrompt = `${trimmedAllContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function based on its full repository context (both structural call-graph and git commit history):

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  const payloads: Record<ContextCondition, ConditionPromptPayload> = {
    code_only: {
      condition: 'code_only',
      title: 'Code Only',
      description: 'The baseline floor. The target function with zero extra tokens.',
      badge: 'Baseline Floor',
      role: 'floor',
      tokenBudget: 0,
      exactPromptTokens: estimateTokens(codeOnlySystem + codeOnlyUserPrompt),
      systemInstruction: codeOnlySystem,
      userPrompt: codeOnlyUserPrompt,
      contextTokensAllocated: 0,
      targetCodeTokensAllocated: codeTokens,
      contextSnippetUsed: '(None - Zero extra tokens)',
      detailedTokens: TokenCounter.computeDetailedTokens({
        systemInstruction: codeOnlySystem,
        targetCode: target.targetCode,
        contextText: '',
        requestedBudget: 0,
      }),
    },
    few_shot_control: {
      condition: 'few_shot_control',
      title: 'Few-Shot Control',
      description: 'The length control. Same token budget spent on unrelated (function, docstring) pairs.',
      badge: 'Length Control',
      role: 'control',
      tokenBudget: budget,
      exactPromptTokens: estimateTokens(codeOnlySystem + fewShotUserPrompt),
      systemInstruction: codeOnlySystem,
      userPrompt: fewShotUserPrompt,
      contextTokensAllocated: estimateTokens(trimmedFewShotContext),
      targetCodeTokensAllocated: codeTokens,
      contextSnippetUsed: trimmedFewShotContext,
      detailedTokens: TokenCounter.computeDetailedTokens({
        systemInstruction: codeOnlySystem,
        targetCode: target.targetCode,
        contextText: trimmedFewShotContext,
        requestedBudget: budget,
      }),
    },
    call_graph: {
      condition: 'call_graph',
      title: 'Call-Graph Context',
      description: 'Callers, callees, module architecture, filled to exact token budget.',
      badge: 'Structural Context',
      role: 'treatment',
      tokenBudget: budget,
      exactPromptTokens: estimateTokens(codeOnlySystem + callGraphUserPrompt),
      systemInstruction: codeOnlySystem,
      userPrompt: callGraphUserPrompt,
      contextTokensAllocated: estimateTokens(trimmedCallGraphContext),
      targetCodeTokensAllocated: codeTokens,
      contextSnippetUsed: trimmedCallGraphContext,
      detailedTokens: TokenCounter.computeDetailedTokens({
        systemInstruction: codeOnlySystem,
        targetCode: target.targetCode,
        contextText: trimmedCallGraphContext,
        requestedBudget: budget,
      }),
    },
    git_history: {
      condition: 'git_history',
      title: 'Git-History Context',
      description: 'Commit messages, diff hunks, PR intent, filled to exact token budget.',
      badge: 'Evolutionary Context',
      role: 'treatment',
      tokenBudget: budget,
      exactPromptTokens: estimateTokens(codeOnlySystem + gitHistoryUserPrompt),
      systemInstruction: codeOnlySystem,
      userPrompt: gitHistoryUserPrompt,
      contextTokensAllocated: estimateTokens(trimmedGitHistoryContext),
      targetCodeTokensAllocated: codeTokens,
      contextSnippetUsed: trimmedGitHistoryContext,
      detailedTokens: TokenCounter.computeDetailedTokens({
        systemInstruction: codeOnlySystem,
        targetCode: target.targetCode,
        contextText: trimmedGitHistoryContext,
        requestedBudget: budget,
      }),
    },
  };

  return payloads;
}
