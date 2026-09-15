/**
 * Tests for the bounded-concurrency helper.
 *
 * Ordering is the property that matters most here: the runner relies on trial
 * results coming back in input order so that paired differences line up with
 * the correct trial number. A concurrency helper that returned results in
 * completion order would silently mis-pair every comparison.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TRIAL_CONCURRENCY, mapWithConcurrency } from './concurrency';

/** Resolves after `ms` milliseconds. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('returns results in INPUT order, not completion order', async () => {
    // Deliberately inverted delays: the last item finishes first.
    const results = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, index) => {
      await delay(ms);
      return index;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('processes every item', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 3, async (item) => item * 2);
    expect(results).toEqual(items.map((i) => i * 2));
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peakActive = 0;

    await mapWithConcurrency(Array.from({ length: 12 }), 3, async () => {
      active++;
      peakActive = Math.max(peakActive, active);
      await delay(5);
      active--;
      return null;
    });

    expect(peakActive).toBeLessThanOrEqual(3);
    // Confirms the pool really was saturated, so the bound above is meaningful.
    expect(peakActive).toBe(3);
  });

  it('runs sequentially at a limit of 1', async () => {
    const order: number[] = [];
    await mapWithConcurrency([3, 2, 1], 1, async (item) => {
      order.push(item);
      await delay(item);
      return item;
    });
    expect(order).toEqual([3, 2, 1]);
  });

  it('treats a limit below 1 as 1 rather than stalling', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (item) => item);
    expect(results).toEqual([1, 2, 3]);
  });

  it('caps the pool at the item count', async () => {
    let peakActive = 0;
    let active = 0;

    await mapWithConcurrency([1, 2], 100, async () => {
      active++;
      peakActive = Math.max(peakActive, active);
      await delay(5);
      active--;
      return null;
    });

    expect(peakActive).toBeLessThanOrEqual(2);
  });

  it('returns an empty array for no items', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('propagates the worker error', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('worker exploded');
        return item;
      })
    ).rejects.toThrow('worker exploded');
  });

  it('stops scheduling new work after a failure', async () => {
    const started: number[] = [];

    await expect(
      mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 2, async (item) => {
        started.push(item);
        await delay(1);
        if (item === 1) throw new Error('stop');
        return item;
      })
    ).rejects.toThrow('stop');

    // Far fewer than all 30 items should have been picked up.
    expect(started.length).toBeLessThan(30);
  });

  it('exposes a conservative default concurrency', async () => {
    expect(DEFAULT_TRIAL_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_TRIAL_CONCURRENCY).toBeLessThanOrEqual(4);
  });

  it('passes the index to the worker', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, index) =>
      `${index}:${item}`
    );
    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });
});
