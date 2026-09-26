import { PascalError } from '../errors/PascalError';
import { Float80, absReal, compReal, realDigits, type Real } from './float80';

/**
 * Borland Turbo Pascal 7 Language Guide, pp. 25, 69 and 219:
 * https://turbopascal.nl/docs/Turbo_Pascal_Version_7.0_Language_Guide_1992.pdf
 * Real has 40 significant binary digits and exponent -128 through 126.
 * It has neither subnormals nor non-finite values. Round the magnitude before
 * restoring its sign, just as the six-byte file representation does.
 */
export function roundReal48(value: number, line = -1): number {
  if (!Number.isFinite(value)) throw new PascalError('Real overflow', line);
  const { significand, exponent } = realParts(value);
  return roundRational(significand, 1n, exponent, line);
}

function realParts(value: number): { significand: bigint; exponent: number } {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0);
  const encodedExponent = Number((bits >> 52n) & 2047n);
  const magnitude = (bits & ((1n << 52n) - 1n)) | (encodedExponent ? 1n << 52n : 0n);
  return {
    significand: bits >> 63n ? -magnitude : magnitude,
    exponent: encodedExponent ? encodedExponent - 1075 : -1074,
  };
}

/** Round once from an exact rational; a JS double intermediate can round twice. */
function roundRational(
  numerator: bigint,
  denominator: bigint,
  scale: number,
  line: number
): number {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let ratioExponent = n.toString(2).length - d.toString(2).length;
  if (ratioExponent >= 0 ? n < d << BigInt(ratioExponent) : n << BigInt(-ratioExponent) < d)
    ratioExponent--;
  let exponent = ratioExponent + scale;
  if (exponent < -128) return 0;
  const shift = 39 - ratioExponent;
  const scaledNumerator = shift >= 0 ? n << BigInt(shift) : n;
  const scaledDenominator = shift < 0 ? d << BigInt(-shift) : d;
  let significand = scaledNumerator / scaledDenominator;
  if ((scaledNumerator % scaledDenominator) * 2n >= scaledDenominator) significand++;
  if (significand >= 1n << 40n) {
    significand >>= 1n;
    exponent++;
  }
  if (exponent > 126) throw new PascalError('Real overflow', line);
  return (negative ? -1 : 1) * Number(significand) * 2 ** (exponent - 39);
}

export interface IntegerFormat {
  bits: number;
  signed: boolean;
}

/** BigInt preserves the low product bits even for two full-width LongInts. */
export function integerOperation(
  operator: string,
  a: number,
  b: number,
  format: IntegerFormat,
  checked = false,
  line = -1
): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))
    throw new PascalError('Invalid integer operand', line);
  const left = BigInt(a),
    right = BigInt(b);
  if ((operator === 'div' || operator === 'mod') && right === 0n)
    throw new PascalError('Division by zero', line);
  let result: bigint;
  switch (operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '*':
      result = left * right;
      break;
    case 'div':
      result = left / right;
      break;
    case 'mod':
      result = left % right;
      break;
    case 'and':
      result = left & right;
      break;
    case 'or':
      result = left | right;
      break;
    case 'xor':
      result = left ^ right;
      break;
    case 'not':
      result = ~left;
      break;
    // The 8086 uses CL for shift counts and SHR shifts in zero bits.
    case 'shl':
      result = BigInt.asUintN(format.bits, left) << BigInt(b & 255);
      break;
    case 'shr':
      result = BigInt.asUintN(format.bits, left) >> BigInt(b & 255);
      break;
    default:
      throw new PascalError(`Invalid integer operator ${operator}`, line);
  }
  const wrapped = format.signed
    ? BigInt.asIntN(format.bits, result)
    : BigInt.asUintN(format.bits, result);
  if ((checked && ['+', '-', '*'].includes(operator)) || operator === 'div') {
    if (wrapped !== result) throw new PascalError('Arithmetic overflow', line);
  }
  return Number(wrapped);
}

/** Arithmetic on the 8087 types (Single, Double, Extended), which Turbo
 * Pascal computes on the coprocessor at full precision rather than in the
 * 48-bit software arithmetic it uses for Real. */
