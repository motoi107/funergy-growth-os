// v1130（11/02 の依頼 0・UI案67）：リピート率（FT・RP・SR）の数と取り込みの状態を、どの画面でも同じ決まりで出す（FUNERGY_VT）。
// 合成データ・本番に接続しない。index.html の FUNERGY_VT の区切りの中と、今までの repeatStats を VM で動かす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const A = HTML.indexOf('/* ==== FUNERGY_VT start'), B = HTML.indexOf('/* ==== FUNERGY_VT end ==== */');
assert.ok(A > 0 && B > A, 'FUNERGY_VT の区切りがある');
const MOD = HTML.slice(A, B);
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let depth = 0, j = HTML.indexOf('{', i);
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error(name);
}

const TODAY = '2026-10-31';
function make(daily, extra = {}) {
  const els = {};
  const ctx = {
    console, Math, Date, JSON, Number, String, Object, Array, isFinite, isNaN, Promise, setTimeout,
    window: null, localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    document: { getElementById: id => els[id] || (els[id] = { id, innerHTML: '', style: {}, disabled: false }) },
    _els: els,
    bizToday: () => TODAY,
    _daRO: sid => daily[sid] || {},
    getDailyActuals: sid => daily[sid] || {},
    dayClosureMode: (sid, d) => (extra.closed && extra.closed[sid + '|' + d]) ? 'closed' : null,
    getStoresAll: () => [{ id: 'F01', name: 'ToriTon', toastGuid: 'g1' }, { id: 'F02', name: 'Tenkichi', toastGuid: 'g2' }, { id: 'F06', name: 'LaLa', toastGuid: 'g6' }, { id: 'F03', name: 'FSP', toastGuid: 'g3' }],
    getVisibleStores: () => ctx.getStoresAll(),
    fstState: () => ({ sales: { by: extra.fst || {} } }),
    fstFailing: r => !!r && r.last === 'fail',
    t: (ja) => ja,
    curRole: extra.role || 'gm',
    openModal: html => { ctx._modal = html; },
    fetchToastSales: async (guid) => (extra.server || {})[guid] || [],
    supaFetchAllRows: async (path) => (extra.rest || (() => []))(path),
    repeatStatsLD: () => ({ has: false }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fnSrc('repeatStats'), ctx);
  vm.runInContext(MOD, ctx);
  return ctx;
}
const days = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d = new Date(d.getTime() + 86400000)) out.push({ date: d.toISOString().slice(0, 10) }); return out; };
const OCT = days('2026-10-01', '2026-10-31');

test('ふつう：（RP＋SR）÷（FT＋RP＋SR）。期間で足してから割る・repeatStats と同じ数・画面の RP は SR を除く', () => {
  const da = {}; OCT.slice(0, 30).forEach((d, i) => { da[d.date] = { actual: 1000, toastSrc: true, firstTimeBowls: 10 + (i % 3), repeatBowls: 6 + (i % 5), superRegular: 2 }; });
  const c = make({ F01: da });
  const o = c.FUNERGY_VT.stats([{ id: 'F01' }], OCT);
  const rs = c.repeatStats([{ id: 'F01' }], OCT);
  assert.equal(o.first, rs.first); assert.equal(o.repeat, rs.repeat); assert.equal(o.sr, rs.sr);
  assert.equal(o.rate, Math.round(rs.repeat / rs.total * 1000) / 10);
  assert.equal(o.rp, o.repeat - o.sr);
  assert.equal(o.state, 'ok'); assert.equal(o.n.vt, 30); assert.equal(o.n.missing, 0);
  const p = c.FUNERGY_VT.parts(o, 40);
  assert.ok(p.judge); assert.match(p.val, /%$/); assert.match(p.line, /FT \d+ · RP \d+ · SR 60/);
});

test('LaLa の今の形：売上はあるのに FT・RP・SR が 0 → 対象データなし（0% にしない・判定しない）', () => {
  const da = {}; OCT.slice(0, 30).forEach(d => { da[d.date] = { actual: 2000, toastSrc: true, firstTimeBowls: 0, repeatBowls: 0, superRegular: 0 }; });
  const c = make({ F06: da });
  const o = c.FUNERGY_VT.stats(['F06'], OCT);
  assert.equal(o.rate, null); assert.equal(o.state, 'nodata'); assert.equal(o.n.zero, 30);
  const p = c.FUNERGY_VT.parts(o, 40);
  assert.equal(p.val, '対象データなし'); assert.equal(p.judge, false); assert.equal(p.tag, '判定しません');
  const tile = c.FUNERGY_VT.kpiTile(['F06'], OCT, 40);
  assert.match(tile, /対象データなし/); assert.doesNotMatch(tile, /0\.0%/);
});

