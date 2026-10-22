// v1104：売上・予算の保護（v1101）が、端末の localStorage が埋まっているときに止まる不具合を確かめる（模擬サーバー・合成データだけ）。
// node fin-scenario.mjs --profile <端末のフォルダ（一度ログインした端末）> --role ceo|gm --out result.json
//   1. 別の端末が F01 の売上（2026-10-21）と予算を保存したつもりで、クラウドの行を新しくする（/__fin_bump）
//   2. アプリを開く → ログイン → 最初の画面
//   3. 端末に新しい売上・予算が入ったか（クラウドの版と比べる）・出た知らせ・保護の状態
//   4. 日次の実績の入力画面を開けるか → 1 件保存できるか（クラウドの版が進んだか）
// 計測のログには PIN・本文を出さない。
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg('app', 'http://localhost:8080/');
const USERDIR = arg('profile');
const ROLE = arg('role', 'ceo');
const OUT = arg('out', 'fin-scenario.json');
const CPU = Number(arg('cpu', 1));
const DATA = JSON.parse(fs.readFileSync(arg('data', process.env.PERF_DATA || 'data.json'), 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'];
const ctl = async (p) => { const t = await (await fetch(new URL(p, APP))).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const R = { role: ROLE };
const bump = await ctl('/__fin_bump?store=F01&day=2026-10-21');
R.cloud_before = { da: await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-21'), bu: await ctl('/__fin_row?key=spl_budgets_v2_F01') };
const ctx = await chromium.launchPersistentContext(USERDIR, { headless: true, args: ARGS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 200)));
await page.addInitScript(() => {
  window.__toasts = [];
  document.addEventListener('DOMContentLoaded', () => { try { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType === 1 && n.parentNode === document.body && n.tagName === 'DIV' && !n.id) { const tx = (n.textContent || '').trim(); if (tx && tx.length < 300) window.__toasts.push({ t: Math.round(performance.now()), m: tx.slice(0, 140) }); } } }).observe(document.body, { childList: true }); } catch (e) { } }, { capture: true });
});
if (CPU > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
const t0 = Date.now();
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { polling: 50, timeout: 60000 });
R.t_login_screen = Date.now() - t0;
await sleep(1500);
const who = ROLE === 'ceo' ? { loc: 'OFFICE', name: DATA.ceo } : { loc: 'OFFICE', name: DATA.gm };
await page.evaluate(loc => loginPickLocation(loc), who.loc);
await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
await page.fill('#login-pin-input', '1234');
const t2 = Date.now();
await page.click('#login-pin-btn');
await page.waitForFunction(() => {
  const ap = document.getElementById('app-shell'); const sp = document.getElementById('sync-splash'); const mc = document.getElementById('main-content');
  return ap && getComputedStyle(ap).display !== 'none' && (!sp || sp.style.display === 'none' || getComputedStyle(sp).opacity === '0') && mc && mc.children.length > 0 && !mc.querySelector('.skel');
}, null, { polling: 50, timeout: 120000 });
R.t_first_screen = Date.now() - t2;
await page.waitForFunction(() => window._heavyPending === false || window._heavyPending === undefined, null, { polling: 100, timeout: 120000 });
await sleep(4000);
R.t_heavy = Date.now() - t2;
R.after_login = await page.evaluate(() => {
  // 画面が使う読み方（getDailyActuals・getBudgets）と、端末に書かれた値（_lsRaw）の両方
  const da = (() => { try { return getDailyActuals('F01')['2026-10-21'] || null; } catch (e) { return 'ERR ' + e.message; } })();
  const bu = (() => { try { const b = getBudgets().find(x => x.storeId === 'F01'); return b ? (b.note || null) : null; } catch (e) { return 'ERR ' + e.message; } })();
  const rawDa = (() => { try { return _lsRaw('daily_actuals_F01', {})['2026-10-21'] || null; } catch (e) { return 'ERR ' + e.message; } })();
  const rawBu = (() => { try { const v = _lsRaw('spl_budgets_v2_F01', null); return Array.isArray(v) ? (v[0].note || null) : null; } catch (e) { return 'ERR ' + e.message; } })();
  let lsChars = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsChars += k.length + (localStorage.getItem(k) || '').length; } } catch (e) { }
  const st = window.FUNERGY_FINANCIAL_SAVE ? FUNERGY_FINANCIAL_SAVE.getState() : null;
  let rec = null; try { rec = (FUNERGY_FINANCIAL_SAVE.getRecovery() || []).map(x => x.reason + (x.key ? ':' + x.key : '')); } catch (e) { rec = 'ERR ' + e.message; }
  return { local_da_F01_1021: da, local_budget_note: bu, raw_da_F01_1021: rawDa, raw_budget_note: rawBu, saveFailKeys: typeof lsSaveFailKeys === 'function' ? lsSaveFailKeys() : null, state: st, recovery: rec, lsChars };
});
// 日次の実績の入力画面を開く（保護は開くときに最新を読む）
R.open = await page.evaluate(async () => {
  const before = (window.__toasts || []).length;
  let r; try { r = await openDailyActualModal('F01', '2026-10-20'); } catch (e) { r = 'THROW ' + e.message; }
  await new Promise(res => setTimeout(res, 800));
  const mb = document.getElementById('modal-body');
  const ov = document.querySelector('.modal-overlay.open, #modal-overlay.open, .modal.open');
  return { ret: r === undefined ? 'undefined' : r === false ? false : typeof r, modalOpen: !!(ov || (mb && mb.offsetParent !== null && mb.children.length)), toasts: (window.__toasts || []).slice(before).map(x => x.m) };
});
// --memo <文>：日報のメモを 1 件保存する（F01・2026-10-20）→ クラウドの行に入ったか → 読み込み直しても残るか
const MEMO = arg('memo', '');
if (MEMO) {
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  if (arg('page', '')) { await page.evaluate(p => { try { go(p); } catch (e) { } }, arg('page', '')); await sleep(1500); }   // 入力画面を開く元のページ（予実など）
  await sleep(500);
  R.memo_open = await page.evaluate(async () => { let r; try { r = await openDayMemo('F01', '2026-10-20', '月'); } catch (e) { return 'THROW ' + e.message; } await new Promise(res => setTimeout(res, 500)); return !!document.getElementById('dm-memo'); });
  if (R.memo_open === true) {
    const before = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-20');
    await page.evaluate(m => { document.getElementById('dm-memo').value = m; return saveDayMemo('F01', '2026-10-20'); }, MEMO);
    await sleep(2500);
    const after = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-20');
    R.memo_saved = { versionAdvanced: !!(before && after && after.updated_at !== before.updated_at), cloudHasMemo: !!(after && after.day && after.day.event === MEMO), state: await page.evaluate(() => window.FUNERGY_FINANCIAL_SAVE ? FUNERGY_FINANCIAL_SAVE.getState() : null) };
    await page.evaluate(() => { try { _idbFlush(); } catch (e) { } });
    await sleep(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(5000);
    R.memo_after_reload = await page.evaluate(() => { try { return (_lsRaw('daily_actuals_F01', {})['2026-10-20'] || {}).event || null; } catch (e) { return 'ERR ' + e.message; } });
  }
}
// --drop：保存の答えだけが届かない（サーバーには書けた）→「保存結果を確認」で 1 回だけ書けたことを確かめる
if (arg('drop', '')) {
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  const c0 = (await ctl('/__fin_stat')).commits;
  await ctl('/__fin_drop?n=1');
  await page.evaluate(async () => { await openDayMemo('F01', '2026-10-19', '日'); await new Promise(r => setTimeout(r, 400)); document.getElementById('dm-memo').value = 'drop-check'; return saveDayMemo('F01', '2026-10-19'); });
  await sleep(1500);
  const mid = await page.evaluate(() => ({ state: FUNERGY_FINANCIAL_SAVE.getState().status, panel: !!document.getElementById('financial-save-status'), input: (document.getElementById('dm-memo') || {}).value || null }));
  const ok = await page.evaluate(() => FUNERGY_FINANCIAL_SAVE.reconcile());
  await sleep(800);
  const c1 = (await ctl('/__fin_stat')).commits;
  const row = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-19');
  R.drop = { mid, reconciled: ok, commitsOnServer: c1 - c0, cloudHasMemo: !!(row && row.day && row.day.event === 'drop-check'), after: await page.evaluate(() => ({ state: FUNERGY_FINANCIAL_SAVE.getState().status, panel: !!document.getElementById('financial-save-status') })) };
}
// --conflict：入力画面を開いたあとで別の端末が同じ店の売上を保存 → 上書きしない・入力を残す → 開き直して保存
if (arg('conflict', '')) {
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await page.evaluate(async () => { await openDayMemo('F01', '2026-10-18', '土'); await new Promise(r => setTimeout(r, 400)); document.getElementById('dm-memo').value = 'mine'; });
  await ctl('/__fin_bump?store=F01&day=2026-10-17');
  await page.evaluate(() => saveDayMemo('F01', '2026-10-18'));
  await sleep(1500);
  const mid = await page.evaluate(() => ({ state: FUNERGY_FINANCIAL_SAVE.getState().status, panel: (document.getElementById('financial-save-status') || {}).textContent || null, input: (document.getElementById('dm-memo') || {}).value || null }));
  const rowMid = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-17');
  await page.evaluate(() => FUNERGY_FINANCIAL_SAVE.reloadForm());
  await sleep(1000);
  await page.evaluate(() => { document.getElementById('dm-memo').value = 'mine'; return saveDayMemo('F01', '2026-10-18'); });
  await sleep(1500);
  const r18 = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-18'), r17 = await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-17');
  R.conflict = { mid, otherKeptWhileConflict: !!(rowMid && rowMid.day && rowMid.day.actual === 4321.5), after: await page.evaluate(() => FUNERGY_FINANCIAL_SAVE.getState().status), mineSaved: !!(r18 && r18.day && r18.day.event === 'mine'), otherDeviceKept: !!(r17 && r17.day && r17.day.actual === 4321.5) };
}
// --expect-memo <文>：この端末（別の端末のつもり）でログインしたあと、F01・2026-10-20 のメモがその文か
if (arg('expect-memo', '')) R.memo_seen = await page.evaluate(() => { try { return (_lsRaw('daily_actuals_F01', {})['2026-10-20'] || {}).event || null; } catch (e) { return 'ERR ' + e.message; } }) === arg('expect-memo', '');
R.toasts = await page.evaluate(() => (window.__toasts || []).map(x => ({ t: x.t, m: x.m })));
R.errors = errors.slice(0, 20);
R.cloud_after = { da: await ctl('/__fin_row?key=daily_actuals_F01&day=2026-10-21'), bu: await ctl('/__fin_row?key=spl_budgets_v2_F01') };
R.got_latest_sales = JSON.stringify(R.after_login.local_da_F01_1021) === JSON.stringify(R.cloud_before.da && R.cloud_before.da.day);
R.got_latest_budget = R.after_login.local_budget_note === (R.cloud_before.bu && R.cloud_before.bu.note);
R.raw_latest_sales = JSON.stringify(R.after_login.raw_da_F01_1021) === JSON.stringify(R.cloud_before.da && R.cloud_before.da.day);
R.raw_latest_budget = R.after_login.raw_budget_note === (R.cloud_before.bu && R.cloud_before.bu.note);
await page.evaluate(() => { try { _idbFlush(); } catch (e) { } });
await sleep(1000);
await ctx.close();
fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify({ first: R.t_first_screen, latestSales: R.got_latest_sales, latestBudget: R.got_latest_budget, rawLatestSales: R.raw_latest_sales, rawLatestBudget: R.raw_latest_budget, saveFail: R.after_login.saveFailKeys, state: R.after_login.state, open: R.open, memo_open: R.memo_open, memo_saved: R.memo_saved, memo_after_reload: R.memo_after_reload, memo_seen: R.memo_seen, drop: R.drop, conflict: R.conflict, toasts: R.toasts.map(x => x.m) }, null, 1));
