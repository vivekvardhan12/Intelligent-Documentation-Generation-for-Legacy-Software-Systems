import React, { useState } from 'react';
import { BenchmarkTarget } from '../types';
import { BENCHMARK_TARGETS, UNRELATED_FEW_SHOT_POOL } from '../data/benchmarkTargets';
import { Eye, EyeOff, PlusCircle, Sparkles, Terminal, FileCode, CheckCircle2 } from 'lucide-react';

interface BenchmarkSelectorProps {
  selectedTarget: BenchmarkTarget;
  onSelectTarget: (target: BenchmarkTarget) => void;
  isRunning: boolean;
}

export const BenchmarkSelector: React.FC<BenchmarkSelectorProps> = ({
  selectedTarget,
  onSelectTarget,
  isRunning,
}) => {
  const [showGroundTruth, setShowGroundTruth] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Custom target editing state
  const [customName, setCustomName] = useState('MyCustomFunction.process');
  const [customLanguage, setCustomLanguage] = useState<'python' | 'typescript' | 'go' | 'rust'>('python');
  const [customCode, setCustomCode] = useState(`def reconcile_invoice_balance(invoice_id: str, auto_debit: bool = True) -> tuple[bool, float]:
    invoice = db.get_invoice(invoice_id)
    if not invoice or invoice.is_closed:
        return False, 0.0
    pending_credits = sum(c.amount for c in invoice.pending_credits if not c.expired)
    adjusted_due = max(0.0, invoice.total_due - pending_credits)
    if auto_debit and adjusted_due > 0:
        success = payment_client.charge(invoice.customer_id, adjusted_due)
        if success:
            invoice.mark_settled()
            return True, adjusted_due
    return False, adjusted_due`);
  const [customCallGraph, setCustomCallGraph] = useState(`Callers:
- BillingWorker.nightly_settlement_job: runs at 02:00 UTC for unpaid invoices
- WebhookHandler.on_credit_note_issued: triggered when customer receives credit rebate

Callees:
- payment_client.charge: idempotent credit card charge gateway`);
  const [customGitHistory, setCustomGitHistory] = useState(`Commit d71a9e: "fix: clamp adjusted_due to 0.0 to prevent negative charges when customer credit exceeds invoice total"
Commit 4a22b1: "feat: add auto_debit parameter for direct debit accounts"`);
  /**
   * Rationale attached to a user-defined target.
   *
   * A constant, not state: the previous `useState` pair never called its
   * setter, so this only looked editable. Keeping it as a constant makes the
   * actual behaviour obvious.
   */
  const customIntent =
    'Prevents negative debit charges when credits exceed total due, and integrates with nightly settlement worker.';

  const handleApplyCustom = () => {
    const customTarget: BenchmarkTarget = {
      id: `custom-${Date.now()}`,
      name: customName || 'CustomFunction',
      language: customLanguage,
      category: 'User Custom Target',
      difficulty: 'Standard',
      description: 'Custom user-defined code benchmark target.',
      groundTruthIntent: customIntent || 'User defined rationale',
      targetCode: customCode,
      referenceDocstring: `"""Reconciles pending balance for a target invoice applying valid customer credits."""`,
      callGraphContext: {
        modulePath: 'custom/module.py',
        callers: [
          {
            name: 'CustomCaller',
            signature: 'def run(): void',
            context: customCallGraph,
          },
        ],
        callees: [
          {
            name: 'CustomCallee',
            signature: 'def exec(): void',
            context: 'Custom callee execution context',
          },
        ],
        architecturalNotes: 'User custom module context',
      },
      gitHistoryContext: {
        commits: [
          {
            hash: 'custom1',
            date: '2026-01-01',
            author: 'Developer',
            message: customGitHistory,
            diffHunk: '+ custom diff context',
          },
        ],
        prDiscussion: 'Custom pull request discussion notes.',
      },
      fewShotControlExamples: UNRELATED_FEW_SHOT_POOL,
    };

    onSelectTarget(customTarget);
  };

  return (
    <div id="benchmark-selector" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Target Selector Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-indigo-900" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Target Benchmark Suite
          </span>
        </div>

        {/* Curated function buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {BENCHMARK_TARGETS.map((t) => {
            const isSelected = !isCustomMode && selectedTarget.id === t.id;
            return (
              <button
                key={t.id}
                id={`select-target-${t.id}`}
                disabled={isRunning}
                onClick={() => {
                  setIsCustomMode(false);
                  onSelectTarget(t);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                  isSelected
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100/90 text-slate-700 hover:bg-slate-200/80 border border-transparent'
                } disabled:opacity-50`}
              >
                <span>{t.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isSelected ? 'bg-indigo-800 text-indigo-200' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {t.language}
                </span>
              </button>
            );
          })}

          <button
            id="select-custom-target-btn"
            disabled={isRunning}
            onClick={() => setIsCustomMode(!isCustomMode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              isCustomMode
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80 border border-indigo-200/80'
            } disabled:opacity-50`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Custom Target</span>
          </button>
        </div>
      </div>

      {/* Target Details Card */}
      {!isCustomMode ? (
        <div className="rounded-lg bg-slate-900 text-slate-200 border border-slate-800 overflow-hidden shadow-xs">
          {/* Header of code preview */}
          <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <FileCode className="w-4 h-4 text-indigo-400" />
              <span className="font-mono text-xs font-bold text-slate-100">
                {selectedTarget.name}
              </span>
              <span className="text-[11px] text-slate-400 font-sans">
                ({selectedTarget.category})
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {selectedTarget.difficulty}
              </span>
              <button
                id="toggle-ground-truth-btn"
                onClick={() => setShowGroundTruth(!showGroundTruth)}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 text-slate-200 hover:text-white border border-slate-700 transition-colors"
              >
                {showGroundTruth ? <EyeOff className="w-3 h-3 text-amber-400" /> : <Eye className="w-3 h-3 text-slate-400" />}
                <span>{showGroundTruth ? 'Hide Hidden Intent' : 'Reveal Ground Truth Intent'}</span>
              </button>
            </div>
          </div>

          {/* Ground Truth Hidden Intent reveal */}
          {showGroundTruth && (
            <div className="p-3 bg-amber-950/40 border-b border-amber-800/40 text-amber-200 text-xs flex items-start space-x-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-amber-300">Ground-Truth Rationale & Edge Case:</span>
                <p className="text-amber-100/90 leading-relaxed">{selectedTarget.groundTruthIntent}</p>
              </div>
            </div>
          )}

          {/* Target Code View */}
          <div className="p-3.5 font-mono text-xs overflow-x-auto max-h-48 scrollbar-thin text-slate-200">
            <pre>{selectedTarget.targetCode}</pre>
          </div>
        </div>
      ) : (
        /* Custom Target Creation Form */
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Define Custom Function & Repository Artifacts
            </h3>
            <button
              id="apply-custom-target-btn"
              onClick={handleApplyCustom}
              className="inline-flex items-center space-x-1 px-3.5 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-bold hover:bg-indigo-700 shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Apply Target</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Function Signature / Name
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full text-xs font-mono px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Programming Language
              </label>
              <select
                value={customLanguage}
                onChange={(e) => setCustomLanguage(e.target.value as BenchmarkTarget['language'])}
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              >
                <option value="python">Python</option>
                <option value="typescript">TypeScript / JavaScript</option>
                <option value="go">Go</option>
                <option value="rust">Rust</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Target Code (Floor)
            </label>
            <textarea
              rows={4}
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              className="w-full text-xs font-mono p-2 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Call-Graph Context (Callers & Callees)
              </label>
              <textarea
                rows={3}
                value={customCallGraph}
                onChange={(e) => setCustomCallGraph(e.target.value)}
                className="w-full text-xs font-mono p-2 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Git History Context (Commits & Diffs)
              </label>
              <textarea
                rows={3}
                value={customGitHistory}
                onChange={(e) => setCustomGitHistory(e.target.value)}
                className="w-full text-xs font-mono p-2 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
