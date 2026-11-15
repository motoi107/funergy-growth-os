// v1171（Moto さん 11/14：アップグレード率の内訳・UI案81・昨日まで）：totoyaKpiCalc の味噌汁・茶漬けは昨日まで、
// FUNERGY_UP（タイル・前週比・日ごとの状態・種類ごとの数・注文の明細）。合成データ・本番に接続しない。index.html の区切りの中を VM で動かす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const A = HTML.indexOf('/* ==== FUNERGY_UP start'), B = HTML.indexOf('/* ==== FUNERGY_UP end ==== */');
assert.ok(A > 0 && B > A, 'FUNERGY_UP の区切りがある');
const MOD = HTML.slice(A, B);
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let depth = 0, j = HTML.indexOf('{', i);
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error(name);
}

const TODAY = '2026-11-14';
const dayList = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d = new Date(d.getTime() + 86400000)) out.push({ date: d.toISOString().slice(0, 10) }); return out; };
const NOV = dayList('2026-11-01', '2026-11-30');
const STORES = [{ id: 'F04-K', name: 'Totoya Kaimuki', toastGuid: 'g-k' }, { id: 'F04-A', name: 'Totoya Aiea', toastGuid: 'g-a' }, { id: 'F01', name: 'ToriTon', toastGuid: 'g-t' }];

