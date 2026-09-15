/**
 * Export dialog: LaTeX, Markdown, CSV, full dataset and JSON.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. THE FULL DATASET IS NOW EXPORTABLE. The component already received
 *    `runHistory` as a prop and never read it — only the single active run was
 *    exported. Every trial-level observation, which is precisely what you would
 *    load into pandas or R to re-analyse, was discarded. The new "Full dataset"
 *    tab emits one row per trial x arm across every saved run.
 *
 * 2. DEMO DATA IS LABELLED. Every format now carries a prominent warning header
 *    when illustrative data is included. Previously a user could open the app,
 *    which auto-loaded hand-authored sample scores, click Export, and get a
 *    publication-ready LaTeX table of numbers nothing had measured.
 *
 * 3. MISSING VALUES ARE BLANK, NOT ZERO. The old templates used
 *    `evaluation?.accuracyScore || 0`, so a failed arm exported as a genuine
 *    score of 0.0 — indistinguishable from a real measurement of zero, and
 *    devastating to any mean computed downstream. Unmeasured cells are now
 *    empty in CSV and marked "n/a" in the prose formats.
 *
 * 4. STATISTICS ARE SHOWN WITH THEIR REAL PRECISION, including p-values that
 *    are deliberately absent because the sample was too small.
 */

import React, { useMemo, useRef, useState } from 'react';
import { ContextCondition, ExperimentRun, RawTrialResult } from '../types';
import { Download, Copy, Check, Upload, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { DEMO_EXPORT_WARNING } from './DemoDataBadge';
import { formatCI, formatPValue, formatStat } from '../utils/statistics';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The run on display. Null when nothing has been run yet. */
  currentRun: ExperimentRun | null;
  runHistory: ExperimentRun[];
  /** Downloads the whole history as JSON. */
  onExportHistory: () => void;
  /** Restores history from an exported JSON file's contents. */
  onImportHistory: (json: string) => void;
}

type ExportFormat = 'latex' | 'markdown' | 'csv' | 'dataset' | 'json';

/** Arms in canonical order. */
const ARM_ORDER: ContextCondition[] = [
  'code_only',
  'few_shot_control',
  'call_graph',
  'git_history',
];

/** Display labels for each arm in exported tables. */
const ARM_LABELS: Record<ContextCondition, string> = {
  code_only: 'Code Only (Floor)',
  few_shot_control: 'Few-Shot (Length Control)',
  call_graph: 'Call-Graph Context',
  git_history: 'Git-History Context',
};

/** Tab definitions. */
const FORMAT_TABS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'latex', label: 'LaTeX table', hint: 'Ready to paste into a paper' },
  { id: 'markdown', label: 'Markdown report', hint: 'Readable summary with statistics' },
  { id: 'csv', label: 'Summary CSV', hint: 'One row per arm for the active run' },
  { id: 'dataset', label: 'Full dataset', hint: 'One row per trial x arm, all runs' },
  { id: 'json', label: 'Raw JSON', hint: 'Complete structured run object' },
];

/**
 * Escapes a value for CSV.
 *
 * Quotes any field containing a delimiter, quote or newline, and doubles inner
 * quotes per RFC 4180. Judge critiques contain commas and quotation marks
 * routinely, so without this the dataset export would silently misalign
 * columns.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Joins rows of cells into a CSV document. */
function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

