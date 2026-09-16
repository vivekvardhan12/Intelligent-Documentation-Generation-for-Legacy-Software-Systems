import React, { useState } from 'react';
import { ConditionResult, ContextCondition } from '../types';
import { Copy, Check, Eye, Terminal, Clock, ShieldCheck, AlertCircle, Sparkles, FileText, ChevronRight } from 'lucide-react';

interface ConditionArmsComparisonProps {
  results: Record<ContextCondition, ConditionResult>;
  referenceDocstring?: string;
}

export const ConditionArmsComparison: React.FC<ConditionArmsComparisonProps> = ({
  results,
  referenceDocstring,
}) => {
  const [copiedArm, setCopiedArm] = useState<string | null>(null);
  const [inspectPromptArm, setInspectPromptArm] = useState<ContextCondition | null>(null);

  const handleCopy = (text: string, armKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedArm(armKey);
    setTimeout(() => setCopiedArm(null), 2000);
  };

  const conditions: ContextCondition[] = ['code_only', 'few_shot_control', 'call_graph', 'git_history'];

  return (
    <div id="condition-arms-comparison" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <span>Generated Docstrings & Multi-Dimensional Evaluation</span>
          </h2>
          <p className="text-xs text-slate-500">
            Compare generated outputs and judge evaluation across all 4 experimental arms under the exact same prompt length budget.
          </p>
        </div>
      </div>

      {/* 4-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {conditions.map((condKey) => {
          const arm = results[condKey];
          if (!arm) return null;

          const evalData = arm.evaluation;
          const isCopied = copiedArm === condKey;

          return (
            <div
              key={condKey}
              id={`arm-card-${condKey}`}
              className={`rounded-xl border flex flex-col justify-between transition-all bg-white shadow-sm overflow-hidden ${
                condKey === 'code_only'
                  ? 'border-slate-200'
                  : condKey === 'few_shot_control'
                  ? 'border-2 border-indigo-500 relative'
                  : condKey === 'call_graph'
                  ? 'border-slate-200'
                  : 'border-slate-200'
              }`}
            >
              {/* Header */}
              <div
                className={`p-4 border-b space-y-2 ${
                  condKey === 'code_only'
                    ? 'bg-slate-50 border-slate-200'
                    : condKey === 'few_shot_control'
                    ? 'bg-indigo-50/60 border-indigo-100'
                    : condKey === 'call_graph'
                    ? 'bg-emerald-50/40 border-emerald-100'
                    : 'bg-amber-50/40 border-amber-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded font-mono ${
                      condKey === 'code_only'
                        ? 'bg-slate-200 text-slate-800'
                        : condKey === 'few_shot_control'
                        ? 'bg-indigo-600 text-white font-bold'
                        : condKey === 'call_graph'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {arm.promptPayload.badge}
                  </span>
                  <div className="flex items-center space-x-1 text-[11px] font-mono text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{arm.latencyMs ? `${arm.latencyMs}ms` : '--'}</span>
                  </div>
                </div>

                <h3 className="text-sm font-bold text-slate-900">{arm.title}</h3>
                <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                  {arm.promptPayload.description}
                </p>

                {/* Exact token allocation pill */}
                <div className="flex items-center justify-between text-[11px] font-mono pt-1.5 text-slate-600 border-t border-slate-200/70">
                  <span>Prompt: {arm.promptPayload.exactPromptTokens}t</span>
                  <button
                    id={`inspect-prompt-${condKey}`}
                    onClick={() => setInspectPromptArm(condKey)}
                    className="text-indigo-600 hover:text-indigo-800 text-[11px] font-sans font-semibold flex items-center space-x-0.5"
                  >
                    <Eye className="w-3 h-3" />
                    <span>View Prompt</span>
                  </button>
                </div>
              </div>

              {/* Body: Generated Docstring */}
              <div className="p-4 flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Generated Docstring:
                  </span>
                  <button
                    id={`copy-docstring-${condKey}`}
                    onClick={() => handleCopy(arm.generatedDocstring, condKey)}
                    className="inline-flex items-center space-x-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Code display area */}
                <div className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs max-h-56 overflow-y-auto scrollbar-thin border border-slate-800">
                  {arm.status === 'generating' ? (
                    <div className="py-6 flex flex-col items-center justify-center space-y-2 text-slate-400">
                      <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">Generating docstring...</span>
                    </div>
                  ) : arm.generatedDocstring ? (
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">
                      {arm.generatedDocstring}
                    </pre>
                  ) : (
                    <span className="text-slate-500 italic">No output yet</span>
                  )}
                </div>

                {/* Judge Evaluation Section */}
                {evalData ? (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    {/* Overall Score */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-xs font-bold text-slate-700">Overall Quality</span>
                      <span className="text-sm font-black font-mono text-indigo-900">
                        {evalData.overallQuality} / 100
                      </span>
                    </div>

                    {/* Detailed Rubric Dimensions */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                      <div className="p-1.5 rounded bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                        <span className="text-slate-600">Accuracy:</span>
                        <span className="font-bold text-slate-900">{evalData.accuracyScore}/10</span>
                      </div>
                      <div className="p-1.5 rounded bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                        <span className="text-slate-600">Param/Ret:</span>
                        <span className="font-bold text-slate-900">{evalData.paramReturnScore}/10</span>
                      </div>
                      <div className="p-1.5 rounded bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                        <span className="text-slate-600">Intent/Why:</span>
                        <span className="font-bold text-indigo-700">{evalData.intentScore}/10</span>
                      </div>
                      <div className="p-1.5 rounded bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                        <span className="text-slate-600">Hallucination:</span>
                        <span className="font-bold text-emerald-700">{evalData.hallucinationScore}/10</span>
                      </div>
                    </div>

                    {/* Lexical Overlaps */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono px-1">
                      <span>BLEU: {(evalData.bleuScore || 0).toFixed(3)}</span>
                      <span>ROUGE-L: {(evalData.rougeLScore || 0).toFixed(3)}</span>
                    </div>

                    {/* Judge Critique */}
                    <div className="p-2.5 rounded-lg bg-slate-50 text-[11px] text-slate-700 leading-relaxed border border-slate-200">
                      <span className="font-bold text-slate-900 block mb-0.5">Judge Critique:</span>
                      <p className="line-clamp-3">{evalData.judgeCritique}</p>
                    </div>

                    {/* Key Insights Chips */}
                    {evalData.keyInsightsFound?.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Insights Captured:</span>
                        <div className="flex flex-wrap gap-1">
                          {evalData.keyInsightsFound.map((ins, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 line-clamp-1 font-medium"
                            >
                              ✓ {ins}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-3 text-center text-xs text-slate-400">
                    Click 'Run 4-Arm Isolation Benchmark' to evaluate
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Prompt Inspector Modal */}
      {inspectPromptArm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-indigo-900" />
                <h3 className="text-sm font-bold text-slate-900">
                  Exact Prompt Payload: {results[inspectPromptArm]?.title}
                </h3>
              </div>
              <button
                onClick={() => setInspectPromptArm(null)}
                className="text-slate-500 hover:text-slate-800 text-xs font-semibold px-2.5 py-1 rounded hover:bg-slate-200"
              >
                Close
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="font-bold text-slate-700 font-sans">System Instruction:</span>
                <pre className="p-3 bg-slate-100 rounded-lg text-slate-800 whitespace-pre-wrap text-xs border border-slate-200">
                  {results[inspectPromptArm]?.promptPayload.systemInstruction}
                </pre>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 font-sans">User Prompt Payload:</span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {results[inspectPromptArm]?.promptPayload.exactPromptTokens} tokens
                  </span>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg whitespace-pre-wrap text-xs max-h-96 overflow-y-auto border border-slate-800">
                  {results[inspectPromptArm]?.promptPayload.userPrompt}
                </pre>
              </div>
            </div>

            <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setInspectPromptArm(null)}
                className="px-4 py-1.5 bg-indigo-900 text-white rounded-md text-xs font-bold hover:bg-indigo-950 shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
