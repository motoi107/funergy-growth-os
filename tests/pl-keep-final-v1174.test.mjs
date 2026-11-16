// v1174 の直し（PR #172 の Codex の P2）：会計 PL の共有の保存（pl_public）で、「確定」の月を「暫定」で上書きしない。
// 端末の合流（mergePlPublic）・送る道（本物の opMergePush の pullBack）・取り込みの前の読み直し（_plReadCloudPub・plImportSave）と、
// データベースの見張り（supabase/migrations/20261202090000_pl_public_keep_final.sql）。
// 本物の関数を VM で動かし、クラウドは PGlite（jsonb の app_settings に本物の SQL を流す）。合成データだけ。本番にはつながない。
// FUNERGY_INDEX に前の版の index.html を渡すと、関数が無いので落ちる（前は端末の写しだけを見て、月ごとに手元が勝った）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = fs.readFileSync(process.env.PL_KEEP_SQL || new URL('../supabase/migrations/20261202090000_pl_public_keep_final.sql', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  assert.ok(m, 'function not found: ' + name);
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
const varLine = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); assert.ok(m, 'var ' + name); return m[0]; };
// 本物の合流の決まりの行（OP_MERGE の pl_public）
const DEF = (() => { const m = /^\s*pl_public:\s*(\{[^\n]*\}),?\s*$/m.exec(SRC); assert.ok(m, 'OP_MERGE pl_public'); return m[1]; })();

const PURE = ['_cjson', '_mapPick', 'mergeMapByKey', '_coversMapByKey', '_plIsObj', '_plIsNumPos', '_plRecRank', '_plAt', '_plRecPick', '_plMergeMonth', 'mergePlPublic', '_coversPlPublic'];
const DEVICE = ['_fetchOpValue', '_opWriteBack', 'opMergePush', '_opUpsertRow', '_opCloudVal', 'pullSettingKey',
  '_plKeepsFinal', '_plReadCloudPub', '_plPreviewHtml', '_plStoreLabel', 'plImportSave', 'plFilePicked'];

const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const tick = () => new Promise(r => setImmediate(r));

