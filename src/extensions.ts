/**
 * A2A Protocol Extension URI.
 */
export type ExtensionId = string;

/**
 * A collection of {@link ExtensionId}.
 */
export type ExtensionIds = ExtensionId[];

export const ExtensionIds = {
  /**
   * Creates new {@link ExtensionIds} from `current` and `additional`.
   * If `current` already contains `additional` it is returned unmodified.
   */
  createFrom: (current: ExtensionIds | undefined, additional: ExtensionId): ExtensionIds => {
    if (!current || !current.includes(additional)) {
      return [...(current ?? []), additional];
    } else {
      return current;
    }
  },

  /**
   * Creates {@link ExtensionIds} from comma separated extensions identifiers as per
   * https://a2a-protocol.org/latest/specification/#326-service-parameters.
   * Parses the output of `toServiceParameter`.
   */
  parseServiceParameter: (value: string | undefined): ExtensionIds => {
    if (!value) {
      return [];
    }
    const unique = new Set(
      value
        .split(',')
        .map((ext) => ext.trim())
        .filter((ext) => ext.length > 0)
    );
    return Array.from(unique);
  },

  /**
   * Converts {@link ExtensionIds} to comma separated extensions identifiers as per
   * https://a2a-protocol.org/latest/specification/#326-service-parameters.
   */
  toServiceParameter: (value: ExtensionIds): string => {
    return value.join(',');
  },
};
