/**
 * Arm-isolated factuality checking.
 *
 * WHAT THIS MEASURES AND WHY IT IS THE FAIREST METRIC HERE
 * A docstring is checked against ONLY the evidence its own arm was shown. If
 * the code-only arm asserts "called by AuthGatewayMiddleware" and that happens
 * to be true, the claim is still UNSUPPORTED for that arm — it guessed. The
 * call-graph arm making the same claim is SUPPORTED, because it was told.
 *
 * This is what stops the benchmark rewarding a lucky hallucination, and it is
 * why the arm's context text must be passed in rather than the full repository
 * ground truth.
 *
 * WHAT CHANGED
 * The heuristic fallback is retained — it keeps the metric available when the
 * API is unreachable — but it is now TAGGED. Previously the LLM claim check and
 * a crude vocabulary-overlap score were returned as the same shape with no
 * discriminator, so the UI displayed "100% factuality" from word matching in
 * exactly the same place, and with the same authority, as a real judged result.
 */

import { FactualityEvaluation, ClaimClassification, FactualityClaim } from '../types';
import { DEFAULT_JUDGE_MODEL } from '../config/models';
import { isCancellation, postJson } from './apiClient';

/** Parameters for a factuality check. */
export interface FactualityParams {
  /** Which experimental arm this docstring came from (for logging/export). */
  armKey: string;
  docstring: string;
  targetCode: string;
  /** The packed context this arm received. Empty string for the floor arm. */
  armContextText: string;
  model?: string;
  signal?: AbortSignal;
}

/** Response shape of /api/gemini/evaluate-factuality. */
interface FactualityResponse {
  factuality?: Omit<FactualityEvaluation, 'method'>;
}

/**
 * Overlap ratio at or above which a claim counts as supported by the heuristic.
 * Tuned to be forgiving: the fallback should not invent hallucinations.
 */
const HEURISTIC_SUPPORTED_THRESHOLD = 0.5;

/** Overlap ratio below which the heuristic treats a claim as unsupported. */
const HEURISTIC_UNCERTAIN_THRESHOLD = 0.25;

export class FactualityEvaluator {
  /**
   * Checks a docstring's claims, preferring the LLM judge and degrading to the
   * lexical heuristic only if the call fails.
   *
   * Cancellation propagates rather than degrading, so stopping a run does not
   * silently swap in heuristic scores for the remaining arms.
   */
  static async evaluateArmFactuality(params: FactualityParams): Promise<FactualityEvaluation> {
    const { armKey, docstring, targetCode, armContextText, model, signal } = params;

    // Nothing was generated: there are no claims to check. This is reported as
    // zero claims rather than a perfect score, so the UI can show "no claims"
    // instead of "100%".
    if (!docstring || docstring.trim().length === 0) {
      return {
        method: 'llm_judge',
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: 0,
        uncertainClaims: 0,
        factualityScore: 0,
        unsupportedClaimRate: 0,
        claims: [],
      };
    }

    try {
      const data = await postJson<FactualityResponse>(
        '/api/gemini/evaluate-factuality',
        {
          armKey,
          docstring,
          targetCode,
          armContextText,
          model: model || DEFAULT_JUDGE_MODEL,
        },
        signal
      );

      if (data.factuality && Array.isArray(data.factuality.claims)) {
        return { ...data.factuality, method: 'llm_judge' };
      }

      throw new Error('Factuality response did not contain a claim list');
    } catch (error: unknown) {
      if (isCancellation(error)) throw error;

      console.warn(
        `Factuality API failed for arm ${armKey}; using lexical heuristic:`,
        error instanceof Error ? error.message : error
      );

      return FactualityEvaluator.fallbackEvaluateFactuality(
        docstring,
        targetCode,
        armContextText
      );
    }
  }

  /**
   * Offline claim checker based on vocabulary overlap.
   *
   * HOW IT WORKS: each sentence of the docstring is treated as a claim. Words
   * of four or more letters are extracted and checked against the concatenated
   * evidence (target code + this arm's context). A high overlap ratio means the
   * sentence is largely built from vocabulary the arm could actually see.
   *
   * LIMITATIONS, stated plainly because the result is displayed to users:
   * it cannot detect a claim that uses the right words to say something false,
   * it has no notion of negation, and it rewards parroting the code. It is a
   * degraded substitute, which is why the returned object is tagged
   * `method: 'lexical_heuristic'` and badged in the UI.
   *
   * Complexity: O(sentences x words) — trivially fast, no network.
   */
  static fallbackEvaluateFactuality(
    docstring: string,
    targetCode: string,
    armContextText: string
  ): FactualityEvaluation {
    const combinedEvidence = `${targetCode}\n${armContextText}`.toLowerCase();

    // Split into candidate claim sentences, stripping comment delimiters and
    // dropping section headers which assert nothing.
    const sentences = docstring
      .replace(/"""|\/\*\*|\*\/|\*/g, ' ')
      .split(/(?<=[.?!])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && !s.startsWith('Args:') && !s.startsWith('Returns:'));

    if (sentences.length === 0) {
      return {
        method: 'lexical_heuristic',
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: 0,
        uncertainClaims: 0,
        factualityScore: 0,
        unsupportedClaimRate: 0,
        claims: [],
      };
    }

    const claims: FactualityClaim[] = [];
    let supported = 0;
    let unsupported = 0;
    let uncertain = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const words = (sentence.toLowerCase().match(/\b[a-z_]{4,}\b/g) || []) as string[];
      const matchedWords = words.filter((w) => combinedEvidence.includes(w));
      const overlapRatio = words.length > 0 ? matchedWords.length / words.length : 1.0;

      let classification: ClaimClassification;
      let evidence: string;

      if (overlapRatio >= HEURISTIC_SUPPORTED_THRESHOLD || words.length <= 3) {
        classification = 'SUPPORTED';
        evidence = `Vocabulary overlap with available evidence (${matchedWords
          .slice(0, 4)
          .join(', ')}). Heuristic only — not a semantic verification.`;
        supported++;
      } else if (overlapRatio >= HEURISTIC_UNCERTAIN_THRESHOLD) {
        classification = 'UNCERTAIN';
        evidence = `Partial vocabulary overlap (${words
          .slice(0, 3)
          .join(', ')}); insufficient evidence in this arm's context.`;
        uncertain++;
      } else {
        classification = 'UNSUPPORTED';
        evidence = `Terminology (${words
          .slice(0, 4)
          .join(', ')}) does not appear in this arm's supplied context.`;
        unsupported++;
      }

      claims.push({
        id: `claim-${i + 1}`,
        claim: sentence,
        classification,
        evidence,
        armContextSufficient: classification === 'SUPPORTED',
      });
    }

    const total = claims.length;

    return {
      method: 'lexical_heuristic',
      totalClaims: total,
      supportedClaims: supported,
      unsupportedClaims: unsupported,
      uncertainClaims: uncertain,
      factualityScore: Number(((supported / total) * 100).toFixed(1)),
      unsupportedClaimRate: Number(((unsupported / total) * 100).toFixed(1)),
      claims,
    };
  }
}
