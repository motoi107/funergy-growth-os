// v1176（Moto さん 11/15 の依頼の A・B・UI案84 の答え 2A・3A・4A・5A・6「11月から」）。
//   A：1 営業日あたりの総労働時間（未集計：勤怠なし・時刻不正・退勤なし（2A）／前の月間計画は換算せず横に（3A）／業務用アカウントの一覧（4A））
//   B：アップセル対象（モディファイヤーとアラカルト）をアップグレード率に。1 つの機会は 1 回だけ（5A）・2026-11 から・月ごとの版
// 本物の関数（index.html の FUNERGY_UPS・FUNERGY_UP・totoyaKpiCalc・k2Sys*）を VM で動かす。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const UPS_SRC = between('/* ==== FUNERGY_UPS start', '/* ==== FUNERGY_UPS end ==== */');
const UP_SRC = between('/* ==== FUNERGY_UP start', '/* ==== FUNERGY_UP end ==== */');
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle(c) { for (let i = 0; i < 30; i++) await tick(); }

const STORES = [
  { id: 'F04-K', name: 'Totoya Kaimuki', toastGuid: 'R-K' },
  { id: 'F04-P', name: 'Totoya Piikoi', toastGuid: 'R-P' },
  { id: 'F01', name: 'ToriTon', toastGuid: 'R-T' }
];
/* サーバーの代わり：toast_upgrade_days / toast_upgrade_extra / toast_upgrade_lines を合成の表から返す（PostgREST の絞り込みを読む） */
function fakeServer(db, log, opts = {}) {
  const parse = path => {
    const [tbl, qs] = path.split('?'); const p = {}; const f = [];
    qs.split('&').forEach(kv => { const i = kv.indexOf('='); const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)); if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') p[k] = v; else f.push([k, v]); });
    return { tbl, p, f };
  };
  const match = (row, [k, v]) => {
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const x = row[k];
    if (op === 'eq') return String(x) === val;
    if (op === 'gte') return String(x) >= val;
    if (op === 'lte') return String(x) <= val;
    if (op === 'is') return val === 'true' ? x === true : val === 'false' ? x === false : x == null;
    if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); return list.includes(String(x)); }
    throw new Error('op ' + op);
  };
  return async function getAll(path) {
    log.push(path);
    const { tbl, f } = parse(path);
    if (opts.fail && opts.fail(tbl, path)) return { err: opts.fail(tbl, path) };
    const rows = (db[tbl] || []).filter(r => f.every(cond => match(r, cond)));
    return { rows: JSON.parse(JSON.stringify(rows)) };
  };
}
function world(o = {}) {
  const c = {
    console: { log() {}, warn() {}, error() {} }, JSON, Math, Object, Array, String, Number, RegExp, Date, Promise, setTimeout, clearTimeout, isFinite, encodeURIComponent, decodeURIComponent,
    TODAY: o.today || '2026-11-16', CFG: o.cfg || {}, DA: o.da || {}, CLOSED: o.closed || {}, MAN: o.man || {}, CAN: o.can !== false, TOASTS: [], RENDERS: 0,
    PUSH: { ok: o.pushOk !== false }, LOG: [], RECIPES: o.recipes || [], BOWL: o.bowl || {}, STORES
  };
  c.window = c;
  vm.createContext(c);
  run(c, `
    var curLang='ja', curUserName='Moto', curPage='kpi_master', _lsPushP={};
    function t(ja){ return ja; }
    function bizToday(){ return TODAY; }
    function getStoresAll(){ return STORES; }
    function isTotoyaStore(id){ return /^F04/.test(id); }
    function dayClosureMode(sid, d){ return CLOSED[sid+'|'+d] ? 'closed' : null; }
    function _daRO(sid){ return DA[sid] || {}; }
    function getDailyActuals(sid){ return DA[sid] || {}; }
    function getKpiConfig(){ return CFG; }
    function setKpiConfigStore(sid, patch){ CFG.byStore=CFG.byStore||{}; CFG.byStore[sid]=Object.assign({}, CFG.byStore[sid]||{}, patch); _lsPushP['kpi_config']=Promise.resolve(PUSH.ok); }
    function canSetKpiStore(){ return CAN; }
    function mdCacheClear(){}
    function renderPage(){ RENDERS++; }
    function showToast(m, k){ TOASTS.push([m, k]); }
    function getBowlCatCfg(sid){ return BOWL[sid] || { foodGuids:[], takeoutGuids:[] }; }
    function getRecipes(){ return RECIPES; }
    function k2YmOfPeriod(per){ var p=String(per).split('.'); return p[0]+'-'+String(p[1]).padStart(2,'0'); }
    function wowBadge(){ return ''; }
    function openModal(){} function closeModalDirect(){}
    var FUNERGY_UX = { bgRefresh: function(){ RENDERS++; } };
    var SUPABASE_URL='https://x', SUPABASE_ANON='k';
  `);
  /* v1176（Codex #174）：保存の結果と描き直しは本物の kpiCfgPush・kpiSameView で */
  run(c, fnSrc('kpiCfgPush')); run(c, fnSrc('kpiSameView'));
  if (o.pushPromise) run(c, `setKpiConfigStore = function(sid, patch){ CFG.byStore=CFG.byStore||{}; CFG.byStore[sid]=Object.assign({}, CFG.byStore[sid]||{}, patch); _lsPushP['kpi_config']=PUSHP(); };`);
  run(c, UP_SRC + '\n' + UPS_SRC);
  c.FUNERGY_UP._getAll = fakeServer(o.db || {}, c.LOG, o.server || {});
  return c;
}
/* 1 日の印（hyper-worker v1176 の toast_upgrade_days） */
const dayRow = (rg, d, total, byMod, extra = 0) => ({ restaurant_guid: rg, business_date: d, total, upgrade: Object.keys(byMod).reduce((s, k) => s + (byMod[k].k === 'aosa' ? 0 : byMod[k].q), 0), by_mod: byMod, extra, hw_version: 'v1176' });
const line = (rg, d, ck, mod, kind, qty = 1) => ({ restaurant_guid: rg, business_date: d, check_key: ck, mod_guid: mod, kind, qty, counted: true });
const ex = (rg, d, ck, item, qty, lk, at) => ({ restaurant_guid: rg, business_date: d, check_key: ck, item_guid: item, item_name: 'Item ' + item, qty, line_key: lk, opened_at: at || '2026-11-02T20:00:00Z', order_no: '1' + lk, check_no: '1', meal: 'D' });
const BYMOD = { 'M-AOSA': { n: 'Aosa', k: 'aosa', q: 6 }, 'M-CRAB': { n: 'Crab Miso', k: 'crab', q: 2 }, 'M-UDON': { n: 'Udon Miso', k: 'udon', q: 1 }, 'M-CHZ': { n: 'CHAZUKE', k: 'chazuke', q: 1 } };
/* 仕様の例：分母 10・選んだモディファイヤー 3・アラカルト 2（うち 1 つは同じ機会がもうモディファイヤーで成立）→ (3+2−1)/10＝40% */
function specDb() {
  const rg = 'R-K', d = '2026-11-02';
  return {
    toast_upgrade_days: [dayRow(rg, d, 10, BYMOD, 3)],
    toast_upgrade_extra: [ex(rg, d, 'C1', 'A-SOUP', 1, 'x1', '2026-11-02T20:00:00Z'), ex(rg, d, 'C2', 'A-SOUP', 1, 'x2', '2026-11-02T21:00:00Z'), ex(rg, d, 'C9', 'A-SOUP', 1, 'x9', '2026-11-02T22:00:00Z')],
    toast_upgrade_lines: [
      line(rg, d, 'C1', 'M-AOSA', 'aosa'),                      // C1：機会 1（Aosa）→ アラカルトで成立
      line(rg, d, 'C2', 'M-CRAB', 'crab'),                      // C2：機会 1（Crab で成立済み）→ アラカルトは重複
      line(rg, d, 'C3', 'M-CRAB', 'crab'), line(rg, d, 'C3', 'M-AOSA', 'aosa'), line(rg, d, 'C4', 'M-CHZ', 'chazuke'), line(rg, d, 'C5', 'M-UDON', 'udon')
    ]
  };
}
const CFG_SPEC = { byStore: { 'F04-K': { upsell: [{ from: '2026-11', mods: ['M-CRAB', 'M-CHZ'], ala: ['A-SOUP'], modNames: {}, alaNames: {} }] } } };
const DA_K = { 'F04-K': { '2026-11-01': { misoTotal: 9, misoUpgrade: 3 }, '2026-11-02': { misoTotal: 10, misoUpgrade: 4 } } };

