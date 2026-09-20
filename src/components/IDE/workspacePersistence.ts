import { useDesktopStore } from '@stores/desktopStore';
import { useIdeStore } from '@stores/ideStore';
import { useDebugStore } from '@stores/debugStore';
import { usePopupStore } from '@stores/popupStore';
import { useCompilerStore } from '@stores/compilerStore';
import { useWorkspaceStore } from '@stores/workspaceStore';
import { archiveWorkspace, loadWorkspace, saveWorkspace, WorkspaceConflictError } from '@services/db/workspaceRepository';
import { decodeWorkspace, UnsupportedWorkspaceVersionError, type WorkspaceSnapshot } from '@services/db/workspaceSnapshot';
import { stopProgram } from './runtimeSession';

const ideKeys = [
  'helpTopic', 'search', 'destination', 'primaryFile', 'optionsFile', 'directory',
  'compilerOptions', 'optionDialogs', 'tools', 'programParameters', 'defines',
] as const;
const bufferKeys = [
  'id', 'name', 'path', 'lines', 'cursor', 'scroll', 'anchor',
  'modified', 'insert', 'undo', 'redo',
] as const;

function captureWorkspace(): WorkspaceSnapshot {
  const desktop = useDesktopStore.getState();
  const ide = useIdeStore.getState();
  const debug = useDebugStore.getState();
  const compiler = useCompilerStore.getState();
  return {
    version: 1,
    desktop: {
      buffers: Object.fromEntries(Object.entries(desktop.buffers).map(([id, buffer]) => {
        const { error: _error, highlight: _highlight, ...durable } = buffer;
        return [id, durable];
      })),
      windows: desktop.windows,
      activeId: desktop.activeId,
      clipboard: desktop.clipboard,
      seq: desktop.seq,
      untitled: desktop.untitled,
    },
    ide: {
      helpTopic: ide.helpTopic, search: ide.search, destination: ide.destination,
      primaryFile: ide.primaryFile, optionsFile: ide.optionsFile, directory: ide.directory,
      compilerOptions: ide.compilerOptions, optionDialogs: ide.optionDialogs,
      tools: ide.tools, programParameters: ide.programParameters, defines: ide.defines,
    },
    debug: {
      breakpoints: [...debug.breakpoints.values()].map((point) => ({
        id: point.id, file: point.file, line: point.line, enabled: point.enabled,
        ...(point.condition === undefined ? {} : { condition: point.condition }),
        ...(point.passCount === undefined ? {} : { passCount: point.passCount }),
      })),
      watches: debug.watches.map(({ id, expression }) => ({ id, expression })),
    },
    histories: usePopupStore.getState().histories,
    output: { programOutput: compiler.programOutput, messages: compiler.messages },
  };
}

function applyWorkspace(snapshot: WorkspaceSnapshot): void {
  useDesktopStore.setState({
    ...snapshot.desktop,
    buffers: Object.fromEntries(Object.entries(snapshot.desktop.buffers).map(([id, buffer]) =>
      [id, { ...buffer, error: null, highlight: null }])),
  });
  useIdeStore.setState({ ...snapshot.ide, lastCompile: null });
  usePopupStore.setState({ histories: snapshot.histories, popup: null });
  useDebugStore.setState({
    breakpoints: new Map(snapshot.debug.breakpoints.map((point) => [point.id, point])),
    watches: snapshot.debug.watches.map((watch) => ({ ...watch, value: undefined, type: 'unknown' })),
    status: 'stopped', machine: null, currentLine: null, currentFile: null, callStack: [],
    registers: { pc: 0, sp: 0, mp: 0, np: 0, ep: 0 },
  });
  useCompilerStore.setState({
    ...snapshot.output, status: 'idle', result: null, currentFile: null,
    outputLines: [], runtimeStatus: 'idle', runtimeError: null,
  });
}

let initialization: Promise<void> | undefined;
let dirty = false;
let writing = false;
let scheduled = false;
let disposed = false;
let revision = 0;
let preserveConflict = false;
let writingDone: Promise<void> = Promise.resolve();
interface WorkspaceHandoff {
  snapshot: WorkspaceSnapshot;
  settledRevision: Promise<number>;
}
const hotData = import.meta.hot?.data as { workspace?: WorkspaceHandoff } | undefined;
const hotHandoff = hotData?.workspace;
const unsubscribers: (() => void)[] = [];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
// These flags can change in another store callback while an IDB write awaits.
const isDisposed = () => disposed;
const hasPendingSave = () => dirty;

async function flushWorkspace(): Promise<void> {
  if (disposed || writing || !dirty || !useWorkspaceStore.getState().ready) return;
  writing = true;
  dirty = false;
  const resolveConflict = preserveConflict;
  preserveConflict = false;
  useWorkspaceStore.setState({ status: 'saving', error: null, conflict: false });
  let succeeded = false;
  try {
    // The repository detaches the snapshot before awaiting its transaction.
    const record = await saveWorkspace(captureWorkspace(), { expectedRevision: revision, preserveConflict: resolveConflict });
    revision = record.revision;
    succeeded = true;
    if (!isDisposed()) useWorkspaceStore.setState({
      status: hasPendingSave() ? 'saving' : 'saved', lastSavedAt: record.updatedAt, error: null,
      ...(record.recoveryId ? { notice: 'This tab is saved; the other workspace is kept as a recovery copy.' } : {}),
    });
  } catch (error) {
    dirty = true;
    if (!isDisposed()) useWorkspaceStore.setState({
      status: 'error', error: errorMessage(error), conflict: error instanceof WorkspaceConflictError,
    });
  } finally {
    writing = false;
    // A failed write waits for another edit or an explicit retry, avoiding a
    // busy failure loop. A successful write immediately drains newer changes.
    if (succeeded && dirty) scheduleWorkspaceSave();
  }
}

