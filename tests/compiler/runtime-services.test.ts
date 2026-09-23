import { describe, expect, it, vi } from 'vitest';
import { GraphicsRuntime } from '../../src/compiler/runtime/GraphicsRuntime';
import { TextConsole } from '../../src/compiler/runtime/TextConsole';
import { VirtualFileSystem } from '../../src/compiler/runtime/VirtualFileSystem';
import { RuntimeServices } from '../../src/compiler/runtime/RuntimeServices';
import { TypeCode } from '../../src/compiler/types/inst';
import type { StackValue } from '../../src/compiler/runtime/Machine';

function services() {
  const memory = new Map<number, StackValue>();
  const disk = new VirtualFileSystem();
  const sound = vi.fn();
  const runtime = new RuntimeServices({
    read: (address) => memory.get(address) ?? 0,
    write: (address, value) => { memory.set(address, value); },
    allocate: () => 1000,
    heapAvailable: () => ({ total: 0, largest: 0 }),
    stackPointer: () => 0,
    heapTop: () => 0,
    releaseHeap: () => undefined,
    free: () => undefined,
    sound,
  }, disk);
  return { runtime, memory, disk, sound };
}

describe('CRT video memory', () => {
  it('positions and overwrites text with the selected attributes', () => {
    const console = new TextConsole();
    console.attribute = 0x1e;
    console.goto(3, 2);
    console.write('Pascal');
    expect(console.chars.slice(82, 88).join('')).toBe('Pascal');
    expect(console.attributes[82]).toBe(0x1e);
    console.goto(5, 2);
    console.clearEol();
    expect(console.chars.slice(82, 88).join('')).toBe('Pa    ');
    expect([console.x, console.y]).toEqual([5, 2]);
  });
  it('scrolls only the selected window', () => {
    const console = new TextConsole();
    console.write('outside');
    console.window(10, 10, 14, 11);
    console.write('one\ntwo\n');
    expect(console.chars.slice(9 * 80 + 9, 9 * 80 + 14).join('')).toBe('two  ');
    expect(console.chars.slice(0, 7).join('')).toBe('outside');
  });
});

describe('BGI framebuffer', () => {
  it('draws exact endpoint pixels and fills enclosed regions', () => {
    const graph = new GraphicsRuntime();
    graph.init(0, 0);
    graph.color = 4;
    graph.rectangle(10, 10, 20, 20);
    graph.fillColor = 2;
    graph.flood(15, 15, 4);
    expect([graph.getPixel(10, 10), graph.getPixel(20, 20), graph.getPixel(15, 15), graph.getPixel(9, 9)]).toEqual([4, 4, 2, 0]);
    expect([graph.width, graph.height]).toEqual([640, 480]);
  });
  it('uses viewport-relative coordinates and clips drawing', () => {
    const graph = new GraphicsRuntime();
    graph.init(9, 0);
    graph.view(20, 30, 40, 50, true);
    graph.pixel(0, 0, 12);
    graph.pixel(-1, 0, 4);
    expect(graph.pixels[30 * 640 + 20]).toBe(12);
    expect(graph.pixels[30 * 640 + 19]).toBe(0);
    expect(graph.getPixel(0, 0)).toBe(12);
  });
  it('draws text without depending on browser font rendering', () => {
    const graph = new GraphicsRuntime();
    graph.init(9, 2);
    graph.text('Turbo', 4, 5);
    expect(graph.pixels.some((pixel) => pixel === 15)).toBe(true);
    expect(graph.textWidth('Turbo')).toBe(40);
  });
});

describe('stateful runtime services', () => {
  it('mutates strings through addresses and preserves values after an invalid Val', () => {
    const { runtime, memory } = services();
    memory.set(10, 'Pascal');
    runtime.invoke(34, [10, 4, 3]);
    runtime.invoke(35, ['sing', 10, 4, 6]);
    expect(memory.get(10)).toBe('Passin');
    runtime.invoke(36, [' 3.14', 10, 255]);
    expect(memory.get(10)).toBe(' 3.14');
    runtime.invoke(37, ['42', 20, 21, TypeCode.I, -32768, 32767]);
    expect([memory.get(20), memory.get(21)]).toEqual([42, 0]);
    runtime.invoke(37, ['12x', 20, 21, TypeCode.I, -32768, 32767]);
    expect([memory.get(20), memory.get(21)]).toEqual([42, 3]);
  });
  it('writes, closes, reopens and reads a text file on the virtual drive', () => {
    const { runtime, memory, disk } = services();
    runtime.invoke(46, [10, 'C:\\TEST.TXT', 0]);
    runtime.invoke(48, [10]);
    runtime.invoke(71, [10, '42 2.5']);
    runtime.invoke(71, [10, 'Pascal']);
    runtime.invoke(50, [10]);
    expect(disk.read('test.txt')).toBe('42 2.5\r\nPascal\r\n');
    runtime.invoke(47, [10]);
    runtime.invoke(73, [10, 20, TypeCode.I, 21, TypeCode.R]);
    runtime.invoke(73, [10, 22, TypeCode.S]);
    expect([memory.get(20), memory.get(21), memory.get(22)]).toEqual([42, 2.5, 'Pascal']);
    expect(runtime.invoke(25, [10])?.result).toBe(1);
  });
  it('seeks and reads typed records without formatting away their values', () => {
    const { runtime, memory } = services();
    runtime.invoke(46, [10, 'values.dat', 2, JSON.stringify([{ kind: 'integer', bytes: 2, signed: true }, { kind: 'string', bytes: 6 }])]);
    runtime.invoke(48, [10]);
    runtime.invoke(78, [10, 7, 'seven']);
    runtime.invoke(78, [10, 9, 'nine']);
    runtime.invoke(50, [10]);
    runtime.invoke(47, [10]);
    runtime.invoke(68, [10, 1]);
    runtime.invoke(79, [10, 30, 2]);
    expect([memory.get(30), memory.get(31)]).toEqual([9, 'nine']);
    expect(runtime.invoke(67, [10])?.result).toBe(2);
    expect(runtime.files.disk.read('values.dat').length).toBe(16);
  });
  it('uses virtual DOS state and exposes sound and delay to the host', () => {
    const { runtime, memory, sound } = services();
    runtime.invoke(302, [1992, 11, 1]);
    runtime.invoke(300, [10, 11, 12, 13]);
    expect([memory.get(10), memory.get(11), memory.get(12)]).toEqual([1992, 11, 1]);
    runtime.invoke(302, [1992, 2, 30]);
    runtime.invoke(300, [10, 11, 12, 13]);
    expect([memory.get(10), memory.get(11), memory.get(12)]).toEqual([1992, 11, 1]);
    runtime.invoke(130, [440]);
    runtime.invoke(131, []);
    expect(sound.mock.calls).toEqual([[440], [0]]);
    expect(runtime.invoke(132, [250])).toEqual({ delay: 250 });
  });
});
