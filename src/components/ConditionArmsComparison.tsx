/**
 * Side-by-side comparison of all four arms' generated docstrings.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. FAILURES ARE SHOWN. An arm whose generation or judging failed previously
 *    rendered as an empty card reading "No output yet" with the stale prompt
 *    "Click 'Run 4-Arm Isolation Benchmark' to evaluate" — indistinguishable
 *    from an arm that had never been run. The real API error is now displayed
 *    on the card.
 *
 * 2. UNMEASURED METRICS READ AS BLANK. `(evalData.semanticSimilarity || 0)`
 *    rendered a missing embedding score as a confident "0.000", which is a
 *    meaningful value on a 0-1 similarity scale.
 *
 * 3. MEASUREMENT METHODS ARE LABELLED. Semantic similarity and factuality each
 *    have a degraded offline fallback. Those fallbacks measure something
 *    genuinely different from their API counterparts, so each figure now says
 *    which produced it.
 *
 * 4. THE REFERENCE DOCSTRING IS VISIBLE. The component already accepted a
 *    `referenceDocstring` prop and never rendered it, even though every lexical
 *    metric on these cards is computed against it — the reader had no way to
 *    see what BLEU and ROUGE-L were comparing to.
 *
 * 5. The prompt inspector uses the shared accessible `Modal`.
 */

import React, { memo, useCallback, useState } from 'react';
import { ConditionResult, ContextCondition } from '../types';
import { Copy, Check, Eye, Terminal, Clock, AlertTriangle, BookOpen } from 'lucide-react';
import { Modal } from './Modal';
import { DemoDataBadge } from './DemoDataBadge';

export interface ConditionArmsComparisonProps {
  results: Record<ContextCondition, ConditionResult>;
  /** Gold docstring that all lexical metrics are measured against. */
  referenceDocstring?: string;
  /** Renders the demo badge when the displayed data is illustrative. */
  isDemoData?: boolean;
}

/** Arms in canonical display order. */
const ARM_ORDER: ContextCondition[] = [
  'code_only',
  'few_shot_control',
  'call_graph',
  'git_history',
];

/** Per-arm colour scheme. */
const ARM_STYLES: Record<
  ContextCondition,
  { container: string; header: string; badge: string }
