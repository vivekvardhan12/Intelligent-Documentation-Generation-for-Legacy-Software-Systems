import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Scale, Code2, GitCommit, Network, Layers, Sparkles } from 'lucide-react';

export const HypothesisBanner: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div id="hypothesis-banner" className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Primary header strip */}
      <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border-b border-slate-100">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
              Core Scientific Confound
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Tokens vs. Semantics
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-indigo-950 leading-snug">
            Does contextual documentation improvement come from <span className="text-indigo-600 underline decoration-indigo-300 underline-offset-3">context content</span> or merely from <span className="text-indigo-600 underline decoration-indigo-300 underline-offset-3">token quantity</span>?
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Prior literature changed prompt content and prompt length simultaneously. By enforcing a <strong>fixed token budget</strong> across all arms and introducing an <strong>unrelated few-shot length control</strong>, this experiment isolates genuine semantic lift from length artifacts.
          </p>
        </div>

        <button
          id="toggle-hypothesis-details-btn"
          onClick={() => setIsExpanded(!isExpanded)}
          className="self-start md:self-center inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0 shadow-2xs"
        >
          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>{isExpanded ? 'Hide Methodology' : 'View Protocol & Proof'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </button>
      </div>

      {/* 4-Arm Visual Diagram Grid from Professional Polish Spec */}
      <div className="p-4 sm:p-6 bg-slate-50/50">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
          Experimental Conditions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Arm 1 */}
          <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm space-y-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <Code2 className="w-4 h-4 text-slate-500" />
                <span>01. Code-Only</span>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 rounded text-slate-500 uppercase tracking-wider">
                BASELINE FLOOR
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Target function alone. Minimalist prompt showing inherent baseline reasoning capability without auxiliary context.
            </p>
          </div>

          {/* Arm 2: Prominent critical control */}
          <div className="p-4 bg-white border-2 border-indigo-500 rounded-lg shadow-sm relative space-y-2">
            <div className="absolute -right-2 -top-2.5 bg-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm uppercase tracking-wider">
              CRITICAL CONTROL
            </div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <Scale className="w-4 h-4 text-indigo-600" />
                <span>02. Few-Shot (Noise)</span>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 rounded text-indigo-600 uppercase tracking-wider">
                LENGTH MATCHED
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Random (fn, doc) pairs from unrelated domains. Zero project info, identical token count to experimental groups.
            </p>
          </div>

          {/* Arm 3 */}
          <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm space-y-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <Network className="w-4 h-4 text-emerald-600" />
                <span>03. Call-Graph</span>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 rounded text-emerald-600 uppercase tracking-wider">
                STRUCTURAL
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Callers, callees, and module hierarchy. Semantic mapping of project code structure up to the exact budget limit.
            </p>
          </div>

          {/* Arm 4 */}
          <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm space-y-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <GitCommit className="w-4 h-4 text-amber-600" />
                <span>04. Git History</span>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-50 rounded text-amber-600 uppercase tracking-wider">
                HISTORICAL
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Commit messages, diff logs, and PR rationale touching the target function. Contextual intent and design evolution tracking.
            </p>
          </div>
        </div>
      </div>

      {/* Expanded Methodology & Mathematical Proof */}
      {isExpanded && (
        <div className="p-5 sm:p-6 bg-slate-900 text-slate-100 border-t border-slate-800 text-xs sm:text-sm space-y-4">
          <div className="flex items-center space-x-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
            <Layers className="w-4 h-4" />
            <span>Mathematical Decision Rules for Hypothesis Validation</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-lg bg-slate-800/90 border border-slate-700/70 space-y-2">
              <div className="text-amber-400 font-bold text-xs">Rule 1: Length Effect</div>
              <div className="font-mono text-xs bg-slate-950 px-2.5 py-1 rounded text-slate-200">
                Δ_length = Score(Control) - Score(Floor)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Measures the generic prompt performance gain attributable purely to having more in-context demonstration tokens.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-800/90 border border-slate-700/70 space-y-2">
              <div className="text-indigo-300 font-bold text-xs">Rule 2: Net Semantic Value</div>
              <div className="font-mono text-xs bg-slate-950 px-2.5 py-1 rounded text-slate-200">
                Δ_net = Score(Context) - Score(Control)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                If Δ_net ≈ 0, then repository context is a placebo; token length was doing the work. If Δ_net &gt; 0, real context lift exists.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-800/90 border border-slate-700/70 space-y-2">
              <div className="text-emerald-400 font-bold text-xs">Rule 3: Engineering ROI</div>
              <div className="font-mono text-xs bg-slate-950 px-2.5 py-1 rounded text-slate-200">
                ROI = (Δ_net_CallGraph vs Δ_net_Git)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Identifies which specific repo extraction pipeline (AST call graph vs git history miner) justifies the engineering investment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
