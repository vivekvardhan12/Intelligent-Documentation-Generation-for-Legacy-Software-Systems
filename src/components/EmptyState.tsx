/**
 * First-run empty state.
 *
 * WHY THIS REPLACED THE OLD BEHAVIOUR
 * The app used to open onto a fully-populated dashboard — radar charts,
 * confidence intervals, a green "SIGNIFICANT POSITIVE LIFT" verdict — built
 * entirely from hand-authored sample data presented as real results. That was
 * misleading, and it was also a poor introduction: a wall of statistics gives a
 * newcomer no idea what the tool does or what to press.
 *
 * This state explains the experiment in three steps, then offers two explicit
 * choices: run a real benchmark, or load the sample data with its provenance
 * stated up front.
 */

import React from 'react';
import { FlaskConical, Play, Layers, Sliders, BarChart3 } from 'lucide-react';
import { MIN_TRIALS_FOR_INFERENCE } from '../utils/statistics';

export interface EmptyStateProps {
  onRunBenchmark: () => void;
  onLoadDemo: () => void;
  /** Disables the actions while a run is in flight. */
  isRunning: boolean;
  /** Trials the Run button will execute, shown on the label. */
  plannedTrials: number;
}

/** One numbered step in the how-it-works explanation. */
const STEPS = [
  {
    icon: Layers,
    title: 'Pick a target function',
    body: 'Each benchmark target ships with its own isolated repository context: a call graph, a commit history, and unrelated documentation examples used as the length control.',
  },
  {
    icon: Sliders,
    title: 'Set the token budget and trial count',
    body: `Every context arm receives exactly the same number of context tokens, which is what separates content from length. Use ${MIN_TRIALS_FOR_INFERENCE} or more trials for a significance test — 5 to 10 is better.`,
  },
  {
    icon: BarChart3,
    title: 'Run and compare',
    body: 'Four arms are generated, graded blind by a judge that does not know which is which, then compared as paired differences with Holm-Bonferroni correction.',
  },
] as const;

export const EmptyState: React.FC<EmptyStateProps> = ({
  onRunBenchmark,
  onLoadDemo,
  isRunning,
  plannedTrials,
}) => (
  <section
    className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8"
    aria-labelledby="empty-state-heading"
  >
    <div className="max-w-3xl mx-auto text-center space-y-2">
      <div className="mx-auto h-12 w-12 rounded-xl bg-indigo-900 flex items-center justify-center text-white">
        <FlaskConical className="w-6 h-6 text-indigo-200" aria-hidden="true" />
      </div>
      <h2 id="empty-state-heading" className="text-lg font-bold text-slate-900 pt-1">
        No results yet
      </h2>
      <p className="text-sm text-slate-600">
        This benchmark answers one question: when repository context improves an LLM&apos;s
        docstrings, is that because of what the context <em>says</em> — or merely because it made
        the prompt <em>longer</em>?
      </p>
    </div>

    <ol className="mt-7 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
      {STEPS.map((step, index) => {
        const StepIcon = step.icon;
        return (
          <li
            key={step.title}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-900 text-white text-[11px] font-bold">
                {index + 1}
              </span>
              <StepIcon className="w-4 h-4 text-indigo-700" aria-hidden="true" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">{step.title}</h3>
            <p className="text-[11px] text-slate-600 leading-relaxed">{step.body}</p>
          </li>
        );
      })}
    </ol>

    <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
      <button
        type="button"
        onClick={onRunBenchmark}
        disabled={isRunning}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-all shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2"
      >
        <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
        Run benchmark ({plannedTrials} {plannedTrials === 1 ? 'trial' : 'trials'})
      </button>

      <button
        type="button"
        onClick={onLoadDemo}
        disabled={isRunning}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 font-bold text-xs hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
        Load sample data
      </button>
    </div>

    <p className="mt-3 text-center text-[11px] text-slate-500 max-w-xl mx-auto">
      Sample data is illustrative only — its scores were authored to demonstrate the interface,
      not measured from a model. It is labelled as such everywhere it appears, including in
      exports.
    </p>
  </section>
);
