// v1098 の動きを本物のブラウザ（Chromium）で確かめる（模擬サーバーと合成データ。本番にはつながない）。
//   A) 差分の取り込みのあとも、端末の app_state のキーと中身は「全部を取り直した端末」と同じ
//      （1 回目のログイン → クラウドの行をいくつか変える・足す → 2 回目のログイン（差分）→ まっさらな端末で全部取ったものと比べる）
//   B) 2 回目のログインで値を取ったのは変わった行だけ（rpc の一覧 + in.() の 1 回）
//   C) 初めて開いた端末で、Service Worker が入っても読み込み直さない（v1097 までは 1 回読み込み直した）
//   D) 名簿のある端末は、名簿の取得を待たずにログイン画面が出る（名簿の取得を 4 秒遅らせても出る）
//   E) 端末の写しだけが変わった行（この端末で直して送った・ほかの経路で書き換わった）は、クラウドの印が同じでも取り直す（独立レビューの P2）
//   F) 読むだけの写し（lsSplitRO）を、どのページも書き換えない（全部のページを開いたあと、写しと解き直した値が同じ）
// 使い方：模擬サーバー（server.mjs）を v1098 の index.html で動かしてから  node e2e-check.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const SCR = process.env.SCR || '/tmp/claude-0/-home-claude/423fb030-9b70-5ea3-9a87-b6d14aa1c5ff/scratchpad/perf';
const DATA = JSON.parse(fs.readFileSync(SCR + '/data.json', 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'];
const ctl = async (p, opt) => { const t = await (await fetch(new URL(p, APP), opt)).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; let firstWrites = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + JSON.stringify(info) : '')); };

async function open(dir) {
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  return { ctx, page, errors, navs: () => navs };
}
const loginReady = page => page.waitForFunction(() => {
  const g = document.querySelectorAll('#login-store-grid .store-btn'); const sp = document.getElementById('sync-splash');
  return g.length > 2 && (!sp || sp.style.display === 'none' || getComputedStyle(sp).opacity === '0');
}, null, { polling: 50, timeout: 60000 });
async function login(page) {
  await page.evaluate(() => loginPickLocation('OFFICE'));
  await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { polling: 100, timeout: 120000 });
  await sleep(2500);
}
// 端末の app_state のキー（クラウドから来るもの）と中身。比べるのは「取り込みで捨てない」行と、分割の行
async function deviceState(page) {
  return page.evaluate(async () => {
    try { _idbFlush(); } catch (e) { }
    const out = {};
    const keys = lsKeys('').filter(k => { try { return isOpSyncKey(k); } catch (e) { return false; } });
    for (const k of keys) out[k] = _lsStoreGet(k);
    return out;
  });
}

const D1 = SCR + '/e2e-A', D2 = SCR + '/e2e-B';
fs.rmSync(D1, { recursive: true, force: true }); fs.rmSync(D2, { recursive: true, force: true });
await ctl('/__reset'); await ctl('/__net?rtt=30&bps=0');

// ---- C) 初めての端末：読み込み直さない
{
  await ctl('/__log?reset');
  const a = await open(D1);
  await a.page.goto(APP); await loginReady(a.page);
  const n0 = a.navs();
  await a.page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 20000 }).catch(() => { });
  await sleep(3500);
  ok('C 初めての端末で Service Worker が入っても読み込み直さない', a.navs() === n0, { navs: a.navs() - n0, controller: await a.page.evaluate(() => !!navigator.serviceWorker.controller) });
  await login(a.page);
  const seen = await a.page.evaluate(() => { const s = _lsStoreGet('kv_seen_v1'); return s ? Object.keys(JSON.parse(s).rows).length : 0; });
  ok('A0 1 回目のログインのあと、取り込んだ行の印が記録されている', seen > 500, { rows: seen });
  ok('A0 1 回目は全部取った', (await a.page.evaluate(() => _kvLast && _kvLast.how)) === 'all', await a.page.evaluate(() => _kvLast));
  ok('ページの例外なし（1 回目）', a.errors.length === 0, a.errors.slice(0, 3));
  await a.page.evaluate(() => { try { _idbFlush(); } catch (e) { } }); await sleep(1500);
  firstWrites = (await ctl('/__log')).log.filter(e => e.keys).flatMap(e => e.keys);
  await a.ctx.close();
}
// ---- クラウドを変える（別の端末が保存したつもり）：中身だけ・updated_at も・新しい行・前の統合行
const changes = await ctl('/__mutate', { method: 'POST' });
console.log('cloud changes', JSON.stringify(changes));

