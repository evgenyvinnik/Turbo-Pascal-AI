import { Machine, MachineState } from '@compiler/runtime';
import type { Bytecode } from '@compiler/codegen';
import { PascalError, describePascalDiagnostic, formatPascalDiagnostic } from '@compiler/errors';
import { sourcePath } from '@compiler/project';
import { useCompilerStore } from '@stores/compilerStore';
import { useDesktopStore } from '@stores/desktopStore';
import { useDialogStore } from '@stores/dialogStore';
import { messageDialog } from '@components/Dialogs/dialogDefs';
import type { DialogDef } from '@components/Dialogs/types';
import { clientRect } from '@components/Window/paintWindow';
import {
  SourceDebugger,
  type DebugAction,
  type DebugValue,
} from '@compiler/runtime/SourceDebugger';
import { useDebugStore } from '@stores/debugStore';
import { bufferText } from '@stores/desktopStore';
import { useProgramScreenStore } from '@stores/programScreenStore';
import { decodeDosText } from '@compiler/encoding';
import { programDisk as disk, persistProgramFiles } from './programFiles';
export { virtualFiles, readVirtualFile, writeVirtualFile } from './programFiles';

interface Session {
  machine: Machine;
  file: string;
  bufferId: string;
  timer: ReturnType<typeof setTimeout> | null;
  debugger: SourceDebugger;
  source: string;
  sources: Record<string, string>;
}

let current: Session | null = null;
function persistDisk(): void {
  try {
    persistProgramFiles();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const compiler = useCompilerStore.getState();
    if (!compiler.messages.includes(message)) compiler.setMessages([...compiler.messages, message]);
  }
}
let audio: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gain: GainNode | null = null;

function prepareSound(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => undefined);
  } catch {
    /* Audio is optional when the browser does not offer an audio device. */
  }
}

function sound(frequency: number): void {
  if (!audio) return;
  if (frequency <= 0) {
    oscillator?.stop();
    oscillator = null;
    return;
  }
  if (!oscillator) {
    oscillator = audio.createOscillator();
    gain = audio.createGain();
    gain.gain.value = 0.04;
    oscillator.type = 'square';
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
  }
  oscillator.frequency.value = Math.min(20_000, Math.max(1, frequency));
}

function clearDebug(): void {
  const desktop = useDesktopStore.getState();
  useDesktopStore.setState({
    buffers: Object.fromEntries(
      Object.entries(desktop.buffers).map(([id, buffer]) => [
        id,
        buffer.highlight === null ? buffer : { ...buffer, highlight: null },
      ])
    ),
  });
  useDebugStore.getState().stopDebugging();
}

/** Re-evaluate watches and expose actual stack frames while execution is paused. */
export function refreshDebug(): void {
  const session = current;
  if (!session) return;
  const values: Record<string, DebugValue> = {};
  for (const watch of useDebugStore.getState().watches) {
    try {
      values[watch.expression] = session.debugger.evaluate(watch.expression);
    } catch (error) {
      values[watch.expression] = {
        value: error instanceof Error ? error.message : String(error),
        type: 'error',
      };
    }
  }
  useDebugStore.getState().updateSnapshot({
    status: session.debugger.isPaused() ? 'paused' : 'running',
    file: session.debugger.getFile() ?? session.file,
    line: session.debugger.getLine(),
    registers: session.machine.getRegisters(),
    values,
    frames: session.debugger.frames().map((frame) => ({
      id: String(frame.mp),
      name: frame.name,
      file: frame.file ?? session.file,
      line: frame.line,
      label: frame.arguments.length
        ? `${frame.name}(${frame.arguments.map((value) => (typeof value === 'string' ? `'${decodeDosText(value)}'` : String(value))).join(',')})`
        : frame.name,
      locals: new Map(Object.entries(frame.locals)),
    })),
  });
}

export function evaluateProgram(expression: string, replacement?: string): DebugValue {
  if (!current?.debugger.isPaused())
    throw new Error('Pause the program to inspect or modify values');
  const value =
    replacement === undefined
      ? current.debugger.evaluate(expression)
      : current.debugger.modify(expression, replacement);
  refreshDebug();
  return value;
}

