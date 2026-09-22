import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, input: string[] = []) {
  const machine = new Machine(compile(source), { maxInstructions: 100000 });
  machine.setInput(input);
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine;
}

describe('additional Pascal language execution', () => {
  it('computes sets across the entire byte range with ranges and comparisons', () => {
    expect(
      execute(`program T; type Bits = set of Byte; Letters = set of Char;
      var a,b: Bits; c: Letters; n: Integer;
      begin n:=254; a:=[0,31,32,n..255]; b:=[31,200,255];
        WriteLn(0 in a, ',', 200 in (a+b), ',', 31 in (a-b), ',', 255 in (a*b));
        WriteLn([0,255] <= a, ',', a >= [31], ',', [] = (a-a));
        c:=['A'..'C']; WriteLn('B' in c, ',', 'Z' in c)
      end.`).getOutput()
    ).toEqual(['TRUE,TRUE,FALSE,TRUE', 'TRUE,TRUE,TRUE', 'TRUE,FALSE']);
  });
  it('rejects set elements outside their declared bounds', () => {
    expect(() => execute('{$R+}program T;var s:set of 1..5;begin s:=[7] end.')).toThrow(
      /Set element out of range/
    );
  });
  it('resolves WITH fields, rightmost-record precedence and nested records', () => {
    expect(
      execute(`program T;type R=record x:Integer end;var a,b:R;x:Integer;
      begin x:=50;a.x:=1;b.x:=2;with a,b do x:=x+5;
        with a do begin x:=x+3;with b do x:=x+1 end;
        WriteLn(x, ',', a.x, ',', b.x)
      end.`).getOutput()
    ).toEqual(['50,4,8']);
  });
  it('patches forward and backward jumps to numeric and identifier labels', () => {
    expect(
      execute(`program T;label 10,done;var n:Integer;
      begin n:=0;10:Inc(n);if n<3 then goto 10;goto done;n:=99;
        done:WriteLn(n) end.`).getOutput()
    ).toEqual(['3']);
  });
  it('rejects undeclared and unresolved labels', () => {
    expect(() => compile('program T;begin goto 10 end.')).toThrow(/Undeclared label/);
    expect(() => compile('program T;label 10;begin goto 10 end.')).toThrow(/Undefined label/);
  });
  it('allocates recursive pointer records and follows their fields', () => {
    expect(
      execute(`program T;type PNode=^Node;Node=record value:Integer;next:PNode;s:String end;
      var first,second:PNode;
      begin New(first);New(second);first^.value:=4;second^.value:=9;first^.next:=second;
        first^.s:='head';WriteLn(first^.s, ',', first^.next^.value);
        Dispose(second);Dispose(first)
      end.`).getOutput()
    ).toEqual(['head,9']);
  });
  it('assigns address-of values and reports nil dereferences', () => {
    expect(
      execute(
        'program T;var n:Integer;p:^Integer;begin n:=2;p:=@n;p^:=8;WriteLn(n)end.'
      ).getOutput()
    ).toEqual(['8']);
    expect(() => execute('program T;var p:^Integer;begin p:=nil;WriteLn(p^)end.')).toThrow(
      /Nil pointer/
    );
  });
  it('computes language byte sizes independently of VM storage words', () => {
    expect(
      execute(`program T;type R=record n:Integer;s:String[4] end;A=array[1..3]of R;
      var a1:A;s:String[10];p:^R;
      begin WriteLn(SizeOf(Integer), ',', SizeOf(LongInt), ',', SizeOf(Byte), ',', SizeOf(Word), ',', SizeOf(Boolean), ',', SizeOf(Char), ',', SizeOf(Real));
        WriteLn(SizeOf(s), ',', SizeOf(p), ',', SizeOf(a1), ',', SizeOf(String))end.`).getOutput()
    ).toEqual(['2,4,1,2,1,1,6', '11,4,21,256']);
  });
  it('enforces named integer subtype ranges and short-string capacity', () => {
    expect(
      execute("program T;var s:String[3];begin s:='abcdef';WriteLn(s)end.").getOutput()
    ).toEqual(['abc']);
    // A constant that cannot fit is rejected while compiling, as in TP7.
    expect(() => execute('{$R+}program T;var n:Byte;begin n:=256 end.')).toThrow(
      /Constant out of range/
    );
    expect(() => execute('program T;var n:Byte;i:Integer;begin i:=256;n:=i end.')).not.toThrow();
    expect(() => execute('{$R+}program T;var n:Byte;i:Integer;begin i:=256;n:=i end.')).toThrow(
      /Range check/
    );
    expect(() => execute('{$R+}program T;var n:Integer;begin n:=32768 end.')).toThrow(
      /Constant out of range/
    );
    expect(execute('program T;var n:LongInt;begin n:=32768;WriteLn(n)end.').getOutput()).toEqual([
      '32768',
    ]);
    expect(
      execute('program T;var s:String[3];begin ReadLn(s);WriteLn(s)end.', ['longer']).getOutput()
    ).toEqual(['lon']);
  });
  it('mutates strings and converts values with Str and Val', () => {
    expect(
      execute(`program T;var s:String[8];n,code:Integer;r:Real;
      begin s:='abcdef';Delete(s,2,3);Insert('XYZ',s,2);WriteLn(s);
        Str(12.345:7:2,s);WriteLn(s);
        Val('123',n,code);WriteLn(n, ',', code);
        Val('12x',n,code);WriteLn(code);
        Val('2.5',r,code);WriteLn(r:0:1, ',', code)
      end.`).getOutput()
    ).toEqual(['aXYZef', '  12.35', '123,0', '3', '2.5,0']);
  });
  it('writes and reads virtual text files', () => {
    expect(
      execute(`program T;var f:Text;s:String;n:Integer;
      begin Assign(f,'test.txt');Rewrite(f);WriteLn(f,'hello');WriteLn(f,42);Close(f);
        Reset(f);ReadLn(f,s);ReadLn(f,n);WriteLn(s, ',', n, ',', Eof(f));Close(f)
      end.`).getOutput()
    ).toEqual(['hello,42,TRUE']);
  });
  it('round trips typed records through virtual files', () => {
    expect(
      execute(`program T;type R=record n:Integer;s:String[8]end;var f:file of R;a,b:R;
      begin Assign(f,'records.dat');Rewrite(f);a.n:=17;a.s:='Pascal';Write(f,a);Close(f);
        Reset(f);Read(f,b);WriteLn(b.n, ',', b.s, ',', FileSize(f));Close(f)
      end.`).getOutput()
    ).toEqual(['17,Pascal,1']);
  });
  it('emits debugger scopes, typed variables and executable statement boundaries', () => {
    const bytecode = compile(`program T;var n:Integer;
      procedure P(var x:Integer);var s:String[3];begin x:=2 end;
      begin n:=1;P(n);WriteLn(n)end.`);
    const main = bytecode.debugScopes.find((scope) => scope.name === 'T')!;
    const routine = bytecode.debugScopes.find((scope) => scope.name === 'P')!;
    expect(routine.parentId).toBe(main.id);
    expect(routine.variables.find((value) => value.name === 'x')?.reference).toBe(true);
    expect(routine.variables.find((value) => value.name === 's')?.type.capacity).toBe(3);
    expect(Object.keys(bytecode.statementLines).length).toBe(8);
    expect(routine.variables.find((value) => value.name === 'x')?.parameter).toBe(true);
    expect(routine.variables.find((value) => value.name === 's')?.parameter).toBeUndefined();
    expect(bytecode.statementLines[routine.end - 1]).toBe(2);
  });
});

