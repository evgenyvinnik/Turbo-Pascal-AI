/**
 * Downloads the reference screenshots the fidelity spec compares against.
 * They are third-party images, so they stay out of git:  bun run fidelity:fetch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gallery from './gallery.json';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference');
fs.mkdirSync(dir, { recursive: true });

const queue = [...gallery.screenshots];
const failures: string[] = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) break;
      const file = path.join(dir, `${item.ref}.png`);
      if (fs.existsSync(file)) continue;
      try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          throw new Error('Response is not a PNG');
        fs.writeFileSync(file, bytes);
        console.log(`fetched ${item.ref}.png`);
      } catch (error) {
        failures.push(`${item.ref}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
