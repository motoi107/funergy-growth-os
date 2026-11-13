// v1150（Codex #144 6838246707）：マスターの表の「変えた行・欄の覚え」（_mr_touched_v1）を localStorage に書けない（いっぱい）まま
// 閉じて開き直しても、送れていない変更を「送るものが無い＝送れた」にしない。
// 本物の保存の層（_idbBoot・_idbQueue・_lsWriteVerified・v1138 の写しの記録 _lsj:）を fake-indexeddb の上で、
// 本物の lsSet・_pushWithOutbox・送信待ち（op_outbox）・syncMasterToSupabase・v1150 の関数（mrOnEdit・mrPush・mrApplyPulled）と一緒に動かす。
// クラウドは PGlite（主キーと data jsonb の表）。1 つの device ＝ 1 台の端末（localStorage と IndexedDB）、1 つの vm ＝ 1 回の起動。
// 合成データだけ。本番にはつながない。FUNERGY_INDEX に前の版の index.html を渡すと落ちる（前は開き直すと何も送らずに「送れた」にした）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HAS_MR = /^async function mrPush\(/m.test(SRC);
const { IDBFactory, IDBKeyRange } = await import('./runtime/node_modules/fake-indexeddb/build/esm/index.js');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) return '';
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
const varLine = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); return m ? m[0] : ''; };
function varBlock(name) {
  const m = new RegExp('^var ' + name + '\\s*=\\s*\\{', 'm').exec(SRC); assert.ok(m, name);
  let i = SRC.indexOf('{', m.index), d = 0, j = i;
  for (; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '{') d++; else if (ch === '}') { d--; if (!d) break; } }
  return 'var ' + name + ' = ' + SRC.slice(i, j + 1) + ';';
}
const slimBlock = (() => { const a = SRC.indexOf('var LS_SLIM_KEEP'), b = SRC.indexOf('\nfunction _lsWriteVerified('); assert.ok(a > 0 && b > a, 'v1138 block'); return SRC.slice(a, b); })();

/* 保存の層（v1138・v1149 の試験と同じもの）＋ 送信待ちと送る順（本物）＋ lsSet（本物）＋ v1150 のマスターの関数（本物） */
const STORE_VARS = ['IDB_NAME', '_idbDB', '_idbState', '_IDB_MEM', '_idbQ', '_idbTimer', '_idbStat', '_idbInflight', '_IDB_WATCH', '_idbGen', '_idbReopening', 'LS_DEVICE_LOCAL'];
const STORE_FNS = ['_idbAvailable', '_idbOpen', '_idbLoadAll', '_idbWatched', '_idbTrack', '_idbWriteBatch', '_idbFlush', '_idbFlushP', '_idbReopen',
  '_idbStale', '_idbRequeue', '_idbQueue', '_idbBackfill', '_idbBoot', 'lsIsDeviceLocal', '_lsStoreGet', '_lsRawStr', '_lsRawDel', '_lsWriteVerified'];
const PUSH_FNS = ['_cjson', '_outboxGet', '_outboxSet', '_outboxAdd', '_outboxRemove', '_pushWithOutbox', '_pushQOf', '_pushBusy', '_pushRun', '_smallGet', '_smallSet', 'lsSet', 'syncMasterToSupabase'];
const MR_FNS = ['mrIsKey', 'mrDef', 'mrPkOf', 'mrTomb', '_mrJsonGet', '_mrJsonPut', 'mrTouchedAll', 'mrTouchedOf', '_mrOvpDone', '_mrTouchedPut', 'mrUnkHas', 'mrUnkMark', 'mrUnkClear',
  'mrPending', 'mrHasUnsent', 'mrInitLegacy', 'mrFieldEq', 'mrRowEq', 'mrIndex', 'mrOnEdit', '_mrStrip', 'mrOverlay', '_mrQuote', 'mrFetchRows', '_mrLog', 'mrTok',
  'mrCasWrite', 'mrBulkWrite', 'mrPool', 'mrSameVer', 'mrSameData', 'mrPush', 'mrApplyPulled'];
