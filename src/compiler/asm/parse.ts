import { PascalError } from '../errors/PascalError';
import { BYTE_REGISTERS, SEGMENT_REGISTERS, WORD_REGISTERS, type Register } from './types';

/** An expression in an operand, before names are resolved. */
export type AsmExpression =
  | { kind: 'number'; value: number }
  | { kind: 'name'; path: string[] }
  | { kind: 'unary'; operator: string; operand: AsmExpression }
  | { kind: 'binary'; operator: string; left: AsmExpression; right: AsmExpression };

export type RawOperand =
  | { kind: 'register'; register: Register }
  | {
      kind: 'memory';
      size?: 1 | 2 | 4;
      registers: Register[];
      displacement?: AsmExpression;
      segment?: Register;
    }
  | { kind: 'expression'; size?: 1 | 2 | 4; expression: AsmExpression; segment?: Register };

export interface RawInstruction {
  labels: string[];
  prefix?: string;
  mnemonic?: string;
  operands: RawOperand[];
  line: number;
}

const REGISTERS = new Set<string>([...WORD_REGISTERS, ...BYTE_REGISTERS, ...SEGMENT_REGISTERS]);
const PREFIXES = new Set(['rep', 'repe', 'repz', 'repne', 'repnz', 'lock']);
const SIZES: Record<string, 1 | 2 | 4> = { byte: 1, word: 2, dword: 4 };

interface Token {
  kind: 'number' | 'name' | 'symbol' | 'string' | 'end';
  text: string;
  value?: number;
}

/** Split a statement into tokens: names (with @ labels and dots), numbers in
 * Pascal ($1F) or assembler (1Fh, 101b) form, strings and symbols. */
function tokenize(text: string, line: number): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (char === "'" || char === '"') {
      let value = '';
      at++;
      for (;;) {
        if (at >= text.length) throw new PascalError('String constant exceeds line', line);
        if (text[at] === char) {
          if (text[at + 1] === char) {
            value += char;
            at += 2;
            continue;
          }
          at++;
          break;
        }
        value += text.charAt(at++);
      }
      tokens.push({ kind: 'string', text: value });
      continue;
    }
    if (char === '$' || /\d/.test(char)) {
      const match = /^(\$[\da-f]+|\d[\da-f]*h|[01]+b(?![\da-f])|\d+)/i.exec(text.slice(at));
      if (!match) throw new PascalError('Invalid number', line);
      const word = match[0];
      const value = word.startsWith('$')
        ? parseInt(word.slice(1), 16)
        : /h$/i.test(word)
          ? parseInt(word.slice(0, -1), 16)
          : /b$/i.test(word)
            ? parseInt(word.slice(0, -1), 2)
            : parseInt(word, 10);
      tokens.push({ kind: 'number', text: word, value });
      at += word.length;
      continue;
    }
    if (/[a-z_@]/i.test(char)) {
      const match = /^@{0,2}[a-z_][\w]*/i.exec(text.slice(at));
      if (!match) throw new PascalError(`Syntax error in assembler: "${char}"`, line);
      tokens.push({ kind: 'name', text: match[0] });
      at += match[0].length;
      continue;
    }
    if ('[]+-*/:,.()'.includes(char)) {
      tokens.push({ kind: 'symbol', text: char });
      at++;
      continue;
    }
    throw new PascalError(`Syntax error in assembler: "${char}"`, line);
  }
  tokens.push({ kind: 'end', text: '' });
  return tokens;
}

/** Split an asm block into statements: one per line, or per semicolon. */
function statements(source: string, firstLine: number): { text: string; line: number }[] {
  const result: { text: string; line: number }[] = [];
  let current = '',
    line = firstLine,
    start = firstLine,
    quote = '';
  for (const char of source) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === ';' || char === '\n') {
      if (current.trim()) result.push({ text: current, line: start });
      current = '';
      if (char === '\n') line++;
      start = line;
    } else current += char;
  }
  if (current.trim()) result.push({ text: current, line: start });
  return result;
}

