/**
 * Accessible modal dialog.
 *
 * WHY THIS EXISTS
 * The app had two hand-rolled modals with almost no accessibility support
 * between them. `ExportModal` had no Escape handler, no focus management, no
 * `role="dialog"`, and no way to close it other than hitting one specific
 * button; `ResetConfirmModal` had Escape and nothing else. For a keyboard or
 * screen-reader user, opening the export dialog meant tabbing blindly through
 * the page behind it with no announcement that a dialog had appeared.
 *
 * WHAT CORRECT BEHAVIOUR REQUIRES (per WAI-ARIA's dialog pattern)
 *  1. `role="dialog"` + `aria-modal="true"` so assistive tech announces it and
 *     treats the rest of the page as inert.
 *  2. `aria-labelledby` pointing at the visible title.
 *  3. Focus moves INTO the dialog on open.
 *  4. Tab cycles within the dialog — focus must not escape behind it.
 *  5. Escape closes it.
 *  6. Focus RETURNS to the element that opened it on close, so the user is not
 *     dumped back at the top of the document.
 *  7. Background scrolling is locked, so the page does not slide under the
 *     dialog on a trackpad.
 */

import React, { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Visible heading, also used as the dialog's accessible name. */
  title: string;
  /** Optional icon rendered beside the title. */
  icon?: React.ReactNode;
  /** Tailwind max-width class controlling dialog width. */
  maxWidthClass?: string;
  /** Footer content, typically action buttons. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** Selector matching elements that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  maxWidthClass = 'max-w-3xl',
  footer,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Remembers what had focus before opening, so it can be restored on close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  /** Returns the dialog's currently focusable children, in DOM order. */
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!dialogRef.current) return [];
    const nodes = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    // Explicit type argument: Array.from otherwise resolves the ArrayLike
    // overload against NodeListOf and widens the element type to unknown.
    return Array.from<HTMLElement>(nodes).filter(
      // Skip anything hidden: offsetParent is null for display:none subtrees.
      (element) => element.offsetParent !== null
    );
  }, []);

  // Move focus in on open, and restore it on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Defer one frame so the dialog's children exist before focusing.
    const focusFrame = requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      // Fall back to the dialog container itself (it carries tabIndex={-1}) so
      // focus is never left on the page behind.
      (focusable[0] ?? dialogRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen, getFocusableElements]);

  // Escape to close, and Tab confined to the dialog.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap around at both ends rather than letting focus leave the dialog.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, getFocusableElements]);

  // Lock background scrolling while open.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      // Clicking the backdrop closes, which is the conventional escape hatch.
      // The check ensures a click inside the dialog does not bubble up to close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-white rounded-xl ${maxWidthClass} w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden focus:outline-hidden`}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 gap-3">
          <div className="flex items-center space-x-2 min-w-0">
            {icon}
            <h2 id={titleId} className="text-sm font-bold text-slate-900 truncate">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="text-slate-500 hover:text-slate-800 p-1.5 rounded hover:bg-slate-200 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="p-3.5 border-t border-slate-200 bg-slate-50">{footer}</div>
        )}
      </div>
    </div>
  );
};
