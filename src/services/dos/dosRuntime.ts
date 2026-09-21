import type { CommandInterface, Emulators, InitFsEntry } from 'emulators';
import { bytesToString, dosPath, stringToBytes, type DosFiles } from './dosFiles';

const assetRoot = `${import.meta.env.BASE_URL}dos/`;
let loading: Promise<Emulators> | null = null;

export function loadDosEmulator(): Promise<Emulators> {
  if (loading) return loading;
  loading = new Promise<Emulators>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${assetRoot}emulators/emulators.js`;
    script.onload = () => {
      const emulators = (globalThis as typeof globalThis & { emulators?: Emulators }).emulators;
      if (!emulators) { reject(new Error('DOS emulator failed to initialize.')); return; }
      emulators.pathPrefix = `${assetRoot}emulators/`;
      resolve(emulators);
    };
    script.onerror = () => { script.remove(); reject(new Error('Could not load the local DOS emulator.')); };
    document.head.append(script);
  }).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}

export const DOS_STARTUP = `
[sdl]
autolock=false
[dosbox]
memsize=64
[cpu]
core=normal
cputype=386
cycles=max
[mixer]
nosound=true
[render]
aspect=false
[autoexec]
@echo off
mount c USER
mount d __TPTOOLS
c:
path D:\\;Z:\\
cls
echo DOS workspace. Type EXIT to return to the IDE.
echo DEBUG provides registers, disassembly, memory and assembly.
`;

/** A line the startup batch prints each time the user leaves the shell. */
export const DOS_EXIT_SIGNAL = '__TURBO_PASCAL_DOS_EXIT__';

/** The end of AUTOEXEC: an optional tool command, then the interactive shell.
 * EXIT in DOSBox's first shell tears DOS down, after which the drive can no
 * longer be read. The user works in a child shell instead, so EXIT returns
 * here with DOS still running, and the signal line tells the IDE to leave. */
export function dosShell(command = ''): string {
  return [...(command ? [`call ${command}`] : []), ':shell', 'command', `echo ${DOS_EXIT_SIGNAL}`, 'goto shell', ''].join('\n');
}

export async function startDosRuntime(files: DosFiles, command = '', nativePascal = false, toolFiles: DosFiles = {}): Promise<CommandInterface> {
  if (/[\r\n\0]/.test(command)) throw new Error('DOS tool command must be a single line.');
  const emulators = await loadDosEmulator();
  const debugResponse = await fetch(`${assetRoot}tools/DEBUG.COM`);
  if (!debugResponse.ok) throw new Error('Could not load the bundled DOS DEBUG tool.');
  const init: InitFsEntry[] = [
    { path: '__TPTOOLS/DEBUG.COM', contents: new Uint8Array(await debugResponse.arrayBuffer()) },
    { path: 'USER/.TPKEEP', contents: new Uint8Array() },
  ];
  if (nativePascal) {
    const native = await fetch(`${assetRoot}tools/fpc-3.2.2-dos.zip`);
    if (!native.ok) throw new Error('Could not load the local native Pascal compiler.');
    init.push(new Uint8Array(await native.arrayBuffer()));
  }
  init.push(
    ...Object.entries(toolFiles).map(([path, contents]) => ({ path: `__TPTOOLS/${dosPath(path)}`, contents: stringToBytes(contents) })),
    ...Object.entries(files).map(([path, contents]) => ({ path: `USER/${dosPath(path)}`, contents: stringToBytes(contents) })),
    { dosboxConf: (nativePascal ? DOS_STARTUP.replace('cputype=386', 'cputype=pentium').replace('cycles=max', 'cycles=fixed 25000') : DOS_STARTUP) + dosShell(command), jsdosConf: { version: emulators.version } },
  );
  return nativePascal ? emulators.dosboxXWorker(init) : emulators.dosboxWorker(init);
}

export async function readDosFiles(ci: CommandInterface): Promise<DosFiles> {
  const tree = await ci.fsTree();
  const result: DosFiles = {};
  const visit = async (nodes: typeof tree.nodes, prefix: string): Promise<void> => {
    for (const node of nodes ?? []) {
      const path = `${prefix}${node.name}`.replace(/^\/+/, '');
      if (path.toUpperCase() === 'USER/.TPKEEP') continue;
      if (node.nodes) await visit(node.nodes, `${path}/`);
      else result[dosPath(path.replace(/^USER\//i, ''))] = bytesToString(await ci.fsReadFile(path));
    }
  };
  const user = tree.nodes?.find((node) => node.name.toUpperCase() === 'USER');
  if (!user) throw new Error('The DOS user drive could not be read.');
  await visit(user.nodes, 'USER/');
  return result;
}

const specialKeys: Record<string, number> = {
  Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260, Delete: 261,
  ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
  PageUp: 266, PageDown: 267, Home: 268, End: 269, CapsLock: 280,
  ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
  ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343,
  ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347,
  Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
  Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96,
};
export function dosKeyCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return 289 + Number(code.slice(1));
  if (/^Numpad[0-9]$/.test(code)) return 320 + Number(code.slice(6));
  if (code === 'NumpadEnter') return 335;
  return specialKeys[code] ?? null;
}

/** Keystrokes go through DOSBox's keyboard controller, including its line editor. */
export async function typeDosCommand(ci: CommandInterface, command: string): Promise<void> {
  const shifted = '~!@#$%^&*()_+{}|:"<>?';
  const plain = '`1234567890-=[]\\;\',./';
  for (const character of `${command}\n`) {
    const index = shifted.indexOf(character);
    const shift = index >= 0 || /[A-Z]/.test(character);
    const base = index >= 0 ? plain[index]! : character;
    const key = character === '\n' ? 257 : base.toUpperCase().charCodeAt(0);
    if (shift) ci.sendKeyEvent(340, true);
    ci.sendKeyEvent(key, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    ci.sendKeyEvent(key, false);
    if (shift) ci.sendKeyEvent(340, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
