/**
 * Reset confirmation dialog.
 *
 * WHAT CHANGED
 * Built on the shared `Modal` primitive, which supplies the focus trap, focus
 * restoration and backdrop-click handling this dialog previously lacked (it
 * had Escape and nothing else).
 *
 * Two factual bugs are also fixed: the "after reset" summary hardcoded the
 * target name as `TokenBucket.consume` regardless of what was selected —
 * ignoring the `currentTargetName` prop it was already given — and it promised
 * "1 baseline" run afterwards, which described the old seeded fake result that
 * no longer exists. Reset now genuinely clears everything.
 */

import React from 'react';
import { RotateCcw, AlertTriangle, ArrowRight } from 'lucide-react';
import { Modal } from './Modal';
import { BENCHMARK_TARGETS } from '../data/benchmarkTargets';

export interface ResetConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentTargetName: string;
  currentBudget: number;
  /** Runs that will be discarded. */
  runCount: number;
}

/** Values the session returns to. Kept in sync with App's defaults. */
const RESET_DEFAULTS = {
  budget: 750,
  trials: 3,
} as const;

export const ResetConfirmModal: React.FC<ResetConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentTargetName,
  currentBudget,
  runCount,
}) => {
  const defaultTargetName = BENCHMARK_TARGETS[0]?.name ?? 'the first target';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reset benchmark session?"
      maxWidthClass="max-w-md"
      icon={
        <span
          className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0"
          aria-hidden="true"
        >
          <AlertTriangle className="w-4 h-4" />
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <button
            id="cancel-reset-btn"
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Cancel
          </button>
          <button
            id="confirm-reset-btn"
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Reset session
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-600">
        <p className="leading-relaxed">
          This restores every run parameter to its default and{' '}
          <strong className="font-semibold text-slate-900">
            permanently deletes {runCount === 0 ? 'nothing yet' : `all ${runCount} saved run${runCount === 1 ? '' : 's'}`}
          </strong>
          , including the copy stored in this browser. Export your findings first if you need
          them.
        </p>

        <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between text-slate-700 font-sans font-semibold border-b border-slate-200/80 pb-1.5">
            <span>Current</span>
            <span>After reset</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 font-sans shrink-0">Token budget</span>
            <span className="flex items-center gap-1 text-slate-800">
              <span>{currentBudget}t</span>
              <ArrowRight className="w-3 h-3 text-slate-400" aria-hidden="true" />
              <span className="font-bold text-indigo-700">{RESET_DEFAULTS.budget}t</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 font-sans shrink-0">Target function</span>
            <span className="flex items-center gap-1 text-slate-800 min-w-0">
              <span className="truncate max-w-[6rem]">{currentTargetName}</span>
              <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
              <span className="font-bold text-indigo-700 truncate max-w-[6rem]">
                {defaultTargetName}
              </span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 font-sans shrink-0">Saved runs</span>
            <span className="flex items-center gap-1 text-slate-800">
              <span>{runCount}</span>
              <ArrowRight className="w-3 h-3 text-slate-400" aria-hidden="true" />
              <span className="font-bold text-rose-700">0</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 font-sans shrink-0">Trials</span>
            <span className="flex items-center gap-1 text-slate-800">
              <ArrowRight className="w-3 h-3 text-slate-400" aria-hidden="true" />
              <span className="font-bold text-indigo-700">{RESET_DEFAULTS.trials}</span>
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
