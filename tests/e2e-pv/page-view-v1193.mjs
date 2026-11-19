// v1193（UI案95）「画面の表示」を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない・名前はすべて作りもの）。
// 模擬サーバーは SS_REAL=1（本物の関数 secure-state をつなぐ）。pv_doc・pv_log・rpc/pv_save は mock-api.mjs が SQL と同じ答えを返す。
// ・GM（1280px・日本語）：承認・閲覧設定 › 画面の表示 → 初めの値（「まだ保存されていません」・「新・見るだけ」の印）→ G3 の 1 画面を非表示 → 理由 → 保存 → 版 1・変更の記録
// ・経理（本部）：メニューに新しい画面・見るだけの画面に帯・帯の画面の保存は止まる・今までの画面は帯なし
// ・事務Crew：ダッシュボードが見るだけ・店舗マスターは出ない
// ・G3：GM が隠した画面がメニューに無く、開けない
// ・GM（390px・英語）：スマホは見るだけ・横にはみ出ない
// 使い方：模擬サーバー（tests/perf/server.mjs）を SS_REAL=1 DATA_FILE=<合成データ> で動かしてから  DATA_FILE=<合成データ> node page-view-v1193.mjs [結果の JSON]
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const emps = D.tables.employees.map(e => ({ id: e.id, name: e.name, role: e.role || (e.data || {}).role, store: e.store || (e.data || {}).store }));
const byRole = r => emps.find(e => e.role === r);

async function open(tag, vp, locale, touch) {
  const dir = '/tmp/pvcheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: vp || { width: 1280, height: 860 }, hasTouch: !!touch, isMobile: !!touch, locale: locale || 'ja-JP', timezoneId: 'Pacific/Honolulu' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => { d.dismiss().catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors };
}
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(2500);
}
const nav = page => page.evaluate(() => Array.from(groupsForRole()).flatMap(g => Array.from(g.children)).filter(p => navChildAllowed(p)));
const navGroups = page => page.evaluate(() => Array.from(groupsForRole()).map(g => g.id));
const goPage = async (page, p) => { await page.evaluate(x => go(x), p); await sleep(1500); return page.evaluate(() => curPage); };
const band = page => page.evaluate(() => !!document.getElementById('pv-ro-band'));
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const pvState = page => page.evaluate(() => (window.FUNERGY_PV ? FUNERGY_PV._P().state : 'none'));

