import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { errorWith } from './matchers';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Lexer, Stream } from '../../src/compiler/lexer';
import { Parser } from '../../src/compiler/parser';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) => new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, input: string[] = []) {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.setInput(input);
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}
const sample = (name: string) => readFileSync(new URL(`../../public/samples/${name}.PAS`, import.meta.url), 'utf8');

describe('bundled Pascal programs', () => {
  it('executes HELLO.PAS and waits for its closing ReadLn', () => {
    expect(execute(sample('HELLO'), [''])).toEqual(['Hello, world!']);
  });

  it('executes SQUARE.PAS using a procedure with a var result', () => {
    expect(execute(sample('SQUARE'), [''])).toEqual(['----- SQUARE OF 7 -----', '49']);
  });

  it('executes FIBONACCI.PAS using numeric input and a counted loop', () => {
    const output = execute(sample('FIBONACCI'), ['10', '']);
    expect(output.filter((line) => /^F\(/.test(line))).toEqual([
      'F(1) = 0', 'F(2) = 1', 'F(3) = 1', 'F(4) = 2', 'F(5) = 3',
      'F(6) = 5', 'F(7) = 8', 'F(8) = 13', 'F(9) = 21', 'F(10) = 34',
    ]);
  });

  it('executes FIBONACCI.PAS with nonpositive input', () => {
    expect(execute(sample('FIBONACCI'), ['0', ''])).toContain('Please enter a positive number.');
  });

  it('executes PRIMES.PAS using nested loops, Break, Inc, and field widths', () => {
    const output = execute(sample('PRIMES'), ['30', '']);
    expect(output).toContain('    2    3    5    7   11   13   17   19   23   29');
    expect(output).toContain('Total: 10 prime numbers found.');
  });

  it('executes PRIMES.PAS below the smallest prime', () => {
    expect(execute(sample('PRIMES'), ['1', ''])).toContain('No prime numbers below 2.');
  });
});

describe('Pascal execution semantics', () => {
  it('evaluates mixed arithmetic, precedence, and negative div/mod', () => {
    expect(execute(`program T; begin
      WriteLn(2 + 3 * 4, ',', 7 div 3, ',', 7 mod 3, ',', 5 / 2:0:1);
      WriteLn((-7) div 3, ',', (-7) mod 3, ',', -(2 + 3));
    end.`)).toEqual(['14,2,1,2.5', '-2,-1,-5']);
  });

  it('combines Write and WriteLn and preserves blank output lines', () => {
    expect(execute("program T; begin Write('a'); Write('b'); WriteLn('c'); WriteLn; Write('d') end."))
      .toEqual(['abc', '', 'd']);
  });

  it('executes recursive functions without overwriting caller locals', () => {
    expect(execute(`program T;
      function Factorial(n: Integer): LongInt;
      var saved: Integer;
      begin
        saved := n;
        if n <= 1 then Factorial := 1
        else Factorial := saved * Factorial(n - 1)
      end;
      begin WriteLn(Factorial(6), ',', Factorial(3)) end.`)).toEqual(['720,6']);
  });

  it('uses lexical scope and forwards var parameters across nested procedures', () => {
    expect(execute(`program T;
      var global: Integer;
      procedure Outer(var target: Integer);
      var local: Integer;
        procedure Add(var result: Integer);
        begin result := result + local + global end;
      begin local := 3; Add(target) end;
      begin global := 2; Outer(global); WriteLn(global) end.`)).toEqual(['7']);
  });

  it('resolves a forward procedure call', () => {
    expect(execute(`program T;
      procedure Second; forward;
      procedure First; begin Second end;
      procedure Second; begin WriteLn('forward') end;
      begin First end.`)).toEqual(['forward']);
  });

  it('stores multidimensional arrays with negative lower bounds', () => {
    expect(execute(`program T;
      var a: array[-1..1, 2..3] of Integer; i, j, total: Integer;
      begin
        total := 0;
        for i := -1 to 1 do for j := 2 to 3 do a[i,j] := (i + 2) * j;
        for i := -1 to 1 do for j := 2 to 3 do total := total + a[i,j];
        WriteLn(total, ',', a[-1,2], ',', a[1,3])
      end.`)).toEqual(['30,2,9']);
  });

  it('runs while, repeat, descending and zero-iteration for loops', () => {
    expect(execute(`program T; var i, total: Integer;
      begin total := 0; i := 0;
        while i < 3 do begin Inc(i); total := total + i end;
        repeat Dec(i); total := total + i until i = 0;
        for i := 3 downto 1 do total := total + i;
        for i := 3 to 1 do total := 1000;
        for i := 1 downto 3 do total := 1000;
        WriteLn(total)
      end.`)).toEqual(['15']);
  });

  it('handles Boolean operators and case ranges with an else clause', () => {
    expect(execute(`program T; var i: Integer;
      begin
        if (True and not False) xor False then Write('ok:');
        for i := 1 to 3 do case i of
          1: Write('one'); 2..2: Write('two'); else Write('other')
        end;
        WriteLn
      end.`)).toEqual(['ok:onetwoother']);
  });

  it('concatenates strings and calls standard string, ordinal, and math functions', () => {
    expect(execute(`program T; var s: String;
      begin s := 'Pascal' + ' rocks';
        WriteLn(Copy(s, 1, 6), ',', Length(s), ',', Pos('rocks', s));
        WriteLn(Chr(65), ',', Ord('A'), ',', Sqr(3), ',', Sqrt(9):0:1)
      end.`)).toEqual(['Pascal,12,8', 'A,65,9,3.0']);
  });

  it('formats integer, string, and real fields without truncating values', () => {
    expect(execute("program T; begin WriteLn(12:5, '|', 'ab':4, '|', 3.14159:7:2, '|', 123:1) end."))
      .toEqual(['   12|  ab|   3.14|123']);
  });

  it('reads multiple numeric values and a subsequent string line', () => {
    expect(execute(`program T; var a, b: Integer; r: Real; name: String;
      begin Read(a); ReadLn(b, r); ReadLn(name); WriteLn(a + b, ',', r:0:1, ',', name) end.`,
    ['12 30 2.5', 'Ada Lovelace'])).toEqual(['42,2.5,Ada Lovelace']);
  });

  it('reports the supplied input stream position with Eof and Eoln', () => {
    expect(execute(`program T; var n: Integer;
      begin
        WriteLn(Eof, ',', Eoln);
        Read(n); WriteLn(n, ',', Eof, ',', Eoln);
        ReadLn; WriteLn(Eof, ',', Eoln)
      end.`, ['12'])).toEqual(['FALSE,FALSE', '12,FALSE,TRUE', 'TRUE,TRUE']);
  });

  it('rejects an undeclared identifier at its source line', () => {
    expect(() => compile('program T;\nbegin\n  Missing := 4\nend.')).toThrowError(
      errorWith({ name: 'PascalError', lineNumber: 3 }),
    );
  });

  it('rejects assigning to a constant and passing a literal to var', () => {
    expect(() => compile('program T; const x = 1; begin x := 2 end.')).toThrow(/Variable required/);
    expect(() => compile('program T; procedure P(var x: Integer); begin end; begin P(2) end.')).toThrow(/Variable required/);
  });

  it('reports division by zero at the runtime source line', () => {
    const machine = new Machine(compile('program T; var zero:Integer;\nbegin\n  WriteLn(1 div zero)\nend.'));
    expect(() => { machine.run(); }).toThrowError(errorWith({ lineNumber: 3, message: 'Division by zero' }));
    expect(machine.getState()).toBe(MachineState.ERROR);
  });

  it('stops runaway programs at the instruction limit', () => {
    const machine = new Machine(compile('program T; begin while True do begin end end.'), { maxInstructions: 100 });
    expect(() => { machine.run(); }).toThrow(/Maximum instruction count/);
    expect(machine.getState()).toBe(MachineState.ERROR);
  });

  it('can reset and rerun a program with fresh output and variables', () => {
    const machine = new Machine(compile('program T; var n: Integer; begin n := 4; WriteLn(n) end.'));
    machine.run();
    expect(machine.getOutput()).toEqual(['4']);
    machine.reset();
    expect(machine.getOutput()).toEqual([]);
    machine.run();
    expect(machine.getOutput()).toEqual(['4']);
  });

  it('suspends for console input and resumes the same program', () => {
    const machine = new Machine(compile(`program T; var n: Integer;
      begin Write('Number: '); ReadLn(n); WriteLn(n * n); ReadLn; WriteLn('done') end.`));
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    expect(machine.getOutput()).toEqual(['Number: ']);
    machine.provideInput('7');
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    expect(machine.getOutput()).toEqual(['Number: 49']);
    machine.provideInput('');
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['Number: 49', 'done']);
  });

  it('retries multi-value input without losing already supplied values', () => {
    const machine = new Machine(compile('program T; var a, b: Integer; begin ReadLn(a,b); WriteLn(a + b) end.'));
    machine.setInput(['12']);
    machine.run();
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideInput('30');
    machine.run();
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getOutput()).toEqual(['42']);
  });

  it('runs bounded slices and permits a paused program to be halted', () => {
    const machine = new Machine(compile('program T; begin while True do begin end end.'));
    machine.runSlice(25);
    expect(machine.getState()).toBe(MachineState.PAUSED);
    expect(machine.getInstructionCount()).toBe(25);
    machine.runSlice(25);
    expect(machine.getInstructionCount()).toBe(50);
    machine.halt();
    machine.runSlice(25);
    expect(machine.getState()).toBe(MachineState.STOPPED);
    expect(machine.getInstructionCount()).toBe(50);
  });

  it('rejects invalid numeric input without coercing it to zero', () => {
    const machine = new Machine(compile('program T; var n: Integer; begin ReadLn(n) end.'));
    machine.setInput(['hello']);
    expect(() => { machine.run(); }).toThrow(/Invalid integer input/);
    expect(machine.getState()).toBe(MachineState.ERROR);
  });

  it('copies arrays and records while preserving value and var parameter semantics', () => {
    expect(execute(`program T;
      type TValues = array[1..2] of Integer; TPoint = record x, y: Integer end;
      var original, copied: TValues; first, second: TPoint;
      procedure Edit(values: TValues; point: TPoint; var result: TPoint);
      begin values[1] := 99; point.y := 40; result.x := values[1]; result.y := point.y end;
      begin
        original[1] := 2; original[2] := 3; copied := original; copied[2] := 5;
        first.x := 7; first.y := 8; second := first;
        Edit(original, first, second);
        WriteLn(original[1], ',', original[2], ',', copied[2], ',', first.y, ',', second.x, ',', second.y)
      end.`)).toEqual(['2,3,5,8,99,40']);
  });

  it('indexes string characters and compares full strings lexically', () => {
    expect(execute(`program T; var s: String;
      begin s := 'Pascal'; s[1] := 'p'; WriteLn(s, ',', s[2]);
        if ('aa' < 'ab') and ('z' > 'a') then WriteLn('ordered')
      end.`)).toEqual(['pascal,a', 'ordered']);
  });

  it('evaluates integer bit operations and shifts at Pascal precedence', () => {
    expect(execute('program T; begin WriteLn(1 + 2 shl 3, \',\', 16 shr 2, \',\', 7 and 3, \',\', 3 xor 1) end.'))
      .toEqual(['17,4,3,2']);
  });

  it('reports out-of-range array access before corrupting another variable', () => {
    // A constant index is rejected while compiling, as Turbo Pascal does.
    expect(() => compile('program T; var a: array[1..2] of Integer; begin a[3] := 7 end.')).toThrow(
      /Constant out of range/
    );
    const machine = new Machine(
      compile('{$R+}program T; var a: array[1..2] of Integer; i: Integer; begin i := 3; a[i] := 7 end.')
    );
    expect(() => { machine.run(); }).toThrow(/Array index 3 out of bounds/);
    expect(machine.getState()).toBe(MachineState.ERROR);
  });

  it.each([
    ['program T; var n: Integer; begin n := \'hello\' end.', /Type mismatch/],
    ['program T; var n: Boolean; begin n := 1 end.', /Type mismatch/],
    ['program T; procedure P; begin end; begin WriteLn(P()) end.', /Procedure cannot be used as an expression/],
    ['program T; {$X-} function F: Integer; begin F := 1 end; begin F end.', /Function result must be used/],
    ["program T; var s: string; begin Length(s) end.", /Function result must be used/],
  ])('rejects invalid scalar or routine use: %s', (source, message) => {
    expect(() => compile(source)).toThrow(message);
  });

  it('starts a reused compiler with a fresh symbol and unit scope', () => {
    const compiler = new Compiler();
    const parse = (source: string) => new Parser(new Lexer(new Stream(source))).parse();
    compiler.compile(parse('program First; uses Crt; var n: Integer; begin n := 1; ClrScr end.'));
    const machine = new Machine(compiler.compile(parse('program Second; var n: String; begin n := \'fresh\'; WriteLn(n) end.')));
    machine.run();
    expect(machine.getOutput()).toEqual(['fresh']);
    expect(() => compiler.compile(parse('program Third; begin ClrScr end.'))).toThrow(/Undeclared/);
  });

  it('limits output growth from a runaway printing loop', () => {
    const machine = new Machine(compile('program T; begin while True do Write(\'12345\') end.'), { maxOutputChars: 20 });
    expect(() => { machine.run(); }).toThrow(/Maximum output size/);
    expect(machine.getOutput().join('\n').length).toBeLessThanOrEqual(20);
  });
});

it('checks the original ReadLn destination when input changes its array index', () => {
  const machine = new Machine(compile(`{$R+}program T;
    var i: Integer; a: array[1..2] of 1..3;
    begin
      i := 1; a[2] := 2;
      ReadLn(i, a[i]);
      WriteLn(a[1])
    end.`));
  machine.setInput(['2 9']);
  expect(() => { machine.run(); }).toThrowError(
    errorWith({ message: 'Range check error (1..3)', lineNumber: 5 }),
  );
  expect(machine.getState()).toBe(MachineState.ERROR);
});

it('evaluates a value array argument address once before copying its cells', () => {
  expect(execute(`program T;
    type Row = array[1..2] of Integer;
         Matrix = array[1..2] of Row;
    var a: Matrix; i: Integer;
    function NextRow: Integer;
    begin Inc(i); NextRow := i end;
    procedure PrintRow(value: Row);
    begin WriteLn(value[1], value[2]) end;
    begin
      i := 0;
      a[1,1] := 1; a[1,2] := 2; a[2,1] := 3; a[2,2] := 4;
      PrintRow(a[NextRow]);
      WriteLn(i)
    end.`)).toEqual(['12', '1']);
});
