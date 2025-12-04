import { HTTP_EXTENSION_HEADER } from '../../constants.js';

export function extractExtensionsFromHeaders(headers: Headers): string[] {
  if (!headers.has(HTTP_EXTENSION_HEADER)) {
    return [];
  }
  return headers
    .get(HTTP_EXTENSION_HEADER)
    .split(',')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
}
