import { bufferText, useDesktopStore } from '../../stores/desktopStore';
import { useIdeStore } from '../../stores/ideStore';
import { programDisk } from '../../components/IDE/programFiles';
import { dosPath, type DosFiles } from './dosFiles';
import { closeDosSession, openDosSession, useDosStore } from './dosSession';

export function nativePascalBatch(
  path: string,
  run: boolean,
  parameters = '',
  isUnit = false
): string {
  const source = dosPath(path).replaceAll('/', '\\');
  if (!/\.(pas|pp)$/i.test(source))
    throw new Error('Save the source with a .PAS or .PP extension first.');
  const name = source
    .split('\\')
    .at(-1)!
    .replace(/\.(pas|pp)$/i, '');
  if (name.length > 8) throw new Error('Native DOS compilation requires an 8.3 source filename.');
  return [
    '@echo off',
    'echo Free Pascal 3.2.2 - native 32-bit DOS / Turbo Pascal language mode',
    `D:\\PPC386.EXE @D:\\NATIVE.CFG "D:\\SOURCE\\${source}"`,
    'if errorlevel 1 goto failed',
    ...(!isUnit ? [`echo ${name}.EXE>D:\\BUILD.OK`] : []),
    ...(run ? [`"${name}.EXE" ${parameters}`.trim()] : ['echo Compilation completed.']),
    'goto end',
    ':failed',
    'echo Compilation failed. The program was not run.',
    ':end',
    '',
  ].join('\r\n');
}

/** Compile actual Pascal into a DOS executable using the independent FPC binary. */
export async function openNativePascalSession(run = true): Promise<void> {
  const buffer = useDesktopStore.getState().activeBuffer();
  if (!buffer) throw new Error('Open a Pascal source file before using native DOS compilation.');
  const settings = useIdeStore.getState();
  if (/[\r\n\0]/.test(settings.programParameters))
    throw new Error('Program parameters must be a single line.');
  const sources = { ...programDisk.snapshot() };
  for (const source of Object.values(useDesktopStore.getState().buffers))
    sources[dosPath(source.path)] = bufferText(source);
  // An include wrapper applies IDE defaults without changing the source file or
  // its diagnostic line numbers. Each unit gets the same initial switch state.
  const switches: Array<[string, boolean]> = [
    ['I', settings.compilerOptions.runtime?.[2] ?? true],
    ['Q', settings.compilerOptions.runtime?.[3] ?? false],
    ['R', settings.compilerOptions.runtime?.[0] ?? false],
    ['B', settings.compilerOptions.syntax?.[1] ?? false],
    ['V', settings.compilerOptions.syntax?.[0] ?? true],
    ['P', settings.compilerOptions.syntax?.[4] ?? false],
  ];
  const defaults = switches.map(([key, enabled]) => `{$${key}${enabled ? '+' : '-'}}`).join('');
  const toolFiles: DosFiles = {};
  const sourceDirs = new Set<string>(['D:\\SOURCE', 'C:\\']);
  const mainDirectory = dosPath(buffer.path).split('/').slice(0, -1).join('\\');
  if (mainDirectory) sourceDirs.add(`D:\\SOURCE\\${mainDirectory}`);
  for (const path of Object.keys(sources)) {
    if (!/\.(pas|pp)$/i.test(path)) continue;
    const normalized = dosPath(path);
    toolFiles[`SOURCE/${normalized}`] = `${defaults}{$I "C:\\${normalized.replaceAll('/', '\\')}"}`;
  }
  const dirs = settings.optionDialogs['options.directories'];
  const config = ['-n', '-Mtp', '-Rintel', '-FuD:\\RTL', '-FDD:\\', '-FE.', '-FU.'];
  for (const [key, flag] of [
    ['I', '-Ci'],
    ['Q', '-Co'],
    ['R', '-Cr'],
  ] as const)
    config.push(`${flag}${switches.find(([name]) => name === key)?.[1] ? '+' : '-'}`);
  for (const dir of sourceDirs) config.push(`-Fu"${dir}"`);
  for (const [field, flag] of [
    ['unit', '-Fu'],
    ['include', '-Fi'],
    ['object', '-Fo'],
  ] as const) {
    for (const value of String(dirs?.[field] ?? '')
      .split(';')
      .filter(Boolean)) {
      const path = dosPath(value).replaceAll('/', '\\');
      if (field === 'unit') config.push(`-Fu"D:\\SOURCE\\${path}"`);
      config.push(`${flag}"C:\\${path}"`);
    }
  }
  for (const define of settings.defines.split(/[;,\s]+/).filter(Boolean)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(define))
      throw new Error(`Invalid conditional define: ${define}`);
    config.push(`-d${define}`);
  }
  toolFiles['NATIVE.CFG'] = config.join('\r\n') + '\r\n';
  const sourceIsUnit = /^\s*(?:(?:\{[\s\S]*?\}|\(\*[\s\S]*?\*\))\s*)*unit\b/i.test(
    bufferText(buffer)
  );
  toolFiles['NATIVE.BAT'] = nativePascalBatch(
    buffer.path,
    run && !sourceIsUnit,
    settings.programParameters,
    sourceIsUnit
  );
  if (useDosStore.getState().visible) {
    await closeDosSession();
    if (useDosStore.getState().visible) return;
  }
  await openDosSession({ nativePascal: true, command: 'D:\\NATIVE.BAT', toolFiles });
}
