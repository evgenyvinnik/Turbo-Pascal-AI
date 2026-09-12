/**
 * Downloads the reference screenshots the fidelity spec compares against.
 * They are third-party images, so they stay out of git:  bun run fidelity:fetch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATES } from './states';

const GALLERY = 'https://ui.codexpanse.com/media/posts/5/gallery';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference');
fs.mkdirSync(dir, { recursive: true });

const names = [...new Set(STATES.map((s) => s.ref))];
for (const name of names) {
  const file = path.join(dir, `${name}.png`);
  if (fs.existsSync(file)) continue;
  const res = await fetch(`${GALLERY}/${name}.png`);
  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`);
    continue;
  }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${name}.png`);
}