function pureCtx() {
  const c = { JSON, Object, Array, String, Number, Math, isFinite };
  vm.createContext(c);
  run(c, [varLine('PL_YM_RE'), ...PURE.map(fnSrc)].join('\n'));
  return c;
}
const P = pureCtx();
const jsMerge = (a, b) => plain(run(P, `mergePlPublic(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
const jsCovers = (h, w) => run(P, `_coversPlPublic(${JSON.stringify(h)}, ${JSON.stringify(w)})`);
const jsRank = r => run(P, `_plRecRank(${JSON.stringify(r)})`);

async function cloudDb({ trigger = true, roles = false } = {}) {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  // Supabase と同じ：新しい関数はアプリの鍵（anon・authenticated）にも実行の権限が付く（だから SQL で外す）
  if (roles) await db.exec('create role anon; create role authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;');
  await db.exec('create table public.app_settings(key text primary key, value jsonb, category text)');
  if (trigger) await db.exec(MIG);
  return db;
}
const cloudOf = async db => { const r = await db.query("select value::text as v from app_settings where key='pl_public'"); return r.rows.length ? JSON.parse(r.rows[0].v) : undefined; };
const putCloud = (db, v) => db.query("insert into app_settings(key,value) values('pl_public',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify(v)]);
const sqlJoin = async (db, o, n) => { const r = await db.query('select public.fp_pl_public_join($1::jsonb, $2::jsonb)::text as v', [JSON.stringify(o), JSON.stringify(n)]); return JSON.parse(r.rows[0].v); };

// 合成の記録（金額は架空）
const FIN = (sales, at) => ({ sales, cogs: Math.round(sales * 0.3), payroll: Math.round(sales * 0.25), _at: at });
const PROV = (sales, at) => ({ ...FIN(sales, at), prov: 1 });

/* 端末 1 台。S＝端末の保存（キー → 文字）。hold(method, when)：その通信の答えの前に待つ。failRead：読むとサーバーのエラー */
function device(db, { now = Date.UTC(2026, 10, 15, 22), S = {} } = {}) {
  const toasts = [];
  const c = {
    console: { log() {}, warn() {}, error() {} }, S, NOW: now, hold: null, failRead: false, toasts,
    SUPABASE_URL: 'https://cloud.invalid', AbortController, setTimeout, clearTimeout, JSON, Math, Promise, Object, Array, String, Number, isFinite,
    _opLastPushErr: {}, _opLastPushWhy: {}, _opMergeChain: {}, window: null,
    t: ja => ja, escapeHtml: s => String(s), fmtK: v => String(v), STORES: [], todayJP: () => '2026/11/15',
    showToast: (m, k) => toasts.push([m, k]), closeModalDirect() {}, _secRerender() {},
    _lsWriteVerified: (k, j) => { S[k] = j; return true; }, _lsRaw: (k, d) => (k in S ? JSON.parse(S[k]) : d),
    ls: (k, d) => (k in S ? JSON.parse(S[k]) : d), lsSet: (k, v) => { S[k] = JSON.stringify(v); return true; },
    _lsFreeOldLaborKeys() {}, _lsNoteSaveFailure() {}, _lsClearSaveFailure() {}, _pullKeepLocal: () => false,
    supaHeaders: () => ({}), supaSettingCategory: () => 'pl',
    supaUpsert: async (t, rows) => {
      assert.equal(t, 'app_settings');
      for (const r of rows) await db.query('insert into app_settings(key,value,category) values($1,$2,$3) on conflict(key) do update set value=excluded.value', [r.key, JSON.stringify(r.value), r.category || null]);
      return true;
    },
    fetch: async (url, o = {}) => {
      const method = (o && o.method) || 'GET';
      assert.match(url, /\/rest\/v1\/app_settings\?key=eq\.pl_public/);
      if (c.hold) await c.hold(method, 'before');
      let res;
      if (c.failRead) res = { ok: false, status: 500, json: async () => ({}) };
      else {
        const r = await db.query("select value::text as v from app_settings where key='pl_public'");
        res = { ok: true, status: 200, json: async () => r.rows.map(x => ({ value: JSON.parse(x.v) })) };
      }
      if (c.hold) await c.hold(method, 'after');
      return res;
    },
  };
  c.window = c;
  vm.createContext(c);
  run(c, [varLine('PL_YM_RE'), varLine('_OP_READ_TMO'), ...PURE.map(fnSrc), ...DEVICE.map(fnSrc)].join('\n') + `
    Date.now = function(){ return NOW; };
    var _plImport = null;
    var _PL_DEF = ${DEF};
    function _opMergeDef(k){ return k==='pl_public' ? _PL_DEF : null; }`);
  return c;
}
const local = c => JSON.parse(c.S.pl_public);
// 端末の保存（本物の lsSet → _pushWithOutbox → opMergePush と同じ：手元に書いてから、その値で送る）
const save = async (c, val) => { c.S.pl_public = JSON.stringify(val); return run(c, `opMergePush('pl_public', ls('pl_public', null), 'app_settings')`); };
const resend = c => run(c, `opMergePush('pl_public', ls('pl_public', null), 'app_settings')`);
function holdFirstGetAfter(c) {
  let release, first = true; const gate = new Promise(r => { release = r; });
  c.hold = async (m, when) => { if (m === 'GET' && when === 'after' && first) { first = false; await gate; } };
  return release;
}
// 取り込みの結果（parsePLWorkbook の形の一部）
const imp = rows => ({ rows: rows.map(x => ({ ok: true, ym: x.ym, storeKey: x.s, prov: !!x.prov, c: {}, sheet: 'S', col: 'B', v: { sales: x.sales, cogs: 1, payroll: 1, opex: 1, netop: 1, netinc: null } })),
  months: [...new Set(rows.map(x => x.ym))].sort(), issues: [], warnings: [], file: 'PL.xlsx' });

// ---------- 1. 合流の決まり（純粋） ----------
test('rank: final = no provisional mark and sales > 0; everything else provisional', () => {
  assert.equal(jsRank(FIN(100, 1)), 2); assert.equal(jsRank(PROV(100, 1)), 1);
  assert.equal(jsRank({ sales: 0 }), 1); assert.equal(jsRank({ sales: -3 }), 1); assert.equal(jsRank({ sales: '120.5' }), 2);
  assert.equal(jsRank({ sales: 5, prov: false }), 2); assert.equal(jsRank({ sales: 5, prov: 0 }), 2); assert.equal(jsRank({ sales: 5, prov: true }), 1);
  assert.equal(jsRank(null), 0); assert.equal(jsRank(5), 0); assert.equal(jsRank([]), 0);
});

test('Codex repro: B holds provisional 90, cloud final 100, B imports provisional 95 -> the final stays (merge, keep-final check and save)', async () => {
  const cloud = { _at: 10, '2026-10': { F06: FIN(100, 10) } };
  const bLocal = { _at: 5, '2026-10': { F06: PROV(90, 5) } };
  // 合流だけ：前は mergeMapByKey で 95・暫定になった
  const old = plain(run(P, `mergeMapByKey(${JSON.stringify(cloud)}, ${JSON.stringify({ ...bLocal, '2026-10': { F06: PROV(95, 20) } })})`));
  assert.equal(old['2026-10'].F06.sales, 95, 'the old merge loses the final (this is the bug)');
  const m = jsMerge(cloud, { ...bLocal, '2026-10': { F06: PROV(95, 20) } });
  assert.deepEqual(m['2026-10'].F06, FIN(100, 10));
  // 取り込みの画面：クラウドを読んでから決める（端末の写しは暫定だけ）
  const db = await cloudDb(); await putCloud(db, cloud);
  const B = device(db, { S: { pl_public: JSON.stringify(bLocal) } });
  const cp = await run(B, `_plReadCloudPub()`);
  assert.equal(cp.state, 'ok');
  const r = imp([{ ym: '2026-10', s: 'F06', sales: 95, prov: true }]);
  run(B, `_plImport = ${JSON.stringify(r)}; _plImport.cloudState = 'ok'; _plImport.cloudPub = ${JSON.stringify(cp.value)};`);
  assert.equal(run(B, `_plKeepsFinal(_plImport.rows[0], _plImport.cloudPub)`), true);
  assert.equal(run(B, `_plKeepsFinal(_plImport.rows[0])`), false, 'without the cloud copy the device alone does not know (the reason for reading first)');
  const html = run(B, `_plPreviewHtml(_plImport)`);
  assert.match(html, /確定済みの月は暫定で上書きしません/); assert.doesNotMatch(html, /plImportSave\(\)/, 'nothing to import -> no import button');
  await db.close();
});

test('merge: union of months and stores, final beats provisional both ways, newer import wins within a kind', () => {
  const c = { _at: 3, '2026-09': { F01: FIN(10, 1) }, '2026-10': { F01: FIN(100, 5), F02: PROV(50, 9) } };
  const l = { _at: 7, '2026-10': { F01: PROV(120, 99), F02: PROV(55, 8), F06: PROV(30, 7) }, '2026-11': { F01: PROV(1, 7) } };
  const m = jsMerge(c, l);
  assert.deepEqual(Object.keys(m).sort(), ['2026-09', '2026-10', '2026-11', '_at']);
  assert.deepEqual(m['2026-10'].F01, FIN(100, 5), 'final kept although the provisional is newer');
  assert.deepEqual(m['2026-10'].F02, PROV(50, 9), 'same kind: newer wins');
  assert.deepEqual(m['2026-10'].F06, PROV(30, 7)); assert.deepEqual(m['2026-09'].F01, FIN(10, 1)); assert.equal(m._at, 7);
  // 確定どうしは新しい取り込み（確定版の取り込み直しで直せる）
  assert.deepEqual(jsMerge({ '2026-10': { F01: FIN(100, 5) } }, { '2026-10': { F01: FIN(101, 6) } })['2026-10'].F01, FIN(101, 6));
  assert.deepEqual(jsMerge({ '2026-10': { F01: FIN(101, 6) } }, { '2026-10': { F01: FIN(100, 5) } })['2026-10'].F01, FIN(101, 6));
});

test('covers: the cloud must keep every store and month, and never a weaker or older record', () => {
  const want = { _at: 5, '2026-10': { F01: PROV(90, 5), F02: FIN(10, 5) } };
  assert.equal(jsCovers({ _at: 6, '2026-10': { F01: FIN(100, 1), F02: FIN(10, 5) } }, want), true, 'a final in the cloud covers a provisional');
  assert.equal(jsCovers({ '2026-10': { F01: PROV(90, 5) } }, want), false, 'a store is missing');
  assert.equal(jsCovers({ '2026-10': { F01: PROV(90, 4), F02: FIN(10, 5) } }, want), false, 'older');
  assert.equal(jsCovers({ '2026-10': { F01: PROV(90, 5), F02: PROV(10, 9) } }, want), false, 'weaker');
  assert.equal(jsCovers(null, want), false);
});

// 乱数（同じ種から同じ並び）
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (R, a) => a[Math.floor(R() * a.length)];
function wellFormed(R) {
  const o = {};
  if (R() < 0.8) o._at = Math.floor(R() * 50);
  for (const ym of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    if (R() < 0.4) continue;
    const mo = {};
    for (const s of ['F01', 'F02', 'F04-K', 'F06']) {
      if (R() < 0.45) continue;
      const rec = { sales: pick(R, [0, 50, 100, 120, '80', ' 2.5 ', -4]), cogs: pick(R, [1, 2]), _at: pick(R, [1, 2, 3, 4, 5, '6', undefined]) };
      const p = pick(R, [undefined, undefined, 1, 0, true, false, '', 'yes']);
      if (p !== undefined) rec.prov = p;
      if (rec._at === undefined) delete rec._at;
      mo[s] = rec;
    }
    o[ym] = mo;
  }
  return o;
}
const finals = o => { const out = new Set(); for (const [k, mo] of Object.entries(o)) if (/^\d{4}-\d{2}$/.test(k) && mo && typeof mo === 'object') for (const [s, r] of Object.entries(mo)) if (jsRank(r) === 2) out.add(k + '|' + s); return out; };

test('merge laws on well-formed values (2,000 random triples): commutative, associative, idempotent, keeps every store, never loses a final', () => {
  const R = rng(1174);
  for (let i = 0; i < 2000; i++) {
    const a = wellFormed(R), b = wellFormed(R), c = wellFormed(R);
    const ab = jsMerge(a, b);
    assert.deepEqual(ab, jsMerge(b, a), 'commutative #' + i);
    assert.deepEqual(jsMerge(ab, c), jsMerge(a, jsMerge(b, c)), 'associative #' + i);
    assert.deepEqual(jsMerge(ab, ab), ab, 'idempotent #' + i);
    for (const f of [...finals(a), ...finals(b)]) assert.ok(finals(ab).has(f), 'final kept ' + f + ' #' + i);
    for (const x of [a, b]) for (const [k, mo] of Object.entries(x)) if (/^\d{4}-\d{2}$/.test(k)) for (const s of Object.keys(mo)) assert.ok(ab[k] && s in ab[k], 'store kept #' + i);
    assert.equal(jsCovers(ab, a), true); assert.equal(jsCovers(ab, b), true);
  }
});

// ---------- 2. データベースの見張り ----------
function wild(R) {
  const o = {};
  const at = pick(R, [undefined, 1, 2, 3, '2', 'zz', null]); if (at !== undefined) o._at = at;
  if (R() < 0.2) o.note = pick(R, [{ _at: 1, x: 1 }, { _at: 3, x: 2 }, 'text', 7, null]);
  for (const ym of ['2026-09', '2026-10', '2026-11', 'abc', '2026-1']) {
    const roll = R();
    if (roll < 0.35) continue;
    if (roll < 0.42) { o[ym] = pick(R, [null, 5, [1], 'x', { _at: 2 }]); continue; }
    const mo = {};
    for (const s of ['F01', 'F02', 'F06']) {
      const r2 = R();
      if (r2 < 0.35) continue;
      if (r2 < 0.42) { mo[s] = pick(R, [null, 3, 'x', []]); continue; }
      const rec = { sales: pick(R, [0, 50, 100, '80', ' 2.5 ', '.5', '5.', 'x', -4, null]), cogs: 1, _at: pick(R, [1, 2, 3, '2', 'zz', 1.5]) };
      const p = pick(R, [undefined, undefined, 1, 0, true, false, '', null, 'yes', '0']); if (p !== undefined) rec.prov = p;
      if (R() < 0.15) delete rec._at;
      mo[s] = rec;
    }
    o[ym] = mo;
  }
  return o;
}
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const atOf = r => { const v = r && r._at; if (typeof v === 'number') return v; if (typeof v === 'string' && /^\s*[0-9]+(\.[0-9]+)?\s*$/.test(v)) return Number(v); return 0; };

test('the database join equals the app merge (1,500 random pairs, wild shapes); on an exact tie the database keeps the value being written', async () => {
  const db = await cloudDb(); const R = rng(20261202);
  for (let i = 0; i < 1500; i++) {
    const o = wild(R), n = wild(R);
    const js = jsMerge(o, n), sq = await sqlJoin(db, o, n);
    assert.deepEqual(Object.keys(sq).sort(), Object.keys(js).sort(), 'keys #' + i);
    for (const k of Object.keys(js)) {
      if (/^\d{4}-\d{2}$/.test(k) && isObj(o[k]) && isObj(n[k])) {
        assert.deepEqual(Object.keys(sq[k]).sort(), Object.keys(js[k]).sort(), 'stores #' + i);
        for (const s of Object.keys(js[k])) {
          const a = o[k][s], b = n[k][s];
          const tie = isObj(a) && isObj(b) && jsRank(a) === jsRank(b) && atOf(a) === atOf(b);
          if (tie) { assert.deepEqual(sq[k][s], b, 'tie -> written value #' + i); assert.ok([JSON.stringify(a), JSON.stringify(b)].includes(JSON.stringify(js[k][s]))); }
          else assert.deepEqual(sq[k][s], js[k][s], `store ${k} ${s} #${i}`);
        }
      } else assert.deepEqual(sq[k], js[k], 'key ' + k + ' #' + i);
    }
  }
  // 形の分からない値は何もしない
  assert.deepEqual(await sqlJoin(db, { __st: 1, v: {} }, { a: 1 }), { a: 1 });
  assert.deepEqual(await sqlJoin(db, { '2026-10': { F01: FIN(1, 1) } }, { __st: 1, v: {} }), { __st: 1, v: {} });
  assert.deepEqual(await sqlJoin(db, [1], { a: 1 }), { a: 1 });
  await db.close();
});