test('本当の 0%：FT があり RP・SR が 0 → 0.0%（判定する）', () => {
  const da = { '2026-10-01': { actual: 500, firstTimeBowls: 12, repeatBowls: 0, superRegular: 0 } };
  const c = make({ F01: da });
  const o = c.FUNERGY_VT.stats(['F01'], [{ date: '2026-10-01' }]);
  assert.equal(o.rate, 0); assert.equal(o.state, 'ok');
  assert.equal(c.FUNERGY_VT.parts(o, 40).val, '0.0%');
});

test('未取込の日・店休・今日：未取込は数えて「途中の数字」、店休は分ける、今日と先の日は状態に入れない', () => {
  const da = {};
  OCT.slice(0, 20).forEach(d => { da[d.date] = { actual: 900, firstTimeBowls: 5, repeatBowls: 5 }; });
  da['2026-10-21'] = { actual: 0 };                       // 取り込めたが売上 0 → 店休
  da['2026-10-31'] = { actual: 100, firstTimeBowls: 1, repeatBowls: 1 };   // 今日（途中）→ 数には入る・状態には入れない
  const c = make({ F01: da }, { closed: { 'F01|2026-10-22': 1 } });
  const o = c.FUNERGY_VT.stats(['F01'], OCT);
  assert.equal(o.n.vt, 20); assert.equal(o.n.closed, 2); assert.equal(o.n.missing, 8, '10/23〜10/30 は売上の行が無い');
  assert.equal(o.state, 'partial'); assert.equal(o.first, 101); assert.equal(o.repeat, 101);
  const p = c.FUNERGY_VT.parts(o, null);
  assert.match(p.tag, /未取込 8 日 · 途中の数字/); assert.ok(p.judge);
});

test('売上の行が 1 日も無い → 未取込（データなしとも 0% とも分ける）。最後の読み込みの失敗も出す', () => {
  const c = make({ F06: {} }, { fst: { F06: { last: 'fail', fail: '2026-10-31T17:12:00Z', ok: '2026-10-30T17:10:00Z' } } });
  const o = c.FUNERGY_VT.stats(['F06'], OCT);
  assert.equal(o.state, 'missing'); assert.equal(o.rate, null);
  const p = c.FUNERGY_VT.parts(o, 40);
  assert.equal(p.val, '未取込'); assert.match(p.tag, /最後の取り込みが失敗 10\/31 07:12/);
});

test('複数店：数を足してから割る（店ごとの率の平均ではない）・FSP は数えない', () => {
  const d1 = { '2026-10-01': { actual: 1, firstTimeBowls: 90, repeatBowls: 10 } };
  const d2 = { '2026-10-01': { actual: 1, firstTimeBowls: 1, repeatBowls: 9 } };
  const d3 = { '2026-10-01': { actual: 1, firstTimeBowls: 0, repeatBowls: 1000 } };
  const c = make({ F01: d1, F02: d2, F03: d3 });
  const o = c.FUNERGY_VT.stats(['F01', 'F02', 'F03'], [{ date: '2026-10-01' }]);
  assert.equal(JSON.stringify(o.stores), JSON.stringify(['F01', 'F02']));
  assert.equal(o.rate, Math.round(19 / 110 * 1000) / 10);
  assert.notEqual(o.rate, (10 + 90) / 2);
});