function make(daily, extra = {}) {
  const els = {}; const calls = [];
  const ctx = {
    console, Math, Date, JSON, Number, String, Object, Array, isFinite, isNaN, Promise, setTimeout, encodeURIComponent, RegExp,
    window: null,
    document: { getElementById: id => els[id] || (els[id] = { id, innerHTML: '', style: {}, _attr: {}, setAttribute(k, v) { this._attr[k] = v; } }) },
    _els: els, _calls: calls,
    bizToday: () => extra.today || TODAY,
    _daRO: sid => daily[sid] || {},
    getDailyActuals: sid => daily[sid] || {},
    isTotoyaStore: sid => /^F04/.test(sid),
    dayClosureMode: (sid, d) => (extra.closed && extra.closed[sid + '|' + d]) ? 'closed' : null,
    getStoresAll: () => STORES,
    t: (ja, en) => (extra.en ? en : ja),
    wowBadge: (v, up, pt) => '<badge ' + v + (pt ? 'pt' : '') + '>',
    openModal: html => { ctx._modal = html; },
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON: 'anon',
    fetch: async (url, opt) => {
      calls.push(String(url));
      const u = new URL(String(url)), tbl = u.pathname.split('/').pop();
      const r = extra.rest ? extra.rest(tbl, u.searchParams, opt) : { status: 200, body: [] };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  return ctx;
}
function dailyFor(fn) { const da = {}; NOV.forEach(d => { if (d.date < TODAY || fn.today) { const v = fn(d.date); if (v) da[d.date] = v; } }); return da; }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

test('totoyaKpiCalc：味噌汁・茶漬け（分母・分子）は今日を入れない・いくらシャワーと丼数は今までどおり・過去の月は同じ', () => {
  const da = {};
  for (let i = 1; i <= 14; i++) { const d = '2026-11-' + String(i).padStart(2, '0'); da[d] = { misoTotal: 10, misoUpgrade: 3, ikuraShower: 2, ikuraBowls: 8 }; }
  da['2026-10-31'] = { misoTotal: 50, misoUpgrade: 50, ikuraShower: 1, ikuraBowls: 1 };
  const ctx = {
    Math, Number, String, Object, Array, isNaN, parseFloat, console,
    bizToday: () => TODAY, getTotoyaKpiCfg: () => ({}), getKpiManual: () => ({}), getMenuMix: () => ({ items: {} }),
    activeRecipes: () => [], recipeInStore: () => true, getDailyActuals: () => da, _daRO: () => da,
  };
  vm.createContext(ctx);
  ['_totoyaKw', '_totoyaMatchKw', 'totoyaKpiCalc'].forEach(n => vm.runInContext(fnSrc(n), ctx));
  const r = ctx.totoyaKpiCalc('F04-K', '2026.11');
  assert.equal(r.eff.misoAll, 130, '13 日（11/1〜11/13）。今日 11/14 は入れない');
  assert.equal(r.eff.misoUp, 39);
  assert.equal(r.misoRate, 30);
  assert.equal(r.eff.ikura, 28, 'いくらシャワーは今日も入る（今までどおり）');
  assert.equal(r.eff.bowls, 112);
  const oct = ctx.totoyaKpiCalc('F04-K', '2026.10');
  assert.equal(oct.eff.misoAll, 50, '過去の月は変わらない');
  ctx.bizToday = () => '2026-11-01';
  const first = ctx.totoyaKpiCalc('F04-K', '2026.11');
  assert.equal(first.eff.misoAll, null, '月の初日は昨日までの日が無い＝数なし（0 にしない）');
  assert.equal(first.misoRate, null);
});

test('stats：昨日まで・期間と店を足してから割る・取り込めていない日／店休を分ける・Totoya の店だけ', () => {
  const k = dailyFor(d => d === '2026-11-05' ? null : { misoTotal: 20, misoUpgrade: d < '2026-11-07' ? 4 : 6 });
  const a = dailyFor(d => ({ misoTotal: 10, misoUpgrade: 1 }));
  k[TODAY] = { misoTotal: 999, misoUpgrade: 999 };
  const c = make({ 'F04-K': k, 'F04-A': a }, { closed: { 'F04-K|2026-11-05': 0, 'F04-A|2026-11-02': 1 } });
  const o = c.FUNERGY_UP.stats(STORES, NOV);
  assert.equal(o.stores.join(','), 'F04-K,F04-A', 'ToriTon は入れない');
  assert.equal(o.n.missing, 1, '11/5 は取り込めていない（店休ではない）');
  assert.equal(o.per['F04-K'].days.find(x => x.d === '2026-11-05').k, 'missing');
  assert.equal(o.per['F04-A'].days.find(x => x.d === '2026-11-02').k, 'ok', '数があれば店休の設定より数');
  assert.ok(!o.days.some(x => x.d >= TODAY), '今日は入れない');
  const allK = 12 * 20, upK = 5 * 4 + 7 * 6, allA = 13 * 10, upA = 13;
  assert.equal(o.all, allK + allA); assert.equal(o.up, upK + upA);
  assert.equal(o.rate, Math.round((upK + upA) / (allK + allA) * 1000) / 10);
  assert.equal(o.days[0].d, '2026-11-13', '新しい日が上');
});

test('前週比：直近 7 日と前の 7 日を店ごと・同じ曜日の対で。片方に数が無い日は両方外す', () => {
  const k = dailyFor(d => {
    if (d === '2026-11-10' || d === '2026-11-02') return null;            // 11/10（直近）と 11/2（前の週の 11/9 の対）が無い
    return { misoTotal: 10, misoUpgrade: d >= '2026-11-07' ? 3 : 2 };
  });
  const c = make({ 'F04-K': k });
  const w = c.FUNERGY_UP.wow(['F04-K']);
  assert.equal(w.from, '2026-11-07'); assert.equal(w.to, '2026-11-13'); assert.equal(w.pfrom, '2026-10-31'); assert.equal(w.pto, '2026-11-06');
  assert.equal(w.pairs, 4, '11/10・11/9（対の 11/2 が無い）・11/7（対の 10/31 が無い）を外した');
  assert.equal(w.cur.all, 40); assert.equal(w.cur.up, 12); assert.equal(w.prev.all, 40); assert.equal(w.prev.up, 8);
  assert.equal(w.rateCur, 30); assert.equal(w.ratePrev, 20); assert.equal(w.pt, 10); assert.equal(w.rel, 50);
  assert.equal(w.dropped.length, 3);
  assert.ok(['2026-11-10', '2026-11-09', '2026-11-07'].every(d => w.dropped.some(x => x.d === d)));
});

test('タイル：率は keyKpiStats の数・目標・前週比 pt・分子 ÷ 分母・押すと内訳。Totoya の店が無ければ出さない', () => {
  const k = dailyFor(d => ({ misoTotal: 10, misoUpgrade: d >= '2026-11-07' ? 3 : 2 }));
  const c = make({ 'F04-K': k });
  const html = c.FUNERGY_UP.kpiTile([{ id: 'F04-K' }], NOV, { misoRate: 24.6, misoTgt: 25, misoUp: 32, misoAll: 130 });
  assert.match(html, /アップグレード率 ★/); assert.match(html, /24\.6%/); assert.match(html, /目標 25%/);
  assert.match(html, /<badge 10pt>/, '前週比は pt');
  assert.match(html, /分子 32 ÷ 分母 130 件/); assert.match(html, /内訳を見る ›/);
  assert.match(html, /var\(--yellow\)/, '目標の 9 割以上は黄');
  assert.equal(c.FUNERGY_UP.kpiTile([{ id: 'F01' }], NOV, { misoRate: 10 }), '');
  const none = c.FUNERGY_UP.kpiTile([{ id: 'F04-K' }], NOV, { misoRate: null, misoTgt: 25 });
  assert.match(none, /—/); assert.match(none, /まだ数がありません/);
});

function restWith(daysRows, linesRows, opt = {}) {
  return (tbl, q) => {
    if (opt.notable) return { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } };
    if (tbl === 'toast_upgrade_days') return { status: 200, body: daysRows.filter(r => r.restaurant_guid === q.get('restaurant_guid').slice(3)) };
    if (tbl === 'toast_upgrade_lines') { if (opt.lineErr) return { status: 500, body: {} }; return { status: 200, body: linesRows.filter(r => r.business_date === q.get('business_date').slice(3)) }; }
    return { status: 400, body: {} };
  };
}

test('内訳：種類ごとの数は印のある日だけ・印の数が日次と違う日は使わない・明細なしの日は取り込み直すと出る', async () => {
  const k = dailyFor(d => ({ misoTotal: 10, misoUpgrade: 3 }));
  const daysRows = [
    { restaurant_guid: 'g-k', business_date: '2026-11-13', aosa: 7, crab: 1, today: 1, udon: 0, chazuke: 1, total: 10, upgrade: 3 },
    { restaurant_guid: 'g-k', business_date: '2026-11-12', aosa: 7, crab: 2, today: 0, udon: 0.5, chazuke: 0.5, total: 10, upgrade: 3 },
    { restaurant_guid: 'g-k', business_date: '2026-11-11', aosa: 6, crab: 4, today: 0, udon: 0, chazuke: 0, total: 10, upgrade: 4 },   // 日次は 3 → 使わない
  ];
  const lines = [
    { business_date: '2026-11-13', line_key: 's1:0', order_no: '101', opened_at: '2026-11-13T22:05:00Z', meal: 'L', takeout: false, bowl_guid: 'bw-matsu-1', bowl_name: 'Matsu', mod_name: 'Crab Miso', kind: 'crab', qty: 1, counted: true },
    { business_date: '2026-11-13', line_key: 's2:0', order_no: '102', opened_at: '2026-11-13T22:10:00Z', meal: 'L', takeout: true, bowl_guid: 'bw-take-2', bowl_name: 'Take', mod_name: "Today's", kind: 'today', qty: 1, counted: true },
    { business_date: '2026-11-13', line_key: 's3:0', order_no: '103', opened_at: '2026-11-14T03:00:00Z', meal: 'D', takeout: false, bowl_guid: 'bw-matsu-1', bowl_name: 'Matsu', mod_name: 'CHAZUKE', kind: 'chazuke', qty: 1, counted: true },
    { business_date: '2026-11-13', line_key: 's4:0', order_no: '104', opened_at: '2026-11-14T03:30:00Z', meal: 'D', takeout: false, bowl_guid: 'bw-matsu-1', bowl_name: 'Matsu', mod_name: 'AOSA', kind: 'aosa', qty: 6, counted: true },
    { business_date: '2026-11-13', line_key: 's6:0', order_no: '106', opened_at: '2026-11-14T03:40:00Z', meal: 'D', takeout: false, bowl_guid: 'bw-take-2', bowl_name: 'Take', mod_name: 'AOSA', kind: 'aosa', qty: 1, counted: true },
    { business_date: '2026-11-13', line_key: 's5:0', order_no: '105', opened_at: '2026-11-14T04:00:00Z', meal: 'D', takeout: false, bowl_guid: 'bw-matsu-1', bowl_name: '<img src=x onerror=alert(1)>', mod_name: 'Crab', kind: 'crab', qty: 2, counted: false, reason: 'void_order' },
  ];
  const c = make({ 'F04-K': k }, { rest: restWith(daysRows, lines) });
  const html0 = c.FUNERGY_UP.kpiTile([{ id: 'F04-K' }], NOV, { misoRate: 30, misoTgt: 25, misoUp: 39, misoAll: 130 });
  const id = /FUNERGY_UP\.open\('([^']+)'\)/.exec(html0)[1];
  c.FUNERGY_UP.open(id);
  assert.match(c._modal, /アップグレード率の内訳/); assert.match(c._modal, /11\/1〜11\/13（ハワイ時間・昨日まで）/);
  assert.match(c._modal, /種類ごとの数を読んでいます/);
  assert.match(c._modal, /Aosa（通常の味噌汁）＋ 分子/);
  assert.match(c._modal, /data-tab="sum"/, 'スマホは「まとめ」から');
  await settle(); await settle(); await settle();
  const s = c.FUNERGY_UP.kindSums(id);
  assert.equal(s.daysOk, 13); assert.equal(s.daysWith, 2); assert.equal(s.diff, 1);
  assert.equal(s.crab, 3); assert.equal(s.chazuke, 1.5); assert.equal(s.aosa, 14); assert.equal(s.all, 20); assert.equal(s.up, 6);
  const kinds = c._els['up-kinds-' + id].innerHTML;
  assert.match(kinds, /茶漬け/); assert.match(kinds, /明細のある 2 \/ 13 日/); assert.match(kinds, /違う日が 1 日/);
  assert.match(kinds, /CHAZUKE（茶漬け）<\/td><td>1\.5<\/td><td>7\.5%/);
  const daysH = c._els['up-days-' + id].innerHTML;
  assert.match(daysH, /FUNERGY_UP\.pickAt\('u\d+',0,'2026-11-13'\)/, '店は番号で渡す');
  assert.ok(!/pickAt\([^)]*F04-K/.test(daysH));
  // 自動で一番新しい日（11/13）の明細を読む
  const day = c._els['up-day-' + id].innerHTML;
  assert.match(day, /丼ごと/); assert.match(day, /注文ごと/); assert.match(day, /6 行/);
  assert.ok(!/印の数と違います/.test(day), '明細の合計＝印');
  assert.match(day, /<td>Take<br>/, '同じ丼でも店内とテイクアウトは別の行');
  assert.match(day, /対象外（注文の取消）/); assert.match(day, /分母だけ/); assert.match(day, /計上（分子）/);
  assert.match(day, /12:05 <span class="up-mut">L<\/span>/, 'ハワイの時刻');
  assert.match(day, /Take <span class="up-mut">TO<\/span>/); assert.ok(!/Matsu <span class="up-mut">TO/.test(day), "店内の丼に TO を付けない");
  assert.ok(!day.includes('<img'), '名前はエスケープする'); assert.match(day, /&lt;img/);
  assert.match(day, /ID …atsu-1/);
  assert.equal((c._els['up-drill-' + id] || { _attr: {} })._attr['data-tab'], undefined, '自動で選んだときはタブを変えない');
  // 明細なしの日（11/10）を押す
  await c.FUNERGY_UP.pickAt(id, 0, '2026-11-10');
  assert.match(c._els['up-day-' + id].innerHTML, /注文の明細はまだありません/);
  assert.equal(c._els['up-drill-' + id]._attr['data-tab'], 'day', '押したらスマホは日別へ');
  // 印はあるのに行が足りない日（11/12：行が 0）
  await c.FUNERGY_UP.pickAt(id, 0, '2026-11-12');
  assert.match(c._els['up-day-' + id].innerHTML, /明細の行の合計が印の数と違います/);
  // 印と日次が違う日（11/11）
  await c.FUNERGY_UP.pickAt(id, 0, '2026-11-11');
  assert.match(c._els['up-day-' + id].innerHTML, /違います。この日を取り込み直してください/);
  // おかしな値は受けない
  await c.FUNERGY_UP.pickAt(id, 0, "2026-11-13');alert(1);//");
  assert.ok(!c._calls.some(u => u.includes('alert')));
  assert.equal(c._upCtx[id].pick.d, '2026-11-11', 'おかしな日付では選び直さない');
  // 明細は公開の鍵で読むだけ（GET）
  assert.ok(c._calls.every(u => /\/rest\/v1\/toast_upgrade_(days|lines)\?/.test(u)));
});

