import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

// Build version = hash of everything that ends up in the page; postbuild writes it to dist/version.json
// so a deployed page can notice a newer deploy (src/live-update.js).
const hashOf = (files) => { const h = createHash('sha1'); for (const f of files) if (fs.existsSync(f)) h.update(fs.readFileSync(f)); return h.digest('hex').slice(0, 12); };
const version = process.env.APP_VERSION || hashOf(['vendor/pirate-king-runtime.js', 'src/levels.json', 'src/main.js', 'src/styles.css', 'src/art.js', 'src/storage.js', 'src/live-update.js', 'index.html']);
process.env.APP_VERSION = version;

// One self-contained HTML (dist/index.html -> renamed to dist/pirate-king.html by scripts/postbuild.mjs).
export default defineConfig({
  base: './',
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), { name: 'version-file', closeBundle() { fs.writeFileSync('dist/version.txt', version); } }],
  build: { target: 'es2020', assetsInlineLimit: 100000000, cssCodeSplit: false, modulePreload: false, chunkSizeWarningLimit: 4000, reportCompressedSize: false },
});