test('v1176 version markers (page and SW the same)', () => {
  // v1177 からは 1176 以上・ページと SW が同じ
  const a = +(SRC.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1176 && a === s, a + ' / ' + s);
});

test('B spec example: (3 + 2 − 1) ÷ 10 = 40%; unchecking the a la carte item gives 30%; 機会なし is not counted', async () => {
  const c = world({ today: '2026-11-03', db: specDb(), cfg: JSON.parse(JSON.stringify(CFG_SPEC)), da: DA_K, closed: { 'F04-K|2026-11-01': 1 } });
  assert.equal(run(c, `FUNERGY_UPS.month('F04-K','2026-11').st`), 'loading');
  await settle(c);
  const m = plain(run(c, `FUNERGY_UPS.month('F04-K','2026-11')`));
  assert.equal(m.st, 'ok');
  assert.equal(m.all, 10); assert.equal(m.M, 3, 'Crab 2 + CHAZUKE 1 (Udon is not selected; Aosa never)');
  assert.equal(m.alaRaw, 2, 'C1 and C2'); assert.equal(m.overlap, 1, 'C2 was already counted by Crab');
  assert.equal(m.alaSucc, 1); assert.equal(m.succ, 4); assert.equal(m.rate, 40);
  assert.equal(m.nopp, 1, 'C9 has no opportunity'); assert.equal(m.ala['A-SOUP'].q, 3); assert.equal(m.ala['A-SOUP'].s, 1); assert.equal(m.ala['A-SOUP'].nopp, 1);
  assert.equal(m.mods['M-UDON'].on, false); assert.equal(m.mods['M-AOSA'].on, false); assert.equal(m.mods['M-CRAB'].s, 2);
  assert.equal(m.days['2026-11-01'].k, 'reimport', '11/1 has only the old daily numbers: not counted (re-import)');
  assert.equal(m.n.reimport, 1); assert.equal(m.n.ok, 1);
  // the day rows carry the per-row success for the day screen
  const rows = plain(run(c, `FUNERGY_UPS.dayAla('F04-K','2026-11-02')`)).sort((a, b) => a.line_key < b.line_key ? -1 : 1);
  assert.deepEqual(rows.map(r => [r.check_key, r._s, r._n]), [['C1', 1, 0], ['C2', 0, 0], ['C9', 0, 1]]);
  // uncheck the a la carte item → 30%
  c.CFG.byStore['F04-K'].upsell[0].ala = [];
  const m2 = plain(run(c, `FUNERGY_UPS.month('F04-K','2026-11')`));
  assert.equal(m2.st === 'ok' || m2.st === 'loading', true);
  await settle(c);
  const m3 = plain(run(c, `FUNERGY_UPS.month('F04-K','2026-11')`));
  assert.equal(m3.succ, 3); assert.equal(m3.rate, 30); assert.equal(m3.alaRaw, 0);
  // the store breakdown HTML has every box
  c.CFG.byStore['F04-K'].upsell[0].ala = ['A-SOUP']; await settle(c); run(c, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c);
  const h = run(c, `FUNERGY_UPS.breakHtml(['F04-K'], ['2026-11-01','2026-11-02'])`);
  for (const s of ['40.0%', '(3＋2−1)÷10', 'モディファイヤーで成立', 'アラカルトで成立', '重複', '機会なしのアラカルト', 'v1176 より前に取り込んだ日が 1 日', 'Item A-SOUP', '分母だけ']) assert.ok(h.includes(s), s);
});

test('B one opportunity once: quantity is matched up to the open opportunities of the same check, in order', async () => {
  const rg = 'R-K', d = '2026-11-02';
  const db = { toast_upgrade_days: [dayRow(rg, d, 3, { 'M-AOSA': { n: 'Aosa', k: 'aosa', q: 2 }, 'M-CRAB': { n: 'Crab', k: 'crab', q: 1 } })],
    toast_upgrade_extra: [ex(rg, d, 'C1', 'A-1', 2, 'a', '2026-11-02T20:00:00Z'), ex(rg, d, 'C1', 'A-2', 2, 'b', '2026-11-02T20:05:00Z')],
    toast_upgrade_lines: [line(rg, d, 'C1', 'M-AOSA', 'aosa', 2), line(rg, d, 'C1', 'M-CRAB', 'crab', 1)] };
  const cfg = { byStore: { 'F04-K': { upsell: [{ from: '2026-11', mods: ['M-CRAB'], ala: ['A-1', 'A-2'] }] } } };
  const c = world({ today: '2026-11-03', db, cfg, da: {} });
  run(c, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c);
  const m = plain(run(c, `FUNERGY_UPS.month('F04-K','2026-11')`));
  assert.equal(m.M, 1); assert.equal(m.alaRaw, 3, 'min(A=4, O=3)'); assert.equal(m.alaSucc, 2, 'only 2 opportunities were still open');
  assert.equal(m.overlap, 1); assert.equal(m.succ, 3); assert.equal(m.rate, 100);
  assert.equal(m.ala['A-1'].s, 2, 'the earlier item takes the open opportunities first'); assert.equal(m.ala['A-2'].s, 0);
});

