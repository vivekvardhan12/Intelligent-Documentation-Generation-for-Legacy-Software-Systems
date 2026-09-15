/**
 * Run history persisted to localStorage.
 *
 * WHY THIS EXISTS
 * Nothing was stored. A benchmark session costing real API spend and several
 * minutes of waiting was held entirely in React state, so a page reload — or an
 * accidental browser back — destroyed every result. For a tool whose output is
 * meant to go into a report, that is a data-loss bug, not a missing nicety.
 *
 * WHY localStorage AND NOT SOMETHING STURDIER
 * The app has no user accounts and no database; a server-side store would mean
 * inventing both. localStorage is per-browser and per-origin, which is the
 * right scope for "my experiments on this machine", and the JSON
 * export/import below covers moving results elsewhere or archiving them.
 *
 * STORAGE IS TREATED AS UNRELIABLE THROUGHOUT
 * Private browsing, disabled site data and a full quota all cause reads and
 * writes to throw rather than fail quietly. Every access is wrapped, and the
 * app renders correctly when storage is unavailable — it simply stops
 * remembering.
 */

import { useCallback, useState } from 'react';
import { ExperimentRun } from '../types';

/** Storage key. Versioned so an incompatible change is ignored, not crashed on. */
const STORAGE_KEY = 'codedoc-isolator:run-history:v1';

/** Schema version written alongside the data. */
const SCHEMA_VERSION = 1;

/**
 * Maximum runs retained. Older runs are dropped once exceeded.
 *
 * 25 is a balance: enough to compare a session's worth of parameter sweeps,
 * few enough to stay well inside the ~5MB localStorage budget even before the
 * trimming below.
 */
const MAX_PERSISTED_RUNS = 25;

/** Envelope written to storage. */
interface StoredHistory {
  version: number;
  savedAt: number;
  runs: ExperimentRun[];
}

/**
 * Strips the bulky fields a stored run does not need.
 *
 * Raw model responses and full prompt texts dominate a run's size and are
 * reproducible from the parameters, whereas scores and statistics are not.
 * Dropping them keeps roughly an order of magnitude more history inside the
 * same quota. `rawTrials` evaluations are KEPT, because they are the dataset
 * the CSV export is built from.
 */
function trimRunForStorage(run: ExperimentRun): ExperimentRun {
  const trimmedResults = {} as ExperimentRun['results'];

  for (const [condition, result] of Object.entries(run.results)) {
    trimmedResults[condition as keyof ExperimentRun['results']] = {
      ...result,
      // The generated docstring is the finding; the raw envelope around it is not.
      rawResponse: '',
      promptPayload: {
        ...result.promptPayload,
        systemInstruction: '',
        userPrompt: '',
        contextSnippetUsed: '',
      },
    };
  }

  return {
    ...run,
    results: trimmedResults,
    rawTrials: run.rawTrials?.map((trial) => ({ ...trial, rawResponse: '' })),
    multiTrialSession: run.multiTrialSession
      ? {
          ...run.multiTrialSession,
          rawTrials: run.multiTrialSession.rawTrials.map((trial) => ({
            ...trial,
            rawResponse: '',
          })),
        }
      : undefined,
  };
}

/** Reads persisted history, returning null when unavailable or unusable. */
function readStoredHistory(): ExperimentRun[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredHistory;
    if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.runs)) return null;

    // Guard against a partially-written or externally-edited payload.
    return parsed.runs.filter(
      (run): run is ExperimentRun =>
        typeof run?.id === 'string' && typeof run?.timestamp === 'number' && !!run?.results
    );
  } catch {
    // Unavailable, blocked, or corrupt: behave as though there is no history.
    return null;
  }
}

/**
 * Writes history, shedding older runs if the quota rejects the write.
 *
 * A QuotaExceededError is recoverable: half the history is still far better
 * than none, so the write is retried with progressively fewer runs before
 * giving up.
 */
