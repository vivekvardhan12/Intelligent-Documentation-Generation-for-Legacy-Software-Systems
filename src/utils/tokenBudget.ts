import { BenchmarkTarget, ConditionPromptPayload, ContextCondition } from '../types';

/**
 * Estimates token count using standard subword heuristic for code & prose (~3.8 chars/token).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Code and prose token estimation
  // Split on whitespace and punctuation boundaries
  const wordsAndPunct = text.match(/[\w]+|[^\s\w]/g) || [];
  // Factor in subword splits on camelCase, snake_case, indentation
  let subwordCount = 0;
  for (const token of wordsAndPunct) {
    if (token.length > 6) {
      subwordCount += Math.ceil(token.length / 4);
    } else {
      subwordCount += 1;
    }
  }
  return Math.max(1, Math.round(subwordCount * 1.05));
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
 * Generates prompt payloads for all 4 experimental conditions under a fixed token budget.
 */
export function buildConditionPrompts(
  target: BenchmarkTarget,
  budget: number
): Record<ContextCondition, ConditionPromptPayload> {
  const codeTokens = estimateTokens(target.targetCode);

  // 1. Code Only (Floor)
  const codeOnlySystem = `You are an expert software engineer and technical documentation specialist. Write a clean, high-precision, production-grade docstring / documentation comment for the following function. Do not repeat the entire function implementation; output only the docstring formatted appropriately for the programming language.`;
  const codeOnlyUserPrompt = `Write the docstring for the following ${target.language} function:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 2. Few-Shot Control (Length Control - Zero repo semantic info, exact token budget)
  let fewShotText = `### Reference Examples of Code Documentation Standards (from external projects):\n\n`;
  for (let i = 0; i < target.fewShotControlExamples.length; i++) {
    const ex = target.fewShotControlExamples[i];
    fewShotText += `Example ${i + 1} [Domain: ${ex.domain}]:\n\`\`\`${ex.language}\n${ex.code}\n\`\`\`\nDocstring:\n${ex.docstring}\n\n`;
  }
  // Trim or adjust to fit exact budget
  const trimmedFewShotContext = fitToTokenBudget(fewShotText, budget);
  const fewShotUserPrompt = `${trimmedFewShotContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 3. Call-Graph Context (Structural Repo Context - trimmed to exact budget)
  let callGraphRaw = `### Repository Call-Graph & Architectural Context:
- Module Path: ${target.callGraphContext.modulePath}
- Architectural Role: ${target.callGraphContext.architecturalNotes}

#### Callers (Where this function is invoked):
`;
  for (const caller of target.callGraphContext.callers) {
    callGraphRaw += `- Caller: \`${caller.name}\`
  Signature: \`${caller.signature}\`
  Usage Context: ${caller.context}\n\n`;
  }

  callGraphRaw += `#### Callees (Functions invoked by this function):
`;
  for (const callee of target.callGraphContext.callees) {
    callGraphRaw += `- Callee: \`${callee.name}\`
  Signature: \`${callee.signature}\`
  Behavior: ${callee.context}\n\n`;
  }

  const trimmedCallGraphContext = fitToTokenBudget(callGraphRaw, budget);
  const callGraphUserPrompt = `${trimmedCallGraphContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function based on its implementation and repository call-graph:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  // 4. Git-History Context (Evolutionary Repo Context - trimmed to exact budget)
  let gitHistoryRaw = `### Git Commit History & Pull Request Context:
`;
  for (const commit of target.gitHistoryContext.commits) {
    gitHistoryRaw += `Commit ${commit.hash} (${commit.date}) by ${commit.author}:
"${commit.message}"

Diff Patch:
\`\`\`diff
${commit.diffHunk}
\`\`\`\n\n`;
  }
  gitHistoryRaw += `Pull Request Discussion:
"${target.gitHistoryContext.prDiscussion}"\n`;

  const trimmedGitHistoryContext = fitToTokenBudget(gitHistoryRaw, budget);
  const gitHistoryUserPrompt = `${trimmedGitHistoryContext}

---

### Target Function to Document:
Write the docstring for the following ${target.language} function based on its implementation and commit evolution history:

\`\`\`${target.language}
${target.targetCode}
\`\`\``;

  return {
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
      contextSnippetUsed: '(None - Zero extra tokens)'
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
      contextSnippetUsed: trimmedFewShotContext
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
      contextSnippetUsed: trimmedCallGraphContext
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
      contextSnippetUsed: trimmedGitHistoryContext
    }
  };
}
