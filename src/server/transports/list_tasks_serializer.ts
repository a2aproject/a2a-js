/**
 * Wire serialization for `ListTasks`, which needs field-presence rules that
 * differ from the default ProtoJSON encoding used everywhere else.
 */

import { ListTasksResponse } from '../../types/pb/a2a.js';

/** Options controlling {@link serializeListTasksResponse}. */
export interface SerializeListTasksResponseOptions {
  /**
   * The `includeArtifacts` value from the originating `ListTasksRequest`.
   */
  includeArtifacts?: boolean;
}

/**
 * Serializes a `ListTasksResponse` for the JSON-RPC and REST bindings.
 */
export function serializeListTasksResponse(
  response: ListTasksResponse,
  options?: SerializeListTasksResponseOptions
): Record<string, unknown> {
  const serialized = ListTasksResponse.toJSON(response) as Record<string, unknown>;
  // Destructured so the four fields are re-inserted in proto field order
  // instead of inheriting the position they happened to get from the encoder,
  // which keeps the emitted key order stable across pages.
  const { tasks, nextPageToken, pageSize, totalSize, ...rest } = serialized;
  const serializedTasks = (tasks as unknown[]) ?? [];

  return {
    tasks: options?.includeArtifacts
      ? serializedTasks.map(withMaterializedArtifacts)
      : serializedTasks,
    nextPageToken: nextPageToken ?? '',
    pageSize: pageSize ?? 0,
    totalSize: totalSize ?? 0,
    ...rest,
  };
}

/**
 * Restores an `artifacts: []` that ProtoJSON elided.
 *
 * Only called when the request asked for artifacts, where §3.1.4 says the
 * field "should be included with its actual content (which may be an empty
 * array if the task has no artifacts)". When artifacts were not requested
 * the field stays absent, as that same section requires.
 */
function withMaterializedArtifacts(task: unknown): unknown {
  if (typeof task !== 'object' || task === null) {
    return task;
  }
  const serializedTask = task as Record<string, unknown>;
  if (serializedTask.artifacts !== undefined) {
    return serializedTask;
  }
  return { ...serializedTask, artifacts: [] };
}
