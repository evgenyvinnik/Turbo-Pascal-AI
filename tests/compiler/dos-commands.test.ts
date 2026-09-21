import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandInterface } from 'emulators';
import { DOS_EXIT_SIGNAL, dosKeyCode, dosShell, startDosRuntime, typeDosCommand } from '../../src/services/dos/dosRuntime';
import { nativePascalBatch } from '../../src/services/dos/nativePascal';

afterEach(() => { vi.useRealTimers(); });

describe('DOS startup shell', () => {
  // Each line matters: without CALL a batch never returns, and EXIT in the
  // first shell tears DOS down so the drive can no longer be saved.
  it('runs the user in a child shell and signals each EXIT back to the IDE', () => {
    expect(dosShell().split('\n')).toEqual([':shell', 'command', `echo ${DOS_EXIT_SIGNAL}`, 'goto shell', '']);
  });

  it('runs a startup command first and returns from it to the shell', () => {
    expect(dosShell('D:\\NATIVE.BAT').split('\n').slice(0, 3)).toEqual(['call D:\\NATIVE.BAT', ':shell', 'command']);
  });

  it('refuses tool commands that would add their own AUTOEXEC lines', async () => {
    await expect(startDosRuntime({}, 'dir\r\ndel *.*')).rejects.toThrow(/single line/);
    await expect(startDosRuntime({}, 'dir\0')).rejects.toThrow(/single line/);
  });
});

describe('DOS keyboard', () => {
  it('maps browser keys to the GLFW codes js-dos expects', () => {
    const codes = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F12', 'Numpad0', 'Numpad9', 'NumpadEnter', 'Enter', 'Escape', 'Backspace', 'ArrowUp', 'ShiftLeft'];
    expect(codes.map(dosKeyCode)).toEqual([65, 90, 48, 57, 290, 301, 320, 329, 335, 257, 256, 259, 265, 340]);
  });

  it('ignores keys DOS has no code for', () => {
    expect(['F13', 'IntlBackslash', 'MediaPlayPause'].map(dosKeyCode)).toEqual([null, null, null]);
  });

  it('types commands through the keyboard, holding Shift only for shifted characters', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const ci = { sendKeyEvent: (code: number, pressed: boolean) => { events.push(`${pressed ? '+' : '-'}${String(code)}`); } } as unknown as CommandInterface;
    const typing = typeDosCommand(ci, 'Dir C:');
    await vi.runAllTimersAsync();
    await typing;
    expect(events.join(' ')).toBe([
      '+340 +68 -68 -340', '+73 -73', '+82 -82', '+32 -32', // D (shifted), i, r, space
      '+340 +67 -67 -340', '+340 +59 -59 -340', '+257 -257', // C and : (shifted ;), Enter
    ].join(' '));
  });
});

describe('native Pascal build batch', () => {
  const lines = (...args: Parameters<typeof nativePascalBatch>) => nativePascalBatch(...args).split('\r\n');

  it('never runs a stale executable after a failed compile', () => {
    const batch = lines('HELLO.PAS', true);
    const at = (line: string) => batch.indexOf(line);
    expect(at('if errorlevel 1 goto failed')).toBeGreaterThan(at('D:\\PPC386.EXE @D:\\NATIVE.CFG "D:\\SOURCE\\HELLO.PAS"'));
    expect(at('echo HELLO.EXE>D:\\BUILD.OK')).toBeGreaterThan(at('if errorlevel 1 goto failed'));
    expect(at('"HELLO.EXE"')).toBeGreaterThan(at('echo HELLO.EXE>D:\\BUILD.OK'));
    expect(at(':failed')).toBeGreaterThan(at('goto end'));
    expect(batch.slice(at(':failed'))).toEqual([':failed', 'echo Compilation failed. The program was not run.', ':end', '']);
  });

  it('compiles units without marking them runnable or running them', () => {
    const batch = lines('MATHS.PAS', false, '', true);
    expect(batch).toContain('echo Compilation completed.');
    expect(batch.join('\n')).not.toMatch(/BUILD\.OK|MATHS\.EXE/);
  });

  it('passes program parameters and resolves sources in subdirectories', () => {
    const batch = lines('src/demo.pas', true, 'one two');
    expect(batch).toContain('D:\\PPC386.EXE @D:\\NATIVE.CFG "D:\\SOURCE\\SRC\\DEMO.PAS"');
    expect(batch).toContain('"DEMO.EXE" one two');
  });

  it('uses DOS line endings throughout', () => {
    expect(nativePascalBatch('HELLO.PAS', true)).not.toMatch(/[^\r]\n/);
  });

  it('rejects sources DOS cannot compile', () => {
    expect(() => nativePascalBatch('NOTES.TXT', true)).toThrow(/\.PAS or \.PP/);
    expect(() => nativePascalBatch('TOOLONGNAME.PAS', true)).toThrow(/8\.3/);
  });
});
