import { PascalError } from './errors/PascalError';
import type { Node } from './parser/Node';

export interface CompilerSwitches {
  completeBooleanEvaluation: boolean;
  rangeChecking: boolean;
  strictVarStrings: boolean;
  openStrings: boolean;
  ioChecking: boolean;
  overflowChecking: boolean;
  farCalls: boolean;
  /** $N: 8087 code, which computes every real expression in Extended. */
  numericProcessing: boolean;
  /** $X: extended syntax, under which a function can be called as a statement. */
  extendedSyntax: boolean;
  /** $T: @ gives a pointer to its operand's type rather than an untyped one. */
  typedPointers: boolean;
  /** $A: variables and typed constants larger than a byte start on an even
   * address. */
  alignData: boolean;
}

export const DEFAULT_SWITCHES: Readonly<CompilerSwitches> = Object.freeze({
  completeBooleanEvaluation: false, rangeChecking: false, strictVarStrings: true,
  openStrings: false, ioChecking: true, overflowChecking: false, farCalls: false,
  numericProcessing: false, extendedSyntax: true, typedPointers: false, alignData: true,
});

const switchNames: Record<string, keyof CompilerSwitches> = {
  B: 'completeBooleanEvaluation', R: 'rangeChecking', V: 'strictVarStrings',
  P: 'openStrings', I: 'ioChecking', Q: 'overflowChecking', F: 'farCalls',
  N: 'numericProcessing', X: 'extendedSyntax', T: 'typedPointers', A: 'alignData',
};

/** Apply a switch list such as $B+,R-,I+; include filenames are not switches. */
export function applyCompilerSwitches(comment: string, switches: CompilerSwitches): boolean {
  const text = comment.trim().replace(/^\$/, '');
  if (!/^[A-Z]\s*[+-](?:\s*,\s*[A-Z]\s*[+-])*\s*$/i.test(text)) return false;
  for (const option of text.split(',')) {
    const match = /^\s*([A-Z])\s*([+-])\s*$/i.exec(option)!;
    const key = switchNames[match[1]!.toUpperCase()];
    if (key) switches[key] = match[2] === '+';
  }
  return true;
}

export interface PascalSource { filename: string; source: string }
export interface SourceLocation { filename: string; line: number }
export interface PreprocessedSource {
  source: string;
  /** One-based expanded source line to original source file and line. */
  locations: SourceLocation[];
}
export interface PreprocessorOptions {
  filename?: string;
  defines?: readonly string[];
  switches?: Partial<CompilerSwitches>;
  resolveInclude?: (name: string, fromFile: string) => PascalSource | undefined;
}