test('B settings: from 2026-11 only, Totoya only, the latest version on or before the month; kind keys; Aosa never counts', () => {
  const cfg = { byStore: { 'F04-K': { upsell: [{ from: '2026-12', mods: ['kind:crab'], ala: [] }, { from: '2026-11', mods: ['kind:crab', 'kind:aosa', 'M-X'], ala: ['A'] }, { from: '2026-10', mods: ['M-Y'] }, { from: 'bad' }] },
    F01: { upsell: [{ from: '2026-11', mods: ['M-Z'] }] } } };
  const c = world({ cfg });
  assert.equal(run(c, `FUNERGY_UPS.versions('F04-K').map(function(v){ return v.from; }).join()`), '2026-11,2026-12', 'before 2026-11 and broken entries are dropped');
  assert.equal(run(c, `FUNERGY_UPS.cfgFor('F04-K','2026-10')`), null, 'October keeps the earlier rule');
  assert.equal(run(c, `FUNERGY_UPS.cfgFor('F04-K','2026-11').mods.join()`), 'kind:crab,M-X', 'kind:aosa is removed');
  assert.equal(run(c, `FUNERGY_UPS.cfgFor('F04-K','2027-02').from`), '2026-12');
  assert.equal(run(c, `FUNERGY_UPS.cfgFor('F01','2026-11')`), null, 'not a Totoya store');
  assert.equal(run(c, `FUNERGY_UPS.cfgFor('F04-P','2026-11')`), null, 'another store has its own setting');
  assert.equal(run(c, `FUNERGY_UPS.modCounts('F04-K','2026-11-05','M-ANY','crab')`), true, 'kind:crab = every Crab');
  assert.equal(run(c, `FUNERGY_UPS.modCounts('F04-K','2026-11-05','M-X','aosa')`), false, 'Aosa only feeds the denominator');
  assert.equal(run(c, `FUNERGY_UPS.modCounts('F04-K','2026-11-05','M-T','today')`), false);
});

test('B loading is light: no a la carte → no extra or line reads; lines only for the checks that have a selected a la carte item', async () => {
  const db = specDb();
  const c1 = world({ today: '2026-11-03', db, cfg: { byStore: { 'F04-K': { upsell: [{ from: '2026-11', mods: ['M-CRAB'], ala: [] }] } } } });
  run(c1, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c1);
  assert.deepEqual(c1.LOG.map(p => p.split('?')[0]), ['toast_upgrade_days']);
  assert.match(c1.LOG[0], /select=business_date,total,upgrade,by_mod,extra,hw_version/);
  assert.match(c1.LOG[0], /business_date=lte\.2026-11-02/, 'through yesterday (Hawaii)');
  const c2 = world({ today: '2026-11-03', db, cfg: JSON.parse(JSON.stringify(CFG_SPEC)) });
  run(c2, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c2);
  assert.deepEqual(c2.LOG.map(p => p.split('?')[0]), ['toast_upgrade_days', 'toast_upgrade_extra', 'toast_upgrade_lines']);
  assert.match(decodeURIComponent(c2.LOG[1]), /item_guid=in\.\("A-SOUP"\)/);
  assert.match(decodeURIComponent(c2.LOG[2]), /check_key=in\.\("C1","C2","C9"\)/);
  assert.match(c2.LOG[2], /counted=is\.true/);
  // cached: a second read in the same 10 minutes does not go to the server
  run(c2, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c2);
  assert.equal(c2.LOG.length, 3);
});

test('B many checks: line reads go 60 checks at a time', async () => {
  const rg = 'R-K', d = '2026-11-02', db = { toast_upgrade_days: [dayRow(rg, d, 130, { 'M-AOSA': { n: 'Aosa', k: 'aosa', q: 130 } })], toast_upgrade_extra: [], toast_upgrade_lines: [] };
  for (let i = 0; i < 130; i++) { db.toast_upgrade_extra.push(ex(rg, d, 'C' + i, 'A-SOUP', 1, 'x' + i)); db.toast_upgrade_lines.push(line(rg, d, 'C' + i, 'M-AOSA', 'aosa')); }
  const c = world({ today: '2026-11-03', db, cfg: JSON.parse(JSON.stringify(CFG_SPEC)) });
  run(c, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c);
  const reads = c.LOG.filter(p => p.startsWith('toast_upgrade_lines'));
  assert.equal(reads.length, 3, '60 + 60 + 10');
  assert.ok(reads.every(p => (decodeURIComponent(p).match(/check_key=in\.\(([^)]*)\)/)[1].split(',').length) <= 60));
  const m = plain(run(c, `FUNERGY_UPS.month('F04-K','2026-11')`));
  assert.equal(m.alaSucc, 130); assert.equal(m.rate, 100);
});

test('B server not ready (no v1176 SQL): falls back to the earlier rule everywhere, says so, retries in a minute', async () => {
  const c = world({ today: '2026-11-03', db: specDb(), cfg: JSON.parse(JSON.stringify(CFG_SPEC)), da: DA_K, server: { fail: tbl => tbl === 'toast_upgrade_days' ? 'http400' : null } });
  run(c, `FUNERGY_UPS.month('F04-K','2026-11')`); await settle(c);
  assert.equal(run(c, `FUNERGY_UPS.month('F04-K','2026-11').st`), 'nosql');
  assert.equal(run(c, `FUNERGY_UPS.dayOv('F04-K','2026-11-02')`), null, 'null = the earlier rule (same as totoyaKpiCalc)');
  const h = run(c, `FUNERGY_UPS.breakHtml(['F04-K'], ['2026-11-02'])`);
  assert.ok(h.includes('読めなかった店') && h.includes('前の数え方'));
  const d = plain(run(c, `FUNERGY_UPS._data['F04-K|2026-11|A-SOUP']`));
  assert.ok(d.exp - Date.now() <= 60 * 1000 + 50, 'an error is read again after a minute');
});

