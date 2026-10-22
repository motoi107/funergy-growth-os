// ログイン・最初の画面・各ページの時間を測る（模擬サーバーと合成データ。本番にはつながない）。
// node measure.mjs --runs 5 --role gm --profile cold|warm --cpu 1|4 --out result.json
//   ① アプリを開いてからログイン画面が押せるまで
//   ② ログインを押してから PIN の確認（auth-pin の答え）まで
//   ③a 最初の画面に中身が出て押せるまで（同期の画面が消え・骨組み（skel）が無い）
//   ③b 裏の取り込みまで終わるまで（_heavyPending が false・通信が 1.5 秒止まる）
//   ④ 各ページを初めて開いたときの描画（クリック → 2 フレーム）と、開いたことで始まった通信
//   ⑤ 一度開いたページに戻ったときの描画
// 計測のログには PIN・本文を出さない（URL の先頭と大きさだけ）。
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('runs', 3));
const ROLE = arg('role', 'gm');
const PROFILE = arg('profile', 'cold');          // cold：毎回まっさらな端末／warm：一度ログインした端末で開き直す／used：--userdir の端末をそのまま使う（v1104：前の版で使っていた端末の写し）
const CPU = Number(arg('cpu', 1));
const OUT = arg('out', 'result.json');
const APP = arg('app', 'http://localhost:8080/');
const PAGES = arg('pages', 'all');               // all：その役職のナビにある全ページ／none
const RTT = Number(arg('rtt', 80)), BPS = Number(arg('bps', 2_500_000));
const DATA = JSON.parse(fs.readFileSync(arg('data', process.env.PERF_DATA || 'data.json'), 'utf8')).login;
const USERDIR = arg('userdir', (process.env.PERF_DIR || '.') + '/profile-' + ROLE);
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'];

