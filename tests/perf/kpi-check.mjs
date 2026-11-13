// v1153（UI案70）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない・名前はすべて作りもの）。
// ・GM（1280px・日本語）：KPI設定 › 目標と実績（店舗 × 月）・目標を入れて保存 → クラウドの kpi_man_<YYYY.M> に欄だけ入る
//   → 次の月は引き継ぐ・前の月は変わらない・範囲の外は保存しない・会議タブの Google の口コミ（その月の平均）
// ・G4（自店）：ダッシュボードに店舗責任の KPI のカード／G3・スタッフ：現場の重点 KPI のカード
// ・GM（390px・英語）：同じ表が横にはみ出ない
// 使い方：
//   node kpi-check.mjs prep <元の合成データ> <出力>
//   模擬サーバー（server.mjs）を DATA_FILE=<出力> で動かしてから  DATA_FILE=<出力> node kpi-check.mjs [結果の JSON]
import fs from 'node:fs';
if (process.argv[2] === 'prep') {
  const d = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const at = '2026-11-01T09:00:00.000000+00:00';
  // 先月（10 月）に Google の口コミ（その月の平均）と目標を入れておく（会議タブの表示を見る）。今月は Google の平均だけ
  d.tables.app_state = d.tables.app_state.filter(r => !/^kpi_man_2026\.1[01]$/.test(r.key));
  d.tables.app_state.push({ key: 'kpi_man_2026.10', updated_at: at, value: { F01: { gAvg: 4.6, gCnt: 9, reviewScore: 4.4, gTotalCnt: 812, tgt_reviewScore: 4.5 } } });
  d.tables.app_state.push({ key: 'kpi_man_2026.11', updated_at: at, value: { F01: { gAvg: 4.8, gCnt: 4 }, F02: { gAvg: 4.2, gCnt: 3 } } });
  fs.writeFileSync(process.argv[4], JSON.stringify(d));
  console.log('prepared');
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
const row = async k => JSON.parse(await ctl('/__hr?key=' + encodeURIComponent(k)));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const sto = e => e.store || (e.data || {}).store;
const role = e => e.role || (e.data || {}).role;
const g4 = D.tables.employees.find(e => role(e) === 'g4' && sto(e) === 'F02');

async function open(tag, vp, lang) {
  const dir = '/tmp/kpicheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: vp || { width: 1280, height: 860 }, locale: 'ja-JP', timezoneId: 'Pacific/Honolulu' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => { d.accept().catch(() => {}); });
  if (lang) await page.addInitScript(l => { try { localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
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
const text = page => page.evaluate(() => document.getElementById('main-content').innerText);
const html = page => page.evaluate(() => document.getElementById('main-content').innerHTML);
async function goWait(page, p, re) {
  await page.evaluate(x => go(x), p);
  for (let i = 0; i < 40; i++) { await sleep(300); const t = await text(page); if (re.test(t)) return t; }
  return text(page);
}
const overflow = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
const toasts = page => page.evaluate(() => Array.from(document.querySelectorAll('.toast, #toast, [class*=toast]')).map(e => e.innerText).join(' | '));
const rowCount = page => page.evaluate(() => document.querySelectorAll('.k2-table .k2-row:not(.k2-head)').length);
const val = (page, id) => page.evaluate(id => { const e = document.getElementById(id); return e ? e.value : null; }, id);
async function pickMonth(page, ym) {
  await page.evaluate(ym => { window._k2Ym = ym; renderPage('kpi_master'); }, ym);
  await sleep(600);
}
async function save(page) {
  await page.locator('button', { hasText: '目標を保存' }).first().click();
  await sleep(1500);
}

// ---- GM（PC・日本語）
{
  const { ctx, page, errors } = await open('gm');
  await login(page, 'OFFICE', D.login.gm);
  await page.evaluate(() => { window._kpiTab = 'store'; window._kpiStore = 'F01'; window._k2Ym = null; });
  const t = await goWait(page, 'kpi_master', /アップグレード率/);
  ok('GM: the page is called KPI設定 and opens on 目標と実績', /KPI設定/.test(t) && /目標と実績/.test(t));
  ok('GM: 11 KPIs for the store and month', (await rowCount(page)) === 11, await rowCount(page));
  for (const s of ['売上', '客数', '客単価', 'リピート率', '原価率', '人件費率', '総労働時間', 'ドリンク比率', 'アップグレード率', 'いくらシャワー率', 'Googleレビュー']) ok('GM: row ' + s, t.includes(s));
  ok('GM: role column (現場／管理)', /現場/.test(t) && /管理/.test(t));
  ok('GM: no 味噌汁UP率 as a row name', !/^味噌汁UP率/m.test(t));
  ok('GM: sales has a number from the meeting (actual to yesterday)', /\$[0-9,]{3,}/.test(t));
  // 目標を入れて保存
  await page.fill('#k2t-repeatRate', '35');
  await page.fill('#k2t-laborHours', '420');
  await page.fill('#k2t-reviewScore', '4.5');
  await save(page);
  const r1 = await row('kpi_man_2026.11');
  const f = (r1 || {}).F01 || {};
  ok('GM: saved to the cloud as month fields (the Google average stays)', f.tgt_repeatRate === 35 && f.tgt_laborHours === 420 && f.gAvg === 4.8, f);
  ok('GM: Google target 4.5 equals the one carried from October, so it is not written again', !('tgt_reviewScore' in f) && (await val(page, 'k2t-reviewScore')) === '4.5', { f: f.tgt_reviewScore, box: await val(page, 'k2t-reviewScore') });
  ok('GM: other stores untouched', ((r1 || {}).F02 || {}).gAvg === 4.2 && !('tgt_repeatRate' in ((r1 || {}).F02 || {})));
  ok('GM: each field carries its own stamp (merge per field)', !!(f._ft && f._ft.tgt_repeatRate && f._ft.tgt_laborHours));
  const t2 = await text(page);
  ok('GM: labor hours shows the plan to date (open days)', /前日までの計画/.test(t2) && /営業日/.test(t2), (t2.match(/前日までの計画[^\n]*/) || [''])[0]);
  ok('GM: Google review this month is the month average ★4.8', /★4\.8/.test(t2));
  // 次の月は引き継ぐ・前の月は変わらない
  await pickMonth(page, '2026-12');
  ok('GM: December carries the November target (35)', (await val(page, 'k2t-repeatRate')) === '35', await val(page, 'k2t-repeatRate'));
  const t3 = await text(page);
  ok('GM: December says it is carried over', /前の月の目標を引き継いでいます/.test(t3));
  const chips3 = await page.evaluate(() => document.querySelectorAll('.k2-table .k2-chip').length);
  ok('GM: a later month is "これから" (not judged)', /これから/.test(t3) && chips3 === 0, { chips: chips3 });
  await pickMonth(page, '2026-10');
  ok('GM: October is not changed (no repeat target)', (await val(page, 'k2t-repeatRate')) === '', await val(page, 'k2t-repeatRate'));
  const t4 = await text(page);
  ok('GM: October shows the Google month average ★4.6 against 4.5', /★4\.6/.test(t4) && (await val(page, 'k2t-reviewScore')) === '4.5', await val(page, 'k2t-reviewScore'));
  // 範囲の外は保存しない
  await pickMonth(page, '2026-11');
  await page.fill('#k2t-repeatRate', '150');
  await save(page);
  const r2 = await row('kpi_man_2026.11');
  ok('GM: 150% is refused and nothing is written', ((r2 || {}).F01 || {}).tgt_repeatRate === 35, ((r2 || {}).F01 || {}).tgt_repeatRate);
  ok('GM: told why', /0〜100/.test(await toasts(page)), await toasts(page));
  // 空にすると前の月から（この月の欄を消す）
  await pickMonth(page, '2026-12');
  await page.fill('#k2t-repeatRate', '38');
  await save(page);
  ok('GM: December 38 saved', (((await row('kpi_man_2026.12')) || {}).F01 || {}).tgt_repeatRate === 38);
  await pickMonth(page, '2026-12');
  await page.fill('#k2t-repeatRate', '');
  await save(page);
  const r3 = (((await row('kpi_man_2026.12')) || {}).F01 || {});
  ok('GM: emptying December removes its own target', r3.tgt_repeatRate === undefined || r3.tgt_repeatRate === null, r3);
  await pickMonth(page, '2026-12');
  ok('GM: … and December carries November (35) again', (await val(page, 'k2t-repeatRate')) === '35');
  // 対象外
  await pickMonth(page, '2026-11');
  await page.evaluate(() => { const c = document.getElementById('k2o-drinkRate'); c.checked = false; });
  await save(page);
  ok('GM: drink set to 対象外 for November', (((await row('kpi_man_2026.11')) || {}).F01 || {}).off_drinkRate === true);
  const t5 = await text(page);
  ok('GM: the drink row says 対象外', /ドリンク比率[\s\S]{0,200}対象外/.test(t5));
  ok('GM: no horizontal overflow at 1280px', (await overflow(page)) <= 0, await overflow(page));
  // 会議タブ（F01・先月）：Google の口コミのカード
  await page.evaluate(() => { switchStore('F01'); });
  await sleep(800);
  await page.evaluate(() => { window._meetOffset = -1; window._meetMonthOffset = -1; });
  const tm = await goWait(page, 'meeting', /Googleレビュー|ランチ|客数/);
  ok('GM: the meeting tab has the Google review card', /Googleレビュー/.test(tm) && /この月の平均/.test(tm), (tm.match(/Googleレビュー[\s\S]{0,160}/) || [''])[0]);
  ok('GM: … and says the API is not used', /API はつなぎません/.test(tm));
  ok('GM: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- G4（自店 F02）：ダッシュボードに店舗責任の KPI
{
  const { ctx, page, errors } = await open('g4');
  await login(page, 'F02', g4.name);
  const t = await goWait(page, 'dashboard', /KPI/);
  ok('G4: dashboard shows the store KPI card', /の KPI/.test(t) && /店舗責任（G4・自店）/.test(t), (t.match(/[^\n]*の KPI[^\n]*/) || [''])[0]);
  ok('G4: … with sales, food cost, labor and hours', ['売上', '原価率', '人件費率', '総労働時間'].every(s => t.includes(s)));
  ok('G4: … and a way to KPI設定', /KPI設定を開く/.test(t));
  ok('G4: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- G3（Store Leader・F02）：現場の重点 KPI
{
  const { ctx, page, errors } = await open('sl');
  await login(page, D.login.slStore, D.login.sl);
  await sleep(1000);
  const t = await text(page);
  ok('SL: the floor KPI card (現場の重点 KPI)', /現場の重点 KPI/.test(t), (t.match(/[^\n]*重点 KPI[^\n]*/) || [''])[0]);
  ok('SL: … no store KPIs as rows (売上 / 原価率 in the note only)', !/\n原価率\n/.test(t));
  ok('SL: Google is 見るだけ', /見るだけ/.test(t));
  ok('SL: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- スタッフ（F01）：マイページに現場の重点 KPI
{
  const { ctx, page, errors } = await open('crew');
  await login(page, D.login.crewStore, D.login.crew);
  const t = await goWait(page, 'mypage', /重点 KPI|マイページ|My/);
  ok('Crew: my page has the floor KPI card', /現場の重点 KPI/.test(t));
  ok('Crew: drink is not shown (対象外 for November)', !/ドリンク比率/.test((t.match(/現場の重点 KPI[\s\S]*?G4（店舗責任）の KPI です/) || [''])[0]));
  ok('Crew: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- GM（スマホ 390px・英語）
{
  const { ctx, page, errors } = await open('gm-en', { width: 390, height: 844 }, 'en');
  await login(page, 'OFFICE', D.login.gm);
  await page.evaluate(() => { window._kpiTab = 'store'; window._kpiStore = 'F01'; window._k2Ym = null; });
  const t = await goWait(page, 'kpi_master', /Upgrade/);
  ok('EN 390: KPI settings in English', /KPI settings/.test(t) && /Targets & actuals/.test(t) && /Upgrade rate/.test(t), t.slice(0, 200));
  ok('EN 390: 11 rows as cards', (await rowCount(page)) === 11);
  ok('EN 390: no horizontal overflow', (await overflow(page)) <= 0, await overflow(page));
  ok('EN 390: the saved November target is there (35)', (await val(page, 'k2t-repeatRate')) === '35');
  ok('EN 390: no page errors', errors.length === 0, errors);
  await ctx.close();
}
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} OK`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(bad.length ? 1 : 0);
