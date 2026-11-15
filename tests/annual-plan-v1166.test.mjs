// v1166（UI案78・Moto さん 11/14 の回答 1〜5 A・6 はい）：予実管理 › 年間計画 を「月ごとの 1 つの表」に。
//   ① 月の予算に対する進み ② 前年同月からの増減 ③ 予算の開始月（2026＝7 月）からの累計の差。仕様：docs/ANNUAL_PLAN_V1166_JA.md
//   本物の画面のモジュール（index.html の FUNERGY_AP）と、会計 PL・前年の本物の関数を VM で動かす。
//   予算・日次・KPI の実績は合成の stub（今の画面と同じ関数の「戻り値の形」だけまねる）。合成データだけ。本番にはつながない。
//   依頼書の照合の例：7月 予算 $100,000・実績 $110,000・前年 $100,000 → 単月 ＋$10,000・110%・前年差 ＋$10,000・＋10%・累計 ＋$10,000
//                     8月 予算 $120,000・実績 $105,000・前年 $100,000 → −$15,000・前年差 ＋$5,000・＋5%・7〜8月の累計 予算 $220,000・実績 $215,000・差 −$5,000
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(m.index, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}
const B = '/* ==== FUNERGY_AP（v1166', E = '/* ==== FUNERGY_AP end ==== */';
const MOD = SRC.slice(SRC.indexOf(B), SRC.indexOf(E));
assert.ok(MOD.length > 1000, 'FUNERGY_AP module');
const REAL = ['daysOfYm', '_ymToOffset', '_plPrevYear', 'pyDay', '_meetIsConfirmed', '_meetPlProv', '_meetConfirmState', '_meetPlKpi',
  'guestCountType', 'k2GuestLabel', 'monthFrozenKey', 'isFrozenMonth', 'budgetScopeStores'];
const run = (c, code) => vm.runInContext(code, c);
const plain = v => JSON.parse(JSON.stringify(v));   // VM の中の配列・オブジェクトを比べられる形に

const STORES = [
  { id: 'F01', name: 'Store A', abbr: 'A', brand: 'Brand A' },
  { id: 'F02', name: 'Store B', abbr: 'B', brand: 'Brand B' },
  { id: 'F06', name: 'LaLa', abbr: 'LL', brand: 'LaLa' },
];
const dim = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const iso = (ym, d) => ym + '-' + String(d).padStart(2, '0');
/* total を from〜to 日に均等に配る */
function spread(ym, total, from = 1, to = dim(ym)) { const o = {}, n = to - from + 1; for (let d = from; d <= to; d++) o[iso(ym, d)] = total / n; return o; }

/* 合成の世界。今日＝2026-11-14（ハワイ）、11 月は 11/13 まで取り込んだ */
function world() {
  const W = { plan: {}, da: {}, seed: {}, pyd: {}, rates: {}, tgt: {}, closed: {}, pl: {}, frozen: {} };
  const plan = (sid, ym, days, ppa = 50) => { W.plan[sid] = W.plan[sid] || {}; const o = {}; for (const [k, v] of Object.entries(days)) o[k] = { sales: v, guests: v / ppa, complete: true }; W.plan[sid][ym] = o; };
  const act = (sid, days, ppa = 52) => { W.da[sid] = W.da[sid] || {}; for (const [k, v] of Object.entries(days)) W.da[sid][k] = { actual: v, guests: v / ppa }; };
  const seed = (ym, sid, sales, cogs, payroll) => { W.seed[ym] = W.seed[ym] || {}; W.seed[ym][sid] = { sales, tax: 0, cogs: cogs ?? Math.round(sales * 0.3), payroll: payroll ?? Math.round(sales * 0.3), opex: 0, netop: 0 }; };
  // ---- Store A（F01）：依頼書の数字
  for (let m = 1; m <= 6; m++) { const ym = '2026-0' + m; plan('F01', ym, spread(ym, 90000)); act('F01', spread(ym, 95000)); seed('2025-0' + m, 'F01', 90000); }
  [['07', 100000, 110000, 100000], ['08', 120000, 105000, 100000], ['09', 110000, 112000, 104000], ['10', 115000, 119500, 110000]].forEach(([mm, b, a, p]) => {
    const ym = '2026-' + mm; plan('F01', ym, spread(ym, b)); act('F01', spread(ym, a)); seed('2025-' + mm, 'F01', p);
  });
  plan('F01', '2026-11', { ...spread('2026-11', 50000, 1, 13), ...spread('2026-11', 70000, 14, 30) });
  act('F01', spread('2026-11', 52000, 1, 13)); W.da.F01['2026-11-14'] = { actual: 9999, guests: 99 };   // 今日の途中の値（数えない）
  seed('2025-11', 'F01', 115000); seed('2025-12', 'F01', 128000);
  plan('F01', '2026-12', spread('2026-12', 135000));
  W.pyd.F01 = { from: '2025-01-01', m: { '2025-11': Array.from({ length: 30 }, (_, i) => i < 13 ? [0, 0, 48000 / 13, 960 / 13] : [0, 0, 3000, 60]) } };
  // ---- Store B（F02）
  for (const mm of ['07', '08', '09', '10']) { const ym = '2026-' + mm; plan('F02', ym, spread(ym, 50000)); act('F02', spread(ym, 50000)); seed('2025-' + mm, 'F02', 45000); }
  plan('F02', '2026-11', spread('2026-11', 60000)); act('F02', spread('2026-11', 20000, 1, 12));   // 11/12 まで
  plan('F02', '2026-12', spread('2026-12', 60000)); seed('2025-11', 'F02', 50000); seed('2025-12', 'F02', 55000);
  W.pyd.F02 = { from: '2025-01-01', m: { '2025-11': Array.from({ length: 30 }, () => [0, 0, 1500, 30]) } };
  // ---- LaLa（F06）：9/19 開店・前年なし
  plan('F06', '2026-09', spread('2026-09', 24000, 19, 30)); act('F06', spread('2026-09', 30000, 19, 30));
  plan('F06', '2026-10', spread('2026-10', 62000)); act('F06', spread('2026-10', 60000));
  plan('F06', '2026-11', spread('2026-11', 60000)); act('F06', spread('2026-11', 26000, 1, 13));
  plan('F06', '2026-12', spread('2026-12', 70000));
  // ---- 原価率（予算の率＝KPI の目標・実績＝k2Actuals）
  for (const mm of ['07', '08', '09', '10', '11', '12']) W.tgt['F01|2026-' + mm] = { foodCost: 30, laborPct: 28 };
  W.rates['F01|2026-07'] = { fc: 32, lb: 27 }; W.rates['F01|2026-08'] = { fc: 29, lb: 29.5 }; W.rates['F01|2026-09'] = { fc: 40, lb: 28 }; W.rates['F01|2026-10'] = { fc: 31, lb: 27 }; W.rates['F01|2026-11'] = { fc: 30.5, lb: 30 };
  return W;
}

