// Rebuild the checked-in native tool bundle from pinned official distributions.
// Run with: bun scripts/prepare-native-dos.ts
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync, zipSync, type Zippable } from 'fflate';

const distributions = [
  { url: 'https://downloads.freepascal.org/fpc/dist/3.2.2/i386-go32v2/separate/basedos.zip', sha256: '3f0c7ec5c91167f55b69ca9d40770d08bf02192f0b5ea5757a63015f7d8e8633' },
  { url: 'https://downloads.freepascal.org/fpc/dist/3.2.2/i386-go32v2/separate/aslddos.zip', sha256: 'ef7c2d9b2fb19c89b7131de8bf18ffc9bf6a4f0275a3111cd6b10bb9d62e2cc3' },
  { url: 'https://ibiblio.org/pub/micro/pc-stuff/freedos/files/repositories/latest/base/debug/20250621.0/debug.zip', sha256: '22ff71fa3d7740f5c39f28105554d2f1ad62996b54a0c884759c5f62f3585b15' },
];
const files: Zippable = {};
for (const distribution of distributions) {
  const response = await fetch(distribution.url);
  if (!response.ok) throw new Error(`Download failed: ${distribution.url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== distribution.sha256) throw new Error(`Checksum mismatch: ${distribution.url}`);
  for (const [path, content] of Object.entries(unzipSync(bytes))) {
    const name = path.split('/').at(-1)!;
    let output: string | undefined;
    if (path.startsWith('units/go32v2/rtl/')) output = `RTL/${name.toUpperCase()}`;
    else if (['ppc386.exe', 'cwsdpmi.exe', 'as.exe', 'ld.exe', 'debugx.com'].includes(name.toLowerCase())) output = name.toUpperCase();
    else if (path.startsWith('doc/fpc/') && ['copying', 'copying.v2', 'copying.v3', 'copying.fpc', 'copying.dj', 'cwsdpmi.txt'].includes(name.toLowerCase())) output = `LICENSES/${name}`;
    if (output) files[`__TPTOOLS/${output}`] = [content, { mtime: new Date('2021-05-26T00:00:00Z') }];
  }
}
await mkdir('public/dos/tools', { recursive: true });
const bundle = zipSync(files, { level: 9 });
await writeFile('public/dos/tools/fpc-3.2.2-dos.zip', bundle);
console.log(`Native DOS compiler bundle: ${bundle.length} bytes, ${Object.keys(files).length} files`);
