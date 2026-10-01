import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { encodeOverlayFile, decodeOverlayFile } from '../../src/compiler/runtime/OverlayFile';

const UNITS: Record<string, string> = {
  ovl: `{$O+} unit Ovl; interface procedure Hello; implementation
    procedure Hello; begin WriteLn('hello from the overlay') end; end.`,
  other: `{$O+} unit Other; interface procedure Bye; implementation
    procedure Bye; begin WriteLn('bye') end; end.`,
  resident: `unit Resident; interface procedure Stay; implementation
    procedure Stay; begin WriteLn('stay') end; end.`,
  starter: `unit Starter; interface implementation uses Overlay;
    begin OvrInit('T.OVR'); WriteLn('OvrInit ', OvrResult) end.`,
  greeter: `{$O+} unit Greeter; interface implementation begin WriteLn('greeter starts') end.`,
};
const compile = (source: string, destination?: 'memory' | 'disk') =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse(), {
    resolveUnit: (name) => UNITS[name.toLowerCase()],
    ...(destination ? { destination } : {}),
  });
const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

/** Compiles to disk, writing the .OVR file, as the IDE does, then runs. */
function run(source: string, ovr: 'own' | 'none' | Uint8Array = 'own') {
  const bytecode = compile(source, 'disk');
  const file = ovr === 'own' ? encodeOverlayFile(bytecode.overlays) : ovr;
  const disk = new VirtualFileSystem(file === 'none' ? {} : { 'T.OVR': text(file) });
  const machine = new Machine(bytecode, { fileSystem: disk, maxInstructions: 1_000_000 });
  let error: string | undefined;
  try {
    machine.run();
  } catch (caught) {
    error = (caught as Error).message;
  }
  return { output: machine.getOutput(), exitCode: machine.getExitCode(), error, bytecode };
}

describe('Overlay files', () => {
  it('hold each overlaid unit and its code, and read back as written', () => {
    const { bytecode } = run(`program T; uses Overlay, Ovl, Resident; {$O Ovl} begin end.`);
    expect(bytecode.overlays.map((unit) => unit.name)).toEqual(['OVL']);
    expect(bytecode.overlays[0]?.code.length).toBeGreaterThan(0);
    const file = encodeOverlayFile(bytecode.overlays);
    expect(text(file.subarray(0, 4))).toBe('FBOV');
    expect(decodeOverlayFile(file)).toEqual(bytecode.overlays);
    expect(decodeOverlayFile(file.subarray(0, file.length - 1))).toBe(undefined);
  });

  it('run an overlaid unit once OvrInit opens the file, and stop with 208 before', () => {
    const source = `program T; uses Overlay, Ovl, Resident; {$O Ovl}
      begin Stay; OvrInit('T.OVR'); WriteLn('OvrInit ', OvrResult); Hello end.`;
    expect(run(source).output).toEqual(['stay', 'OvrInit 0', 'hello from the overlay']);
    expect(run(source, 'none')).toMatchObject({
      output: ['stay', 'OvrInit -2'],
      exitCode: 208,
      error: 'Overlay manager not installed',
    });
    // Another program's overlays are not these: ovrError.
    const other = compile(`program O; uses Overlay, Other; {$O Other} begin end.`, 'disk');
    expect(run(source, encodeOverlayFile(other.overlays))).toMatchObject({
      output: ['stay', 'OvrInit -1'],
      exitCode: 208,
    });
  });

  it('read an overlay from the file when it is not in the buffer, with 209 if the file is gone', () => {
    expect(
      run(`program T; uses Overlay, Ovl; {$O Ovl} var f: file;
        begin OvrInit('T.OVR'); Hello; Assign(f, 'T.OVR'); Erase(f); Hello; OvrClearBuf; Hello end.`)
    ).toMatchObject({
      output: ['hello from the overlay', 'hello from the overlay'],
      exitCode: 209,
      error: 'Overlay file read error',
    });
  });

  it("follow Turbo Pascal's rules for the buffer, the probation area and EMS", () => {
    expect(
      run(`program T; uses Overlay, Ovl; {$O Ovl} var p: Pointer; size: LongInt;
        begin OvrInitEMS; Write(OvrResult, ' '); OvrSetBuf(100000); Write(OvrResult, ' ');
          OvrInit('T.OVR'); size := OvrGetBuf; Write(size > 0, ' ');
          OvrSetBuf(size - 1); Write(OvrResult, ' '); OvrSetBuf(size + 1000); Write(OvrResult, ' ', OvrGetBuf = size + 1000, ' ');
          OvrInitEMS; Write(OvrResult, ' '); OvrSetRetry(64); WriteLn(OvrResult, ' ', OvrGetRetry);
          GetMem(p, 16); OvrSetBuf(size + 2000); Write(OvrResult, ' '); OvrClearBuf; WriteLn(OvrResult) end.`)
        .output
    ).toEqual(['-1 -1 TRUE -1 0 TRUE -5 0 64', '-1 0']);
  });

  it("start an overlaid unit's initialization only once the overlay manager is in", () => {
    expect(
      run(`program T; uses Overlay, Greeter; {$O Greeter} begin WriteLn('main') end.`)
    ).toMatchObject({
      output: [],
      exitCode: 208,
    });
    // As Turbo Pascal advises: a resident unit, used first, calls OvrInit.
    expect(
      run(`program T; uses Overlay, Starter, Greeter; {$O Greeter} begin WriteLn('main') end.`)
        .output
    ).toEqual(['OvrInit 0', 'greeter starts', 'main']);
  });

  it('refuse to overlay a unit not compiled {$O+}, or to compile overlays to memory', () => {
    expect(() => compile(`program T; uses Overlay, Resident; {$O Resident} begin end.`)).toThrow(
      'Cannot overlay this unit'
    );
    expect(() => compile(`program T; uses Overlay, Crt; {$O Crt} begin end.`)).toThrow(
      'Cannot overlay this unit'
    );
    expect(() => compile(`program T; uses Overlay, Ovl; {$O Ovl} begin end.`, 'memory')).toThrow(
      'Cannot compile overlays to memory'
    );
    // Dos may be overlaid, and has no code here to move.
    expect(compile(`program T; uses Overlay, Dos; {$O Dos} begin end.`, 'disk').overlays).toEqual(
      []
    );
  });
});
