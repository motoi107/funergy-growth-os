// v1140（2b の 2 つ目）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない）。
// 模擬サーバーは SS_REAL=1（本物の関数 secure-state をつなぐ）と RLS_CS=1（公開の鍵では Career Score のキーを読めない＝SQL のあと）で動かす。
// ・GM：Career Score が関数から全部届く（公開の鍵では 1 行も渡らない）・Career Score の画面が開く
// ・G3（店長でない Store Leader）：自分の店の G1・G2 と自分だけが届く・端末にもそれだけ・画面は「—」・ログアウトで消える
// ・スタッフ：自分だけ
// 使い方：
//   node cs-check.mjs prep <元の合成データ> <出力>     … Career Score の行（名前ごと）を足した合成データを作る
//   模擬サーバー（server.mjs）を SS_REAL=1 RLS_CS=1 DATA_FILE=<出力> で動かしてから  DATA_FILE=<出力> node cs-check.mjs [結果の JSON]
import fs from 'node:fs';
if (process.argv[2] === 'prep') {
  const d = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const at = '2026-10-19T09:00:00.000000+00:00';
  const st = d.tables.app_state.filter(r => !/^(lss_emp_|spl_lss_requests_|spl_lss_history_)|^lss_(scores|requests|history)$/.test(r.key));
  const scores = {};
  for (const e of d.tables.employees) {
    st.push({ key: 'lss_emp_' + e.name, value: { scores: { 'A-0': 2, 'B-0': 1 }, evaluator: 'GM', date: '2026/10/01', status: '確定', _at: 1 }, updated_at: at });
    st.push({ key: 'spl_lss_requests_' + e.name, value: [{ id: 'q-' + e.id, name: e.name, kind: 'tip', status: '承認', pct: 50, date: '2026/09/01' }], updated_at: at });
    st.push({ key: 'spl_lss_history_' + e.name, value: [{ name: e.name, pct: 40, date: '2026/09/01', ts: 1 }], updated_at: at });
    scores[e.name] = { scores: { 'A-0': 1 } };
  }
  st.push({ key: 'lss_scores', value: scores, updated_at: at });
  d.tables.app_state = st;
  fs.writeFileSync(process.argv[4], JSON.stringify(d));
  console.log('prepared', st.length, 'rows');
  process.exit(0);
}
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const emps = D.tables.employees.map(e => ({ id: e.id, name: e.name, role: e.role || (e.data || {}).role, store: e.store || (e.data || {}).store, out: (e.data || {}).status === '退職' }));
const byId = id => emps.find(e => e.id === id);

async function open(tag) {
  const dir = '/tmp/cscheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, locale: 'ja-JP' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => { d.dismiss().catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors };
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(2500);
}
const csOnDevice = page => page.evaluate(() => (typeof lsKeys === 'function' ? lsKeys() : []).filter(k => csIsKey(k)).sort());
const csState = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('_cs_state') || 'null'); } catch (e) { return 'bad'; } });
const goPage = async (page, p) => { await page.evaluate(x => go(x), p); await sleep(1200); return page.evaluate(() => document.getElementById('main-content').innerText.length); };

// ---- GM
{
  const ss0 = JSON.parse(await ctl('/__ss'));
  const { ctx, page, errors } = await open('gm');
  await login(page, 'OFFICE', D.login.gm);
  const st = await csState(page), keys = await csOnDevice(page);
  ok('GM: the scope is "full"', st && st.level === 'full', st && st.level);
  ok('GM: every point and request row is on the device (history only on demand)', keys.filter(k => k.startsWith('lss_emp_')).length >= emps.length && keys.filter(k => k.startsWith('spl_lss_requests_')).length >= emps.length && !keys.some(k => k.startsWith('spl_lss_history_')), keys.length);
  const ss1 = JSON.parse(await ctl('/__ss'));
  ok('GM: the function was used, and no Career Score row went through the public key', ss1.calls > ss0.calls && ss1.anonCs === 0, ss1);
  const n = await goPage(page, 'leadership');
  ok('GM: the Career Score screen opens', n > 50, n);
  ok('GM: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- G3（Store Leader・店 F02）
const sl = byId(D.login.slId);
{
  const { ctx, page, errors } = await open('sl');
  await login(page, D.login.slStore, D.login.sl);
  const st = await csState(page), keys = await csOnDevice(page);
  const g = r => ({ g2: 2, crew: 1 }[r] || 9);
  const want = [sl.name, ...emps.filter(e => !e.out && e.store === sl.store && g(e.role) <= 2).map(e => e.name)].sort();
  ok('G3: the scope is "scoped" with the G1·G2 of the store and self', st && st.level === 'scoped' && JSON.stringify([...st.names].sort()) === JSON.stringify([...new Set(want)].sort()), st && { n: st.names.length, want: want.length });
  const names = new Set((st && st.names) || []);
  const outside = keys.filter(k => { const n = k.replace(/^(lss_emp_|spl_lss_requests_|spl_lss_history_)/, ''); return k !== 'lss_scores' && !names.has(n); });
  ok('G3: nothing outside the scope on the device', outside.length === 0, outside.slice(0, 5));
  const legacy = await page.evaluate(() => { try { return Object.keys(ls('lss_scores', {})).length; } catch (e) { return -1; } });
  ok('G3: the old combined row holds only the people in scope', legacy > 0 && legacy <= names.size, legacy);
  const other = emps.find(e => e.store !== sl.store && e.role === 'crew');
  ok('G3: the screens show “—” for someone outside (csSees false)', await page.evaluate(n => csSees(n) === false && csSees(curUserName) === true, other.name));
  const w = await page.evaluate(n => lsSet('lss_emp_' + n, { scores: {}, _at: Date.now() }), other.name);
  ok('G3: the device refuses to write a row outside the scope', w === false);
  for (const p of ['mypage', 'leadership', 'ojt_admin']) { const len = await goPage(page, p); ok('G3: ' + p + ' opens', len > 20, len); }
  const ss = JSON.parse(await ctl('/__ss'));
  ok('G3: no Career Score row went through the public key', ss.anonCs === 0, ss.anonCs);
  ok('G3: no page errors', errors.length === 0, errors);
  // ログアウトの中で呼ぶ関数（ssOnLogout）を直接。模擬サーバーでは Office の画面のモジュール（native_web_cas_*）が動かないので、
  // doLogout はその見張りで止まる（main でも同じ。本番では動く）
  await page.evaluate(() => ssOnLogout()); await sleep(1500);
  const after = await csOnDevice(page);
  ok('G3: logout (ssOnLogout) clears the Career Score copies on this device', after.length === 0, after.slice(0, 5));
  ok('G3: and forgets the scope', (await csState(page)) === null);
  await ctx.close();
}
// ---- スタッフ
{
  const { ctx, page, errors } = await open('crew');
  const c = byId(D.login.crewId);
  await login(page, D.login.crewStore, D.login.crew);
  const st = await csState(page), keys = await csOnDevice(page);
  ok('crew: only self', st && st.level === 'scoped' && JSON.stringify(st.names) === JSON.stringify([c.name]), st && st.names);
  ok('crew: only their own rows on the device', keys.every(k => k === 'lss_scores' || k.endsWith(c.name)), keys);
  const len = await goPage(page, 'mypage');
  ok('crew: My page opens', len > 20, len);
  ok('crew: no page errors', errors.length === 0, errors);
  await ctx.close();
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const ng = results.filter(r => !r.ok).length;
console.log((results.length - ng) + '/' + results.length);
process.exit(ng ? 1 : 0);
