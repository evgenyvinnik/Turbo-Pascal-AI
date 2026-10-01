import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { parseBgiDriver } from '../../src/compiler/runtime/BgiDriver';

const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

/** A .BGI file in Borland's layout, named `name`, with `code` bytes of code;
 * written here from the format, not taken from any driver. */
function driverFile(name: string, code = 16): Uint8Array {
  const bytes = new Uint8Array(0xa0 + code);
  const intro = `pk\x08\x08BGI Device Driver (${name}) test\r\n\x00\x1a`;
  bytes.set(Array.from(intro, (char) => char.charCodeAt(0)));
  const fields = [0xa0, 0, 0, 0, code & 0xff, code >> 8, 2, 0, 1, 0];
  bytes.set(fields, intro.length);
  bytes.set(fields, 0x80);
  bytes.set([name.length, ...Array.from(name, (char) => char.charCodeAt(0))], 0x8a);
  return bytes;
}

/** A .CHR font of one triangle glyph, A, with its header's name and size. */
function fontFile(name: string): Uint8Array {
  const bytes = new Uint8Array(0x80 + 29);
  const intro = 'PK\x08\x08BGI Stroked Font V1.1 test\r\n\x00\x1a';
  bytes.set(Array.from(intro, (char) => char.charCodeAt(0)));
  const marker = intro.length - 1;
  bytes.set(
    [0x80, 0, ...Array.from(name, (char) => char.charCodeAt(0)), 29, 0, 1, 1, 1, 0],
    marker + 1
  );
  bytes.set([43, 1, 0, 0, 65, 19, 0, 0, 7, 0, 0], 0x80);
  bytes.set([0, 0, 8], 0x80 + 16);
  bytes.set([128, 0, 131, 135, 134, 128, 128, 128, 0], 0x80 + 19);
  return bytes;
}

function run(source: string, files: Record<string, Uint8Array> = {}) {
  const disk = new VirtualFileSystem(
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, text(bytes)]))
  );
  const machine = new Machine(
    new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse()),
    { fileSystem: disk, maxInstructions: 1_000_000 }
  );
  machine.run();
  return machine.getOutput();
}