const MR_VARS = ['MR_KEYS', 'MR_TOUCH_KEY', 'MR_TOUCH_OVF', 'MR_OVP_KEY', 'MR_UNK_KEY', 'MR_INIT_KEY', 'MR_DEL_F', 'MR_BULK', '_pushQ', '_lsPushP'];
const CODE = [...STORE_VARS.map(varLine).filter(Boolean), ...STORE_FNS.map(fnSrc), slimBlock, varBlock('SUPA_MASTER_MAP'),
  ...MR_VARS.map(varLine).filter(Boolean), ...PUSH_FNS.map(fnSrc), ...MR_FNS.map(fnSrc)].join('\n') + `
  function _lskBump(){} var _lsEscalatedAt=0; function _lsFreeOldLaborKeys(){}
  function _lsNoteSaveFailure(){} function _lsClearSaveFailure(){}
  function lsKeys(p){ p=p||""; var s=new Set(); for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(p)===0) s.add(k);} if(_idbState==="ready"&&_IDB_MEM) _IDB_MEM.forEach(function(v,k){ if(String(k).indexOf(p)===0) s.add(k); }); return Array.from(s); }
  function ls(k, d){ var s=_lsStoreGet(k); if(s==null) return d; try{ return JSON.parse(s); }catch(e){ return d; } }
  function _lsMarkFetched(){} function _lsPushBlocked(){ return false; }
  function _saveWho(){ return 'p:1'; }
  var _idbBootP = new Promise(function(res){ setTimeout(function(){ try{ Promise.resolve(_idbBoot()).then(res, res); }catch(e){ res(); } }, 0); });`;

const PK = { ingredients: 'code', stores: 'id', recipes: 'id', categories: 'code' };
async function cloudDb() {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table ingredients(code text primary key, data jsonb); create table stores(id text primary key, data jsonb); create table recipes(id text primary key, data jsonb); create table categories(code text primary key, data jsonb);');
  return db;
}
const rowsOf = async (db, t) => (await db.query(`select data::text as d from ${t} order by ${PK[t]}`)).rows.map(r => JSON.parse(r.d));
const rowOf = async (db, t, pk) => { const r = await db.query(`select data::text as d from ${t} where ${PK[t]}=$1`, [String(pk)]); return r.rows.length ? JSON.parse(r.rows[0].d) : undefined; };
async function seedCloud(db, t, rows) { for (const r of rows) await db.query(`insert into ${t}(${PK[t]}, data) values($1,$2)`, [String(r[PK[t]]), JSON.stringify(r)]); }

