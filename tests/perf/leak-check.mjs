// ページを何周も行き来したときに、タイマー・イベントの受け口・メモリが増え続けないかを見る（模擬サーバーと合成データ）。
// あわせて、何もしないで置いておいたときの定期の通信（見回り）の数を数える。
//   node leak-check.mjs --role gm --cycles 3 --idle 120 --out leak.json
// 使い方：模擬サーバー（server.mjs）を動かしてから。端末は一度ログインした端末（warm）。
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg('app', 'http://localhost:8080/');
const ROLE = arg('role', 'gm');
const CYCLES = Number(arg('cycles', 3));
const IDLE = Number(arg('idle', 120));
const OUT = arg('out', 'leak.json');
const SCR = '/tmp/claude-0/-home-claude/423fb030-9b70-5ea3-9a87-b6d14aa1c5ff/scratchpad/perf';
const DATA = JSON.parse(fs.readFileSync(SCR + '/data.json', 'utf8')).login;
const USERDIR = arg('userdir', SCR + '/profile-leak-' + ROLE);
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server', '--js-flags=--expose-gc'];
const ctl = async (p) => { const t = await (await fetch(new URL(p, APP))).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function session(measure) {
  const ctx = await chromium.launchPersistentContext(USERDIR, { headless: true, args: ARGS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 160)));
  await page.addInitScript(() => {
    // 生きているタイマー（setInterval）と、window・document に付いた受け口の数を数える
    const live = new Map(); let seq = 0;
    const si = window.setInterval, ci = window.clearInterval;
    window.setInterval = function (fn, ms, ...a) { const id = si.call(window, fn, ms, ...a); live.set(id, ms); return id; };
    window.clearInterval = function (id) { live.delete(id); return ci.call(window, id); };
    const L = { window: 0, document: 0 };
    const ae = EventTarget.prototype.addEventListener, re = EventTarget.prototype.removeEventListener;
    const key = t => t === window ? 'window' : t === document ? 'document' : null;
    EventTarget.prototype.addEventListener = function (type, fn, o) { const k = key(this); if (k) L[k]++; return ae.call(this, type, fn, o); };
    EventTarget.prototype.removeEventListener = function (type, fn, o) { const k = key(this); if (k) L[k]--; return re.call(this, type, fn, o); };
    window.__leak = () => ({ intervals: live.size, listeners: Object.assign({}, L), nodes: document.getElementsByTagName('*').length });
  });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 60000 });
  await sleep(2500);
  const who = ROLE === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : ROLE === 'crew' ? { loc: DATA.crewStore, name: DATA.crew } : { loc: DATA.slStore, name: DATA.sl };
  await page.evaluate(loc => loginPickLocation(loc), who.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { polling: 200, timeout: 120000 });
  await sleep(8000);
  const out = measure ? await measure(page) : null;
  out && (out.errors = errors.slice(0, 10));
  await page.evaluate(() => { try { _idbFlush(); } catch (e) { } }); await sleep(1500);
  await ctx.close();
  return out;
}

await ctl('/__reset'); await ctl('/__net?rtt=50&bps=5000000');
fs.rmSync(USERDIR, { recursive: true, force: true });
await session(null);   // 一度ログインした端末にする
const res = await session(async page => {
  const pages = await page.evaluate(() => { const o = []; groupsForRole().forEach(g => (g.children || []).filter(c => typeof navChildAllowed !== 'function' || navChildAllowed(c)).forEach(c => { if (o.indexOf(c) < 0) o.push(c); })); return o; });
  const snap = async () => { await page.evaluate(() => { try { window.gc && window.gc(); } catch (e) { } }); const h = (await (await page.context().newCDPSession(page)).send('Runtime.getHeapUsage')).usedSize / 1048576; return Object.assign(await page.evaluate(() => window.__leak()), { heapMB: Math.round(h) }); };
  const cyc = [await snap()];
  for (let c = 0; c < CYCLES; c++) {
    for (const p of pages) { await page.evaluate(p => { try { go(p); } catch (e) { } }, p); await sleep(150); }
    await page.evaluate(() => go('dashboard')).catch(() => { }); await sleep(2500);
    cyc.push(await snap());
  }
  // 何もしないで置いておく：定期の通信を数える
  await ctl('/__log?reset');
  await sleep(IDLE * 1000);
  const L = (await ctl('/__log')).log;
  const by = {}; L.forEach(e => { const k = e.m + ' ' + String(e.p).replace(/\?.*$/, '').replace(/^\/(rest|functions)\/v1\//, ''); by[k] = (by[k] || 0) + 1; });
  return { pages: pages.length, cycles: cyc, idleSec: IDLE, idleRequests: L.length, idleBytes: L.reduce((a, e) => a + (e.b || 0), 0), idleBy: by };
});
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ pages: res.pages, cycles: res.cycles, idleRequests: res.idleRequests, idleBytes: res.idleBytes, idleBy: res.idleBy, errors: res.errors }, null, 1));