function device(mut = W => W, opts = {}) {
  const W = mut(world());
  const c = { console, setTimeout, Promise, W, STORES: opts.stores || STORES, STORE: new Map(), RENDERS: [], LOADS: [], NOW: opts.now || [2026, 10, 14, 10] };
  vm.createContext(c);
  run(c, REAL.map(fnSrc).join('\n') + `
    var curLang='ja', _budgetStore=${JSON.stringify(opts.store || 'ALL')}, curPage='budget', budgetTab='annual', _qbStore='ALL', dailyMonthOffset=0;
    var PL2025_SEED=W.seed, PY2025_DAILY=W.pyd;
    function t(ja){ return ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function bizNow(){ return new Date(NOW[0],NOW[1],NOW[2],NOW[3],0,0); }
    function bizToday(){ var d=bizNow(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    function curYm(){ return bizToday().slice(0,7); }
    function budgetYM(){ var d=bizNow(); return {y:d.getFullYear(), m:d.getMonth()+1}; }
    function ls(k, d){ return STORE.has(k) ? JSON.parse(STORE.get(k)) : d; }
    function lsSet(k, v){ STORE.set(k, JSON.stringify(v)); return true; }
    function renderPage(p){ RENDERS.push(p); }
    function setBudgetStore(v){ _budgetStore=v; renderPage('budget'); }
    function setBudgetTab(v){ budgetTab=v; }
    function getVisibleStores(){ return STORES; }
    function _bStoreAbbr(s){ return s.abbr||s.id; }
    function bStoreChips(cur){ return '<div class="chips" data-cur="'+cur+'"></div>'; }
    function meetingBudgetPlan(sid, ym){
      var d=(W.plan[sid]||{})[ym]; if(!d) return {days:{}, month:{sales:0,guests:0,complete:false}};
      var m={sales:0,guests:0,complete:true}; Object.keys(d).forEach(function(k){ m.sales+=d[k].sales; m.guests+=d[k].guests; if(d[k].complete===false) m.complete=false; });
      return {days:d, month:m};
    }
    function monthSalesBudget(sid, ym){ return meetingBudgetPlan(sid, ym).month.sales; }
    function _daRO(sid){ return W.da[sid]||{}; }
    function dayClosureMode(sid, iso){ return W.closed[sid+'|'+iso]||null; }
    function k2ExplicitTargets(sid, ym){ return W.tgt[sid+'|'+ym]||{}; }
    function getBudgetForMonth(sid, ym){ return (W.fallback||{})[sid+'|'+ym] ? {} : null; }   /* {}＝その月の予算が店の共通設定だけ */ function getSegments(){ return {}; } function segmentsTotal(){ return 0; }
    function segmentsFcBudget(){ return 0; } function segmentsLaborBudget(){ return 0; }
    function k2Actuals(sid, ym){ var r=W.rates[sid+'|'+ym]; return {rows: r?[{key:'foodCost', act:r.fc},{key:'laborPct', act:r.lb}]:[]}; }
    function ensureMonthDataLoaded(ym){ LOADS.push(ym); (W.onLoad||function(){})(ym, STORE); return Promise.resolve({}); }
  ` + MOD);
  for (const [k, v] of Object.entries(W.pl)) c.STORE.set(k, JSON.stringify(v));
  return c;
}
const model = (c, ids, y = 2026, metric = 'sales') => run(c, `apModel(getVisibleStores().filter(function(s){ return ${JSON.stringify(ids)}.indexOf(s.id)>=0; }), ${y}, '${metric}')`);
const val = (c, metric, A, side) => c.apVal(metric, A, side);
function render(c, { store, metric, year } = {}) {
  if (store) run(c, `_budgetStore=${JSON.stringify(store)}`);
  if (metric) run(c, `_apMetric='${metric}'`);
  if (year) run(c, `_apY=${year}`);
  return run(c, 'renderAnnualPlan()');
}
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/* PC の表の 1 か月の行（data-ym）→ セルの文字 */
function pcRow(html, ym) {
  const i = html.indexOf('data-ym="' + ym + '"'); assert.ok(i > 0, 'row ' + ym);
  const tr = html.slice(i, html.indexOf('</tr>', i));
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1]));
}
const pcPart = html => html.slice(html.indexOf('<table class="ap-tbl">'), html.indexOf('</table>'));
const phPart = html => { const i = html.lastIndexOf('<div class="ap-ph">'); return html.slice(i, html.indexOf('<div class="ap-foot">', i)); };
const COL = { m: 0, st: 1, bud: 2, act: 3, diff: 4, rate: 5, py: 6, pyd: 7, pyr: 8, cum: 9 };

