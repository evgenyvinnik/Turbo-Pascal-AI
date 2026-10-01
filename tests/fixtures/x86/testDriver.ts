import { PROGRAMS } from './programs';

/** TESTBGI.BGI: the test driver's code (testbgi.asm) behind a BGI 2.0
 * header, under the name `name`. */
export function testDriver(name = 'TESTBGI'): Uint8Array {
  const code = Uint8Array.from(PROGRAMS.testbgi?.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16)
  );
  const bytes = new Uint8Array(0xa0 + code.length);
  const intro = `pk\x08\x08BGI Device Driver (${name}) test\r\n\x00\x1a`;
  bytes.set(Array.from(intro, (char) => char.charCodeAt(0)));
  const fields = [0xa0, 0, 0, 0, code.length & 0xff, code.length >> 8, 2, 0, 1, 0];
  bytes.set(fields, intro.length);
  bytes.set(fields, 0x80);
  bytes.set([name.length, ...Array.from(name, (char) => char.charCodeAt(0))], 0x8a);
  bytes.set(code, 0xa0);
  return bytes;
}
