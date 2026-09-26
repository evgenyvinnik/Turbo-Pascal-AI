import { PascalError } from '../errors/PascalError';

/**
 * The 8087's temporary real, which Turbo Pascal's Extended and every 8087
 * result are: a sign, a 64-bit significand and a binary exponent. Values a
 * double holds exactly stay plain numbers; this holds the rest, exactly, as
 * significand × 2^exponent with the significand's top bit set.
 */
export class Float80 {
  /** The nearest double, which Number() and arithmetic on doubles see. */
  private readonly nearest: number;
  constructor(
    readonly negative: boolean,
    readonly significand: bigint,
    readonly exponent: number
  ) {
    const magnitude = Number(significand) * 2 ** exponent;
    this.nearest = negative ? -magnitude : magnitude;
  }
  valueOf(): number {
    return this.nearest;
  }
  toJSON(): number {
    return this.nearest;
  }
  toString(): string {
    return String(this.nearest);
  }
}

/** A value of an 8087 type: a double where one holds it exactly. */
export type Real = number | Float80;

const TWO63 = 1n << 63n;
const TWO64 = 1n << 64n;
/** Extended's largest binary exponent, of its leading bit. */
const MAX_EXPONENT = 16383;

interface Exact {
  negative: boolean;
  /** value = n × 2^e, n ≥ 0 */
  n: bigint;
  e: number;
}

/** A value's exact parts. */
function exact(value: Real): Exact {
  if (value instanceof Float80)
    return { negative: value.negative, n: value.significand, e: value.exponent };
  if (value === 0 || !Number.isFinite(value))
    return { negative: Object.is(value, -0), n: 0n, e: 0 };
  const bits = new DataView(Float64Array.of(value).buffer).getBigUint64(0, true);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  return {
    negative: bits >> 63n === 1n,
    n: biased ? fraction | (1n << 52n) : fraction,
    e: (biased || 1) - 1075,
  };
}

function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}

/** num / den × 2^e rounded to 64 significant bits, the nearest and an exact
 * half to even, as the 8087 rounds: a double where one holds it. */
export function roundExtended(
  negative: boolean,
  num: bigint,
  den: bigint,
  e: number,
  line = -1
): Real {
  if (num === 0n) return 0;
  const divide = (shift: number): [bigint, bigint, bigint] => {
    const a = shift >= 0 ? num << BigInt(shift) : num;
    const b = shift >= 0 ? den : den << BigInt(-shift);
    return [a / b, a % b, b];
  };
  let shift = 64 - (bitLength(num) - bitLength(den));
  let [q, r, d] = divide(shift);
  if (q >= TWO64) [q, r, d] = divide(--shift);
  else if (q < TWO63) [q, r, d] = divide(++shift);
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) q += 1n;
  if (q === TWO64) {
    q = TWO63;
    shift--;
  }
  const exponent = e - shift;
  if (exponent + 63 > MAX_EXPONENT) throw new PascalError('Real overflow', line);
  if (exponent + 63 < -MAX_EXPONENT) return 0;
  return fromParts(negative, q, exponent);
}

/** A 64-bit value as a double where it is one. */
function fromParts(negative: boolean, significand: bigint, exponent: number): Real {
  if ((significand & 0x7ffn) === 0n && exponent + 63 <= 1023 && exponent + 63 >= -1022) {
    const magnitude = Number(significand) * 2 ** exponent;
    return negative ? -magnitude : magnitude;
  }
  return new Float80(negative, significand, exponent);
}

/** A double's value as the 8087 holds it: itself. */
export function toReal(value: number | bigint): Real {
  if (typeof value === 'number') return value;
  if (value === 0n) return 0;
  const negative = value < 0n;
  return roundExtended(negative, negative ? -value : value, 1n, 0);
}