test('依頼書の例：7月・8月（単月・達成率・前年差・増減率・累計）。8月は前年比プラス・単月と累計はマイナス', () => {
  const c = device(), md = model(c, ['F01']);
  assert.equal(md.start.m, 7); assert.equal(md.start.src, 'fixed');
  const [jul, aug] = [md.months[6], md.months[7]];
  assert.equal(jul.kind, 'past'); assert.equal(Math.round(val(c, 'sales', jul.A, 'b')), 100000); assert.equal(Math.round(val(c, 'sales', jul.A, 'a')), 110000);
  assert.equal(c.apSign('sales', c.apDiff('sales', jul.A)), '＋$10,000'); assert.equal(c.apPct(c.apRate('sales', jul.A)), '110.0%');
  const y7 = c.apYoY('sales', jul); assert.equal(c.apSign('sales', y7.diff), '＋$10,000'); assert.equal(c.apSignPct(y7.rate), '＋10.0%');
  assert.equal(c.apSign('sales', c.apDiff('sales', jul.cum.A)), '＋$10,000');
  assert.equal(c.apSign('sales', c.apDiff('sales', aug.A)), '−$15,000'); assert.equal(c.apPct(c.apRate('sales', aug.A)), '87.5%');
  const y8 = c.apYoY('sales', aug); assert.equal(c.apSign('sales', y8.diff), '＋$5,000'); assert.equal(c.apSignPct(y8.rate), '＋5.0%');
  assert.equal(Math.round(val(c, 'sales', aug.cum.A, 'b')), 220000); assert.equal(Math.round(val(c, 'sales', aug.cum.A, 'a')), 215000);
  assert.equal(c.apSign('sales', c.apDiff('sales', aug.cum.A)), '−$5,000');
  // 表（PC）にもそのとおり出る・色は青（良い）と橙（悪い）
  const html = render(c, { store: 'F01' }), r7 = pcRow(html, '2026-07'), r8 = pcRow(html, '2026-08');
  assert.deepEqual([r7[COL.bud], r7[COL.diff], r7[COL.rate], r7[COL.py], r7[COL.pyd], r7[COL.pyr], r7[COL.cum]], ['$100,000', '＋$10,000', '110.0%', '$100,000', '＋$10,000', '＋10.0%', '＋$10,000']);
  assert.match(r7[COL.act], /^\$110,000 アプリ$/);
  assert.deepEqual([r8[COL.bud], r8[COL.diff], r8[COL.rate], r8[COL.pyd], r8[COL.pyr], r8[COL.cum]], ['$120,000', '−$15,000', '87.5%', '＋$5,000', '＋5.0%', '−$5,000']);
  const tr8 = html.slice(html.indexOf('data-ym="2026-08"'), html.indexOf('</tr>', html.indexOf('data-ym="2026-08"')));
  assert.match(tr8, /class="ap-neg">−\$15,000/); assert.match(tr8, /class="ap-pos">＋\$5,000/);
});

test('9月→10月で累計が続く（四半期でリセットしない）・12月（予定）は累計に入らない・まとめのカード', () => {
  const c = device(), md = model(c, ['F01']);
  assert.equal(c.apSign('sales', c.apDiff('sales', md.months[8].cum.A)), '−$3,000');
  assert.equal(c.apSign('sales', c.apDiff('sales', md.months[9].cum.A)), '＋$1,500');   // 10 月（Q4 の最初）も 7 月からの累計
  assert.equal(md.months[11].kind, 'future'); assert.equal(md.months[11].cum, null);
  assert.equal(md.last.m, 10);
  const html = render(c, { store: 'F01' });
  const sum = strip(html.slice(html.indexOf('ap-sum'), html.indexOf('ap-curc')));
  assert.match(sum, /7月〜10月の累計（最終確定月： 10月 ・予算は 2026 年 7 月から）/);
  assert.match(sum, /累計実績 \$446,500 累計予算 \$445,000 累計差 ＋\$1,500/);
  const dec = pcRow(html, '2026-12');
  assert.deepEqual([dec[COL.st], dec[COL.bud], dec[COL.act], dec[COL.diff], dec[COL.cum]], ['予定', '$135,000', '—', '—', '—']);
  assert.equal(dec[COL.py], '$128,000');
  // 1〜6 月は予算開始前（予算と比べない・実績と前年は広げると見られる）
  const pre = pcRow(html, '2026-03');
  assert.equal(pre[COL.st], '予算開始前'); assert.equal(pre[COL.bud], '—'); assert.equal(pre[COL.diff], '—'); assert.equal(pre[COL.cum], '—');
  assert.match(pre[COL.act], /^\$95,000/); assert.equal(pre[COL.pyd], '＋$5,000');
  assert.match(html, /<tr class=" ap-pre-d" style="display:none" data-ym="2026-03">/);   // 最初はたたんだまま
  assert.match(strip(html), /1〜6月 予算開始前 予算比較の対象外/);
});

test('進行中の月（11月）：取り込んだ最後の日までの計画との差・月間予算の％・前年の同じ日まで・確定と参考の累計を分ける', () => {
  const c = device(), md = model(c, ['F01']), nov = md.months[10];
  assert.equal(nov.kind, 'current'); assert.equal(nov.td.last, '2026-11-13');
  assert.equal(Math.round(val(c, 'sales', nov.td.A, 'a')), 52000);    // 今日（11/14）の 9,999 は数えない
  assert.equal(Math.round(val(c, 'sales', nov.td.A, 'b')), 50000);
  assert.equal(Math.round(nov.pyTd), 48000);
  const html = render(c, { store: 'F01' }), r = pcRow(html, '2026-11');
  assert.equal(r[COL.st], '進行中 11/13');
  assert.equal(r[COL.act], '$52,000 11/13 まで');
  assert.equal(r[COL.diff], '月末確定時 計画比 ＋$2,000');
  assert.equal(r[COL.rate], '43.3% 月間予算の');
  assert.equal(r[COL.py], '$48,000 前年 11/13 まで');
  assert.deepEqual([r[COL.pyd], r[COL.pyr]], ['＋$4,000', '＋8.3%']);
  assert.equal(r[COL.cum], '確定 ＋$1,500 参考 ＋$3,500');
  const card = strip(html.slice(html.indexOf('ap-curc'), html.indexOf('ap-note') > 0 ? html.indexOf('ap-note') : html.indexOf('ap-tbl')));
  assert.match(card, /11月は進行中（ハワイ 11\/13 まで取込）/);
  assert.match(card, /11\/13 までの計画 \$50,000 に対して ＋\$2,000/);
  assert.match(card, /月間予算の 43\.3% （\$52,000 \/ \$120,000）/);
  assert.match(card, /参考：途中を含めた累計 ＋\$3,500（確定の累計には入れない）/);
  // 前年の日次が 1 日でも無い → 前年の月額を参考・増減率は比較不可
  const c2 = device(W => { W.pyd.F01.m['2025-11'][4] = null; return W; });
  const r2 = pcRow(render(c2, { store: 'F01' }), '2026-11');
  assert.equal(r2[COL.py], '$115,000 参考：前年の月額'); assert.equal(r2[COL.pyr], '比較不可'); assert.equal(r2[COL.pyd], '—');
});

