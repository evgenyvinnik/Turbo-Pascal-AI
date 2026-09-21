import { db, type SessionRecord } from './database';

export interface SessionInput {
  name: string;
  openFiles: string[];
  activeFile: string | null;
  paneLayout: 'single' | 'split-horizontal' | 'split-vertical';
  cursorPositions: Record<string, { line: number; column: number }>;
}

/**
 * Save a new session or update an existing one
 */
export async function saveSession(
  session: SessionInput,
  id?: number
): Promise<SessionRecord> {
  const now = Date.now();

  if (id !== undefined) {
    // Update existing session
    const existing = await db.sessions.get(id);
    if (existing) {
      const updatedSession: SessionRecord = {
        ...existing,
        ...session,
        updatedAt: now,
      };
      await db.sessions.put(updatedSession);
      return updatedSession;
    }
  }

  // Create new session
  const newSession: SessionRecord = {
    ...session,
    createdAt: now,
    updatedAt: now,
  };

  const newId = await db.sessions.add(newSession);
  return {
    ...newSession,
    id: newId,
  };
}

/**
 * Load a session by ID
 */
export async function loadSession(
  id: number
): Promise<SessionRecord | undefined> {
  return db.sessions.get(id);
}

/**
 * Get recent sessions ordered by last update time
 */
export async function getRecentSessions(
  limit: number = 10
): Promise<SessionRecord[]> {
  return db.sessions
    .orderBy('updatedAt')
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Delete a session by ID
 */
export async function deleteSession(id: number): Promise<void> {
  await db.sessions.delete(id);
}

/**
 * Get all sessions
 */
export async function getAllSessions(): Promise<SessionRecord[]> {
  return db.sessions.toArray();
}

/**
 * Get session count
 */
export async function getSessionCount(): Promise<number> {
  return db.sessions.count();
}

/**
 * Find sessions by name (case-insensitive partial match)
 */
export async function findSessionsByName(
  pattern: string
): Promise<SessionRecord[]> {
  const lowerPattern = pattern.toLowerCase();
  return db.sessions
    .filter((session) => session.name.toLowerCase().includes(lowerPattern))
    .toArray();
}

/**
 * Get the most recent session (for auto-restore)
 */
export async function getMostRecentSession(): Promise<SessionRecord | undefined> {
  const sessions = await db.sessions
    .orderBy('updatedAt')
    .reverse()
    .limit(1)
    .toArray();

  return sessions[0];
}

/**
 * Duplicate a session
 */
export async function duplicateSession(
  id: number,
  newName?: string
): Promise<SessionRecord | undefined> {
  const original = await db.sessions.get(id);
  if (!original) {
    return undefined;
  }

  const now = Date.now();
  const duplicated: SessionRecord = {
    name: newName ?? `${original.name} (Copy)`,
    openFiles: [...original.openFiles],
    activeFile: original.activeFile,
    paneLayout: original.paneLayout,
    cursorPositions: { ...original.cursorPositions },
    createdAt: now,
    updatedAt: now,
  };

  const newId = await db.sessions.add(duplicated);
  return {
    ...duplicated,
    id: newId,
  };
}

/**
 * Update session timestamp (mark as accessed)
 */
export async function touchSession(id: number): Promise<void> {
  const session = await db.sessions.get(id);
  if (session) {
    await db.sessions.update(id, {
      updatedAt: Date.now(),
    });
  }
}

/**
 * Delete old sessions, keeping only the most recent ones
 */
export async function pruneOldSessions(keepCount: number = 20): Promise<number> {
  const allSessions = await db.sessions
    .orderBy('updatedAt')
    .reverse()
    .toArray();

  if (allSessions.length <= keepCount) {
    return 0;
  }

  const sessionsToDelete = allSessions.slice(keepCount);
  const idsToDelete = sessionsToDelete
    .map((s) => s.id)
    .filter((id): id is number => id !== undefined);

  await db.sessions.bulkDelete(idsToDelete);
  return idsToDelete.length;
}

/**
 * Check if a session name already exists
 */
export async function sessionNameExists(name: string): Promise<boolean> {
  const session = await db.sessions
    .where('name')
    .equals(name)
    .first();
  return !!session;
}

/**
 * Generate a unique session name
 */
export async function generateUniqueSessionName(
  baseName: string = 'Session'
): Promise<string> {
  let counter = 1;
  let name = baseName;

  while (await sessionNameExists(name)) {
    name = `${baseName} ${String(counter)}`;
    counter++;
  }

  return name;
}