test('B totoyaKpiCalc: the setting decides the month; manual input still wins; loading → no number; reimport-only → no number; October untouched', async () => {
  const c = world({ today: '2026-11-03', db: specDb(), cfg: JSON.parse(JSON.stringify(CFG_SPEC)), da: DA_K, closed: { 'F04-K|2026-11-01': 1 } });
  run(c, ['getTotoyaKpiCfg', '_totoyaKw', '_totoyaMatchKw', 'totoyaKpiCalc'].map(fnSrc).join('\n') + `
    function getKpiManual(sid, per){ return (MAN[sid+'|'+per]) || {}; }
    function getMenuMix(){ return { items:{} }; } function activeRecipes(){ return []; } function recipeInStore(){ return true; }`);
  let k = plain(run(c, `totoyaKpiCalc('F04-K','2026.11')`));
  assert.equal(k.misoRate, null); assert.equal(k.src.misoUp, 'アップセル設定（読み込み中）');
  await settle(c);
  k = plain(run(c, `totoyaKpiCalc('F04-K','2026.11')`));
  assert.equal(k.eff.misoAll, 10); assert.equal(k.eff.misoUp, 4); assert.equal(k.misoRate, 40);
  // 11/1 has Toast numbers but no v1176 rows → re-import is pending for that day: the source says the rate covers only part of the month (Claude #174 P3-3)
  assert.equal(k.src.misoUp, 'アップセル設定（一部の日だけ・取り込み直し待ち 1 日）');
  assert.equal(k.ups.st, 'ok');
  // manual numbers keep priority
  c.MAN['F04-K|2026.11'] = { tMisoAll: 20, tMisoUp: 5 };
  k = plain(run(c, `totoyaKpiCalc('F04-K','2026.11')`));
  assert.equal(k.misoRate, 25); assert.equal(k.src.misoUp, '手入力'); assert.equal(k.na.misoUp, 4);
  delete c.MAN['F04-K|2026.11'];
  // October has no setting → the earlier Toast numbers (through yesterday)
  c.DA['F04-K']['2026-10-05'] = { misoTotal: 8, misoUpgrade: 2 };
  k = plain(run(c, `totoyaKpiCalc('F04-K','2026.10')`));
  assert.equal(k.misoRate, 25); assert.equal(k.src.misoUp, 'Toast'); assert.equal(k.ups, null);
  // a month where every day still needs re-import → no number (not the earlier numbers)
  const c2 = world({ today: '2026-11-03', db: { toast_upgrade_days: [{ restaurant_guid: 'R-K', business_date: '2026-11-02', total: 10, upgrade: 4, by_mod: null }] }, cfg: JSON.parse(JSON.stringify(CFG_SPEC)), da: DA_K });
  run(c2, ['getTotoyaKpiCfg', '_totoyaKw', '_totoyaMatchKw', 'totoyaKpiCalc'].map(fnSrc).join('\n') + `
    function getKpiManual(){ return {}; } function getMenuMix(){ return { items:{} }; } function activeRecipes(){ return []; } function recipeInStore(){ return true; }`);
  run(c2, `totoyaKpiCalc('F04-K','2026.11')`); await settle(c2);
  k = plain(run(c2, `totoyaKpiCalc('F04-K','2026.11')`));
  assert.equal(k.misoRate, null); assert.equal(k.src.misoUp, 'アップセル設定（取り込み直し待ち）');
  assert.equal(k.eff.misoUp, null); assert.equal(k.eff.misoAll, null);
});

test('B tile, breakdown and week-over-week use the same numbers; days under different settings are not compared', async () => {
  const rg = 'R-K', db = { toast_upgrade_days: [], toast_upgrade_extra: [], toast_upgrade_lines: [] };
  const da = { 'F04-K': {} };
  for (let i = 1; i <= 14; i++) {
    const d = '2026-11-' + String(i).padStart(2, '0');
    db.toast_upgrade_days.push(dayRow(rg, d, 10, { 'M-AOSA': { n: 'Aosa', k: 'aosa', q: 7 }, 'M-CRAB': { n: 'Crab', k: 'crab', q: 3 } }));
    da['F04-K'][d] = { misoTotal: 10, misoUpgrade: 3 };
  }
  for (let i = 25; i <= 31; i++) da['F04-K']['2026-10-' + i] = { misoTotal: 10, misoUpgrade: 5 };
  const cfg = { byStore: { 'F04-K': { upsell: [{ from: '2026-11', mods: ['M-CRAB'], ala: [] }] } } };
  const c = world({ today: '2026-11-15', db, cfg, da });
  const days = Array.from({ length: 14 }, (_, i) => '2026-11-' + String(i + 1).padStart(2, '0'));
  run(c, `FUNERGY_UP.stats(['F04-K'], ${JSON.stringify(days)})`); await settle(c);
  const s = plain(run(c, `FUNERGY_UP.stats(['F04-K'], ${JSON.stringify(days)})`));
  assert.equal(s.all, 140); assert.equal(s.up, 42); assert.equal(s.rate, 30);
  assert.ok(s.days.every(x => x.ups && x.k === 'ok' && x.M === 3 && x.ala === 0));
  const w = plain(run(c, `FUNERGY_UP.wow(['F04-K'])`));
  assert.equal(w.pairs, 7, '11/8–11/14 vs 11/1–11/7: both under the November setting');
  // early November: the prior week is October (earlier rule) → those pairs are dropped, not compared
  const c2 = world({ today: '2026-11-04', db, cfg, da });
  run(c2, `FUNERGY_UP.wow(['F04-K'])`); await settle(c2);
  const w2 = plain(run(c2, `FUNERGY_UP.wow(['F04-K'])`));
  assert.equal(w2.pairs, 0);
  assert.equal(w2.dropped.filter(x => x.def).length, 3, '11/1–11/3 vs 10/25–10/27');
  // the breakdown modal: the new formula and the upsell section
  const id = run(c, `FUNERGY_UP.ctx(['F04-K'], ${JSON.stringify(days)}, { misoRate: 30, misoUp: 42, misoAll: 140 })`);
  const html = run(c, `FUNERGY_UP.html(${JSON.stringify(id)})`);
  for (const t of ['成立（分子）', '分母（機会）', '1 つの機会は 1 回だけ', 'アップセル対象での数え方', '(3＋0−0)÷10'.replace('(3', '(42').replace('÷10', '÷140')]) assert.ok(html.includes(t), t);
  assert.ok(!html.includes("丼に Crab・Today's・Udon の味噌汁、または CHAZUKE（茶漬け）を付けた数"), 'the earlier formula is not shown for the new month');
});

