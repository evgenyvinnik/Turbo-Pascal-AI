import { PascalError } from '../errors/PascalError';

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
