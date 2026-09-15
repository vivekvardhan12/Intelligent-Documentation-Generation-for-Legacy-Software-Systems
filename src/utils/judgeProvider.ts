/**
 * Blind LLM-as-a-judge evaluation.
 *
 * WHY BLIND JUDGING
 * If the grader is told which docstring came from the "call-graph context" arm,
 * it can reward the label rather than the text. Candidates are therefore
 * shuffled and relabelled 'Candidate A'..'Candidate D' before being sent, and
 * mapped back only after scores return. The judge is also NOT given the hidden
 * ground-truth intent — handing it the secret that only the treatment arms
 * could know would amount to giving those arms the answer key.
 *
 * WHAT CHANGED AND WHY
 * This module used to manufacture scores whenever anything went wrong:
 *
 *     // on network error:
 *     overallQuality: armKey === 'code_only' ? 76
 *                   : armKey === 'few_shot_control' ? 82
 *                   : 92
 *
 * Those numbers reproduce the experiment's hypothesis exactly — floor lowest,
 * control middle, treatments highest — so an outage produced a textbook
 * confirmation of the thing being tested, announced in the UI as a measurement
 * and visible only as a `console.warn`. A second fallback did the same for any
 * individual candidate the judge omitted.
 *
 * Both are gone. A failure is now reported as a failure: the affected arms are
 * listed in `unscoredArms`, the caller marks those trials `status: 'failed'`,
 * and they are excluded from every aggregate rather than silently inflating it.
 */

import { BenchmarkTarget, ContextCondition, DocstringEvaluation } from '../types';
import { DEFAULT_JUDGE_MODEL } from '../config/models';
import { ApiError, isCancellation, postJson } from './apiClient';

/** A candidate as presented to the judge: anonymized and order-shuffled. */
export interface BlindCandidate {
  /** Blind label shown to the judge, e.g. 'Candidate A'. */
  candidateId: string;
  docstring: string;
  /** Kept client-side only, never sent, used to de-anonymize the response. */
  originalArmKey: ContextCondition;
}

/** Scores the judge returned, plus an explicit account of what it did not. */
export interface BlindJudgeResult {
  /**
   * Scores keyed by arm. An arm is present ONLY if the judge really scored it,
   * so a missing key is unambiguous — it is never a fabricated default.
   */
  evaluations: Partial<Record<ContextCondition, Partial<DocstringEvaluation>>>;
  /** arm -> blind label, retained for audit and export. */
  blindMap: Partial<Record<ContextCondition, string>>;
  status: 'success' | 'partial' | 'failed';
  /** Real error text from the server or network layer. */
  errorMessage?: string;
  /** Arms with no usable score. Callers must mark these trials failed. */
  unscoredArms: ContextCondition[];
}

/** Parameters for a blind evaluation request. */
export interface BlindEvaluationParams {
  target: BenchmarkTarget;
  candidates: Record<ContextCondition, string>;
  judgeModel?: string;
  signal?: AbortSignal;
}

/** Shape of the judge endpoint's response body. */
interface BlindEvaluationResponse {
  evaluations?: Record<string, Partial<DocstringEvaluation> & { overallQuality?: number }>;
}

/**
 * Returns a shuffled copy of an array using the Fisher-Yates algorithm.
 *
 * Fisher-Yates is used rather than `sort(() => Math.random() - 0.5)` because
 * the latter is not a uniform shuffle — it biases toward the original order,
 * which would partially defeat the blinding.
 */
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Looks up a candidate's evaluation, tolerating label formatting drift.
 *
 * The judge is asked for keys of the form "Candidate A" but models sometimes
 * return "candidate_a" or "CandidateA". Normalizing to lowercase alphanumerics
 * matches all of these without resorting to a fabricated default.
 */
