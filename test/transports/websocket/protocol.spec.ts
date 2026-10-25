import { describe, expect, it } from 'vitest';
import {
  isBinaryWebSocketData,
  isKnownWebSocketMethod,
  isStreamingWebSocketMethod,
  isWebSocketRequestId,
  mergeServiceParameters,
  normalizeServiceParameters,
  requestIdKey,
} from '../../../src/transports/websocket/protocol.js';

describe('WebSocket protocol helpers', () => {
  it('accepts only non-empty string or integer request ids', () => {
    expect(isWebSocketRequestId('req-1')).toBe(true);
    expect(isWebSocketRequestId(0)).toBe(true);
    expect(isWebSocketRequestId('')).toBe(false);
    expect(isWebSocketRequestId(1.5)).toBe(false);
    expect(isWebSocketRequestId(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWebSocketRequestId(null)).toBe(false);
    expect(isWebSocketRequestId(undefined)).toBe(false);
  });

  it('keeps string and numeric ids with the same text distinct', () => {
    expect(requestIdKey('1')).not.toBe(requestIdKey(1));
  });

  it('classifies methods', () => {
    expect(isStreamingWebSocketMethod('SendStreamingMessage')).toBe(true);
    expect(isStreamingWebSocketMethod('SubscribeToTask')).toBe(true);
    expect(isStreamingWebSocketMethod('SendMessage')).toBe(false);
    expect(isKnownWebSocketMethod('Authenticate')).toBe(true);
    expect(isKnownWebSocketMethod('message/send')).toBe(false);
  });

  it('lowercases service parameter keys and lets request values win', () => {
    expect(normalizeServiceParameters(undefined)).toEqual({});
    expect(
      mergeServiceParameters({ 'a2a-version': '1.0', 'x-a': 'conn' }, { 'X-A': 'req' })
    ).toEqual({ 'a2a-version': '1.0', 'x-a': 'req' });
    expect(mergeServiceParameters({ 'x-a': 'conn' }, undefined)).toEqual({ 'x-a': 'conn' });
  });

  it('treats anything other than a string as binary data', () => {
    expect(isBinaryWebSocketData('text')).toBe(false);
    expect(isBinaryWebSocketData(new Uint8Array())).toBe(true);
  });
});
