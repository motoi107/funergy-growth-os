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

test('totoyaKpiCalc：味噌汁・茶漬け（分母・分子）もいくらシャワー・丼数も今日を入れない・過去の月は同じ', () => {
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
  assert.equal(r.eff.ikura, 26, 'いくらシャワーも昨日まで（Moto さん 11/14 21:52 HST）');
  assert.equal(r.eff.bowls, 104);
  assert.equal(r.ikuraRate, 25);
  assert.equal(oct0(ctx).eff.ikura, 1, '過去の月のいくらシャワーは変わらない');
  const oct = ctx.totoyaKpiCalc('F04-K', '2026.10');
  assert.equal(oct.eff.misoAll, 50, '過去の月は変わらない');
  ctx.bizToday = () => '2026-11-01';
  const first = ctx.totoyaKpiCalc('F04-K', '2026.11');
  assert.equal(first.eff.misoAll, null, '月の初日は昨日までの日が無い＝数なし（0 にしない）');
  assert.equal(first.misoRate, null);
  assert.equal(first.eff.ikura, null, 'いくらシャワーも同じ');
  assert.equal(first.ikuraRate, null);
});
function oct0(ctx) { return ctx.totoyaKpiCalc('F04-K', '2026.10'); }

test('totoyaKpiCalc：今月は Toast の数を使う店なら、昨日までの数が無くても menu_mix に切り替えない（Codex #168 P3）・Toast の数の無い店は今までどおり', () => {
  const cfg = { ikuraGuids: ['g-ikura'], ikuraBowlGuids: ['g-bowl'], misoAllGuids: ['g-miso'], misoUpGuids: ['g-up'] };
  const recipes = [{ id: 'r1', toastGuid: 'g-ikura', name: 'Ikura' }, { id: 'r2', toastGuid: 'g-bowl', name: 'Bowl' }, { id: 'r3', toastGuid: 'g-miso', name: 'Miso' }, { id: 'r4', toastGuid: 'g-up', name: 'Up' }];
  const mix = { items: { r1: 900, r2: 1000, r3: 800, r4: 700 } };
  const mk = (da, today) => {
    const ctx = {
      Math, Number, String, Object, Array, isNaN, parseFloat, console,
      bizToday: () => today, getTotoyaKpiCfg: () => cfg, getKpiManual: () => ({}), getMenuMix: () => mix,
      activeRecipes: () => recipes, recipeInStore: () => true, getDailyActuals: () => da, _daRO: () => da,
    };
    vm.createContext(ctx);
    ['_totoyaKw', '_totoyaMatchKw', 'totoyaKpiCalc'].forEach(n => vm.runInContext(fnSrc(n), ctx));
    return ctx;
  };
  // 月の初日：今日の行（途中の数）だけが Toast にある
  const da = { '2026-12-01': { misoTotal: 5, misoUpgrade: 2, ikuraShower: 1, ikuraBowls: 4 }, '2026-11-30': { misoTotal: 10, misoUpgrade: 3, ikuraShower: 2, ikuraBowls: 8 } };
  const c = mk(da, '2026-12-01');
  const r = c.totoyaKpiCalc('F04-K', '2026.12');
  assert.equal(r.eff.ikura, null, 'menu_mix の 900 にしない'); assert.equal(r.eff.bowls, null);
  assert.equal(r.eff.misoAll, null); assert.equal(r.eff.misoUp, null);
  assert.equal(r.src.ikura, 'Toast'); assert.equal(r.ikuraRate, null); assert.equal(r.misoRate, null);
  assert.equal(r.sel.i, 2, 'Toast の欄は数に入る（設定の数の表示は前と同じ）');
  // 前の月（Toast の数がある）は今までどおり
  const nov = c.totoyaKpiCalc('F04-K', '2026.11');
  assert.equal(nov.eff.ikura, 2); assert.equal(nov.src.ikura, 'Toast');
  // Toast の数が一つも無い店：今月も menu_mix（今までどおり）
  const c2 = mk({}, '2026-12-01');
  const r2 = c2.totoyaKpiCalc('F04-K', '2026.12');
  assert.equal(r2.eff.ikura, 900); assert.equal(r2.src.ikura, 'menu_mix'); assert.equal(r2.eff.misoAll, 800);
  // 過去の月に Toast の数が無いときも menu_mix（今までどおり）
  const c3 = mk({ '2026-12-01': { ikuraShower: 1, ikuraBowls: 4 } }, '2026-12-02');
  assert.equal(c3.totoyaKpiCalc('F04-K', '2026.11').eff.ikura, 900, '過去の月は切り替えのまま');
  assert.equal(c3.totoyaKpiCalc('F04-K', '2026.12').eff.ikura, 1, '昨日（12/01）までの Toast');
});

