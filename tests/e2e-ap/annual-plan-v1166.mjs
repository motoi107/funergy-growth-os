// v1166（UI案78）：予実管理 › 年間計画 を本物のブラウザ（Chromium）で確かめる。模擬サーバー（tests/perf/server.mjs）と合成データだけ（本番にはつながない・名前と金額は作りもの）。
// ・GM（PC 1280px・日本語）：Store A（F01）の 7〜12 月の表（依頼書の数字：7月 予算 $100,000・実績 $110,000 …）・累計・Q 小計・進行中の 11 月・12 月は予定
//   → 1 店 × 確定月（9 月＝アプリの日次・10 月＝会計PL）を、今の画面の関数（KPI設定・会議の k2Actuals、日次進捗の cumulativeToToday、会議の昨年 _plPrevYear）と照らし合わせる
//   → 指標の切り替え・店の切り替え（前の店の数字が残らない）・全店（店の数の注記・欠損あり）・年の切り替え・表が横にはみ出ない
// ・GM（iPhone 390px）：月・実績・単月差・累計差の行 → 8 月・11 月を広げる・横にはみ出ない
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/shots1166] node tests/e2e-ap/annual-plan-v1166.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const APP = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

/* ---- 合成データ（今日＝ハワイの今日。2026 年の 7 月から予算） ---- */
const now = new Date(Date.now() - 10 * 3600e3), TODAY = now.toISOString().slice(0, 10);
const dim = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const iso = (ym, d) => ym + '-' + String(d).padStart(2, '0');
/* total を from〜to 日にセント単位で配る（合計はぴったり） */
function spread(ym, total, from = 1, to = dim(ym)) {
  const o = {}, n = to - from + 1, each = Math.floor(total * 100 / n) / 100;
  for (let d = from; d <= to; d++) o[iso(ym, d)] = each;
  o[iso(ym, to)] = Math.round((total - each * (n - 1)) * 100) / 100;
  return o;
}
const DOW = () => ({ lunch: Array.from({ length: 7 }, () => ({ guests: 0, spend: 0 })), dinner: Array.from({ length: 7 }, () => ({ guests: 60, spend: 50 })), takeout: Array.from({ length: 7 }, () => ({ orders: 0, spend: 0 })) });
function budget(sid, months) {
  const m = {}; for (const [ym, days] of Object.entries(months)) m[ym] = { dow: DOW(), days };
  return [{ storeId: sid, period: '2026.11', status: '承認済み', approvedBy: 'Gabe Gm', actual: 0, dow: DOW(),
    segments: { lunch: { guests: 0, spend: 0, laborPct: 0, fcPct: 0 }, dinner: { guests: 1, spend: 100, laborPct: 28, fcPct: 30 }, takeout: { orders: 0, spend: 0 } }, months: m }];
}
function actuals(map, days, ppa = 52) { for (const [d, v] of Object.entries(days)) map[d] = { actual: v, guests: Math.round(v / ppa), dinnerSales: v, dinnerGuests: Math.round(v / ppa) }; return map; }
const daF01 = {}, daF02 = {}, daF06 = {};
for (let m = 1; m <= 6; m++) actuals(daF01, spread('2026-0' + m, 120000));
[['07', 110000], ['08', 105000], ['09', 112000], ['10', 119500]].forEach(([mm, a]) => actuals(daF01, spread('2026-' + mm, a)));
actuals(daF01, spread('2026-11', 52000, 1, 13)); daF01[TODAY] = { actual: 999.99, guests: 9 };   // 今日の途中（数えない）
['07', '08', '09', '10'].forEach(mm => actuals(daF02, spread('2026-' + mm, 50000)));
delete daF02['2026-09-12']; delete daF02['2026-09-20'];                                   // Store B の 9 月は 2 日取り込めていない
actuals(daF02, spread('2026-11', 20000, 1, 12));
actuals(daF06, spread('2026-09', 30000, 19, 30)); actuals(daF06, spread('2026-10', 60000)); actuals(daF06, spread('2026-11', 26000, 1, 13));
const B01 = budget('F01', { '2026-07': spread('2026-07', 100000), '2026-08': spread('2026-08', 120000), '2026-09': spread('2026-09', 110000), '2026-10': spread('2026-10', 115000),
  '2026-11': { ...spread('2026-11', 50000, 1, 13), ...spread('2026-11', 70000, 14, 30) }, '2026-12': spread('2026-12', 135000) });
