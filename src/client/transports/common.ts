import { HTTP_EXTENSION_HEADER } from '../../constants.js';

export function generateExtensionsHeaders(extensions?: string[]): Record<string, string> {
  if (!extensions || extensions.length === 0) {
    return {};
  }

  return {
    [HTTP_EXTENSION_HEADER]: extensions.join(','),
  };
}
