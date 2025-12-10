/**
 * A2A Protocol Extension URI.
 */
export type ExtensionURI = string;

/**
 * A collection of {@link ExtensionURI}.
 */
export type Extensions = ExtensionURI[];

export const Extensions = {
  /**
   * Creates new {@link Extensions} from `current` and `additional`.
   * If `current` already contains `additional` it is returned unmodified.
   */
  createFrom: (current: Extensions | undefined, additional: ExtensionURI): Extensions => {
    if (current?.includes(additional)) {
      return current;
    }
    return [...(current ?? []), additional];
  },

  /**
   * Creates {@link Extensions} from comma separated extensions identifiers as per
   * https://a2a-protocol.org/latest/specification/#326-service-parameters.
   * Parses the output of `toServiceParameter`.
   */
  parseServiceParameter: (value: string | undefined): Extensions => {
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
   * Converts {@link Extensions} to comma separated extensions identifiers as per
   * https://a2a-protocol.org/latest/specification/#326-service-parameters.
   */
  toServiceParameter: (value: Extensions): string => {
    return value.join(',');
  },
};