/** Formats a number for a table cell, or a placeholder when unmeasured. */
function cell(value: number | null | undefined, digits = 1, placeholder = 'n/a'): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : placeholder;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  currentRun,
  runHistory,
  onExportHistory,
  onImportHistory,
}) => {
  const [activeTab, setActiveTab] = useState<ExportFormat>('latex');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** True when any exported run is illustrative rather than measured. */
  const includesDemoData = useMemo(() => {
    if (activeTab === 'dataset') return runHistory.some((run) => run.isDemoData);
    return currentRun?.isDemoData === true;
  }, [activeTab, currentRun, runHistory]);

  /** All exportable text, keyed by format. Rebuilt only when inputs change. */
  const exports = useMemo(() => {
    const session = currentRun?.multiTrialSession;
    const analysis = currentRun?.analysis;
    const results = currentRun?.results;

    /** Prefixes a warning when demo data is included, using the given comment marker. */
    const withWarning = (body: string, commentPrefix: string): string => {
      if (!includesDemoData) return body;
      const wrapped = DEMO_EXPORT_WARNING.match(/.{1,88}(\s|$)/g) ?? [DEMO_EXPORT_WARNING];
      const banner = wrapped.map((line) => `${commentPrefix} ${line.trim()}`).join('\n');
      return `${banner}\n\n${body}`;
    };

    // --- LaTeX -----------------------------------------------------------
    const armRow = (arm: ContextCondition): string => {
      const stats = session?.armStats?.[arm];
      const evaluation = results?.[arm]?.evaluation;
      const promptTokens = results?.[arm]?.promptPayload?.exactPromptTokens;

      return (
        `${ARM_LABELS[arm]} & ${cell(promptTokens, 0, '--')} & ` +
        `${cell(evaluation?.accuracyScore)} & ${cell(evaluation?.intentScore)} & ` +
        `${cell(stats?.mean ?? evaluation?.overallQuality)} & ` +
        `${stats?.ci95 ? formatCI(stats.ci95) : '--'} & ${cell(stats?.n, 0, '1')} \\\\`
      );
    };

    const latexTable = currentRun
      ? withWarning(
          `\\begin{table}[t]
\\centering
\\caption{Context length versus context type under a fixed ${currentRun.tokenBudget}-token budget${
            session && session.numTrials > 1 ? ` (${session.numTrials} paired trials)` : ''
          }.}
\\label{tab:context_isolation}
\\begin{tabular}{lcccccc}
\\toprule
\\textbf{Condition} & \\textbf{Prompt tok.} & \\textbf{Acc.} & \\textbf{Intent} & \\textbf{Overall} & \\textbf{95\\% CI} & \\textbf{n} \\\\
\\midrule
${ARM_ORDER.map(armRow).join('\n')}
\\midrule
\\multicolumn{7}{l}{\\textbf{Paired comparisons (Holm-Bonferroni corrected):}} \\\\
\\multicolumn{7}{l}{Length effect (control -- floor): ${cell(analysis?.lengthEffectDelta)} pts${
            session ? `, adj. $p$ = ${formatPValue(session.comparisons.lengthEffect.adjustedPValue)}` : ''
          }} \\\\
\\multicolumn{7}{l}{Call-graph lift (vs. control): ${cell(analysis?.callGraphContentLift)} pts${
            session ? `, adj. $p$ = ${formatPValue(session.comparisons.callGraphLift.adjustedPValue)}` : ''
          }} \\\\
\\multicolumn{7}{l}{Git-history lift (vs. control): ${cell(analysis?.gitHistoryContentLift)} pts${
            session ? `, adj. $p$ = ${formatPValue(session.comparisons.gitHistoryLift.adjustedPValue)}` : ''
          }} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
          '%'
        )
      : '% No run to export yet.';

    // --- Markdown --------------------------------------------------------
    const markdownArmRow = (arm: ContextCondition): string => {
      const stats = session?.armStats?.[arm];
      const evaluation = results?.[arm]?.evaluation;
      const status = results?.[arm]?.status;

      if (status === 'error' || !evaluation) {
        return `| **${ARM_LABELS[arm]}** | FAILED | — | — | — | — | — |`;
      }

      return (
        `| **${ARM_LABELS[arm]}** | ${results?.[arm]?.promptPayload?.exactPromptTokens ?? '—'} | ` +
        `${cell(evaluation.accuracyScore)} | ${cell(evaluation.intentScore)} | ` +
        `${cell(evaluation.hallucinationScore)} | **${cell(stats?.mean ?? evaluation.overallQuality)}** | ` +
        `${stats?.ci95 ? formatCI(stats.ci95) : '—'} |`
      );
    };

    const comparisonRow = (key: 'lengthEffect' | 'callGraphLift' | 'gitHistoryLift'): string => {
      const comparison = session?.comparisons?.[key];
      if (!comparison) return '';
      return (
        `| ${comparison.label} | ${comparison.n} | ${comparison.meanDifference.toFixed(2)} | ` +
        `${formatCI(comparison.ci95)} | ${formatPValue(comparison.pValuetTest)} | ` +
        `${formatPValue(comparison.adjustedPValue)} | ${formatStat(comparison.effectSizeCohenD)} | ` +
        `${comparison.interpretation} |`
      );
    };

    const markdownReport = currentRun
      ? withWarning(
          `# Isolating Context Length from Context Type in LLM Code Documentation

**Target**: \`${currentRun.targetName}\` (${currentRun.language})
**Fixed context budget**: ${currentRun.tokenBudget} tokens per context arm
**Generator model**: ${currentRun.modelName} (temperature ${currentRun.temperature})
**Judge model**: ${session?.judgeModel ?? 'n/a'} (blind, randomized candidate order)
**Paired trials**: ${session?.numTrials ?? 1}
**Run status**: ${session?.status ?? 'unknown'}
**Timestamp**: ${new Date(currentRun.timestamp).toISOString()}

## Results by condition

| Condition | Prompt tokens | Accuracy | Intent | Hallucination | Overall | 95% CI |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
${ARM_ORDER.map(markdownArmRow).join('\n')}

Scores are 1-10 per dimension; Overall is a 0-100 composite. Where multiple trials ran, the
Overall column is the mean across trials and the CI is for that mean.

## Paired comparisons

| Comparison | n | Mean diff. | 95% CI | p | Holm-adj. p | Cohen's d | Verdict |
| :--- | ---: | ---: | :--- | ---: | ---: | ---: | :--- |
${[comparisonRow('lengthEffect'), comparisonRow('callGraphLift'), comparisonRow('gitHistoryLift')]
  .filter(Boolean)
  .join('\n')}

${
  session?.comparisons?.callGraphLift?.inferenceNote
    ? `> **Note on inference**: ${session.comparisons.callGraphLift.inferenceNote}\n`
    : ''
}
## Verdict

**${session?.overallVerdict?.headline ?? 'No statistical verdict available'}**

${session?.overallVerdict?.summaryNarrative ?? analysis?.summaryNarrative ?? 'n/a'}

${
  session?.errors?.length
    ? `## Errors during this run\n\n${session.errors.map((error) => `- ${error}`).join('\n')}\n`
    : ''
}`,
          '<!--'
        ).replace(/^<!-- (.*)$/gm, '<!-- $1 -->')
      : 'No run to export yet.';

    // --- Summary CSV -----------------------------------------------------
    const summaryCsv = currentRun
      ? toCsv([
          [
            'run_id',
            'target_id',
            'target_name',
            'language',
            'token_budget',
            'model',
            'judge_model',
            'temperature',
            'num_trials',
            'arm',
            'role',
            'status',
            'n_successful',
            'prompt_tokens',
            'accuracy',
            'param_return',
            'intent',
            'hallucination',
            'overall_mean',
            'overall_sd',
            'ci95_lower',
            'ci95_upper',
            'bleu',
            'rouge_l',
            'semantic',
            'factuality',
            'is_demo_data',
          ],
          ...ARM_ORDER.map((arm) => {
            const stats = session?.armStats?.[arm];
            const result = results?.[arm];
            const evaluation = result?.evaluation;

            return [
              currentRun.id,
              currentRun.targetId,
              currentRun.targetName,
              currentRun.language,
              currentRun.tokenBudget,
              currentRun.modelName,
              session?.judgeModel ?? '',
              currentRun.temperature,
              session?.numTrials ?? 1,
              arm,
              result?.role ?? '',
              result?.status ?? '',
              stats?.n ?? '',
              result?.promptPayload?.exactPromptTokens ?? '',
              // Blank rather than 0 when unmeasured — a zero here would be
              // read downstream as a real score.
              evaluation?.accuracyScore ?? '',
              evaluation?.paramReturnScore ?? '',
              evaluation?.intentScore ?? '',
              evaluation?.hallucinationScore ?? '',
              stats?.mean ?? evaluation?.overallQuality ?? '',
              stats?.sd ?? '',
              stats?.ci95?.[0] ?? '',
              stats?.ci95?.[1] ?? '',
              evaluation?.bleuScore ?? '',
              evaluation?.rougeLScore ?? '',
              evaluation?.semanticSimilarity ?? '',
              evaluation?.factuality?.factualityScore ?? '',
              currentRun.isDemoData ? 'true' : 'false',
            ];
          }),
        ])
      : '';

    // --- Full dataset CSV ------------------------------------------------
    // One row per trial x arm across every saved run: the analysis-ready shape.
    const datasetRows: unknown[][] = [
      [
        'run_id',
        'timestamp_iso',
        'is_demo_data',
        'target_id',
        'target_name',
        'language',
        'token_budget',
        'model',
        'judge_model',
        'temperature',
        'trial_index',
        'pair_id',
        'arm',
        'status',
        'error_message',
        'blind_label',
        'accuracy',
        'param_return',
        'intent',
        'hallucination',
        'overall_quality',
        'bleu',
        'rouge_l',
        'semantic',
        'semantic_method',
        'factuality_score',
        'factuality_method',
        'unsupported_claim_rate',
        'total_claims',
        'input_tokens',
        'output_tokens',
        'token_method',
        'context_budget_compliance_pct',
        'latency_ms',
        'word_count',
      ],
    ];

    const runsToExport = runHistory.length > 0 ? runHistory : currentRun ? [currentRun] : [];

    for (const run of runsToExport) {
      const trials: RawTrialResult[] = run.rawTrials ?? run.multiTrialSession?.rawTrials ?? [];

      for (const trial of trials) {
        const evaluation = trial.evaluation;

        datasetRows.push([
          run.id,
          new Date(run.timestamp).toISOString(),
          run.isDemoData ? 'true' : 'false',
          run.targetId,
          run.targetName,
          run.language,
          run.tokenBudget,
          trial.model,
          trial.judgeModel ?? '',
          trial.temperature,
          trial.trialIndex,
          trial.pairId,
          trial.arm,
          trial.status,
          trial.errorMessage ?? '',
          trial.anonymizedCandidateId ?? '',
          evaluation?.accuracyScore ?? '',
          evaluation?.paramReturnScore ?? '',
          evaluation?.intentScore ?? '',
          evaluation?.hallucinationScore ?? '',
          evaluation?.overallQuality ?? '',
          evaluation?.bleuScore ?? '',
          evaluation?.rougeLScore ?? '',
          evaluation?.semanticSimilarity ?? '',
          evaluation?.semanticSimilarityMethod ?? '',
          evaluation?.factuality?.factualityScore ?? '',
          evaluation?.factuality?.method ?? '',
          evaluation?.factuality?.unsupportedClaimRate ?? '',
          evaluation?.factuality?.totalClaims ?? '',
          trial.tokens.totalInputTokens,
          trial.tokens.outputTokens,
          trial.tokens.method,
          trial.tokens.compliancePercentage,
          trial.latencyMs,
          evaluation?.wordCount ?? '',
        ]);
      }
    }

    const datasetCsv =
      datasetRows.length > 1
        ? (includesDemoData ? `# ${DEMO_EXPORT_WARNING}\n` : '') + toCsv(datasetRows)
        : 'No trial-level data available. Run a benchmark to populate the dataset.';

    // --- JSON ------------------------------------------------------------
    const jsonContent = currentRun
      ? JSON.stringify(
          includesDemoData ? { _warning: DEMO_EXPORT_WARNING, run: currentRun } : currentRun,
          null,
          2
        )
      : '{}';

    return {
      latex: latexTable,
      markdown: markdownReport,
      csv: summaryCsv,
      dataset: datasetCsv,
      json: jsonContent,
    } satisfies Record<ExportFormat, string>;
  }, [currentRun, runHistory, includesDemoData]);

  const activeText = exports[activeTab];

  /** Copies the active export to the clipboard. */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the textarea remains selectable.
    }
  };

  /** Downloads the active export with an appropriate file extension. */
  const handleDownload = () => {
    const extension =
      activeTab === 'latex'
        ? 'tex'
        : activeTab === 'markdown'
          ? 'md'
          : activeTab === 'dataset' || activeTab === 'csv'
            ? 'csv'
            : 'json';

    const blob = new Blob([activeText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `context_isolation_${currentRun?.targetId ?? 'dataset'}_${
      currentRun?.tokenBudget ?? 0
    }t_${activeTab}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /** Reads a chosen history file and hands its text to the import handler. */
  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => onImportHistory(String(reader.result ?? ''));
    reader.readAsText(file);

    // Reset so choosing the same file twice fires the change event again.
    event.target.value = '';
  };

  const datasetRowCount = Math.max(0, exports.dataset.split('\n').length - 1);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export findings and data"
      icon={<Download className="w-5 h-5 text-indigo-900" aria-hidden="true" />}
      footer={
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportHistory}
              title="Download every saved run as a JSON file you can re-import later"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Save session ({runHistory.length})
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Restore runs from a previously saved session file"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <Upload className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Import session
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChosen}
              className="hidden"
              aria-label="Choose a session JSON file to import"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-indigo-900 text-white text-xs font-bold hover:bg-indigo-950 transition-colors cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download
            </button>
          </div>
        </div>
      }
    >
      {includesDemoData && (
        <div
          role="alert"
          className="m-4 mb-0 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-px" aria-hidden="true" />
          <p>
            <strong className="font-bold">This export contains demo data. </strong>
            The figures are illustrative sample values shipped with the app, not measurements.
            A warning header is embedded in the exported file. Run a real benchmark before
            citing anything here.
          </p>
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-1 p-2.5 m-4 mb-0 bg-slate-100 border border-slate-200 rounded-lg text-xs"
        role="tablist"
        aria-label="Export format"
      >
        {FORMAT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            title={tab.hint}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-md font-medium transition-all cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 font-bold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-2">
        <p className="text-[11px] text-slate-500">
          {activeTab === 'dataset'
            ? `${datasetRowCount} observation${datasetRowCount === 1 ? '' : 's'} across ${
                runHistory.length || (currentRun ? 1 : 0)
              } run(s) — one row per trial and arm, ready for pandas or R. Unmeasured cells are blank rather than zero.`
            : FORMAT_TABS.find((tab) => tab.id === activeTab)?.hint}
        </p>

        <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg whitespace-pre-wrap max-h-80 overflow-auto leading-relaxed border border-slate-800 font-mono text-[11px]">
          {activeText}
        </pre>
      </div>
    </Modal>
  );
};
