#!/usr/bin/env node
// Copies the editor's runtime build (and level JSON) into this app.
//   ../editor/dist-runtime/pirate-king-runtime.js -> vendor/pirate-king-runtime.js
//   levels: run `npm run export:levels` in the editor, which writes src/levels.json here.
// Override the editor location with PIRATE_KING_EDITOR=/path/to/editor.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editor = path.resolve(process.env.PIRATE_KING_EDITOR || ['pirate-king-editor', 'editor'].map((d) => path.join(app, '..', d)).find((d) => fs.existsSync(path.join(d, 'package.json'))) || path.join(app, '..', 'pirate-king-editor'));
const run = (args) => { const r = spawnSync('npm', ['run', ...args], { cwd: editor, stdio: 'inherit' }); if (r.status) process.exit(r.status || 1); };
if (!process.argv.includes('--levels-only')) {
  if (process.argv.includes('--build') || !fs.existsSync(path.join(editor, 'dist-runtime', 'pirate-king-runtime.js'))) run(['build:runtime']);
  const src = path.join(editor, 'dist-runtime', 'pirate-king-runtime.js'), dst = path.join(app, 'vendor', 'pirate-king-runtime.js');
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
  console.log(`runtime ${(fs.statSync(dst).size / 1024).toFixed(0)} KB -> vendor/pirate-king-runtime.js`);
}
run(['export:levels', '--', path.join(app, 'src', 'levels.json')]);
