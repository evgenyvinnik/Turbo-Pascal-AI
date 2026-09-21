import { Compiler } from './codegen/Compiler';
import { Lexer, Stream } from './lexer';
import { Parser, type ParserOptions } from './parser';
import { PascalError } from './errors';
import { preprocessPascal, restoreSourceLocations, type PascalSource, type PreprocessedSource } from './directives';
import { NodeType, type ProgramNode, type UnitNode } from './parser/Node';

export interface ProjectOptions extends ParserOptions {
  /** Snapshot of source buffers and the virtual disk. Buffers take precedence. */
  sources?: Readonly<Record<string, string>>;
  defines?: readonly string[];
  includeDirectories?: readonly string[];
  unitDirectories?: readonly string[];
}

export class NativePascalRequired extends Error {
  constructor(readonly filename: string) { super('Inline assembly requires the native DOS compiler'); }
}

export function sourcePath(name: string): string {
  const parts: string[] = [];
  for (const part of name.replace(/^[A-Z]:/i, '').replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part.toUpperCase());
  }
  return parts.join('/');
}

/** Resolves an immutable workspace snapshot; compilation never fetches network files. */
export function parseProject(source: string, filename: string, options: ProjectOptions = {}) {
  const files = new Map(Object.entries(options.sources ?? {}).map(([name, text]) => [sourcePath(name), text]));
  files.set(sourcePath(filename), source);
  const sources: Record<string, string> = { [filename]: source };
  const sourceDirectory = sourcePath(filename).split('/').slice(0, -1).join('/');
  function resolve(name: string, from: string, directories: readonly string[] = []): PascalSource | undefined {
    const parent = sourcePath(from).split('/').slice(0, -1).join('/');
    const absolute = /^(?:[A-Z]:|[\\/])/i.test(name);
    const candidates = absolute ? [name] : [parent + '/' + name, name, ...directories.map(dir => dir + '/' + name)];
    for (const candidate of candidates) {
      const key = sourcePath(candidate), text = files.get(key);
      if (text !== undefined) { sources[key] = text; return { filename: key, source: text }; }
    }
    return undefined;
  }
  function parse(file: PascalSource, unit?: boolean): ProgramNode | UnitNode {
    const prepared = preprocessPascal(file.source, {
      filename: file.filename, switches: options, ...(options.defines ? { defines: options.defines } : {}),
      resolveInclude: (name, from) => resolve(name, from, options.includeDirectories),
    });
    try {
      const scan = new Lexer(new Stream(prepared.source));
      for (let token = scan.next(); !token.isEof(); token = scan.next()) {
        if (token.isReservedWord('asm') || token.isReservedWord('inline')) throw new NativePascalRequired(file.filename);
      }
      const parser = new Parser(new Lexer(new Stream(prepared.source)), options);
      const isUnit = unit ?? new Lexer(new Stream(prepared.source)).next().isReservedWord('unit');
      const ast = isUnit ? parser.parseUnit() : parser.parse();
      restoreSourceLocations(ast, prepared);
      return ast;
    } catch (error) {
      remapDiagnostic(error, prepared);
      throw error;
    }
  }
  const tree = parse({ filename, source });
  // A program without a heading is named after its file, as Free Pascal names it.
  if (tree.type === NodeType.PROGRAM && !tree.name) tree.name = sourcePath(filename).split('/').at(-1)?.replace(/\.[^.]*$/, '') ?? '';
  const units = new Map<string, UnitNode>();
  return {
    tree,
    sources,
    resolveUnit: (name: string): UnitNode | undefined => {
      const key = name.toUpperCase();
      const previous = units.get(key);
      if (previous) return previous;
      const file = resolve(name + '.PAS', sourceDirectory + '/_', options.unitDirectories);
      if (!file) return undefined;
      const unit = parse(file, true) as UnitNode;
      units.set(key, unit);
      return unit;
    },
  };
}

function remapDiagnostic(error: unknown, prepared: PreprocessedSource): void {
  if (!(error instanceof PascalError) || 'sourceFile' in error) return;
  const location = prepared.locations[error.lineNumber];
  if (location) Object.assign(error, { lineNumber: location.line, sourceFile: location.filename });
}

export function compileProject(source: string, filename: string, options: ProjectOptions = {}) {
  const project = parseProject(source, filename, options);
  const bytecode = new Compiler().compile(project.tree, { resolveUnit: project.resolveUnit });
  bytecode.sources = project.sources;
  return { tree: project.tree, bytecode };
}
