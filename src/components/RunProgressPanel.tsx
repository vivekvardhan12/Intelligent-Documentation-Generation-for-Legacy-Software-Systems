/**
 * Live progress panel for a running benchmark.
 *
 * WHY THIS EXISTS
 * A five-trial run issues roughly 35 API requests over several minutes. The
 * only previous feedback was the Run button's label switching between
 * "Generating 4 Arms..." and "Evaluating Candidates...", with no trial counter,
 * no sense of how much remained, and no way to stop. A user could not tell a
 * slow run from a hung one, and their only recourse was to reload the page and
 * lose everything.
 *
 * This panel reports the phase, the trial number, a request-level progress bar
 * and elapsed time — and offers a Cancel button that actually aborts the
 * in-flight requests.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { RunProgressSnapshot } from '../utils/multiTrialRunner';

export interface RunProgressPanelProps {
  progress: RunProgressSnapshot | null;
  /** Wall-clock milliseconds since the run started. */
  startedAt: number | null;
  onCancel: () => void;
  /** True once cancellation has been requested but not yet taken effect. */
  isCancelling: boolean;
}

/** Formats a millisecond duration as m:ss. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const RunProgressPanel: React.FC<RunProgressPanelProps> = ({
  progress,
  startedAt,
  onCancel,
  isCancelling,
}) => {
  const [now, setNow] = useState(() => Date.now());

  // Ticks once a second purely to advance the elapsed-time display. Cheap, and
  // it stops as soon as the run ends because the panel unmounts.
  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (!progress) return null;

  const percentComplete =
    progress.totalRequests > 0
      ? Math.min(100, Math.round((progress.requestsCompleted / progress.totalRequests) * 100))
      : 0;

  return (
    <section
      className="bg-white rounded-xl border border-indigo-200 shadow-sm p-4 space-y-3"
      aria-label="Benchmark run progress"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            {/*
              The status line is an aria-live region so screen readers hear
              phase changes instead of only seeing them.
            */}
            <p
              className="text-xs font-bold text-slate-900 truncate"
              aria-live="polite"
              aria-atomic="true"
            >
              {isCancelling ? 'Cancelling — finishing in-flight requests…' : progress.message}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              {progress.requestsCompleted} / {progress.totalRequests} requests
              {progress.totalTrials > 1 && (
                <> · {progress.trialsCompleted} / {progress.totalTrials} trials complete</>
              )}
              {startedAt !== null && <> · {formatElapsed(now - startedAt)} elapsed</>}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          disabled={isCancelling}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-300 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {isCancelling ? 'Cancelling…' : 'Cancel run'}
        </button>
      </div>

      <div
        className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percentComplete}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Benchmark completion"
      >
        <div
          className="h-full bg-indigo-600 transition-all duration-300 ease-out"
          style={{ width: `${percentComplete}%` }}
        />
      </div>

      <p className="text-[11px] text-slate-500">
        Completed trials are kept if you cancel — partial results are still analysed, with the
        reduced sample size reported.
      </p>
    </section>
  );
};