/* localStorage の代わり。refuse に入れたキーだけ書けない（いっぱい） */
function lsObject(map, refuse) {
  return { getItem: k => (map.has(k) ? map.get(k) : null), removeItem: k => { map.delete(k); }, key: i => [...map.keys()][i] ?? null, get length() { return map.size; },
    setItem: (k, v) => { if (refuse.includes(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); } };
}
const device = (refuse = []) => ({ ls: new Map(), factory: new IDBFactory(), refuse });
/* 1 回の起動（vm）。作った直後は IndexedDB を読み終える前（_idbState='init'）。ready() で読み終えるのを待つ */
function open(dev, db, { offline = false } = {}) {
  const writes = [], logs = [];
  const c = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval: () => 0, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array,
    navigator: {}, IDBKeyRange, localStorage: lsObject(dev.ls, dev.refuse), indexedDB: dev.factory, AbortController, writes, logs,
    SUPABASE_URL: 'https://cloud.invalid', supaHeaders: () => ({}), FUNERGY_STATUS: { log: (_k, m) => logs.push(m) }, t: ja => ja,
    _supaBooting: false, SUPA_SYNC_ENABLED: true, _opLastPushErr: {}, _SPLIT_KEYS: {}, offline, myName: () => 'E',
    empPushDirty: async () => true, vendorPushDirty: async () => true, refreshStores() {},
    supaUpsert: async (t, rows) => {
      if (c.offline) return false;
      for (const r of rows) await db.query(`insert into ${t}(${PK[t]}, data) values($1,$2) on conflict(${PK[t]}) do update set data=excluded.data`, [String(r[PK[t]]), JSON.stringify(r.data)]);
      writes.push(...rows.map(r => String(r[PK[t]])));
      return true;
    },
    supaFetchAll: async (t, select) => {
      if (c.offline) return null;
      return (await db.query(`select ${PK[t]} as pk, data::text as d from ${t} order by ${PK[t]}`)).rows.map(r => ({ [PK[t]]: r.pk, data: JSON.parse(r.d) }));
    },
    fetch: async (url, opt = {}) => {
      if (c.offline) throw new Error('offline');
      const method = String(opt.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        const u = new URL(url), t = u.pathname.split('/').pop(), pkName = PK[t], row = JSON.parse(opt.body), pk = String(row[pkName]);
        if (method === 'POST') {
          const r = await db.query(`insert into ${t}(${pkName}, data) values($1,$2) on conflict(${pkName}) do nothing returning ${pkName} as pk`, [pk, JSON.stringify(row.data)]);
          if (!r.rows.length) return { ok: false, status: 409, json: async () => ({ code: '23505' }), text: async () => 'duplicate key' };
          writes.push(pk);
          return { ok: true, status: 201, json: async () => r.rows.map(x => ({ [pkName]: x.pk })) };
        }
        const vf = u.searchParams.get('data->>_mrv'), params = [u.searchParams.get(pkName).slice(3), JSON.stringify(row.data)];
        let cond = "data->>'_mrv' is null";
        if (vf !== 'is.null') { cond = "data->>'_mrv' = $3"; params.push(vf.slice(3)); }
        const r = await db.query(`update ${t} set data=$2 where ${pkName}=$1 and ${cond} returning ${pkName} as pk`, params);
        if (r.rows.length) writes.push(pk);
        return { ok: true, status: 200, json: async () => r.rows.map(x => ({ [pkName]: x.pk })) };
      }
      const m = /\/rest\/v1\/(\w+)\?select=(\w+),data&\w+=in\.\(([^)]*)\)/.exec(decodeURIComponent(url));
      assert.ok(m, 'unexpected request ' + url);
      const list = []; const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g; let x;
      while ((x = re.exec(m[3]))) list.push(x[1] !== undefined ? x[1].replace(/\\(.)/g, '$1') : x[2]);
      const r = await db.query(`select ${m[2]} as pk, data::text as d from ${m[1]} where ${m[2]} = any($1)`, [list]);
      return { ok: true, status: 200, json: async () => r.rows.map(y => ({ [m[2]]: y.pk, data: JSON.parse(y.d) })) };
    },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(CODE, c);
  return c;
}
const ready = async c => { await c._idbBootP; return c._idbState; };
/* IndexedDB への書き出しを待つ */
const flush = async c => { const r = await vm.runInContext('_idbFlushP()', c); await new Promise(res => setTimeout(res, 0)); return r; };
/* 閉じる（書き出しを待たない）：IndexedDB への書き出しの残りを捨てる。localStorage の写し（_lsj:）は残る */
function crash(c) { try { clearTimeout(c._idbTimer); } catch (e) { } c._idbTimer = null; c._idbQ = new Map(); try { c._idbDB.close(); } catch (e) { } c._idbDB = null; }
/* IndexedDB への書き出しが入り終えない（遅い端末で閉じる前）：すぐ書き出しても入らない */
function slowIdb(c) { vm.runInContext('_idbFlushP = function(){ return Promise.resolve(false); };', c); }
async function save(c, key, val) {
  vm.runInContext(`lsSet(${JSON.stringify(key)}, ${JSON.stringify(val)})`, c);
  return vm.runInContext(`Promise.resolve(_lsPushP[${JSON.stringify(key)}])`, c);
}
const local = (c, k) => JSON.parse(c._lsStoreGet(k));
const outbox = c => vm.runInContext('_outboxGet()', c).map(x => x.key);
const touched = (c, k) => JSON.parse(vm.runInContext(`JSON.stringify(mrTouchedOf(${JSON.stringify(k)}))`, c));
/* 前の起動で受け取ってある（IndexedDB に入っている）ことにする */
async function seed(dev, rows) {
  await new Promise(res => {
    const rq = dev.factory.open('funergy_os_kv', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { const d = rq.result, tx = d.transaction('kv', 'readwrite'); for (const [k, v] of Object.entries(rows)) tx.objectStore('kv').put(JSON.stringify(v), k); tx.oncomplete = () => { d.close(); res(); }; };
  });
}
/* 取り込み（本物の mrApplyPulled で、クラウドの表に送っていない変更を重ねる。呼ぶ側は supaPullAllMasters と同じ） */
async function pull(c, db, key, table) {
  const arr = (await rowsOf(db, table));
  const o = vm.runInContext(`mrApplyPulled(${JSON.stringify(key)}, ${JSON.stringify(arr)})`, c);
  assert.ok(o && !o.keep, 'pulled');
  if (vm.runInContext(`_lsWriteVerified(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(o.value))})`, c)) o.commit();
}
const ING = [
  { code: 1001, name: 'Salmon', unit: 'kg', price: 20 },
  { code: 1002, name: 'Tuna', unit: 'kg', price: 30 },
  { code: 1003, name: 'Rice', unit: 'kg', price: 2 },
];

test('restart (real storage layer): localStorage cannot take the change record, so it goes to IndexedDB; after reopening the price change and the deletion are still sent (before: nothing was sent, “sent” was reported and the next pull put them back — Codex #144 6838246707)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  /* 1 回目：通信が無い。値段を変え、1 行消す */
  const a = open(dev, db, { offline: true });
  assert.equal(await ready(a), 'ready');
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  assert.equal(await save(a, 'm_ingredients', v.filter(r => r.code !== 1003)), false);
  assert.deepEqual(outbox(a), ['m_ingredients']);
  assert.equal(dev.ls.has('_mr_touched_v1'), false, 'localStorage could not take the record');
  await flush(a);
  crash(a);
  /* 開き直す（localStorage はまだいっぱい）。覚えは IndexedDB の別の名前から読む */
  const b = open(dev, db);
  assert.equal(await ready(b), 'ready');
  assert.deepEqual(touched(b, 'm_ingredients'), { 1001: { f: { price: 1 }, n: 1 }, 1003: { d: 1, n: 1 } }, 'the record survived the restart');
  assert.equal(local(b, 'm_ingredients')[0].price, 99, 'the device table survived (v1138)');
  /* 同じ値をもう一度保存する（Codex の手順） */
  assert.equal(await save(b, 'm_ingredients', local(b, 'm_ingredients')), true);
  assert.equal((await rowOf(db, 'ingredients', 1001)).price, 99, 'the price change reached the cloud');
  assert.equal((await rowOf(db, 'ingredients', 1003))._deleted, true, 'the deletion reached the cloud');
  assert.deepEqual(b.writes.sort(), ['1001', '1003'], 'only the changed rows');
  assert.deepEqual(outbox(b), []);
  assert.deepEqual(touched(b, 'm_ingredients'), {}, 'nothing left');
  await pull(b, db, 'm_ingredients', 'ingredients');
  assert.deepEqual(local(b, 'm_ingredients').map(r => [r.code, r.price]), [[1001, 99], [1002, 30]], 'the next pull keeps them');
  await db.close();
});