describe('BGI driver files', () => {
  it("read a driver's name, version and code size from its header", () => {
    expect(parseBgiDriver(driverFile('EGAVGA', 300))).toMatchObject({
      name: 'EGAVGA',
      version: 2,
      minVersion: 1,
      headerSize: 0xa0,
      codeSize: 300,
    });
    expect(parseBgiDriver(Uint8Array.from('not a driver', (char) => char.charCodeAt(0)))).toBe(
      undefined
    );
    const broken = driverFile('EGAVGA');
    broken[0x8a] = 0;
    expect(parseBgiDriver(broken)).toBe(undefined);
  });

  it('describe the driver and its modes', () => {
    expect(
      run(`program T; uses Graph; var d, m, lo, hi: Integer;
      begin d := VGA; m := VGAHi; InitGraph(d, m, ''); GetModeRange(VGA, lo, hi);
        WriteLn(GetDriverName, ' ', GetMaxMode, ' ', GetModeName(GetGraphMode), ' ', lo, '..', hi);
        GetModeRange(CGA, lo, hi); Write(lo, '..', hi, ' '); GetModeRange(99, lo, hi); WriteLn(lo, '..', hi);
        CloseGraph end.`)
    ).toEqual(['EGAVGA 2 640 x 480 VGA 0..2', '0..4 -1..-1']);
  });

  it("load EGAVGA.BGI from InitGraph's path, or the current directory, and refuse a broken one", () => {
    const init = (path: string) => `program T; uses Graph; var d, m: Integer;
      begin d := Detect; InitGraph(d, m, '${path}'); WriteLn(GraphResult, ' ', d, ' ', m) end.`;
    expect(run(init('C:\\TP\\BGI\\'), { 'C:/TP/BGI/EGAVGA.BGI': driverFile('EGAVGA') })).toEqual([
      '0 9 2',
    ]);
    expect(run(init(''), { 'EGAVGA.BGI': driverFile('EGAVGA') })).toEqual(['0 9 2']);
    expect(run(init(''), { 'EGAVGA.BGI': Uint8Array.of(1, 2, 3) })).toEqual(['-4 0 0']);
    // A file of another driver's under the name is no EGAVGA.
    expect(run(init(''), { 'EGAVGA.BGI': driverFile('HERC') })).toEqual(['-4 0 0']);
    // With no file, the emulated VGA's driver is as if linked in.
    expect(run(init(''))).toEqual(['0 9 2']);
  });

  it('install user drivers, which only their files can supply', () => {
    const source = `program T; uses Graph; var d, m: Integer;
      begin d := InstallUserDriver('SVGA256', nil); Write(d, ' ', InstallUserDriver('svga256.bgi', nil), ' ');
        Write(InstallUserDriver('EGAVGA', nil), ' '); m := 0; InitGraph(d, m, ''); WriteLn(GraphResult) end.`;
    expect(run(source)).toEqual(['11 11 3 -3']);
    // Its file is found and its code run; this one's is no driver's.
    expect(run(source, { 'SVGA256.BGI': driverFile('SVGA256') })).toEqual(['11 11 3 -4']);
  });

  // EGAVGA's number is the first it serves, EGA's, as InstallUserDriver gives.
  it('register a driver a program read into memory, as one linked in', () => {
    const source = `program T; uses Graph; var f: file; p: Pointer; size: Word; d, m: Integer;
      begin Assign(f, 'EGAVGA.BGI'); Reset(f, 1); size := FileSize(f); GetMem(p, size); BlockRead(f, p^, size); Close(f);
        Write(RegisterBGIdriver(p), ' '); Erase(f);
        d := VGA; m := VGALo; InitGraph(d, m, ''); Write(GraphResult, ' ', GetMaxY, ' ');
        WriteLn(RegisterBGIdriver(nil), ' ', GraphResult) end.`;
    expect(run(source, { 'EGAVGA.BGI': driverFile('EGAVGA', 64) })).toEqual(['3 0 199 -4 -4']);
    expect(run(source, { 'EGAVGA.BGI': driverFile('MYDRV', 64) })).toEqual(['-4 0 199 -4 -4']);
  });
});

describe('BGI fonts', () => {
  it('install a user font, which SetTextStyle loads from its .CHR file', () => {
    const source = `program T; uses Graph; var d, m, f: Integer;
      begin d := Detect; InitGraph(d, m, ''); f := InstallUserFont('MINE.CHR');
        Write(f, ' ', InstallUserFont('trip'), ' '); SetTextStyle(f, HorizDir, 4);
        Write(GraphResult, ' ', TextWidth('A'), ' '); SetTextStyle(f + 1, HorizDir, 4); WriteLn(GraphResult) end.`;
    expect(run(source, { 'MINE.CHR': fontFile('MINE') })).toEqual(['11 1 0 8 -14']);
    expect(run(source)).toEqual(['11 1 -8 8 -14']);
  });

  it('register a font a program read into memory, with no file needed after', () => {
    const source = `program T; uses Graph; var f: file; p: Pointer; size: Word; d, m: Integer;
      begin Assign(f, 'TRIP.CHR'); Reset(f, 1); size := FileSize(f); GetMem(p, size); BlockRead(f, p^, size); Close(f);
        Erase(f); Write(RegisterBGIfont(p), ' '); d := Detect; InitGraph(d, m, '');
        SetTextStyle(TriplexFont, HorizDir, 4); WriteLn(GraphResult, ' ', TextWidth('AA')) end.`;
    expect(run(source, { 'TRIP.CHR': fontFile('TRIP') })).toEqual(['1 0 16']);
    // A file of another font's is refused; TriplexFont is then its Hershey stand-in.
    expect(run(source, { 'TRIP.CHR': fontFile('NONE') })).toEqual(['-14 0 60']);
  });
});
