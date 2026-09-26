import { bytesToString, type DosFiles } from './dosFiles';

/** Original examples; the listed opcodes execute in DOSBox, not in the Pascal VM. */
export const DOS_EXAMPLES: DosFiles = {
  'HELLO.COM': bytesToString(
    new Uint8Array([
      0xba,
      0x0c,
      0x01, // mov dx,010c
      0xb4,
      0x09, // mov ah,09
      0xcd,
      0x21, // int 21 (DOS writes the $-terminated string)
      0xb8,
      0x00,
      0x4c, // mov ax,4c00
      0xcd,
      0x21, // int 21 (exit)
      ...Array.from('Hello from real x86 DOS code!\r\n$', (c) => c.charCodeAt(0)),
    ])
  ),
  'HELLO.ASM':
    'org 100h\r\nmov dx,message\r\nmov ah,9\r\nint 21h\r\nmov ax,4c00h\r\nint 21h\r\nmessage db "Hello from real x86 DOS code!",13,10,"$"\r\n',
  'X86TEST.SCR': [
    'n REGTEST.COM',
    'a 100',
    'mov ax,1234',
    'mov bx,0002',
    'add ax,bx',
    'push ax',
    'pop dx',
    'mov ax,4c00',
    'int 21',
    '',
    'r cx',
    'f',
    'w',
    'u 100 10e',
    't 5',
    'r',
    'q',
    '',
  ].join('\r\n'),
};
