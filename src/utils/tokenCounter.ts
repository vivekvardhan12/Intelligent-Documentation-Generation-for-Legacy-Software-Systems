import { BenchmarkTarget, ContextCondition, DetailedTokenCounts, TokenCountMethod } from '../types';

/**
 * Fallback token estimation heuristic (~3.8 chars/token with subword & punctuation splits).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const wordsAndPunct = text.match(/[\w]+|[^\s\w]/g) || [];
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
 * Truncates text cleanly at line boundaries to fit within targetTokens.
 */
export function truncateToTokens(text: string, targetTokens: number): string {
  if (targetTokens <= 0) return '';
  const currentTokens = estimateTokenCount(text);
  if (currentTokens <= targetTokens) return text;

  const ratio = targetTokens / currentTokens;
  const targetChars = Math.floor(text.length * ratio * 0.95);
  const truncated = text.slice(0, targetChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated).trim();
}

/**
 * Structured Context Packer:
 * Preserves target function integrity and packs context items in strict order of priority.
 */
export class StructuredContextPacker {
  /**
   * Packs Call-Graph context prioritizing:
   * 1. Module Path & High-Level Architecture
   * 2. Callers (Where function is used)
   * 3. Callees (Internal dependencies)
   */
  static packCallGraph(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    let header = `### Repository Call-Graph & Architectural Context:
- Module Path: ${target.callGraphContext.modulePath}
- Architectural Role: ${target.callGraphContext.architecturalNotes}

`;

    let callersSection = `#### Callers (Where this function is invoked):\n`;
    for (const c of target.callGraphContext.callers) {
      callersSection += `- Caller: \`${c.name}\`\n  Signature: \`${c.signature}\`\n  Usage: ${c.context}\n\n`;
    }

    let calleesSection = `#### Callees (Functions invoked by this function):\n`;
    for (const c of target.callGraphContext.callees) {
      calleesSection += `- Callee: \`${c.name}\`\n  Signature: \`${c.signature}\`\n  Behavior: ${c.context}\n\n`;
    }

    const full = header + callersSection + calleesSection;
    if (estimateTokenCount(full) <= budgetTokens) {
      return full.trim();
    }

    // Prioritized packing: Header -> Callers -> Callees
    let packed = header;
    const callerTokensBudget = Math.floor((budgetTokens - estimateTokenCount(header)) * 0.65);
    packed += truncateToTokens(callersSection, Math.max(10, callerTokensBudget)) + '\n\n';

    const remainingTokens = budgetTokens - estimateTokenCount(packed);
    if (remainingTokens > 30) {
      packed += truncateToTokens(calleesSection, remainingTokens);
    }

    return truncateToTokens(packed, budgetTokens).trim();
  }

  /**
   * Packs Git-History context prioritizing:
   * 1. Latest / Most relevant commit messages
   * 2. Diff hunks detailing subtle bug fixes
   * 3. PR review discussion
   */
  static packGitHistory(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    let header = `### Git Commit History & Pull Request Context:\n`;
    let commitsText = '';
    for (const commit of target.gitHistoryContext.commits) {
      commitsText += `Commit ${commit.hash} (${commit.date}) by ${commit.author}:
"${commit.message}"

Diff Patch:
\`\`\`diff
${commit.diffHunk}
\`\`\`\n\n`;
    }

    let prText = `Pull Request Discussion:
"${target.gitHistoryContext.prDiscussion}"\n`;

    const full = header + commitsText + prText;
    if (estimateTokenCount(full) <= budgetTokens) {
      return full.trim();
    }

    // Prioritized packing: Header -> Commits -> PR Discussion
    let packed = header;
    const commitTokensBudget = Math.floor((budgetTokens - estimateTokenCount(header)) * 0.7);
    packed += truncateToTokens(commitsText, Math.max(10, commitTokensBudget)) + '\n\n';

    const remainingTokens = budgetTokens - estimateTokenCount(packed);
    if (remainingTokens > 25) {
      packed += truncateToTokens(prText, remainingTokens);
    }

    return truncateToTokens(packed, budgetTokens).trim();
  }

  /**
   * Packs Few-Shot Control with unrelated domain examples to match exact token length.
   */
  static packFewShotControl(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 20) return '';

    let text = `### Reference Examples of Code Documentation Standards (from external projects):\n\n`;
    for (let i = 0; i < target.fewShotControlExamples.length; i++) {
      const ex = target.fewShotControlExamples[i];
      text += `Example ${i + 1} [Domain: ${ex.domain}]:\n\`\`\`${ex.language}\n${ex.code}\n\`\`\`\nDocstring:\n${ex.docstring}\n\n`;
    }

    return truncateToTokens(text, budgetTokens).trim();
  }

  /**
   * Packs All-Context (Call Graph + Git History combined) up to the budget.
   */
  static packAllContext(target: BenchmarkTarget, budgetTokens: number): string {
    if (budgetTokens <= 40) return '';
    const halfBudget = Math.floor(budgetTokens / 2);
    const cg = StructuredContextPacker.packCallGraph(target, halfBudget);
    const git = StructuredContextPacker.packGitHistory(target, halfBudget);
    return `${cg}\n\n---\n\n${git}`.trim();
  }
}

/**
 * Token Counter service with API client integration and heuristic fallback.
 */
export class TokenCounter {
  /**
   * Counts tokens via the backend endpoint, falling back to local heuristic if server is unavailable.
   */
  static async countTokens(
    text: string,
    model: string = 'gemini-3.7-flash'
  ): Promise<{ tokens: number; method: TokenCountMethod }> {
    if (!text) return { tokens: 0, method: 'ACTUAL' };

    try {
      const res = await fetch('/api/gemini/count-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model }),
      });

      if (res.ok) {
        const data = await res.json();
        if (typeof data.totalTokens === 'number') {
          return { tokens: data.totalTokens, method: 'ACTUAL' };
        }
      }
    } catch {
      // Fallback to local heuristic
    }

    return { tokens: estimateTokenCount(text), method: 'ESTIMATED' };
  }

  /**
   * Calculates comprehensive token breakdown and budget compliance.
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
    const sysTokens = estimateTokenCount(params.systemInstruction);
    const codeTokens = estimateTokenCount(params.targetCode);
    const ctxTokens = estimateTokenCount(params.contextText);
    const outTokens = params.actualOutputTokens ?? estimateTokenCount(params.outputDocstring || '');

    const totalInput = params.actualInputTokens ?? (sysTokens + codeTokens + ctxTokens);
    const total = totalInput + outTokens;
    const requested = params.requestedBudget;
    const tokenDifference = totalInput - requested;
    const compliancePercentage = requested > 0 ? Number(((totalInput / requested) * 100).toFixed(1)) : 100;

    return {
      systemInstructionTokens: sysTokens,
      targetCodeTokens: codeTokens,
      contextTokens: ctxTokens,
      totalInputTokens: totalInput,
      outputTokens: outTokens,
      totalTokens: total,
      method: params.method || 'ESTIMATED',
      requestedBudget: requested,
      tokenDifference,
      compliancePercentage,
    };
  }
}
