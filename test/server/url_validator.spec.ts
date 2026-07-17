import { describe, it, expect } from 'vitest';
import {
  validateWebhookUrl,
  UrlValidationError,
} from '../../src/server/push_notification/url_validator.js';

describe('validateWebhookUrl (SSRF Protection per A2A Spec §13.2)', () => {
  it('should allow valid public HTTP/HTTPS URLs', () => {
    expect(() => validateWebhookUrl('https://example.com/webhook')).not.toThrow();
    expect(() => validateWebhookUrl('http://api.external.org/v1/notify')).not.toThrow();
    expect(() => validateWebhookUrl('https://8.8.8.8/webhook')).not.toThrow();
  });

  it('should reject invalid URL strings', () => {
    expect(() => validateWebhookUrl('not-a-url')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('')).toThrow(UrlValidationError);
  });

  it('should reject non-HTTP/HTTPS schemes', () => {
    expect(() => validateWebhookUrl('file:///etc/passwd')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('ftp://example.com/file')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('gopher://127.0.0.1:70')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('javascript:alert(1)')).toThrow(UrlValidationError);
  });

  it('should reject loopback/localhost addresses by default', () => {
    expect(() => validateWebhookUrl('http://localhost:8080/webhook')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://sub.localhost/path')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://127.0.0.1:9999/keys')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://127.0.0.2/test')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://[::1]/test')).toThrow(UrlValidationError);
  });

  it('should reject link-local addresses by default', () => {
    expect(() => validateWebhookUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      UrlValidationError
    );
    expect(() => validateWebhookUrl('http://169.254.1.1/admin')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://[fe80::1]/admin')).toThrow(UrlValidationError);
  });

  it('should reject private RFC-1918 IPv4 ranges by default', () => {
    // 10.0.0.0/8
    expect(() => validateWebhookUrl('http://10.0.0.1/admin')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://10.255.255.254/secret')).toThrow(UrlValidationError);

    // 172.16.0.0/12
    expect(() => validateWebhookUrl('http://172.16.0.1/internal')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://172.31.255.255/internal')).toThrow(UrlValidationError);

    // 192.168.0.0/16
    expect(() => validateWebhookUrl('http://192.168.1.1/router')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://192.168.0.100/api')).toThrow(UrlValidationError);
  });

  it('should reject IPv6 unique local addresses (ULA) by default', () => {
    expect(() => validateWebhookUrl('http://[fc00::1]/api')).toThrow(UrlValidationError);
    expect(() => validateWebhookUrl('http://[fd00::1]/api')).toThrow(UrlValidationError);
  });

  it('should allow loopback when allowLoopback option is true', () => {
    expect(() =>
      validateWebhookUrl('http://127.0.0.1:8080/webhook', { allowLoopback: true })
    ).not.toThrow();
    expect(() =>
      validateWebhookUrl('http://localhost:3000/notify', { allowLoopback: true })
    ).not.toThrow();
  });

  it('should allow private networks when allowPrivateNetworks option is true', () => {
    expect(() =>
      validateWebhookUrl('http://10.0.0.1/notify', { allowPrivateNetworks: true })
    ).not.toThrow();
    expect(() =>
      validateWebhookUrl('http://192.168.1.1/notify', { allowPrivateNetworks: true })
    ).not.toThrow();
  });

  it('should respect allowedHosts allowlist', () => {
    expect(() =>
      validateWebhookUrl('http://127.0.0.1:8080/webhook', {
        allowedHosts: ['127.0.0.1'],
      })
    ).not.toThrow();

    expect(() =>
      validateWebhookUrl('http://internal.company.com/webhook', {
        allowedHosts: [/^internal\./],
      })
    ).not.toThrow();
  });
});