test('restart (real storage layer): closed before even IndexedDB took the record: the queued table is checked against the cloud by version and the price change is sent; a deletion recorded only in memory cannot be known (it comes back — documented limit)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  const a = open(dev, db, { offline: true });
  await ready(a);
  slowIdb(a);   /* 覚えを積んだあとの書き出しが入り終えない（遅い端末）。そのまま閉じる */
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  assert.equal(await save(a, 'm_ingredients', v.filter(r => r.code !== 1003)), false);
  assert.ok(JSON.parse(dev.ls.get('_mr_ovp_v1'))._s >= 1, 'the mark says a record is waiting for IndexedDB');
  crash(a);   /* IndexedDB への書き出し（300ms 後）を待たない */
  const b = open(dev, db);
  await ready(b);
  assert.deepEqual(touched(b, 'm_ingredients'), {}, 'the record is lost');
  assert.deepEqual(outbox(b), ['m_ingredients'], 'but the queue is on the device');
  assert.equal(await save(b, 'm_ingredients', local(b, 'm_ingredients')), true);
  assert.equal((await rowOf(db, 'ingredients', 1001)).price, 99, 'the price change reached the cloud (the queue without a record marks the table as unconfirmed)');
  assert.deepEqual(b.writes, ['1001'], 'checked by version: only the changed row');
  assert.equal((await rowOf(db, 'ingredients', 1003))._deleted, undefined, 'limit: a deletion that was never recorded on the device is not known');
  await db.close();
});

