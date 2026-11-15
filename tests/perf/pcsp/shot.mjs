// 代表画面のスクリーンショット（前・後）。CSS=<ファイル> で案の CSS を足して撮る
// 使い方：WIDTH=1440 WHO=gm CSS=proto.css TAG=after node shot.mjs <JSON の台本>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const W = Number(process.env.WIDTH || 1440), WHO = process.env.WHO || 'gm', TAG = process.env.TAG || 'before';
const CSS = process.env.CSS ? fs.readFileSync(process.env.CSS, 'utf8') : '';
const JS = process.env.JSF ? fs.readFileSync(process.env.JSF, 'utf8') : '';
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUTD = process.env.OUTD || (process.env.PCSP_DIR || '/tmp/pcsp') + '/rep';
fs.mkdirSync(OUTD, { recursive: true });
const mobile = W < 768;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = '/tmp/pcsp-shot-' + WHO + W + TAG; fs.rmSync(dir, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
const page = ctx.pages()[0]; page.on('dialog', d => d.dismiss().catch(() => {}));
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
const who = WHO === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : WHO === 'sl' ? { loc: DATA.slStore, name: DATA.sl } : { loc: DATA.crewStore, name: DATA.crew };
await page.evaluate(l => loginPickLocation(l), who.loc);
await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
await sleep(2500);
if (WHO === 'gm') { await page.evaluate(() => switchStore('ALL')); await sleep(1000); }
if (CSS) await page.addStyleTag({ content: CSS });
if (JS) await page.addScriptTag({ content: JS });
for (const s of plan) {
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  if (s.store) { await page.evaluate(x => switchStore(x), s.store); await sleep(600); }
  await page.evaluate(p => go(p), s.page); await sleep(900);
  for (const oc of (s.clicks || [])) { await page.evaluate(oc => { try { (new Function(oc)).call(document.body); } catch (e) { console.log(e); } }, oc); await sleep(1200); }
  if (s.scroll) { await page.evaluate(y => window.scrollTo(0, y), s.scroll); await sleep(300); }
  await sleep(s.wait || 600);
  await page.screenshot({ path: `${OUTD}/${s.name}__${TAG}__${W}.jpg`, type: 'jpeg', quality: 70, fullPage: !!s.full });
  const m = await page.evaluate(() => ({ ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: Math.round(document.documentElement.scrollHeight / innerHeight * 10) / 10 }));
  console.log(s.name, TAG, W, JSON.stringify(m));
}
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await ctx.close();