export function resumeProgram(action: DebugAction, bufferId?: string, targetLine = 0): boolean {
  if (!current) return false;
  const targetBuffer = bufferId ? useDesktopStore.getState().buffers[bufferId] : undefined;
  if (
    targetBuffer &&
    bufferId !== current.bufferId &&
    current.sources[sourcePath(targetBuffer.path)] === undefined
  )
    return false;
  const buffer = useDesktopStore.getState().buffers[current.bufferId];
  if (!buffer || bufferText(buffer) !== current.source) {
    stopProgram(false);
    return false;
  }
  if (
    Object.values(useDesktopStore.getState().buffers).some((candidate) => {
      const original = current!.sources[sourcePath(candidate.path)];
      return original !== undefined && original !== bufferText(candidate);
    })
  ) {
    stopProgram(false);
    return false;
  }
  if (current.machine.getState() === MachineState.WAITING) {
    if (current.machine.getConsole().active || current.machine.getGraphics().initialized)
      useProgramScreenStore.setState({ visible: true });
    return true;
  }
  current.debugger.command(action, targetLine, targetBuffer?.path ?? current.file);
  if (action === 'run') useDesktopStore.getState().openTool('output');
  useCompilerStore.getState().setRuntime('running');
  useDebugStore.getState().resume();
  if (current.timer === null) schedule(current);
  return true;
}

function paused(session: Session): void {
  useProgramScreenStore.getState().hide();
  useCompilerStore.getState().setRuntime('paused');
  refreshDebug();
  const desktop = useDesktopStore.getState();
  focusSource(session, session.debugger.getFile() ?? session.file);
  const source = desktop.activeWindow();
  if (source) {
    desktop.focusWindow(source.id);
    desktop.gotoLine(session.debugger.getLine());
    desktop.setHighlight(session.debugger.getLine());
  }
}

function focusSource(session: Session, file: string): void {
  const desktop = useDesktopStore.getState();
  const buffer = Object.values(desktop.buffers).find(
    (candidate) => sourcePath(candidate.path) === sourcePath(file)
  );
  const window = desktop.windows.find((candidate) => candidate.bufferId === buffer?.id);
  if (window) desktop.focusWindow(window.id);
  else {
    const text = session.sources[sourcePath(file)];
    if (text !== undefined) desktop.openFile(file, file, text);
  }
}

/** Input stays in Turbo Vision controls, separate from the Pascal editor. */
function inputDialog(output: string[]): DialogDef {
  const prompt =
    [...output].reverse().find((line) => line.trim()) ??
    'Enter a line of input, or press Enter to continue.';
  return {
    id: 'program-input',
    title: 'Program input',
    rect: { x: 4, y: 6, w: 72, h: 10 },
    controls: [
      { kind: 'static', x: 3, y: 2, text: prompt.slice(0, 66) },
      {
        kind: 'input',
        id: 'line',
        x: 3,
        y: 4,
        w: 64,
        history: false,
        hint: 'Enter program input; Enter submits, Esc or Ctrl+F2 stops',
      },
      {
        kind: 'button',
        id: 'ok',
        x: 22,
        y: 7,
        w: 10,
        label: '~E~nter',
        result: 'ok',
        default: true,
        hint: 'Send this line to the running program',
      },
      {
        kind: 'button',
        id: 'cancel',
        x: 38,
        y: 7,
        w: 10,
        label: '~S~top',
        result: 'cancel',
        hint: 'Stop the running program',
      },
    ],
  };
}

function publish(session: Session, extra?: string): void {
  const lines = session.machine.getOutput();
  if (extra) lines.push(extra);
  useCompilerStore.getState().setProgramOutput(lines);
  const console = session.machine.getConsole();
  const graphics = session.machine.getGraphics();
  const screen = useProgramScreenStore.getState();
  const cursor = console.getCursor();
  const consoleChanged = screen.console?.revision !== console.revision;
  const graphicsChanged = screen.graphics?.revision !== graphics.revision;
  useProgramScreenStore.setState({
    ...(consoleChanged
      ? {
          console: {
            cols: console.cols,
            rows: console.rows,
            chars: [...console.chars],
            attributes: console.attributes.slice(),
            x: cursor.x,
            y: cursor.y,
            cursorVisible: console.cursorVisible,
            revision: console.revision,
            attribute: console.attribute,
          },
        }
      : {}),
    ...(graphicsChanged
      ? {
          graphics: {
            width: graphics.width,
            height: graphics.height,
            pixels: graphics.display(),
            revision: graphics.revision,
            ...(graphics.dac ? { colors: graphics.colors() ?? [] } : {}),
          },
        }
      : {}),
    ...((console.active && consoleChanged) || (graphics.initialized && graphicsChanged)
      ? { visible: true, kind: graphics.initialized ? 'graphics' : 'text' }
      : {}),
  });
  if (!graphics.initialized && screen.kind === 'graphics' && screen.visible)
    useProgramScreenStore.setState({ kind: 'text', visible: console.active });
  persistDisk();
  const desktop = useDesktopStore.getState();
  const output = desktop.windows.find((win) => win.kind === 'output');
  if (output) {
    const scroll = Math.max(0, lines.length - clientRect(output.rect).h);
    if (output.scroll !== scroll) desktop.scrollTool(output.id, scroll - output.scroll);
  }
}

