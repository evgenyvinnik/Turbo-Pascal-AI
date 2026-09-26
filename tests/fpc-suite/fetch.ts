/**
 * Fetches Free Pascal's test suite at the pinned release into .cache/, which
 * git ignores: the tests are GPL, so they are downloaded for local runs and
 * never committed. Only tests/ is checked out.  bun run fpc-suite:fetch
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import pin from './pin.json';

const git = promisify(execFile);
export const checkout = '.cache/fpc-source';

const head = async () => (await git('git', ['-C', checkout, 'rev-parse', 'HEAD'])).stdout.trim();

if (existsSync(checkout) && (await head()) === pin.commit) {
  console.log(`Free Pascal tests already at ${pin.tag} (${pin.commit.slice(0, 12)}).`);
} else {
  if (existsSync(checkout))
    throw new Error(`${checkout} is not at ${pin.commit}; remove it and fetch again.`);
  await git('git', [
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    pin.tag,
    '--filter=blob:none',
    '--sparse',
    '--no-checkout',
    pin.repository,
    checkout,
  ]);
  await git('git', ['-C', checkout, 'sparse-checkout', 'set', 'tests']);
  await git('git', ['-C', checkout, 'checkout', '--quiet']);
  if ((await head()) !== pin.commit)
    throw new Error(`${pin.tag} no longer points at ${pin.commit}.`);
  console.log(`Fetched Free Pascal tests at ${pin.tag} (${pin.commit.slice(0, 12)}).`);
}
