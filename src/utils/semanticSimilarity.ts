/**
 * Semantic similarity between generated docstrings and the gold reference.
 *
 * WHY THIS METRIC EXISTS ALONGSIDE BLEU AND ROUGE
 * BLEU and ROUGE-L measure surface overlap: they reward reusing the reference's
 * exact words. A docstring can be a perfect description in different vocabulary
 * and score badly on both. Embedding cosine similarity captures meaning rather
 * than wording, so the three metrics together separate "said the same thing"
 * from "used the same words".
 *
 * WHAT CHANGED
 * The lexical fallback is kept, because a similarity score is better than no
 * score when the embedding API is unavailable — but the return value now
 * reports WHICH method produced it. Before, an embedding cosine (a real
 * semantic measure) and a trigram cosine (a surface measure that duplicates
 * what BLEU already tells us) were returned indistinguishably, so a table
 * column labelled "semantic" could silently be measuring the opposite of what
 * it claimed.
 */

import { SemanticSimilarityMethod } from '../types';
import { EMBEDDING_MODEL } from '../config/models';
import { isCancellation, postJson } from './apiClient';

/**
 * Cosine similarity of two vectors, clamped to [0, 1].
 *
 * Clamping is safe here because both embedding vectors and non-negative
 * frequency vectors cannot legitimately produce a meaningful negative
 * similarity in this application; a negative value would indicate a degenerate
 * or empty vector.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);

  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return Math.min(1.0, Math.max(0.0, dotProduct / denominator));
}

/**
 * Offline similarity from word and character-trigram frequency vectors.
 *
 * Trigrams are weighted at half a word's weight so that morphological variants
 * ("initialize"/"initializing") contribute partial credit without swamping the
 * whole-word signal. This is a SURFACE measure, not a semantic one.
 *
 * Complexity: O(total characters) to build the feature maps, O(vocabulary) for
 * the cosine.
 */
export function fallbackSemanticSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;

  const buildFeatures = (text: string): Record<string, number> => {
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const features: Record<string, number> = {};

    for (const token of tokens) {
      features[`w:${token}`] = (features[`w:${token}`] || 0) + 1;
      if (token.length >= 3) {
        for (let i = 0; i <= token.length - 3; i++) {
          const trigram = token.slice(i, i + 3);
          features[`t:${trigram}`] = (features[`t:${trigram}`] || 0) + 0.5;
        }
      }
    }
    return features;
  };

  const featuresA = buildFeatures(textA);
  const featuresB = buildFeatures(textB);

  const allKeys = Array.from(new Set([...Object.keys(featuresA), ...Object.keys(featuresB)]));
  const vecA = allKeys.map((k) => featuresA[k] || 0);
  const vecB = allKeys.map((k) => featuresB[k] || 0);

  return cosineSimilarity(vecA, vecB);
}

/** Similarity scores per candidate, plus how they were computed. */
export interface SemanticSimilarityResult {
  /** Candidate key -> similarity in [0, 1]. */
  scores: Record<string, number>;
  /** Which mechanism produced every score in this result. */
  method: SemanticSimilarityMethod;
  /** Populated when the embedding path failed, explaining the degradation. */
  fallbackReason?: string;
}

/** Response shape of /api/gemini/embed-texts. */
interface EmbedResponse {
  embeddings?: number[][];
}

/**
 * Scores every candidate against the reference in one batched request.
 *
 * All texts (reference first, then candidates) go in a single call so the
 * reference is embedded once and the whole trial costs one round trip rather
 * than five.
 */
export async function batchComputeSemanticSimilarity(
  candidates: Record<string, string>,
  referenceDocstring: string,
  signal?: AbortSignal
): Promise<SemanticSimilarityResult> {
  const keys = Object.keys(candidates);
  const scores: Record<string, number> = {};

  const computeFallback = (reason: string): SemanticSimilarityResult => {
    for (const key of keys) {
      scores[key] = Number(
        fallbackSemanticSimilarity(candidates[key], referenceDocstring).toFixed(3)
      );
    }
    return { scores, method: 'lexical_fallback', fallbackReason: reason };
  };

  // Without a reference there is nothing to compare against, and an embedding
  // call would be wasted.
  if (!referenceDocstring || referenceDocstring.trim().length === 0) {
    return computeFallback('No reference docstring was available to compare against.');
  }

  try {
    const textsToEmbed = [referenceDocstring, ...keys.map((k) => candidates[k] || '')];

    const data = await postJson<EmbedResponse>(
      '/api/gemini/embed-texts',
      { texts: textsToEmbed, model: EMBEDDING_MODEL },
      signal
    );

    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== textsToEmbed.length) {
      throw new Error('Embedding response did not return one vector per input');
    }

    const referenceEmbedding = embeddings[0];
    if (referenceEmbedding.length === 0) {
      throw new Error('Reference embedding came back empty');
    }

    for (let i = 0; i < keys.length; i++) {
      scores[keys[i]] = Number(
        cosineSimilarity(embeddings[i + 1], referenceEmbedding).toFixed(3)
      );
    }

    return { scores, method: 'embedding' };
  } catch (error: unknown) {
    if (isCancellation(error)) throw error;

    const reason = error instanceof Error ? error.message : 'Embedding request failed';
    console.warn('Embedding similarity unavailable, using lexical fallback:', reason);
    return computeFallback(reason);
  }
}