it('applies range and short-string rules to virtual-file input', () => {
  expect(
    execute(`program T;var f:Text;s:String[3];
    begin Assign(f,'small.txt');Rewrite(f);WriteLn(f,'longer');Close(f);
      Reset(f);ReadLn(f,s);WriteLn(s);Close(f)end.`).getOutput()
  ).toEqual(['lon']);
  expect(() =>
    execute(`{$R+}program T;var f:Text;b:Byte;
    begin Assign(f,'byte.txt');Rewrite(f);WriteLn(f,300);Close(f);
      Reset(f);ReadLn(f,b)end.`)
  ).toThrow(/Range check/);
});

it('round trips untyped binary buffers with signed, unsigned and Real6 cells', () => {
  expect(
    execute(`program T;type R=record a:ShortInt;b:Word;c:Real;s:String[4]end;
    var f:file;x,y:R;count:Word;
    begin x.a:=-12;x.b:=60000;x.c:=2.5;x.s:='abcd';
      Assign(f,'binary.dat');Rewrite(f,1);BlockWrite(f,x,SizeOf(x),count);Close(f);
      Reset(f,1);BlockRead(f,y,SizeOf(y),count);Close(f);
      WriteLn(y.a, ',', y.b, ',', y.c:0:1, ',', y.s, ',', count)
    end.`).getOutput()
  ).toEqual(['-12,60000,2.5,abcd,14']);
});

