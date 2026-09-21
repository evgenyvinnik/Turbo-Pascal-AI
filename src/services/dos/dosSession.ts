import { create } from 'zustand';
import type { CommandInterface } from 'emulators';
import { zipSync } from 'fflate';
import { bufferText, useDesktopStore } from '../../stores/desktopStore';
import { encodeDosText, decodeDosText } from '../../compiler/encoding';
import { applyProgramFileChanges, programDisk } from '../../components/IDE/programFiles';
import { bytesToString, dosPath, importDosArchive, reconcileDosFiles, stringToBytes, type DosFiles } from './dosFiles';
import { readDosFiles, startDosRuntime, typeDosCommand } from './dosRuntime';

interface DosState {
  visible: boolean;
  status: 'closed' | 'loading' | 'running' | 'saving' | 'error';
  error: string | null;
  transcript: string;
  width: number;
  height: number;
  frame: Uint8ClampedArray | null;
  /** The frame's own size. A mode change resizes the screen before the next
   * frame arrives, so painting must not use the screen size of a later mode. */
  frameWidth: number;
  frameHeight: number;
  nativePascal: boolean;
}
export const useDosStore = create<DosState>(() => ({ visible: false, status: 'closed', error: null, transcript: '', width: 640, height: 400, frame: null, frameWidth: 0, frameHeight: 0, nativePascal: false }));
let machine: CommandInterface | null = null;
let initial: DosFiles = {};
let diskAtLaunch: DosFiles = {};
let editorAtLaunch = new Map<string, string>();
let closing = false;
let exited = false;
let stdoutTail = '';
let pendingFiles: DosFiles | null = null;
let serial: Promise<unknown> = Promise.resolve();
let generation = 0;

/** EXIT typed at a drive prompt but not yet submitted, as DOSBox echoes it. */
const EXIT_PENDING = /[A-Za-z]:\\[^\r\n>]*>\s*exit[ \t]*$/i;
/** The same line already submitted, which leaves DOS unreachable. */
const EXIT_SUBMITTED = /[A-Za-z]:\\[^\r\n>]*>\s*exit[ \t]*\r?\n/i;

/** Whether Enter would submit EXIT. DOSBox keeps its first shell alive but
 * tears the DOS layer down, so an executed EXIT can no longer read the drive.
 * The key handler closes the session itself instead of forwarding that Enter. */
export const dosExitIsPending = (): boolean => EXIT_PENDING.test(stdoutTail);

export const getDosMachine = (): CommandInterface | null => machine;
const detail = (error: unknown) => error instanceof Error ? error.message : String(error);
const fail = (error: unknown): void => { useDosStore.setState({ status: 'error', error: detail(error) }); };
function queued<T>(operation: () => Promise<T>): Promise<T> {
  const next = serial.then(operation);
  serial = next.catch(() => undefined);
  return next;
}

