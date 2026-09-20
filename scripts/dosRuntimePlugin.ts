import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Serve the pinned worker/WASM locally; no runtime CDN or account is involved. */
export function dosRuntimePlugin(): Plugin {
  const require = createRequire(import.meta.url);
  const directory = path.dirname(require.resolve('emulators'));
  const assets = ['emulators.js', 'wdosbox.js', 'wdosbox.wasm', 'wdosbox-x.js', 'wdosbox-x.wasm', 'wlibzip.js', 'wlibzip.wasm'];
  return {
    name: 'local-dos-runtime',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = request.url?.split('?')[0]?.replace(/^\/dos\/emulators\//, '');
        if (!request.url?.startsWith('/dos/emulators/') || !file || !assets.includes(file)) { next(); return; }
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(path.join(directory, file)).pipe(response);
      });
    },
    generateBundle() {
      for (const file of assets) this.emitFile({ type: 'asset', fileName: `dos/emulators/${file}`, source: readFileSync(path.join(directory, file)) });
    },
  };
}
