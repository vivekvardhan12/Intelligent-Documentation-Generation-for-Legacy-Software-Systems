/**
 * Badge marking data that was authored rather than measured.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * The app ships an illustrative dataset so the dashboard is not empty on first
 * visit. Previously that dataset was rendered identically to real results, so
 * a user could open the app, click "Export Findings", and receive a
 * publication-ready LaTeX table of numbers that had been typed by hand. This
 * badge — rendered anywhere demo data is displayed, and echoed as a header in
 * every export format — is what makes that mistake impossible.
 */

import React from 'react';
import { FlaskConical } from 'lucide-react';

export interface DemoDataBadgeProps {
  /** 'sm' for inline use in table rows, 'md' for section headers. */
  size?: 'sm' | 'md';
  className?: string;
}

export const DemoDataBadge: React.FC<DemoDataBadgeProps> = ({ size = 'md', className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 font-bold uppercase tracking-wider text-amber-900 ${
      size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
    } ${className}`}
    title="Illustrative sample data. These scores were authored to demonstrate the interface, not measured from a model. Run a benchmark to replace them."
  >
    <FlaskConical className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} aria-hidden="true" />
    Demo — not measured
  </span>
);

/**
 * Header line prefixed to every export while demo data is included.
 *
 * Plain text with a leading marker so it survives into LaTeX, Markdown, CSV and
 * JSON alike without breaking any of their syntaxes when commented.
 */
export const DEMO_EXPORT_WARNING =
  'DEMO DATA — NOT MEASURED. These figures are illustrative sample values shipped with the ' +
  'application to demonstrate the interface. They were not produced by any model and must not ' +
  'be cited. Run a real benchmark before using this export.';
