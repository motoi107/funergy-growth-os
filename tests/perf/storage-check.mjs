// v1138：端末の保存領域（localStorage）をいっぱいにしない、を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない）。
// 1) 前の版（OLD_DIR の index.html）で GM がログインして使う（localStorage に大きなデータの控えがたまる）・さらに大きな保存で満杯の近くまで
// 2) 同じ端末（同じプロファイル）で v1138 を開く → 起動のあと localStorage が空く・画面のデータはそのまま（IndexedDB）・保存できる・読み込み直しても残る
// 3) 送れない保存は、届くまで localStorage にも控え → 書き出す前に閉じても、次に開いたとき残っている
// 使い方：OLD_DIR に前の版の index.html と sw.js（と appicons）を置き、
//   DATA_FILE=<合成データ> VENDOR_DIR=... CERT_DIR=... node storage-check.mjs [出力の JSON]
// （このスクリプトが server.mjs を前の版・新しい版で起動し直す）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA_FILE = process.env.DATA_FILE || '/tmp/mnrun/data.json';
const DATA = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).login;
const OLD_DIR = process.env.OLD_DIR, NEW_DIR = process.env.NEW_DIR || new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());

let srv = null;
process.on('exit', () => { try { srv && srv.kill('SIGTERM'); } catch (e) { } });
async function serve(dir) {
  if (srv) { srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); srv = null; await sleep(300); }
  srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, APP_DIR: dir, DATA_FILE }, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/ready/.test(String(d))) res(); }); srv.once('exit', c => rej(new Error('server exit ' + c))); });
}
const DIR = '/tmp/storagecheck-profile';
async function open() {
  const ctx = await chromium.launchPersistentContext(DIR, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, locale: 'ja-JP', serviceWorkers: 'block' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.clearBrowserCache');   // 前の版の index.html を HTTP の写しから出さない
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors };
}
const appShown = page => page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
async function login(page) {
  await page.evaluate(() => loginPickLocation('OFFICE')); await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn'); await appShown(page);
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(2000);
}
const lsInfo = page => page.evaluate(() => {
  let bytes = 0, n = 0, bulk = 0, marks = 0, old = 0; const writing = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), v = localStorage.getItem(k) || ''; bytes += (k.length + v.length) * 2; n++;
    if (k.indexOf('_lsj:') === 0) marks++;
    else if (k.charAt(0) !== '_' && !['funergy_lang', 'supa_sync', 'heavy_ready', 'haptics_on', 'op_outbox', 'emp_dirty_q', 'vendor_touched_v1'].includes(k)) { bulk++; if (localStorage.getItem('_lsj:' + k) === null) old++; else writing.push(k.replace(/_[A-Z0-9-]+$/, '_*')); } }
  return { mb: +(bytes / 1048576).toFixed(2), keys: n, bulk, old, writing, marks, idb: (typeof _IDB_MEM !== 'undefined' && _IDB_MEM) ? _IDB_MEM.size : -1, state: typeof _idbState !== 'undefined' ? _idbState : '' };
});
const snapshot = page => page.evaluate(() => {
  const o = {}; for (const k of ['m_employees', 'm_stores']) { const v = _lsRawStr(k); o[k] = v ? v.length : 0; }
  o.emp = (getEmployees() || []).length; o.stores = (getVisibleStores() || []).length; return o;
});