test('B settings card: editors only; past months locked; at least one item; 未保存 + retry when the cloud is not reached; saved resets the draft', async () => {
  const recipes = [{ id: 'r1', name: 'Extra Ikura', toastGuid: 'A-IK', storeId: 'F04-K', category: 'Topping' }, { id: 'r2', name: 'Take Don', toastGuid: 'B-DON', storeId: 'F04-K', category: 'Bowl' }];
  const c = world({ today: '2026-11-16', cfg: {}, recipes, bowl: { 'F04-K': { foodGuids: ['B-DON'], takeoutGuids: [] } }, pushOk: false,
    db: { toast_upgrade_days: [dayRow('R-K', '2026-11-10', 5, { 'M-AOSA': { n: 'Aosa', k: 'aosa', q: 3 }, 'M-CRAB': { n: 'Crab Miso', k: 'crab', q: 2 } })] } });
  let h = run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`);
  await settle(c);
  h = run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`);
  assert.ok(h.includes('アップグレード率に入れるもの') && h.includes('まだ設定がありません'));
  assert.ok(h.includes('Crab Miso') && h.includes('Extra Ikura'), 'modifier candidates from the last 30 days; a la carte from the menu');
  assert.ok(!h.includes('Take Don'), 'bowls are not a la carte candidates');
  assert.ok(/<option value="2026-11" selected>/.test(h) && !h.includes('value="2026-10"'), 'starts this month at the earliest');
  assert.ok(/value="M-AOSA"|分母だけ/.test(h));
  // select a la carte, save while the cloud is not reached
  const ai = run(c, `window._upsAlaKeys.indexOf('A-IK')`);
  run(c, `FUNERGY_UPS.toggle('ala', ${ai}, true)`);
  assert.equal(await run(c, `FUNERGY_UPS.save('F04-K')`), false);
  assert.equal(run(c, `window._upsSave.ok`), false);
  h = run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`);
  assert.ok(h.includes('未保存：クラウドに送れませんでした') && h.includes('もう一度'));
  assert.ok(h.includes('まだ保存していない変更があります'), 'the draft is kept for the retry');
  c.PUSH.ok = true;
  assert.equal(await run(c, `FUNERGY_UPS.save('F04-K', true)`), true);
  const v = plain(c.CFG.byStore['F04-K'].upsell);
  assert.equal(v.length, 1); assert.equal(v[0].from, '2026-11'); assert.deepEqual(v[0].ala, ['A-IK']); assert.deepEqual(v[0].mods, ['M-CRAB'], 'default modifiers = every non-Aosa modifier seen');
  assert.equal(v[0].by, 'Moto'); assert.equal(run(c, `window._upsEdit`), null);
  // a version for an earlier month cannot be written
  run(c, `window._upsEdit={ sid:'F04-K', from:'2026-10', mods:['M-CRAB'], ala:[], names:{}, q:'', touched:true }`);
  assert.equal(await run(c, `FUNERGY_UPS.save('F04-K')`), false);
  assert.equal(c.CFG.byStore['F04-K'].upsell.length, 1);
  // nothing selected → not saved
  run(c, `window._upsEdit={ sid:'F04-K', from:'2026-12', mods:[], ala:[], names:{}, q:'', touched:true }`);
  assert.equal(await run(c, `FUNERGY_UPS.save('F04-K')`), false);
  // a December version keeps November as it is
  run(c, `window._upsEdit={ sid:'F04-K', from:'2026-12', mods:['M-CRAB'], ala:[], names:{}, q:'', touched:true }`);
  assert.equal(await run(c, `FUNERGY_UPS.save('F04-K')`), true);
  assert.deepEqual(plain(c.CFG.byStore['F04-K'].upsell.map(x => x.from)), ['2026-11', '2026-12']);
  assert.deepEqual(plain(c.CFG.byStore['F04-K'].upsell[0].ala), ['A-IK']);
  // view only
  const d = world({ can: false, cfg: {}, recipes });
  const vh = run(d, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`);
  assert.ok(vh.includes('変えられるのは') && !vh.includes('FUNERGY_UPS.save'));
  assert.equal(await run(d, `FUNERGY_UPS.save('F04-K')`), false);
});

test('B wiring: the KPI settings tab shows the card for Totoya; the legacy card is renamed to the topping ratio; the tile reads totoyaKpiCalc', () => {
  const tab = fnSrc('renderKpiManualTab');
  assert.match(tab, /FUNERGY_UPS\.cardHtml\(sid, period\)/);
  assert.match(tab, /トッピング\/アップセル比率の対象商品（出数÷客数）/);
  assert.match(tab, /アップグレード率に入れるものは、下の「アップグレード率に入れるもの」で選びます/);
  const tk = fnSrc('totoyaKpiCalc');
  assert.match(tk, /FUNERGY_UPS\.cfgFor\(sid, ymStr\)/);
  assert.match(tk, /ups:_ups/);
  assert.ok(SRC.indexOf('/* ==== FUNERGY_UPS start') > SRC.indexOf('/* ==== FUNERGY_UP end ==== */'));
});

/* ---------- A ---------- */
const A_FNS = ['k2NormAcctName', 'k2SysAcctList', 'k2SysMatcher', 'k2DayIssues', 'k2HoursDays', 'k2HoursDaysM', 'k2HoursDaysAll', 'k2RecGuids', 'isOrderOnlyAccount', 'toastSystemAccount', '_laborHrs', 'k2IsSysName', 'k2SysGuids', 'k2MonthGuids', 'k2YmAdd', 'daysOfYm',
  'k2SysCanEdit', 'k2SysMonthAccounts', 'k2SysCarryOver', 'k2SysSave', 'k2SysCarry', 'k2SysCarryRetry', 'kpiCfgPush', 'kpiSameView', 'tipLaborWithGuid', 'tipLaborPut', '_toastShiftsOverlap'];
function aWorld({ today = '2026-11-16', labor = {}, kpi = {}, role = 'gm', realRole = null, amStores = [], over = {}, pushOk = true } = {}) {
  const LS = {}; Object.keys(labor).forEach(k => { LS['tip_labor_' + k] = labor[k]; }); LS.kpi_config = kpi;
  const c = { console, JSON, Math, Object, Array, String, Number, RegExp, Date, Promise, LS, OVER: over, TOASTS: [], PUSH: { ok: pushOk },
    ROLE: role, REAL: realRole, AMS: amStores, TODAY: today };
  c.window = c;
  vm.createContext(c);
  run(c, `
    var curRole=ROLE, curRealRole=REAL, curUserName='Moto', _lsPushP={}, _k2SysBusy=false, curPage='kpi_master', RENDERS=0;
    /* クラウドの kpi_config（合成）：CLOUD.fail で読めない。pullSettingKey は読めたら端末に入れる */
    var CLOUD={ value:null, fail:false, pulls:0 };
    async function wbFetchSetting(k){ if(CLOUD.fail) return undefined; return CLOUD.value==null ? { exists:false, value:null } : { exists:true, value:JSON.parse(JSON.stringify(CLOUD.value)) }; }
    async function pullSettingKey(k){ CLOUD.pulls++; if(CLOUD.fail || CLOUD.value==null) return false; LS.kpi_config=JSON.parse(JSON.stringify(CLOUD.value)); return true; }
    function t(ja){ return ja; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : d; }
    function _lsRaw(k, d){ return ls(k, d); }
    function lsKeys(pre){ return Object.keys(LS).filter(function(k){ return k.indexOf(pre)===0; }); }
    function getKpiConfig(){ return LS.kpi_config || {}; }
    function setKpiConfigStore(sid, p){ var c=LS.kpi_config; c.byStore=c.byStore||{}; c.byStore[sid]=Object.assign({}, c.byStore[sid]||{}, p); _lsPushP['kpi_config']=Promise.resolve(PUSH.ok); }
    function getStoresAll(){ return [{ id:'F06' }, { id:'F01' }]; }
    function getTipLabor(sid, d){ var o=OVER[sid+'|'+d]; if(o) return o; return ls('tip_labor_'+sid+'_'+d, null); }
    function getAttOverride(sid, d){ return OVER[sid+'|'+d] ? { data:OVER[sid+'|'+d] } : null; }
    function curYm(){ return TODAY.slice(0,7); } function bizToday(){ return TODAY; }
    function dayClosureMode(){ return null; }
    function myAmStores(){ return AMS; }
    function mdCacheClear(){} function showToast(m,k){ TOASTS.push([m,k]); } function renderPage(){ RENDERS++; }
    function ceIsSystemAccount(n){ return /kiosk/i.test(String(n)); }
  `);
  A_FNS.forEach(n => run(c, fnSrc(n)));
  return c;
}
const LE = (h, g, extra) => Object.assign({ rawLunch: 0, rawDinner: h, lunch: 0, dinner: h, toastGuid: g }, extra || {});

