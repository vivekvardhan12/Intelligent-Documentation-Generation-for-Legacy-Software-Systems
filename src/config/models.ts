/**
 * Model Registry — single source of truth for every Gemini model this app may call.
 *
 * WHY THIS FILE EXISTS
 * Before this module, the literal string 'gemini-3.7-flash' appeared in more than
 * twenty places: React state defaults, four service classes, a pricing table, a
 * `<select>` element, and nine separate `req.body` defaults in the Express layer.
 * Changing the default model meant a find-and-replace across the whole codebase,
 * and a typo in any one of those places produced a silent runtime failure against
 * the Gemini API rather than a compile error.
 *
 * This file is deliberately DEPENDENCY-FREE and contains no browser-only syntax
 * (no `import.meta`, no DOM access). That matters because it is imported by BOTH
 * the React client (bundled by Vite) and the Express server (bundled by esbuild
 * for Node). Anything requiring `import.meta.env` lives in `./pricing.ts`, which
 * is client-only.
 */

/** Identifier of a model the application is allowed to call. */
export type GeminiModelId = 'gemini-3.7-flash' | 'gemini-3.1-flash-lite';

/**
 * Describes one selectable generation/judging model.
 *
 * Prices are US dollars per one million tokens, quoted separately for input
 * (prompt) and output (completion) because Gemini bills them at different rates.
 * Keeping them here — rather than in the component that renders them — means the
 * cost estimator and any future server-side budget guard read the same numbers.
 */
export interface GeminiModelConfig {
  /** The exact string sent to the Gemini API as `model`. */
  id: GeminiModelId;
  /** Human-readable name for dropdowns and reports. */
  displayName: string;
  /** Short qualifier shown next to the name, e.g. 'Default' or 'Fast'. */
  tier: string;
  /** USD per 1,000,000 prompt (input) tokens. */
  inputPerMillionUSD: number;
  /** USD per 1,000,000 completion (output) tokens. */
  outputPerMillionUSD: number;
}

/**
 * Every model offered in the UI, in display order.
 *
 * To add a model: append an entry here and widen `GeminiModelId`. The dropdown,
 * the cost estimator, and the server-side allowlist all derive from this array,
 * so no other file needs to change.
 */
export const GEMINI_MODELS: readonly GeminiModelConfig[] = [
  {
    id: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    tier: 'Default',
    inputPerMillionUSD: 0.1,
    outputPerMillionUSD: 0.4,
  },
  {
    id: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    tier: 'Fast',
    inputPerMillionUSD: 0.075,
    outputPerMillionUSD: 0.3,
  },
] as const;

/** Model used to GENERATE docstrings (the system under test). */
export const DEFAULT_MODEL: GeminiModelId = 'gemini-3.7-flash';

/**
 * Model used to JUDGE docstrings.
 *
 * Kept as a separate constant from DEFAULT_MODEL on purpose: using the same
 * model to both generate and grade introduces self-preference bias, so an
 * experimenter may well want to point these at different models. The UI exposes
 * both independently.
 */
export const DEFAULT_JUDGE_MODEL: GeminiModelId = 'gemini-3.7-flash';

/**
 * Embedding model backing the semantic-similarity metric.
 *
 * Not a `GeminiModelId` because it is never user-selectable and is not billed
 * from the generation price table — it is an implementation detail of the
 * similarity metric.
 */
export const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Allowlist enforced at the HTTP boundary.
 *
 * The server previously forwarded `req.body.model` to the Gemini SDK unchecked,
 * meaning any client could name any model — including more expensive ones than
 * the UI offers. Validating against this set keeps spend bounded to models we
 * have priced, and turns a bad request into a 400 instead of a paid API call.
 */
export const ALLOWED_MODEL_IDS: readonly string[] = GEMINI_MODELS.map((m) => m.id);

/** Narrows an arbitrary string to a known model id. */
export function isAllowedModelId(value: unknown): value is GeminiModelId {
  return typeof value === 'string' && ALLOWED_MODEL_IDS.includes(value);
}

/**
 * Looks up a model's configuration, falling back to the default model's pricing
 * so the cost estimator can never divide by undefined.
 */
export function getModelConfig(modelId: string): GeminiModelConfig {
  return GEMINI_MODELS.find((m) => m.id === modelId) ?? GEMINI_MODELS[0];
}

/**
 * Lowest temperature the Gemini API accepts.
 * Exposed so the client slider and the server validator agree on one range.
 */
export const MIN_TEMPERATURE = 0;

/**
 * Highest temperature the Gemini API accepts.
 *
 * The server previously clamped this to 1.0, silently rewriting any higher
 * request. Gemini accepts up to 2.0, so clamping at 1.0 made part of the
 * parameter space unreachable without any error telling the user why.
 */
export const MAX_TEMPERATURE = 2;
