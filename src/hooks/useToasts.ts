/**
 * Toast notifications.
 *
 * WHY THIS EXISTS
 * The app had no way to tell the user that anything had gone wrong. A failed
 * benchmark run was handled like this:
 *
 *     } catch (err: any) {
 *       console.error('Benchmark run error:', err);
 *     }
 *
 * From the user's side the spinner simply stopped and the old results stayed on
 * screen — indistinguishable from a successful run that produced identical
 * numbers. Every API failure message, quota error and validation complaint was
 * written to a console nobody had open.
 */

import { useCallback, useRef, useState } from 'react';

/** Severity, which drives colour and icon. */
export type ToastVariant = 'error' | 'warning' | 'success' | 'info';

/** A single notification. */
export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  /** Optional detail — typically the server's own error text. */
  description?: string;
  /** Milliseconds before auto-dismissal. 0 keeps it until dismissed. */
  durationMs: number;
}

/** How long each variant stays on screen by default. */
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  // Errors persist: an error the user missed is an error they cannot act on.
  error: 0,
  warning: 12000,
  success: 5000,
  info: 7000,
};

/** Maximum simultaneous toasts before the oldest is dropped. */
const MAX_TOASTS = 4;

export interface UseToastsResult {
  toasts: Toast[];
  /** Shows a toast and returns its id. */
  pushToast: (toast: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

/**
 * Manages a queue of toast notifications with automatic dismissal.
 *
 * Timers are tracked in a ref and cleared on dismissal so that a toast removed
 * by hand does not leave a pending timeout that fires against unmounted state.
 */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback<UseToastsResult['pushToast']>(
    (input) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const durationMs = input.durationMs ?? DEFAULT_DURATIONS[input.variant];

      const toast: Toast = {
        id,
        variant: input.variant,
        title: input.title,
        description: input.description,
        durationMs,
      };

      setToasts((current) => {
        const next = [...current, toast];
        // Drop the oldest rather than stacking indefinitely off-screen.
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });

      if (durationMs > 0) {
        const timer = setTimeout(() => dismissToast(id), durationMs);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismissToast]
  );

  const dismissAll = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  return { toasts, pushToast, dismissToast, dismissAll };
}
