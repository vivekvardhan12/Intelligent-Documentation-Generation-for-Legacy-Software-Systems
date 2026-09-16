import React from 'react';
import { Beaker, Sparkles, Download, RotateCcw, ShieldCheck, Activity } from 'lucide-react';

interface HeaderProps {
  onReset: () => void;
  onOpenExport: () => void;
  isRunning: boolean;
  modelName: string;
  tokenBudget: number;
}

export const Header: React.FC<HeaderProps> = ({
  onReset,
  onOpenExport,
  isRunning,
  modelName,
  tokenBudget,
}) => {
  return (
    <header id="app-header" className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left branding */}
        <div className="flex items-center space-x-3.5">
          <div className="h-10 w-10 rounded-xl bg-indigo-900 flex items-center justify-center text-white shadow-xs shrink-0">
            <Beaker className="w-5 h-5 text-indigo-200" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-indigo-900">
                The Context Confound Study
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                Fixed-Budget Isolation
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500">
              Research Benchmark: Isolating Context Content vs. Context Length in LLM Code Documentation
            </p>
          </div>
        </div>

        {/* Right action controls & Key Metrics */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-4">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Fixed Token Budget</p>
              <p className="text-base sm:text-lg font-mono font-bold text-indigo-600">{tokenBudget} Tokens</p>
            </div>
            <div className="w-px h-8 sm:h-10 bg-slate-200" />
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Model</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-slate-700 truncate max-w-[140px]">{modelName}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="reset-experiment-btn"
              onClick={onReset}
              disabled={isRunning}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs disabled:opacity-50"
              title="Reset to default benchmark"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Reset</span>
            </button>

            <button
              id="export-results-btn"
              onClick={onOpenExport}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-indigo-900 text-xs font-semibold text-white hover:bg-indigo-950 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-indigo-200" />
              <span>Export Findings</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