test('A 2A: a day with an invalid time or a missing clock-out is 未集計 (both sides); system accounts are not looked at; a fixed day counts again', () => {
  const labor = {
    'F06_2026-10-01': { Ann: LE(8, 'g-a', { shifts: [{ inDate: '2026-10-01T17:00:00Z', outDate: '2026-10-02T01:00:00Z', ubh: 0.5 }] }) },
    'F06_2026-10-02': { Ann: LE(8, 'g-a', { shifts: [{ inDate: '2026-10-02T17:00:00Z', outDate: 'garbage' }] }) },
    'F06_2026-10-03': { Ann: LE(8, 'g-a'), Ben: LE(0, 'g-b', { openShifts: [{ inDate: '2026-10-03T17:00:00Z' }] }) },
    'F06_2026-10-04': { Ann: LE(8, 'g-a'), 'Toast Generic Login': LE(0, 'g-s', { openShifts: [{ inDate: '2026-10-04T17:00:00Z' }], shifts: [{ inDate: 'x' }] }) }
  };
  let c = aWorld({ labor });
  let r = plain(run(c, `k2HoursDays('F06','2026-10')`));
  const k = Object.fromEntries(r.days.filter(d => d.date <= '2026-10-05').map(d => [d.date, d.kind + (d.why ? ':' + d.why : '')]));
  assert.deepEqual(k, { '2026-10-01': 'open', '2026-10-02': 'pending:badtime', '2026-10-03': 'pending:noout', '2026-10-04': 'open', '2026-10-05': 'pending:nolabor' });
  assert.equal(r.openDays, 2); assert.equal(r.openHours, 16, 'Ann on 10/2 and 10/3 is left out of the numerator too');
  assert.equal(r.ubh, 0.5, 'unpaid breaks are only reported (clocked out already, nothing more is deducted)');
  // the manager fixes 10/2 (att_override) → it counts again
  c = aWorld({ labor, over: { 'F06|2026-10-02': { Ann: LE(7.5, 'g-a', { shifts: [{ inDate: '2026-10-02T17:00:00Z', outDate: '2026-10-03T00:30:00Z' }] }) } } });
  r = plain(run(c, `k2HoursDays('F06','2026-10')`));
  assert.equal(r.openDays, 3); assert.equal(r.openHours, 23.5);
});

test('A import keeps openShifts (hyper-worker v1176) and two entries for one person keep both', () => {
  const c = aWorld();
  const rec = plain(run(c, `tipLaborWithGuid({ lunch:0, dinner:0, rawLunch:0, rawDinner:0, shifts:[] }, { guid:'g1', openShifts:[{ inDate:'2026-11-01T17:00:00Z', x:1 }, { nope:1 }] })`));
  assert.deepEqual(rec.openShifts, [{ inDate: '2026-11-01T17:00:00Z' }]); assert.equal(rec.toastGuid, 'g1');
  const out = plain(run(c, `(function(){ var L={}, C={}; tipLaborPut(L, C, 'Ann', { lunch:0, dinner:4, rawLunch:0, rawDinner:4, shifts:[], toastName:'Ann', openShifts:[{ inDate:'a' }] }, { conf:true });
    tipLaborPut(L, C, 'Ann', { lunch:0, dinner:3, rawLunch:0, rawDinner:3, shifts:[], toastName:'Ann 2', openShifts:[{ inDate:'b' }] }, { conf:true }); return L.Ann; })()`));
  assert.deepEqual(out.openShifts, [{ inDate: 'a' }, { inDate: 'b' }]); assert.equal(out.rawDinner, 7);
  assert.match(SRC, /!\(Array\.isArray\(emp\.openShifts\) && emp\.openShifts\.length\)\) return;/, 'a person with only an open shift is kept by the Toast import');
});

test('A 4A: GM, CEO and the assigned AM edit the list; the earlier rules carry over once; a failed cloud save says 未保存', async () => {
  const labor = {
    'F06_2026-11-02': { Ann: LE(8, 'g-a'), 'Toast Generic Login': LE(3, 'g-sys'), 'Order Only': LE(2, 'g-oo'), 'Front Tablet': LE(1, 'g-ft') },
    'F06_2026-10-20': { 'Kiosk 1': LE(1, 'g-k') }
  };
  for (const [role, real, ams, ok] of [['gm', null, [], true], ['ceo', null, [], true], ['am', null, ['F06'], true], ['am', null, ['F01'], false], ['am', 'g4', ['F06'], false], ['sl', null, [], false], ['office', null, [], false]]) {
    assert.equal(run(aWorld({ role, realRole: real, amStores: ams }), `k2SysCanEdit('F06')`), ok, role + '/' + real + '/' + ams);
  }
  const c = aWorld({ labor });
  const co = plain(run(c, `k2SysCarryOver('F06')`));
  assert.deepEqual(Object.keys(co).sort(), ['g-k', 'g-oo', 'g-sys'], 'Toast Generic Login, Order Only and Kiosk (by the earlier rules); never a person or an unknown name');
  assert.ok(Object.values(co).every(x => x.on && x.src === 'auto'));
  // once in the list, only the list decides: Front Tablet (not in the list) counts; turning g-sys off counts it again
  c.LS.kpi_config.byStore = { F06: { sysAcct: co } };
  let r = plain(run(c, `k2HoursDays('F06','2026-11')`));
  assert.equal(r.openHours, 9, 'Ann 8 + Front Tablet 1'); assert.equal(r.excludedHours, 5);
  c.PUSH.ok = false;
  const m = Object.assign({}, co, { 'g-sys': Object.assign({}, co['g-sys'], { on: false }) });
  assert.equal(await run(c, `k2SysSave('F06', ${JSON.stringify(m)}, 'ok')`), false);
  assert.match(c.TOASTS.at(-1)[0], /未保存/);
  r = plain(run(c, `k2HoursDays('F06','2026-11')`));
  assert.equal(r.openHours, 12, 'kept on this device: g-sys counts now');
  const n = aWorld({ role: 'sl', labor });
  assert.equal(await run(n, `k2SysSave('F06', {}, 'ok')`), false);
  assert.equal(n.LS.kpi_config.byStore, undefined, 'no permission: nothing written');
});