const B02 = budget('F02', Object.fromEntries(['07', '08', '09', '10', '11', '12'].map(mm => ['2026-' + mm, spread('2026-' + mm, 50000)])));
const B06 = budget('F06', { '2026-09': spread('2026-09', 24000, 19, 30), '2026-10': spread('2026-10', 62000), '2026-11': spread('2026-11', 60000), '2026-12': spread('2026-12', 70000) });
// 9/18 までは開店前（予算は 0）。区分の月の日割りで予算が出ないよう、その日は 0 を入れる
for (let d = 1; d <= 18; d++) B06[0].months['2026-09'].days[iso('2026-09', d)] = 0;
const at = new Date().toISOString();
const STORES = [['F01', 'Store A', 'Brand A'], ['F02', 'Store B', 'Brand B'], ['F06', 'Store C', 'Brand C']].map(([id, name, brand]) => ({ id, name, brand, color: '#335577', am: '', toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
const PEOPLE = [['e1', 'Cora Ceo', 'ceo', 'ALL'], ['e2', 'Gabe Gm', 'gm', 'ALL'], ['e10', 'Cam Crew', 'crew', 'F01']];
const data = { tables: {
  app_state: [
    { key: 'spl_budgets_v2_F01', value: B01, updated_at: at }, { key: 'spl_budgets_v2_F02', value: B02, updated_at: at }, { key: 'spl_budgets_v2_F06', value: B06, updated_at: at },
    { key: 'daily_actuals_F01', value: daF01, updated_at: at }, { key: 'daily_actuals_F02', value: daF02, updated_at: at }, { key: 'daily_actuals_F06', value: daF06, updated_at: at },
    { key: 'pl_public', value: { '2026-10': { F01: { sales: 119800, cogs: 35940, payroll: 33544, prov: true } } }, updated_at: at },
    { key: 'ing_v2_backfill_done', value: true, updated_at: at }, { key: 'ing_v2_storeprice_fix', value: true, updated_at: at },
  ],
  app_settings: [], employees: PEOPLE.map(([id, name, role, store]) => ({ id, name, role, data: { id, name, role, store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: role.toUpperCase(), firstWorkDate: '2025-01-10' } })),
  stores: STORES.map(s => ({ id: s.id, data: s })), ingredients: [], recipes: [], vendors: [], categories: [],
  toast_sales: [], tip_labor: [], toast_item_sales: [], shift_availability: [], shift_plans: [], manager_auth: [], handbook_test_results: [],
} };
const DATA_FILE = '/tmp/ap1166-data.json';
fs.writeFileSync(DATA_FILE, JSON.stringify(data));

let srv = null;
process.on('exit', () => { try { srv && srv.kill('SIGTERM'); } catch (e) { } });
srv = spawn('node', [path.join(ROOT, 'tests/perf/server.mjs')], { env: { ...process.env, APP_DIR: ROOT, DATA_FILE }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/ready/.test(String(d))) res(); }); srv.once('exit', c => rej(new Error('server exit ' + c))); });