const ctl = async (p) => { const t = await (await fetch(new URL(p, APP))).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function logSince(t) { const j = await ctl('/__log'); return j.log.filter(e => e.t >= t); }
const now = async () => { const j = await ctl('/__log'); return Date.now() - j.t0; };
function net(entries) {
  const api = entries.filter(e => e.kind !== 'ws');
  const by = {};
  for (const e of api) { const k = e.m + ' ' + e.p.replace(/\?.*$/, '').replace(/^\/(rest|functions)\/v1\//, ''); by[k] = by[k] || { n: 0, b: 0 }; by[k].n++; by[k].b += e.b || 0; }
  return { n: api.length, bytes: api.reduce((a, e) => a + (e.b || 0), 0), raw: api.reduce((a, e) => a + (e.raw || 0), 0), by };
}
// 定期の見回り（通知・Tip Rate の合図・Toast の取り込みの状態など）は「止まった」の判定に数えない
const POLL = /key=eq\.notifications|live_tip_rate|key=like\.spl_tip_requests_|invoice_qb_alerts|functions\/v1\/ops-bot|rpc\/employee_access_state|forecast|archive/;
// 止まった＝見回り以外の要求が終わってから quietMs 何も無く、返している途中の要求（見回り以外）も無い
async function waitNetIdle(quietMs = 1500, cap = 30000) {
  const start = Date.now();
  const st = async () => { const j = await ctl('/__log'); return { n: j.log.filter(e => !POLL.test(e.p || '')).length, busy: (j.inflight || []).filter(p => !POLL.test(p)).length }; };
  let s0 = await st(), last = s0.n, lastChange = Date.now();
  while (Date.now() - start < cap) { await sleep(250); const s = await st(); if (s.n !== last || s.busy) { last = s.n; lastChange = Date.now(); } else if (Date.now() - lastChange >= quietMs) break; }
  return lastChange;
}

async function oneRun(i) {
  await ctl('/__reset'); await ctl('/__index?on=' + (arg('index', '1') === '0' ? '0' : '1')); await ctl(`/__net?rtt=${RTT}&bps=${BPS}`);
  if (PROFILE === 'cold') fs.rmSync(USERDIR, { recursive: true, force: true });
  const TZ = arg('tz', '');   // v1104：端末の時間帯（例 Asia/Tokyo・Pacific/Honolulu）
  const ctx = await chromium.launchPersistentContext(USERDIR, { headless: true, args: ARGS, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'allow', ...(TZ ? { timezoneId: TZ } : {}) });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 200)));
  page.on('crash', () => { console.error('renderer crashed'); });
  const errors = [];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.addInitScript(() => {
    // v1104：出た知らせ（showToast）の文と時刻を覚える（「売上・予算の最新データを確認できません」などが出たか）
    // showToast は body に div を足す。足された直下の要素の文を覚える（保護の知らせは元の showToast を直接呼ぶので、関数を包む方法では取れない）
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => { try { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType === 1 && n.parentNode === document.body && n.tagName === 'DIV' && !n.id) { const tx = (n.textContent || '').trim(); if (tx && tx.length < 300) window.__toasts.push({ t: Math.round(performance.now()), m: tx.slice(0, 140) }); } } }).observe(document.body, { childList: true }); } catch (e) { } }, { capture: true });
    window.__lt = 0; window.__ltN = 0;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__lt += e.duration; window.__ltN++; } }).observe({ type: 'longtask', buffered: true }); } catch (e) { }
  });
  const metrics = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; const o = {}; for (const x of m) o[x.name] = x.value; return { script: o.ScriptDuration * 1000, task: o.TaskDuration * 1000, layout: o.LayoutDuration * 1000, heap: o.JSHeapUsedSize / 1048576 }; };
  const lt = async () => page.evaluate(() => ({ ms: window.__lt, n: window.__ltN }));
  const R = { run: i, role: ROLE, profile: PROFILE, cpu: CPU, rtt: RTT, bps: BPS, pages: {}, revisit: {} };

  // ① ログイン画面
  await ctl('/__log?reset');
  const t0 = Date.now();
  await page.goto(APP, { waitUntil: 'commit' });
  let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  const loginReady = () => page.waitForFunction(() => {
    const g = document.querySelectorAll('#login-store-grid .store-btn'); const sp = document.getElementById('sync-splash');
    const ls = document.getElementById('login-screen');
    return g.length > 2 && (!sp || sp.style.display === 'none' || getComputedStyle(sp).opacity === '0') && ls && getComputedStyle(ls).display !== 'none';
  }, null, { polling: 50, timeout: 60000 });
  await loginReady();
  R.t1_login_screen_first = Date.now() - t0;
  // 初めての端末：Service Worker が入ると、ページが 1 回読み込み直される（v1097 まで）。読み込み直しが終わるまで待つ
  const n0 = navs;
  await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 20000 }).catch(() => { });
  await sleep(2500);
  R.reloaded = navs > n0;
  if (R.reloaded) { await page.waitForLoadState('domcontentloaded'); await loginReady(); }
  R.t1_login_screen = R.reloaded ? Date.now() - t0 : R.t1_login_screen_first;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, html: n.transferSize, resp: n.responseEnd }; });
  R.nav = nav;
  R.m1 = await metrics(); R.lt1 = await lt();
  R.net1 = net((await ctl('/__log')).log);

  // ② ログイン（所属 → 名前 → PIN）
  const who = ROLE === 'ceo' ? { loc: 'OFFICE', name: DATA.ceo } : ROLE === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : ROLE === 'crew' ? { loc: DATA.crewStore, name: DATA.crew } : { loc: DATA.slStore, name: DATA.sl };
  await page.evaluate(loc => loginPickLocation(loc), who.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
  await page.fill('#login-pin-input', '1234');
  // v1104：--count：ログインから最初の画面までの、売上・予算の読み取りの回数と時間（関数を包んで数える）
  if (arg('count', '')) await page.evaluate(() => {
    window.__cnt = {}; const fin = k => k === 'budgets_v2' || /^(daily_actuals_|spl_budgets_v2_)/.test(String(k));
    const wrap = (name, pick) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function () { const t = performance.now(); try { return f.apply(this, arguments); } finally { const k = pick(arguments); if (k) { const c = window.__cnt[name + ':' + k] = window.__cnt[name + ':' + k] || { n: 0, ms: 0 }; c.n++; c.ms += performance.now() - t; } } }; };
    wrap('ls', a => fin(a[0]) ? (String(a[0]).replace(/_F.*$/, '_*')) : null);
    wrap('getBudgets', () => 'all'); wrap('getDailyActuals', () => 'store'); wrap('_daRO', () => 'store');
  });
  const tAuthLog = await now();
  if (arg('cpuprofile', '')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const t2 = Date.now();
  const authResp = page.waitForResponse(r => /functions\/v1\/auth-pin/.test(r.url()), { timeout: 30000 });
  await page.click('#login-pin-btn');
  await (await authResp).finished();
  R.t2_auth = Date.now() - t2;
  // ③a 最初の画面
  await page.waitForFunction(() => {
    const ap = document.getElementById('app-shell'); const sp = document.getElementById('sync-splash'); const mc = document.getElementById('main-content');
    return ap && getComputedStyle(ap).display !== 'none' && (!sp || sp.style.display === 'none' || getComputedStyle(sp).opacity === '0') && mc && mc.children.length > 0 && !mc.querySelector('.skel');
  }, null, { polling: 50, timeout: 90000 });
  R.t3a_first_screen = Date.now() - t2;
  R.first_page = await page.evaluate(() => curPage);
  // ③b 裏の取り込みまで
  await page.waitForFunction(() => window._heavyPending === false || window._heavyPending === undefined, null, { polling: 100, timeout: 90000 });
  R.t3b_heavy = Date.now() - t2;
  const idleAt = await waitNetIdle(1500, 120000);
  R.t3c_net_idle = idleAt - t2;
  // ③d（初めての端末だけ）：一括で取る行（ここでは spl_invoices_F02）が端末に入るまで＝裏の取り込みが本当に終わった目安
  if (PROFILE === 'cold') {
    await page.waitForFunction(() => { try { return _lsStoreGet('spl_invoices_F02') != null; } catch (e) { return false; } }, null, { polling: 100, timeout: 120000 }).catch(() => { });
    R.t3d_data = Date.now() - t2;
  }
  if (arg('cpuprofile', '')) {
    const { profile } = await cdp.send('Profiler.stop');
    // 関数ごとの自分の時間（ミリ秒）の上位。中身・データは記録しない（関数の名前と行だけ）
    const self = new Map(); const dt = profile.timeDeltas || []; const byId = new Map(profile.nodes.map(n => [n.id, n]));
    (profile.samples || []).forEach((id, k) => { const n = byId.get(id); const f = n.callFrame; const key = (f.functionName || '(anon)') + ':' + (f.lineNumber + 1); self.set(key, (self.get(key) || 0) + (dt[k] || 0) / 1000); });
    R.cpu_top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [k, Math.round(v)]);
  }
  R.toasts = await page.evaluate(() => (window.__toasts || []).slice(0, 40)).catch(() => []);
  if (arg('count', '')) R.counts = await page.evaluate(() => Object.fromEntries(Object.entries(window.__cnt || {}).map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms) }])));
  R.m3 = await metrics(); R.lt3 = await lt();
  R.net3 = net(await logSince(tAuthLog));
  // v1104：--timeline：ログインからの要求の並び（売上・予算の保存と Toast の取り込みが直列になっていないか）
  if (arg('timeline', '')) R.timeline = (await logSince(tAuthLog)).filter(e => /financial_web|hyper-worker|toast_sales|app_state\?select=key,value,updated_at/.test(e.p || '')).map(e => ({ t: e.t - tAuthLog, ms: e.ms, p: (e.p || '').replace(/^\/(rest|functions)\/v1\//, '').slice(0, 60), b: e.b }));

  // ④・⑤ ページ
  if (PAGES !== 'none' && !WARMUP) {
    const list = await page.evaluate(() => { const out = []; groupsForRole().forEach(g => (g.children || []).filter(c => typeof navChildAllowed !== 'function' || navChildAllowed(c)).forEach(c => { if (out.indexOf(c) < 0) out.push(c); })); return out; });
    const SKIP = String(arg('skip', '')).split(',').filter(Boolean).concat(CRASHED);   // 合成データで描画が止まる（落ちる）ページは外して別に調べる
    const sel = (PAGES === 'all' ? list : PAGES.split(',')).filter(p => SKIP.indexOf(p) < 0);
    let dead = false;
    for (const p of sel) {
      fs.appendFileSync(OUT + '.pages.log', `run ${i} ${p}\n`);
      const tl = await now();
      const ms = await Promise.race([page.evaluate(async p => { const t = performance.now(); try { go(p); } catch (e) { return -1; } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }, p).catch(() => -2), sleep(120000).then(() => -3)]);
      if (ms < -1) { R.pages[p] = { ms, crashed: true }; CRASHED.push(p); dead = true; fs.appendFileSync(OUT + '.pages.log', `run ${i} ${p} CRASHED ${ms}\n`); break; }   // 描画が終わらない・落ちた（次の回からは外す）
      await waitNetIdle(800, 6000);
      const e = net((await logSince(tl)).filter(x => !POLL.test(x.p || '')));
      R.pages[p] = { ms: Math.round(ms), n: e.n, bytes: e.bytes };
    }
    for (const p of (dead ? [] : sel.slice(0, 12))) {
      const ms = await page.evaluate(async p => { const t = performance.now(); try { go(p); } catch (e) { return -1; } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }, p);
      R.revisit[p] = Math.round(ms);
    }
  }
  R.errors = errors.slice(0, 20);
  if (R.pages && Object.values(R.pages).some(x => x.crashed)) { await ctx.close().catch(() => { }); return R; }
  R.m_end = await metrics(); R.lt_end = await lt();
  // warm のために：画面を閉じる前に IndexedDB へ書き終える
  await page.evaluate(() => { try { _idbFlush(); } catch (e) { } });
  await sleep(1500);
  await ctx.close();
  return R;
}

const results = []; var WARMUP = false; const CRASHED = [];
if (PROFILE === 'warm') { fs.rmSync(USERDIR, { recursive: true, force: true }); console.error('warm-up…'); WARMUP = true; await oneRun(-1); WARMUP = false; }
for (let i = 0; i < RUNS; i++) { const r = await oneRun(i); results.push(r); console.error(`run ${i}: ①${r.t1_login_screen} ②${r.t2_auth} ③a${r.t3a_first_screen} ③b${r.t3b_heavy} ③c${r.t3c_net_idle} net3 ${r.net3.n}req ${(r.net3.bytes / 1e6).toFixed(2)}MB raw ${(r.net3.raw / 1e6).toFixed(1)}MB err ${r.errors.length}`); }
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
