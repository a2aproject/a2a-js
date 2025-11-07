// Assuming types exist in a similar location
import { AgentCard, AgentExtension } from "../types.js";

export const HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

/**
 * Get the set of requested extensions from an input list.
 *
 * This handles the list containing potentially comma-separated values, as
 * occurs when using a list in an HTTP header.
 */
export function getRequestedExtensions(values: string): Set<string> {
    const extensions = new Set<string>();
    if (!values) {
        return extensions;
    }
    // Split by comma, trim whitespace, and filter out empty strings
    const parts = values.split(',').map(ext => ext.trim()).filter(ext => ext.length > 0);
    return new Set(parts);
}

/**
 * Find an AgentExtension in an AgentCard given a uri.
 */
export function findExtensionByUri(card: AgentCard, uri: string): AgentExtension | null {
    // Optional chaining (?.) safely handles if card.capabilities.extensions is null/undefined.
    // If it is missing, it returns undefined, falling back to an empty array [].
    const extensions = card.capabilities.extensions ?? [];
    return extensions.find(ext => ext.uri === uri) ?? null;
}