// ---- B) 2 回目のログイン（名簿のある端末）。D) 名簿の取得を遅らせてもログイン画面がすぐ出る
{
  await ctl('/__delay?path=' + encodeURIComponent('/rest/v1/employees') + '&ms=4000');
  await ctl('/__log?reset');
  const a = await open(D1);
  const t0 = Date.now(); await a.page.goto(APP); await loginReady(a.page); const tl = Date.now() - t0;
  ok('D 名簿の取得を 4 秒遅らせても、ログイン画面は名簿を待たずに出る', tl < 3500, { ms: tl });
  await ctl('/__delay?path=' + encodeURIComponent('/rest/v1/employees') + '&ms=0');
  await sleep(4500);
  // E) 合流の決まりの無い行を 1 つ選び、端末の写しだけ変える（クラウドは 1 回目に取り込んだときの文字のまま）
  const kE = await a.page.evaluate(ch => lsKeys('').filter(k => { try { return isOpSyncKey(k) && !_opMergeDef(k) && !(_SPLIT_KEYS && _SPLIT_KEYS[k]) && !_lsOnDemand(k) && !isLocalOnlyKey(k) && k.indexOf('spl_') !== 0 && ch.indexOf(k) < 0 && (_lsStoreGet(k) || '').length > 20; } catch (e) { return false; } }).sort()[0], changes.changedKeys);
  const eBefore = await a.page.evaluate(k => { const s = _lsStoreGet(k); const v = JSON.parse(s); const v2 = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({}, v, { __e2e_local: 1 }) : (Array.isArray(v) ? v.concat([{ __e2e_local: 1 }]) : { __e2e_local: v }); _lsWriteVerified(k, JSON.stringify(v2)); try { _idbFlush(); } catch (e) { } return s; }, kE);
  await ctl('/__log?reset');
  await login(a.page);
  const L = (await ctl('/__log')).log;
  const vals = L.filter(e => e.p.startsWith('/rest/v1/app_state?select=key,value'));
  const kv = await a.page.evaluate(() => _kvLast);
  ok('B 2 回目は変わった行だけ取った（一覧 1 回＋値 1 回）', kv && kv.how === 'keys' && vals.length === 1 && L.filter(e => /rpc\/app_state_index/.test(e.p)).length === 1, { kv, valueRequests: vals.length, bytes: vals.reduce((x, e) => x + e.b, 0) });
  // 取った行＝別の端末が変えた行＋この端末が 1 回目に自分で書いた行（そのあと印が変わる）。それ以外は取らない
  const fetchedKeys = await a.page.evaluate(() => (_kvLastKeys || []).slice());
  const selfWritten = new Set(firstWrites);
  const extra = fetchedKeys.filter(k => !changes.changedKeys.includes(k) && !selfWritten.has(k) && k !== kE);
  ok('E 端末の写しだけ変わった行は、クラウドの印が同じでも取り直し、クラウドの値に戻った', !!kE && fetchedKeys.includes(kE) && (await a.page.evaluate(k => _lsStoreGet(k), kE)) === eBefore, { key: kE ? kE.replace(/_[^_]*$/, '_…') : null });
  const missed = changes.changedKeys.filter(k => !fetchedKeys.includes(k));
  ok('B 取った行は「変わった行」だけで、変わった行は全部取った', extra.length === 0 && missed.length === 0, { fetched: fetchedKeys.length, extra: extra.slice(0, 8), missed, selfWritten: selfWritten.size });
  const stateA = await deviceState(a.page);
  // F) すべてのページを開いたあと、読むだけの写しが解き直した値と同じ（どこかが写しを書き換えていれば違う）
  const roF = await a.page.evaluate(async () => {
    const pages = []; groupsForRole().forEach(g => (g.children || []).filter(c => typeof navChildAllowed !== 'function' || navChildAllowed(c)).forEach(c => { if (pages.indexOf(c) < 0) pages.push(c); }));
    const keys = ['invoices', 'reimbursements'];
    keys.forEach(k => { try { lsSplitRO(k); } catch (e) { } });
    for (const p of pages) { try { go(p); } catch (e) { } await new Promise(r => setTimeout(r, 120)); }
    try { go('dashboard'); } catch (e) { } await new Promise(r => setTimeout(r, 1500));
    const out = {};
    keys.forEach(k => { const ro = JSON.stringify(lsSplitRO(k)); const fresh = JSON.stringify(_SPLIT_KEYS && _SPLIT_KEYS[k] ? ls(k, []) : ls(k, [])); out[k] = { same: ro === fresh, n: (lsSplitRO(k) || []).length }; });
    return { pages: pages.length, out };
  });
  ok('F どのページも読むだけの写し（Invoice・立替）を書き換えない', Object.values(roF.out).every(x => x.same), roF);
  ok('ページの例外なし（2 回目）', a.errors.length === 0, a.errors.slice(0, 3));
  await a.ctx.close();
  // ---- A) まっさらな端末で全部取ったものと比べる
  const b = await open(D2);
  await b.page.goto(APP); await loginReady(b.page); await sleep(3500); await login(b.page);
  const stateB = await deviceState(b.page);
  await b.ctx.close();
  const ka = Object.keys(stateA).sort(), kb = Object.keys(stateB).sort();
  const diffKeys = ka.filter(k => !(k in stateB)).concat(kb.filter(k => !(k in stateA)));
  const diffVals = ka.filter(k => k in stateB && stateA[k] !== stateB[k]);
  ok('A 差分で取り込んだ端末と、全部を取り直した端末で、app_state のキーが同じ', diffKeys.length === 0, { only: diffKeys.slice(0, 8), a: ka.length, b: kb.length });
  ok('A 中身も同じ', diffVals.length === 0, { differ: diffVals.slice(0, 8) });
}
fs.writeFileSync(SCR + '/e2e-result.json', JSON.stringify(results, null, 1));
const ng = results.filter(r => !r.ok).length;
console.log(ng ? ng + ' NG' : 'all OK');
process.exit(ng ? 1 : 0);