test('サーバーの準備（SQL）がまだのとき・明細を読めなかったとき：率と日ごとの数は出す・もう一度押すと読み直す', async () => {
  const k = dailyFor(d => ({ misoTotal: 10, misoUpgrade: 3 }));
  const c = make({ 'F04-K': k }, { rest: restWith([], [], { notable: true }) });
  const id = c.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, { misoRate: 30 });
  c.FUNERGY_UP.open(id); await settle(); await settle();
  assert.match(c._els['up-kinds-' + id].innerHTML, /サーバーの準備（SQL）がまだ/);
  assert.match(c._els['up-days-' + id].innerHTML, /30\.0%/);
  const rows = [{ restaurant_guid: 'g-k', business_date: '2026-11-13', aosa: 7, crab: 3, today: 0, udon: 0, chazuke: 0, total: 10, upgrade: 3 }];
  let fail = true;
  const c2 = make({ 'F04-K': k }, { rest: (tbl, q) => tbl === 'toast_upgrade_lines' && fail ? { status: 500, body: {} } : restWith(rows, [{ business_date: '2026-11-13', line_key: 'a:0', kind: 'aosa', qty: 7, counted: true }, { business_date: '2026-11-13', line_key: 'b:0', kind: 'crab', qty: 3, counted: true }])(tbl, q) });
  const id2 = c2.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, {});
  c2.FUNERGY_UP.open(id2); await settle(); await settle(); await settle();
  assert.match(c2._els['up-day-' + id2].innerHTML, /読めませんでした。もう一度押してください/);
  fail = false;
  await c2.FUNERGY_UP.pickAt(id2, 0, '2026-11-13');
  assert.match(c2._els['up-day-' + id2].innerHTML, /丼ごと/);
});