/** Conditional compilation and includes, before Pascal tokenization. */
export function preprocessPascal(source: string, options: PreprocessorOptions = {}): PreprocessedSource {
  const switches = { ...DEFAULT_SWITCHES, ...options.switches };
  const defines = new Set(['VER70', 'MSDOS', ...(options.defines ?? [])].map(name => name.toUpperCase()));
  const frames: Array<{ parent: boolean; condition: boolean; alternate: boolean }> = [];
  const includeStack: string[] = [];
  const locations: SourceLocation[] = [];
  let output = '', active = true, expandedLine = 1;
  function fail(message: string, file: string, line: number): never {
    const error = new PascalError(message, line);
    Object.assign(error, { sourceFile: file });
    throw error;
  }
  function append(text: string, file: string, line: number) {
    for (const char of text) {
      locations[expandedLine] ??= { filename: file, line };
      output += char;
      if (char === '\n') { expandedLine++; line++; }
    }
  }
  const blank = (text: string) => text.replace(/[^\r\n]/g, ' ');
  function process(text: string, file: string) {
    if (includeStack.length >= 16) fail('Too many nested include files', file, 1);
    const key = file.replace(/\\/g, '/').toUpperCase();
    if (includeStack.includes(key)) fail(`Circular include file: ${file}`, file, 1);
    includeStack.push(key);
    const initialDepth = frames.length;
    let i = 0, line = 1;
    while (i < text.length) {
      const start = i, startLine = line;
      const brace = text[i] === '{', paren = text.slice(i, i + 2) === '(*';
      if (brace || paren) {
        const closing = brace ? '}' : '*)';
        const end = text.indexOf(closing, i + (brace ? 1 : 2));
        if (end < 0) fail('Unexpected end of file in comment', file, line);
        i = end + closing.length;
        const raw = text.slice(start, i);
        line += (raw.match(/\n/g) ?? []).length;
        const body = raw.slice(brace ? 1 : 2, -closing.length).trim();
        const directive = /^\$(IFDEF|IFNDEF|IFOPT|ELSE|ENDIF|DEFINE|UNDEF|INCLUDE|I)\b\s*(.*?)\s*$/is.exec(body);
        if (directive && !/^\$I\s*[+-]/i.test(body)) {
          const command = directive[1]!.toUpperCase(), value = directive[2]!.trim();
          if (['IFDEF', 'IFNDEF', 'IFOPT'].includes(command)) {
            if (frames.length >= 64) fail('Too many nested conditional directives', file, startLine);
            let condition: boolean;
            if (command === 'IFOPT') {
              const match = /^([A-Z])\s*([+-])$/i.exec(value);
              if (!match || !switchNames[match[1]!.toUpperCase()])
                fail(`Invalid compiler switch in IFOPT: ${value}`, file, startLine);
              condition = switches[switchNames[match[1]!.toUpperCase()]!] === (match[2] === '+');
            } else {
              if (!/^[A-Z_]\w*$/i.test(value)) fail('Conditional symbol expected', file, startLine);
              condition = defines.has(value.toUpperCase()) === (command === 'IFDEF');
            }
            frames.push({ parent: active, condition, alternate: false });
            active = active && condition;
          } else if (command === 'ELSE') {
            const frame = frames.at(-1);
            if (!frame || frames.length <= initialDepth || frame.alternate)
              fail('Unexpected ELSE directive', file, startLine);
            frame.alternate = true;
            active = frame.parent && !frame.condition;
          } else if (command === 'ENDIF') {
            if (frames.length <= initialDepth) fail('Unexpected ENDIF directive', file, startLine);
            active = frames.pop()!.parent;
          } else if (active && ['DEFINE', 'UNDEF'].includes(command)) {
            if (!/^[A-Z_]\w*$/i.test(value)) fail('Conditional symbol expected', file, startLine);
            if (command === 'DEFINE') defines.add(value.toUpperCase()); else defines.delete(value.toUpperCase());
          } else if (active && (command === 'I' || command === 'INCLUDE')) {
            const name = value.replace(/^(['"])(.*)\1$/, '$2');
            const included = options.resolveInclude?.(name, file);
            if (!included) fail(`Include file not found: ${name}`, file, startLine);
            // Line boundaries make diagnostics unambiguous for inline includes too.
            append('\n', file, startLine);
            process(included.source, included.filename);
            append('\n', included.filename, included.source.split('\n').length);
          }
          append(blank(raw), file, startLine);
        } else {
          if (active && body.startsWith('$')) applyCompilerSwitches(body, switches);
          append(active ? raw : blank(raw), file, startLine);
        }
        continue;
      }
      if (active && text[i] === "'") {
        i++;
        while (i < text.length) {
          if (text[i++] === "'") {
            if (text[i] !== "'") break;
            i++;
          }
        }
      } else {
        i++;
        while (i < text.length && text[i] !== '{' && text.slice(i, i + 2) !== '(*' && (!active || text[i] !== "'")) i++;
      }
      const chunk = text.slice(start, i);
      append(active ? chunk : blank(chunk), file, startLine);
      line += (chunk.match(/\n/g) ?? []).length;
    }
    if (frames.length !== initialDepth) fail('ENDIF directive expected', file, line);
    includeStack.pop();
  }
  process(source, options.filename ?? 'NONAME00.PAS');
  return { source: output, locations };
}

/** Restore original coordinates once, immediately after parsing expanded text. */
export function restoreSourceLocations(root: Node, source: PreprocessedSource): void {
  const visited = new Set<object>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as Node;
    if (typeof node.type === 'string' && typeof node.lineNumber === 'number') {
      const location = source.locations[node.lineNumber];
      if (location) { node.lineNumber = location.line; node.sourceFile = location.filename; }
      for (const field of ['beginLineNumber', 'endLineNumber']) {
        if (typeof node[field] === 'number') node[field] = source.locations[node[field]]?.line ?? node[field];
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
  }
  visit(root);
}