test('予算未設定の月：月間予算「未設定」・差と達成率は「—」・その月から累計は出さず月を名指し', () => {
  const c = device(W => { delete W.plan.F01['2026-09']; return W; }), md = model(c, ['F01']);
  assert.deepEqual(plain(md.months[8].unset), ['A']);
  assert.equal(md.months[9].cum.blocked.m, 9);
  const html = render(c, { store: 'F01' }), r = pcRow(html, '2026-09');
  assert.equal(r[COL.st], '予算未設定'); assert.equal(r[COL.bud], '未設定'); assert.equal(r[COL.diff], '—'); assert.equal(r[COL.rate], '—');
  assert.equal(r[COL.cum], '9月の予算が未設定'); assert.equal(pcRow(html, '2026-10')[COL.cum], '9月の予算が未設定');
  assert.equal(pcRow(html, '2026-08')[COL.cum], '−$5,000');   // 前の月までは出る
  assert.match(strip(html), /9月の予算が未設定のため、累計は出せません/);
  assert.match(pcRow(html, '2026-11')[COL.cum], /^確定 9月の予算が未設定/);
});

test('客数の予算が無い月（区分の客数が無い）：客数では「未設定」・売上はそのまま', () => {
  const c = device(W => { for (const v of Object.values(W.plan.F01['2026-09'])) v.complete = false; return W; });
  const g = model(c, ['F01'], 2026, 'guests');
  assert.deepEqual(plain(g.months[8].unset), ['A']); assert.equal(g.months[9].cum.blocked.m, 9);
  assert.equal(model(c, ['F01']).months[8].unset.length, 0);
  assert.equal(pcRow(render(c, { store: 'F01', metric: 'guests' }), '2026-09')[COL.bud], '未設定');
});

test('取り込めていない日：当月実績に「未取込 3 日（9/12・9/13・9/20）」・その月から先の累計は「欠損あり」（灰色）', () => {
  const c = device(W => { ['2026-09-12', '2026-09-13', '2026-09-20'].forEach(d => delete W.da.F01[d]); return W; });
  const md = model(c, ['F01']);
  assert.deepEqual(plain(md.months[8].gap[0].dates), ['2026-09-12', '2026-09-13', '2026-09-20']);
  assert.equal(md.months[9].cum.gap, true); assert.equal(md.months[7].cum.gap, false);
  const html = render(c, { store: 'F01' }), r = pcRow(html, '2026-09');
  assert.equal(r[COL.st], '欠損あり'); assert.match(r[COL.act], /未取込 3 日（9\/12・9\/13・9\/20）/);
  assert.match(r[COL.cum], /欠損あり$/); assert.match(pcRow(html, '2026-10')[COL.cum], /欠損あり$/);
  assert.match(strip(html), /欠損あり：取り込めていない日がある月を含むので、確定の累計ではありません/);
  assert.match(strip(html), /Q3 小計（確定は 7・8月） \$220,000 \$215,000 −\$5,000/);   // 欠けのある 9 月は小計に入れない
  // 店休日（store_closures）は数えない
  const c2 = device(W => { delete W.da.F01['2026-09-12']; W.closed['F01|2026-09-12'] = 'closed'; return W; });
  assert.equal(model(c2, ['F01']).months[8].gap.length, 0);
  // 予算のない日（開店前など）も数えない
  assert.equal(model(device(), ['F06']).months[8].gap.length, 0);
});

test('確認済みの $0：「$0 確認済み」・差は −予算で累計にも入る（未取込とは分ける）', () => {
  const c = device(W => { for (const k of Object.keys(W.da.F01)) if (k.startsWith('2026-08')) W.da.F01[k] = { actual: 0, guests: 0 }; return W; });
  const md = model(c, ['F01']);
  assert.equal(md.months[7].zero, true); assert.equal(md.months[7].gap.length, 0);
  const r = pcRow(render(c, { store: 'F01' }), '2026-08');
  assert.equal(r[COL.act], '$0 確認済み'); assert.equal(r[COL.diff], '−$120,000'); assert.equal(r[COL.cum], '−$110,000');
  assert.equal(r[COL.st], '確定');
  // 店休日にして何も入れていない月は「確認済み」と言わない（入れた $0 だけ）
  const c2 = device(W => { for (const k of Object.keys(W.da.F01)) if (k.startsWith('2026-08')) { delete W.da.F01[k]; W.closed['F01|' + k] = 'closed'; } return W; });
  const m2 = model(c2, ['F01']).months[7];
  assert.equal(m2.zero, false); assert.equal(m2.gap.length, 0);
  assert.ok(!/確認済み/.test(pcRow(render(c2, { store: 'F01' }), '2026-08')[COL.act]));
});

