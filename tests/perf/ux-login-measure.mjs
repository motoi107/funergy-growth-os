// ログインの速さを本物のブラウザ（Chromium）で何回か測る（模擬サーバー・合成データ。本番にはつながない）。
// ふだんの端末（2 回目のログイン）で、押してから
//   ・押した見た目が変わるまで（ボタンが「確認中…」）
//   ・アプリが使えるまで（同期の画面が消えて最初の画面が出た）
//   ・そのあと 15 秒のあいだに画面を全部描き直した回数と、その時間の合計・長い処理（50ms 超）の合計
// を測る。使い方：node ux-login-measure.mjs <回数> <rtt ms> <帯域 バイト/秒> [幅] [出力の JSON]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/home/claude/mnrun/data.json', 'utf8')).login;
const N = Number(process.argv[2] || 3), RTT = process.argv[3] || '0', BPS = process.argv[4] || '0', W = Number(process.argv[5] || 390), OUT = process.argv[6] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());
const ver = await fetch(APP).then(r => r.text()).then(h => (h.match(/APP_VERSION = '(\d+)'/) || [])[1]);
async function ready(page) { await page.goto(APP); await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 }); }
async function pick(page) {
  await page.evaluate(() => loginPickLocation('OFFICE'));
  await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
  await page.fill('#login-pin-input', '1234');
}
const runs = [];
for (let i = 0; i < N; i++) {
  const dir = '/tmp/uxmeasure-' + i; fs.rmSync(dir, { recursive: true, force: true });
  await ctl('/__net?rtt=0&bps=0');
  let ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: W, height: 844 } });
  let page = ctx.pages()[0] || await ctx.newPage();
  await ready(page); await pick(page); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 180000 });
  await sleep(6000); await page.evaluate(() => doLogout()); await sleep(1000); await ctx.close();
  await ctl('/__net?rtt=' + RTT + '&bps=' + BPS);
  ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: W, height: 844 } });
  page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await ready(page); await sleep(800); await pick(page);
  await page.evaluate(() => {
    window.__m = { renders: [], long: 0, t0: 0, fb: null, app: null };
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (window.__m.t0 && e.startTime >= window.__m.t0) window.__m.long += e.duration; }).observe({ type: 'longtask', buffered: false }); } catch (e) { }
    const o = window.renderPage;
    window.renderPage = function () { const s = performance.now(); const r = o.apply(this, arguments); window.__m.renders.push([Math.round(s - window.__m.t0), Math.round(performance.now() - s)]); return r; };
    const b = document.getElementById('login-pin-btn');
    b.addEventListener('pointerdown', () => { window.__m.t0 = performance.now(); }, true);
    (function watch() {
      const m = window.__m, now = performance.now();
      if (m.t0 && m.fb == null && b.disabled) m.fb = Math.round(now - m.t0);
      const a = document.getElementById('app-shell'), sp = document.getElementById('sync-splash');
      if (m.t0 && m.app == null && a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length && !(sp && sp.style.display !== 'none' && getComputedStyle(sp).opacity !== '0')) m.app = Math.round(now - m.t0);
      if (m.app == null || now - m.t0 < 16000) requestAnimationFrame(watch);
    })();
  });
  await page.click('#login-pin-btn');
  await page.waitForFunction(() => window.__m.app != null, null, { timeout: 180000, polling: 50 });
  await sleep(15500);
  const m = await page.evaluate(() => window.__m);
  const after = m.renders.filter(r => r[0] >= 0 && r[0] <= 15000);
  const run = { feedback_ms: m.fb, app_ms: m.app, renders_15s: after.length, render_ms_15s: after.reduce((a, r) => a + r[1], 0), longtask_ms_15s: Math.round(m.long), renders: after, errors };
  runs.push(run); console.log(JSON.stringify(run));
  await ctx.close();
}
await ctl('/__net?rtt=0&bps=0');
const med = k => { const a = runs.map(r => r[k]).filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const sum = { version: ver, n: N, rtt: RTT, bps: BPS, width: W, median: { feedback_ms: med('feedback_ms'), app_ms: med('app_ms'), renders_15s: med('renders_15s'), render_ms_15s: med('render_ms_15s'), longtask_ms_15s: med('longtask_ms_15s') }, runs };
console.log('MEDIAN', JSON.stringify(sum.median));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(sum, null, 1));
