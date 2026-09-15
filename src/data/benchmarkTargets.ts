import { BenchmarkTarget } from '../types';

export const UNRELATED_FEW_SHOT_POOL = [
  {
    language: 'python',
    domain: 'Audio DSP / Digital Signal Processing',
    code: `def apply_biquad_notch_filter(signal: list[float], sample_rate: int, notch_freq: float, q_factor: float = 30.0) -> list[float]:
    w0 = 2.0 * math.pi * notch_freq / sample_rate
    alpha = math.sin(w0) / (2.0 * q_factor)
    b0, b1, b2 = 1.0, -2.0 * math.cos(w0), 1.0
    a0, a1, a2 = 1.0 + alpha, -2.0 * math.cos(w0), 1.0 - alpha
    out = [0.0] * len(signal)
    x1 = x2 = y1 = y2 = 0.0
    for i, x in enumerate(signal):
        y = (b0/a0)*x + (b1/a0)*x1 + (b2/a0)*x2 - (a1/a0)*y1 - (a2/a0)*y2
        out[i] = y
        x2, x1, y2, y1 = x1, x, y1, y
    return out`,
    docstring: `"""Applies a second-order IIR biquad notch filter to suppress a single target frequency.

Computes standard Robert Bristow-Johnson biquad filter coefficients to eliminate harmonic hum
(such as 50Hz/60Hz mains line noise) with minimum phase distortion across the passband.

Args:
    signal: Discrete floating-point audio time-series samples.
    sample_rate: Sampling frequency in Hertz (e.g. 44100 or 48000).
    notch_freq: Center frequency in Hertz to attenuate to zero.
    q_factor: Quality factor determining bandwidth sharpness (-3dB width = notch_freq / Q).

Returns:
    Filtered signal samples matching the input length.
"""`
  },
  {
    language: 'python',
    domain: 'Computer Vision / Color Spaces',
    code: `def rgb_to_cielab_d65(r: float, g: float, b: float) -> tuple[float, float, float]:
    def srgb_inv_gamma(c: float) -> float:
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    
    r_lin = srgb_inv_gamma(r / 255.0)
    g_lin = srgb_inv_gamma(g / 255.0)
    b_lin = srgb_inv_gamma(b / 255.0)
    
    X = r_lin * 0.4124564 + g_lin * 0.3575761 + b_lin * 0.1804375
    Y = r_lin * 0.2126729 + g_lin * 0.7151522 + b_lin * 0.0721750
    Z = r_lin * 0.0193339 + g_lin * 0.1191920 + b_lin * 0.9503041
    
    Xn, Yn, Zn = 0.95047, 1.00000, 1.08883
    def f(t: float) -> float:
        return t ** (1/3) if t > 0.008856 else (7.787 * t) + (16 / 116)
        
    L = (116.0 * f(Y / Yn)) - 16.0
    a = 500.0 * (f(X / Xn) - f(Y / Yn))
    b_val = 200.0 * (f(Y / Yn) - f(Z / Zn))
    return (L, a, b_val)`,
    docstring: `"""Converts standard non-linear sRGB coordinates to perceptually uniform CIE L*a*b* under a D65 standard illuminant.

Linearizes sRGB color values using IEC 61966-2-1 inverse gamma companding, transforms to intermediate
CIE 1931 XYZ space, and projects into L*a*b* to enable Euclidean Delta-E color distance calculations.

Args:
    r: Red channel byte value [0, 255].
    g: Green channel byte value [0, 255].
    b: Blue channel byte value [0, 255].

Returns:
    A 3-tuple (L*, a*, b*) where L* represents lightness [0, 100], a* is the green-red chromatic axis,
    and b* is the blue-yellow chromatic axis.
"""`
  },
  {
    language: 'python',
    domain: 'Graph Theory / Network Flow',
    code: `def edmonds_karp_max_flow(capacity_matrix: list[list[int]], source: int, sink: int) -> int:
    n = len(capacity_matrix)
    residual = [row[:] for row in capacity_matrix]
    parent = [-1] * n
    max_flow = 0

    def bfs() -> bool:
        visited = [False] * n
        queue = collections.deque([source])
        visited[source] = True
        while queue:
            u = queue.popleft()
            for v in range(n):
                if not visited[v] and residual[u][v] > 0:
                    parent[v] = u
                    visited[v] = True
                    if v == sink:
                        return True
                    queue.append(v)
        return False

    while bfs():
        path_flow = float('inf')
        s = sink
        while s != source:
            path_flow = min(path_flow, residual[parent[s]][s])
            s = parent[s]
        max_flow += path_flow
        v = sink
        while v != source:
            u = parent[v]
            residual[u][v] -= path_flow
            residual[v][u] += path_flow
            v = parent[v]

    return max_flow`,
    docstring: `"""Computes the maximum s-t flow in a directed capacity network using the Edmonds-Karp algorithm.

Implements the Ford-Fulkerson method parameterized by Breadth-First Search (BFS) to discover shortest
augmenting paths in terms of edge count, guaranteeing termination in O(V * E^2) time complexity.

Args:
    capacity_matrix: An n x n non-negative adjacency matrix representing edge capacities.
    source: Zero-indexed node index of the flow producer.
    sink: Zero-indexed node index of the flow consumer.

Returns:
    Total integer flow saturation reachable from source to sink.
"""`
  }
];