test('日別で見る（いくらシャワー・味噌汁）：今日の行を並べない＝タイルの合計と同じ日まで', () => {
  const da = {};
  for (let i = 1; i <= 14; i++) { const d = '2026-11-' + String(i).padStart(2, '0'); da[d] = { ikuraShower: 2, ikuraBowls: 8 }; }
  const ctx = { Math, Number, String, Object, Array, isNaN, console, bizToday: () => TODAY, getDailyActuals: () => da, escapeHtml: x => String(x), t: (ja) => ja };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('_totoyaDayRows'), ctx);
  const h = ctx._totoyaDayRows('F04-K', '2026-11', 'ikuraShower', 'ikuraBowls');
  assert.match(h, /日別で見る（13日）/);
  assert.ok(h.includes('11/13 2/8') && !h.includes('11/14'), '11/14（今日）は出さない');
  ctx.bizToday = () => '2026-12-05';
  assert.match(ctx._totoyaDayRows('F04-K', '2026-11', 'ikuraShower', 'ikuraBowls'), /日別で見る（14日）/, '過去の月はすべて');
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

// PostgREST と同じように limit・offset を守る。サーバーの 1 回の上限（max rows）も opt.maxRows で作れる
function page(rows, q, opt) {
  const off = Number(q.get('offset') || 0), lim = q.get('limit') == null ? Infinity : Number(q.get('limit'));
  return rows.slice(off, off + Math.min(lim, opt.maxRows || Infinity));
}
function restWith(daysRows, linesRows, opt = {}) {
  return (tbl, q) => {
    if (opt.notable) return { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } };
    if (tbl === 'toast_upgrade_days') return { status: 200, body: page(daysRows.filter(r => r.restaurant_guid === q.get('restaurant_guid').slice(3)), q, opt) };
    if (tbl === 'toast_upgrade_lines') {
      if (opt.lineErr) return { status: 500, body: {} };
      if (opt.failAt && opt.failAt(q)) return { status: 500, body: {} };
      return { status: 200, body: page(linesRows.filter(r => r.business_date === q.get('business_date').slice(3)), q, opt) };
    }
    return { status: 400, body: {} };
  };
}
const until = async (fn) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 0)); } };

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
  assert.match(c._els['up-day-' + id].innerHTML, /明細の行の合計（分子 0 \/ 分母 0）が印の数と違います/);
  assert.ok(!/up-bowls/.test(c._els['up-day-' + id].innerHTML), '合わない日は丼ごとの表を出さない');
  assert.ok(!c._upCtx[id].lines['F04-K|2026-11-12'].ok, '合わない日は覚えない（もう一度押すと読み直す）');
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

test('明細はページごとに読む（Codex #168 P2）：サーバーの上限が 1,000 行でも 5,500 行をすべて・途中で読めなければ覚えずに読み直す・上限を超えたら丼ごとの数を出さない', async () => {
  const k = dailyFor(d => (d === '2026-11-13' ? { misoTotal: 5500, misoUpgrade: 1500 } : { misoTotal: 10, misoUpgrade: 3 }));
  const daysRows = [{ restaurant_guid: 'g-k', business_date: '2026-11-13', aosa: 4000, crab: 1500, today: 0, udon: 0, chazuke: 0, total: 5500, upgrade: 1500 }];
  const lines = [];
  for (let i = 0; i < 5500; i++) lines.push({ business_date: '2026-11-13', line_key: 'L' + String(i).padStart(5, '0') + ':0', order_no: String(1000 + i), opened_at: '2026-11-13T22:00:00Z', meal: 'L', takeout: false, bowl_guid: 'bw-1', bowl_name: 'Matsu', mod_name: i < 4000 ? 'AOSA' : 'Crab', kind: i < 4000 ? 'aosa' : 'crab', qty: 1, counted: true });
  // 1) 全部読める
  const c = make({ 'F04-K': k }, { rest: restWith(daysRows, lines, { maxRows: 1000 }) });
  const id = c.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, {});
  c.FUNERGY_UP.open(id);
  await until(() => c._upCtx[id].lines['F04-K|2026-11-13'] && !c._upCtx[id].lines['F04-K|2026-11-13'].busy);
  const L = c._upCtx[id].lines['F04-K|2026-11-13'];
  assert.equal(L.rows.length, 5500, 'すべての行'); assert.equal(L.ok, true); assert.ok(!L.cut);
  const day = c._els['up-day-' + id].innerHTML;
  assert.match(day, /丼ごと/); assert.match(day, /5,?500 行/);
  assert.ok(!/印の数と違います/.test(day));
  const lineCalls = c._calls.filter(u => u.includes('toast_upgrade_lines'));
  assert.ok(lineCalls.every(u => /limit=1000&offset=\d+/.test(u)), '1,000 行ずつ');
  assert.equal(lineCalls.length, 7, '6 ページ＋空のページ');
  // 読み終えて合った日は、もう一度押しても読まない
  await c.FUNERGY_UP.pickAt(id, 0, '2026-11-13');
  assert.equal(c._calls.filter(u => u.includes('toast_upgrade_lines')).length, 7);

  // 2) 途中のページで読めない → 覚えない → もう一度押すと最初から読み直す
  let fail = true;
  const c2 = make({ 'F04-K': k }, { rest: restWith(daysRows, lines, { maxRows: 1000, failAt: q => fail && q.get('offset') === '3000' }) });
  const id2 = c2.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, {});
  c2.FUNERGY_UP.open(id2);
  await until(() => c2._upCtx[id2].lines['F04-K|2026-11-13'] && c2._upCtx[id2].lines['F04-K|2026-11-13'].err);
  assert.match(c2._els['up-day-' + id2].innerHTML, /読めませんでした。もう一度押してください/);
  assert.ok(!c2._upCtx[id2].lines['F04-K|2026-11-13'].rows, '途中までの行は使わない');
  fail = false;
  await c2.FUNERGY_UP.pickAt(id2, 0, '2026-11-13');
  assert.equal(c2._upCtx[id2].lines['F04-K|2026-11-13'].rows.length, 5500);
  assert.match(c2._els['up-day-' + id2].innerHTML, /丼ごと/);

  // 3) 上限（CAP）を超える日：途中までしか読めないので丼ごとの数を出さない・覚えない
  const c3 = make({ 'F04-K': k }, { rest: restWith(daysRows, lines, { maxRows: 1000 }) });
  c3.FUNERGY_UP.CAP = 2000;
  const id3 = c3.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, {});
  c3.FUNERGY_UP.open(id3);
  await until(() => c3._upCtx[id3].lines['F04-K|2026-11-13'] && !c3._upCtx[id3].lines['F04-K|2026-11-13'].busy);
  const L3 = c3._upCtx[id3].lines['F04-K|2026-11-13'];
  assert.equal(L3.cut, true); assert.equal(L3.ok, false);
  const d3 = c3._els['up-day-' + id3].innerHTML;
  assert.match(d3, /最初の 2,?000 行までしか読めませんでした/); assert.ok(!/up-bowls/.test(d3), '丼ごとの表を出さない');
});

