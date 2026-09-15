/**
 * Toast notification renderer.
 *
 * Announced through an `aria-live` region so screen-reader users hear failures
 * rather than only seeing them. Errors use `role="alert"` (assertive, announced
 * immediately) while non-errors are polite, so a success message never
 * interrupts whatever the user is reading.
 */

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { Toast, ToastVariant } from '../hooks/useToasts';

/** Colour scheme and icon per severity. */
const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: React.ReactNode; label: string }
> = {
  error: {
    container: 'bg-rose-50 border-rose-300 text-rose-950',
    icon: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />,
    label: 'Error',
  },
  warning: {
    container: 'bg-amber-50 border-amber-300 text-amber-950',
    icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />,
    label: 'Warning',
  },
  success: {
    container: 'bg-emerald-50 border-emerald-300 text-emerald-950',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />,
    label: 'Success',
  },
  info: {
    container: 'bg-indigo-50 border-indigo-300 text-indigo-950',
    icon: <Info className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />,
    label: 'Information',
  },
};

export interface ToasterProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const Toaster: React.FC<ToasterProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[calc(100vw-2rem)] sm:w-96 max-w-md"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const styles = VARIANT_STYLES[toast.variant];

        return (
          <div
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : 'status'}
            className={`border rounded-xl shadow-lg p-3 flex items-start gap-2.5 text-xs ${styles.container}`}
          >
            {styles.icon}
            <div className="flex-1 min-w-0">
              <p className="font-bold">
                <span className="sr-only">{styles.label}: </span>
                {toast.title}
              </p>
              {toast.description && (
                <p className="mt-0.5 opacity-90 break-words whitespace-pre-wrap">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="opacity-60 hover:opacity-100 p-0.5 rounded transition-opacity shrink-0 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-current"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