test('前年：新店は「前年実績なし」・前年が確認済み $0 は前年差だけ（増減率は —）・全店は前年もある店どうし＋店の数の注記', () => {
  const c = device(W => { W.seed['2025-10'].F02.sales = 0; return W; });
  const html1 = render(c, { store: 'F06' }), r = pcRow(html1, '2026-10');
  assert.equal(r[COL.py], '— 前年実績なし'); assert.equal(r[COL.pyd], '—'); assert.equal(r[COL.pyr], '—');
  const r2 = pcRow(render(c, { store: 'F02' }), '2026-10');
  assert.deepEqual([r2[COL.py], r2[COL.pyd], r2[COL.pyr]], ['$0', '＋$50,000', '—']);
  // 全店の 9 月：LaLa（前年なし）は前年比に入れない
  const c3 = device(), md = model(c3, ['F01', 'F02', 'F06']), sep = md.months[8];
  assert.equal(sep.py, 2); assert.equal(Math.round(sep.pyA.as), 149000); assert.equal(Math.round(sep.lflA.as), 162000);
  assert.equal(Math.round(val(c3, 'sales', sep.A, 'a')), 192000);
  const html = render(c3, { store: 'ALL' });
  assert.match(strip(html), /今年 3 店・前年 2 店（LaLa は前年なし）。前年比は前年もある店どうしで比べます/);
  assert.match(pcRow(html, '2026-09')[COL.py], /^\$149,000 2 店$/);
  assert.equal(pcRow(html, '2026-09')[COL.pyd], '＋$13,000');
});

test('開店前の月（実績が 1 日も無く、予算が店の共通設定だけ）：未取込にしない・数えない・表の上に出す', () => {
  const mut = W => { W.plan.F06['2026-07'] = Object.fromEntries(Object.entries(spread('2026-07', 93000)).map(([k, v]) => [k, { sales: v, guests: v / 50, complete: true }]));
    W.fallback = { 'F06|2026-07': true }; return W; };
  const c = device(mut), md = model(c, ['F06']), jul = md.months[6];
  assert.equal(jul.relevant, 0); assert.equal(jul.gap.length, 0); assert.deepEqual(plain(jul.idle), ['LL']);
  const html = render(c, { store: 'F06' }), r = pcRow(html, '2026-07');
  assert.deepEqual([r[COL.st], r[COL.bud], r[COL.act], r[COL.diff], r[COL.cum]], ['実績なし', '—', '—', '—', '—']);
  assert.equal(c._apMonthsTx([1, 2, 3, 5, 7, 8]), '1〜3・5・7・8月');
  // v1169：根拠（その店の最初の実績＝LaLa は 9/19）より前の月だけ
  assert.match(strip(html), /開店前として数えない月：7月（その店の最初の実績より前で、実績が 1 日も無く、予算が店の共通設定だけの月）/);
  const all = model(device(mut), ['F01', 'F02', 'F06']).months[6];
  assert.equal(all.gap.length, 0); assert.equal(Math.round(c.apVal('sales', all.A, 'b')), 150000);   // 全店の 7 月を欠損ありにしない
  // その月を予算設定で保存していれば（共通設定ではない）、実績が無いのは「未取込」
  const c2 = device(W => { mut(W); W.fallback = {}; return W; });
  assert.equal(model(c2, ['F06']).months[6].gap[0].dates.length, 31);
  // 実績が 1 日でもあれば数える（共通設定の予算でも）
  const c3 = device(W => { mut(W); W.da.F06['2026-07-20'] = { actual: 100, guests: 2 }; return W; });
  assert.equal(model(c3, ['F06']).months[6].relevant, 1);
});

test('全店：店ごとの取込の日が違う進行中の月・予算のない日の店は未取込にしない', () => {
  const c = device(), md = model(c, ['F01', 'F02', 'F06']), nov = md.months[10];
  assert.equal(nov.td.last, '2026-11-13'); assert.deepEqual(plain(nov.behind), ['B 11/12']);
  assert.equal(Math.round(val(c, 'sales', nov.td.A, 'b')), 50000 + 24000 + 26000);   // B は 11/12 までの計画
  assert.equal(nov.gap.length, 0);
  assert.match(strip(render(c, { store: 'ALL' })), /B 11\/12 までの店があります/);
});

test('全店の進行中の月：1 店でも前年の日次が欠ければ前年の月額を参考に（途中の店どうしを混ぜない）', () => {
  const c = device(W => { W.pyd.F02.m['2025-11'][2] = null; return W; });
  const r = pcRow(render(c, { store: 'ALL' }), '2026-11');
  assert.equal(r[COL.py], '$165,000 参考：前年の月額'); assert.equal(r[COL.pyr], '比較不可');
});

test('進行中の月は会計PL があっても使わない・前年は 2025 年より後なら取り込んだ会計PL', () => {
  const c = device(W => { W.pl.pl_public = { '2026-11': { F01: { sales: 999999, cogs: 1, payroll: 1 } }, '2026-07': { F01: { sales: 121000, cogs: 36300, payroll: 30000 } } }; return W; });
  const nov = model(c, ['F01']).months[10];
  assert.equal(Math.round(c.apVal('sales', nov.td.A, 'a')), 52000); assert.equal(nov.pl, 0);
  assert.deepEqual(plain(c.apPrevMonth('F01', '2027-07')), { sales: 121000, cogs: 36300, payroll: 30000, src: 'pl' });
  assert.equal(c.apPrevMonth('F01', '2027-08'), null);
  assert.equal(c.apPrevMonth('F03', '2027-07'), null);   // FSP・WGS は合算の PL（店ごとの前年は作れない）
});

test('四半期の小計：確定した月の合計から（達成率・前年比も合計から）・Q4 は確定は 10月・Q 予算', () => {
  const c = device(), html = render(c, { store: 'F01' });
  const qrow = q => { const i = html.indexOf('planGoQuarter(2026,' + q + ')'); const tr = html.slice(i, html.indexOf('</tr>', i)); return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1])); };
  assert.deepEqual(qrow(3), ['Q3 小計（7〜9月）', '$330,000', '$327,000', '−$3,000', '99.1%', '$304,000', '＋$23,000', '＋7.6%', '累計は月の行で見る']);
  assert.deepEqual(qrow(4), ['Q4 小計（確定は 10月）', '$115,000', '$119,500', '＋$4,500', '103.9%', '$110,000', '＋$9,500', '＋8.6%', 'Q4 予算 $370,000']);
  assert.ok(!/planGoQuarter\(2026,[12]\)/.test(html), 'Q1・Q2 は予算開始前');
});