/** Cancels the pending slice as well as the VM, so stale input cannot resume it. */
export function stopProgram(notify = true): void {
  const session = current;
  if (!session) return;
  current = null;
  if (session.timer !== null) clearTimeout(session.timer);
  session.machine.halt();
  useProgramScreenStore.setState({ visible: false, waiting: false, input: '' });
  clearDebug();
  if (useDialogStore.getState().top()?.def.id === 'program-input') {
    useDialogStore.getState().close('cancel');
  }
  publish(session, notify ? '[Program stopped]' : undefined);
  useProgramScreenStore.getState().hide();
  useCompilerStore.getState().setRuntime('stopped');
}

function fail(session: Session, error: unknown): void {
  current = null;
  session.machine.halt();
  useProgramScreenStore.setState({ visible: false, waiting: false, input: '' });
  clearDebug();
  const diagnostic = describePascalDiagnostic(error, 'runtime');
  const detail = diagnostic.detail;
  const line = error instanceof PascalError ? error.lineNumber : session.machine.getSourceLine();
  const file = diagnostic.sourceFile ?? session.machine.getSourceFile() ?? session.file;
  const text = `${formatPascalDiagnostic(diagnostic)}${line > 0 ? ` at line ${String(line)}` : ''}`;
  publish(session, text);
  useProgramScreenStore.getState().hide();
  const compiler = useCompilerStore.getState();
  compiler.setRuntime('error', text);
  compiler.setMessages([
    ...compiler.messages,
    `${file}(${String(line)}): ${text}`,
    ...(detail === diagnostic.message ? [] : [`  ${detail}`]),
  ]);
  const desktop = useDesktopStore.getState();
  focusSource(session, file);
  const source = desktop.activeWindow();
  if (source && line > 0) {
    desktop.focusWindow(source.id);
    desktop.setError(line, text);
    desktop.openTool('output');
  }
  useDialogStore
    .getState()
    .open(
      messageDialog('Runtime error', [
        (line > 0 ? `${file}, line ${String(line)}` : file).slice(0, 34),
        ...(diagnostic.code === undefined ? [] : [`Run-time error ${String(diagnostic.code)}`]),
        ...(detail.match(/.{1,34}/g) ?? [detail]).slice(0, 10),
      ])
    );
}

/** Run the program's next slice after `delay`, in place of any pending. */
function schedule(session: Session, delay = 0): void {
  if (session.timer !== null) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    session.timer = null;
    if (current !== session) return;
    try {
      // Yield between slices so menus, repainting and Ctrl+F2 remain responsive.
      session.debugger.runSlice(5_000);
      publish(session);
      const state = session.machine.getState();
      if (session.debugger.isPaused()) {
        paused(session);
      } else if (state === MachineState.WAITING) {
        useCompilerStore.getState().setRuntime('waiting');
        if (session.machine.getConsole().active || session.machine.getGraphics().initialized) {
          // What the user has typed so far survives a timer interrupt's turn.
          const typed = useProgramScreenStore.getState().waiting ? {} : { input: '' };
          useProgramScreenStore.setState({
            visible: true,
            waiting: true,
            ...typed,
            kind: session.machine.getGraphics().initialized ? 'graphics' : 'text',
          });
          // The program's timer interrupt procedure runs while it waits.
          const tick = session.machine.nextTimerTick();
          if (tick !== undefined) schedule(session, Math.max(1, tick - Date.now()));
          return;
        }
        useDialogStore
          .getState()
          .open(inputDialog(session.machine.getOutput()), {}, (result, values) => {
            if (current !== session) return;
            if (result !== 'ok') {
              stopProgram();
              return;
            }
            try {
              session.machine.provideInput(String(values.line ?? ''), true);
              session.debugger.continueAfterInput();
              useCompilerStore.getState().setRuntime('running');
              schedule(session);
            } catch (error) {
              fail(session, error);
            }
          });
      } else if (state === MachineState.STOPPED) {
        current = null;
        clearDebug();
        const compiler = useCompilerStore.getState();
        compiler.setRuntime('completed');
        compiler.setMessages([...compiler.messages, `${session.file}: Program finished`]);
        useProgramScreenStore.setState({ waiting: false, input: '' });
      } else if (state === MachineState.SLEEPING) {
        // Until Delay ends, or the timer interrupt comes first.
        const wake = Math.min(
          session.machine.getWakeTime(),
          session.machine.nextTimerTick() ?? Infinity
        );
        schedule(session, Math.max(1, wake - Date.now()));
      } else {
        schedule(session);
      }
    } catch (error) {
      fail(session, error);
    }
  }, delay);
}

