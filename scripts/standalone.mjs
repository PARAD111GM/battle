import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

// All game assets are generated at runtime. Inline Vite's output to make a
// portable, offline HTML game that can be opened without a development server.
let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
if (!script) throw new Error('Expected Vite entry script in dist/index.html');
const js = await readFile(resolve('dist/assets', basename(script[1])), 'utf8');
if (/\bimport\s*\(/.test(js)) throw new Error('Dynamic chunks need explicit standalone packaging');
html = html.replace(script[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  const css = await readFile(resolve('dist/assets', basename(match[1])), 'utf8');
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
await writeFile('dist/rivetfall.html', html);
console.log(`Standalone game: dist/rivetfall.html (${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB)`);