> = {
  code_only: {
    container: 'border-slate-200',
    header: 'bg-slate-50 border-slate-200',
    badge: 'bg-slate-200 text-slate-800',
  },
  // The control arm is outlined because it is the reference point the two
  // treatment arms are measured against.
  few_shot_control: {
    container: 'border-2 border-indigo-500',
    header: 'bg-indigo-50/60 border-indigo-100',
    badge: 'bg-indigo-600 text-white',
  },
  call_graph: {
    container: 'border-slate-200',
    header: 'bg-emerald-50/40 border-emerald-100',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  git_history: {
    container: 'border-slate-200',
    header: 'bg-amber-50/40 border-amber-100',
    badge: 'bg-amber-100 text-amber-900',
  },
};

/** Formats a 0-1 metric, or an em dash when it was not measured. */
function formatMetric(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}

const ConditionArmsComparisonComponent: React.FC<ConditionArmsComparisonProps> = ({
  results,
  referenceDocstring,
  isDemoData = false,
}) => {
  const [copiedArm, setCopiedArm] = useState<string | null>(null);
  const [inspectPromptArm, setInspectPromptArm] = useState<ContextCondition | null>(null);
  const [showReference, setShowReference] = useState(false);

  const handleCopy = useCallback(async (text: string, armKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedArm(armKey);
      setTimeout(() => setCopiedArm(null), 2000);
    } catch {
      // Clipboard permission can be denied; the text remains selectable.
    }
  }, []);

  const inspectedArm = inspectPromptArm ? results[inspectPromptArm] : null;

  return (
    <section id="condition-arms-comparison" className="space-y-4" aria-label="Arm comparison">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight flex flex-wrap items-center gap-2">
            <span>Generated docstrings &amp; evaluation</span>
            {isDemoData && <DemoDataBadge size="sm" />}
          </h2>
          <p className="text-xs text-slate-500">
            All four arms received the same system instruction and the same target function. Only
            the context block differs — and the three context arms received identical token
            budgets.
          </p>
        </div>

        {referenceDocstring && (
          <button
            type="button"
            onClick={() => setShowReference((open) => !open)}
            aria-expanded={showReference}
            aria-controls="reference-docstring-panel"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            {showReference ? 'Hide' : 'Show'} gold reference
          </button>
        )}
      </div>

      {/*
        The reference docstring is what BLEU, ROUGE-L and semantic similarity
        are all computed against, so it belongs next to those numbers.
      */}
      {showReference && referenceDocstring && (
        <div
          id="reference-docstring-panel"
          className="rounded-xl border border-slate-200 bg-white p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-900" aria-hidden="true" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Gold reference docstring
            </h3>
          </div>
          <p className="text-[11px] text-slate-500">
            Every BLEU, ROUGE-L and semantic similarity score on the cards below is measured
            against this text. It is also given to the judge for calibration.
          </p>
          <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 whitespace-pre-wrap font-mono text-[11px] leading-relaxed border border-slate-800 max-h-64 overflow-auto">
            {referenceDocstring}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {ARM_ORDER.map((condKey) => {
          const arm = results[condKey];
          if (!arm) return null;

          const evaluation = arm.evaluation;
          const styles = ARM_STYLES[condKey];
          const isCopied = copiedArm === condKey;
          const hasFailed = arm.status === 'error';

          return (
            <article
              key={condKey}
              id={`arm-card-${condKey}`}
              className={`rounded-xl border flex flex-col bg-white shadow-sm overflow-hidden ${
                hasFailed ? 'border-2 border-rose-300' : styles.container
              }`}
              aria-label={`${arm.title} results`}
            >
              <div className={`p-4 border-b space-y-2 ${styles.header}`}>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded font-mono ${styles.badge}`}
                  >
                    {arm.promptPayload.badge}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-mono text-slate-500">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {arm.latencyMs ? `${arm.latencyMs}ms` : '—'}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-slate-900">{arm.title}</h3>
                <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                  {arm.promptPayload.description}
                </p>

                <div className="flex items-center justify-between text-[11px] font-mono pt-1.5 text-slate-600 border-t border-slate-200/70">
                  <span>
                    Prompt: {arm.promptPayload.exactPromptTokens}t
                    {arm.tokens && (
                      <span
                        className="ml-1 text-[9px] uppercase text-slate-400"
                        title={
                          arm.tokens.method === 'ACTUAL'
                            ? 'Counted by the Gemini tokenizer'
                            : 'Estimated by the local heuristic (~3.8 chars/token)'
                        }
                      >
                        {arm.tokens.method === 'ACTUAL' ? 'exact' : 'est.'}
                      </span>
                    )}
                  </span>
                  {arm.promptPayload.userPrompt && (
                    <button
                      type="button"
                      id={`inspect-prompt-${condKey}`}
                      onClick={() => setInspectPromptArm(condKey)}
                      className="text-indigo-600 hover:text-indigo-800 text-[11px] font-sans font-semibold inline-flex items-center gap-0.5 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 rounded"
                    >
                      <Eye className="w-3 h-3" aria-hidden="true" />
                      View prompt
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 flex-1 space-y-3">
                {/*
                  A failed arm states its real reason. Previously this card
                  showed "No output yet", which read as "not run yet".
                */}
                {hasFailed ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-300 bg-rose-50 p-3 space-y-1.5"
                  >
                    <p className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
                      This arm failed
                    </p>
                    <p className="text-[11px] text-rose-900 break-words">
                      {arm.errorMessage ?? 'No usable result was produced.'}
                    </p>
                    <p className="text-[10px] text-rose-700">
                      Excluded from all statistics — not scored as zero.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Generated docstring
                      </span>
                      <button
                        type="button"
                        id={`copy-docstring-${condKey}`}
                        onClick={() => handleCopy(arm.generatedDocstring, condKey)}
                        disabled={!arm.generatedDocstring}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-40 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                            <span className="text-emerald-600">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs max-h-56 overflow-y-auto border border-slate-800">
                      {arm.status === 'generating' ? (
                        <div
                          className="py-6 flex flex-col items-center justify-center gap-2 text-slate-400"
                          role="status"
                        >
                          <span
                            className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"
                            aria-hidden="true"
                          />
                          <span className="text-xs">Generating…</span>
                        </div>
                      ) : arm.generatedDocstring ? (
                        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">
                          {arm.generatedDocstring}
                        </pre>
                      ) : (
                        <span className="text-slate-500 italic">Not run yet</span>
                      )}
                    </div>
                  </>
                )}

                {evaluation ? (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-xs font-bold text-slate-700">Overall quality</span>
                      <span className="text-sm font-black font-mono text-indigo-900">
                        {evaluation.overallQuality.toFixed(1)} / 100
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                      {[
                        { label: 'Accuracy', value: evaluation.accuracyScore, tone: 'text-slate-900' },
                        { label: 'Param/Ret', value: evaluation.paramReturnScore, tone: 'text-slate-900' },
                        { label: 'Intent/Why', value: evaluation.intentScore, tone: 'text-indigo-700' },
                        { label: 'Halluc. res.', value: evaluation.hallucinationScore, tone: 'text-emerald-700' },
                      ].map((dimension) => (
                        <div
                          key={dimension.label}
                          className="p-1.5 rounded bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-1"
                        >
                          <span className="text-slate-600 truncate">{dimension.label}:</span>
                          <span className={`font-bold shrink-0 ${dimension.tone}`}>
                            {dimension.value.toFixed(1)}/10
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-600 font-mono px-1 py-1 bg-slate-50 rounded border border-slate-200">
                      <div>
                        BLEU:{' '}
                        <span className="font-bold text-slate-800">
                          {formatMetric(evaluation.bleuScore)}
                        </span>
                      </div>
                      <div>
                        ROUGE-L:{' '}
                        <span className="font-bold text-slate-800">
                          {formatMetric(evaluation.rougeLScore)}
                        </span>
                      </div>
                      <div
                        title={
                          evaluation.semanticSimilarityMethod === 'lexical_fallback'
                            ? 'Computed by the offline lexical fallback, not by embeddings — this is a surface measure, not a semantic one.'
                            : 'Cosine similarity of Gemini embedding vectors.'
                        }
                      >
                        Semantic:{' '}
                        <span className="font-bold text-indigo-700">
                          {formatMetric(evaluation.semanticSimilarity)}
                        </span>
                        {evaluation.semanticSimilarityMethod === 'lexical_fallback' && (
                          <span className="text-amber-700 font-bold" aria-label="lexical fallback">
                            {' '}
                            *
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] px-1 flex-wrap">
                      {evaluation.factuality && evaluation.factuality.totalClaims > 0 ? (
                        <span className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-700">Factuality:</span>
                          <span
                            className={`px-1.5 rounded font-mono font-bold text-[10px] border ${
                              evaluation.factuality.factualityScore >= 90
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : evaluation.factuality.factualityScore >= 75
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                            title={
                              evaluation.factuality.method === 'lexical_heuristic'
                                ? 'Scored by the offline word-overlap heuristic, not by the claim-checking judge.'
                                : 'Scored claim-by-claim against only the evidence this arm received.'
                            }
                          >
                            {evaluation.factuality.factualityScore}% (
                            {evaluation.factuality.supportedClaims}/
                            {evaluation.factuality.totalClaims})
                            {evaluation.factuality.method === 'lexical_heuristic' && ' *'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">No claims extracted</span>
                      )}

                      {evaluation.anonymizedCandidateId && (
                        <span
                          className="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 rounded"
                          title="Label this candidate carried during blind judging. The judge did not know which arm produced it."
                        >
                          Blind: {evaluation.anonymizedCandidateId}
                        </span>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 text-[11px] text-slate-700 leading-relaxed border border-slate-200">
                      <span className="font-bold text-slate-900 block mb-0.5">Judge critique</span>
                      <p className="line-clamp-4">{evaluation.judgeCritique}</p>
                    </div>

                    {evaluation.keyInsightsFound?.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Insights captured
                        </span>
                        <ul className="flex flex-wrap gap-1">
                          {evaluation.keyInsightsFound.map((insight) => (
                            <li
                              key={insight}
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium"
                            >
                              ✓ {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {evaluation.hallucinationsIdentified?.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                          Unsupported claims
                        </span>
                        <ul className="flex flex-wrap gap-1">
                          {evaluation.hallucinationsIdentified.map((claim) => (
                            <li
                              key={claim}
                              className="text-[10px] px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-medium"
                            >
                              ⚠ {claim}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  !hasFailed && (
                    <p className="py-3 text-center text-xs text-slate-400">
                      Run a benchmark to score this arm
                    </p>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Footnote explaining the asterisks used above. */}
      <p className="text-[10px] text-slate-500">
        <span className="font-bold text-amber-700">*</span> measured by an offline fallback rather
        than the API — a weaker, surface-level substitute. Hover the value for detail.
      </p>

      <Modal
        isOpen={inspectPromptArm !== null}
        onClose={() => setInspectPromptArm(null)}
        title={`Exact prompt payload: ${inspectedArm?.title ?? ''}`}
        maxWidthClass="max-w-2xl"
        icon={<Terminal className="w-4 h-4 text-indigo-900" aria-hidden="true" />}
      >
        <div className="p-4 space-y-4 text-xs">
          <div className="space-y-1">
            <span className="font-bold text-slate-700">System instruction</span>
            <p className="text-[11px] text-slate-500">
              Identical for every arm — varying it would introduce a second uncontrolled variable.
            </p>
            <pre className="p-3 bg-slate-100 rounded-lg text-slate-800 whitespace-pre-wrap font-mono text-[11px] border border-slate-200">
              {inspectedArm?.promptPayload.systemInstruction || '(not retained for this run)'}
            </pre>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">User prompt</span>
              <span className="text-[11px] font-mono text-slate-500">
                {inspectedArm?.promptPayload.exactPromptTokens} tokens
              </span>
            </div>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg whitespace-pre-wrap font-mono text-[11px] max-h-96 overflow-auto border border-slate-800">
              {inspectedArm?.promptPayload.userPrompt || '(not retained for this run)'}
            </pre>
          </div>
        </div>
      </Modal>
    </section>
  );
};

/** Memoized: this renders four cards of dense markup on every parent update. */
export const ConditionArmsComparison = memo(ConditionArmsComparisonComponent);
