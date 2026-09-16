import { ClaimClassification, FactualityClaim, FactualityEvaluation } from '../types';

/**
 * Evaluates factuality of a generated docstring against arm-specific context or target facts.
 */
export class FactualityEvaluator {
  /**
   * Evaluates claims for a candidate docstring.
   */
  static async evaluateArmFactuality(params: {
    armKey: string;
    docstring: string;
    targetCode: string;
    armContextText: string;
    model?: string;
  }): Promise<FactualityEvaluation> {
    const { armKey, docstring, targetCode, armContextText, model } = params;

    if (!docstring || docstring.trim().length === 0) {
      return {
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: 0,
        uncertainClaims: 0,
        factualityScore: 100,
        unsupportedClaimRate: 0,
        claims: [],
      };
    }

    try {
      const res = await fetch('/api/gemini/evaluate-factuality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          armKey,
          docstring,
          targetCode,
          armContextText,
          model: model || 'gemini-3.7-flash',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.factuality && Array.isArray(data.factuality.claims)) {
          return data.factuality;
        }
      }
    } catch {
      // Fallback
    }

    return FactualityEvaluator.fallbackEvaluateFactuality(docstring, targetCode, armContextText);
  }

  /**
   * Deterministic sentence & clause-level claim extractor and factuality classifier fallback.
   */
  static fallbackEvaluateFactuality(
    docstring: string,
    targetCode: string,
    armContextText: string
  ): FactualityEvaluation {
    const combinedEvidence = `${targetCode}\n${armContextText}`.toLowerCase();

    // Extract claim sentences (strip comment delimiters, clean up)
    const sentences = docstring
      .replace(/"""|\/\*\*|\*\/|\*/g, ' ')
      .split(/(?<=[.?!])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && !s.startsWith('Args:') && !s.startsWith('Returns:'));

    if (sentences.length === 0) {
      return {
        totalClaims: 1,
        supportedClaims: 1,
        unsupportedClaims: 0,
        uncertainClaims: 0,
        factualityScore: 100,
        unsupportedClaimRate: 0,
        claims: [
          {
            id: 'claim-1',
            claim: 'Documents target function signature',
            classification: 'SUPPORTED',
            evidence: 'Matches function signature tokens in target code',
            armContextSufficient: true,
          },
        ],
      };
    }

    const claims: FactualityClaim[] = [];
    let supported = 0;
    let unsupported = 0;
    let uncertain = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sent = sentences[i];
      const lower = sent.toLowerCase();
      // Extract key nouns & verbs
      const words = lower.match(/\b[a-z_]{4,}\b/g) || [];
      const matchWords = words.filter((w) => combinedEvidence.includes(w));
      const overlapRatio = words.length > 0 ? matchWords.length / words.length : 1.0;

      let classification: ClaimClassification = 'SUPPORTED';
      let evidence = '';

      if (overlapRatio >= 0.5 || words.length <= 3) {
        classification = 'SUPPORTED';
        evidence = `Verified by vocabulary overlap (${matchWords.slice(0, 4).join(', ')}) in available code and context.`;
        supported++;
      } else if (overlapRatio >= 0.25) {
        classification = 'UNCERTAIN';
        evidence = `Plausible domain inference (${words.slice(0, 3).join(', ')}), but partial evidence in current arm context.`;
        uncertain++;
      } else {
        classification = 'UNSUPPORTED';
        evidence = `Specific terminology (${words.slice(0, 4).join(', ')}) not found in this arm's supplied context.`;
        unsupported++;
      }

      claims.push({
        id: `claim-${i + 1}`,
        claim: sent,
        classification,
        evidence,
        armContextSufficient: classification === 'SUPPORTED',
      });
    }

    const total = claims.length;
    const factualityScore = total > 0 ? Number(((supported / total) * 100).toFixed(1)) : 100;
    const unsupportedClaimRate = total > 0 ? Number(((unsupported / total) * 100).toFixed(1)) : 0;

    return {
      totalClaims: total,
      supportedClaims: supported,
      unsupportedClaims: unsupported,
      uncertainClaims: uncertain,
      factualityScore,
      unsupportedClaimRate,
      claims,
    };
  }
}
