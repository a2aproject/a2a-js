/**
 * Adaptive transport selection — bio-inspired strategy.
 *
 * Inspired by cellular signal pathway selection: cells activate different
 * signaling cascades (cAMP, Ca²⁺, MAPK) depending on recent efficacy and
 * response speed.  This module applies the same principle to A2A transport
 * selection: transports that succeed more often and respond faster are
 * preferred, while failing transports are deprioritized and allowed to
 * recover over time.
 *
 * Usage:
 * ```ts
 * const stats = new TransportStats();
 * const options = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
 *   clientConfig: { interceptors: [new AdaptiveTransportInterceptor(stats)] },
 * });
 * // Before each request, read preferred order:
 * const preferred = stats.preferredOrder();
 * ```
 *
 * @see Kholodenko, B.N. (2006) "Cell-signalling dynamics in time and space."
 *   Nat Rev Mol Cell Biol 7:165-176.
 *
 * @module
 */

import { CallInterceptor, BeforeArgs, AfterArgs } from '../interceptors.js';

// ---------------------------------------------------------------------------
// Transport statistics
// ---------------------------------------------------------------------------

interface TransportRecord {
  ok: boolean;
  latencyMs: number;
  timestamp: number;
}

/**
 * Tracks per-transport success rates and latencies within a sliding window.
 *
 * Analogous to how cells monitor pathway efficacy: each signaling cascade
 * has an implicit "success rate" (fraction of signals that reach the
 * nucleus) and a "latency" (time from receptor activation to gene
 * expression).  Pathways with higher efficacy and lower latency are
 * preferentially activated.
 */
export class TransportStats {
  private readonly windowSize: number;
  private readonly latencyNormalizer: number;
  private readonly records = new Map<string, TransportRecord[]>();

  /**
   * @param windowSize      Number of recent outcomes to keep per transport.
   * @param latencyNormalizer  When average latency equals this value (ms),
   *   the latency factor is 0.5.  Analogous to the Km in Michaelis-Menten
   *   kinetics: half-maximal response at this "concentration".
   */
  constructor(windowSize = 20, latencyNormalizer = 1000) {
    this.windowSize = Math.max(1, windowSize);
    this.latencyNormalizer = Math.max(1, latencyNormalizer);
  }

  /** Record a transport attempt outcome. */
  record(transport: string, ok: boolean, latencyMs: number): void {
    let list = this.records.get(transport);
    if (!list) {
      list = [];
      this.records.set(transport, list);
    }
    list.push({ ok, latencyMs: Math.max(0, latencyMs), timestamp: Date.now() });
    if (list.length > this.windowSize) {
      list.splice(0, list.length - this.windowSize);
    }
  }

  /** Success rate in [0, 1].  Returns 1 for unknown transports (explore-first). */
  successRate(transport: string): number {
    const list = this.records.get(transport);
    if (!list || list.length === 0) return 1;
    return list.filter((r) => r.ok).length / list.length;
  }

  /** Average latency (ms) of successful calls.  Returns 0 if unknown. */
  avgLatency(transport: string): number {
    const list = this.records.get(transport);
    if (!list) return 0;
    const ok = list.filter((r) => r.ok);
    if (ok.length === 0) return 0;
    return ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length;
  }

  /**
   * Composite score: `successRate × latencyFactor`.
   *
   * `latencyFactor = 1 / (1 + avgLatency / normalizer)`
   *
   * Higher score = preferred transport.  Unknown transports score 1.0
   * (explore-first, analogous to immune system sampling novel antigens).
   */
  getScore(transport: string): number {
    const sr = this.successRate(transport);
    const avg = this.avgLatency(transport);
    return sr * (1 / (1 + avg / this.latencyNormalizer));
  }

  /** Number of recorded outcomes for a transport. */
  count(transport: string): number {
    return this.records.get(transport)?.length ?? 0;
  }

  /**
   * Returns transport names ordered by descending score.
   * Only includes transports that have at least one recorded outcome.
   */
  preferredOrder(): string[] {
    return Array.from(this.records.keys()).sort((a, b) => this.getScore(b) - this.getScore(a));
  }

  /** Clear all recorded data. */
  clear(): void {
    this.records.clear();
  }
}

// ---------------------------------------------------------------------------
// Adaptive transport interceptor
// ---------------------------------------------------------------------------

/**
 * A {@link CallInterceptor} that records transport outcomes into
 * {@link TransportStats} for adaptive transport selection.
 *
 * Attach to `ClientConfig.interceptors` to automatically track success/failure
 * and latency of every transport call.
 *
 * @example
 * ```ts
 * const stats = new TransportStats();
 * const interceptor = new AdaptiveTransportInterceptor(stats);
 *
 * const factory = new ClientFactory(
 *   ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
 *     clientConfig: { interceptors: [interceptor] },
 *   })
 * );
 * ```
 */
export class AdaptiveTransportInterceptor implements CallInterceptor {
  private readonly stats: TransportStats;
  private readonly timers = new Map<string, number>();

  constructor(stats: TransportStats) {
    this.stats = stats;
  }

  async before(args: BeforeArgs): Promise<void> {
    if (!args.input) return;
    // Record start time keyed by a unique request identifier.
    // We use the method name + timestamp as a simple key since
    // interceptors are invoked synchronously per request.
    const key = `${args.input.method}:${Date.now()}`;
    this.timers.set(key, performance.now());
    // Store key in options for retrieval in after()
    if (!args.options) {
      args.options = {};
    }
    (args.options as Record<string, unknown>)['_adaptiveTimerKey'] = key;
  }

  async after(args: AfterArgs): Promise<void> {
    if (!args.result) return;
    const key = (args.options as Record<string, unknown> | undefined)?.['_adaptiveTimerKey'] as
      | string
      | undefined;
    if (!key) return;

    const startTime = this.timers.get(key);
    this.timers.delete(key);
    if (startTime === undefined) return;

    const latencyMs = performance.now() - startTime;

    // Determine transport name from agent card's supported protocols.
    // The first matching protocol is the one being used.
    const protocols =
      args.agentCard?.additionalInterfaces?.map((i: { transport?: string }) => i.transport) ?? [];
    const transport = protocols[0] ?? 'unknown';

    // Determine success based on whether result contains an error-like value.
    const ok = !isErrorResult(args.result);
    this.stats.record(transport, ok, latencyMs);
  }

  /** Access the underlying stats for reading preferred order or scores. */
  getStats(): TransportStats {
    return this.stats;
  }
}

function isErrorResult(result: { value?: unknown }): boolean {
  const val = result?.value;
  if (val == null) return false;
  if (val instanceof Error) return true;
  if (typeof val === 'object' && 'error' in val) return true;
  return false;
}
