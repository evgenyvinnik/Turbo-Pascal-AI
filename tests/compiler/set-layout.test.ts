import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';

function execute(source: string, disk = new VirtualFileSystem()) {
  const bytecode = new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
  const machine = new Machine(bytecode, { fileSystem: disk, maxInstructions: 10000 });
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Turbo Pascal set storage layout', () => {
  it('sizes only the ordinal bytes spanned by each set and its enclosing structures', () => {
    expect(
      execute(`program SetSizes;
      type Band=set of 50..60; OneByte=set of 8..15; Crossing=set of 7..8;
        Letters=set of 'A'..'Z'; Full=set of Byte;
        PackedData=record marker:Byte;bands:array[1..2]of Band;tail:Word end;
      begin WriteLn(SizeOf(Band),',',SizeOf(OneByte),',',SizeOf(Crossing),',',
        SizeOf(Letters),',',SizeOf(Full),',',SizeOf(PackedData)) end.`)
    ).toEqual(['2,1,2,4,32,7']);
  });

  it('writes exact nonzero-base set bytes in typed records and reads them through both file types', () => {
    const disk = new VirtualFileSystem();
    expect(
      execute(
        `program TypedSets;
      type Band=set of 50..60; Letters=set of 'A'..'J';
        Data=record marker:Byte;numbers:Band;chars:Letters;tail:Word end;
      var f:file of Data;raw:file;x,y:Data;bytes:array[1..7]of Byte;n:Word;
      begin x.marker:=170;x.numbers:=[50,55,56,60];x.chars:=['A','G','H','J'];x.tail:=4660;
        Assign(f,'sets.dat');Rewrite(f);Write(f,x);Close(f);
        Reset(f);Read(f,y);WriteLn(FileSize(f),',',y.marker,',',y.numbers=x.numbers,',',
          y.chars=x.chars,',',y.tail);Close(f);
        Assign(raw,'sets.dat');Reset(raw,1);BlockRead(raw,bytes,7,n);Close(raw);
        WriteLn(n,',',bytes[1],',',bytes[2],',',bytes[3],',',bytes[4],',',bytes[5],',',bytes[6],',',bytes[7])
      end.`,
        disk
      )
    ).toEqual(['1,170,TRUE,TRUE,4660', '7,170,132,17,130,5,52,18']);
    expect(Array.from(disk.read('sets.dat'), (char) => char.charCodeAt(0))).toEqual([
      0xaa, 0x84, 0x11, 0x82, 0x05, 0x34, 0x12,
    ]);
  });

  it('decodes imported bytes into set arrays and preserves them through untyped and typed files', () => {
    const expected = [0x04, 0x10, 0x80, 0x01, 0x84, 0x07];
    const disk = new VirtualFileSystem({ 'input.bin': String.fromCharCode(...expected) });
    expect(
      execute(
        `program BinarySets;
      type Band=set of 50..60; HighBits=set of 250..255;
        Data=record bands:array[1..2]of Band;edge:HighBits;marker:Byte end;
      var raw:file;typed:file of Data;x,y:Data;n:Word;
      begin Assign(raw,'input.bin');Reset(raw,1);BlockRead(raw,x,SizeOf(x),n);Close(raw);
        WriteLn(n,',',x.bands[1]=[50,60],',',x.bands[2]=[55,56],',',x.edge=[250,255],',',x.marker);
        Assign(raw,'output.bin');Rewrite(raw,1);BlockWrite(raw,x,SizeOf(x),n);Close(raw);
        Assign(typed,'output.bin');Reset(typed);Read(typed,y);
        WriteLn(FileSize(typed),',',y.bands[1]=x.bands[1],',',y.bands[2]=x.bands[2],',',
          y.edge=x.edge,',',y.marker);Close(typed)
      end.`,
        disk
      )
    ).toEqual(['6,TRUE,TRUE,TRUE,7', '1,TRUE,TRUE,TRUE,7']);
    expect(Array.from(disk.read('output.bin'), (char) => char.charCodeAt(0))).toEqual(expected);
  });
});