async function open(tag, vp, mobile) {
  const dir = '/tmp/ap1166-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: vp, isMobile: !!mobile, hasTouch: !!mobile, deviceScaleFactor: mobile ? 2 : 1, locale: 'ja-JP', timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 0, null, { timeout: 120000 });
  await page.evaluate(() => loginPickLocation('OFFICE'));
  await page.locator('#login-name-grid .store-btn', { hasText: 'Gabe Gm' }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(1500);
  return { ctx, page, errors };
}
async function annual(page, store, metric, year) {
  await page.evaluate(([s, m, y]) => { _budgetStore = s; _apMetric = m || 'sales'; if (y) _apY = y; budgetTab = 'annual'; go('budget'); }, [store, metric, year]);
  await page.waitForFunction(() => !!document.querySelector('.ap-tbl') || /見られる店舗がありません/.test(document.getElementById('main-content').innerText), null, { timeout: 20000 });
  await sleep(500);
}
const rowsPc = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ap-tbl tr[data-ym]')].map(tr => [tr.dataset.ym, [...tr.cells].map(td => td.innerText.replace(/\s+/g, ' ').trim())])));
const qRow = (page, q) => page.evaluate(q => { const tr = [...document.querySelectorAll('.ap-tbl tr.q')].find(r => r.getAttribute('onclick').indexOf(',' + q + ')') > 0); return tr ? [...tr.cells].map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null; }, q);
const mainText = page => page.evaluate(() => document.getElementById('main-content').innerText);
const shot = async (page, name, full = true) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name), fullPage: full }); } };
const C = { st: 1, bud: 2, act: 3, diff: 4, rate: 5, py: 6, pyd: 7, pyr: 8, cum: 9 };

