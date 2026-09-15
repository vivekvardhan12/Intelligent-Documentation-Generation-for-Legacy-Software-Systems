/**
 * Typed HTTP client for this app's own API.
 *
 * WHY THIS EXISTS
 * Five modules each hand-rolled the same `fetch` call with subtly different
 * error handling, and all five discarded the server's error message:
 *
 *     if (res.ok) { ... }          // silent no-op on failure
 *     throw new Error(`Server returned status ${res.status}`);
 *
 * The server now returns `{ error, details }` with genuinely useful text
 * ("quota exceeded", "model not found", "docstring cannot be empty"), so
 * throwing away the body in favour of a bare status code destroys the one piece
 * of information a user needs to fix the problem.
 *
 * This module centralizes: reading the error body, distinguishing a deliberate
 * cancellation from a real failure, and threading an AbortSignal so a long run
 * can actually be stopped.
 */

/** Raised when a request fails. Carries the server's own explanation. */
export class ApiError extends Error {
  /** HTTP status, or 0 for a network-level failure. */
  readonly status: number;
  /** Field-level validation messages from the server's zod schemas. */
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** A single string suitable for a toast or an inline error badge. */
  get displayMessage(): string {
    return this.details.length > 0 ? `${this.message} (${this.details.join('; ')})` : this.message;
  }
}

/** Raised when a request was cancelled by the user, not by a failure. */
export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'RequestCancelledError';
  }
}

/** True when an unknown thrown value represents a user-initiated cancellation. */
export function isCancellation(error: unknown): boolean {
  if (error instanceof RequestCancelledError) return true;
  // fetch() rejects with a DOMException named 'AbortError' when aborted.
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * POSTs a JSON body and returns the parsed JSON response.
 *
 * Throws `RequestCancelledError` if aborted, or `ApiError` on any HTTP or
 * network failure — never returns a partial or placeholder result. Callers are
 * expected to handle the throw and record a failure, rather than substituting
 * a default value.
 *
 * @param path   API path, e.g. '/api/gemini/generate-arms'.
 * @param body   Any JSON-serializable payload.
 * @param signal Optional AbortSignal for cancellation.
 */
export async function postJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    if (isCancellation(error)) throw new RequestCancelledError();
    // A rejected fetch means the request never reached the server at all —
    // offline, DNS failure, or the dev server not running.
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed',
      0
    );
  }

  if (!response.ok) {
    // Read the structured error the server sends. Guarded because an error
    // response from a proxy or crash may not be JSON at all.
    let message = `Request failed with status ${response.status}`;
    let details: string[] = [];

    try {
      const errorBody = await response.json();
      if (typeof errorBody?.error === 'string') message = errorBody.error;
      if (Array.isArray(errorBody?.details)) details = errorBody.details.map(String);
    } catch {
      // Non-JSON error body; the status-based message stands.
    }

    throw new ApiError(message, response.status, details);
  }

  try {
    return (await response.json()) as TResponse;
  } catch (error: unknown) {
    if (isCancellation(error)) throw new RequestCancelledError();
    throw new ApiError('Server returned a malformed JSON response', response.status);
  }
}

/**
 * Throws if the signal has already been aborted.
 *
 * Used between the phases of a long run so cancellation takes effect promptly
 * instead of only at the next network boundary.
 */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestCancelledError();
}
