import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'rivetfall-soak-'));
try {
  const outfile = join(temporary, 'soak.mjs');
  await build({ entryPoints: [resolve('scripts/soak.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: 'inline', logLevel: 'warning' });
  const { main } = await import(pathToFileURL(outfile).href);
  process.exitCode = await main(process.argv.slice(2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