/* ---------- Codex #174 6903141004 の P2-2・Claude #174 の P3（v1176 の直し） ---------- */
function deferredPushes(c) {
  const q = [];
  c.PUSHP = () => new Promise(res => q.push(res));
  return q;
}

test('Codex #174 P2-2: a save that finishes later clears only its own draft — another store’s draft and edits made during the save stay; it redraws only the same store and tab', async () => {
  const recipes = [{ id: 'r1', name: 'Extra Ikura', toastGuid: 'A-IK', storeId: 'F04-K', category: 'Topping' }, { id: 'r3', name: 'Extra Egg', toastGuid: 'A-EG', storeId: 'F04-P', category: 'Topping' }];
  const db = { toast_upgrade_days: [dayRow('R-K', '2026-11-10', 5, { 'M-CRAB': { n: 'Crab Miso', k: 'crab', q: 2 } }), dayRow('R-P', '2026-11-10', 5, { 'M-CRAB': { n: 'Crab Miso', k: 'crab', q: 2 } })] };
  const c = world({ today: '2026-11-16', cfg: {}, recipes, db, pushPromise: true });
  const q = deferredPushes(c);
  run(c, `window._kpiStore='F04-K'; window._kpiTab='manual';`);
  run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`); await settle(c); run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`);
  run(c, `FUNERGY_UPS.toggle('ala', window._upsAlaKeys.indexOf('A-IK'), true)`);
  // Codex's order: start saving F04-K → open F04-P and make a new unsaved draft → the F04-K save succeeds
  const p1 = run(c, `FUNERGY_UPS.save('F04-K')`);
  await settle(c);
  assert.equal(q.length, 1, 'the F04-K push is waiting');
  run(c, `window._kpiStore='F04-P'`);
  run(c, `FUNERGY_UPS.cardHtml('F04-P','2026.11')`); await settle(c); run(c, `FUNERGY_UPS.cardHtml('F04-P','2026.11')`);
  assert.ok(!run(c, `FUNERGY_UPS.cardHtml('F04-P','2026.11')`).includes('FUNERGY_UPS.save(\'F04-P\')" disabled'), 'saving F04-K does not lock the F04-P save button');
  run(c, `FUNERGY_UPS.toggle('ala', window._upsAlaKeys.indexOf('A-EG'), true)`);
  const before = c.RENDERS;
  q.shift()(true);
  assert.equal(await p1, true);
  const pDraft = plain(run(c, `window._upsEdit`));
  assert.equal(pDraft.sid, 'F04-P'); assert.deepEqual(pDraft.ala, ['A-EG']); assert.equal(pDraft.touched, true, 'the F04-P draft is kept');
  assert.equal(run(c, `window._upsEdits['F04-K']`), undefined, 'the saved F04-K draft is cleared');
  assert.equal(c.RENDERS, before, 'no redraw: the person is looking at F04-P now');
  assert.ok(run(c, `FUNERGY_UPS.cardHtml('F04-P','2026.11')`).includes('まだ保存していない変更があります'));
  // the same store: an edit made while the save was waiting stays as an unsaved draft
  run(c, `window._kpiStore='F04-P'`);
  const p2 = run(c, `FUNERGY_UPS.save('F04-P')`); await settle(c);
  run(c, `FUNERGY_UPS.setFrom('2026-12')`);
  const r0 = c.RENDERS;
  q.shift()(true);
  assert.equal(await p2, true);
  const kept = plain(run(c, `window._upsEdit`));
  assert.equal(kept.from, '2026-12', 'the edit after the save started is kept'); assert.equal(kept.touched, true);
  assert.equal(c.RENDERS, r0 + 1, 'same store and tab → redraw once');
  // a save with no edits in between clears the draft and redraws once
  const p3 = run(c, `FUNERGY_UPS.save('F04-P')`); await settle(c);
  q.shift()(true); assert.equal(await p3, true);
  assert.equal(run(c, `window._upsEdit`), null);
  assert.deepEqual(plain(c.CFG.byStore['F04-P'].upsell.map(v => v.from)), ['2026-11', '2026-12']);
  // a different tab at completion → no redraw
  run(c, `FUNERGY_UPS.cardHtml('F04-P','2026.11'); FUNERGY_UPS.setFrom('2027-01')`);
  const p4 = run(c, `FUNERGY_UPS.save('F04-P')`); await settle(c);
  run(c, `window._kpiTab='targets'`); const r4 = c.RENDERS;
  q.shift()(true); assert.equal(await p4, true); assert.equal(c.RENDERS, r4);
});

test('Codex #174 P2-2: the result is the result of this save only (an earlier success does not say 保存しました); a draft of another login is not reused', async () => {
  const c = world({ today: '2026-11-16', cfg: {}, recipes: [{ id: 'r1', name: 'Extra Ikura', toastGuid: 'A-IK', storeId: 'F04-K', category: 'Topping' }], pushPromise: true });
  const q = deferredPushes(c);
  run(c, `_lsPushP['kpi_config']=Promise.resolve(true); window._kpiStore='F04-K'`);
  run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11'); FUNERGY_UPS.toggle('ala', window._upsAlaKeys.indexOf('A-IK'), true)`);
  const p = run(c, `FUNERGY_UPS.save('F04-K')`); await settle(c);
  q.shift()(false);
  assert.equal(await p, false); assert.match(c.TOASTS.at(-1)[0], /未保存/);
  assert.equal(plain(run(c, `window._upsEdit`)).touched, true, 'the draft is kept for the retry');
  // Moto keeps editing (unsaved), then another person logs in on this device
  run(c, `FUNERGY_UPS.setFrom('2026-12')`);
  run(c, `curUserName='Yuki'`);
  const e = plain((run(c, `FUNERGY_UPS.cardHtml('F04-K','2026.11')`), run(c, `window._upsEdit`)));
  assert.equal(e.touched, false, 'another login does not see the earlier unsaved draft'); assert.equal(e.who, 'Yuki');
  assert.equal(e.from, '2026-11', 'it starts again from the stored setting');
});

