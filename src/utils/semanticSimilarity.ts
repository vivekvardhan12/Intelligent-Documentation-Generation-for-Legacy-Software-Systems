/**
 * Semantic Similarity Evaluator
 * Computes cosine similarity between generated docstrings and reference docstring
 * using embedding vectors from the Gemini API or fallback lexical/n-gram vector cosine similarity.
 */

/**
 * Computes cosine similarity between two numeric vectors.
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
 * Fallback semantic similarity using character 3-gram and token frequency vectors.
 */
export function fallbackSemanticSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  const cleanA = textA.toLowerCase().replace(/[^\w\s]/g, ' ');
  const cleanB = textB.toLowerCase().replace(/[^\w\s]/g, ' ');

  // Create vocabulary of words and 3-grams
  const getFeatures = (text: string) => {
    const tokens = text.split(/\s+/).filter(Boolean);
    const feats: Record<string, number> = {};
    for (const t of tokens) {
      feats[`w:${t}`] = (feats[`w:${t}`] || 0) + 1;
      if (t.length >= 3) {
        for (let i = 0; i <= t.length - 3; i++) {
          const tri = t.slice(i, i + 3);
          feats[`t:${tri}`] = (feats[`t:${tri}`] || 0) + 0.5;
        }
      }
    }
    return feats;
  };

  const featsA = getFeatures(cleanA);
  const featsB = getFeatures(cleanB);

  const allKeys = Array.from(new Set([...Object.keys(featsA), ...Object.keys(featsB)]));
  const vecA = allKeys.map((k) => featsA[k] || 0);
  const vecB = allKeys.map((k) => featsB[k] || 0);

  return cosineSimilarity(vecA, vecB);
}

/**
 * Batch computes semantic similarity for multiple docstrings against a reference docstring.
 */
export async function batchComputeSemanticSimilarity(
  candidates: Record<string, string>,
  referenceDocstring: string
): Promise<Record<string, number>> {
  const keys = Object.keys(candidates);
  const results: Record<string, number> = {};

  // Try server-side embedding API
  try {
    const textsToEmbed = [referenceDocstring, ...keys.map((k) => candidates[k] || '')];
    const res = await fetch('/api/gemini/embed-texts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: textsToEmbed }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.embeddings) && data.embeddings.length === textsToEmbed.length) {
        const refEmbedding = data.embeddings[0];
        for (let i = 0; i < keys.length; i++) {
          const candEmbedding = data.embeddings[i + 1];
          results[keys[i]] = Number(cosineSimilarity(candEmbedding, refEmbedding).toFixed(3));
        }
        return results;
      }
    }
  } catch {
    // API error, fallback to lexical vector similarity
  }

  // Fallback
  for (const k of keys) {
    const sim = fallbackSemanticSimilarity(candidates[k], referenceDocstring);
    results[k] = Number(sim.toFixed(3));
  }

  return results;
}