fs.rmSync(DIR, { recursive: true, force: true });
/* ============ 1. 前の版で使う ============ */
await serve(OLD_DIR); await ctl('/__reset');
let before;
{
  const { ctx, page, errors } = await open();
  ok('1-0 前の版の版', true, await page.evaluate(() => APP_VERSION));
  await login(page);
  for (const p of ['budget', 'tip', 'staff_master', 'menu']) { await page.evaluate(pg => go(pg), p); await sleep(800); }
  const a = await lsInfo(page);
  ok('1-1 前の版：localStorage に大きなデータの控え', a.bulk > 20 && a.mb > 0.3, a);
  /* 満杯の近くまで（前の版の端末で起きていたこと）：大きな保存を足す */
  const fill = await page.evaluate(() => { let n = 0; for (let i = 0; i < 12; i++) { try { lsSet('spl_test_fill_' + i, { pad: 'x'.repeat(200000) }); n++; } catch (e) { } } return n; });
  await sleep(1500);
  const b = await lsInfo(page);
  ok('1-2 前の版：大きな保存のあと localStorage がほぼ満杯', b.mb > 4, { fill, ...b });
  const small = await page.evaluate(() => { try { localStorage.setItem('_probe_small', 'x'.repeat(200000)); localStorage.removeItem('_probe_small'); return true; } catch (e) { return false; } });
  ok('1-3 前の版：小さくない印（200KB）はもう書けない（満杯の再現）', small === false, small);
  before = await snapshot(page);
  ok('1-4 前の版：pageerror なし', errors.length === 0, errors);
  await ctx.close();
}

