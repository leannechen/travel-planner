#!/usr/bin/env node
// Export design screens from docs/design/source/*.dc.html to docs/design/png/.
// Usage: node scripts/export-design.mjs [NN ...]    e.g. node scripts/export-design.mjs 04 24b
// No arguments exports every screen. Size comes from canvas.json; scale is 2x.
// A screen whose current image in png/ is .webp is written as .webp (via sharp).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'design');
const srcDir = path.join(root, 'source');
const pngDir = path.join(root, 'png');
const SCALE = 2;

const canvas = JSON.parse(await readFile(path.join(srcDir, 'canvas.json'), 'utf8'));
const wanted = process.argv.slice(2).map((a) => a.toLowerCase());
const boards = Object.entries(canvas.boards)
  .map(([file, b]) => ({ file, base: file.replace(/\.dc\.html$/, ''), ...b }))
  .filter((b) => wanted.length === 0 || wanted.some((w) => b.base.toLowerCase().startsWith(`${w}-`)));
if (boards.length === 0) {
  console.error('No screen matches', wanted.join(', '));
  process.exit(1);
}

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(srcDir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(srcDir)) throw new Error('outside');
    res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const existing = await readdir(pngDir);
const browser = await chromium.launch();
try {
  for (const b of boards) {
    const page = await browser.newPage({ viewport: { width: b.w, height: b.h }, deviceScaleFactor: SCALE });
    await page.goto(`${origin}/${b.file}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: 'png' });
    await page.close();
    const webpName = `${b.base}.webp`;
    if (existing.includes(webpName)) {
      await writeFile(path.join(pngDir, webpName), await sharp(png).webp({ quality: 90 }).toBuffer());
      console.log('wrote', `png/${webpName}`);
    } else {
      await writeFile(path.join(pngDir, `${b.base}.png`), png);
      console.log('wrote', `png/${b.base}.png`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
