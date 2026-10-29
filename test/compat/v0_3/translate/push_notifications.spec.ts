import { describe, expect, it, vi } from 'vitest';
import {
  toCompatAuthenticationInfo,
  toCompatPushNotificationConfig,
  toCompatTaskPushNotificationConfig,
  toCoreAuthenticationInfo,
  toCorePushNotificationConfig,
  toCoreTaskPushNotificationConfig,
} from '../../../../src/compat/v0_3/translate/push_notifications.js';
import type { TaskPushNotificationConfig as V1TaskPushNotificationConfig } from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('push_notifications', () => {
  describe('AuthenticationInfo', () => {
    it('keeps only the first scheme going to core and logs a warning', () => {
      const compat: legacy.PushNotificationAuthenticationInfo = {
        schemes: ['Bearer', 'Basic'],
        credentials: 'token',
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(toCoreAuthenticationInfo(compat)).toEqual({ scheme: 'Bearer', credentials: 'token' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenLastCalledWith(
        expect.stringContaining(
          'toCoreAuthenticationInfo: Lossy conversion from v0.3 PushNotificationAuthenticationInfo to v1.0 AuthenticationInfo'
        )
      );

      warnSpy.mockRestore();
    });

    it('uses empty string when no schemes are provided and does not warn', () => {
      const compat: legacy.PushNotificationAuthenticationInfo = { schemes: [] };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(toCoreAuthenticationInfo(compat)).toEqual({ scheme: '', credentials: '' });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('wraps the single core scheme into a one-element array going to compat', () => {
      expect(toCompatAuthenticationInfo({ scheme: 'Bearer', credentials: 'tok' })).toEqual({
        schemes: ['Bearer'],
        credentials: 'tok',
      });
    });

    it('produces an empty schemes array when the core scheme is empty', () => {
      expect(toCompatAuthenticationInfo({ scheme: '', credentials: '' })).toEqual({ schemes: [] });
    });

    it('drops empty credentials going to compat', () => {
      expect(toCompatAuthenticationInfo({ scheme: 'Bearer', credentials: '' })).toEqual({
        schemes: ['Bearer'],
      });
    });
  });

  describe('PushNotificationConfig (inner record)', () => {
    it('converts compat → core with defaults', () => {
      const compat: legacy.PushNotificationConfig = { url: 'https://notify.example' };
      const core = toCorePushNotificationConfig(compat);
      expect(core.url).toBe('https://notify.example');
      expect(core.id).toBe('');
      expect(core.token).toBe('');
      expect(core.authentication).toBeUndefined();
    });

    it('preserves id, token, and authentication going compat → core', () => {
      const compat: legacy.PushNotificationConfig = {
        url: 'https://notify.example',
        id: 'pnc-1',
        token: 'tok',
        authentication: { schemes: ['Bearer'], credentials: 'cred' },
      };
      const core = toCorePushNotificationConfig(compat);
      expect(core.id).toBe('pnc-1');
      expect(core.token).toBe('tok');
      expect(core.authentication).toEqual({ scheme: 'Bearer', credentials: 'cred' });
    });

    it('strips empty fields going core → compat', () => {
      const core: V1TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: '',
        url: 'https://notify.example',
        token: '',
        authentication: undefined,
      };
      expect(toCompatPushNotificationConfig(core)).toEqual({ url: 'https://notify.example' });
    });

    it('preserves non-empty fields going core → compat', () => {
      const core: V1TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'task-1',
        id: 'pnc-1',
        url: 'https://notify.example',
        token: 'tok',
        authentication: { scheme: 'Bearer', credentials: 'cred' },
      };
      // The inner-record converter drops taskId.
      expect(toCompatPushNotificationConfig(core)).toEqual({
        url: 'https://notify.example',
        id: 'pnc-1',
        token: 'tok',
        authentication: { schemes: ['Bearer'], credentials: 'cred' },
      });
    });
  });

  describe('TaskPushNotificationConfig (nested)', () => {
    it('flattens nested compat → flat core', () => {
      const compat: legacy.TaskPushNotificationConfig = {
        taskId: 'task-1',
        pushNotificationConfig: {
          url: 'https://notify.example',
          id: 'pnc-1',
          token: 'tok',
          authentication: { schemes: ['Bearer'], credentials: 'cred' },
        },
      };
      const core = toCoreTaskPushNotificationConfig(compat);
      expect(core).toEqual({
        tenant: '',
        taskId: 'task-1',
        id: 'pnc-1',
        url: 'https://notify.example',
        token: 'tok',
        authentication: { scheme: 'Bearer', credentials: 'cred' },
      });
    });

    it('re-nests flat core → nested compat', () => {
      const core: V1TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'task-1',
        id: 'pnc-1',
        url: 'https://notify.example',
        token: 'tok',
        authentication: { scheme: 'Bearer', credentials: 'cred' },
      };
      expect(toCompatTaskPushNotificationConfig(core)).toEqual({
        taskId: 'task-1',
        pushNotificationConfig: {
          url: 'https://notify.example',
          id: 'pnc-1',
          token: 'tok',
          authentication: { schemes: ['Bearer'], credentials: 'cred' },
        },
      });
    });

    it('round-trips a fully-populated nested config', () => {
      const compat: legacy.TaskPushNotificationConfig = {
        taskId: 'task-1',
        pushNotificationConfig: {
          url: 'https://notify.example',
          id: 'pnc-1',
          token: 'tok',
          authentication: { schemes: ['Bearer'], credentials: 'cred' },
        },
      };
      expect(toCompatTaskPushNotificationConfig(toCoreTaskPushNotificationConfig(compat))).toEqual(
        compat
      );
    });
  });
});