class StatementParser {
  private at = 0;
  constructor(
    private tokens: Token[],
    private line: number
  ) {}
  private get current(): Token {
    return this.tokens[this.at]!;
  }
  /** The current token's kind, read afresh after the parser moves on. */
  private kind(): Token['kind'] {
    return this.tokens[this.at]!.kind;
  }
  private is(text: string): boolean {
    return this.current.kind !== 'string' && this.current.text.toLowerCase() === text;
  }
  private expect(text: string): void {
    if (!this.is(text)) throw new PascalError(`"${text}" expected in assembler`, this.line);
    this.at++;
  }
  parse(): RawInstruction {
    const labels: string[] = [];
    while (
      this.current.kind === 'name' &&
      this.tokens[this.at + 1]?.text === ':' &&
      !REGISTERS.has(this.current.text.toLowerCase())
    ) {
      labels.push(this.current.text.toLowerCase());
      this.at += 2;
    }
    const instruction: RawInstruction = { labels, operands: [], line: this.line };
    if (this.current.kind === 'end') return instruction;
    if (this.current.kind !== 'name')
      throw new PascalError('Invalid assembler instruction', this.line);
    let word = this.current.text.toLowerCase();
    if (PREFIXES.has(word)) {
      instruction.prefix = word;
      this.at++;
      if (this.kind() === 'end') return instruction;
      word = this.current.text.toLowerCase();
    }
    instruction.mnemonic = word;
    this.at++;
    if (this.kind() !== 'end') {
      instruction.operands.push(this.operand());
      while (this.is(',')) {
        this.at++;
        instruction.operands.push(this.operand());
      }
    }
    if (this.kind() !== 'end') throw new PascalError('Invalid assembler operand', this.line);
    return instruction;
  }
  private operand(): RawOperand {
    let size: 1 | 2 | 4 | undefined;
    const sizeWord = SIZES[this.current.text.toLowerCase()];
    if (
      this.current.kind === 'name' &&
      sizeWord &&
      this.tokens[this.at + 1]?.text.toLowerCase() === 'ptr'
    ) {
      size = sizeWord;
      this.at += 2;
    }
    let segment: Register | undefined;
    if (
      this.current.kind === 'name' &&
      (SEGMENT_REGISTERS as readonly string[]).includes(this.current.text.toLowerCase()) &&
      this.tokens[this.at + 1]?.text === ':'
    ) {
      segment = this.current.text.toLowerCase() as Register;
      this.at += 2;
    }
    if (
      this.current.kind === 'name' &&
      REGISTERS.has(this.current.text.toLowerCase()) &&
      !segment &&
      size === undefined
    ) {
      const register = this.current.text.toLowerCase() as Register;
      const next = this.tokens[this.at + 1]!;
      if (next.kind === 'end' || next.text === ',') {
        this.at++;
        return { kind: 'register', register };
      }
    }
    // Registers inside brackets make a memory operand; the rest is an
    // expression, which may also name a variable, a label or a constant.
    const registers: Register[] = [];
    const terms: AsmExpression[] = [];
    let memory = false;
    for (;;) {
      if (this.is('[')) {
        memory = true;
        this.at++;
        this.bracket(registers, terms);
        this.expect(']');
      } else if (this.is('.')) {
        // [bx].TRec.Field: the field's offset, from its record type.
        this.at++;
        const field = this.factor();
        if (field.kind !== 'name') throw new PascalError('Field identifier expected', this.line);
        terms.push(field);
      } else if (this.current.kind === 'end' || this.is(',')) break;
      else terms.push(this.expression());
    }
    const expression = terms.reduce<AsmExpression | undefined>(
      (sum, term) => (sum ? { kind: 'binary', operator: '+', left: sum, right: term } : term),
      undefined
    );
    if (memory || segment)
      return {
        kind: 'memory',
        ...(size ? { size } : {}),
        registers,
        ...(expression ? { displacement: expression } : {}),
        ...(segment ? { segment } : {}),
      };
    if (!expression) throw new PascalError('Operand expected in assembler', this.line);
    return { kind: 'expression', ...(size ? { size } : {}), expression };
  }
  private bracket(registers: Register[], terms: AsmExpression[]): void {
    let negative = false;
    for (;;) {
      if (this.current.kind === 'name' && REGISTERS.has(this.current.text.toLowerCase())) {
        if (negative) throw new PascalError('Invalid register combination', this.line);
        registers.push(this.current.text.toLowerCase() as Register);
        this.at++;
      } else {
        const term = this.term();
        terms.push(negative ? { kind: 'unary', operator: '-', operand: term } : term);
      }
      if (this.is('+') || this.is('-')) {
        negative = this.is('-');
        this.at++;
      } else return;
    }
  }
  private expression(): AsmExpression {
    let left = this.term();
    while (this.is('+') || this.is('-') || this.is('or') || this.is('xor')) {
      const operator = this.current.text.toLowerCase();
      this.at++;
      left = { kind: 'binary', operator, left, right: this.term() };
    }
    return left;
  }
  private term(): AsmExpression {
    let left = this.factor();
    while (['*', '/', 'mod', 'shl', 'shr', 'and'].some((operator) => this.is(operator))) {
      const operator = this.current.text.toLowerCase();
      this.at++;
      left = { kind: 'binary', operator, left, right: this.factor() };
    }
    return left;
  }
  private factor(): AsmExpression {
    const token = this.current;
    if (this.is('-') || this.is('+') || this.is('not')) {
      this.at++;
      return { kind: 'unary', operator: token.text.toLowerCase(), operand: this.factor() };
    }
    if (['offset', 'seg', 'type', 'low', 'high'].some((operator) => this.is(operator))) {
      this.at++;
      return { kind: 'unary', operator: token.text.toLowerCase(), operand: this.factor() };
    }
    if (this.is('(')) {
      this.at++;
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    if (token.kind === 'number') {
      this.at++;
      return { kind: 'number', value: token.value! };
    }
    if (token.kind === 'string') {
      this.at++;
      if (token.text.length > 2)
        throw new PascalError('String constant too long for an operand', this.line);
      let value = 0;
      for (let at = 0; at < token.text.length; at++)
        value = value * 256 + (token.text.charCodeAt(at) & 255);
      return { kind: 'number', value };
    }
    if (token.kind === 'name' && !REGISTERS.has(token.text.toLowerCase())) {
      this.at++;
      const path = [token.text];
      while (this.is('.') && this.tokens[this.at + 1]?.kind === 'name') {
        path.push(this.tokens[this.at + 1]!.text);
        this.at += 2;
      }
      return { kind: 'name', path };
    }
    throw new PascalError('Invalid assembler expression', this.line);
  }
}

/** Turbo Pascal 7's built-in assembler knows the 8086, 80286 and 80287
 * instructions, and DB, DW and DD. */
const MNEMONICS = new Set(
  (
    'aaa aad aam aas adc add and call cbw clc cld cli cmc cmp cmps cmpsb cmpsw cwd daa das dec div hlt idiv imul ' +
    'in inc int into iret ja jae jb jbe jc jcxz je jg jge jl jle jmp jna jnae jnb jnbe jnc jne jng jnge jnl jnle ' +
    'jno jnp jns jnz jo jp jpe jpo js jz lahf lds lea les lods lodsb lodsw loop loope loopne loopnz loopz mov movs ' +
    'movsb movsw mul neg nop not or out pop popf push pushf rcl rcr ret retf retn rol ror sahf sal sar sbb scas ' +
    'scasb scasw shl shr stc std sti stos stosb stosw sub test wait xchg xlat xlatb xor ' +
    'bound enter ins insb insw leave outs outsb outsw popa pusha arpl clts lar lgdt lidt lldt lmsw lsl ltr sgdt ' +
    'sidt sldt smsw str verr verw db dw dd ' +
    'f2xm1 fabs fadd faddp fbld fbstp fchs fclex fcom fcomp fcompp fdecstp fdisi fdiv fdivp fdivr fdivrp feni ' +
    'ffree fiadd ficom ficomp fidiv fidivr fild fimul fincstp finit fist fistp fisub fisubr fld fld1 fldcw ' +
    'fldenv fldl2e fldl2t fldlg2 fldln2 fldpi fldz fmul fmulp fnclex fndisi fneni fninit fnop fnsave fnstcw ' +
    'fnstenv fnstsw fpatan fprem fptan frndint frstor fsave fscale fsetpm fsqrt fst fstcw fstenv fstp fstsw fsub ' +
    'fsubp fsubr fsubrp ftst fwait fxam fxch fxtract fyl2x fyl2xp1'
  ).split(' ')
);

/** The statements of an asm block, with their labels, before names are
 * resolved. Comments were already replaced by spaces. Each is checked as it
 * is read, so an error is reported where it is. */
export function parseAssembly(source: string, firstLine: number): RawInstruction[] {
  return statements(source, firstLine).map(({ text, line }) => {
    const instruction = new StatementParser(tokenize(text, line), line).parse();
    if (instruction.mnemonic && !MNEMONICS.has(instruction.mnemonic))
      throw new PascalError('Invalid assembler instruction', line);
    return instruction;
  });
}