export const BENCHMARK_TARGETS: BenchmarkTarget[] = [
  {
    id: 'token-bucket-rate-limiter',
    name: 'TokenBucketRateLimiter.consume',
    language: 'python',
    category: 'Concurrency & Distributed Systems',
    difficulty: 'Subtle Bug History',
    description: 'A lock-free sliding token bucket rate limiter with monotonic millisecond precision and burst debt replenishment.',
    groundTruthIntent: 'Crucially handles microsecond monotonic clock drift on virtualized hypervisors and prevents thundering-herd starvation during Redis failover by decaying burst debt rather than resetting tokens to zero.',
    targetCode: `def consume(
    self,
    key: str,
    cost: int = 1,
    max_tokens: int = 100,
    refill_rate_per_sec: float = 10.0,
    allow_burst_debt: bool = False
) -> tuple[bool, float, int]:
    now = time.monotonic()
    with self._shard_lock(key):
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = BucketState(tokens=float(max_tokens), last_refill=now, debt=0)
            self._buckets[key] = bucket

        elapsed = max(0.0, now - bucket.last_refill)
        replenished = elapsed * refill_rate_per_sec
        bucket.tokens = min(float(max_tokens), bucket.tokens + replenished)
        bucket.last_refill = now

        if bucket.debt > 0:
            payoff = min(bucket.tokens, float(bucket.debt))
            bucket.tokens -= payoff
            bucket.debt -= int(payoff)

        if bucket.tokens >= cost:
            bucket.tokens -= cost
            remaining = int(bucket.tokens)
            reset_time = (float(max_tokens) - bucket.tokens) / refill_rate_per_sec
            return True, reset_time, remaining
        
        if allow_burst_debt and (bucket.debt + cost) <= (max_tokens * 0.5):
            bucket.debt += cost
            reset_time = (cost + bucket.debt) / refill_rate_per_sec
            return True, reset_time, -bucket.debt

        needed = cost - bucket.tokens
        retry_after = needed / refill_rate_per_sec
        return False, retry_after, int(bucket.tokens)`,
    referenceDocstring: `"""Attempts to consume token quota for a given partition key under a token bucket algorithm with burst debt tolerance.

Thread-safely evaluates and replenishes available tokens based on monotonic elapsed time. Supports bounded
burst overdraft for critical high-priority RPCs, deferring cost repayment into subsequent refill cycles.

Args:
    key: Unique identity shard identifier (e.g. client API key or tenant ID).
    cost: Number of tokens requested for the incoming operation (default: 1).
    max_tokens: Maximum capacity ceiling of the bucket.
    refill_rate_per_sec: Number of tokens generated per continuous second.
    allow_burst_debt: If True, permits transient deficit consumption up to 50% of bucket ceiling.

Returns:
    A 3-tuple (allowed, retry_or_reset_delay, remaining_or_debt_tokens):
        - allowed (bool): True if the request was granted; False if rejected.
        - retry_or_reset_delay (float): Seconds until full reset if allowed, or seconds until sufficient tokens exist if rejected.
        - remaining_or_debt_tokens (int): Balance remaining (positive) or current deficit balance (negative).
"""`,
    callGraphContext: {
      modulePath: 'gateway/ratelimit/token_bucket.py',
      callers: [
        {
          name: 'AuthGatewayMiddleware.enforce_rate_limits',
          signature: 'async def enforce_rate_limits(request: Request, client_meta: ClientTier) -> None',
          context: 'Invoked on every incoming HTTP/gRPC request. If consume() returns False, immediately serializes an RFC 6585 HTTP 429 response with Retry-After header set to retry_or_reset_delay.'
        },
        {
          name: 'TieredBillingInterceptor.precheck_quota',
          signature: 'def precheck_quota(tenant: TenantAccount, operation: BillingEvent) -> bool',
          context: 'Calls consume(allow_burst_debt=True) for Enterprise SLA tenants to guarantee zero drop rate during batch webhook ingress bursts.'
        }
      ],
      callees: [
        {
          name: '_shard_lock',
          signature: 'def _shard_lock(key: str) -> Lock',
          context: 'Returns a striped Mutex based on fnv1a(key) % NUM_SHARDS to reduce lock contention across 256 parallel worker coroutines.'
        }
      ],
      architecturalNotes: 'Part of the L4 ingress proxy data plane. Latency critical path (<15 microseconds budget per evaluation). Operates entirely in memory before optional asynchronous Redis persistence sync.'
    },
    gitHistoryContext: {
      commits: [
        {
          hash: 'a9f1c2d',
          date: '2025-11-14',
          author: 'Alex Chen <alex.chen@infra.internal>',
          message: 'fix(ratelimit): prevent thundering-herd lock starvation during hypervisor clock drift',
          diffHunk: `@@ -12,4 +12,7 @@
-        elapsed = now - bucket.last_refill
+        # Clamp elapsed time to 0.0 to prevent negative token deductions when
+        # AWS Xen/KVM hypervisor monotonic clock sync occasionally steps backwards by microseconds.
+        elapsed = max(0.0, now - bucket.last_refill)`
        },
        {
          hash: 'e48b77a',
          date: '2025-09-02',
          author: 'Maya Lin <maya@payments.internal>',
          message: 'feat(ratelimit): add burst debt amortization for Enterprise tier webhooks',
          diffHunk: `@@ -22,6 +22,12 @@
+        if allow_burst_debt and (bucket.debt + cost) <= (max_tokens * 0.5):
+            bucket.debt += cost
+            reset_time = (cost + bucket.debt) / refill_rate_per_sec
+            return True, reset_time, -bucket.debt`
        }
      ],
      prDiscussion: 'PR #1402: "During Black Friday load testing, Enterprise clients reported 429 drops on 100ms micro-bursts despite idle 10s averages. Burst debt enables temporary overdraft while still throttling sustained abuse."'
    },
    fewShotControlExamples: UNRELATED_FEW_SHOT_POOL
  },
  {
    id: 'lru-cache-evict-stale',
    name: 'LRUCache.evictStaleEntries',
    language: 'typescript',
    category: 'Memory Management & Data Structures',
    difficulty: 'Deep Call Graph',
    description: 'Eviction routine in a tiered LRU memory store that scans for expired TTL entries while honoring active read leases.',
    groundTruthIntent: 'Preserves active read leases (pinned nodes) to prevent use-after-free race conditions during concurrent zero-copy serialization in WebSocket worker threads.',
    targetCode: `public evictStaleEntries(
  batchSize: number = 64,
  maxScanBudgetUs: number = 500,
  forceGc: boolean = false
): EvictionReport {
  const startTime = performance.now();
  let scanned = 0;
  let evicted = 0;
  let pinnedSkipped = 0;

  let current = this.tail;
  const now = Date.now();

  while (current && scanned < batchSize) {
    const prev = current.prev;
    scanned++;

    const isExpired = current.expiresAt > 0 && current.expiresAt <= now;
    const isOverCapacity = this.currentByteSize > this.maxByteCapacity;

    if (isExpired || isOverCapacity || forceGc) {
      if (current.activeLeaseCount > 0) {
        pinnedSkipped++;
      } else {
        this.unlinkNode(current);
        this.index.delete(current.key);
        this.currentByteSize -= current.byteSize;
        this.disposeCallback?.(current.key, current.value, isExpired ? 'ttl' : 'capacity');
        evicted++;
      }
    }

    if ((performance.now() - startTime) * 1000 > maxScanBudgetUs) {
      break;
    }

    current = prev;
  }

  return {
    scannedCount: scanned,
    evictedCount: evicted,
    pinnedSkippedCount: pinnedSkipped,
    durationMicros: Math.round((performance.now() - startTime) * 1000),
    remainingByteSize: this.currentByteSize
  };
}`,
    referenceDocstring: `/**
 * Scans backwards from least-recently used tail to reclaim expired and over-capacity cache items within a bounded time budget.
 *
 * Traverses the doubly-linked list backwards, unlinking stale items and triggering disposal callbacks.
 * Skips items with active concurrent read leases to prevent memory corruption.
 *
 * @param batchSize - Maximum number of candidate nodes to inspect in a single invocation (default: 64).
 * @param maxScanBudgetUs - Microsecond wall-clock ceiling to prevent blocking the event loop (default: 500us).
 * @param forceGc - When true, forces unconditional purging of unpinned items regardless of expiration.
 * @returns EvictionReport detailing counts of scanned, reclaimed, and pinned nodes alongside duration.
 */`,
    callGraphContext: {
      modulePath: 'src/cache/tiered_lru_cache.ts',
      callers: [
        {
          name: 'SessionSyncService.heartbeatTick',
          signature: 'private onInterval(): void',
          context: 'Runs every 100ms on the Node.js event loop timer. Calls evictStaleEntries(32, 200) to opportunistically clean expired JWT session cache entries.'
        },
        {
          name: 'MemoryPressureWatcher.onHeapHighWatermark',
          signature: 'public onMemoryWarning(): void',
          context: 'Invoked by v8 heap profiler hook when resident memory reaches 85% of cgroup limit. Calls evictStaleEntries(256, 2000, true).'
        }
      ],
      callees: [
        {
          name: 'unlinkNode',
          signature: 'private unlinkNode(node: LRUNode<K, V>): void',
          context: 'Splices node out of pointers (node.prev.next = node.next) and adjusts head/tail pointers in O(1).'
        }
      ],
      architecturalNotes: 'Zero-copy in-memory buffer cache for real-time WebSocket connection state. Concurrency is managed via read lease refcounting.'
    },
    gitHistoryContext: {
      commits: [
        {
          hash: 'c813f2b',
          date: '2025-10-18',
          author: 'David Zhang <dzhang@core.io>',
          message: 'fix(lru): guard pinned entries against eviction while buffer is in flight',
          diffHunk: `@@ -18,2 +18,6 @@
-        this.unlinkNode(current);
+      if (current.activeLeaseCount > 0) {
+        pinnedSkipped++;
+      } else {
+        this.unlinkNode(current);`
        }
      ],
      prDiscussion: 'PR #884: "Resolves SEV-2 crash where high-speed WebSocket broadcast was reading ArrayBuffer slices from cache while background GC unlinked and freed the memory."'
    },
    fewShotControlExamples: UNRELATED_FEW_SHOT_POOL
  },
  {
    id: 'payment-idempotent-retry',
    name: 'PaymentGateway.retry_idempotent_charge',
    language: 'python',
    category: 'Fintech & Transaction Processing',
    difficulty: 'High Architectural Complexity',
    description: 'Handles idempotent charge retries across upstream card processing gateways with exponential backoff and 2PC settlement verification.',
    groundTruthIntent: 'Distinguishes between deterministic network timeouts (requiring idempotent replay with the same UUID) and upstream card declines (which must NEVER be retried to prevent double charges and cardholder fraud flags).',
    targetCode: `def retry_idempotent_charge(
    self,
    charge_request: ChargeIntent,
    max_retries: int = 3,
    base_backoff_ms: int = 250,
    enable_two_phase_verify: bool = True
) -> ChargeResult:
    idempotency_key = charge_request.idempotency_key or self._generate_v5_uuid(charge_request)
    attempt = 0

    while attempt < max_retries:
        attempt += 1
        try:
            raw_response = self._http_client.post(
                "/v1/charges",
                json=charge_request.to_payload(),
                headers={"Idempotency-Key": idempotency_key},
                timeout=5.0
            )

            if raw_response.status_code == 200:
                data = raw_response.json()
                return ChargeResult.succeeded(charge_id=data["id"], amount=data["amount"])

            if raw_response.status_code in (400, 402, 403, 404):
                err = raw_response.json().get("error", {})
                return ChargeResult.fatal_rejection(
                    code=err.get("code", "CARD_DECLINED"),
                    reason=err.get("message", "Terminal card decline")
                )

            if raw_response.status_code in (429, 500, 502, 503, 504):
                if attempt >= max_retries:
                    break
                sleep_sec = (base_backoff_ms * (2 ** (attempt - 1)) + random.uniform(10, 50)) / 1000.0
                time.sleep(sleep_sec)
                continue

        except (TimeoutError, ConnectionError) as network_exc:
            if enable_two_phase_verify:
                reconciliation = self._query_transaction_status(idempotency_key)
                if reconciliation.is_known_settled:
                    return ChargeResult.succeeded(charge_id=reconciliation.charge_id, amount=charge_request.amount)
            
            if attempt >= max_retries:
                return ChargeResult.ambiguous_timeout(idempotency_key=idempotency_key, original_error=str(network_exc))

            sleep_sec = (base_backoff_ms * (2 ** attempt) + random.uniform(10, 50)) / 1000.0
            time.sleep(sleep_sec)

    return ChargeResult.exhausted_retries(attempts=attempt, idempotency_key=idempotency_key)`,
    referenceDocstring: `"""Executes an idempotent credit card charge against upstream payment processor gateways with fault-tolerant retry policy.

Ensures strict single-billing guarantees by injecting standard Idempotency-Key headers. Distinguishes fatal
card declines (HTTP 4xx) from transient server/network failures (HTTP 5xx, socket timeouts), and runs a
two-phase reconciliation query before retrying uncertain network disconnects.

Args:
    charge_request: Structured ChargeIntent holding amount, currency, customer token, and idempotency key.
    max_retries: Maximum number of retry attempts for transient errors before aborting (default: 3).
    base_backoff_ms: Initial exponential backoff base in milliseconds before full jitter calculation.
    enable_two_phase_verify: If True, queries payment processor status via idempotency key prior to re-issuing post-timeout requests.

Returns:
    ChargeResult indicating final status: SUCCEEDED, FATAL_REJECTION (card declined/invalid), or AMBIGUOUS_TIMEOUT.
"""`,
    callGraphContext: {
      modulePath: 'billing/core/gateway.py',
      callers: [
        {
          name: 'SubscriptionBillingWorker.process_recurring_invoice',
          signature: 'def process_recurring_invoice(invoice: Invoice) -> None',
          context: 'Processes automated monthly SaaS renewals for 500k customers. Relies on fatal_rejection to mark subscription suspended vs ambiguous_timeout to enqueue for reconciliation audit.'
        }
      ],
      callees: [
        {
          name: '_query_transaction_status',
          signature: 'def _query_transaction_status(idempotency_key: str) -> ReconciliationStatus',
          context: 'Out-of-band GET /v1/charges/lookup?idempotency_key=... to check whether dropped TCP socket actually debited the user.'
        }
      ],
      architecturalNotes: 'PCI-DSS Level 1 compliant payment pipeline. Double-charging or dropping settled transaction states results in severe compliance fines.'
    },
    gitHistoryContext: {
      commits: [
        {
          hash: '7b92ee3',
          date: '2025-08-19',
          author: 'Sarah Jenkins <sjenkins@fintech.internal>',
          message: 'fix(billing): add 2-phase verify lookup on socket timeout to avoid double charges',
          diffHunk: `@@ -31,3 +31,8 @@
+        except (TimeoutError, ConnectionError) as network_exc:
+            if enable_two_phase_verify:
+                reconciliation = self._query_transaction_status(idempotency_key)
+                if reconciliation.is_known_settled:
+                    return ChargeResult.succeeded(charge_id=reconciliation.charge_id, amount=charge_request.amount)`
        }
      ],
      prDiscussion: 'PR #411: "During AWS us-east-1 gateway drops, 14 customers were charged twice because socket timeouts occurred after processor settled card. 2-phase verify inspects processor cache before retry."'
    },
    fewShotControlExamples: UNRELATED_FEW_SHOT_POOL
  },
  {
    id: 'distributed-lock-acquire',
    name: 'DistributedLock.AcquireWithBackoff',
    language: 'go',
    category: 'Distributed Coordination',
    difficulty: 'Deep Call Graph',
    description: 'Acquires a distributed cluster lease with fencing tokens, monotonic heartbeat extension, and randomized truncated backoff.',
    groundTruthIntent: 'Issues monotonically increasing fencing tokens to prevent split-brain write anomalies when GC pauses delay release.',
    targetCode: `func (l *DistributedLock) AcquireWithBackoff(
	ctx context.Context,
	leaseKey string,
	ttl time.Duration,
	maxWait time.Duration,
) (*LeaseToken, error) {
	deadline := time.Now().Add(maxWait)
	attempt := 0
	baseInterval := 25 * time.Millisecond
	clientUUID := l.nodeIdentifier

	for {
		attempt++
		fenceToken, err := l.driver.CompareAndSwap(ctx, leaseKey, clientUUID, ttl)
		if err == nil {
			heartbeatCtx, cancelHeartbeat := context.WithCancel(context.Background())
			token := &LeaseToken{
				Key:          leaseKey,
				OwnerID:      clientUUID,
				FencingToken: fenceToken,
				TTL:          ttl,
				cancelFn:     cancelHeartbeat,
			}
			go l.maintainHeartbeat(heartbeatCtx, leaseKey, clientUUID, ttl/2)
			return token, nil
		}

		if errors.Is(err, ErrUnrecoverableClusterSplit) {
			return nil, fmt.Errorf("cluster partitioned: %w", err)
		}

		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil, fmt.Errorf("failed to acquire lock '%s' within %v: %w", leaseKey, maxWait, ErrLockTimeout)
		}

		jitter := time.Duration(rand.Int63n(int64(baseInterval)))
		sleepDuration := (baseInterval * time.Duration(1<<uint(min(attempt, 6)))) + jitter
		if time.Now().Add(sleepDuration).After(deadline) {
			sleepDuration = time.Until(deadline)
		}

		select {
		case <-time.After(sleepDuration):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}`,
    referenceDocstring: `// AcquireWithBackoff repeatedly attempts to obtain an exclusive cluster lease on leaseKey until success, deadline expiry, or context cancellation.
//
// Uses atomic compare-and-swap on the underlying storage driver. On acquisition, spawns an asynchronous
// background goroutine to refresh heartbeat leases at ttl/2 intervals and yields a monotonically increasing
// fencing token to guard against asynchronous GC-pause split-brain write collisions.
//
// Parameters:
//   - ctx: Context controlling cancellation and caller timeouts.
//   - leaseKey: Unique string identifying the protected shared resource.
//   - ttl: Lease expiration duration if heartbeats fail.
//   - maxWait: Maximum total duration to spend retrying CAS acquisition before failing with ErrLockTimeout.
//
// Returns:
//   - *LeaseToken: Managed lock handle containing owner UUID, cancellation hook, and 64-bit fencing token.
//   - error: Non-nil if timeout was reached, cluster split-brain occurred, or context cancelled.`,
    callGraphContext: {
      modulePath: 'pkg/coordination/distributed_lock.go',
      callers: [
        {
          name: 'SchemaMigrationRunner.ExecuteClusterMigration',
          signature: 'func (r *Runner) ExecuteClusterMigration(ctx context.Context) error',
          context: 'Acquires lock with ttl=30s and maxWait=5m to ensure exactly one Kubernetes pod runs DDL schema migrations at startup.'
        }
      ],
      callees: [
        {
          name: 'maintainHeartbeat',
          signature: 'func (l *DistributedLock) maintainHeartbeat(ctx context.Context, key string, owner string, interval time.Duration)',
          context: 'Ticker loop sending TTL extension requests every ttl/2. Terminates immediately when LeaseToken.Release() cancels context.'
        }
      ],
      architecturalNotes: 'Consensus primitive built on etcd / Raft. Adheres to Martin Kleppmann fencing token design.'
    },
    gitHistoryContext: {
      commits: [
        {
          hash: '3f1190a',
          date: '2025-06-11',
          author: 'Jonas Lindqvist <jonas@distributed.dev>',
          message: 'feat(lock): introduce monotonically incrementing fencing tokens to prevent split-brain writes',
          diffHunk: `@@ -15,4 +15,7 @@
-			token := &LeaseToken{Key: leaseKey, OwnerID: clientUUID}
+			token := &LeaseToken{
+				Key:          leaseKey,
+				OwnerID:      clientUUID,
+				FencingToken: fenceToken,
+				TTL:          ttl,
+			}`
        }
      ],
      prDiscussion: 'PR #204: "Implements fencing tokens as recommended in Kleppmann critique of Redlock. Without fencing tokens, long GC pauses cause old lock holders to overwrite data written by new lock holders."'
    },
    fewShotControlExamples: UNRELATED_FEW_SHOT_POOL
  }
];