test('iPhone：1 行は 月・実績・単月差・累計差。押すと 月間予算・達成率・前年・累計の予算と実績', () => {
  const c = device(), all = render(c, { store: 'F01' }), ph = phPart(all);
  const i = ph.indexOf('<b>8月</b>'); const det = ph.slice(ph.lastIndexOf('<details', i), ph.indexOf('</details>', i));
  const sm = det.slice(det.indexOf('<summary'), det.indexOf('</summary>'));
  assert.equal(strip(sm), '8月 $105,000 −$15,000 −$5,000');
  const body = strip(det.slice(det.indexOf('</summary>')));
  assert.match(body, /月間予算 \$120,000 達成率 87\.5% 前年同月 \$100,000 前年差・増減率 ＋\$5,000 ・ ＋5\.0% 累計予算（7〜8月） \$220,000 累計実績（7〜8月） \$215,000/);
  // 進行中の 11 月：計画との差・月間予算の到達・前年の同じ日まで・参考の累計
  const j = ph.indexOf('<b>11月</b>'); const d11 = strip(ph.slice(ph.lastIndexOf('<details', j), ph.indexOf('</details>', j)));
  assert.match(d11, /^11月 \$52,000 月末確定時 確定 ＋\$1,500 進行中・ハワイ 11\/13 まで取込/);
  assert.match(d11, /11\/13 までの計画 \$50,000 計画との差 ＋\$2,000 月間予算・到達 \$120,000・43\.3% 前年 11\/13 まで \$48,000 前年差・増減率 ＋\$4,000 ・ ＋8\.3% 累計（参考） ＋\$3,500/);
  assert.match(strip(ph), /12月は予定：予算 \$135,000（累計に入れない）/);
  assert.match(strip(ph), /Q3 \$327,000 −\$3,000 99\.1%/); assert.match(strip(ph), /Q4 \$119,500 ＋\$4,500 10月まで/);
  assert.match(all, /<select class="form-select ap-sel" aria-label="店舗" onchange="setBudgetStore\(this\.value\)">/);
  assert.match(strip(ph), /累計予算（7月） \$100,000 累計実績（7月） \$110,000/);   // 1 か月だけのときは「7〜7月」としない
});

test('会計PL の月は PL（暫定の PL は「暫定PL」）・客数と客単価はアプリの日次・FSP/WGS は合算でアプリ', () => {
  const c = device(W => { W.pl.pl_public = { '2026-10': { F01: { sales: 120000, cogs: 36000, payroll: 33600, prov: true } } }; return W; });
  const md = model(c, ['F01']), oct = md.months[9];
  assert.equal(Math.round(val(c, 'sales', oct.A, 'a')), 120000); assert.equal(oct.pl, 1); assert.equal(oct.prov, true);
  const r = pcRow(render(c, { store: 'F01' }), '2026-10');
  assert.equal(r[COL.act], '$120,000 暫定PL'); assert.equal(r[COL.diff], '＋$5,000');
  // 客単価＝PL の売上 ÷ アプリの客数（会議の _meetApplyPl と同じ）
  const g = model(c, ['F01'], 2026, 'ppa').months[9];
  assert.equal(Math.round(val(c, 'ppa', g.A, 'a') * 100) / 100, Math.round(120000 / (119500 / 52) * 100) / 100);
  // PL の月は日次の欠けがあっても売上は確定（客数は欠損あり）
  const c2 = device(W => { W.pl.pl_public = { '2026-10': { F01: { sales: 120000, cogs: 1, payroll: 1 } } }; delete W.da.F01['2026-10-05']; return W; });
  assert.equal(model(c2, ['F01']).months[9].gap.length, 0);
  assert.equal(model(c2, ['F01'], 2026, 'guests').months[9].gap.length, 1);
});

test('原価率・人件費率：差はポイント・プラスは「予算超過」（橙）・前年は PL の率・累計は売上で重みづけ', () => {
  const c = device(), html = render(c, { store: 'F01', metric: 'fc' }), r = pcRow(html, '2026-07');
  assert.deepEqual([r[COL.bud], r[COL.act].replace(/ アプリ$/, ''), r[COL.diff], r[COL.rate]], ['30.0%', '32.0%', '＋2.0pt 予算超過', '予算超過']);
  assert.equal(r[COL.py], '30.0%'); assert.equal(r[COL.pyd], '＋2.0pt 予算超過'); assert.equal(r[COL.pyr], '—');
  const tr = html.slice(html.indexOf('data-ym="2026-07"'), html.indexOf('</tr>', html.indexOf('data-ym="2026-07"')));
  assert.match(tr, /class="ap-neg">＋2\.0pt 予算超過/);
  assert.equal(pcRow(html, '2026-08')[COL.diff], '−1.0pt'); assert.equal(pcRow(html, '2026-08')[COL.rate], '予算内');
  // 7〜8 月の累計：(32×110,000 ＋ 29×105,000) ÷ 215,000 − 30.0
  const want = (32 * 110000 + 29 * 105000) / 215000 - 30;
  assert.equal(pcRow(html, '2026-08')[COL.cum], c.apSign('fc', want) + (Math.round(want * 10) / 10 > 0 ? ' 予算超過' : ''));
  // 7〜9 月は売上が違うので、重みを付けないと違う答えになる（(32＋29＋40)÷3＝33.7 → ＋3.7pt）
  const w3 = (32 * 110000 + 29 * 105000 + 40 * 112000) / 327000 - 30;
  assert.equal(pcRow(html, '2026-09')[COL.cum], c.apSign('fc', w3) + ' 予算超過'); assert.equal(c.apSign('fc', w3), '＋3.8pt');
  assert.match(strip(html), /累計の原価率/);
  const lb = pcRow(render(c, { metric: 'labor' }), '2026-07');
  assert.equal(lb[COL.diff], '−1.0pt');
});