// ================= GM・PC =================
{
  const { ctx, page, errors } = await open('pc', { width: 1280, height: 900 });
  await annual(page, 'F01', 'sales', 2026);
  const R = await rowsPc(page);
  // 前年（会議の「昨年」行と同じ関数）
  const PY = await page.evaluate(() => Object.fromEntries(['07', '08', '09', '10', '11', '12'].map(mm => [mm, _plPrevYear('F01', '2026-' + mm).sales])));
  const f$ = v => '$' + Math.round(v).toLocaleString('en-US'), s$ = v => (Math.round(v) > 0 ? '＋' : Math.round(v) < 0 ? '−' : '±') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const sp = v => { const r = Math.round(v * 10) / 10; return (r > 0 ? '＋' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(1) + '%'; };
  ok('7月：予算 $100,000・実績 $110,000・単月 ＋$10,000・110.0%・累計 ＋$10,000', R['2026-07'][C.bud] === '$100,000' && /^\$110,000/.test(R['2026-07'][C.act]) && R['2026-07'][C.diff] === '＋$10,000' && R['2026-07'][C.rate] === '110.0% ✓ 達成' && R['2026-07'][C.cum] === '＋$10,000', R['2026-07']);
  ok('7月：前年同月＝会議の昨年（2025 年の確定 PL）・前年差・増減率', R['2026-07'][C.py] === f$(PY['07']) && R['2026-07'][C.pyd] === s$(110000 - PY['07']) && R['2026-07'][C.pyr] === sp((110000 / PY['07'] - 1) * 100), [R['2026-07'][C.py], R['2026-07'][C.pyd], R['2026-07'][C.pyr]]);
  ok('8月：−$15,000・87.5%・7〜8月の累計 −$5,000', R['2026-08'][C.diff] === '−$15,000' && R['2026-08'][C.rate] === '87.5% ▼ 未達' && R['2026-08'][C.cum] === '−$5,000', R['2026-08']);
  ok('9月：＋$2,000・累計 −$3,000（四半期をまたいでも続く）', R['2026-09'][C.diff] === '＋$2,000' && R['2026-09'][C.cum] === '−$3,000', R['2026-09']);
  ok('10月：会計PL（暫定）を使う $119,800・暫定PL の印・累計 ＋$1,800（Q4 に入ってもリセットしない）', /^\$119,800\s*暫定PL/.test(R['2026-10'][C.act]) && R['2026-10'][C.diff] === '＋$4,800' && R['2026-10'][C.cum] === '＋$1,800', R['2026-10']);
  const pyTd = await page.evaluate(() => { let s = 0; for (let d = 1; d <= 13; d++) s += pyDay('F01', '2025-11-' + String(d).padStart(2, '0')).s; return s; });
  const today = await page.evaluate(() => bizToday());
  const lastMD = today === '2026-11-14' ? '11/13' : null;
  ok('11月：進行中（取り込んだ最後の日まで）・計画比 ＋$2,000・月間予算の 43.3%・今日の途中の値は数えない', R['2026-11'][C.st] === '進行中 11/13' && R['2026-11'][C.act] === '$52,000 11/13 まで' && R['2026-11'][C.diff] === '月末確定時 計画比 ＋$2,000' && R['2026-11'][C.rate] === '43.3% 月間予算の', { today, row: R['2026-11'] });
  ok('11月：前年は同じ日まで（PY2025_DAILY）・前年差と増減率', R['2026-11'][C.py] === f$(pyTd) + ' 前年 11/13 まで' && R['2026-11'][C.pyd] === s$(52000 - pyTd) && R['2026-11'][C.pyr] === sp((52000 / pyTd - 1) * 100), { pyTd, row: R['2026-11'].slice(6, 9) });
  ok('11月：累計は確定と参考を分ける（確定 ＋$1,800・参考 ＋$3,800）', R['2026-11'][C.cum] === '確定 ＋$1,800 参考 ＋$3,800', R['2026-11'][C.cum]);
  ok('12月：予定・予算 $135,000・実績と差は「—」・累計に入れない', R['2026-12'][C.st] === '予定' && R['2026-12'][C.bud] === '$135,000' && R['2026-12'][C.act] === '—' && R['2026-12'][C.cum] === '—', R['2026-12']);
  const q3 = await qRow(page, 3), q4 = await qRow(page, 4);
  ok('Q3 小計：$330,000 ／ $327,000 ／ −$3,000 ／ 99.1%', q3 && q3[0] === 'Q3 小計（7〜9月）' && q3.slice(1, 5).join('|') === '$330,000|$327,000|−$3,000|99.1% ▼ 未達', q3);
  ok('Q4 小計：確定は 10月・Q4 予算 $370,000', q4 && q4[0] === 'Q4 小計（確定は 10月）' && q4[q4.length - 1] === 'Q4 予算 $370,000', q4);
  const tx = await mainText(page);
  ok('まとめ：7月〜10月の累計（最終確定月：10月・予算は 2026 年 7 月から）・累計実績 $446,800・累計予算 $445,000・累計差 ＋$1,800', /7月〜10月の累計（最終確定月：\s*10月\s*・予算は 2026 年 7 月から）/.test(tx) && /累計実績\s*\$446,800/.test(tx) && /累計予算\s*\$445,000/.test(tx) && /累計差\s*＋\$1,800/.test(tx));
  ok('進行中のカード：11/13 までの計画 $50,000 に対して ＋$2,000・月間予算の 43.3%', /11月は進行中（ハワイ 11\/13 まで取込）/.test(tx) && /11\/13 までの計画 \$50,000 に対して\s*＋\$2,000/.test(tx) && /月間予算の\s*43\.3%/.test(tx));
  ok('1〜6月は予算開始前（たたんだまま）', /1〜6月\s*予算開始前/.test(tx) && await page.evaluate(() => getComputedStyle(document.querySelector('tr[data-ym="2026-03"]')).display === 'none'));
  ok('PC：表は横にはみ出さない（1280px）', await page.evaluate(() => { const w = document.querySelector('.ap-tw'); return w.scrollWidth <= w.clientWidth + 1; }), await page.evaluate(() => { const w = document.querySelector('.ap-tw'); return [w.scrollWidth, w.clientWidth]; }));
  ok('PC：iPhone の行は出さない', await page.evaluate(() => [...document.querySelectorAll('.ap-ph')].every(e => getComputedStyle(e).display === 'none')));
  await shot(page, 'pc-F01-sales.png');
  await page.evaluate(() => apTogglePre()); await sleep(300);
  ok('1〜6月を広げる：月の実績と前年（予算とは比べない）', await page.evaluate(() => { const r = document.querySelector('tr[data-ym="2026-03"]'); return getComputedStyle(r).display !== 'none' && r.cells[2].innerText.trim() === '—' && /^\$120,000/.test(r.cells[3].innerText.trim()); }));
  await page.evaluate(() => apTogglePre()); await sleep(200);

  // ---- 照らし合わせ：1 店 × 確定月（9 月＝アプリの日次・10 月＝会計PL）
  const rec = await page.evaluate(() => {
    const st = [getVisibleStores().find(s => s.id === 'F01')], out = {};
    const r2 = v => v == null ? null : Math.round(v * 100) / 100;
    ['2026-09', '2026-10'].forEach((ym, i) => {
      const k = k2Actuals('F01', ym), row = key => k.rows.find(x => x.key === key) || {};
      const m = { sales: apModel(st, 2026, 'sales').months[8 + i], guests: apModel(st, 2026, 'guests').months[8 + i], ppa: apModel(st, 2026, 'ppa').months[8 + i], fc: apModel(st, 2026, 'fc').months[8 + i], labor: apModel(st, 2026, 'labor').months[8 + i] };
      const c = cumulativeToToday('F01', ym);
      out[ym] = {
        ap: { bs: r2(apVal('sales', m.sales.A, 'b')), as: r2(apVal('sales', m.sales.A, 'a')), bg: r2(apVal('guests', m.guests.A, 'b')), ag: r2(apVal('guests', m.guests.A, 'a')), bp: r2(apVal('ppa', m.ppa.A, 'b')), apa: r2(apVal('ppa', m.ppa.A, 'a')),
          bfc: r2(apVal('fc', m.fc.A, 'b')), afc: r2(apVal('fc', m.fc.A, 'a')), blb: r2(apVal('labor', m.labor.A, 'b')), alb: r2(apVal('labor', m.labor.A, 'a')), py: r2(m.sales.pyA.as) },
        k2: { bs: r2(row('sales').tgt), as: r2(row('sales').act), bg: r2(row('guests').tgt), ag: r2(row('guests').act), bp: r2(row('ppa').tgt), apa: r2(row('ppa').act),
          bfc: r2(row('foodCost').tgt), afc: r2(row('foodCost').act), blb: r2(row('laborPct').tgt), alb: r2(row('laborPct').act) },
        daily: { budMonth: r2(c.budMonth), actMonth: r2(c.actMonth), budSales: r2(monthSalesBudget('F01', ym)) }, py: r2(_plPrevYear('F01', ym).sales), conf: _meetConfirmState('F01', ym),
      };
    });
    return out;
  });
  const s = rec['2026-09'], o = rec['2026-10'];
  ok('照合 9月（アプリの日次）：売上の予算・実績＝KPI設定・会議（k2Actuals）＝日次進捗（cumulativeToToday）', s.ap.bs === s.k2.bs && s.ap.bs === s.daily.budMonth && s.ap.bs === s.daily.budSales && s.ap.as === s.k2.as && s.ap.as === s.daily.actMonth && s.ap.as === 112000, s);
  ok('照合 9月：客数・客単価の予算と実績＝KPI設定・会議', s.ap.bg === s.k2.bg && s.ap.ag === s.k2.ag && s.ap.bp === s.k2.bp && s.ap.apa === s.k2.apa, { ap: s.ap, k2: s.k2 });
  ok('照合 9月：原価率・人件費率の予算の率と実績＝KPI設定・会議', s.ap.bfc === s.k2.bfc && s.ap.afc === s.k2.afc && s.ap.blb === s.k2.blb && s.ap.alb === s.k2.alb, { ap: s.ap, k2: s.k2 });
  ok('照合 9月：前年同月＝会議の昨年（_plPrevYear）', s.ap.py === s.py, [s.ap.py, s.py]);
  ok('照合 10月（会計PL）：実績は PL の $119,800＝KPI設定・会議（日次進捗はアプリの日次 $119,500 のまま）', o.conf === 'final' && o.ap.as === 119800 && o.ap.as === o.k2.as && o.daily.actMonth === 119500 && o.ap.bs === o.k2.bs && o.ap.bs === o.daily.budMonth, o);
  ok('照合 10月：原価率・人件費率は PL の率＝KPI設定・会議', o.ap.afc === o.k2.afc && o.ap.alb === o.k2.alb && o.ap.afc === 30 && o.ap.alb === 28, { ap: o.ap, k2: o.k2 });

  // ---- 描く時間（参考・合成データ 3 店。原価率・人件費率は店・月ごとに k2Actuals を使う）
  const ms = await page.evaluate(() => { const o = {}; ['sales', 'fc'].forEach(m => { _apMetric = m; _budgetStore = 'ALL'; mdCacheClear(); const t0 = performance.now(); renderAnnualPlan(); o[m] = Math.round(performance.now() - t0); }); _apMetric = 'sales'; _budgetStore = 'F01'; return o; });
  console.log('INFO render ms (3 stores, all months):', JSON.stringify(ms));
  // ---- 指標の切り替え
  for (const [m, re] of [['guests', /当月実績/], ['ppa', /予算の客単価/], ['fc', /予算の率/], ['labor', /予算の率/]]) {
    await page.evaluate(m => setApMetric(m), m); await sleep(400);
    const h = await page.evaluate(() => [...document.querySelectorAll('.ap-tbl th')].map(t => t.innerText).join('|'));
    ok('指標を ' + m + ' に：表の見出しが変わり、ボタンが選ばれる', re.test(h) && await page.evaluate(m => { const b = [...document.querySelectorAll('.ap-seg button')].find(x => x.classList.contains('on')); return !!b && b.getAttribute('onclick').indexOf("'" + m + "'") > 0; }, m), h);
  }
  const fcR = await rowsPc(page);
  ok('人件費率：10月は PL の率 28.0%（予算 28.0%）・差 ±0.0pt', fcR['2026-10'] && /^28\.0%/.test(fcR['2026-10'][C.act]) && fcR['2026-10'][C.bud] === '28.0%', fcR['2026-10']);
  await shot(page, 'pc-F01-labor.png', false);
  await page.evaluate(() => setApMetric('guests')); await sleep(300);
  ok('客数：前年は出さない注記', /客数・客単価の前年は、会計PL に客数が無いので出しません/.test(await mainText(page)));
  await page.evaluate(() => setApMetric('sales')); await sleep(300);

  // ---- 店の切り替え（前の店の数字が残らない）
  await page.evaluate(() => setBudgetStore('F02')); await sleep(600);
  const t2 = await mainText(page), R2 = await rowsPc(page);
  ok('Store B に替えると Store A の数字は残らない', !/\$110,000|\$446,800|\$119,800|＋\$1,800/.test(t2) && R2['2026-07'][C.bud] === '$50,000', R2['2026-07']);
  ok('Store B の 9月：未取込 2 日（9/12・9/20）・欠損あり・その月から先の累計は灰色', R2['2026-09'][C.st] === '欠損あり' && /未取込 2 日（9\/12・9\/20）/.test(R2['2026-09'][C.act]) && /欠損あり$/.test(R2['2026-09'][C.cum]) && /欠損あり$/.test(R2['2026-10'][C.cum]), R2['2026-09']);
  ok('Store B の 11月：11/12 まで（その店の最後の取込の日）', R2['2026-11'][C.st] === '進行中 11/12', R2['2026-11'][C.st]);
  await page.evaluate(() => setBudgetStore('F06')); await sleep(600);
  const R6 = await rowsPc(page);
  ok('Store C（新店）：前年実績なし・前年差は「—」', R6['2026-10'][C.py] === '— 前年実績なし' && R6['2026-10'][C.pyd] === '—', R6['2026-10']);
  ok('Store C：開店前の 7・8 月（実績が無く予算は店の共通設定だけ）は「実績なし」・数えない・表の上に出す', R6['2026-07'][C.st] === '実績なし' && R6['2026-07'][C.bud] === '—' && R6['2026-08'][C.st] === '実績なし' && /開店前として数えない月：1〜8月/.test(await mainText(page)), R6['2026-07']);
  ok('Store C：累計は 9 月から（開店前の月を欠損にしない）', !/欠損あり/.test(R6['2026-10'][C.cum]) && R6['2026-10'][C.cum] === s$(30000 - 24000 + 60000 - 62000), R6['2026-10'][C.cum]);
  // ---- 全店
  await page.evaluate(() => setBudgetStore('ALL')); await sleep(800);
  const tA = await mainText(page), RA = await rowsPc(page);
  ok('全店：今年 3 店・前年 2 店（Store C は前年なし）の注記', /今年 3 店・前年 2 店（Store C は前年なし）。前年比は前年もある店どうしで比べます/.test(tA));
  ok('全店：9 月は Store B（TK）の未取込で欠損あり（店の印つき）・7 月は欠損にしない（Store C は開店前）', RA['2026-09'][C.st] === '欠損あり' && /TK 未取込 2 日（9\/12・9\/20）/.test(RA['2026-09'][C.act]) && RA['2026-07'][C.st] === '確定', [RA['2026-09'][C.act], RA['2026-07'][C.st]]);
  ok('全店：前年は前年もある店どうし（9 月の前年同月に「2 店」）', /2 店$/.test(RA['2026-09'][C.py]), RA['2026-09'][C.py]);
  ok('全店：進行中の月は遅れている店を書く', /11\/12 までの店があります/.test(tA));
  ok('全店：表は横にはみ出さない（未取込の日・出どころの印があっても）', await page.evaluate(() => { const w = document.querySelector('.ap-tw'); return w.scrollWidth <= w.clientWidth + 1; }), await page.evaluate(() => { const w = document.querySelector('.ap-tw'); return [w.scrollWidth, w.clientWidth]; }));
  await shot(page, 'pc-ALL-sales.png');
  // ---- 年の切り替え
  await page.evaluate(() => setBudgetStore('F01')); await sleep(300);
  await page.evaluate(() => setApYear(1)); await sleep(800);
  const t27 = await mainText(page);
  ok('2027 年：予算の開始月は予算が入った最初の月（決めていない年）・まだ確定した月はない', /2027 年/.test(t27) && /まだ確定した月がありません/.test(t27), (t27.match(/まだ確定[^\n]*/) || [''])[0]);
  await page.evaluate(() => setApYear(1)); await sleep(300);
  ok('2028 年には進まない（来年まで）', /2027 年/.test(await mainText(page)));
  await page.evaluate(() => { setApYear(-1); }); await sleep(300); await page.evaluate(() => setApYear(-1)); await sleep(300);
  ok('2025 年には戻らない（2026 年から）', /2026 年/.test(await mainText(page)) && await page.evaluate(() => document.querySelector('.ap-head button[aria-label="前の年"]').disabled));
  // 月・Q のリンク
  await page.evaluate(() => planGoQuarter(2026, 3)); await sleep(500);
  ok('Q 小計を押すと Qコミットビュー（店はそのまま）', await page.evaluate(() => budgetTab === 'quarter' && _qbStore === 'F01' && _qbQ === 3));
  ok('PC：ページのエラー 0', errors.length === 0, errors);
  await ctx.close();
}

// ================= GM・iPhone =================
{
  const { ctx, page, errors } = await open('ph', { width: 390, height: 844 }, true);
  await annual(page, 'F01', 'sales', 2026);
  ok('iPhone：表（PC）は出さず、行を出す', await page.evaluate(() => getComputedStyle(document.querySelector('.ap-tbl').closest('.ap-pc')).display === 'none' && [...document.querySelectorAll('.ap-ph')].some(e => getComputedStyle(e).display !== 'none')));
  ok('iPhone：横にはみ出さない', await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth <= 1), await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth));
  const sum = await page.evaluate(() => [...document.querySelectorAll('details.ap-pm > summary')].map(s => s.innerText.replace(/\s+/g, ' ').trim()));
  ok('iPhone：8月の行は 月・実績・単月差・累計差', sum.includes('8月 $105,000 −$15,000 −$5,000'), sum);
  ok('iPhone：店舗と年の選択・指標のチップ', await page.evaluate(() => !!document.querySelector('.ap-ph select[aria-label="店舗"]') && !!document.querySelector('.ap-ph select[aria-label="年"]') && document.querySelectorAll('.ap-chips button').length === 5));
  await shot(page, 'ph-F01-list.png');
  await page.evaluate(() => { const s = [...document.querySelectorAll('details.ap-pm > summary')].find(x => /^8月/.test(x.innerText.trim())); s.click(); }); await sleep(300);
  const body8 = await page.evaluate(() => { const d = [...document.querySelectorAll('details.ap-pm')].find(x => /^8月/.test(x.querySelector('summary').innerText.trim())); return d.open ? d.querySelector('.ap-px').innerText.replace(/\s+/g, ' ') : ''; });
  ok('iPhone：8月を広げる → 月間予算 $120,000・達成率 87.5%・累計予算（7〜8月）$220,000・累計実績 $215,000', /月間予算 \$120,000/.test(body8) && /達成率 87\.5%/.test(body8) && /累計予算（7〜8月） \$220,000/.test(body8) && /累計実績（7〜8月） \$215,000/.test(body8), body8);
  await page.evaluate(() => document.querySelector('details.ap-pm[open]').scrollIntoView({ block: 'center' }));
  await shot(page, 'ph-F01-aug-open.png', false);
  await page.evaluate(() => { const s = [...document.querySelectorAll('details.ap-pm > summary')].find(x => /^8月/.test(x.innerText.trim())); s.click(); }); await sleep(200);
  ok('iPhone：もう一度押すとたたむ', await page.evaluate(() => ![...document.querySelectorAll('details.ap-pm')].find(x => /^8月/.test(x.querySelector('summary').innerText.trim())).open));
  await page.evaluate(() => { const s = [...document.querySelectorAll('details.ap-pm.cur > summary')][0]; s.click(); }); await sleep(300);
  const b11 = await page.evaluate(() => document.querySelector('details.ap-pm.cur').innerText.replace(/\s+/g, ' '));
  ok('iPhone：進行中の 11月を広げる → 計画との差 ＋$2,000・月間予算・到達 43.3%・累計（参考）', /進行中・ハワイ 11\/13 まで取込/.test(b11) && /計画との差 ＋\$2,000/.test(b11) && /\$120,000・43\.3%/.test(b11) && /累計（参考） ＋\$3,800/.test(b11), b11);
  await page.evaluate(() => document.querySelector('details.ap-pm.cur').scrollIntoView({ block: 'center' }));
  await shot(page, 'ph-F01-nov-open.png', false);
  ok('iPhone：12月は予定（累計に入れない）', /12月は予定：予算 \$135,000（累計に入れない）/.test(await mainText(page)));
  await page.selectOption('.ap-ph select[aria-label="店舗"]', 'F02'); await sleep(600);
  ok('iPhone：店を替えると前の店の数字が残らない', !/\$105,000|\$446,800/.test(await mainText(page)));
  ok('iPhone：ページのエラー 0', errors.length === 0, errors);
  await ctx.close();
}
const ng = results.filter(r => !r.ok).length;
console.log('\n' + (results.length - ng) + '/' + results.length + ' OK');
srv.kill('SIGTERM');
process.exit(ng ? 1 : 0);

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
