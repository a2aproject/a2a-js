import { HTTP_EXTENSION_HEADER } from '../../constants.js';

export function generateExtensionsHeaders(extensions?: Set<string>): Record<string, string> {
  if (!extensions || extensions.size === 0) {
    return {};
  }
  return {
    [HTTP_EXTENSION_HEADER]: Array.from(extensions).join(','),
  };
}

export function extractExtensionsFromHeaders(headers: Headers): Set<string> {
    if (!headers.has(HTTP_EXTENSION_HEADER)) {
      return new Set();
    }
  return new Set(
    headers
      .get(HTTP_EXTENSION_HEADER)
      .split(',')
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0)
  );
}
