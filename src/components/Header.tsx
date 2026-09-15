/**
 * Application header: identity, key parameters, and the global actions.
 *
 * WHAT CHANGED
 * - Shows the trial count, now that it is configurable and is the parameter
 *   that determines whether the results support inference at all.
 * - Carries the demo-data badge, so illustrative results are flagged at the
 *   top of the page and not only deep in the dashboard.
 * - Export is disabled until there is something to export, rather than opening
 *   a dialog full of zeroes.
 * - Proper landmark roles and accessible labels throughout.
 */

import React, { memo } from 'react';
import { Beaker, Download, RotateCcw } from 'lucide-react';
import { DemoDataBadge } from './DemoDataBadge';

export interface HeaderProps {
  onReset: () => void;
  onOpenExport: () => void;
  isRunning: boolean;
  modelName: string;
  tokenBudget: number;
  numTrials: number;
  /** Enables the export action. */
  hasResults: boolean;
  /** Renders the demo-data badge. */
  isShowingDemoData: boolean;
}

const HeaderComponent: React.FC<HeaderProps> = ({
  onReset,
  onOpenExport,
  isRunning,
  modelName,
  tokenBudget,
  numTrials,
  hasResults,
  isShowingDemoData,
}) => (
  <header
    id="app-header"
    className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-2xs"
  >
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center space-x-3.5 min-w-0">
        <span
          className="h-10 w-10 rounded-xl bg-indigo-900 flex items-center justify-center text-white shrink-0"
          aria-hidden="true"
        >
          <Beaker className="w-5 h-5 text-indigo-200" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-indigo-900">
              The Context Confound Study
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
              Fixed-budget isolation
            </span>
            {isShowingDemoData && <DemoDataBadge size="sm" />}
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Isolating context content from context length in LLM code documentation
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Key parameters, as a description list so the labels are programmatically
            associated with their values rather than being visually adjacent text. */}
        <dl className="hidden sm:flex items-center gap-4">
          <div className="text-right">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Token budget
            </dt>
            <dd className="text-base sm:text-lg font-mono font-bold text-indigo-600">
              {tokenBudget}
            </dd>
          </div>
          <div className="w-px h-8 sm:h-10 bg-slate-200" aria-hidden="true" />
          <div className="text-right">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Trials
            </dt>
            <dd className="text-base sm:text-lg font-mono font-bold text-slate-700">
              {numTrials}
            </dd>
          </div>
          <div className="w-px h-8 sm:h-10 bg-slate-200" aria-hidden="true" />
          <div className="text-right min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Model
            </dt>
            <dd className="text-xs sm:text-sm font-mono font-bold text-slate-700 truncate max-w-[140px]">
              {modelName}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <button
            id="reset-experiment-btn"
            type="button"
            onClick={onReset}
            disabled={isRunning}
            title="Restore default parameters and delete all saved runs"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            id="export-results-btn"
            type="button"
            onClick={onOpenExport}
            disabled={!hasResults}
            title={
              hasResults
                ? 'Export findings as LaTeX, Markdown, CSV or JSON'
                : 'Run a benchmark first — there is nothing to export yet'
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-900 text-xs font-semibold text-white hover:bg-indigo-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2"
          >
            <Download className="w-3.5 h-3.5 text-indigo-200" aria-hidden="true" />
            <span>Export findings</span>
          </button>
        </div>
      </div>
    </div>
  </header>
);

export const Header = memo(HeaderComponent);