export async function openDosSession(options: { command?: string; files?: DosFiles; nativePascal?: boolean; toolFiles?: DosFiles } = {}): Promise<void> {
  if (useDosStore.getState().visible) {
    if (options.command && machine) await sendDosCommand(options.command);
    return;
  }
  useDosStore.setState({ visible: true, status: 'loading', error: null, transcript: '', frame: null, frameWidth: 0, frameHeight: 0, nativePascal: options.nativePascal ?? false });
  closing = false;
  exited = false;
  stdoutTail = '';
  const launch = ++generation;
  pendingFiles = null;
  diskAtLaunch = programDisk.snapshot();
  initial = { ...diskAtLaunch, ...options.files };
  editorAtLaunch = new Map();
  for (const buffer of Object.values(useDesktopStore.getState().buffers)) {
    editorAtLaunch.set(buffer.id, bufferText(buffer));
    initial[dosPath(buffer.path)] = encodeDosText(bufferText(buffer)).replace(/(?<!\r)\n/g, '\r\n');
  }
  try {
    const ci = await startDosRuntime(initial, options.command, options.nativePascal, options.toolFiles);
    if (launch !== generation || !useDosStore.getState().visible) { await ci.exit(); return; }
    machine = ci;
    ci.events().onFrameSize((width, height) => { useDosStore.setState({ width, height }); });
    ci.events().onFrame((rgb, rgba) => {
      const source = rgba ?? rgb;
      if (!source) return;
      const width = ci.width(), height = ci.height();
      const pixels = new Uint8ClampedArray(width * height * 4);
      // A frame produced just before a mode change can be longer or shorter
      // than the current mode needs. Copy what fits rather than throwing.
      if (rgba) pixels.set(rgba.subarray(0, pixels.length));
      else for (let i = 0, j = 0; i < source.length && j < pixels.length; i += 3, j += 4) { pixels[j] = source[i]!; pixels[j + 1] = source[i + 1]!; pixels[j + 2] = source[i + 2]!; pixels[j + 3] = 255; }
      useDosStore.setState({ width, height, frame: pixels, frameWidth: width, frameHeight: height });
    });
    ci.events().onStdout((text) => {
      useDosStore.setState((state) => ({ transcript: (state.transcript + text + '\n').slice(-32768) }));
      // DOSBox keeps its first shell alive, so EXIT at the prompt raises no
      // event and leaves the workspace stranded. The echoed prompt line is the
      // only signal that the user asked to leave. Keystrokes arrive split
      // across chunks, so match a raw tail rather than one chunk: the
      // transcript itself separates chunks and would break the line apart.
      stdoutTail = (stdoutTail + text).slice(-256);
      // Should an EXIT reach the shell anyway, the drive can no longer be read,
      // so leave the workspace rather than hanging on a save that cannot finish.
      if (EXIT_SUBMITTED.test(stdoutTail)) { stdoutTail = ''; void abandonDosSession(); }
    });
    // Should the emulator end on its own, reconcile files and return to the
    // IDE. EXIT at the prompt raises neither event (see dosExitIsPending); these
    // cover any other ending. onUnload runs while the drive is still readable,
    // and whichever arrives first wins.
    const endedByDos = async (): Promise<void> => {
      if (closing || exited) return;
      exited = true;
      try {
        await syncDosFiles();
        machine = null;
        useDosStore.setState({ visible: false, status: 'closed' });
      } catch (error) { machine = null; fail(error); }
    };
    ci.events().onUnload(endedByDos);
    ci.events().onExit(() => { void endedByDos(); });
    useDosStore.setState({ status: 'running', width: ci.width(), height: ci.height() });
    // The command interface becomes ready before the first video frame. A
    // missing initial screenshot is normal; onFrame supplies it shortly.
    try {
      const screenshot = await ci.screenshot();
      useDosStore.setState({ frame: new Uint8ClampedArray(screenshot.data), width: screenshot.width, height: screenshot.height, frameWidth: screenshot.width, frameHeight: screenshot.height });
    } catch { /* Wait for the first frame. */ }
  } catch (error) { fail(error); }
}

function commitDosFiles(result: DosFiles): number {
  pendingFiles = result;
  const current = programDisk.snapshot();
  const diskChanges = reconcileDosFiles(initial, initial, result);
  // Editor buffers were mirrored without being saved. Check browser disk changes
  // against the real launch disk, then commit only files DOS actually changed.
  for (const name of diskChanges.keys()) {
    if (current[name] !== diskAtLaunch[name] && current[name] !== result[name]) throw new Error(`${name} changed in both DOS and the browser. Export DOS files to keep both versions.`);
  }
  const desktop = useDesktopStore.getState();
  for (const buffer of Object.values(desktop.buffers)) {
    if (diskChanges.has(dosPath(buffer.path)) && editorAtLaunch.get(buffer.id) !== bufferText(buffer)) throw new Error(`${buffer.name} has unsaved browser edits. Export DOS files to keep both versions.`);
  }
  applyProgramFileChanges(diskChanges);
  if (diskChanges.size) {
    const buffers = { ...desktop.buffers };
    for (const buffer of Object.values(buffers)) {
      const changed = diskChanges.get(dosPath(buffer.path));
      if (changed === undefined) continue;
      if (changed === null) { buffers[buffer.id] = { ...buffer, modified: true }; continue; }
      const text = decodeDosText(changed).replaceAll('\r\n', '\n');
      buffers[buffer.id] = { ...buffer, lines: text.split('\n'), modified: false, cursor: { line: 0, col: 0 }, scroll: { line: 0, col: 0 }, anchor: null, error: null, highlight: null, undo: [...buffer.undo, { lines: buffer.lines, cursor: buffer.cursor }], redo: [] };
      editorAtLaunch.set(buffer.id, text);
    }
    useDesktopStore.setState({ buffers });
  }
  initial = { ...result };
  diskAtLaunch = programDisk.snapshot();
  pendingFiles = null;
  return diskChanges.size;
}