test('restart (real storage layer): once localStorage has room again, the newer record there wins over an older one left in IndexedDB (the write count decides, not which store)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  /* 1 回目：localStorage がいっぱい → 覚えは IndexedDB へ */
  const a = open(dev, db, { offline: true });
  await ready(a);
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  await save(a, 'm_ingredients', v);
  await flush(a);
  crash(a);
  /* 2 回目：localStorage に空きができた。もう 1 つ変える（覚えは localStorage へ。IndexedDB の古い覚えを消す前に閉じる） */
  dev.refuse = [];
  const b = open(dev, db, { offline: true });
  await ready(b);
  const w = local(b, 'm_ingredients'); w[1].price = 33;
  await save(b, 'm_ingredients', w);
  assert.ok(dev.ls.has('_mr_touched_v1'));
  crash(b);
  /* 3 回目：両方に覚えが残っている。新しい（回の多い）ほうを使う */
  const c = open(dev, db);
  await ready(c);
  assert.deepEqual(Object.keys(touched(c, 'm_ingredients')).sort(), ['1001', '1002'], 'the newer record (in localStorage) is used');
  assert.equal(await save(c, 'm_ingredients', local(c, 'm_ingredients')), true);
  assert.deepEqual((await rowsOf(db, 'ingredients')).map(r => r.price), [99, 33, 2], 'both changes reached the cloud');
  await db.close();
});

test('restart (real storage layer): an older non-empty record is on the device, a second edit is made and the app closes before IndexedDB takes the new record: both changes are sent and the next pull keeps them (before: only the first row was sent, the second was reported as sent and the pull put it back — Codex #144 6840900703)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  const a = open(dev, db, { offline: true });
  assert.equal(await ready(a), 'ready');
  /* 1 つ目：覚えは IndexedDB の別の名前に入り終える */
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  assert.equal(await save(a, 'm_ingredients', v), false);
  await flush(a);
  assert.equal(dev.ls.has('_mr_ovp_v1'), false, 'the record reached IndexedDB: no mark');
  /* 2 つ目：覚えを積んだが入り終える前に閉じる（端末の表は localStorage の写しで残る） */
  slowIdb(a);
  const w = local(a, 'm_ingredients'); w[1].price = 88;
  assert.equal(await save(a, 'm_ingredients', w), false);
  assert.ok(JSON.parse(dev.ls.get('_mr_ovp_v1'))._s >= 3, 'the mark is newer than the record that reached IndexedDB');
  crash(a);
  const b = open(dev, db);
  assert.equal(await ready(b), 'ready');
  assert.deepEqual(local(b, 'm_ingredients').map(r => r.price), [99, 88, 2], 'the device table has both changes');
  assert.deepEqual(Object.keys(touched(b, 'm_ingredients')), ['1001'], 'the record on the device is the older one');
  assert.deepEqual(outbox(b), ['m_ingredients']);
  assert.equal(await save(b, 'm_ingredients', local(b, 'm_ingredients')), true);
  assert.deepEqual(b.writes.sort(), ['1001', '1002'], 'both rows are sent (1002 is checked by version)');
  assert.deepEqual((await rowsOf(db, 'ingredients')).map(r => r.price), [99, 88, 2]);
  assert.deepEqual(outbox(b), []);
  await flush(b);   /* 覚え（まだ localStorage はいっぱい）が IndexedDB に入り終える */
  assert.equal(dev.ls.has('_mr_ovp_v1'), false, 'mark cleared');
  assert.equal(JSON.parse(dev.ls.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'unconfirmed mark cleared after the check');
  await pull(b, db, 'm_ingredients', 'ingredients');
  assert.deepEqual(local(b, 'm_ingredients').map(r => r.price), [99, 88, 2], 'the next pull keeps 88');
  await db.close();
});