function findCandidateEvaluation(
  rawEvaluations: Record<string, unknown>,
  candidateId: string
): Record<string, unknown> | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = normalize(candidateId);

  for (const [key, value] of Object.entries(rawEvaluations)) {
    if (normalize(key) === wanted && value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

/** Reads a numeric field, returning null if it is absent or not a number. */
function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a string array field, defaulting to an empty array. */
function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Gemini-backed blind judge.
 *
 * Kept as a class implementing a narrow interface so an alternative judge
 * (a different provider, or a panel of judges for inter-rater agreement) can be
 * substituted without touching the runner — the Dependency Inversion principle
 * applied to the one component whose bias most threatens the experiment.
 */
export class GeminiJudgeProvider {
  readonly name = 'Gemini Blind Judge';
  readonly model: string;

  constructor(model: string = DEFAULT_JUDGE_MODEL) {
    this.model = model;
  }

  /**
   * Scores all candidates in a single blind request.
   *
   * One request rather than four is deliberate: a judge comparing candidates
   * side by side calibrates them against each other, which is what the rubric
   * asks for, and it costs a quarter of the calls.
   *
   * Arms whose generation failed (empty docstring) are NOT sent. Including an
   * empty candidate would both waste tokens and skew the judge's calibration
   * of the candidates that do exist.
   */
  async evaluateBlindArms(params: BlindEvaluationParams): Promise<BlindJudgeResult> {
    const { target, candidates, judgeModel, signal } = params;
    const model = judgeModel || this.model;

    const armKeys = Object.keys(candidates) as ContextCondition[];

    // Arms with no generated text cannot be judged; record them as unscored
    // immediately rather than sending a placeholder to the grader.
    const armsWithContent = armKeys.filter((arm) => (candidates[arm] || '').trim().length > 0);
    const armsWithoutContent = armKeys.filter((arm) => (candidates[arm] || '').trim().length === 0);

    const blindMap: Partial<Record<ContextCondition, string>> = {};

    if (armsWithContent.length === 0) {
      return {
        evaluations: {},
        blindMap,
        status: 'failed',
        errorMessage: 'No arm produced a docstring, so there was nothing to judge.',
        unscoredArms: armKeys,
      };
    }

    // Assign blind labels in randomized order.
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const blindCandidates: BlindCandidate[] = shuffleArray(armsWithContent).map(
      (armKey, index) => {
        const candidateId = `Candidate ${letters[index % letters.length]}`;
        blindMap[armKey] = candidateId;
        return { candidateId, docstring: candidates[armKey], originalArmKey: armKey };
      }
    );

    try {
      const data = await postJson<BlindEvaluationResponse>(
        '/api/gemini/evaluate-blind-arms',
        {
          target: {
            id: target.id,
            name: target.name,
            language: target.language,
            targetCode: target.targetCode,
            referenceDocstring: target.referenceDocstring,
            // NOTE: groundTruthIntent is deliberately NOT sent.
          },
          blindCandidates: blindCandidates.map((c) => ({
            candidateId: c.candidateId,
            docstring: c.docstring,
          })),
          model,
        },
        signal
      );

      const rawEvaluations = (data.evaluations ?? {}) as Record<string, unknown>;
      const evaluations: BlindJudgeResult['evaluations'] = {};
      const unscoredArms: ContextCondition[] = [...armsWithoutContent];

      for (const candidate of blindCandidates) {
        const rawEval = findCandidateEvaluation(rawEvaluations, candidate.candidateId);
        const overallQuality = rawEval ? readNumber(rawEval, 'overallQuality') : null;

        // A usable evaluation must at minimum carry a composite score. Without
        // one there is nothing to aggregate, so the arm is marked unscored
        // rather than defaulted.
        if (!rawEval || overallQuality === null) {
          unscoredArms.push(candidate.originalArmKey);
          continue;
        }

        const accuracyScore = readNumber(rawEval, 'accuracyScore');
        const paramReturnScore = readNumber(rawEval, 'paramReturnScore');
        const intentScore = readNumber(rawEval, 'intentScore');
        const hallucinationScore = readNumber(rawEval, 'hallucinationScore');

        // Every rubric dimension is required by the response schema. If the
        // model omitted one, the row is incomplete and cannot be charted
        // per-dimension, so it does not count as a scored arm.
        if (
          accuracyScore === null ||
          paramReturnScore === null ||
          intentScore === null ||
          hallucinationScore === null
        ) {
          unscoredArms.push(candidate.originalArmKey);
          continue;
        }

        const critique = rawEval['judgeCritique'];

        evaluations[candidate.originalArmKey] = {
          accuracyScore,
          paramReturnScore,
          intentScore,
          hallucinationScore,
          overallQuality,
          judgeCritique:
            typeof critique === 'string' && critique.trim().length > 0
              ? critique
              : 'The judge returned scores without a written critique.',
          keyInsightsFound: readStringArray(rawEval, 'keyInsightsFound'),
          hallucinationsIdentified: readStringArray(rawEval, 'hallucinationsIdentified'),
          judgeModel: model,
          anonymizedCandidateId: candidate.candidateId,
        };
      }

      const scoredCount = Object.keys(evaluations).length;

      return {
        evaluations,
        blindMap,
        status: scoredCount === armKeys.length ? 'success' : 'partial',
        errorMessage:
          unscoredArms.length > 0
            ? `The judge returned no usable score for: ${unscoredArms.join(', ')}.`
            : undefined,
        unscoredArms,
      };
    } catch (error: unknown) {
      // Cancellation is not a failure to report as data — propagate it so the
      // runner can stop cleanly and mark the session cancelled.
      if (isCancellation(error)) throw error;

      const errorMessage =
        error instanceof ApiError
          ? error.displayMessage
          : error instanceof Error
            ? error.message
            : 'Unknown error during blind judging';

      // No scores are invented here. Every arm is reported unscored, and the
      // run surfaces the real reason to the user.
      return {
        evaluations: {},
        blindMap,
        status: 'failed',
        errorMessage,
        unscoredArms: armKeys,
      };
    }
  }
}