test('内訳：サーバーの行（toast_sales）と端末の数を日ごとに照合し、違う日を出す。最後に取り込めた時刻はハワイ時間', async () => {
  const da = { '2026-10-01': { actual: 100, firstTimeBowls: 3, repeatBowls: 4, superRegular: 1 }, '2026-10-02': { actual: 100, firstTimeBowls: 0, repeatBowls: 0 } };
  const server = { g6: [
    { business_date: '2026-10-01', first_time_count: 3, repeat_count: 4, super_regular_count: 1, fetched_at: '2026-10-02T17:05:00Z' },
    { business_date: '2026-10-02', first_time_count: 5, repeat_count: 6, super_regular_count: 2, fetched_at: '2026-10-03T17:06:00Z' },
  ] };
  const c = make({ F06: da }, { server });
  const id = c.FUNERGY_VT.ctx(['F06'], ['2026-10-01', '2026-10-02'], '10月');
  c.FUNERGY_VT.open(id);
  assert.match(c._modal, /リピート率の内訳/);
  assert.match(c._modal, /取り込めたが来店区分 0/);
  await c.FUNERGY_VT.loadSrc(id);
  const src = c._els['vt-src-' + id].innerHTML;
  assert.match(src, /端末の数と違う日 1 日（10\/2）/);
  assert.match(src, /最後に取り込めた時刻 10\/3 07:06/);
  c.FUNERGY_VT.toggleDays(id);
  assert.match(c._els['vt-days-' + id].innerHTML, /違う（FT 5・RP\+SR 6）/);
});

test('同期センターの店の比べ：LaLa は「Customers が見つからない／メニューの表が空」と対象データなし・欠けを赤で。合計は足してから割る', async () => {
  const mk = (n, ft, rp, sr) => Array.from({ length: n }, (_, i) => ({ business_date: '2026-10-' + String(i + 1).padStart(2, '0'), net_sales: 1000, first_time_count: ft, repeat_count: rp, super_regular_count: sr, fetched_at: '2026-10-31T17:00:00Z' }));
  const server = { g1: mk(30, 10, 8, 2), g2: mk(30, 5, 5, 1), g6: mk(30, 0, 0, 0) };
  const rest = path => {
    const g = /restaurant_guid=eq\.([^&]+)/.exec(path)[1];
    if (path.startsWith('toast_menu_items')) return g === 'g6' ? [] : [{ category: 'Customers' }, { category: ' customers ' }, { category: 'Bowls' }];
    const n = g === 'g6' ? 20 : 30;
    return Array.from({ length: n }, (_, i) => ({ business_date: '2026-10-' + String(i + 1).padStart(2, '0') }));
  };
  const c = make({}, { server, rest });
  c.FUNERGY_VT.storeCompare(0);
  assert.match(c._modal, /店ごとの来店区分と出数の取り込み/);
  const ds = Array.from({ length: 30 }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));
  await c.FUNERGY_VT.loadCompare('2026-10', ds, c.FUNERGY_VT._cmpSeq);
  const h = c._els['vt-cmp'].innerHTML;
  assert.match(h, /LaLa<\/b><\/td><td style="color:#7a4a00">メニューの表が空/);
  assert.match(h, /対象データなし/);
  assert.match(h, /color:#b42318;font-weight:700">20\/30/, '売上のある日のうち出数の行がある日が足りない');
  assert.match(h, /ToriTon<\/b><\/td><td>Customers の商品 <span style="color:var\(--muted\)">\(2\/3\)/);
  const tot = (10 + 5) * 30 + (8 + 5) * 30, rr = (8 + 5) * 30;
  assert.match(h, new RegExp('>' + (Math.round(rr / tot * 1000) / 10).toFixed(1) + '%<'));
  assert.match(h, /FT・RP・SR が 0 の店があります/);
  assert.doesNotMatch(h, /FSP/, 'FSP は手入力なので出さない');
});

test('経理以外（AM・店長）は店の比べを開けない', () => {
  const c = make({}, { role: 'am' });
  assert.equal(c.FUNERGY_VT.canCompare(), false);
  c.FUNERGY_VT.storeCompare(0);
  assert.equal(c._modal, undefined);
});

test('画面のつなぎ：KPI のタイル・会議の枠・取り込みの時刻・同期センター・メニューの最後の日', () => {
  assert.match(HTML, /html \+= FUNERGY_VT\.kpiTile\(stores, days, k\.repeatTgt/);
  assert.match(HTML, /if\(k\.repeatRate==null\)\{ try\{ if\(window\.FUNERGY_VT\)\{ var _vtN=FUNERGY_VT\.note\(\[\{id:storeId\}\], daysOfYm\(ym\)/);
  assert.match(HTML, /FUNERGY_VT\.noteFetched\(storeId, rows\)/);
  assert.match(HTML, /onclick="FUNERGY_VT\.storeCompare\(0\)"/);
  assert.match(HTML, /lastBy: lastBy/);
});
