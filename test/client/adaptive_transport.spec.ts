import { describe, it, expect, beforeEach } from 'vitest';
import {
  TransportStats,
  AdaptiveTransportInterceptor,
} from '../../src/client/transports/adaptive_transport.js';

// ---------------------------------------------------------------------------
// TransportStats
// ---------------------------------------------------------------------------

describe('TransportStats', () => {
  let stats: TransportStats;

  beforeEach(() => {
    stats = new TransportStats(10, 1000);
  });

  it('returns score 1.0 for unknown transports (explore-first)', () => {
    expect(stats.getScore('JSONRPC')).toBe(1);
    expect(stats.successRate('JSONRPC')).toBe(1);
    expect(stats.avgLatency('JSONRPC')).toBe(0);
  });

  it('tracks success rate correctly', () => {
    stats.record('JSONRPC', true, 50);
    stats.record('JSONRPC', true, 50);
    stats.record('JSONRPC', false, 5000);
    expect(stats.successRate('JSONRPC')).toBeCloseTo(2 / 3);
  });

  it('tracks average latency of successful calls only', () => {
    stats.record('JSONRPC', true, 100);
    stats.record('JSONRPC', true, 200);
    stats.record('JSONRPC', false, 9999); // failure excluded
    expect(stats.avgLatency('JSONRPC')).toBe(150);
  });

  it('composite score penalizes high latency', () => {
    stats.record('FAST', true, 50);
    stats.record('SLOW', true, 2000);
    expect(stats.getScore('FAST')).toBeGreaterThan(stats.getScore('SLOW'));
  });

  it('composite score penalizes low success rate', () => {
    for (let i = 0; i < 10; i++) stats.record('RELIABLE', true, 100);
    for (let i = 0; i < 10; i++) stats.record('FLAKY', i < 5, 100);
    expect(stats.getScore('RELIABLE')).toBeGreaterThan(stats.getScore('FLAKY'));
  });

  it('reliable beats flaky even with higher latency', () => {
    // 50% success, 30ms
    for (let i = 0; i < 10; i++) stats.record('FAST_FLAKY', i < 5, 30);
    // 100% success, 800ms
    for (let i = 0; i < 10; i++) stats.record('SLOW_RELIABLE', true, 800);

    expect(stats.getScore('SLOW_RELIABLE')).toBeGreaterThan(
      stats.getScore('FAST_FLAKY')
    );
  });

  it('sliding window evicts old records', () => {
    // Fill window with failures
    for (let i = 0; i < 10; i++) stats.record('JSONRPC', false, 5000);
    expect(stats.successRate('JSONRPC')).toBe(0);

    // Now record 10 successes — old failures should be evicted
    for (let i = 0; i < 10; i++) stats.record('JSONRPC', true, 50);
    expect(stats.successRate('JSONRPC')).toBe(1);
  });

  it('preferredOrder sorts by descending score', () => {
    stats.record('WORST', false, 5000);
    stats.record('MIDDLE', true, 500);
    stats.record('BEST', true, 50);

    const order = stats.preferredOrder();
    expect(order[0]).toBe('BEST');
    expect(order[order.length - 1]).toBe('WORST');
  });

  it('count returns number of records', () => {
    expect(stats.count('JSONRPC')).toBe(0);
    stats.record('JSONRPC', true, 50);
    stats.record('JSONRPC', true, 60);
    expect(stats.count('JSONRPC')).toBe(2);
  });

  it('clear removes all data', () => {
    stats.record('JSONRPC', true, 50);
    stats.clear();
    expect(stats.count('JSONRPC')).toBe(0);
    expect(stats.getScore('JSONRPC')).toBe(1); // back to unknown default
  });
});

// ---------------------------------------------------------------------------
// AdaptiveTransportInterceptor
// ---------------------------------------------------------------------------

describe('AdaptiveTransportInterceptor', () => {
  it('exposes stats via getStats()', () => {
    const stats = new TransportStats();
    const interceptor = new AdaptiveTransportInterceptor(stats);
    expect(interceptor.getStats()).toBe(stats);
  });
});
