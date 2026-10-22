// v1104：端末の時間帯が日本でも、営業日・予算の月・Toast から取る日付がハワイ時間のままかを確かめる（模擬サーバー・合成データだけ）。
// node tz-check.mjs --profile <端末のフォルダ> --tz Asia/Tokyo --out result.json
//   ・ログインの前に日付の関数（bizToday など）を呼ぶ
//   ・CEO でログインして最初の画面まで → その間に Toast（hyper-worker）へ頼んだ日付を模擬サーバーの記録から取る
// 実際に日本の回線から測ったものではない（端末の時間帯を変えただけ）。
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg('app', 'http://localhost:8080/');
const TZ = arg('tz', 'Asia/Tokyo');
const OUT = arg('out', 'tz-check.json');
const DATA = JSON.parse(fs.readFileSync(arg('data', process.env.PERF_DATA || 'data.json'), 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'];
const ctl = async (p) => { const t = await (await fetch(new URL(p, APP))).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(arg('profile'), { headless: true, args: ARGS, viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, serviceWorkers: 'allow', timezoneId: TZ });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 200)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { polling: 50, timeout: 60000 });
const R = { tz: TZ };
R.dates = await page.evaluate(() => {
  const f = (n, ...a) => { try { return typeof window[n] === 'function' ? window[n](...a) : 'n/a'; } catch (e) { return 'ERR ' + e.message; } };
  return { deviceNow: new Date().toString(), deviceIsoDay: new Date().toISOString().slice(0, 10), bizToday: f('bizToday'), bizYm: f('bizYm'), curYm: f('curYm'), getPeriod: f('getPeriod'), todayISO: f('todayISO') };
});
await sleep(1000);
await ctl('/__log?reset');
await page.evaluate(loc => loginPickLocation(loc), 'OFFICE');
await page.locator('#login-name-grid .store-btn', { hasText: DATA.ceo }).first().click();
await page.fill('#login-pin-input', '1234');
await page.click('#login-pin-btn');
await page.waitForFunction(() => { const ap = document.getElementById('app-shell'); const mc = document.getElementById('main-content'); return ap && getComputedStyle(ap).display !== 'none' && mc && mc.children.length > 0 && !mc.querySelector('.skel'); }, null, { polling: 100, timeout: 120000 });
await sleep(6000);
const log = (await ctl('/__log')).log;
R.toastDates = [...new Set(log.filter(e => e.dates).map(e => JSON.stringify(e.dates)))].sort();
R.dashboardMonth = await page.evaluate(() => { const t = (document.getElementById('main-content') || {}).innerText || ''; const m = t.match(/20\d\d[\/年.-]\s?\d{1,2}月?/); return m ? m[0] : null; });
R.errors = errors.slice(0, 10);
await ctx.close();
fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