test('restart (real storage layer): the same steps, but the app waits until IndexedDB takes the record: the newer record is used and the mark is not needed', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  const a = open(dev, db, { offline: true });
  await ready(a);
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  await save(a, 'm_ingredients', v);
  await flush(a);
  const w = local(a, 'm_ingredients'); w[1].price = 88;
  await save(a, 'm_ingredients', w);
  await flush(a);
  assert.equal(dev.ls.has('_mr_ovp_v1'), false);
  crash(a);
  const b = open(dev, db);
  await ready(b);
  assert.deepEqual(Object.keys(touched(b, 'm_ingredients')).sort(), ['1001', '1002'], 'both rows are in the record');
  assert.equal(await save(b, 'm_ingredients', local(b, 'm_ingredients')), true);
  assert.deepEqual(b.writes.sort(), ['1001', '1002']);
  assert.equal(JSON.parse(dev.ls.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'no unconfirmed mark was needed');
  await db.close();
});

test('restart (real storage layer): the store table is pulled before IndexedDB is read while its change record is only in IndexedDB: the device table is kept, and the change is sent after IndexedDB is read (Claude routine 6840823792 P3-1)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  const ST = [{ id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' }];
  await seedCloud(db, 'stores', ST);
  const dev = device(['_mr_touched_v1']);
  dev.ls.set('m_stores', JSON.stringify(ST));   /* 店舗の表は localStorage にある（v1138） */
  const a = open(dev, db, { offline: true });
  await ready(a);
  const s1 = local(a, 'm_stores'); s1[1].name = 'Tenkichi Kaimuki';
  assert.equal(await save(a, 'm_stores', s1), false);
  await flush(a);
  crash(a);
  /* 開き直して、IndexedDB を読み終える前に店舗の表が届く */
  const b = open(dev, db);
  assert.equal(b._idbState, 'init');
  const o = vm.runInContext(`mrApplyPulled('m_stores', ${JSON.stringify(await rowsOf(db, 'stores'))})`, b);
  assert.equal(o && o.keep, true, 'kept: the record in IndexedDB cannot be read yet and the change is waiting');
  assert.equal(local(b, 'm_stores')[1].name, 'Tenkichi Kaimuki');
  await ready(b);
  assert.equal(await save(b, 'm_stores', local(b, 'm_stores')), true);
  assert.equal((await rowOf(db, 'stores', 'F02')).name, 'Tenkichi Kaimuki', 'the change reached the cloud');
  await db.close();
});

test('restart (real storage layer): the record reached IndexedDB but the app closed before the mark was taken off: the record is used as is (no unconfirmed check)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const dev = device(['_mr_touched_v1']);
  await seed(dev, { m_ingredients: ING });
  const a = open(dev, db, { offline: true });
  await ready(a);
  slowIdb(a);   /* すぐの書き出しは入らない（印は残る） */
  const v = local(a, 'm_ingredients'); v[0].price = 99;
  await save(a, 'm_ingredients', v);
  await vm.runInContext('(_idbFlush(), Promise.all(Array.from(_idbInflight)))', a);   /* ふだんの書き出し（300ms の）で覚えは入る */
  assert.ok(dev.ls.has('_mr_ovp_v1'), 'the mark is still there');
  crash(a);
  const b = open(dev, db);
  await ready(b);
  vm.runInContext('mrInitLegacy()', b);   /* 起動ごとの確かめ（ふだんは最初の保存・取り込みのとき） */
  assert.equal(JSON.parse(dev.ls.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'the same write count reached IndexedDB: no unconfirmed mark');
  assert.equal(dev.ls.has('_mr_ovp_v1'), false, 'the mark is taken off');
  assert.equal(await save(b, 'm_ingredients', local(b, 'm_ingredients')), true);
  assert.deepEqual(b.writes, ['1001']);
  await db.close();
});