export function syncDosFiles(): Promise<number> {
  return queued(async () => {
    if (!machine && !pendingFiles) return 0;
    useDosStore.setState({ status: 'saving', error: null });
    try {
      const result = machine ? await readDosFiles(machine) : pendingFiles!;
      const count = commitDosFiles(result);
      useDosStore.setState({ status: machine ? 'running' : 'closed' });
      return count;
    } catch (error) { fail(error); throw error; }
  });
}

export async function closeDosSession(): Promise<void> {
  try {
    await syncDosFiles();
    closing = true;
    generation++;
    await machine?.exit();
    machine = null;
    useDosStore.setState({ visible: false, status: 'closed', error: null });
  } catch (error) { fail(error); }
}

/** Leave a session whose DOS layer has gone, without reading the drive. The
 * workspace closes first: the emulator may never answer another request. */
export async function abandonDosSession(): Promise<void> {
  if (closing) return;
  closing = true;
  generation++;
  const dying = machine;
  machine = null;
  useDosStore.setState({ visible: false, status: 'closed', error: null });
  try { await dying?.exit(); } catch { /* DOS is already gone. */ }
}

export function sendDosCommand(command: string): Promise<void> {
  return queued(async () => { if (machine) await typeDosCommand(machine, command); });
}

/** Explicit recovery when a user chooses to abandon unmergeable DOS edits. */
export async function discardDosSession(): Promise<void> {
  closing = true;
  generation++;
  pendingFiles = null;
  try { await machine?.exit(); }
  finally { machine = null; useDosStore.setState({ visible: false, status: 'closed', error: null }); }
}

export function openDosDebugger(): Promise<void> {
  return queued(async () => {
    if (!machine) return;
    let command = 'debug';
    if (useDosStore.getState().nativePascal) {
      let target: string;
      try { target = bytesToString(await machine.fsReadFile('__TPTOOLS/BUILD.OK')).trim(); }
      catch { throw new Error('Run a successfully compiled Pascal program before opening its CPU debugger.'); }
      command = `debugx ${target}`;
    }
    await typeDosCommand(machine, command);
  });
}

export async function exportDosFiles(): Promise<Uint8Array> {
  return queued(async () => {
    const files = machine ? await readDosFiles(machine) : pendingFiles ?? initial;
    return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, stringToBytes(content)])));
  });
}

export async function importFilesToDos(files: readonly File[]): Promise<void> {
  return queued(async () => {
    if (!machine) throw new Error('Open the DOS workspace before importing files.');
    const additions: DosFiles = {};
    for (const file of files) {
      if (file.size > programDisk.capacity) throw new Error('Selected file exceeds the 8 MiB drive capacity.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = /\.(zip|jsdos)$/i.test(file.name) ? importDosArchive(bytes) : { [dosPath(file.webkitRelativePath || file.name)]: bytesToString(bytes) };
      for (const [name, content] of Object.entries(entries)) {
        if (additions[name] !== undefined && additions[name] !== content) throw new Error(`Duplicate file: ${name}`);
        additions[name] = content;
      }
    }
    const current = await readDosFiles(machine);
    for (const [name, content] of Object.entries(additions)) if (current[name] !== undefined && current[name] !== content) throw new Error(`${name} already exists. Rename the imported file to keep both copies.`);
    reconcileDosFiles(current, current, { ...current, ...additions });
    for (const [name, content] of Object.entries(additions)) await machine.fsWriteFile(`USER/${name}`, stringToBytes(content));
    await typeDosCommand(machine, 'rescan');
  });
}