function writeStoredHistory(runs: ExperimentRun[]): boolean {
  const trimmed = runs.slice(0, MAX_PERSISTED_RUNS).map(trimRunForStorage);

  for (let attempt = trimmed.length; attempt > 0; attempt = Math.floor(attempt / 2)) {
    try {
      const payload: StoredHistory = {
        version: SCHEMA_VERSION,
        savedAt: Date.now(),
        runs: trimmed.slice(0, attempt),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      // Try again with fewer runs; loop exits when nothing fits.
    }
  }

  return false;
}

export interface UsePersistentRunHistoryResult {
  runHistory: ExperimentRun[];
  /** Adds a run to the front of history and persists immediately. */
  addRun: (run: ExperimentRun) => void;
  /** Replaces the whole history (used by reset and import). */
  replaceHistory: (runs: ExperimentRun[]) => void;
  /** Empties history and clears storage. */
  clearHistory: () => void;
  /** Set when persistence is unavailable, so the UI can say so. */
  persistenceError: string | null;
  /** Serializes history for download. */
  exportHistoryJson: () => string;
  /** Loads history from an exported JSON string. Returns the count imported. */
  importHistoryJson: (json: string) => number;
}

/** Message shown when the browser refuses to store history. */
const PERSISTENCE_FAILURE_MESSAGE =
  'Run history could not be saved to this browser (storage is full or blocked). ' +
  'Results will be lost on reload — use Export to keep them.';

/**
 * Manages run history with transparent persistence.
 *
 * DESIGN NOTE: storage is read once in the `useState` initializer and written
 * inside the mutators, NOT in effects. Reading in the initializer means the
 * first render already shows the restored history — no flash of an empty
 * dashboard — and writing in the mutators ties each save to the event that
 * caused it, which keeps the data flow traceable and avoids the cascading
 * re-renders that a state-setting effect produces.
 */
export function usePersistentRunHistory(): UsePersistentRunHistoryResult {
  // Lazy initializer: runs exactly once, before the first paint.
  const [runHistory, setRunHistory] = useState<ExperimentRun[]>(
    () => readStoredHistory() ?? []
  );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  /**
   * Persists a history list and records whether it succeeded.
   *
   * Returns the list so callers can use it as the new state directly.
   */
  const persist = useCallback((runs: ExperimentRun[]): ExperimentRun[] => {
    if (runs.length === 0) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Absence of storage is already the desired end state.
      }
      setPersistenceError(null);
      return runs;
    }

    setPersistenceError(writeStoredHistory(runs) ? null : PERSISTENCE_FAILURE_MESSAGE);
    return runs;
  }, []);

  const addRun = useCallback(
    (run: ExperimentRun) => {
      setRunHistory((current) => persist([run, ...current].slice(0, MAX_PERSISTED_RUNS)));
    },
    [persist]
  );

  const replaceHistory = useCallback(
    (runs: ExperimentRun[]) => {
      setRunHistory(persist(runs.slice(0, MAX_PERSISTED_RUNS)));
    },
    [persist]
  );

  const clearHistory = useCallback(() => {
    setRunHistory(persist([]));
  }, [persist]);

  const exportHistoryJson = useCallback(() => {
    const payload: StoredHistory = {
      version: SCHEMA_VERSION,
      savedAt: Date.now(),
      runs: runHistory,
    };
    return JSON.stringify(payload, null, 2);
  }, [runHistory]);

  const importHistoryJson = useCallback(
    (json: string): number => {
      // Throws on malformed input so the caller can report the real reason
      // rather than silently importing nothing.
      const parsed = JSON.parse(json) as StoredHistory | ExperimentRun[];

      const runs = Array.isArray(parsed) ? parsed : parsed?.runs;
      if (!Array.isArray(runs)) {
        throw new Error('File does not contain a run list.');
      }

      const valid = runs.filter(
        (run): run is ExperimentRun =>
          typeof run?.id === 'string' && typeof run?.timestamp === 'number' && !!run?.results
      );

      if (valid.length === 0) {
        throw new Error('No valid runs were found in the file.');
      }

      const imported = valid.slice(0, MAX_PERSISTED_RUNS);
      setRunHistory(persist(imported));
      return imported.length;
    },
    [persist]
  );

  return {
    runHistory,
    addRun,
    replaceHistory,
    clearHistory,
    persistenceError,
    exportHistoryJson,
    importHistoryJson,
  };
}