export function coprocessorOperation(operator: string, a: number, b: number, line = -1): number {
  if (operator === '/' && b === 0) throw new PascalError('Division by zero', line);
  const result = operator === '+' ? a + b : operator === '-' ? a - b : operator === '*' ? a * b : a / b;
  if (!Number.isFinite(result)) throw new PascalError('Real overflow', line);
  return result;
}

/** A value as the 8087 holds it: a double where one holds it exactly, and
 * otherwise Extended's 64 bits. */
export function coprocessorValue(value: Real, line = -1): Real {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new PascalError('Real overflow', line);
  return value;
}

export function realOperation(operator: string, a: number, b: number, line = -1): number {
  if (operator === '/' && b === 0) throw new PascalError('Division by zero', line);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new PascalError('Real overflow', line);
  const left = realParts(a),
    right = realParts(b);
  if (operator === '*')
    return roundRational(
      left.significand * right.significand,
      1n,
      left.exponent + right.exponent,
      line
    );
  if (operator === '/')
    return roundRational(left.significand, right.significand, left.exponent - right.exponent, line);
  const scale = Math.min(left.exponent, right.exponent);
  const first = left.significand << BigInt(left.exponent - scale);
  const second = right.significand << BigInt(right.exponent - scale);
  return roundRational(operator === '+' ? first + second : first - second, 1n, scale, line);
}

/** A value stored in a Comp: the 8087 rounds it to the nearest integer, an
 * exact half to even, and faults on one outside 64 bits. */
export function compValue(value: Real, line = -1): Real {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new PascalError('Invalid numeric result', line);
  return compReal(value, line);
}

/** Adds one unit in the last place of a digit string; '' means the carry
 * passed the first digit. */
function incrementDigits(digits: string): string {
  const kept = digits.replace(/9+$/, '');
  if (!kept) return '';
  return kept.slice(0, -1) + String(Number(kept.at(-1)) + 1);
}

/** The width Write uses for a real value when none is given. */
export const defaultRealWidth = (coprocessor: boolean) => (coprocessor ? 23 : 17);

/**
 * A real value as Write, WriteLn and Str show it. A negative number of
 * decimals, or none, gives floating-point form: ' 1.5000000000E+00'.
 *
 * Real follows Turbo Pascal 7's software routine: at most eleven digits are
 * kept, the next one rounds half up, and digits beyond those kept are zeros.
 * The field width sets how many significant digits floating-point form
 * shows (width - 6, at least two). The 8087 routine ({$N+}) has a four-digit
 * exponent and up to eighteen digits, so its default width of 23 shows
 * fifteen.
 */
export function formatReal(
  value: Real,
  width: number,
  decimals: number,
  coprocessor: boolean
): string {
  const negative = value instanceof Float80 ? value.negative : value < 0;
  const maximum = coprocessor ? 18 : 11;
  const exponentDigits = coprocessor ? 4 : 2;
  const fixed = decimals >= 0;
  const places = fixed
    ? Math.min(decimals, maximum)
    : Math.min(maximum, Math.max(2, width - exponentDigits - 4));
  let { digits, exponent } =
    value === 0 ? { digits: '', exponent: 0 } : realDigits(absReal(value));
  let kept = fixed ? places + exponent + 1 : places;
  if (kept < 0) digits = '';
  else {
    kept = Math.min(kept, maximum);
    const roundUp = (digits[kept] ?? '0') >= '5';
    digits = digits.slice(0, kept);
    if (roundUp) {
      digits = incrementDigits(digits);
      if (!digits) [digits, exponent] = ['1', exponent + 1];
    }
  }
  const digit = (position: number) => (position >= 0 ? (digits[position] ?? '0') : '0');
  let text: string;
  if (fixed) {
    text = negative ? '-' : '';
    if (exponent < 0) text += '0';
    else for (let position = 0; position <= exponent; position++) text += digit(position);
    if (places > 0) {
      text += '.';
      for (let place = 1; place <= places; place++) text += digit(exponent + place);
    }
  } else {
    text = (negative ? '-' : ' ') + digit(0) + '.';
    for (let position = 1; position < places; position++) text += digit(position);
    text += `E${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(exponentDigits, '0')}`;
  }
  return text.padStart(width, ' ');
}
