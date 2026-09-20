import { db, type WorkspaceRecord } from './database';

export type { WorkspaceRecord } from './database';

export const DEFAULT_WORKSPACE_ID = 'active';

export interface SaveWorkspaceOptions {
  id?: string;
  writerId?: string;
  /** Revision observed while loading/saving; zero expects no existing row. */
  expectedRevision?: number;
  /** Explicitly retain the conflicting row before replacing it with this save. */
  preserveConflict?: boolean;
}

export type WorkspaceSaveResult = WorkspaceRecord & { recoveryId?: string };

export class WorkspaceConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super('This workspace changed in another tab. Retry to keep this tab and preserve the other workspace.');
    this.name = 'WorkspaceConflictError';
  }
}

// Every operation for a workspace observes earlier writes from this tab. A
// failed operation rejects its caller without poisoning subsequent saves.
const pendingOperations = new Map<string, Promise<void>>();

function enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingOperations.get(id) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  pendingOperations.set(id, settled);
  void settled.then(() => {
    if (pendingOperations.get(id) === settled) pendingOperations.delete(id);
  });
  return result;
}

/** Copy a JSON-safe snapshot now, before a queued IndexedDB write can run. */
function snapshot(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') {
    throw new TypeError('Workspace data must contain only JSON-safe values.');
  }
  if (ancestors.has(value)) throw new TypeError('Workspace data cannot contain cycles.');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Workspace data must contain only plain objects and arrays.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, item => snapshot(item, ancestors));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function rejectFuturePayload(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return;
  const prototype: unknown = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) return;
  if ('version' in payload && typeof payload.version === 'number' && payload.version > 1) {
    throw new Error('The stored workspace has an unsupported payload version.');
  }
}

export function loadWorkspace(id = DEFAULT_WORKSPACE_ID): Promise<WorkspaceRecord | undefined> {
  return enqueue(id, () => db.workspaces.get(id));
}

/**
 * Save one complete workspace atomically. The state layer owns payload
 * validation and may select a separate ID for each browser tab. IndexedDB
 * failures are propagated; the last committed workspace is never cleared.
 */
export async function saveWorkspace(
  payload: unknown,
  options: SaveWorkspaceOptions = {},
): Promise<WorkspaceSaveResult> {
  const id = options.id ?? DEFAULT_WORKSPACE_ID;
  const copiedPayload = snapshot(payload);
  const writerId = options.writerId;
  const expectedRevision = options.expectedRevision;
  const preserveConflict = options.preserveConflict === true;
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    throw new TypeError('The expected workspace revision must be a nonnegative safe integer.');
  }
  return enqueue(id, () => db.transaction('rw', db.workspaces, async () => {
    const previous = await db.workspaces.get(id);
    if (previous && (previous.schemaVersion !== 1 || !Number.isSafeInteger(previous.revision) || previous.revision < 1)) {
      throw new Error('The stored workspace has an unsupported record format.');
    }
    rejectFuturePayload(previous?.payload);
    const actualRevision = previous?.revision ?? 0;
    let recoveryId: string | undefined;
    if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
      if (!preserveConflict) throw new WorkspaceConflictError(expectedRevision, actualRevision);
      if (previous) {
        recoveryId = `recovery:${crypto.randomUUID()}`;
        await db.workspaces.add({ ...previous, id: recoveryId });
      }
    }
    const revision = (previous?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Workspace revision limit reached.');
    const record: WorkspaceRecord = {
      id,
      schemaVersion: 1,
      payload: copiedPayload,
      updatedAt: Date.now(),
      revision,
      ...(writerId === undefined ? {} : { writerId }),
    };
    await db.workspaces.put(record);
    return recoveryId === undefined ? record : { ...record, recoveryId };
  }));
}

export function deleteWorkspace(id = DEFAULT_WORKSPACE_ID): Promise<void> {
  return enqueue(id, () => db.workspaces.delete(id));
}

/**
 * Preserve an unreadable workspace before the state layer starts a fresh one.
 * All stored fields are copied without interpreting the payload. Copying and
 * removal share one transaction, so a failure leaves the original untouched.
 */
export async function archiveWorkspace(
  id = DEFAULT_WORKSPACE_ID,
  expectedRevision?: number,
): Promise<string | undefined> {
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    throw new TypeError('The expected workspace revision must be a nonnegative safe integer.');
  }
  return enqueue(id, () => db.transaction('rw', db.workspaces, async () => {
    const original = await db.workspaces.get(id);
    const actualRevision = original?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
      throw new WorkspaceConflictError(expectedRevision, actualRevision);
    }
    if (original === undefined) return undefined;
    const recoveryId = `recovery:${crypto.randomUUID()}`;
    await db.workspaces.add({ ...original, id: recoveryId });
    await db.workspaces.delete(id);
    return recoveryId;
  }));
}
