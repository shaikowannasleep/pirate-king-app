// End-to-end test of the single-file app from file:// (offline).
// title -> chart -> briefing -> level 1 -> keyboard play -> win screen; shipwright; portrait touch HUD.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'dist', 'pirate-king.html');
assert.ok(fs.existsSync(file), 'run npm run build first');
const URL_ = pathToFileURL(file).href;
const OUT = path.join(root, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const t0 = Date.now(), log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 120000 });

function watch(page) {
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u); });
  return { errors, requests };
}
const seedSave = (save) => `try{localStorage.setItem('pirate-king-save-v1', ${JSON.stringify(JSON.stringify(save))})}catch(e){}`;

try {
  // ---------------- desktop 1280x720 ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(seedSave({ v: 1, gold: 640, unlocked: 3, stars: { 'l1-cove': 3, 'l2-convoy': 2 }, upgrades: { hull: 1, cannons: 0, sails: 0 }, settings: { quality: 'high', sound: true, qualityLocked: true } }));
    const page = await ctx.newPage(); const w = watch(page);
    await page.goto(URL_);
    await page.waitForSelector('.screen.title.in'); await page.waitForSelector('#stage canvas');
    await page.waitForTimeout(3500);
    assert.match(await page.locator('.logo').innerText(), /PIRATE\s*KING/i);
    await shot(page, 'title'); log('title');

    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForSelector('.screen.map.in'); await page.waitForTimeout(600);
    assert.equal(await page.locator('.isle').count(), 5);
    assert.equal(await page.locator('.isle.locked').count(), 2);
    await shot(page, 'level-select'); log('level select');

    // locked island does nothing, settings opens
    await page.locator('.isle').nth(4).click({ force: true }); await page.waitForTimeout(200); assert.equal(await page.locator('.modal').count(), 0);
    await page.getByRole('button', { name: 'Settings' }).click(); await page.waitForSelector('.modal.in [data-testid=settings]');
    await page.waitForTimeout(1200); await shot(page, 'settings');
    await page.getByRole('button', { name: 'Done' }).click();

    // shipwright: buy a cannon upgrade
    await page.getByRole('button', { name: 'Shipwright' }).click(); await page.waitForSelector('.screen.shop.in');
    await page.locator('[data-buy=cannons]').click(); await page.waitForSelector('.screen.shop.in');
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem('pirate-king-save-v1')));
    assert.equal(save.upgrades.cannons, 1); assert.equal(save.gold, 640 - 150);
    await page.waitForTimeout(500); await shot(page, 'shop'); log('shop');
    await page.getByRole('button', { name: 'Back to chart' }).first().click(); await page.waitForSelector('.screen.map.in');

    // level 1 via briefing
    await page.locator('.isle').first().click(); await page.waitForSelector('.modal.in [data-testid=briefing]');
    await page.waitForTimeout(1200); await shot(page, 'briefing');
    await page.getByRole('button', { name: 'Set sail' }).click();
    await page.waitForFunction(() => window.__appApi.runtime?.state && document.querySelector('.pk-hud'), null, { timeout: 60000 });
    log('level 1 started');
    // keyboard play for a few seconds of real time
    await page.keyboard.press('KeyW');
    await page.keyboard.down('KeyD'); await page.waitForTimeout(1500); await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyE'); await page.keyboard.press('KeyQ'); await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    // advance deterministically (software GL is slow): 6 more seconds of game time
    const st = await page.evaluate(() => { const r = window.__appApi.runtime; r.advance(360); return { phase: r.state.phase, sail: r.state.player.sail, t: r.state.time, hp: r.state.player.hp, x: r.state.player.x, z: r.state.player.z, upgrades: r.state.upgrades }; });
    log(`state ${JSON.stringify(st)}`);
    assert.equal(st.phase, 'play'); assert.equal(st.sail, 1, 'W raised the sails'); assert.equal(st.upgrades.cannons, 1, 'upgrades reach the sim');
    await page.evaluate(() => window.__appApi.runtime.settle(6)); await page.waitForTimeout(1500);
    await shot(page, 'ingame-desktop'); log('in-game desktop');

    // pause menu
    await page.keyboard.press('Escape'); await page.waitForSelector('.pk-over.show[data-testid=pk-pause-overlay]'); await page.waitForTimeout(1500);
    await shot(page, 'paused'); await page.getByRole('button', { name: 'Resume' }).click();

    // win: sink the enemy and collect the gold by editing sim state (test-only shortcut; the bot proves winnability in the editor tests)
    await page.evaluate(() => { const s = window.__appApi.runtime.state; s.gold = Math.max(s.gold, s.goal.gold || 0); s.ships.forEach((e) => { if (e.team === 'enemy') { e.hp = 0; e.alive = false; } }); s.kills = s.ships.length - 1; window.__appApi.runtime.advance(2); });
    await page.waitForSelector('.pk-over.show[data-testid=pk-result] .pk-act', { timeout: 30000 }); await page.waitForTimeout(3000);
    await shot(page, 'win'); log('win screen');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pirate-king-save-v1')));
    assert.equal(after.stars['l1-cove'], 3); assert.ok(after.gold >= 490);
    await page.getByRole('button', { name: 'Continue' }).click(); await page.waitForSelector('.screen.shop.in');
    assert.match(await page.locator('.shop-foot').innerText(), /Merchant|Convoy|Set sail/i);
    assert.deepEqual(w.errors, []); assert.deepEqual(w.requests, [], 'no network requests');
    await ctx.close();
  }
  // ---------------- portrait phone 390x844 with touch ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); const w = watch(page);
    await page.goto(URL_); await page.waitForSelector('.screen.title.in'); await page.waitForTimeout(3000);
    await shot(page, 'title-portrait');
    await page.getByRole('button', { name: 'Play' }).tap(); await page.waitForSelector('.screen.map.in'); await page.waitForTimeout(500);
    await shot(page, 'level-select-portrait');
    await page.locator('.isle').first().tap(); await page.getByRole('button', { name: 'Set sail' }).tap();
    await page.waitForFunction(() => window.__appApi.runtime?.state && document.querySelector('.pk-hud.pk-touch'), null, { timeout: 60000 });
    // touch controls: full sail, steer right with the pad, fire right
    await page.locator('[data-testid=pk-sail-slider] button[data-v="1"]').tap();
    const pad = await page.locator('[data-testid=pk-steer]').boundingBox();
    await page.evaluate(() => window.__appApi.runtime.advance(150)); // through the intro
    await page.locator('[data-testid=pk-fire-right]').tap();
    const cdp = await ctx.newCDPSession(page);
    const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await tp('touchStart', pad.x + pad.width / 2, pad.y + pad.height / 2); await tp('touchMove', pad.x + pad.width * 0.95, pad.y + pad.height / 2);
    const steer = await page.evaluate(() => window.__appApi.runtime.state.player.steer);
    await page.evaluate(() => { const r = window.__appApi.runtime; r.advance(120); r.settle(8); });
    await page.waitForTimeout(1500);
    await shot(page, 'ingame-portrait');
    await tp('touchEnd');
    const st = await page.evaluate(() => ({ sail: window.__appApi.runtime.state.player.sail, phase: window.__appApi.runtime.state.phase, reloadR: window.__appApi.runtime.state.player.reload.right }));
    log(`portrait ${JSON.stringify({ steer, ...st })}`);
    assert.equal(st.sail, 1); assert.ok(steer > 0.5, 'steer pad turns right');
    assert.ok(await page.locator('[data-testid=pk-fire-left]').isVisible());
    // no explicit quality choice in this context: the renderer's auto-quality probe drops software GL to 'low'
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pirate-king-save-v1') || '{}').settings?.quality), 'low');
    assert.deepEqual(w.errors, []); assert.deepEqual(w.requests, []);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log('APP E2E PASS');
