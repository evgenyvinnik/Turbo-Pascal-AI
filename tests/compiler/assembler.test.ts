import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';
import { NativePascalRequired } from '../../src/compiler/errors';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, config: ConstructorParameters<typeof Machine>[1] = {}): Machine {
  const machine = new Machine(compile(source), { maxInstructions: 2_000_000, ...config });
  machine.run();
  return machine;
}
const output = (source: string) => {
  const machine = execute(source);
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
};
const native = (source: string) => {
  try {
    compile(source);
  } catch (error) {
    if (error instanceof NativePascalRequired) return error.message;
    throw error;
  }
  throw new Error('Expected the native compiler');
};

describe('The built-in assembler in the P-machine', () => {
  it('runs asm statements over Pascal variables', () => {
    expect(
      output(`program T; var value: Word; a, b, c: Integer; l: LongInt;
    begin
      asm mov ax,$1234; add ax,2; mov value,ax end; WriteLn(value);
      a := 5; b := -7;
      asm
        mov ax, a      { comments are allowed }
        imul b
        mov c, ax
      end;
      WriteLn(c);
      asm mov word ptr l, 0FFFFh; mov word ptr l+2, 7FFFh end; WriteLn(l);
      asm mov ax, -3; cwd; mov bx, 2; idiv bx; mov a, ax; mov b, dx end; WriteLn(a, ' ', b)
    end.`)
    ).toEqual(['4662', '-35', '2147483647', '-1 -1']);
  });

  it('returns assembler functions in AL, AX or DX:AX', () => {
    expect(
      output(`program T; var a, b: Integer;
    function Add(x, y: Integer): Integer; assembler; asm mov ax, x; add ax, y end;
    function Negate(x: Integer): Integer; assembler; asm mov ax, x; neg ax end;
    function Up(c: Char): Char; assembler;
    asm mov al, c; cmp al, 'a'; jb @done; cmp al, 'z'; ja @done; sub al, 32
    @done:
    end;
    function Big: LongInt; assembler; asm mov ax, 1; mov dx, 2 end;
    function Odd2(n: Word): Boolean; assembler; asm mov ax, n; and ax, 1 end;
    function Five: Integer; begin asm mov @Result, 5 end end;
    procedure Swap(var p, q: Integer); assembler;
    asm les di, p; mov ax, es:[di]; les di, q; xchg ax, es:[di]; les di, p; mov es:[di], ax end;
    function Len(const s: string): Byte; assembler; asm les di, s; mov al, es:[di] end;
    begin
      WriteLn(Add(40, 2), ' ', Negate(9), ' ', Up('q'), Up('Q'), ' ', Big, ' ', Odd2(3), Odd2(4), ' ', Five);
      a := 1; b := 2; Swap(a, b); WriteLn(a, b, ' ', Len('hello'))
    end.`)
    ).toEqual(['42 -9 QQ 131073 TRUEFALSE 5', '21 5']);
  });

  it('follows addresses into strings, arrays and records', () => {
    expect(
      output(`program T; type TPoint = record X, Y: Integer end;
    var s, t: string; p: TPoint; words: array[1..4] of Word; total: Word; c: Char;
    begin
      s := 'hello'; t := '';
      asm lea si, s; lea di, t; mov cx, 6; cld; rep movsb end; WriteLn(t);
      asm lea si, s; inc si; lodsb; mov c, al end; WriteLn(c);
      p.X := 3; p.Y := 4;
      asm mov ax, p.Y; lea bx, p; add ax, [bx].TPoint.X; mov p.X, ax end; WriteLn(p.X);
      words[1] := 10; words[2] := 20; words[3] := 30; words[4] := 40;
      asm lea si, words; mov cx, 4; xor ax, ax
      @sum: add ax, [si]; add si, 2; loop @sum
        mov total, ax end;
      WriteLn(total)
    end.`)
    ).toEqual(['hello', 'h', '7', '100']);
  });

  it('keeps 8086 flags for conditional jumps and local calls', () => {
    expect(
      output(`program T; var r: Integer; f: Word;
    begin
      asm mov ax, -1; cmp ax, 1; jl @less; mov r, 0; jmp @done
      @less: mov r, 1
      @done: end;
      Write(r);
      asm mov ax, 0FFFFh; cmp ax, 1; ja @above; mov r, 0; jmp @out
      @above: mov r, 1
      @out: end;
      Write(r);
      asm mov ax, 3; call @double; call @double; mov r, ax; jmp @end
      @double: shl ax, 1; ret
      @end: end;
      Write(' ', r);
      asm mov al, 0FFh; add al, 1; pushf; pop ax; mov f, ax end;
      WriteLn(' ', f and 1, ' ', f and $40 <> 0)
    end.`)
    ).toEqual(['11 12 1 TRUE']);
  });

  it('handles DOS and BIOS interrupts', () => {
    const machine = execute(`program T; const Msg: array[1..4] of Char = 'Hi!$'; var k, s: Byte;
    begin
      asm mov ah, 2; mov dl, 'A'; int 21h; lea dx, Msg; mov ah, 9; int 21h end; WriteLn;
      asm mov ah, 0; int 16h; mov k, al; mov s, ah end; WriteLn(Chr(k), ' ', s);
      asm mov ax, 4C07h; int 21h end;
      WriteLn('not reached')
    end.`);
    expect(machine.getState()).toBe(MachineState.WAITING);
    expect(machine.getInputMode()).toBe('key');
    machine.provideKey('x');
    machine.run();
    expect(machine.getOutput()).toEqual(['AHi!', 'x 45']);
    expect(machine.getExitCode()).toBe(7);
  });

  it('drives the speaker through its ports', () => {
    const sounds: number[] = [];
    execute(
      `program T;
    begin asm mov al, 0B6h; out 43h, al; mov ax, 2712; out 42h, al; mov al, ah; out 42h, al
      in al, 61h; or al, 3; out 61h, al; and al, 0FCh; out 61h, al end end.`,
      { onSound: (frequency) => sounds.push(frequency) }
    );
    expect(sounds).toEqual([440, 0]);
  });

  it('checks operands as Turbo Pascal does', () => {
    expect(() => compile('program T; var x: Byte; begin asm mov ax, x end end.')).toThrow(
      /Operand size mismatch/
    );
    expect(() => compile('program T; begin asm mov ax, bl end end.')).toThrow(
      /Operand size mismatch/
    );
    expect(() => compile('program T; begin asm jmp @nowhere end end.')).toThrow(
      /Unknown label "@nowhere"/
    );
    expect(() => compile('program T; begin asm mov ax, [si+di] end end.')).toThrow(
      /Invalid register combination/
    );
    expect(() => compile('program T; begin asm mov ax, nothing end end.')).toThrow(
      /Unknown identifier "nothing"/
    );
    // An instruction Turbo Pascal does not know is an error where it is, even
    // before a later syntax error.
    let error: unknown;
    try {
      compile('program T;\nbegin\n  asm\n    nop\n    movl %eax, 1\n  end\nend;');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({ lineNumber: 5 });
    expect(() => compile('program T; begin asm movl ax, 1 end end.')).toThrow(
      /Invalid assembler instruction/
    );
    const loop = new Machine(compile('program T; begin asm @l: jmp @l end end.'), {
      maxInstructions: 50_000,
    });
    expect(() => {
      loop.run();
    }).toThrow(/Maximum instruction count exceeded/);
  });

  it('leaves what it cannot run to the native DOS compiler', () => {
    expect(native('program T; begin asm db 90h end end.')).toMatch(/Data in assembler/);
    expect(native('program T; procedure P; begin end; begin asm call P end end.')).toMatch(
      /Naming a routine/
    );
    expect(native('program T; begin asm aaa end end.')).toMatch(/The AAA instruction/);
    expect(native('program T; begin inline($0F/$A2) end.')).toMatch(/Machine code \$0F/);
  });
});

describe('Inline machine code', () => {
  it('decodes inline statements that name variables', () => {
    expect(
      output(`program T; var x, y: Integer; b: Byte;
    procedure P(v: Integer); var r: Integer; begin inline($8B/$46/<v/$D1/$E0/$89/$46/<r); WriteLn(r) end;
    begin x := 3; inline($A1/x/$05/>100/$A3/y); b := 7; inline($FE/$06/b); WriteLn(y, ' ', b); P(21) end.`)
    ).toEqual(['103 8', '42']);
  });

  it('inserts inline routines, which pop their arguments', () => {
    expect(
      output(`program T;
    function Max(a, b: Integer): Integer; inline($58/$5A/$3B/$C2/$7F/$02/$89/$D0);
    function Twice(n: LongInt): LongInt; inline($58/$5A/$D1/$E0/$D1/$D2);
    procedure Say; inline($B4/$02/$B2/$41/$CD/$21);
    begin WriteLn(Max(4, 9), ' ', Max(12, -2), ' ', Twice(70000)); Say; WriteLn end.`)
    ).toEqual(['9 12 140000', 'A']);
  });
});

describe('Interrupt procedures', () => {
  it('runs a timer interrupt procedure on each tick', () => {
    expect(
      output(`program T; uses Dos; var Ticks: Word; Old: Pointer;
    procedure Tick; interrupt; begin Inc(Ticks) end;
    begin GetIntVec($1C, Old); SetIntVec($1C, @Tick); while Ticks < 2 do; SetIntVec($1C, Old); WriteLn(Ticks, ' ', Old <> nil) end.`)
    ).toEqual(['2 TRUE']);
  });

  it('passes the registers to a software interrupt procedure and takes them back', () => {
    expect(
      output(`program T; uses Dos; var Seen, r, b: Word;
    procedure Handler(Flags, CS, IP, AX, BX, CX, DX, SI, DI, DS, ES, BP: Word); interrupt;
    begin Seen := AX; AX := AX * 2; BX := 7 end;
    procedure Short(DI, DS, ES, BP: Word); interrupt; begin r := DI end;
    begin SetIntVec($60, @Handler); SetIntVec($61, @Short);
      asm mov ax, 21; int 60h; mov r, ax; mov b, bx end; Write(Seen, ' ', r, ' ', b);
      asm mov di, 99; int 61h end; WriteLn(' ', r) end.`)
    ).toEqual(['21 42 7 99']);
  });

  it('calls a keyboard interrupt procedure for each key, which reads port 60h', () => {
    const machine = execute(`program T; uses Dos, Crt; var Code: Byte; Old: Pointer;
    procedure Keyboard; interrupt; begin asm in al, 60h; mov Code, al end end;
    begin GetIntVec(9, Old); SetIntVec(9, @Keyboard); WriteLn(Ord(ReadKey), ' ', Code); SetIntVec(9, Old) end.`);
    expect(machine.getState()).toBe(MachineState.WAITING);
    machine.provideKey('a');
    machine.run();
    expect(machine.getOutput()).toEqual(['97 30']);
  });

  it('takes only procedures of Word registers, at the outermost level', () => {
    expect(() =>
      compile('program T; function F: Integer; interrupt; begin end; begin end.')
    ).toThrow(/must be a procedure/);
    expect(() =>
      compile('program T; procedure P; procedure Q; interrupt; begin end; begin end; begin end.')
    ).toThrow(/cannot be nested/);
    expect(() =>
      compile('program T; procedure P(var x: Word); interrupt; begin end; begin end.')
    ).toThrow(/must be Word registers/);
  });
});
