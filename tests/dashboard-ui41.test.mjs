// v1064 (UI案41): the management dashboard drops the overall verdict banner, shows each store's monthly budget
// at the top right of the sales block, and the dashboard's "今日の売上" card shows yesterday's numbers under every value.
// Runs the real functions from index.html in a VM with synthetic Toast rows. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start + 1);
  return source.slice(start + 1, end + 2);
}
const constant = name => { const m = new RegExp('^(?:const|var) ' + name + ' = [^;]+;', 'm').exec(source); assert.ok(m, name); return m[0].replace(/^const /, 'var '); };

// A clock fixed at a Hawaii wall-clock time (UTC−10, no DST), whatever the machine's time zone is.
// `new Date()` and Date.now() answer that instant; `new Date(y, m, d)` keeps working.
function clockAt(y, m, d, h = 14, mi = 5) {
  return `var __NOW = ${Date.UTC(y, m - 1, d, h + 10, mi)};
    var __RealDate = Date;
    Date = class extends __RealDate { constructor(...a) { if (a.length === 0) super(__NOW); else super(...a); } static now() { return __NOW; } };`;
}

function app(now = [2026, 10, 11]) {
  const c = { console, STORE: {}, CALLS: [], ROWS: {}, METRIC: {}, curLang: 'ja' };
  vm.createContext(c);
  vm.runInContext(clockAt(...now) + '\n' +
    ['t', 'fmtUSD2', 'bizNow', 'getStoreClosures', 'dayClosureMode', 'rtDaySummary', 'fetchTodayRealtime',
     'rtPrevDayOff', 'rtPrevTotal', 'rtPrevCell', 'rtPrevCellHtml', 'rtPrevOnlyGridHtml', 'loadRealtimeSales'].map(fn).join('\n') + `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function guestCountType(id){ return METRIC[id] || 'guest'; }
    async function syncToastDay(guid, ymd){ CALLS.push(['sync', guid, ymd]); return { ok: true }; }
    async function fetchToastSales(guid, from, to){
      CALLS.push(['read', guid, from, to]);
      if (guid === 'g-err') throw new Error('network');
      if (ROWS[guid] && !Array.isArray(ROWS[guid])) return ROWS[guid];
      return (ROWS[guid] || []).filter(function(r){ return r.business_date >= from && r.business_date <= to; });
    }
    var STORES = [
      { id:'A', name:'Store A', color:'#e8590c', toastGuid:'g-a', bizDays:{ '土':'closed' } },
      { id:'B', name:'Store B', color:'#2f6b5e', toastGuid:'g-b', bizDays:{ '土':'lclose' } },
      { id:'C', name:'Store C', color:'#333333', toastGuid:'g-c', bizDays:{} },
      { id:'N', name:'No GUID', color:'#999999' },
      { id:'E', name:'Broken', color:'#999999', toastGuid:'g-err' } ];
    function funergyNowStores(){ return STORES; }
    var __BODY = { attrs:{}, innerHTML:'', getAttribute:function(k){ return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; } };
    var document = { getElementById:function(id){ return id === 'rt-sales-body' ? __BODY : null; } };`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const row = (date, o) => Object.assign({ business_date: date, net_sales: 0, guest_count: 0, lunch_sales: 0, dinner_sales: 0,
  lunch_guests: 0, dinner_guests: 0, lunch_bowls: 0, dinner_bowls: 0, lunch_takeout_bowls: 0, dinner_takeout_bowls: 0,
  takeout_count: 0, takeout_bowls: 0 }, o);
const plain = v => JSON.parse(JSON.stringify(v));

test('the dashboard no longer renders the overall verdict banner, and the grid has no row for it', () => {
  const dash = fn('renderMgmtDash');
  assert.doesNotMatch(dash, /mdVerdictBannerHtml\(/, 'renderMgmtDash must not call the banner');
  assert.doesNotMatch(dash, /'<div class="md-a-ver">'/, 'no banner slot');
  assert.match(dash, /'<div class="md-a-hdr">' \+ mdHeaderHtml\(stores\)/);
  assert.match(dash, /'<div class="md-a-strip">' \+ mdSummaryStripHtml\(stores, ym, sc, counts\)/, 'the summary strip stays');
  assert.doesNotMatch(dash, /mdScopeVerdict\(/, 'the overall verdict is not shown anywhere, so it is not computed');
  assert.doesNotMatch(fn('mdSummaryStripHtml'), /\bsc\./, 'the strip never read the verdict');
  const areas = [...source.matchAll(/grid-template-areas:([^;]+);/g)].map(m => m[1]).filter(a => /hdr/.test(a));
  assert.equal(areas.length, 2, 'two dashboard layouts (2 and 3 columns)');
  for (const a of areas) assert.doesNotMatch(a, /\bver\b/, a);
  assert.match(areas[0], /"hdr hdr"\s+"strip strip"\s+"main side"\s+"mid side"/);
  assert.match(areas[1], /"hdr hdr hdr"\s+"strip strip strip"\s+"main mid side"/);
});

function cardApp(budMonth) {
  const c = { console, BUD: budMonth };
  vm.createContext(c);
  vm.runInContext([constant('MD_CARD_KPIS')].join('\n') + '\n' + ['fmtK', 'mdMoney', 'mdStoreCardHtml'].map(fn).join('\n') + `
    var MD_FIX = {};
    function mdStoreVerdict(){ return { state:'miss' }; }
    function mdStateMeta(s){ return { color:'#c42f2f', icon:'ti-x', label:'未達' }; }
    function mdVerdict(id, k){ return k === 'sales'
      ? { state:'miss', actual:48210, target:51400, diff:-3190, unit:'money', note:'' }
      : { state:'ok', label:k, actual:1, target:1, diff:0, unit:'count' }; }
    function mdStoreSeries(){ return { budMonth: BUD }; }
    function mdWowFor(){ return { sales:3.2, days:7, guests:null, ppa:null }; }
    function mdForecastFrom(){ return 112800; }
    function cumulativeToToday(){ return {}; }
    function escapeHtml(s){ return String(s); }
    function mcStoreLabel(id){ return 'Store ' + id; }
    function mdFmt(v){ return String(v); }
    function mdWowTag(){ return ''; }
    function mdSigned(v){ return String(v); }
    function mdSalesChartHtml(){ return ''; }
    function mdWeekHeatHtml(){ return ''; }`, c);
  return c;
}

test('each store card shows the monthly budget at the top right of the sales block, or 未設定', () => {
  const html = run(cardApp(120000), `mdStoreCardHtml('A', '2026-10', false)`);
  const hero = html.slice(html.indexOf('md-sc-hero'), html.indexOf('md-sc-v'));
  assert.match(hero, /<div class="md-sc-lr"><span class="md-sc-l">売上 \/ 進捗予算<\/span><span class="md-sc-bm">月間予算<b>\$120,000\.00<\/b><\/span><\/div>/);
  // the forecast line keeps using the same monthly budget
  assert.match(html, /月間予算まで <b style="color:var\(--red\)">-7200<\/b>/);
  const none = run(cardApp(0), `mdStoreCardHtml('A', '2026-10', false)`);
  assert.match(none, /<span class="md-sc-bm">月間予算<b class="unset">未設定<\/b><\/span>/);
  assert.doesNotMatch(none, /月間予算まで/);
  // the label sits on the right and does not wrap
  assert.match(source, /\.md-sc-bm \{ margin-left:auto;[^}]*white-space:nowrap; \}/);
});

test('without the flag the card reads today only (device date) and returns what it returned before', async () => {
  const c = app();
  const local = run(c, `(function(){ var n = new Date(); return [n.getFullYear(), String(n.getMonth()+1).padStart(2,'0'), String(n.getDate()).padStart(2,'0')]; })()`);
  const iso = local.join('-');
  c.ROWS['g-a'] = [row(iso, { net_sales: 3412.5, guest_count: 142, lunch_sales: 1210, dinner_sales: 2202.5,
    lunch_guests: 52, dinner_guests: 90, takeout_count: 18 })];
  const out = plain(await run(c, `fetchTodayRealtime(STORES.slice(0, 1))`));
  assert.deepEqual(c.CALLS.map(x => [...x]), [['sync', 'g-a', local.join('')], ['read', 'g-a', iso, iso]]);
  assert.deepEqual(out, [{ id: 'A', name: 'Store A', color: '#e8590c', hasData: true, metric: 'guest', unit: '名',
    net: 3412.5, guests: 142, count: 142, ppa: 3412.5 / 142,
    lunch: { sales: 1210, count: 52, ppa: 1210 / 52 }, dinner: { sales: 2202.5, count: 90, ppa: 2202.5 / 90 }, takeout: { count: 18 } }]);
  assert.equal('prev' in out[0], false, 'no 前日 fields without the flag');
  // v1063 took the first row it got back (duplicates for the day: the first one)
  c.ROWS['g-a'] = [row(iso, { net_sales: 10, guest_count: 1 }), row(iso, { net_sales: 20, guest_count: 2 })];
  assert.equal((await run(c, `fetchTodayRealtime(STORES.slice(0, 1))`))[0].net, 10);
  // a body that is not a list: no rows, not an error (as before)
  c.ROWS['g-a'] = { error: 'x' };
  assert.deepEqual(plain(await run(c, `fetchTodayRealtime(STORES.slice(0, 1))`)), [{ id: 'A', name: 'Store A', color: '#e8590c', hasData: false }]);
});

test('the dashboard card follows Hawaii time, so a device in Japan does not show an unfinished day as 前日', async () => {
  // 2026-10-12 01:00 UTC = 10/12 10:00 in Japan, 10/11 15:00 in Hawaii
  const c = app();
  run(c, `__NOW = ${Date.UTC(2026, 9, 12, 1, 0)};`);
  c.ROWS['g-c'] = [row('2026-10-10', { net_sales: 900, guest_count: 30 }), row('2026-10-11', { net_sales: 1500, guest_count: 50 }),
    row('2026-10-12', { net_sales: 1, guest_count: 1 })];
  const [r] = plain(await run(c, `fetchTodayRealtime(STORES.slice(2, 3), { prev: true })`));
  assert.deepEqual(c.CALLS.map(x => [...x]), [['sync', 'g-c', '20261011'], ['read', 'g-c', '2026-10-10', '2026-10-11']]);
  assert.deepEqual([r.net, r.prev.net], [1500, 900]);
  // duplicates for a date: the first one; a body that is not a list: no rows, not an error
  c.CALLS.length = 0;
  c.ROWS['g-c'] = [row('2026-10-10', { net_sales: 900 }), row('2026-10-10', { net_sales: 1 }), row('2026-10-11', { net_sales: 1500 }), row('2026-10-11', { net_sales: 2 })];
  const [d] = plain(await run(c, `fetchTodayRealtime(STORES.slice(2, 3), { prev: true })`));
  assert.deepEqual([d.net, d.prev.net], [1500, 900]);
  c.ROWS['g-c'] = { error: 'x' };
  const [e] = plain(await run(c, `fetchTodayRealtime(STORES.slice(2, 3), { prev: true })`));
  assert.deepEqual([e.hasData, e.prev, e.error], [false, null, undefined]);
});

test('with the flag the card also reads yesterday (synced rows only) and counts it the same way as today', async () => {
  const c = app();
  c.METRIC.B = 'bowls';
  const todayA = row('2026-10-11', { net_sales: 3412.5, guest_count: 142, lunch_sales: 1210, dinner_sales: 2202.5, lunch_guests: 52, dinner_guests: 90, takeout_count: 18 });
  const prevA = row('2026-10-10', { net_sales: 4120, guest_count: 168, lunch_sales: 1380, dinner_sales: 2740, lunch_guests: 58, dinner_guests: 110, takeout_count: 21 });
  c.ROWS['g-a'] = [prevA, todayA];
  c.ROWS['g-b'] = [row('2026-10-10', { net_sales: 2960.1, lunch_sales: 1410, dinner_sales: 1550.1, lunch_bowls: 55, dinner_bowls: 60,
    lunch_takeout_bowls: 7, dinner_takeout_bowls: 9, takeout_count: 15 }),
  row('2026-10-11', { net_sales: 2180.4, lunch_sales: 1320.4, dinner_sales: 860, lunch_bowls: 50, dinner_bowls: 30, lunch_takeout_bowls: 8, dinner_takeout_bowls: 8, takeout_count: 11 })];
  c.ROWS['g-c'] = [row('2026-10-10', { net_sales: 900, guest_count: 30, lunch_sales: 400, dinner_sales: 500, lunch_guests: 14, dinner_guests: 16, takeout_count: 2 })];
  const out = plain(await run(c, `fetchTodayRealtime(STORES, { prev: true })`));
  assert.deepEqual(c.CALLS.filter(x => x[0] === 'read').map(x => [...x]),
    [['read', 'g-a', '2026-10-10', '2026-10-11'], ['read', 'g-b', '2026-10-10', '2026-10-11'], ['read', 'g-c', '2026-10-10', '2026-10-11'], ['read', 'g-err', '2026-10-10', '2026-10-11']]);
  assert.deepEqual(c.CALLS.filter(x => x[0] === 'sync').map(x => x[2]), ['20261011', '20261011', '20261011', '20261011'], 'only today is pulled from Toast');
  const [a, b, cc, n, e] = out;
  // today's numbers are today's row, not yesterday's
  assert.equal(a.net, 3412.5);
  assert.deepEqual(a.prev, plain(run(c, `rtDaySummary(STORES[0], ${JSON.stringify(prevA)})`)));
  assert.deepEqual([a.prev.net, a.prev.count, a.prev.lunch.count, a.prev.dinner.sales, a.prev.takeout.count], [4120, 168, 58, 2740, 21]);
  // yesterday was a Saturday: store A is closed on Saturdays, B closes lunch, C has no closure
  assert.deepEqual([a.prevMode, b.prevMode, cc.prevMode], ['closed', 'lclose', null]);
  // bowls are counted the same way for yesterday (店内 + テイクアウト丼)
  assert.equal(b.unit, '丼');
  assert.deepEqual([b.prev.unit, b.prev.lunch.count, b.prev.dinner.count, b.prev.count], ['丼', 62, 69, 55 + 60 + 16]);
  // no row for today: no today's numbers, yesterday still there
  assert.equal(cc.hasData, false);
  assert.equal(cc.prev.net, 900);
  assert.deepEqual(n, { id: 'N', name: 'No GUID', color: '#999999', noGuid: true });
  assert.deepEqual(e, { id: 'E', name: 'Broken', color: '#999999', error: true });
});

test('yesterday crosses month and year ends; a store-closure day overrides the weekly setting', async () => {
  for (const [now, prev] of [[[2026, 11, 1], '2026-10-31'], [[2027, 1, 1], '2026-12-31'], [[2028, 3, 1], '2028-02-29']]) {
    const c = app(now);
    await run(c, `fetchTodayRealtime(STORES.slice(2, 3), { prev: true })`);
    const read = c.CALLS.find(x => x[0] === 'read');
    assert.equal(read[2], prev, 'from = yesterday for ' + now.join('-'));
  }
  const c = app();
  c.STORE.store_closures = { C: { '2026-10-10': { mode: 'closed', note: '' } }, A: { '2026-10-10': { mode: 'dclose', note: '' } } };
  const out = plain(await run(c, `fetchTodayRealtime(STORES.slice(0, 3), { prev: true })`));
  assert.deepEqual(out.map(r => r.prevMode), ['dclose', 'lclose', 'closed']);
});

test('前日 shows 休業 for closed days and parts, — when nothing is synced, and numbers otherwise', () => {
  const c = app();
  const p = { unit: '名', net: 4120, count: 168, ppa: 4120 / 168, lunch: { sales: 1380, count: 58, ppa: 1380 / 58 },
    dinner: { sales: 2740, count: 110, ppa: 2740 / 110 }, takeout: { count: 21 } };
  const zero = { unit: '名', net: 0, count: 0, ppa: 0, lunch: { sales: 0, count: 0, ppa: 0 }, dinner: { sales: 0, count: 0, ppa: 0 }, takeout: { count: 0 } };
  const lunchOnlyZero = Object.assign({}, p, { lunch: { sales: 0, count: 0, ppa: 0 } });
  const cell = (r, part) => plain(run(c, `rtPrevCell(${JSON.stringify(r)}, '${part}')`));
  const total = r => run(c, `rtPrevTotal(${JSON.stringify(r)})`);
  assert.equal(total({ prev: p, prevMode: null }), '$4,120.00 / 168名 / $24.52');
  assert.deepEqual(cell({ prev: p, prevMode: null }, 'lunch'), { v: '$1,380.00', sub: '58名 · $23.79' });
  assert.deepEqual(cell({ prev: p, prevMode: null }, 'dinner'), { v: '$2,740.00', sub: '110名 · $24.91' });
  assert.deepEqual(cell({ prev: p, prevMode: null }, 'takeout'), { v: '21件', sub: '注文数' });
  // closed all day: no row, or a row of zeros
  for (const r of [{ prev: null, prevMode: 'closed' }, { prev: zero, prevMode: 'closed' }]) {
    assert.equal(total(r), '休業');
    for (const part of ['lunch', 'dinner', 'takeout']) assert.deepEqual(cell(r, part), { v: '休業', sub: '' });
  }
  // a closure setting but sales were made (opened anyway): show the numbers
  assert.equal(total({ prev: p, prevMode: 'closed' }), '$4,120.00 / 168名 / $24.52');
  assert.deepEqual(cell({ prev: p, prevMode: 'closed' }, 'lunch').v, '$1,380.00');
  // lunch closed: lunch 休業, dinner and takeout are numbers
  assert.deepEqual(cell({ prev: lunchOnlyZero, prevMode: 'lclose' }, 'lunch'), { v: '休業', sub: '' });
  assert.deepEqual(cell({ prev: lunchOnlyZero, prevMode: 'lclose' }, 'dinner').v, '$2,740.00');
  assert.deepEqual(cell({ prev: lunchOnlyZero, prevMode: 'lclose' }, 'takeout').v, '21件');
  assert.deepEqual(cell({ prev: Object.assign({}, p, { dinner: { sales: 0, count: 0, ppa: 0 } }), prevMode: 'dclose' }, 'dinner'), { v: '休業', sub: '' });
  assert.deepEqual(cell({ prev: p, prevMode: 'dclose' }, 'dinner').v, '$2,740.00');
  // nothing synced and no closure: a dash, not 休業 and not $0
  assert.equal(total({ prev: null, prevMode: null }), '—');
  assert.equal(total({ prev: null, prevMode: 'lclose' }), '—');
  for (const part of ['lunch', 'dinner', 'takeout']) assert.deepEqual(cell({ prev: null, prevMode: null }, part), { v: '—', sub: '' });
  // English
  c.curLang = 'en';
  assert.equal(total({ prev: null, prevMode: 'closed' }), 'Closed');
  assert.match(run(c, `rtPrevCellHtml({ prev: ${JSON.stringify(p)}, prevMode: null }, 'takeout')`), /^<div[^>]*>Yesterday <b[^>]*>21<\/b><br>Orders<\/div>$/);
});

test('only the dashboard card (data-prev="1") shows 前日; the other cards keep reading today only', async () => {
  const setup = flag => {
    const c = app();
    c.ROWS['g-a'] = [row('2026-10-10', { net_sales: 4120, guest_count: 168, lunch_sales: 1380, dinner_sales: 2740, lunch_guests: 58, dinner_guests: 110, takeout_count: 21 }),
      row('2026-10-11', { net_sales: 3412.5, guest_count: 142, lunch_sales: 1210, dinner_sales: 2202.5, lunch_guests: 52, dinner_guests: 90, takeout_count: 18 })];
    c.ROWS['g-c'] = [row('2026-10-10', { net_sales: 900, guest_count: 30, lunch_sales: 400, dinner_sales: 500, lunch_guests: 14, dinner_guests: 16, takeout_count: 2 })];
    // store B was closed all day yesterday (a closure entry) and has only a row of zeros
    c.STORE.store_closures = { B: { '2026-10-10': { mode: 'closed', note: '' } } };
    c.ROWS['g-b'] = [row('2026-10-10', {})];
    if (flag) run(c, `__BODY.attrs['data-prev'] = '1'`);
    return c;
  };
  const c1 = setup(true);
  await run(c1, `loadRealtimeSales()`);
  const html = run(c1, `__BODY.innerHTML`);
  const cards = html.split('border:1px solid var(--border);border-radius:12px').slice(1);
  assert.equal(cards.length, 5);
  assert.match(html, /更新 14:05 · 1\/5店<\/div>$/, 'the update time is Hawaii time, like the dates');
  // store A: header total + three cells, each with 前日
  assert.equal((cards[0].match(/前日/g) || []).length, 4);
  assert.match(cards[0], /前日 \$4,120\.00 \/ 168名 \/ \$24\.52/);
  assert.match(cards[0], /前日 <b[^>]*>\$1,380\.00<\/b><br>58名 · \$23\.79/);
  assert.match(cards[0], /前日 <b[^>]*>\$2,740\.00<\/b><br>110名 · \$24\.91/);
  assert.match(cards[0], /前日 <b[^>]*>21件<\/b><br>注文数/);
  // store A is closed on Saturdays but had sales: numbers, not 休業
  assert.doesNotMatch(cards[0], /休業/);
  // store B (closed yesterday, a row of zeros, no data today): only 前日 休業 in the header, no columns
  assert.match(cards[1], /前日 休業/);
  assert.match(cards[1], /本日のデータはまだありません/);
  assert.equal((cards[1].match(/休業/g) || []).length, 1);
  assert.doesNotMatch(cards[1], /ランチ/);
  // store C: nothing today yet, yesterday in the header and under lunch, dinner and takeout
  assert.match(cards[2], /前日 \$900\.00 \/ 30名 \/ \$30\.00/);
  assert.match(cards[2], /本日のデータはまだありません/);
  assert.equal((cards[2].match(/前日/g) || []).length, 4);
  assert.match(cards[2], /ランチ<\/div><div[^>]*>前日 <b[^>]*>\$400\.00<\/b><br>14名 · \$28\.57/);
  assert.match(cards[2], /ディナー<\/div><div[^>]*>前日 <b[^>]*>\$500\.00<\/b><br>16名 · \$31\.25/);
  assert.match(cards[2], /テイクアウト<\/div><div[^>]*>前日 <b[^>]*>2件<\/b><br>注文数/);
  // no GUID and errors: no 前日
  assert.doesNotMatch(cards[3], /前日/);
  assert.doesNotMatch(cards[4], /前日/);
  const c3 = setup(true);
  c3.ROWS = {};
  await run(c3, `loadRealtimeSales()`);
  const empty = run(c3, `__BODY.innerHTML`).split('border:1px solid var(--border);border-radius:12px').slice(1);
  // nothing synced at all: 休業 for the stores closed yesterday (A weekly, B closure entry), a dash for C; no columns
  assert.deepEqual(empty.slice(0, 3).map(card => (/前日 (休業|—)/.exec(card) || [])[1]), ['休業', '休業', '—']);
  for (const card of empty.slice(0, 3)) assert.doesNotMatch(card, /ランチ/);
  const c2 = setup(false);
  await run(c2, `loadRealtimeSales()`);
  const plainHtml = run(c2, `__BODY.innerHTML`);
  assert.doesNotMatch(plainHtml, /前日/);
  assert.ok(c2.CALLS.filter(x => x[0] === 'read').every(x => x[2] === x[3]), 'today only');
  // the markup marks only the dashboard card
  assert.match(fn('mdFunergyNowHtml'), /<div id="rt-sales-body" data-prev="1">/);
  assert.equal((source.match(/id="rt-sales-body"/g) || []).length, 3);
  assert.equal((source.match(/id="rt-sales-body" data-prev="1"/g) || []).length, 1);
});

// The dashboard card follows Hawaii time and the other cards the device's date; that only shows on a device
// outside Hawaii. Run every check above again as a device in Japan and in UTC.
test('the same checks pass on a device in Japan and on one in UTC', { skip: process.env.DASH_UI41_CHILD === '1' }, () => {
  for (const tz of ['Asia/Tokyo', 'UTC']) {
    const env = { ...process.env, TZ: tz, DASH_UI41_CHILD: '1' };
    delete env.NODE_TEST_CONTEXT;   // otherwise the child reports to this runner and always exits 0
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, tz + '\n' + String(r.stdout).slice(-3000));
  }
});