/** Handles a DOS user screen without letting keystrokes edit Pascal source. */
function programKey(event: KeyboardEvent): string | null {
  if (event.metaKey) return null;
  const scans: Record<string, number> = {
    Home: 71,
    ArrowUp: 72,
    PageUp: 73,
    ArrowLeft: 75,
    ArrowRight: 77,
    End: 79,
    ArrowDown: 80,
    PageDown: 81,
    Insert: 82,
    Delete: 83,
  };
  const functionKey = /^F(\d+)$/.exec(event.key);
  if (functionKey) {
    const number = Number(functionKey[1]);
    if (number < 1 || number > 12) return null;
    const first =
      number <= 10
        ? event.altKey
          ? 104
          : event.ctrlKey
            ? 94
            : event.shiftKey
              ? 84
              : 59
        : event.altKey
          ? 139
          : event.ctrlKey
            ? 137
            : event.shiftKey
              ? 135
              : 133;
    return `\0${String.fromCharCode(first + number - (number <= 10 ? 1 : 11))}`;
  }
  const scan = scans[event.key];
  if (scan !== undefined) return `\0${String.fromCharCode(scan)}`;
  if (event.altKey) return null;
  const controls: Record<string, string> = {
    Enter: '\r',
    Escape: '\x1b',
    Backspace: '\b',
    Tab: '\t',
  };
  if (controls[event.key]) return controls[event.key] ?? null;
  if (event.ctrlKey)
    return /^[a-z]$/i.test(event.key)
      ? String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64)
      : null;
  return event.key.length === 1 ? event.key : null;
}

export function handleProgramScreenKey(event: KeyboardEvent): boolean {
  const screen = useProgramScreenStore.getState();
  if (!screen.visible) return false;
  if (event.altKey && event.key === 'F5') {
    screen.hide();
    return true;
  }
  const session = current;
  if (!session) {
    if (event.key === 'Escape') screen.hide();
    return true;
  }
  if (!screen.waiting || session.machine.getInputMode() === 'key') {
    const key = programKey(event);
    if (key !== null) {
      try {
        session.machine.provideKey(key);
        if (screen.waiting) {
          session.debugger.continueAfterInput();
          useProgramScreenStore.setState({ waiting: false, input: '' });
          useCompilerStore.getState().setRuntime('running');
          schedule(session);
        }
      } catch (error) {
        fail(session, error);
      }
    }
    return true;
  }
  if (event.key === 'Escape') {
    screen.hide();
    return true;
  }
  if (event.key === 'Enter') {
    try {
      session.machine.provideInput(screen.input, true);
      session.debugger.continueAfterInput();
      useProgramScreenStore.setState({ waiting: false, input: '' });
      useCompilerStore.getState().setRuntime('running');
      schedule(session);
    } catch (error) {
      fail(session, error);
    }
  } else if (event.key === 'Backspace')
    useProgramScreenStore.setState({ input: screen.input.slice(0, -1) });
  else if (event.key.length === 1 && !event.ctrlKey && !event.altKey)
    useProgramScreenStore.setState({ input: screen.input + event.key });
  return true;
}

export function toggleProgramScreen(): void {
  const screen = useProgramScreenStore.getState();
  if (screen.console || screen.graphics)
    useProgramScreenStore.setState({ visible: !screen.visible });
  else useDesktopStore.getState().toggleTool('output');
}

export function startProgram(
  bytecode: Bytecode,
  file: string,
  bufferId: string,
  action: DebugAction = 'run',
  targetLine = 0
): void {
  stopProgram(false);
  prepareSound();
  useProgramScreenStore.setState({
    visible: false,
    console: null,
    graphics: null,
    waiting: false,
    input: '',
    kind: 'text',
  });
  const machine = new Machine(bytecode, {
    maxInstructions: 5_000_000,
    fileSystem: disk,
    onSound: sound,
  });
  machine.reset();
  const source = useDesktopStore.getState().buffers[bufferId];
  const debuggerSession = new SourceDebugger(machine, bytecode);
  debuggerSession.setBreakpoints(() => [...useDebugStore.getState().breakpoints.values()]);
  debuggerSession.command(action, targetLine, file);
  const sources = Object.fromEntries(
    Object.entries(bytecode.sources).map(([name, text]) => [sourcePath(name), text])
  );
  const session: Session = {
    machine,
    file,
    bufferId,
    timer: null,
    debugger: debuggerSession,
    source: source ? bufferText(source) : '',
    sources,
  };
  current = session;
  useCompilerStore.getState().setProgramOutput([]);
  useCompilerStore.getState().setRuntime('running');
  if (action === 'run') useDesktopStore.getState().openTool('output');
  schedule(session);
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopProgram(false);
  });