test('英語の画面・手入力の店の注意・店休と取り込めていない日の言葉', async () => {
  const k = dailyFor(d => d === '2026-11-03' || d === '2026-11-04' ? null : { misoTotal: 10, misoUpgrade: 3 });
  const c = make({ 'F04-K': k }, { en: true, closed: { 'F04-K|2026-11-03': 1 } });
  const id = c.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, { misoTgt: 25, totoyaParts: [{ sid: 'F04-K', srcMisoUp: '手入力', srcMisoAll: 'Toast' }] });
  const h = c.FUNERGY_UP.html(id);
  assert.match(h, /Upgrade rate breakdown/); assert.match(h, /through yesterday/); assert.match(h, /typed in KPI settings/);
  assert.match(h, /Closed/); assert.match(h, /Not imported \(not zero sales\)/);
  assert.match(h, /Target 25% · diff \+5\.0pt/);
});

test('画面の作り：CSS（PC 2 列・スマホのタブ）・重要 KPI のタイルを置き換え・版', () => {
  assert.match(HTML, /#modal-body:has\(> \.up-drill\) \{ max-width: min\(1100px, 96vw\); \}/);
  assert.match(HTML, /@media \(max-width: 820px\) \{\n  \.up-drill \.up-grid \{ display: block; \}/);
  assert.match(HTML, /if \(k\.totoyaScope && window\.FUNERGY_UP\) \{ try \{ html \+= FUNERGY_UP\.kpiTile\(stores, days, k\); \} catch\(e\) \{ \} \}\n  else if \(k\.totoyaScope && k\.misoRate!=null\)/);
  assert.match(fnSrc('misoSub'), /アップグレード（分子）/);
  assert.ok(!fnSrc('misoSub').includes('味噌汁を付けた数'), '前の誤った言葉を消した');
  const v = +(/const APP_VERSION = '(\d+)'/.exec(HTML)[1]);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(v >= 1171); assert.equal(String(v), /const SW_BUILD = '(\d+)'/.exec(sw)[1]);
});
