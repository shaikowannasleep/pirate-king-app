#!/usr/bin/env node
// Renames dist/index.html -> dist/pirate-king.html and checks it is truly self-contained.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const src = path.join(dist, 'index.html'), dst = path.join(dist, 'pirate-king.html');
let html = fs.readFileSync(src, 'utf8');
// classic (non-module) script so it also runs from file:// in every browser
html = html.replace(/<script type="module" crossorigin>/g, '<script type="module">');
const external = [...html.matchAll(/<(script|link)[^>]+(src|href)=["'](?!data:)([^"']+)["']/gi)].map((m) => m[3]);
if (external.length) { console.error('External references found:', external); process.exit(1); }
fs.writeFileSync(dst, html); fs.rmSync(src);
const versionFile = path.join(dist, 'version.txt'), version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';
for (const f of fs.readdirSync(dist)) if (f !== 'pirate-king.html' && f !== 'assets') fs.rmSync(path.join(dist, f), { recursive: true, force: true });
// GitHub Pages site: index.html (same page) + version.json for live update
if (process.argv.includes('--site')) { fs.copyFileSync(dst, path.join(dist, 'index.html')); fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }) + '\n'); fs.writeFileSync(path.join(dist, '.nojekyll'), ''); }
console.log(`version ${version}; dist/pirate-king.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, self-contained`);