test('客数・客単価：前年は出さない（会計PL に客数が無い）・Totoya は丼数の名前', () => {
  const c = device(), html = render(c, { store: 'F01', metric: 'guests' }), r = pcRow(html, '2026-07');
  assert.equal(r[COL.bud], '2,000'); assert.equal(r[COL.act].replace(/ アプリ$/, ''), '2,115'); assert.equal(r[COL.diff], '＋115');
  assert.equal(r[COL.py], '—');
  assert.match(strip(html), /客数・客単価の前年は、会計PL に客数が無いので出しません/);
  const p = pcRow(render(c, { metric: 'ppa' }), '2026-07');
  assert.equal(p[COL.bud], '$50.00'); assert.equal(p[COL.act].replace(/ アプリ$/, ''), '$52.00'); assert.equal(p[COL.diff], '＋$2.00');
  const c2 = device(W => W, { stores: [{ id: 'F04-K', name: 'Totoya K', abbr: 'TK', brand: 'Totoya' }] });
  assert.match(render(c2, { store: 'F04-K', metric: 'guests' }), />丼数<\/button>/);
});

test('年の切り替え：2026 は 7 月から・決めていない年は予算が入った最初の月・2026〜来年まで', () => {
  const c = device(W => { W.plan.F01['2027-03'] = { '2027-03-01': { sales: 1000, guests: 20, complete: true } }; return W; });
  assert.deepEqual(plain(c.apBudgetStart([{ id: 'F01' }], 2027)), { m: 3, src: 'auto' });
  assert.deepEqual(plain(c.apBudgetStart([{ id: 'F02' }], 2027)), { m: null, src: 'none' });
  const html = render(c, { store: 'F01', year: 2027 });
  assert.match(strip(html), /まだ確定した月がありません（予算は 2027 年 3 月から（予算が入った最初の月））/);
  assert.equal(pcRow(html, '2027-02')[COL.st], '予算開始前'); assert.equal(pcRow(html, '2027-03')[COL.st], '予定');
  assert.match(strip(render(c, { store: 'F02', year: 2027 })), /この年は予算がまだ入っていません/);
  run(c, 'RENDERS.length=0; setApYear(1)'); assert.equal(c.RENDERS.length, 0, '2028 には進まない');
  run(c, '_apY=2026; setApYear(-1)'); assert.equal(c.RENDERS.length, 0, '2025 には戻らない');
  run(c, 'setApYearTo("2027")'); assert.equal(run(c, '_apY'), 2027);
  run(c, 'setApMetric("labor")'); assert.equal(run(c, '_apMetric'), 'labor'); run(c, 'setApMetric("x")'); assert.equal(run(c, '_apMetric'), 'labor');
});

test('店を替えると前の店の数字が残らない（描き直しは全部作り直す）', () => {
  const c = device(), a = render(c, { store: 'F01' });
  assert.match(a, /\$110,000/);
  run(c, 'setBudgetStore("F02")');
  const b = render(c);
  assert.ok(!/\$110,000|\$446,500|＋\$1,500/.test(b), 'Store A の数字が残っていない');
  assert.match(strip(b), /累計実績 \$200,000 累計予算 \$200,000 累計差 ±\$0/);
  assert.match(b, /data-cur="F02"/);
});

test('過去の月の日次が端末に無い店：読み込み中（未取込と言わない）→ 読んだら描き直す', async () => {
  const stores = STORES.map(s => s.id === 'F01' ? { ...s, toastGuid: 'g1' } : s);
  const c = device(W => { W.onLoad = (ym, S) => S.set('monthloaded_F01_' + ym, 'true'); return W; }, { stores });
  for (const m of ['07', '08', '09']) c.STORE.set('monthloaded_F01_2026-' + m, 'true');
  const html = render(c, { store: 'F01' });
  assert.equal(pcRow(html, '2026-10')[COL.st], '読み込み中'); assert.equal(pcRow(html, '2026-10')[COL.act], '読み込み中');
  assert.equal(pcRow(html, '2026-10')[COL.cum], '読み込み中'); assert.equal(pcRow(html, '2026-09')[COL.st], '確定');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(c.LOADS, ['2026-10']); assert.deepEqual(c.RENDERS.slice(-1), ['budget']);
  assert.equal(pcRow(render(c), '2026-10')[COL.st], '確定');
  await new Promise(r => setTimeout(r, 20)); assert.deepEqual(c.LOADS, ['2026-10'], '1 回だけ');
  // 読めなかったとき（印が立たない）も、同じ月を何度も読みに行かない（描くたびに読むと止まらない）
  const c2 = device(W => W, { stores });
  for (const m of ['07', '08', '09']) c2.STORE.set('monthloaded_F01_2026-' + m, 'true');
  render(c2, { store: 'F01' }); await new Promise(r => setTimeout(r, 20));
  render(c2); await new Promise(r => setTimeout(r, 20)); render(c2); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(plain(c2.LOADS), ['2026-10']);
  // v1169（Codex #162 の P2）：読めなかった月は「確定」にしない（端末にある古い日次を確定に見せない）。読み込み中のままにもしない
  assert.equal(pcRow(render(c2), '2026-10')[COL.st], '読めませんでした');
});

