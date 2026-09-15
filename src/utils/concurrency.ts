/**
 * Bounded-concurrency helpers.
 *
 * WHY NOT JUST Promise.all
 * `Promise.all` starts everything at once. For a 10-trial benchmark that means
 * ~90 simultaneous Gemini requests, which reliably trips per-minute rate limits
 * and returns a burst of 429s — slower overall than a controlled pace, and it
 * corrupts the experiment because rate-limited arms fail unevenly.
 *
 * WHY NOT A PLAIN SEQUENTIAL LOOP
 * That is what the runner did before: trials ran strictly one after another,
 * so wall-clock time scaled linearly with trial count. Since the statistical
 * layer needs 3-10 trials to say anything at all, sequential execution made the
 * honest configuration the painfully slow one.
 *
 * A small, bounded pool gives most of the speedup while staying inside quota.
 * Implemented here rather than pulled from a dependency because it is twenty
 * lines and adding a package for it would be the larger cost.
 */

/**
 * Maps over `items` with at most `limit` operations in flight at once.
 *
 * Results are returned in INPUT order regardless of completion order, which
 * matters here: trial 1's results must stay at index 0 so paired differences
 * line up with the right trial number.
 *
 * On rejection, the returned promise rejects with the first error, and no new
 * work is started — though operations already in flight are allowed to settle,
 * since a half-cancelled HTTP request cannot be un-sent.
 *
 * @param items  Inputs to process.
 * @param limit  Maximum simultaneous operations. Values < 1 are treated as 1.
 * @param worker Async operation receiving each item and its index.
 * @returns Results in the same order as `items`.
 *
 * Complexity: O(n) task scheduling overhead; wall-clock is
 * ~ceil(n / limit) x average operation duration.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit), items.length));

  // Shared cursor: each worker claims the next index atomically. JavaScript's
  // single-threaded event loop makes the increment safe without a lock.
  let nextIndex = 0;
  let failed = false;

  async function runWorker(): Promise<void> {
    while (!failed) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;

      // `worker` may throw; the rejection propagates out of Promise.all below.
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: effectiveLimit }, () => runWorker());

  try {
    await Promise.all(workers);
  } catch (error) {
    // Stop handing out new work so the run winds down promptly.
    failed = true;
    throw error;
  }

  return results;
}

/**
 * Default number of trials to run simultaneously.
 *
 * Two is deliberately conservative. Each trial already issues four concurrent
 * generation calls plus a judge call, so a concurrency of 2 means up to ~10
 * in-flight requests — enough to roughly halve wall-clock time on a multi-trial
 * run while staying well inside the free-tier request-per-minute allowance.
 */
export const DEFAULT_TRIAL_CONCURRENCY = 2;