test('Claude #174 P3-1: upsell versions carry id = month, so the v1149 merge keeps versions saved on two devices for different months', () => {
  const c = { console, JSON, Object, Array, String, Number };
  vm.createContext(c);
  run(c, 'var WB_ABS = { __wbAbsent:1 };\n' + ['_cjson', '_wbEq', '_wbPlain', '_wbOwn', '_wbIds', '_wbConf', 'wbMerge3', '_wbMergeIds'].map(fnSrc).join('\n'));
  const w = world({ cfg: { byStore: { 'F04-K': { upsell: [{ from: '2026-11', mods: ['M-CRAB'], ala: [] }] } } } });
  const nov = plain(run(w, `FUNERGY_UPS.versions('F04-K')`))[0];
  assert.equal(nov.id, '2026-11');
  const v = (from, m) => Object.assign({}, nov, { id: from, from, mods: [m] });
  const base = { byStore: { 'F04-K': { upsell: [nov] } } };
  const local = { byStore: { 'F04-K': { upsell: [nov, v('2026-12', 'M-UDON')] } } };   // this device added December
  const cloud = { byStore: { 'F04-K': { upsell: [nov, v('2027-01', 'M-CHZ')] } } };   // another device added January
  const m = plain(run(c, `wbMerge3(${JSON.stringify(base)}, ${JSON.stringify(local)}, ${JSON.stringify(cloud)}, { conf:[], prefer:'local' }, '')`));
  assert.deepEqual(m.byStore['F04-K'].upsell.map(x => x.from).sort(), ['2026-11', '2026-12', '2027-01']);
  // without ids (before the fix) one of the two would be lost
  const strip = o => JSON.parse(JSON.stringify(o, (k, val) => k === 'id' ? undefined : val));
  const m2 = plain(run(c, `wbMerge3(${JSON.stringify(strip(base))}, ${JSON.stringify(strip(local))}, ${JSON.stringify(strip(cloud))}, { conf:[], prefer:'local' }, '')`));
  assert.equal(m2.byStore['F04-K'].upsell.length, 2, 'this is what happened before');
  // a new version saved on this device has the id too
  assert.match(UPS_SRC, /vers\.push\(\{ id: e\.from, from: e\.from/);
});

test('Claude #174 P3-2 (Codex: still open): the carry-over reads the cloud first — a list made on another device is taken in, not overwritten; no list is made while the cloud cannot be read', async () => {
  const labor = { 'F06_2026-11-02': { Ann: LE(8, 'g-a'), 'Toast Generic Login': LE(3, 'g-sys') } };
  // another device already made the list and stopped excluding g-sys
  let c = aWorld({ labor });
  c.LS.kpi_config = {};
  run(c, `CLOUD.value = { byStore: { F06: { sysAcct: { 'g-sys': { name:'Toast Generic Login', on:false, src:'manual', at:'2026-11-15T00:00:00Z', by:'Yuki' } } } } }; window._kpiStore='F06';`);
  assert.equal(await run(c, `k2SysCarry('F06')`), false);
  assert.equal(c.LS.kpi_config.byStore.F06.sysAcct['g-sys'].on, false, 'the other device’s "stop excluding" stays');
  assert.equal(run(c, `CLOUD.pulls`), 1);
  assert.equal(c.TOASTS.length, 0, 'nothing was saved');
  let r = plain(run(c, `k2HoursDays('F06','2026-11')`));
  assert.equal(r.openHours, 11, 'g-sys counts');
  // the cloud cannot be read → no list, a retry is offered
  c = aWorld({ labor });
  c.LS.kpi_config = {};
  run(c, `CLOUD.fail = true; window._kpiStore='F06'`);
  assert.equal(await run(c, `k2SysCarry('F06')`), false);
  assert.equal((c.LS.kpi_config.byStore || {}).F06, undefined);
  assert.equal(run(c, `window._k2SysCarried.F06`), 'fail');
  // retry when the cloud is back and has no list → the list is made from the earlier rules
  run(c, `CLOUD.fail = false; CLOUD.value = { drinkCats: [] }`);
  assert.equal(await run(c, `k2SysCarryRetry('F06')`), true);
  assert.deepEqual(Object.keys(c.LS.kpi_config.byStore.F06.sysAcct), ['g-sys']);
  assert.equal(run(c, `window._k2SysCarried.F06`), 'done');
  // a save that finishes while another store is open does not redraw
  run(c, `window._kpiStore='F01'`); const r0 = run(c, `RENDERS`);
  await run(c, `k2SysSave('F06', ${JSON.stringify({ 'g-sys': { name: 'Toast Generic Login', on: false } })}, 'ok', null)`);
  assert.equal(run(c, `RENDERS`), r0);
  run(c, `window._kpiStore='F06'`);
  await run(c, `k2SysSave('F06', ${JSON.stringify({ 'g-sys': { name: 'Toast Generic Login', on: true } })}, 'ok', null)`);
  assert.equal(run(c, `RENDERS`), r0 + 1);
  // the screen asks the helper instead of writing on its own
  const tab = fnSrc('renderKpiSysAcctTab');
  assert.match(tab, /k2SysCarry\(sid\)/); assert.ok(!/k2SysSave\(sid, co/.test(tab));
  assert.match(tab, /if\(!list && can && !_k2SysBusy && !carrySt\)/, 'after a failure the screen does not try again by itself (no loop of reads); the retry button does');
  assert.match(tab, /k2SysCarryRetry\(/);
});

test('v1176: k2SysSave says 保存しました only for its own push (sync OFF → no push → 未保存, even after an earlier success)', async () => {
  const c = aWorld({ kpi: {} });
  run(c, `setKpiConfigStore = function(sid, p){ var k=LS.kpi_config; k.byStore=k.byStore||{}; k.byStore[sid]=Object.assign({}, k.byStore[sid]||{}, p); /* sync OFF: nothing is sent */ };
    _lsPushP['kpi_config']=Promise.resolve(true);`);
  assert.equal(await run(c, `k2SysSave('F06', { 'g-sys': { name:'Toast Generic Login', on:true } }, 'ok')`), false);
  assert.match(c.TOASTS.at(-1)[0], /未保存/);
  assert.equal(run(c, `window._k2SysState.ok`), false);
});

test('Claude #174 P3-1: with a list, ID-less old records still follow the earlier name rules (past months do not grow); a name the list stopped excluding counts', () => {
  const labor = {
    'F06_2026-08-04': { Ann: { rawLunch: 0, rawDinner: 8, lunch: 0, dinner: 8 }, 'Toast Generic Login': { rawLunch: 0, rawDinner: 2, lunch: 0, dinner: 2 } },
    'F06_2026-11-02': { Ann: LE(8, 'g-a'), 'Kiosk 1': LE(1, 'g-k') }
  };
  let c = aWorld({ labor, kpi: { byStore: { F06: { sysAcct: { 'g-k': { name: 'Kiosk 1', on: true } } } } } });
  let r = plain(run(c, `k2HoursDays('F06','2026-08')`));
  assert.equal(r.openHours, 8, 'the ID-less "Toast Generic Login" record of August is still left out'); assert.equal(r.excludedHours, 2);
  r = plain(run(c, `k2HoursDays('F06','2026-11')`));
  assert.equal(r.openHours, 8); assert.equal(r.excludedHours, 1);
  c = aWorld({ labor, kpi: { byStore: { F06: { sysAcct: { 'g-k': { name: 'Kiosk 1', on: true }, 'g-tgl': { name: 'Toast Generic Login', on: false } } } } } });
  r = plain(run(c, `k2HoursDays('F06','2026-08')`));
  assert.equal(r.openHours, 10, 'the list stopped excluding this name → it counts');
});