test('店の名前・ID は文字として出す（HTML として動かない）', () => {
  const c = device(W => W, { stores: [{ id: 'F01', name: 'A&B <i>x</i>', abbr: 'A' }, { id: 'Z"1', name: 'Z <b>', abbr: 'Z' }] });
  const html = render(c, { store: 'ALL' });
  assert.ok(!/<i>x<\/i>|Z <b>|value="Z"1"/.test(html), 'escaped');
  assert.match(html, /<option value="Z&quot;1">Z &lt;b&gt;<\/option>/); assert.match(html, />A&amp;B &lt;i&gt;x&lt;\/i&gt;<\/option>/);
});

test('バージョン 1166 以上（index.html と sw.js）', () => {
  const v = +(/APP_VERSION\s*=\s*'(\d+)'/.exec(SRC) || [])[1], w = +(/SW_BUILD\s*=\s*'(\d+)'/.exec(SW) || [])[1];
  assert.ok(v >= 1166, 'APP_VERSION ' + v); assert.ok(w >= 1166, 'SW_BUILD ' + w);
});

/* ---- v1169（Codex #162 の P2 2 つ） ---- */
test('v1169：前から実績のある店の、実績の無い月（予算は共通設定だけ）は開店前にしない＝未取込として出す', () => {
  // Store A は 2025 年から実績がある（PY2025_DAILY の from・2026 年 1〜8 月の日次）。9 月の日次がそっくり無い
  const mut = W => { for (const k of Object.keys(W.da.F01)) if (k.startsWith('2026-09')) delete W.da.F01[k]; W.fallback = { 'F01|2026-09': true }; return W; };
  const c = device(mut), md = model(c, ['F01']), sep = md.months[8];
  assert.deepEqual(plain(sep.idle), [], '開店前にしない');
  assert.equal(sep.relevant, 1); assert.equal(sep.gap[0].dates.length, 30);
  const html = render(c, { store: 'F01' });
  assert.equal(pcRow(html, '2026-09')[COL.st], '欠損あり');
  assert.ok(!/開店前として数えない月/.test(strip(html)));
  // 実績が一度も無い店（根拠が無い）も開店前にしない
  const c2 = device(W => { W.da.F06 = {}; W.fallback = { 'F06|2026-09': true, 'F06|2026-10': true }; return W; });
  const m2 = model(c2, ['F06']);
  assert.deepEqual(plain(m2.months[9].idle), []); assert.equal(m2.months[9].gap[0].dates.length, 31);
  // 読み込み中・読めなかった月も開店前にしない（読めたら開店前）
  const stores = STORES.map(s => s.id === 'F06' ? { ...s, toastGuid: 'g6' } : s);
  const mutL = W => { W.plan.F06['2026-07'] = Object.fromEntries(Object.entries(spread('2026-07', 93000)).map(([k, v]) => [k, { sales: v, guests: v / 50, complete: true }])); W.fallback = { 'F06|2026-07': true }; return W; };
  const c3 = device(mutL, { stores });
  for (const m of ['08', '09', '10']) c3.STORE.set('monthloaded_F06_2026-' + m, 'true');
  const jl = model(c3, ['F06']).months[6];
  assert.deepEqual(plain(jl.idle), [], '読み込み中は開店前にしない'); assert.equal(jl.loading, true);
  c3.STORE.set('monthloaded_F06_2026-07', 'true');
  assert.deepEqual(plain(model(c3, ['F06']).months[6].idle), ['LL'], '読めたら開店前');
});

test('v1169：過去の月の読み込みに失敗したら「読めませんでした」・確定と累計に入れない・60 秒たつと読み直す・「もう一度読む」はすぐ', async () => {
  const stores = STORES.map(s => s.id === 'F01' ? { ...s, toastGuid: 'g1' } : s);
  let ok = false;
  const c = device(W => { W.onLoad = (ym, S) => { if (ok) S.set('monthloaded_F01_' + ym, 'true'); }; return W; }, { stores });
  for (const m of ['07', '08', '09']) c.STORE.set('monthloaded_F01_2026-' + m, 'true');
  render(c, { store: 'F01' }); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(plain(c.LOADS), ['2026-10']);
  let md = model(c, ['F01']), oct = md.months[9];
  assert.equal(oct.failed, true); assert.equal(oct.loading, true);
  assert.deepEqual(plain(md.quarters.find(q => q.q === 4).fin), [], '四半期の確定に入れない');
  assert.equal(oct.cum.failed, true); assert.deepEqual(plain(oct.cum.failMs), [10]);
  let html = render(c);
  assert.equal(pcRow(html, '2026-10')[COL.st], '読めませんでした'); assert.equal(pcRow(html, '2026-10')[COL.act], '読めませんでした');
  assert.equal(pcRow(html, '2026-10')[COL.cum], '読めませんでした');
  assert.match(strip(html), /10月の日次をこの端末に読めませんでした。確定・累計に入れていません もう一度読む/);
  assert.match(html, /onclick="apRetryLoad\(\)"/);
  // 描くたびには読まない
  render(c); await new Promise(r => setTimeout(r, 20)); assert.deepEqual(plain(c.LOADS), ['2026-10']);
  // ensureMonthDataLoaded がエラーを返したときも失敗（印が残っていても）
  const c2 = device(W => { W.onLoad = (ym, S) => S.set('monthloaded_F01_' + ym, 'true'); return W; }, { stores });
  for (const m of ['07', '08', '09']) c2.STORE.set('monthloaded_F01_2026-' + m, 'true');
  run(c2, `ensureMonthDataLoaded=function(ym){ LOADS.push(ym); return Promise.resolve({ error:'F01 の売上保存は未完了' }); }`);
  render(c2, { store: 'F01' }); await new Promise(r => setTimeout(r, 20));
  assert.equal(run(c2, `_apLoadTried['2026-10']`), 'fail');
  // 60 秒たったら描き直しのときに読む
  run(c, `_apLoadFail['2026-10'].at -= AP_RETRY_MS + 1`);
  ok = true; render(c); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(plain(c.LOADS), ['2026-10', '2026-10']);
  assert.equal(pcRow(render(c), '2026-10')[COL.st], '確定');
  // 「もう一度読む」：60 秒を待たずにすぐ
  ok = false;
  const c3 = device(W => { W.onLoad = (ym, S) => { if (ok) S.set('monthloaded_F01_' + ym, 'true'); }; return W; }, { stores });
  for (const m of ['07', '08', '09']) c3.STORE.set('monthloaded_F01_2026-' + m, 'true');
  render(c3, { store: 'F01' }); await new Promise(r => setTimeout(r, 20));
  ok = true; run(c3, 'apRetryLoad()'); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(plain(c3.LOADS), ['2026-10', '2026-10']);
  assert.equal(pcRow(render(c3), '2026-10')[COL.st], '確定');
});