let hidPid = '';
// ---- 1. GM（1280px・日本語）：初めの値を確かめて保存
{
  const { ctx, page, errors } = await open('gm');
  await login(page, 'OFFICE', D.login.gm);
  await page.evaluate(() => FUNERGY_PV.openEditor());
  await page.waitForSelector('.pv-tbl', { timeout: 60000 });
  await sleep(800);
  const txt = await page.evaluate(() => document.getElementById('pv-root').innerText);
  ok('GM: the tab opens with the starting values (not saved yet)', /まだ保存されていません/.test(txt) && /初めの値を確かめて保存します/.test(txt));
  const badges = await page.evaluate(() => ({ crew: document.querySelectorAll('.pv-new').length, crewOnly: Array.from(document.querySelectorAll('.pv-new')).filter(x => /事務Crew は見るだけ/.test(x.textContent)).length,
    all: Array.from(document.querySelectorAll('.pv-new')).filter(x => /新・見るだけ/.test(x.textContent)).length, ml: document.querySelectorAll('.pv-ml').length }));
  ok('GM: the accounting column shows view-only marks (office crew / new) and the M・L mark', badges.crewOnly > 0 && badges.all > 0 && badges.ml >= 1, badges);
  // G3 の列で今出ている画面を 1 つ非表示に
  hidPid = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.pv-c.s')).find(x => /cell\('g3','p:(?!mypage)/.test(x.getAttribute('onclick') || '') && !/dashboard|mypage/.test(x.getAttribute('onclick')));
    if (!b) return '';
    const pid = /p:([\w-]+)/.exec(b.getAttribute('onclick'))[1]; b.click(); return pid;
  });
  await sleep(300);
  const ch = await page.evaluate(p => { const b = Array.from(document.querySelectorAll('.pv-c')).find(x => (x.getAttribute('onclick') || '') === "FUNERGY_PV.h.cell('g3','p:" + p + "')"); return b ? { cls: b.className, txt: b.textContent } : null; }, hidPid);
  ok('GM: tapping a G3 cell switches it to hidden and marks it changed', !!hidPid && ch && /\bh\b/.test(ch.cls) && /\bch\b/.test(ch.cls), { hidPid, ch });
  await page.fill('.pv-bar textarea', '合成データの確かめ（G3 から 1 画面を外す）');
  await page.click('.pv-bar .btn-primary');
  await page.waitForFunction(() => FUNERGY_PV._E().ver === 1 && !FUNERGY_PV._E().busy, null, { timeout: 30000 });
  await sleep(1200);
  const e = await page.evaluate(() => { const E = FUNERGY_PV._E(); return { ver: E.ver, first: E.first, txt: document.getElementById('pv-root').innerText.slice(0, 300) }; });
  ok('GM: saved as version 1 (no longer the starting values)', e.ver === 1 && !e.first && /版 1/.test(e.txt), e);
  await page.evaluate(() => FUNERGY_PV.h.sub('log'));
  await page.waitForFunction(() => /合成データの確かめ/.test(document.getElementById('pv-root').innerText), null, { timeout: 30000 });
  ok('GM: the history tab lists the save with its reason', true);
  await page.evaluate(() => FUNERGY_PV.h.sub('staff'));
  await sleep(300);
  const sOpts = await page.evaluate(() => document.querySelectorAll('#pv-root select option').length);
  ok('GM: the staff tab lists people to check', sOpts > 5, sOpts);
  ok('GM 1280px: no horizontal overflow of the page', (await overflow(page)) <= 1, await overflow(page));
  ok('GM: GM nav unchanged by the settings (pv not applied to GM)', (await nav(page)).includes(hidPid));
  ok('GM: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- 2. 経理（本部）
{
  const acc = byRole('office');
  const { ctx, page, errors } = await open('acct');
  await login(page, 'OFFICE', acc.name);
  await page.waitForFunction(() => window.FUNERGY_PV && FUNERGY_PV._P().state === 'on', null, { timeout: 30000 }).catch(() => {});
  ok('accountant: the settings arrived (state on)', (await pvState(page)) === 'on', await pvState(page));
  const n = await nav(page);
  ok('accountant: new screens are in the menu (shift_admin, dashboard, store_master, inventory)', ['shift_admin', 'dashboard', 'store_master', 'inventory'].every(p => n.includes(p)), n);
  const cp = await goPage(page, 'shift_admin');
  ok('accountant: shift_admin opens with the view-only band', cp === 'shift_admin' && await band(page), cp);
  // 帯の画面の中で押したあと、同期するデータの保存は止まる（ベストエフォート）
  const w = await page.evaluate(async () => {
    const k = ['tasks_all', 'm_employees', 'notifications_x'].find(x => FUNERGY_PV._syncKey(x)) || '';
    const before = localStorage.getItem(k);
    document.getElementById('pv-ro-band').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const r = lsSet(k, before == null ? [] : JSON.parse(before));
    return { k, r, same: localStorage.getItem(k) === before, toast: (document.body.innerText.match(/見るだけです/) || [''])[0] };
  });
  ok('accountant: a synced save pressed on a view-only screen is stopped', !!w.k && w.r === false && w.same, w);
  const cp2 = await goPage(page, 'inventory');
  ok('accountant: inventory (already open when picking a store) has no band', cp2 === 'inventory' && !(await band(page)), cp2);
  ok('accountant: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- 3. 事務Crew
{
  const oc = byRole('office_crew');
  const { ctx, page, errors } = await open('crew');
  await login(page, 'OFFICE', oc.name);
  await page.waitForFunction(() => window.FUNERGY_PV && FUNERGY_PV._P().state === 'on', null, { timeout: 30000 }).catch(() => {});
  const n = await nav(page);
  ok('office crew: dashboard in the menu, store_master not (code guard)', n.includes('dashboard') && !n.includes('store_master'), n);
  const cp = await goPage(page, 'dashboard');
  ok('office crew: dashboard is view only (band)', cp === 'dashboard' && await band(page), cp);
  const g = await navGroups(page);
  ok('office crew: dashboard and store operations go in the new group pv_g_dash', g.includes('pv_g_dash'), g);
  ok('office crew: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- 4. G3（Store Leader）
{
  const sl = emps.find(e => e.id === D.login.slId);
  const { ctx, page, errors } = await open('g3');
  await login(page, D.login.slStore, sl.name);
  await page.waitForFunction(() => window.FUNERGY_PV && FUNERGY_PV._P().state === 'on', null, { timeout: 30000 }).catch(() => {});
  const col = await page.evaluate(() => FUNERGY_PV._myCol());
  const n = await nav(page);
  ok('G3: in the G3 column and the screen GM hid is not in the menu', col === 'g3' && !n.includes(hidPid), { col, hidPid });
  const cp = await goPage(page, hidPid);
  ok('G3: the hidden screen does not open', cp !== hidPid, cp);
  ok('G3: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- 5. GM（390px・英語・タッチのスマホ。タッチでない 390px の窓は、どの画面も前から 4px 横に出る＝v1176 の記録）
{
  const { ctx, page, errors } = await open('gm-sp', { width: 390, height: 844 }, 'en-US', true);
  await login(page, 'OFFICE', D.login.gm);
  await page.evaluate(() => { try { setLang && setLang('en'); } catch (e) {} });
  await page.evaluate(() => FUNERGY_PV.openEditor());
  await page.waitForSelector('.pv-tbl', { timeout: 60000 });
  await sleep(800);
  const s = await page.evaluate(() => ({ txt: document.getElementById('pv-root').innerText, dis: Array.from(document.querySelectorAll('.pv-c')).every(b => b.disabled) }));
  ok('GM 390px: phone notice and every cell is disabled', /(スマホでは見るだけです|On a phone this is view only)/.test(s.txt) && s.dis);
  ok('GM 390px: no horizontal overflow of the page', (await overflow(page)) <= 1, await overflow(page));
  ok('GM 390px: no page errors', errors.length === 0, errors);
  await ctx.close();
}
const fails = results.filter(r => !r.ok);
console.log((results.length - fails.length) + '/' + results.length + ' OK');
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(fails.length ? 1 : 0);