/* ============ 2. v1138 を同じ端末で開く ============ */
await serve(NEW_DIR); await ctl('/__reset');
{
  const { ctx, page, errors } = await open();
  ok('2-0 新しい版', (await page.evaluate(() => APP_VERSION)) >= '1138', await page.evaluate(() => APP_VERSION));
  await page.waitForFunction(() => typeof _lsSlimLast !== 'undefined' && _lsSlimLast, null, { timeout: 30000, polling: 100 }).catch(() => {});
  const c = await lsInfo(page);
  const sw = await page.evaluate(() => _lsSlimLast);
  ok('2-1 起動のあと localStorage が空いた（前の版の控えが 0 件・1MB 未満。書いている途中の写しは印つき）', c.old === 0 && c.mb < 1, { ...c, sweep: sw });
  ok('2-2 IndexedDB にデータが残っている', c.idb > 50 && c.state === 'ready', c);
  const fillIdb = await page.evaluate(() => { const v = _lsRawStr('spl_test_fill_3'); return v ? v.length : 0; });
  ok('2-3 前の版で保存した大きなデータも読める（IndexedDB）', fillIdb > 190000, fillIdb);
  await login(page);
  const after = await snapshot(page);
  ok('2-4 ログインのあと従業員・店舗が前と同じ数', after.emp === before.emp && after.stores === before.stores && after.m_employees > 0, { before, after });
  const d = await lsInfo(page);
  ok('2-5 ログインの取り込みのあとも localStorage は小さいまま', d.old === 0 && d.mb < 1, d);
  const roomy = await page.evaluate(() => { try { localStorage.setItem('_probe_small', 'x'.repeat(200000)); localStorage.removeItem('_probe_small'); return true; } catch (e) { return false; } });
  ok('2-6 小さな印（200KB）が書ける', roomy === true);
  for (const p of ['dashboard', 'budget', 'tip', 'staff_master', 'menu', 'acct_review', 'diag_center']) { await page.evaluate(pg => go(pg), p); await sleep(700); }
  const diag = await page.evaluate(() => document.getElementById('main-content').textContent);
  ok('2-7 「診断と記録」に空けた記録', /端末の保存領域を空けました/.test(diag), (diag.match(/端末の保存領域を空けました[^）]*）/) || [])[0]);
  /* ふつうの保存 → クラウドに届く → localStorage に残らない */
  const key = await page.evaluate(() => { const all = (typeof OP_SYNC_PREFIX !== 'undefined' ? OP_SYNC_PREFIX : []).filter(p => !/office|ocs|mr_|bonus|karte|^spl_|^daily_actuals|budget/i.test(p)).map(p => p + 'STTEST');
    for (const k of all) { try { if (isOpSyncKey(k) && !_opMergeDef(k) && !(typeof _SPLIT_KEYS !== 'undefined' && _SPLIT_KEYS[k]) && !(typeof SUPA_MASTER_MAP !== 'undefined' && SUPA_MASTER_MAP[k])) return k; } catch (e) { } } return null; });
  ok('2-8 試験に使うキーがある', !!key, key);
  await page.evaluate(k => lsSet(k, { v: 'saved-1138', at: Date.now() }), key);
  await page.waitForFunction(k => !localStorage.getItem(k) && !localStorage.getItem('_lsj:' + k), key, { timeout: 15000, polling: 100 }).catch(() => {});
  const cloud1 = await page.evaluate(async k => { const r = await fetch(SUPABASE_URL + '/rest/v1/app_state?key=eq.' + encodeURIComponent(k) + '&select=value', { headers: supaHeaders() }); const j = await r.json(); return j && j[0] && j[0].value && j[0].value.v; }, key);
  const e1 = await page.evaluate(k => ({ ls: localStorage.getItem(k), mark: localStorage.getItem('_lsj:' + k), read: (ls(k, {}) || {}).v }), key);
  ok('2-9 保存はクラウドに届き、端末では IndexedDB から読める・localStorage に残らない', cloud1 === 'saved-1138' && e1.read === 'saved-1138' && e1.ls === null && e1.mark === null, { cloud1, e1 });
  /* 送れない保存 → 届くまで控え → 書き出す前に閉じる */
  await ctl('/__wfail?path=/rest/v1/app_state&n=200&status=503');
  await page.evaluate(k => lsSet(k, { v: 'pending-1138', at: Date.now() }), key);
  await sleep(1500);
  const e2 = await page.evaluate(k => ({ ls: (JSON.parse(localStorage.getItem(k) || 'null') || {}).v, mark: !!localStorage.getItem('_lsj:' + k), ob: _outboxGet().some(x => x.key === k) }), key);
  ok('2-10 送れないあいだは localStorage にも控えを残す（送信待ち）', e2.ls === 'pending-1138' && e2.ob, e2);
  ok('2-11 pageerror なし', errors.length === 0, errors);
  /* 書き出す前に閉じる（IndexedDB にも入っていない書き込み） */
  await page.evaluate(k => { _idbDB = null; lsSet(k + '_crash', { v: 'crash-1138' }); }, key);
  await ctx.close();
  await ctl('/__wfail?path=/rest/v1/app_state&n=0');
  globalThis.__key = key;
}
{
  const key = globalThis.__key;
  const { ctx, page, errors } = await open();
  const e3 = await page.evaluate(k => ({ pend: (ls(k, {}) || {}).v, crash: (ls(k + '_crash', {}) || {}).v, j: _idbStat.journal }), key);
  ok('3-1 閉じる前の書き込み（IndexedDB に入る前）も、次に開いたとき残っている', e3.crash === 'crash-1138' && e3.pend === 'pending-1138', e3);
  await login(page);
  await page.evaluate(() => FUNERGY_STATUS.sendNow()); await sleep(2500);
  const cloud2 = await page.evaluate(async k => { const r = await fetch(SUPABASE_URL + '/rest/v1/app_state?key=eq.' + encodeURIComponent(k) + '&select=value', { headers: supaHeaders() }); const j = await r.json(); return j && j[0] && j[0].value && j[0].value.v; }, key);
  ok('3-2 送信待ちは次のログインで届く', cloud2 === 'pending-1138', cloud2);
  await page.waitForFunction(k => !localStorage.getItem(k), key, { timeout: 70000, polling: 500 }).catch(() => {});
  const f = await lsInfo(page);
  ok('3-3 届いたあと localStorage の控えも外れる', f.bulk === 0, f);
  ok('3-4 pageerror なし', errors.length === 0, errors);
  await ctx.close();
}
srv.kill('SIGTERM');
const pass = results.filter(r => r.ok).length;
console.log(pass + '/' + results.length);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