test('日の印もページごとに読む：サーバーの上限が 10 行でも 13 日分そろう', async () => {
  const k = dailyFor(d => ({ misoTotal: 10, misoUpgrade: 3 }));
  const daysRows = NOV.filter(d => d.date < TODAY).map(d => ({ restaurant_guid: 'g-k', business_date: d.date, aosa: 7, crab: 3, today: 0, udon: 0, chazuke: 0, total: 10, upgrade: 3 }));
  const c = make({ 'F04-K': k }, { rest: restWith(daysRows, [], { maxRows: 10 }) });
  const id = c.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, {});
  c.FUNERGY_UP.open(id);
  await until(() => c._upCtx[id].srv);
  assert.equal(Object.keys(c._upCtx[id].srv.by['F04-K']).length, 13);
  assert.equal(c.FUNERGY_UP.kindSums(id).daysWith, 13);
});

test('英語の画面・手入力の店の注意・店休と取り込めていない日の言葉', async () => {
  const k = dailyFor(d => d === '2026-11-03' || d === '2026-11-04' ? null : { misoTotal: 10, misoUpgrade: 3 });
  const c = make({ 'F04-K': k }, { en: true, closed: { 'F04-K|2026-11-03': 1 } });
  const id = c.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, { misoTgt: 25, totoyaParts: [{ sid: 'F04-K', srcMisoUp: '手入力', srcMisoAll: 'Toast' }] });
  const h = c.FUNERGY_UP.html(id);
  assert.match(h, /Upgrade rate breakdown/); assert.match(h, /through yesterday/); assert.match(h, /typed in KPI settings/);
  assert.match(h, /Closed/); assert.match(h, /Not imported \(not zero sales\)/);
  assert.match(h, /Target 25% · diff \+5\.0pt/);
  assert.ok(!/monthly item mix/.test(h), 'menu_mix の店が無ければ出さない');
  // タイルが menu_mix の数の店（Codex #168 P3）：出どころと期間の違いを出す
  const c2 = make({ 'F04-K': k }, {});
  const id2 = c2.FUNERGY_UP.ctx([{ id: 'F04-K' }], NOV, { totoyaParts: [{ sid: 'F04-K', srcMisoUp: 'menu_mix', srcMisoAll: 'menu_mix' }, { sid: 'F04-A', srcMisoUp: 'menu_mix', srcMisoAll: 'menu_mix' }] });
  const h2 = c2.FUNERGY_UP.html(id2);
  assert.match(h2, /月の出数（menu_mix）で数えている店があります（Totoya Kaimuki）/, '内訳の店だけ');
  assert.match(h2, /Toast の昨日までの数/);
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