test('the trigger: a provisional write keeps the final and the other stores; other keys and the first insert are untouched; anon cannot call the helpers', async () => {
  const db = await cloudDb({ roles: true });
  await db.exec("grant select, insert, update on public.app_settings to anon");
  await putCloud(db, { _at: 10, '2026-10': { F01: FIN(100, 10), F02: PROV(5, 10) } });   // 最初の書き込み（insert）はそのまま
  assert.deepEqual(await cloudOf(db), { _at: 10, '2026-10': { F01: FIN(100, 10), F02: PROV(5, 10) } });
  await db.exec('set role anon');
  await db.query("insert into app_settings(key,value) values('pl_public',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify({ _at: 20, '2026-10': { F01: PROV(95, 20) } })]);
  await db.exec('reset role');
  assert.deepEqual(await cloudOf(db), { _at: 20, '2026-10': { F01: FIN(100, 10), F02: PROV(5, 10) } }, 'anon write still goes through the trigger');
  // 確定版の取り込み直しは通る
  await putCloud(db, { '2026-10': { F01: FIN(101, 30) } });
  assert.deepEqual((await cloudOf(db))['2026-10'].F01, FIN(101, 30));
  // ほかのキーは変えない
  await db.query("insert into app_settings(key,value) values('kpi_config','{\"a\":1}')");
  await db.query("update app_settings set value='{\"b\":2}' where key='kpi_config'");
  assert.deepEqual(JSON.parse((await db.query("select value::text as v from app_settings where key='kpi_config'")).rows[0].v), { b: 2 });
  // 見張りの中だけで使う関数：アプリの鍵からは呼べない
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.fp_pl_public_join('{}'::jsonb, '{}'::jsonb)"), /permission denied/);
  await assert.rejects(db.query("select public.fp_pl_rank('{}'::jsonb)"), /permission denied/);
  for (const f of ['fp_pl_pos(jsonb)', 'fp_pl_rank(jsonb)', 'fp_pl_at(jsonb)', 'fp_pl_public_join(jsonb,jsonb)', 'fp_pl_public_keep_final()']) assert.equal((await db.query(`select has_function_privilege('anon', 'public.${f}', 'execute') as x`)).rows[0].x, false, f);
  await db.exec('reset role');
  // 2 回流しても同じ
  await db.exec(MIG);
  await putCloud(db, { '2026-10': { F01: PROV(1, 99) } });
  assert.deepEqual((await cloudOf(db))['2026-10'].F01, FIN(101, 30));
  await db.close();
});

test('the trigger is built for the column type (text and json columns too) and stops on an unknown type without changing anything', async () => {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  for (const ty of ['text', 'json']) {
    const db = new PGlite();
    await db.exec(`create table public.app_settings(key text primary key, value ${ty}, category text)`);
    await db.exec(MIG);
    await db.query("insert into app_settings(key,value) values('pl_public',$1)", [JSON.stringify({ '2026-10': { F01: FIN(100, 1) } })]);
    await db.query("update app_settings set value=$1 where key='pl_public'", [JSON.stringify({ '2026-10': { F01: PROV(9, 9), F02: PROV(3, 9) } })]);
    const v = JSON.parse((await db.query("select value::text as v from app_settings where key='pl_public'")).rows[0].v);
    assert.deepEqual(v, { '2026-10': { F01: FIN(100, 1), F02: PROV(3, 9) } }, ty);
    // 読めない文字（text の列）は書いた値のまま（止めない）
    if (ty === 'text') { await db.query("update app_settings set value='not json' where key='pl_public'"); assert.equal((await db.query("select value from app_settings where key='pl_public'")).rows[0].value, 'not json'); }
    await db.close();
  }
  const db = new PGlite();
  await db.exec('create table public.app_settings(key text primary key, value integer, category text)');
  await assert.rejects(db.exec(MIG), /STOP/);
  assert.equal((await db.query("select count(*)::int as n from pg_proc where proname like 'fp_pl_%'")).rows[0].n, 0, 'nothing created');
  await db.close();
  const db2 = new PGlite();
  await assert.rejects(db2.exec(MIG), /STOP: app_settings/);
  await db2.close();
});

// ---------- 3. 2 台の端末（本物の opMergePush・pullSettingKey・plImportSave） ----------
test('two devices with stale copies: the late provisional push keeps the cloud final, and the stale device ends up with the final (pullBack)', async () => {
  const db = await cloudDb();
  const A = device(db, { S: { pl_public: JSON.stringify({ _at: 1, '2026-10': { F06: PROV(90, 1) } }) } });
  const B = device(db, { S: { pl_public: JSON.stringify({ _at: 1, '2026-10': { F06: PROV(90, 1) } }) } });
  await putCloud(db, { _at: 1, '2026-10': { F06: PROV(90, 1) } });
  // A が確定版を入れる
  assert.equal(await save(A, { _at: 50, '2026-10': { F06: FIN(100, 50) } }), true);
  // B はまだ古い暫定の写しで、ほかの店（F01）を足して送る
  assert.equal(await save(B, { _at: 60, '2026-10': { F06: PROV(95, 60), F01: PROV(10, 60) } }), true);
  const cl = await cloudOf(db);
  assert.deepEqual(cl['2026-10'].F06, FIN(100, 50)); assert.deepEqual(cl['2026-10'].F01, PROV(10, 60));
  assert.deepEqual(local(B)['2026-10'].F06, FIN(100, 50), 'B now has the final too');
  await db.close();
});

test('simultaneous imports (B reads, A writes the final, then B writes): the database keeps the final, B pulls it back; without the trigger the final is lost', async () => {
  for (const trigger of [true, false]) {
    const db = await cloudDb({ trigger });
    await putCloud(db, { _at: 1, '2026-10': { F06: PROV(90, 1) } });
    const A = device(db, { S: { pl_public: JSON.stringify({ _at: 1, '2026-10': { F06: PROV(90, 1) } }) } });
    const B = device(db, { S: { pl_public: JSON.stringify({ _at: 1, '2026-10': { F06: PROV(90, 1) } }) } });
    const release = holdFirstGetAfter(B);
    const pB = save(B, { _at: 60, '2026-10': { F06: PROV(95, 60), F02: PROV(7, 60) } });
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(await save(A, { _at: 50, '2026-10': { F06: FIN(100, 50) } }), true);
    release();
    assert.equal(await pB, true);
    const cl = await cloudOf(db);
    assert.deepEqual(cl['2026-10'].F02, PROV(7, 60), 'B’s other store arrives');
    if (trigger) {
      assert.deepEqual(cl['2026-10'].F06, FIN(100, 50), 'final kept by the database');
      assert.deepEqual(local(B)['2026-10'].F06, FIN(100, 50), 'B took the final back');
      assert.deepEqual(local(A)['2026-10'].F06, FIN(100, 50));
    } else {
      assert.deepEqual(cl['2026-10'].F06, PROV(95, 60), 'without the database trigger this order loses the final (why the trigger is needed)');
    }
    await db.close();
  }
});

test('an old app (v1173 merge by month, local wins) re-sends its stale provisional month: the trigger keeps the final and the other store', async () => {
  const db = await cloudDb();
  await putCloud(db, { _at: 50, '2026-10': { F06: FIN(100, 50), F01: FIN(20, 50) } });
  const stale = { _at: 5, '2026-10': { F06: PROV(90, 5) } };
  const oldMerged = plain(run(P, `mergeMapByKey(${JSON.stringify(await cloudOf(db))}, ${JSON.stringify(stale)})`));
  assert.deepEqual(oldMerged['2026-10'], { F06: PROV(90, 5) }, 'the old app writes the whole month from its copy');
  await putCloud(db, oldMerged);
  assert.deepEqual((await cloudOf(db))['2026-10'], { F06: FIN(100, 50), F01: FIN(20, 50) });
  await db.close();
});

test('re-send of an unsent provisional after another device saved the final: the final stays, the device local becomes final', async () => {
  const db = await cloudDb();
  const C = device(db, { S: { pl_public: JSON.stringify({ _at: 5, '2026-10': { F06: PROV(90, 5) } }) } });
  C.failRead = true;
  assert.equal(await save(C, { _at: 5, '2026-10': { F06: PROV(95, 70) } }), false, 'strict: cannot read the cloud -> not sent (stays unsent)');
  assert.equal(await cloudOf(db), undefined);
  await putCloud(db, { _at: 50, '2026-10': { F06: FIN(100, 50) } });   // ほかの端末が確定
  C.failRead = false;
  assert.equal(await resend(C), true);
  assert.deepEqual((await cloudOf(db))['2026-10'].F06, FIN(100, 50));
  assert.deepEqual(local(C)['2026-10'].F06, FIN(100, 50));
  await db.close();
});

test('reload / pull: a device with a stale provisional copy takes the cloud final; a device-only month and store stay', async () => {
  const db = await cloudDb();
  await putCloud(db, { _at: 50, '2026-10': { F06: FIN(100, 50) } });
  const C = device(db, { S: { pl_public: JSON.stringify({ _at: 5, '2026-10': { F06: PROV(90, 5), F01: PROV(1, 5) }, '2026-11': { F06: PROV(3, 5) } }) } });
  assert.equal(await run(C, `pullSettingKey('pl_public')`), true);
  assert.deepEqual(local(C), { _at: 50, '2026-10': { F06: FIN(100, 50), F01: PROV(1, 5) }, '2026-11': { F06: PROV(3, 5) } });
  await db.close();
});

test('import save: reads the cloud first, merges it, keeps the final, adds the new months, stamps a later time than any known', async () => {
  const db = await cloudDb();
  await putCloud(db, { _at: 9e12, '2026-10': { F06: FIN(100, 9e12), F01: FIN(50, 9e12 + 5) } });   // ほかの端末の時計が進んでいた
  const B = device(db, { S: { pl_public: JSON.stringify({ _at: 1, '2026-09': { F06: FIN(70, 1) } }) } });
  const cp = await run(B, `_plReadCloudPub()`);
  const r = imp([{ ym: '2026-10', s: 'F06', sales: 95, prov: true }, { ym: '2026-10', s: 'F01', sales: 60, prov: true }, { ym: '2026-11', s: 'F06', sales: 8, prov: true }]);
  run(B, `_plImport = ${JSON.stringify(r)}; _plImport.cloudState='ok'; _plImport.cloudPub=${JSON.stringify(cp.value)}; plImportSave();`);
  const l = local(B);
  assert.deepEqual(l['2026-10'].F06, FIN(100, 9e12), 'final not replaced');
  assert.deepEqual(l['2026-10'].F01, FIN(50, 9e12 + 5), 'final not replaced');
  assert.deepEqual(l['2026-09'].F06, FIN(70, 1), 'device month kept');
  assert.equal(l['2026-11'].F06.prov, 1); assert.equal(l['2026-11'].F06.sales, 8);
  assert.ok(l._at > 9e12, 'top time later than the cloud one');
  assert.match(B.toasts.at(-1)[0], /確定済みの 2 件は暫定で上書きしていません/);
  // 同じ種類の取り込み直しは、時計が遅れていても新しい取り込みが勝つ
  await putCloud(db, l);
  const r2 = imp([{ ym: '2026-11', s: 'F06', sales: 9, prov: true }]);
  const cp2 = await run(B, `_plReadCloudPub()`);
  run(B, `_plImport = ${JSON.stringify(r2)}; _plImport.cloudState='ok'; _plImport.cloudPub=${JSON.stringify(cp2.value)}; plImportSave();`);
  assert.equal(local(B)['2026-11'].F06.sales, 9);
  assert.ok(local(B)['2026-11'].F06._at > l['2026-11'].F06._at);
  await db.close();
});

test('import preview when the cloud cannot be read: a note, still importable, and the push later keeps the cloud final', async () => {
  const db = await cloudDb();
  await putCloud(db, { _at: 50, '2026-10': { F06: FIN(100, 50) } });
  const B = device(db, { S: { pl_public: JSON.stringify({ _at: 5, '2026-10': { F06: PROV(90, 5) } }) } });
  B.failRead = true;
  const cp = await run(B, `_plReadCloudPub()`);
  assert.deepEqual(plain(cp), { state: 'fail', value: null });
  const r = imp([{ ym: '2026-10', s: 'F06', sales: 95, prov: true }]);
  run(B, `_plImport = ${JSON.stringify(r)}; _plImport.cloudState='fail'; _plImport.cloudPub=null;`);
  const html = run(B, `_plPreviewHtml(_plImport)`);
  assert.match(html, /クラウドを読めませんでした/); assert.match(html, /plImportSave\(\)/);
  run(B, `plImportSave()`);
  assert.equal(local(B)['2026-10'].F06.prov, 1);
  B.failRead = false;
  assert.equal(await resend(B), true);
  assert.deepEqual((await cloudOf(db))['2026-10'].F06, FIN(100, 50));
  assert.deepEqual(local(B)['2026-10'].F06, FIN(100, 50));
  // 行が無い（だれも取り込んでいない）
  const db2 = await cloudDb(); const D = device(db2);
  assert.deepEqual(plain(await run(D, `_plReadCloudPub()`)), { state: 'none', value: null });
  await db.close(); await db2.close();
});

test('picking a file reads the cloud before showing the preview (no import button until then); a newer pick wins', async () => {
  const db = await cloudDb();
  await putCloud(db, { _at: 50, '2026-10': { F06: FIN(100, 50) } });
  const B = device(db, { S: { pl_public: JSON.stringify({ _at: 5, '2026-10': { F06: PROV(90, 5) } }) } });
  const box = { innerHTML: '' };
  B.document = { getElementById: id => (id === 'pl-preview' ? box : null) };
  B.XLSX = { read: () => ({}) };
  B.__parsed = [imp([{ ym: '2026-10', s: 'F06', sales: 95, prov: true }])];
  B.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(1); setImmediate(() => this.onload()); } };
  run(B, `function _plLoadXlsx(){ return Promise.resolve(); } function parsePLWorkbook(){ return JSON.parse(JSON.stringify(__parsed.shift())); }`);
  const release = holdFirstGetAfter(B);
  run(B, `plFilePicked({ files: [{ name: 'PL Oct26 暫定.xlsx' }] })`);
  for (let i = 0; i < 20; i++) await tick();
  assert.match(box.innerHTML, /クラウドの最新を確かめています/); assert.doesNotMatch(box.innerHTML, /plImportSave/);
  release();
  for (let i = 0; i < 40 && !/確定済み/.test(box.innerHTML); i++) await tick();
  assert.match(box.innerHTML, /確定済みの月は暫定で上書きしません/);
  assert.equal(run(B, `_plImport.cloudState`), 'ok');
  assert.deepEqual(plain(run(B, `_plImport.cloudPub`))['2026-10'].F06, FIN(100, 50));
  // 読んでいるあいだにほかのファイルを選び直した：前の読み込みの答えは使わない
  B.__parsed = [imp([{ ym: '2026-10', s: 'F01', sales: 1, prov: true }]), imp([{ ym: '2026-11', s: 'F01', sales: 2, prov: true }])];
  const rel2 = holdFirstGetAfter(B);
  run(B, `plFilePicked({ files: [{ name: 'a.xlsx' }] })`);
  for (let i = 0; i < 20; i++) await tick();
  B.hold = null;
  run(B, `plFilePicked({ files: [{ name: 'b.xlsx' }] })`);
  for (let i = 0; i < 40 && !/取り込みます/.test(box.innerHTML); i++) await tick();
  const second = box.innerHTML;
  rel2(); for (let i = 0; i < 20; i++) await tick();
  assert.equal(box.innerHTML, second, 'the late answer for the first file does not repaint');
  assert.equal(run(B, `_plImport.rows[0].ym`), '2026-11');
  await db.close();
});