function scheduleWorkspaceSave(): void {
  if (disposed || !useWorkspaceStore.getState().ready) return;
  dirty = true;
  if (useWorkspaceStore.getState().conflict && !preserveConflict) return;
  useWorkspaceStore.setState({ status: 'saving', error: null });
  if (scheduled || writing) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    writingDone = flushWorkspace();
  });
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty || writing) {
    event.preventDefault();
    // Legacy browsers require this in addition to preventDefault.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    event.returnValue = '';
  }
}

function subscribeToWorkspace(): void {
  unsubscribers.push(useDesktopStore.subscribe((next, previous) => {
    const changed = next.windows !== previous.windows || next.activeId !== previous.activeId ||
      next.clipboard !== previous.clipboard || next.seq !== previous.seq || next.untitled !== previous.untitled ||
      (next.buffers !== previous.buffers && (
        Object.keys(next.buffers).length !== Object.keys(previous.buffers).length ||
        Object.entries(next.buffers).some(([id, buffer]) => {
          const prior = previous.buffers[id];
          return !prior || bufferKeys.some((key) => buffer[key] !== prior[key]);
        })
      ));
    if (changed) scheduleWorkspaceSave();
  }));
  unsubscribers.push(useIdeStore.subscribe((next, previous) => {
    if (ideKeys.some((key) => next[key] !== previous[key])) scheduleWorkspaceSave();
  }));
  unsubscribers.push(useDebugStore.subscribe((next, previous) => {
    if (next.breakpoints !== previous.breakpoints || next.watches.length !== previous.watches.length ||
      next.watches.some((watch, index) => {
        const prior = previous.watches[index];
        return !prior || watch.id !== prior.id || watch.expression !== prior.expression;
      })) scheduleWorkspaceSave();
  }));
  unsubscribers.push(usePopupStore.subscribe((next, previous) => {
    if (next.histories !== previous.histories) scheduleWorkspaceSave();
  }));
  unsubscribers.push(useCompilerStore.subscribe((next, previous) => {
    if (next.programOutput !== previous.programOutput || next.messages !== previous.messages) scheduleWorkspaceSave();
  }));
  window.addEventListener('beforeunload', beforeUnload);
}

async function restoreWorkspace(): Promise<void> {
  useWorkspaceStore.setState({ ready: false, status: 'loading', error: null, conflict: false });
  try {
    if (hotHandoff) {
      // A preview code update can land between edits and a pending save. Carry
      // the latest live text across it, then observe the preceding write's
      // actual revision before committing the carried snapshot.
      const snapshot = decodeWorkspace(hotHandoff.snapshot);
      revision = await hotHandoff.settledRevision;
      if (isDisposed()) return;
      applyWorkspace(snapshot);
      subscribeToWorkspace();
      useWorkspaceStore.setState({ ready: true });
      scheduleWorkspaceSave();
      return;
    }
    const record = await loadWorkspace();
    if (isDisposed()) return;
    let restored = false;
    if (record) {
      if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1) {
        throw new Error('The saved workspace uses an unsupported record format.');
      }
      let snapshot: WorkspaceSnapshot | undefined;
      try {
        snapshot = decodeWorkspace(record.payload);
      } catch (error) {
        if (error instanceof UnsupportedWorkspaceVersionError) throw error;
        // Keep damaged data recoverable; a failed archive leaves it untouched.
        await archiveWorkspace('active', record.revision);
        useWorkspaceStore.setState({ notice: 'Started a fresh workspace; a recovery copy is kept in IndexedDB.' });
      }
      if (snapshot) {
        applyWorkspace(snapshot);
        revision = record.revision;
        restored = true;
      }
    }
    if (isDisposed()) return;
    if (!restored) useDesktopStore.getState().newFile();
    subscribeToWorkspace();
    useWorkspaceStore.setState({ ready: true, status: 'saved', lastSavedAt: restored ? record?.updatedAt ?? null : null });
    if (!restored) scheduleWorkspaceSave();
  } catch (error) {
    // Keep the editor gated after a failed read, so a retry cannot overwrite
    // either an unreadable saved workspace or newly entered local edits.
    if (!disposed) useWorkspaceStore.setState({ status: 'error', error: errorMessage(error) });
  }
}

/** Shared promise makes React StrictMode's repeated effects hydrate only once. */
export function initializeWorkspace(): Promise<void> {
  initialization ??= restoreWorkspace().finally(() => {
    if (!useWorkspaceStore.getState().ready) initialization = undefined;
  });
  return initialization;
}

export function retryWorkspace(): void {
  if (useWorkspaceStore.getState().ready) {
    preserveConflict = useWorkspaceStore.getState().conflict;
    scheduleWorkspaceSave();
  }
  else void initializeWorkspace();
}

export function dismissWorkspaceNotice(): void {
  useWorkspaceStore.setState({ notice: null });
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true;
  for (const unsubscribe of unsubscribers) unsubscribe();
  window.removeEventListener('beforeunload', beforeUnload);
  if (useWorkspaceStore.getState().ready && hotData) {
    stopProgram(false);
    hotData.workspace = {
      snapshot: captureWorkspace(),
      settledRevision: writingDone.then(() => revision),
    } satisfies WorkspaceHandoff;
  }
});