/** +, -, * and / as the 8087 computes them, rounding the exact result. */
export function extendedOperation(operator: string, a: Real, b: Real, line = -1): Real {
  const x = exact(a),
    y = exact(b);
  if (operator === '*')
    return roundExtended(x.negative !== y.negative, x.n * y.n, 1n, x.e + y.e, line);
  if (operator === '/') {
    if (y.n === 0n) throw new PascalError('Division by zero', line);
    return roundExtended(x.negative !== y.negative, x.n, y.n, x.e - y.e, line);
  }
  const negativeY = operator === '-' ? !y.negative : y.negative;
  if (y.n === 0n) return a;
  if (x.n === 0n) return operator === '-' ? negateReal(b) : b;
  // Bits far below the larger term's last only round the sum, so they are
  // kept as one sticky bit rather than shifted out to the smaller's end.
  const top = Math.max(x.e + bitLength(x.n), y.e + bitLength(y.n));
  const base = Math.max(Math.min(x.e, y.e), top - 200);
  const scale = (term: Exact) => {
    if (term.e >= base) return term.n << BigInt(term.e - base);
    const shift = BigInt(base - term.e),
      kept = term.n >> shift;
    return (term.n & ((1n << shift) - 1n)) === 0n ? kept : kept | 1n;
  };
  const sum = (x.negative ? -scale(x) : scale(x)) + (negativeY ? -scale(y) : scale(y));
  return roundExtended(sum < 0n, sum < 0n ? -sum : sum, 1n, base, line);
}

/** Compares two values exactly: negative, zero or positive. */
export function compareReal(a: Real, b: Real): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const x = exact(a),
    y = exact(b);
  const e = Math.min(x.e, y.e);
  const left = (x.negative ? -1n : 1n) * (x.n << BigInt(x.e - e));
  const right = (y.negative ? -1n : 1n) * (y.n << BigInt(y.e - e));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function negateReal(value: Real): Real {
  return value instanceof Float80
    ? new Float80(!value.negative, value.significand, value.exponent)
    : -value;
}

export function absReal(value: Real): Real {
  return value instanceof Float80
    ? new Float80(false, value.significand, value.exponent)
    : Math.abs(value);
}

/** The whole part toward zero, as an integer. */
export function truncReal(value: Real): bigint {
  const { negative, n, e } = exact(value);
  const whole = e >= 0 ? n << BigInt(e) : n >> BigInt(-e);
  return negative ? -whole : whole;
}

/** Round, as Turbo Pascal's: to the nearest whole number, a half away from zero. */
export function roundReal(value: Real): bigint {
  const { negative, n, e } = exact(value);
  const whole = e >= 0 ? n << BigInt(e) : ((n << 1n) + (1n << BigInt(-e))) >> BigInt(1 - e);
  return negative ? -whole : whole;
}

/** Int and Frac: the whole part and the rest, as reals. */
export function intReal(value: Real): Real {
  if (typeof value === 'number') return Math.trunc(value);
  const whole = truncReal(value);
  return whole === 0n ? 0 : toReal(whole);
}
export function fracReal(value: Real, line = -1): Real {
  return typeof value === 'number'
    ? value - Math.trunc(value)
    : extendedOperation('-', value, intReal(value), line);
}

/** The square root, rounded as the 8087's FSQRT is. */
export function sqrtReal(value: Real, line = -1): Real {
  const { negative, n, e: exponent } = exact(value);
  if (n === 0n) return 0;
  if (negative) throw new PascalError('Invalid floating point operation', line);
  let m = n,
    e = exponent;
  if (e % 2 !== 0) {
    m <<= 1n;
    e -= 1;
  }
  // Enough bits for a 67-bit root, then the remainder decides the rounding.
  const extra = Math.max(0, 134 - bitLength(m));
  const shift = extra + (extra % 2);
  m <<= BigInt(shift);
  // Newton's method from above lands on the root's floor; a double's root,
  // nudged up, starts it within a few steps.
  const estimate = Math.sqrt(Number(m)) * (1 + 2 ** -40);
  let root = Number.isFinite(estimate)
    ? BigInt(Math.ceil(estimate)) + 1n
    : 1n << BigInt(Math.ceil(bitLength(m) / 2));
  for (;;) {
    const next = (root + m / root) >> 1n;
    if (next >= root) break;
    root = next;
  }
  const sticky = root * root === m ? 0n : 1n;
  return roundExtended(false, root * 2n + sticky, 2n, (e - shift) / 2, line);
}