// ---------- 4. 入れる一式 ----------
test('the deploy folder carries the same SQL (byte for byte) and the steps mention the order and the check', () => {
  const dir = new URL('../deploy/pl-keep-final-v1174/', import.meta.url);
  assert.equal(fs.readFileSync(new URL('1_追加のSQL.sql', dir), 'utf8'), MIG);
  const steps = fs.readFileSync(new URL('手順.md', dir), 'utf8');
  assert.match(steps, /1_追加のSQL\.sql/); assert.match(steps, /2_確かめ_読むだけ\.sql/); assert.match(steps, /戻す\.sql/);
  const chk = fs.readFileSync(new URL('2_確かめ_読むだけ.sql', dir), 'utf8');
  assert.doesNotMatch(chk.replace(/--[^\n]*/g, ''), /\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i, 'the check only reads');
});

test('Codex #173 (6903935612-4): the check runs before and after the SQL; before = NG rows (no error), after = all setup rows OK, data rows count finals', async () => {
  const chk = fs.readFileSync(new URL('../deploy/pl-keep-final-v1174/2_確かめ_読むだけ.sql', import.meta.url), 'utf8');
  const rows = async db => (await db.query(chk)).rows;
  // 1 の前
  const db = await cloudDb({ trigger: false, roles: true });
  await putCloud(db, { _at: 1, '2026-10': { F01: FIN(100, 1), F02: PROV(5, 1) } });
  let r = await rows(db);
  const setup = x => x.filter(y => y.part === 'setup');
  assert.equal(setup(r).length, 5);
  assert.equal(setup(r).find(y => y.item === 'value column type').ok, 'OK');
  assert.deepEqual(setup(r).filter(y => y.item !== 'value column type').map(y => y.ok), ['NG', 'NG', 'NG', 'NG']);
  assert.equal(setup(r).find(y => y.item === 'join keeps the final and both new stores').result, '関数なし');
  // 1 のあと
  await db.exec(MIG);
  r = await rows(db);
  assert.deepEqual(setup(r).map(y => y.ok), ['OK', 'OK', 'OK', 'OK', 'OK']);
  const d = r.filter(y => y.part === 'data');
  assert.deepEqual(d.map(y => [y.item, y.result]), [['2026-10', '1 確定 / 2 店']]);
  assert.doesNotMatch(JSON.stringify(d), /100|\$/, 'the data rows show counts only (no amounts)');
  await db.close();
});
