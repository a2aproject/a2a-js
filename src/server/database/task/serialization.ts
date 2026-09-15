import { Task, taskStateToJSON } from '../../../types/pb/a2a.js';
import { requireKey } from '../../utils.js';
import type { TaskRow } from './schema.js';

export interface TaskScope {
  readonly tenant: string;
  readonly owner: string;
}

/** Format of the payload columns. Written, never read. */
const PAYLOAD_FORMAT = '1.0';

const SUBJECT = 'task';

/**
 * Sortable form of the status timestamp. An absent or unparseable one sorts
 * oldest.
 */
export function statusLastUpdated(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** proto3 JSON omits empty values, and the column holds null for those. */
function encode(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decode(value: string | null): unknown {
  return value ? JSON.parse(value) : undefined;
}

export function toTaskRow(scope: TaskScope, task: Task): TaskRow {
  requireKey(SUBJECT, 'tenant', scope.tenant);
  requireKey(SUBJECT, 'owner', scope.owner);
  requireKey(SUBJECT, 'id', task.id);

  const payload = Task.toJSON(task) as Record<string, unknown>;

  return {
    tenant: scope.tenant,
    owner: scope.owner,
    id: task.id,
    context_id: task.contextId || '',
    status_last_updated: statusLastUpdated(task.status?.timestamp),
    status_state: task.status ? taskStateToJSON(task.status.state) : null,
    status: encode(payload.status),
    artifacts: encode(payload.artifacts),
    history: encode(payload.history),
    metadata: encode(payload.metadata),
    protocol_version: PAYLOAD_FORMAT,
  };
}

// A null payload, which the schema permits, reads as an empty one.
export function fromTaskRow(row: TaskRow): Task {
  try {
    return Task.fromJSON({
      id: row.id,
      contextId: row.context_id,
      status: decode(row.status),
      artifacts: decode(row.artifacts),
      history: decode(row.history),
      metadata: decode(row.metadata),
    });
  } catch (cause) {
    throw new Error(`task "${row.id}" is not readable`, { cause });
  }
}