it('rejects unsafe binary-buffer sizes and invalid forward type cycles', () => {
  expect(() =>
    execute(`program T;var f:file;b:Byte;
    begin Assign(f,'too-big');Rewrite(f,1);BlockWrite(f,b,100)end.`)
  ).toThrow(/buffer|Buffer/);
  expect(() => compile('program T;type R=record value:R end;var r1:R;begin end.')).toThrow(
    /Forward type/
  );
});

it('reads hexadecimal integers and adjacent Pascal character-code strings', () => {
  expect(
    execute("program T;begin WriteLn($FF, ',', Ord(#27), ',', 'A'#66#$43)end.").getOutput()
  ).toEqual(['255,27,ABC']);
  expect(() => compile('program T;begin WriteLn(#256)end.')).toThrow(/Character code out of range/);
});

it('unwinds nested function calls when jumping to an outer label', () => {
  expect(
    execute(`program T;label done;var n:Integer;
    function Outer:Integer;
      function Inner:Integer;
      begin n:=7;goto done;Inner:=99 end;
    begin Outer:=100+Inner end;
    begin n:=1;n:=2+Outer;n:=99;done:WriteLn(n);WriteLn(3+4)end.`).getOutput()
  ).toEqual(['7', '7']);
});

it('compiles CRT, Graph and DOS services through their actual Pascal signatures', () => {
  expect(
    execute(`program T;uses Graph,Dos;var driver,mode:Integer;year,month,day,dow:Word;
    begin driver:=Detect;InitGraph(driver,mode,'');SetColor(Red);Line(0,0,5,5);
      WriteLn(GetPixel(5,5));CloseGraph;
      SetDate(1992,11,1);GetDate(year,month,day,dow);WriteLn(year, ',', month, ',', day)
    end.`).getOutput()
  ).toEqual(['4', '1992,11,1']);
  expect(
    execute(
      `program T;uses Crt;var key:Char;
    begin TextColor(LightRed);GotoXY(2,3);Write('A');WriteLn(WhereX, ',', WhereY);
      key:=ReadKey;WriteLn(Ord(key))end.`,
      ['\u001b']
    ).getOutput()
  ).toEqual(['A3,3', '27']);
});

it('folds set constants and exposes the short-string length byte', () => {
  expect(
    execute(`program T;const Upper=['A'..'Z'];Letters=Upper+['a'..'z'];
    var s:String[8];begin s:='Pascal';WriteLn('a' in Letters, ',', Ord(s[0]));
    s[0]:=#3;WriteLn(s)end.`).getOutput()
  ).toEqual(['TRUE,6', 'Pas']);
});

it('captures I/O checking directives at each call even on the same source line', () => {
  const bytecode = compile(
    "program T;var f:Text;begin Assign(f,'absent');{$I-}Reset(f);{$I+}Reset(f)end."
  );
  const resets = bytecode.istore
    .map((instruction, address) => ({ instruction, address }))
    .filter(({ instruction }) => (instruction & 255) === 1 && instruction >>> 17 === 47);
  expect(resets.map(({ address }) => bytecode.ioChecks[address])).toEqual([false, true]);
});

it('allows an unchecked file error to be inspected and cleared with IOResult', () => {
  expect(
    execute(`program T;var f:Text;code:Integer;
    begin Assign(f,'not-present.txt');{$I-}Reset(f);{$I+}
      code:=IOResult;WriteLn(code<>0, ',', IOResult)end.`).getOutput()
  ).toEqual(['TRUE,0']);
});

it('skips generated subrange validation after an unchecked file read fails', () => {
  expect(
    execute(`program T;var f:Text;n:1..3;
    begin Assign(f,'empty.txt');Rewrite(f);Close(f);Reset(f);
      {$I-}ReadLn(f,n);{$I+}WriteLn(IOResult<>0);Close(f)end.`).getOutput()
  ).toEqual(['TRUE']);
});

it('encodes quoted Unicode as CP437 bytes while preserving numeric character codes', () => {
  expect(
    execute(
      "program T;begin WriteLn(Ord('é'), ',', Ord('█'), ',', '█' = #219, ',', Ord('🙂'))end."
    ).getOutput()
  ).toEqual(['130,219,TRUE,63']);
});
