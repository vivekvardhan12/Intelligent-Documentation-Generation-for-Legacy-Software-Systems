import React, { useState } from 'react';
import { ExperimentRun } from '../types';
import { Download, Copy, Check, FileText, Code2, Table, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRun: ExperimentRun;
  runHistory: ExperimentRun[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  currentRun,
  runHistory,
}) => {
  const [activeTab, setActiveTab] = useState<'latex' | 'markdown' | 'csv' | 'json'>('latex');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const results = currentRun.results;
  const analysis = currentRun.analysis;

  // 1. LaTeX Table Format
  const latexTable = `\\begin{table}[t]
\\centering
\\caption{Context Length vs. Context Type Isolation Benchmark (Budget = ${currentRun.tokenBudget} tokens)}
\\label{tab:context_isolation}
\\begin{tabular}{lcccc}
\\toprule
\\textbf{Condition} & \\textbf{Prompt Tokens} & \\textbf{Accuracy} & \\textbf{Intent (Why)} & \\textbf{Overall Score} \\\\
\\midrule
Code Only (Floor) & ${results.code_only?.promptPayload?.exactPromptTokens || 0} & ${results.code_only?.evaluation?.accuracyScore || 0}/10 & ${results.code_only?.evaluation?.intentScore || 0}/10 & ${results.code_only?.evaluation?.overallQuality || 0}/100 \\\\
Few-Shot (Length Control) & ${results.few_shot_control?.promptPayload?.exactPromptTokens || 0} & ${results.few_shot_control?.evaluation?.accuracyScore || 0}/10 & ${results.few_shot_control?.evaluation?.intentScore || 0}/10 & ${results.few_shot_control?.evaluation?.overallQuality || 0}/100 \\\\
Call-Graph Context & ${results.call_graph?.promptPayload?.exactPromptTokens || 0} & ${results.call_graph?.evaluation?.accuracyScore || 0}/10 & ${results.call_graph?.evaluation?.intentScore || 0}/10 & ${results.call_graph?.evaluation?.overallQuality || 0}/100 \\\\
Git-History Context & ${results.git_history?.promptPayload?.exactPromptTokens || 0} & ${results.git_history?.evaluation?.accuracyScore || 0}/10 & ${results.git_history?.evaluation?.intentScore || 0}/10 & ${results.git_history?.evaluation?.overallQuality || 0}/100 \\\\
\\midrule
\\multicolumn{5}{l}{\\textbf{Hypothesis Verdicts:}} \\\\
\\multicolumn{5}{l}{$\\Delta_{\\text{Length Effect}}$ (Control - Floor): ${analysis?.lengthEffectDelta || 0} pts} \\\\
\\multicolumn{5}{l}{$\\Delta_{\\text{Net Call-Graph}}$ (CallGraph - Control): ${analysis?.callGraphContentLift || 0} pts (${analysis?.callGraphVerdict})} \\\\
\\multicolumn{5}{l}{$\\Delta_{\\text{Net Git-History}}$ (Git - Control): ${analysis?.gitHistoryContentLift || 0} pts (${analysis?.gitHistoryVerdict})} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`;

  // 2. Markdown Report Format
  const markdownReport = `# Empirical Research Report: Isolating Context Length vs. Context Type

**Target Function**: \`${currentRun.targetName}\` (${currentRun.language})  
**Fixed Token Budget**: ${currentRun.tokenBudget} tokens  
**Model**: ${currentRun.modelName} (Temp: ${currentRun.temperature})  
**Timestamp**: ${new Date(currentRun.timestamp).toISOString()}

## Experimental Conditions & Results

| Condition | Role | Prompt Tokens | Accuracy | Intent/Why | Overall Score |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Code Only** | Baseline Floor | ${results.code_only?.promptPayload?.exactPromptTokens || 0} | ${results.code_only?.evaluation?.accuracyScore || 0}/10 | ${results.code_only?.evaluation?.intentScore || 0}/10 | **${results.code_only?.evaluation?.overallQuality || 0}** |
| **2. Few-Shot Control** | Length Control | ${results.few_shot_control?.promptPayload?.exactPromptTokens || 0} | ${results.few_shot_control?.evaluation?.accuracyScore || 0}/10 | ${results.few_shot_control?.evaluation?.intentScore || 0}/10 | **${results.few_shot_control?.evaluation?.overallQuality || 0}** |
| **3. Call-Graph** | Structural Context | ${results.call_graph?.promptPayload?.exactPromptTokens || 0} | ${results.call_graph?.evaluation?.accuracyScore || 0}/10 | ${results.call_graph?.evaluation?.intentScore || 0}/10 | **${results.call_graph?.evaluation?.overallQuality || 0}** |
| **4. Git-History** | Evolutionary Context | ${results.git_history?.promptPayload?.exactPromptTokens || 0} | ${results.git_history?.evaluation?.accuracyScore || 0}/10 | ${results.git_history?.evaluation?.intentScore || 0}/10 | **${results.git_history?.evaluation?.overallQuality || 0}** |

## Hypothesis Isolation Analysis

- **Length Effect (Control vs Floor)**: ${analysis?.lengthEffectDelta || 0} points
- **Net Call-Graph Lift (vs Length Control)**: ${analysis?.callGraphContentLift || 0} points (${analysis?.callGraphVerdict})
- **Net Git-History Lift (vs Length Control)**: ${analysis?.gitHistoryContentLift || 0} points (${analysis?.gitHistoryVerdict})

### Summary Narrative
${analysis?.summaryNarrative || 'N/A'}
`;

  // 3. CSV Format
  const csvContent = `target_id,target_name,language,token_budget,condition,role,prompt_tokens,accuracy_score,param_return_score,intent_score,hallucination_score,overall_quality,bleu_score,rouge_l_score
${(['code_only', 'few_shot_control', 'call_graph', 'git_history'] as const)
  .map((c) => {
    const res = results[c];
    const ev = res?.evaluation;
    return `"${currentRun.targetId}","${currentRun.targetName}","${currentRun.language}",${currentRun.tokenBudget},"${c}","${res?.role}",${res?.promptPayload?.exactPromptTokens || 0},${ev?.accuracyScore || 0},${ev?.paramReturnScore || 0},${ev?.intentScore || 0},${ev?.hallucinationScore || 0},${ev?.overallQuality || 0},${(ev?.bleuScore || 0).toFixed(4)},${(ev?.rougeLScore || 0).toFixed(4)}`;
  })
  .join('\n')}`;

  // 4. JSON Format
  const jsonContent = JSON.stringify(currentRun, null, 2);

  const getExportText = () => {
    switch (activeTab) {
      case 'latex':
        return latexTable;
      case 'markdown':
        return markdownReport;
      case 'csv':
        return csvContent;
      case 'json':
        return jsonContent;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getExportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = getExportText();
    const ext = activeTab === 'latex' ? 'tex' : activeTab === 'markdown' ? 'md' : activeTab;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `context_isolation_${currentRun.targetId}_${currentRun.tokenBudget}t.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <Download className="w-5 h-5 text-indigo-900" />
            <h3 className="text-sm font-bold text-slate-900">
              Export Empirical Research Findings & Data
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 p-1.5 rounded hover:bg-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab selector */}
        <div className="flex items-center space-x-1 p-2.5 bg-slate-100 border-b border-slate-200 text-xs">
          <button
            onClick={() => setActiveTab('latex')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'latex'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            LaTeX Table
          </button>
          <button
            onClick={() => setActiveTab('markdown')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'markdown'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Markdown Report
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'csv'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            CSV Dataset
          </button>
          <button
            onClick={() => setActiveTab('json')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'json'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Raw JSON
          </button>
        </div>

        {/* Content Box */}
        <div className="p-4 flex-1 overflow-y-auto font-mono text-xs">
          <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed border border-slate-800">
            {getExportText()}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-sans">
            Ready for paper inclusion or computational replication.
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
              <span>{copied ? 'Copied to Clipboard' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-indigo-900 text-white text-xs font-bold hover:bg-indigo-950 shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