/** A Comp: the value rounded to a whole number, an exact half to even, which
 * must fit 64 bits. */
export function compReal(value: Real, line = -1): Real {
  const { negative, n, e } = exact(value);
  let whole: bigint;
  if (e >= 0) whole = n << BigInt(e);
  else {
    const shift = BigInt(-e);
    whole = n >> shift;
    const rest = n - (whole << shift),
      half = 1n << (shift - 1n);
    if (rest > half || (rest === half && (whole & 1n) === 1n)) whole += 1n;
  }
  if (whole >= TWO63) throw new PascalError('Invalid numeric result', line);
  if (whole === 0n) return 0;
  return toReal(negative ? -whole : whole);
}

/** Every digit of a positive value: value = 0.d1d2… × 10^(exponent + 1),
 * that is d1.d2… × 10^exponent. */
export function realDigits(value: Real): { digits: string; exponent: number } {
  const { n, e } = exact(value);
  // n × 2^-k is n × 5^k / 10^k, so the integer n × 5^k holds every digit.
  const integer = e >= 0 ? n << BigInt(e) : n * 5n ** BigInt(-e);
  const text = integer.toString();
  return { digits: text.replace(/0+$/, ''), exponent: text.length - 1 - Math.max(0, -e) };
}

/** Decimal text, as a Pascal literal, Val or Read gives it, to the nearest
 * Extended value. Undefined when it is not a number. */
export function parseReal(text: string, line = -1): Real | undefined {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(text);
  if (!match || !(match[2] || match[3])) return undefined;
  const [, sign, whole = '', fraction = '', power = '0'] = match;
  const digits = BigInt((whole + fraction).replace(/^0+(?=\d)/, '') || '0');
  const exponent = Number(power) - fraction.length;
  const negative = sign === '-';
  if (digits === 0n) return 0;
  if (exponent > 5000) throw new PascalError('Real overflow', line);
  if (exponent < -5000) return 0;
  return exponent >= 0
    ? roundExtended(negative, digits * 10n ** BigInt(exponent), 1n, 0, line)
    : roundExtended(negative, digits, 10n ** BigInt(-exponent), 0, line);
}

/** The ten bytes of an Extended: the 64-bit significand, then the sign and
 * the exponent biased by 16383. */
export function encodeExtended(value: Real): Uint8Array {
  const bytes = new Uint8Array(10);
  const { negative, n, e } = exact(value);
  if (n !== 0n) {
    const length = bitLength(n);
    const significand = length > 64 ? n >> BigInt(length - 64) : n << BigInt(64 - length);
    const biased = e + length - 1 + 16383;
    for (let i = 0; i < 8; i++) bytes[i] = Number((significand >> BigInt(i * 8)) & 0xffn);
    bytes[8] = biased & 0xff;
    bytes[9] = ((biased >> 8) & 0x7f) | (negative ? 0x80 : 0);
  } else if (negative) bytes[9] = 0x80;
  return bytes;
}
export function decodeExtended(bytes: Uint8Array): Real {
  let significand = 0n;
  for (let i = 7; i >= 0; i--) significand = (significand << 8n) | BigInt(bytes[i] ?? 0);
  const high = bytes[9] ?? 0,
    biased = (bytes[8] ?? 0) | ((high & 0x7f) << 8);
  if (significand === 0n) return 0;
  return roundExtended((high & 0x80) !== 0, significand, 1n, biased - 16383 - 63);
}

/** A Comp's eight bytes: a two's complement integer. */
export function encodeComp(value: Real): Uint8Array {
  let bits = BigInt.asUintN(64, truncReal(value));
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return bytes;
}
export function decodeComp(bytes: Uint8Array): Real {
  let bits = 0n;
  for (let i = 7; i >= 0; i--) bits = (bits << 8n) | BigInt(bytes[i] ?? 0);
  return toReal(BigInt.asIntN(64, bits));
}
