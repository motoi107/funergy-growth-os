// v1150（段階 2c の 2 つ目）：店舗・食材・レシピ・カテゴリーのマスター（表の行）は、この端末で変えた行の変えた欄だけを送り、
// 消した行はクラウドの行に「消した」の印を残す。取り込みはまだ送っていない変更を重ね、消した印の行は置かない。
// 本物の lsSet・_pushWithOutbox・送信待ち・syncMasterToSupabase・supaPullAllMasters・loginBootstrapPull と v1150 の関数を VM で動かす。
// クラウドは PGlite（主キーと data jsonb の表）。合成データだけ。本番にはつながない。
// FUNERGY_INDEX に前の版（v1149）の index.html を渡すと、場面の試験は落ちる（前は全部の行を書き直し、消した行が戻った）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HAS_MR = /^async function mrPush\(/m.test(SRC);

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
function varBlock(name, open = '{', close = '}') {
  const m = new RegExp('^var ' + name + '\\s*=\\s*\\' + open, 'm').exec(SRC); assert.ok(m, name);
  let i = SRC.indexOf(open, m.index), d = 0, j = i;
  for (; j < SRC.length; j++) { const ch = SRC[j]; if (ch === open) d++; else if (ch === close) { d--; if (!d) break; } }
  return 'var ' + name + ' = ' + SRC.slice(i, j + 1) + ';';
}

const FNS = ['_cjson', '_smallGet', '_smallSet', '_outboxGet', '_outboxSet', '_outboxAdd', '_outboxRemove', '_pushWithOutbox', '_pushQOf', '_pushBusy', '_pushRun',
  'lsSet', 'syncMasterToSupabase', '_stripTestRows', 'supaPullAllMasters', 'loginBootstrapPull', '_pullKeepLocal', '_pullPendingMap',
  'mrIsKey', 'mrDef', 'mrPkOf', 'mrTomb', '_mrJsonGet', '_mrJsonPut', 'mrTouchedAll', 'mrTouchedOf', '_mrOvpDone', '_mrTouchedPut', 'mrUnkHas', 'mrUnkMark', 'mrUnkClear',
  'mrPending', 'mrHasUnsent', 'mrInitLegacy', 'mrFieldEq', 'mrRowEq', 'mrIndex', 'mrOnEdit', '_mrStrip', 'mrOverlay', '_mrQuote', 'mrFetchRows', '_mrLog', 'mrTok', 'mrCasWrite', 'mrBulkWrite', 'mrPool', 'mrSameVer', 'mrSameData', 'mrPush', 'mrApplyPulled'];
const VARS = ['MR_KEYS', 'MR_TOUCH_KEY', 'MR_TOUCH_OVF', 'MR_OVP_KEY', 'MR_UNK_KEY', 'MR_INIT_KEY', 'MR_DEL_F', 'MR_BULK', 'LS_SLIM_KEEP', '_pushQ', '_lsPushP'];
const PK = { stores: 'id', ingredients: 'code', recipes: 'id', categories: 'code', employees: 'id', vendors: 'id' };
const KEY_OF = { m_stores: 'stores', m_ingredients: 'ingredients', m_recipes: 'recipes', m_categories: 'categories' };

async function cloudDb() {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec(`create table stores(id text primary key, data jsonb);
    create table ingredients(code text primary key, data jsonb);
    create table recipes(id text primary key, data jsonb);
    create table categories(code text primary key, data jsonb);
    create table employees(id text primary key, data jsonb);
    create table vendors(id text primary key, data jsonb);`);
  return db;
}
const rowsOf = async (db, table) => (await db.query(`select data::text as d from ${table} order by ${PK[table]}`)).rows.map(r => JSON.parse(r.d));
const rowOf = async (db, table, pk) => { const r = await db.query(`select data::text as d from ${table} where ${PK[table]}=$1`, [String(pk)]); return r.rows.length ? JSON.parse(r.rows[0].d) : undefined; };
async function seedCloud(db, table, rows) { for (const r of rows) await db.query(`insert into ${table}(${PK[table]}, data) values($1,$2) on conflict(${PK[table]}) do update set data=excluded.data`, [String(r[PK[table]] ?? r.id), JSON.stringify(r)]); }

function lsShim(map) {
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); },
    key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
/* 端末 1 台。S＝端末の保存（キー → 文字）。LS＝localStorage（送信待ち・小さな印）。
   hold(kind, table)：通信の答えを返す前に待つ（kind＝'read'・'write'） */
function device(db, { S = {}, LS = new Map(), name = 'Tester' } = {}) {
  const logs = [], writes = [];
  const c = {
    console: { log() {}, warn() {}, error() {} }, S, LSM: LS, localStorage: lsShim(LS), logs, writes, offline: false, hold: null,
    setTimeout, clearTimeout, AbortController, JSON, Math, Promise, Object, Array, String, Number, Date, Map, Set,
    SUPABASE_URL: 'https://cloud.invalid', supaHeaders: () => ({}), t: ja => ja, FUNERGY_STATUS: { log: (_k, m) => logs.push(m) },
    _supaBooting: false, SUPA_SYNC_ENABLED: true, _opLastPushErr: {}, _SPLIT_KEYS: {},
    _lsStoreGet: k => (k in S ? S[k] : null),
    _lsWriteVerified: (k, j) => { S[k] = j; return true; },
    ls: (k, d) => (k in S ? JSON.parse(S[k]) : d), _lsRaw: (k, d) => (k in S ? JSON.parse(S[k]) : d),
    _lsClearSaveFailure() {}, _lsNoteSaveFailure() {}, _lsFreeOldLaborKeys() {}, _lsEscalatedAt: 0, _lsPushBlocked: () => false,
    _saveWho: () => 'me', myName: () => name, _pendEditAtAll: () => ({}), _opMergeDef: () => null,
    refreshStores() {}, showSyncSplash() {}, hideSyncSplash() {}, refreshStaffPinsFromCloud: async () => {}, _loginRosterRefreshed() {},
    _empMergeCloud: a => a, vendorMergePulled: a => a, empPushDirty: async () => true, vendorPushDirty: async () => true,
    _kvPullRows: async () => [], _applyKvRows: () => 0, _kvSeenRecord() {},
    document: { getElementById: () => null }, getComputedStyle: () => ({ display: 'none' }),
    supaUpsert: async (t, rows) => {
      if (c.offline) return false;
      if (c.hold) await c.hold('write', t);
      writes.push({ table: t, pks: Array.from(rows, r => String(r[PK[t]])), method: 'UPSERT' });
      for (const r of rows) await db.query(`insert into ${t}(${PK[t]}, data) values($1,$2) on conflict(${PK[t]}) do update set data=excluded.data`, [String(r[PK[t]]), JSON.stringify(r.data)]);
      return true;
    },
    supaFetchAll: async (t) => {
      if (c.offline) return null;
      if (t === 'app_settings' || t === 'app_state') return [];
      return (await rowsOf(db, t)).map(d => ({ data: d }));
    },
    fetch: async (url, opt = {}) => {
      if (c.offline) throw new Error('offline');
      const method = String(opt.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        /* 条件つきの書き込み：PATCH は「主キー＝番号」かつ「data の _mrv が読んだ版（無ければ is.null）」の行だけ。POST は足すだけ（あれば 409） */
        const u = new URL(url), t = u.pathname.split('/').pop(), pkName = PK[t];
        if (c.hold) await c.hold('write', t);
        const row = JSON.parse(opt.body), pk = String(row[pkName]);
        const done = ok => { writes.push({ table: t, pks: [pk], method, ok }); };
        if (method === 'POST') {
          assert.equal(u.searchParams.get('on_conflict'), null, 'a new row is inserted, not upserted');
          const r = await db.query(`insert into ${t}(${pkName}, data) values($1,$2) on conflict(${pkName}) do nothing returning ${pkName} as pk`, [pk, JSON.stringify(row.data)]);
          done(r.rows.length > 0);
          if (!r.rows.length) return { ok: false, status: 409, json: async () => ({ code: '23505' }), text: async () => 'duplicate key' };
          return { ok: true, status: 201, json: async () => r.rows.map(x => ({ [pkName]: x.pk })) };
        }
        assert.equal(method, 'PATCH');
        const eq = u.searchParams.get(pkName), vf = u.searchParams.get('data->>_mrv');
        assert.ok(eq && eq.startsWith('eq.'), 'PATCH is limited to one row'); assert.ok(vf === 'is.null' || (vf && vf.startsWith('eq.')), 'PATCH checks the version');
        const params = [eq.slice(3), JSON.stringify(row.data)];
        let cond = "data->>'_mrv' is null";
        if (vf !== 'is.null') { cond = "data->>'_mrv' = $3"; params.push(vf.slice(3)); }
        const r = await db.query(`update ${t} set data=$2 where ${pkName}=$1 and ${cond} returning ${pkName} as pk`, params);
        done(r.rows.length > 0);
        return { ok: true, status: 200, json: async () => r.rows.map(x => ({ [pkName]: x.pk })) };
      }
      const m = /\/rest\/v1\/(\w+)\?select=(\w+),data&\w+=in\.\(([^)]*)\)/.exec(decodeURIComponent(url));
      assert.ok(m, 'unexpected request ' + url);
      if (c.hold) await c.hold('read', m[1]);
      const list = []; const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g; let x;
      while ((x = re.exec(m[3]))) list.push(x[1] !== undefined ? x[1].replace(/\\(.)/g, '$1') : x[2]);
      const r = await db.query(`select ${m[2]} as pk, data::text as d from ${m[1]} where ${m[2]} = any($1)`, [list]);
      return { ok: true, status: 200, json: async () => r.rows.map(y => ({ [m[2]]: y.pk, data: JSON.parse(y.d) })) };
    },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext([varBlock('SUPA_MASTER_MAP'), ...VARS.map(varLine).filter(Boolean), ...FNS.map(fnSrc)].join('\n'), c);
  return c;
}
/* 通信の答えを返す前に止める（kind の nth 回目）。reached＝止まったところ・release＝続ける */
function gateAt(c, kind, nth = 1) {
  let n = 0, release, reachedRes;
  const gate = new Promise(r => { release = r; }), hit = new Promise(r => { reachedRes = r; });
  c.hold = async (k) => { if (k === kind && ++n === nth) { reachedRes(); await gate; } };
  /* 止まる所まで来なければ（書き方が変わった）待ち続けずに落とす */
  let tm; const reached = Promise.race([hit, new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`no ${kind} #${nth} to hold`)), 8000); })]).finally(() => clearTimeout(tm));
  return { reached, release };
}
/* 本物の lsSet で保存し、送った結果を待つ */
async function save(c, key, val) {
  vm.runInContext(`lsSet(${JSON.stringify(key)}, ${JSON.stringify(val)})`, c);
  return vm.runInContext(`Promise.resolve(_lsPushP[${JSON.stringify(key)}])`, c);
}
const local = (c, k) => JSON.parse(c.S[k]);
const outbox = c => vm.runInContext('_outboxGet()', c).map(x => x.key);
const run = (c, code) => vm.runInContext(code, c);
/* クラウドから取り込む（本物の supaPullAllMasters。食材は裏で取るので待つ） */
async function pullAll(c) { const r = await run(c, 'supaPullAllMasters()'); if (r && r._done) await r._done; return r; }
const live = rows => rows.filter(r => !r._deleted);
/* 書けた行（条件で断られた書き込みは除く）の番号 */
const wrote = c => c.writes.filter(w => w.ok !== false).flatMap(w => w.pks).sort();

const ING = [
  { code: 1001, name: 'Salmon', cat: 1000, unit: 'kg', price: 20, qty: 1 },
  { code: 1002, name: 'Tuna', cat: 1000, unit: 'kg', price: 30, qty: 1 },
  { code: 1003, name: 'Rice', cat: 1000, unit: 'kg', price: 2, qty: 10 },
];
async function twoDevices() {
  const db = await cloudDb();
  await seedCloud(db, 'ingredients', ING);
  const A = device(db, { name: 'A' }), B = device(db, { name: 'B' });
  await pullAll(A); await pullAll(B);
  return { db, A, B };
}

test('two devices change different ingredients: both stay, and only the changed row is written (before: the later save wrote every row from its stale copy and undid the other)', async () => {
  const { db, A, B } = await twoDevices();
  const a = local(A, 'm_ingredients'); a[0].price = 22;
  assert.equal(await save(A, 'm_ingredients', a), true);
  const b = local(B, 'm_ingredients'); b[1].price = 33;   // B は A の変更を取り込んでいない
  assert.equal(await save(B, 'm_ingredients', b), true);
  assert.equal((await rowOf(db, 'ingredients', 1001)).price, 22, 'A’s change is not undone by B');
  assert.equal((await rowOf(db, 'ingredients', 1002)).price, 33);
  if (HAS_MR) assert.deepEqual(wrote(B), ['1002'], 'only the changed row is written');
  assert.equal(local(B, 'm_ingredients').length, 3);
  await db.close();
});

test('two devices change different fields of the same ingredient: both fields stay', async () => {
  const { db, A, B } = await twoDevices();
  const a = local(A, 'm_ingredients'); a[0].price = 25;
  await save(A, 'm_ingredients', a);
  const b = local(B, 'm_ingredients'); b[0].unit = 'lb';
  await save(B, 'm_ingredients', b);
  const r = await rowOf(db, 'ingredients', 1001);
  assert.equal(r.price, 25, 'A’s price stays'); assert.equal(r.unit, 'lb');
  if (HAS_MR) assert.deepEqual({ price: local(B, 'm_ingredients')[0].price, unit: local(B, 'm_ingredients')[0].unit }, { price: 25, unit: 'lb' }, 'B’s device row becomes the cloud row (with A’s price)');
  await db.close();
});

test('a deleted ingredient does not come back at the next login, and a stale device saving another row does not bring it back (before: it came back)', async () => {
  const { db, A, B } = await twoDevices();
  assert.equal(await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1003)), true);
  const t = await rowOf(db, 'ingredients', 1003);
  if (HAS_MR) { assert.equal(t._deleted, true, 'the cloud row is kept with the deleted mark'); assert.equal(t._deletedBy, 'A'); assert.ok(t._deletedAt); }
  /* B（古い写し・1003 を持ったまま）が別の行を直す */
  const b = local(B, 'm_ingredients'); b[0].price = 21;
  await save(B, 'm_ingredients', b);
  await pullAll(A);
  assert.deepEqual(local(A, 'm_ingredients').map(x => x.code), [1001, 1002], 'not back on the deleting device');
  await pullAll(B);
  assert.deepEqual(local(B, 'm_ingredients').map(x => x.code), [1001, 1002], 'gone on the other device after its pull');
  assert.equal(local(B, 'm_ingredients')[0].price, 21);
  const C = device(db, { name: 'C' }); await pullAll(C);
  assert.deepEqual(local(C, 'm_ingredients').map(x => x.code), [1001, 1002], 'a new device does not get the deleted row');
  await db.close();
});

test('a row deleted on another device but edited here: the deletion wins (not written back, removed here, logged)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1002));
  const b = local(B, 'm_ingredients'); b[1].price = 99;
  assert.equal(await save(B, 'm_ingredients', b), true);
  assert.equal((await rowOf(db, 'ingredients', 1002))._deleted, true, 'still deleted');
  assert.equal((await rowOf(db, 'ingredients', 1002)).price, 30, 'B’s edit is not written');
  assert.deepEqual(local(B, 'm_ingredients').map(x => x.code), [1001, 1003], 'removed on B');
  assert.deepEqual(outbox(B), []);
  assert.ok(B.logs.some(m => /消された行/.test(m)), 'logged');
  assert.deepEqual(Object.keys(JSON.parse(B.LSM.get('_mr_touched_v1') || '{}')).filter(k => k !== '_s'), [], 'nothing left to send');
  await db.close();
});

test('a pull while an edit of a deleted row waits to be sent: the deletion wins at the pull (the waiting edit is dropped and logged)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1002));
  B.offline = true;
  const b = local(B, 'm_ingredients'); b[1].price = 99;
  assert.equal(await save(B, 'm_ingredients', b), false);
  B.offline = false;
  await pullAll(B);
  assert.deepEqual(local(B, 'm_ingredients').map(x => x.code), [1001, 1003]);
  assert.equal(JSON.parse(B.LSM.get('_mr_touched_v1') || '{}').m_ingredients, undefined, 'the waiting edit of the deleted row is dropped');
  assert.ok(B.logs.some(m => /消された行/.test(m)));
  await db.close();
});

test('a row deleted here but not sent yet (offline) does not come back at a pull; the deletion is sent next', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  A.offline = true;
  assert.equal(await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1003)), false);
  const b = local(B, 'm_ingredients'); b[0].price = 19;
  await save(B, 'm_ingredients', b);
  A.offline = false;
  await pullAll(A);
  assert.deepEqual(local(A, 'm_ingredients').map(x => x.code), [1001, 1002], 'not back while unsent');
  assert.equal(local(A, 'm_ingredients')[0].price, 19, 'the other device’s change is shown');
  const a = local(A, 'm_ingredients'); a[1].price = 31;
  assert.equal(await save(A, 'm_ingredients', a), true);
  assert.equal((await rowOf(db, 'ingredients', 1003))._deleted, true, 'the deletion is sent');
  await db.close();
});

test('a new row with the number of a deleted row is created again (the deleted mark is removed)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1003));
  await pullAll(B);
  const b = local(B, 'm_ingredients'); b.push({ code: 1003, name: 'Brown rice', cat: 1000, unit: 'kg', price: 3, qty: 10 });
  assert.equal(await save(B, 'm_ingredients', b), true);
  const r = await rowOf(db, 'ingredients', 1003);
  assert.equal(r.name, 'Brown rice'); assert.equal(r._deleted, undefined, 'created again');
  await pullAll(A);
  assert.deepEqual(local(A, 'm_ingredients').map(x => x.name), ['Salmon', 'Tuna', 'Brown rice']);
  await db.close();
});

test('the login pull keeps an ingredient change that was not sent yet, and shows the other device’s change too (before: the deferred ingredients pull replaced it)', async () => {
  const { db, A, B } = await twoDevices();
  A.offline = true;
  const a = local(A, 'm_ingredients'); a[0].price = 24; a.push({ code: 1004, name: 'Nori', cat: 1000, unit: 'pc', price: 1, qty: 50 });
  assert.equal(await save(A, 'm_ingredients', a), false);
  assert.deepEqual(outbox(A), ['m_ingredients']);
  const b = local(B, 'm_ingredients'); b[2].price = 3;
  await save(B, 'm_ingredients', b);
  A.offline = false;
  await pullAll(A);
  const l = local(A, 'm_ingredients');
  assert.equal(l.find(x => x.code === 1001).price, 24, 'the unsent change stays');
  assert.ok(l.find(x => x.code === 1004), 'the unsent new row stays');
  if (HAS_MR) assert.equal(l.find(x => x.code === 1003).price, 3, 'and B’s change is shown');
  /* 送り直し：変えた行だけ */
  A.writes.length = 0;
  assert.equal(await save(A, 'm_ingredients', l), true);
  const cl = live(await rowsOf(db, 'ingredients'));
  assert.deepEqual(cl.map(x => [x.code, x.price]), [[1001, 24], [1002, 30], [1003, 3], [1004, 1]], 'both devices’ changes are in the cloud');
  if (HAS_MR) assert.deepEqual(wrote(A), ['1001', '1004'], 'only the changed rows are written');
  await db.close();
});

test('two devices write the same row at almost the same time (between read and write): the stale write is refused, re-read and merged again, both fields stay (before: the later write undid the other field)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  /* A が読んだあと、書く前に B が同じ行の別の欄を書く */
  const g = gateAt(A, 'write');
  const a = local(A, 'm_ingredients'); a[0].price = 26;
  const pa = save(A, 'm_ingredients', a);
  await g.reached;
  const b = local(B, 'm_ingredients'); b[0].unit = 'lb';
  assert.equal(await save(B, 'm_ingredients', b), true);
  g.release();
  assert.equal(await pa, true);
  /* A は B が書く前の行を読んでいた → A の書き込みは版が違うので入らず、読み直して B の unit の上に重ね直す（前は B の unit を消していた） */
  let r = await rowOf(db, 'ingredients', 1001);
  assert.equal(r.price, 26); assert.equal(r.unit, 'lb', 'B’s field written in between stays');
  assert.equal(A.writes.filter(w => w.ok === false).length, 1, 'A’s first write was refused (the row had changed)');
  assert.deepEqual({ price: local(A, 'm_ingredients')[0].price, unit: local(A, 'm_ingredients')[0].unit }, { price: 26, unit: 'lb' }, 'A’s device row becomes the merged cloud row');
  /* 逆の順番：B が読んだあと、書く前に A が書く → B の読み直しで B の欄が無ければ重ね直す */
  const g2 = gateAt(B, 'write');
  const b2 = local(B, 'm_ingredients'); b2[0].qty = 2;
  const pb = save(B, 'm_ingredients', b2);
  await g2.reached;
  await pullAll(A);
  const a2 = local(A, 'm_ingredients'); a2[0].name = 'King salmon';
  assert.equal(await save(A, 'm_ingredients', a2), true);
  g2.release();
  assert.equal(await pb, true);
  r = await rowOf(db, 'ingredients', 1001);
  assert.equal(r.qty, 2, 'B’s field'); assert.equal(r.name, 'King salmon', 'A’s field written in between is merged in, not undone');
  assert.equal(r.price, 26);
  await db.close();
});

test('two devices add the same new number at almost the same time: the later one is not refused forever (the insert finds the row, re-reads it and writes over it with the version)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const g = gateAt(A, 'write');
  const a = local(A, 'm_ingredients'); a.push({ code: 1005, name: 'Ikura', cat: 1000, unit: 'kg', price: 60, qty: 1 });
  const pa = save(A, 'm_ingredients', a);
  await g.reached;
  const b = local(B, 'm_ingredients'); b.push({ code: 1005, name: 'Ikura (B)', cat: 1000, unit: 'kg', price: 61, qty: 1 });
  assert.equal(await save(B, 'm_ingredients', b), true);
  g.release();
  assert.equal(await pa, true);
  const r = await rowOf(db, 'ingredients', 1005);
  assert.equal(r.name, 'Ikura', 'the later save of a new row is whole (as before)');
  assert.ok(A.writes.some(w => w.method === 'POST' && w.ok === false), 'the insert found the row');
  assert.ok(A.writes.some(w => w.method === 'PATCH' && w.ok), 'then written with the version');
  assert.deepEqual(outbox(A), []);
  await db.close();
});

test('a delete and an edit of the same row at almost the same time: the delete is re-read and still wins', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const g = gateAt(A, 'write');
  const pa = save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1002));
  await g.reached;
  const b = local(B, 'm_ingredients'); b[1].price = 35;
  assert.equal(await save(B, 'm_ingredients', b), true);
  g.release();
  assert.equal(await pa, true);
  const r = await rowOf(db, 'ingredients', 1002);
  assert.equal(r._deleted, true, 'deleted'); assert.equal(r._deletedBy, 'A');
  await pullAll(B);
  assert.deepEqual(local(B, 'm_ingredients').map(x => x.code), [1001, 1003]);
  await db.close();
});

test('a delete lands between another device’s read and write: that write is refused, re-read, and the deletion wins (the edit does not bring the row back)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const g = gateAt(B, 'write');
  const b = local(B, 'm_ingredients'); b[1].price = 36;
  const pb = save(B, 'm_ingredients', b);
  await g.reached;
  assert.equal(await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(x => x.code !== 1002)), true);
  g.release();
  assert.equal(await pb, true);
  const r = await rowOf(db, 'ingredients', 1002);
  assert.equal(r._deleted, true, 'still deleted'); assert.equal(r.price, 30, 'B’s edit is not written');
  assert.deepEqual(local(B, 'm_ingredients').map(x => x.code), [1001, 1003]);
  await pullAll(A);
  assert.deepEqual(local(A, 'm_ingredients').map(x => x.code), [1001, 1003]);
  await db.close();
});

test('two edits of the same row before it is sent (offline): both changed fields are sent', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  A.offline = true;
  const a = local(A, 'm_ingredients'); a[0].price = 23;
  assert.equal(await save(A, 'm_ingredients', a), false);
  const a2 = local(A, 'm_ingredients'); a2[0].unit = 'lb';
  assert.equal(await save(A, 'm_ingredients', a2), false);
  const b = local(B, 'm_ingredients'); b[0].qty = 4;
  await save(B, 'm_ingredients', b);
  A.offline = false;
  const a3 = local(A, 'm_ingredients'); a3[2].price = 2.5;
  assert.equal(await save(A, 'm_ingredients', a3), true);
  const r = await rowOf(db, 'ingredients', 1001);
  assert.deepEqual({ price: r.price, unit: r.unit, qty: r.qty }, { price: 23, unit: 'lb', qty: 4 }, 'the first edit, the second edit and B’s field');
  await db.close();
});

test('a write the cloud refuses (server error): nothing is marked sent; it stays unsent and goes on the next save', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  const realFetch = A.fetch;
  A.fetch = async (url, opt = {}) => (String(opt.method || 'GET').toUpperCase() === 'PATCH' ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : realFetch(url, opt));
  const a = local(A, 'm_ingredients'); a[0].price = 28;
  assert.equal(await save(A, 'm_ingredients', a), false);
  assert.deepEqual(outbox(A), ['m_ingredients']);
  assert.ok(JSON.parse(A.LSM.get('_mr_touched_v1')).m_ingredients['1001'], 'still remembered');
  assert.match(A._opLastPushErr.m_ingredients, /書き込みに失敗/);
  assert.equal((await rowOf(db, 'ingredients', 1001)).price, 20);
  A.fetch = realFetch;
  const a2 = local(A, 'm_ingredients'); a2[2].price = 3;
  assert.equal(await save(A, 'm_ingredients', a2), true);
  assert.equal((await rowOf(db, 'ingredients', 1001)).price, 28);
  assert.equal((await rowOf(db, 'ingredients', 1003)).price, 3);
  assert.deepEqual(outbox(A), []);
  await db.close();
});

test('a large change (more than MR_BULK rows, e.g. a one-time migration) is written in one request; a row another device wrote after it is re-read and merged again', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  const many = Array.from({ length: 150 }, (_, i) => ({ code: 2000 + i, name: 'Item ' + i, cat: 2000, unit: 'pc', price: 1, qty: 1 }));
  await seedCloud(db, 'ingredients', many);
  const A = device(db, { name: 'A' }), B = device(db, { name: 'B' });
  await pullAll(A); await pullAll(B);
  /* A の読み直し（書いたあとの確かめ）の前に、B が 1 行の別の欄を書く */
  const g = gateAt(A, 'read', 5);   /* 読むのは 40 行ずつ：1〜4 が最初の読み・5 が書いたあとの読み直し */
  const a = local(A, 'm_ingredients').map(x => Object.assign({}, x, { price: 2 }));
  const pa = save(A, 'm_ingredients', a);
  await g.reached;
  const b = local(B, 'm_ingredients'); b[7].unit = 'box';
  assert.equal(await save(B, 'm_ingredients', b), true);
  g.release();
  assert.equal(await pa, true);
  assert.equal(A.writes.filter(w => w.method === 'UPSERT').length, 1, 'one request for the large change');
  assert.equal(A.writes.find(w => w.method === 'UPSERT').pks.length, 150);
  const rows = await rowsOf(db, 'ingredients');
  assert.ok(rows.every(r => r.price === 2), 'every price is written');
  assert.equal(rows.find(r => r.code === 2007).unit, 'box', 'the field B wrote after A’s write stays (A re-read that row and merged again)');
  assert.ok(A.writes.some(w => w.method === 'PATCH' && w.ok && w.pks[0] === '2007'), 'that row is written again with the version');
  assert.deepEqual(outbox(A), []);
  await db.close();
});

test('editing a row again while it is being sent: the new edit is kept and sent next', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  const g = gateAt(A, 'write');
  const a = local(A, 'm_ingredients'); a[0].price = 27;
  const p1 = save(A, 'm_ingredients', a);
  await g.reached;
  const a2 = local(A, 'm_ingredients'); a2[0].name = 'Atlantic salmon';
  const p2 = save(A, 'm_ingredients', a2);
  g.release();
  assert.equal(await p1, true); assert.equal(await p2, true);
  const r = await rowOf(db, 'ingredients', 1001);
  assert.equal(r.price, 27); assert.equal(r.name, 'Atlantic salmon');
  assert.equal(local(A, 'm_ingredients')[0].name, 'Atlantic salmon', 'the device keeps the newer edit');
  assert.equal(JSON.parse(A.LSM.get('_mr_touched_v1') || '{}').m_ingredients, undefined, 'everything sent');
  await db.close();
});

test('a field removed here is removed in the cloud row; other fields stay', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const b = local(B, 'm_ingredients'); b[0].memo = 'fresh only';
  await save(B, 'm_ingredients', b);
  await pullAll(A);
  const a = local(A, 'm_ingredients'); delete a[0].memo; a[1].price = 31;
  await save(A, 'm_ingredients', a);
  assert.equal((await rowOf(db, 'ingredients', 1001)).memo, undefined);
  assert.equal((await rowOf(db, 'ingredients', 1001)).name, 'Salmon');
  await db.close();
});

test('stores, recipes and categories work the same (string ids, ids with spaces), and loginBootstrapPull keeps unsent store changes and drops deleted stores', async () => {
  const db = await cloudDb();
  await seedCloud(db, 'stores', [{ id: 'F01', name: 'ToriTon', active: true }, { id: 'F04-K', name: 'Totoya Kaimuki', active: true }, { id: 'X9', name: 'Old', active: false }]);
  await seedCloud(db, 'recipes', [{ id: 'r 1', name: 'Don', sellPrice: 15 }, { id: 'r2', name: 'Ramen', sellPrice: 14 }]);
  await seedCloud(db, 'categories', [{ code: 1000, name: 'Fish' }, { code: 2000, name: 'Veg' }]);
  const A = device(db, { name: 'A' }), B = device(db, { name: 'B' });
  await pullAll(A); await pullAll(B);
  /* 店舗：A は消す・B は別の店の名前を変える */
  await save(A, 'm_stores', local(A, 'm_stores').filter(s => s.id !== 'X9'));
  const bs = local(B, 'm_stores'); bs.find(s => s.id === 'F04-K').name = 'Totoya Kaimuki (new)';
  await save(B, 'm_stores', bs);
  await pullAll(A);
  assert.deepEqual(local(A, 'm_stores').map(s => s.id).sort(), ['F01', 'F04-K']);
  assert.equal(local(A, 'm_stores').find(s => s.id === 'F04-K').name, 'Totoya Kaimuki (new)');
  /* レシピ（空白のある id）とカテゴリー */
  const ar = local(A, 'm_recipes'); ar[0].sellPrice = 16; await save(A, 'm_recipes', ar);
  const br = local(B, 'm_recipes'); br[1].sellPrice = 13; await save(B, 'm_recipes', br);
  assert.deepEqual(live(await rowsOf(db, 'recipes')).map(r => r.sellPrice), [16, 13]);
  await save(A, 'm_categories', local(A, 'm_categories').filter(c => c.code !== 2000));
  await pullAll(B);
  assert.deepEqual(local(B, 'm_categories').map(c => c.code), [1000]);
  /* loginBootstrapPull（店舗）：送れていない変更を残し、消した店は置かない */
  B.offline = true;
  const bs2 = local(B, 'm_stores'); bs2.find(s => s.id === 'F01').name = 'ToriTon Main';
  await save(B, 'm_stores', bs2);
  B.offline = false;
  await run(B, 'loginBootstrapPull({ background:true })');
  assert.equal(local(B, 'm_stores').find(s => s.id === 'F01').name, 'ToriTon Main', 'kept');
  assert.equal(local(B, 'm_stores').find(s => s.id === 'X9'), undefined, 'deleted store is not placed');
  await db.close();
});

test('a save during start-up (or before the device storage is read, or without a previous list) and a v1149 unsent change are checked against the cloud once: changed rows are written by version, unchanged rows are not (before: every row was upserted)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  /* 起動の途中の保存：覚えを確かめられない → 印 */
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[0].price = 40;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  assert.ok(JSON.parse(A.LSM.get('_mr_unk_v1')).m_ingredients);
  assert.equal(JSON.parse(A.LSM.get('_mr_touched_v1') || '{}').m_ingredients, undefined);
  const a2 = local(A, 'm_ingredients'); a2[1].price = 41;
  assert.equal(await save(A, 'm_ingredients', a2), true);
  assert.ok(A.writes.every(w => w.method === 'PATCH'), 'conditional writes, no upsert of every row');
  assert.deepEqual(wrote(A), ['1001', '1002'], 'the start-up change (not remembered) and the remembered change; the unchanged row is not written');
  assert.deepEqual(live(await rowsOf(db, 'ingredients')).map(x => x.price), [40, 41, 2]);
  assert.equal(JSON.parse(A.LSM.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'mark cleared');
  A.writes.length = 0;
  const a3 = local(A, 'm_ingredients'); a3[2].price = 42;
  await save(A, 'm_ingredients', a3);
  assert.deepEqual(wrote(A), ['1003'], 'then only changed rows again');
  /* v1149 で送れなかった変更（送信待ちにあり、覚えが無い）：1 回だけ全部 */
  /* 更新の前（v1149）に端末へ入っていた写しと送信待ち。v1150 の最初の取り込みは端末のまま（v1136） */
  const D = device(db, { name: 'D' });
  const d = live(await rowsOf(db, 'ingredients')); d[0].name = 'Salmon (v1149)';
  D.S.m_ingredients = JSON.stringify(d);
  D.LSM.set('op_outbox', JSON.stringify([{ key: 'm_ingredients', err: 'push failed', who: 'me' }]));
  await pullAll(D);
  assert.equal(local(D, 'm_ingredients')[0].name, 'Salmon (v1149)', 'kept at the first pull');
  D.writes.length = 0;
  const d2 = local(D, 'm_ingredients'); d2[1].unit = 'lb';
  assert.equal(await save(D, 'm_ingredients', d2), true);
  assert.deepEqual(wrote(D), ['1001', '1002'], 'the v1149 change is sent (not lost); the unchanged row is not written');
  assert.equal((await rowOf(db, 'ingredients', 1001)).name, 'Salmon (v1149)');
  assert.equal(D.LSM.get('_mr_v1150'), '1');
  /* 端末の保存を読む前：どの表も印（店舗の表も。Claude のルーティン 6840823792 の P3-1：そのあいだは IndexedDB の覚えが読めず、
     localStorage に書いた覚えの回が古い回になって、読み終えると落ちていた） */
  await seedCloud(db, 'stores', [{ id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' }]);
  const E = device(db, { name: 'E' });
  await pullAll(E);
  E._idbState = 'init'; E.offline = true;
  run(E, `lsSet('m_ingredients', ${JSON.stringify(local(E, 'm_ingredients').slice(0, 2))})`);
  assert.ok(JSON.parse(E.LSM.get('_mr_unk_v1')).m_ingredients, 'ingredients: mark');
  const es = local(E, 'm_stores'); es[1].name = 'Tenkichi Kaimuki';
  assert.equal(await save(E, 'm_stores', es), false);
  assert.ok(JSON.parse(E.LSM.get('_mr_unk_v1')).m_stores, 'stores: mark too');
  assert.equal(JSON.parse(E.LSM.get('_mr_touched_v1') || '{}').m_stores, undefined, 'stores: nothing is remembered before IndexedDB is read');
  /* 読み終える前の取り込みは、送れていない変更があれば端末のまま */
  const kept = run(E, `mrApplyPulled('m_stores', ${JSON.stringify(await rowsOf(db, 'stores'))})`);
  assert.equal(kept && kept.keep, true, 'a pull before IndexedDB is read keeps the unsent store change');
  E._idbState = 'ready'; E.offline = false;
  E.writes.length = 0;
  assert.equal(await save(E, 'm_stores', local(E, 'm_stores')), true);
  assert.deepEqual(wrote(E), ['F02'], 'checked by version: only the changed store is written');
  assert.equal((await rowOf(db, 'stores', 'F02')).name, 'Tenkichi Kaimuki');
  await db.close();
});

test('a pull with a start-up mark and nothing waiting replaces with the cloud table and clears the mark; with an unsent change waiting it keeps the device table', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[0].price = 50;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  await pullAll(A);
  assert.equal(local(A, 'm_ingredients')[0].price, 20, 'replaced by the cloud (as before: start-up saves are not queued)');
  assert.equal(JSON.parse(A.LSM.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'mark cleared');
  /* 印があり、送信待ちもある */
  const B = device(db, { name: 'B' }); await pullAll(B);
  B._idbState = 'init'; B.offline = true;
  const b = local(B, 'm_ingredients'); b[0].price = 51;
  assert.equal(await save(B, 'm_ingredients', b), false);
  B._idbState = 'ready'; B.offline = false;
  await pullAll(B);
  assert.equal(local(B, 'm_ingredients')[0].price, 51, 'kept (v1136)');
  await db.close();
});

test('a pull while the table is being sent keeps the device table (the change being sent is not replaced by the older cloud table)', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[0].price = 55;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  const g = gateAt(A, 'write');
  const a2 = local(A, 'm_ingredients'); a2[1].price = 56;
  const pa = save(A, 'm_ingredients', a2);
  await g.reached;
  await pullAll(A);
  assert.deepEqual(local(A, 'm_ingredients').slice(0, 2).map(x => x.price), [55, 56], 'kept while sending');
  g.release();
  assert.equal(await pa, true);
  assert.deepEqual(live(await rowsOf(db, 'ingredients')).slice(0, 2).map(x => x.price), [55, 56]);
  assert.deepEqual(local(A, 'm_ingredients').slice(0, 2).map(x => x.price), [55, 56]);
  await db.close();
});

test('rows without a number or with the same number twice: marked as unconfirmed (no rows are guessed; checked against the cloud by version when sent)', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  const a = local(A, 'm_ingredients'); a.push({ code: 1001, name: 'Salmon copy' });
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  assert.ok(JSON.parse(A.LSM.get('_mr_unk_v1')).m_ingredients);
  await db.close();
});

test('lsSet records the change before writing; syncMasterToSupabase sends these four tables through mrPush; the space cleaner keeps a table with unsent changes (source)', { skip: !HAS_MR }, () => {
  const ls = fnSrc('lsSet');
  assert.ok(ls.indexOf('mrOnEdit(key, _prevTxt, _json)') > 0 && ls.indexOf('mrOnEdit(key, _prevTxt, _json)') < ls.indexOf('var _ok=_lsWriteVerified(key, _json);'));
  const sm = fnSrc('syncMasterToSupabase');
  assert.ok(sm.indexOf('mrIsKey(key)) return await mrPush(key, val);') > 0 && sm.indexOf('mrPush') < sm.indexOf("def.type==='rows'"));
  assert.match(fnSrc('_lsKeyRecoverable'), /mrIsKey\(s\) && mrHasUnsent\(s\)\) return false;/);
  for (const k of ['_mr_touched_v1', '_mr_unk_v1', '_mr_v1150']) assert.equal(k[0], '_', 'device-only small marks (never synced)');
  /* 同期センターの「この端末からアップロード」は今までどおり全部の行 */
  const up = /var ok = await supaUpsert\(def\.table, val\.map\(def\.map\)\);/.test(SRC);
  assert.ok(up);
});

/* ── Codex #144 6838246707（P2）：覚え（_mr_touched_v1）を端末に書けないまま閉じて開き直しても、送れていない変更を「送れた」にしない ── */
/* localStorage が、決めたキーだけ書けない（いっぱい）ことにする */
function refuse(c, keys) {
  const base = c.localStorage;
  c.localStorage = { getItem: k => base.getItem(k), removeItem: k => base.removeItem(k), key: i => base.key(i), get length() { return base.length; },
    setItem: (k, v) => { if (keys.includes(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } base.setItem(k, v); } };
}
/* 閉じて開き直す：端末の保存（S）と localStorage は残る。このタブのメモリ（_smallSet.mem など）は消える */
const reopen = (db, c, name) => device(db, { S: { ...c.S }, LS: new Map(c.LSM), name });

for (const both of [false, true]) {
  test(`the change record cannot be written to the device${both ? ' (nor the small mark)' : ''}, the app is closed before sending, then reopened: the change is still sent (before: “nothing to send”, the queue was cleared and the next pull put the old price back — Codex #144 6838246707)`, { skip: !HAS_MR }, async () => {
    const db = await cloudDb();
    await seedCloud(db, 'ingredients', ING);
    const E = device(db, { name: 'E' });
    await pullAll(E);
    refuse(E, both ? ['_mr_touched_v1', '_mr_unk_v1'] : ['_mr_touched_v1']);
    E.offline = true;
    const e = local(E, 'm_ingredients'); e[0].price = 99;
    assert.equal(await save(E, 'm_ingredients', e), false, 'offline: not sent');
    assert.deepEqual(outbox(E), ['m_ingredients']);
    assert.equal(E.LSM.has('_mr_touched_v1'), false, 'the change record is only in this tab’s memory');
    assert.equal(E.LSM.has('_mr_unk_v1'), !both, both ? 'the small mark could not be written either' : 'so the small mark is written');
    /* 開き直す（localStorage はまだいっぱい）。同じ値をもう一度保存する（Codex の手順） */
    const E2 = reopen(db, E, 'E');
    refuse(E2, both ? ['_mr_touched_v1', '_mr_unk_v1'] : ['_mr_touched_v1']);
    assert.equal(await save(E2, 'm_ingredients', local(E2, 'm_ingredients')), true);
    assert.equal((await rowOf(db, 'ingredients', 1001)).price, 99, 'the price change reached the cloud');
    assert.deepEqual(wrote(E2), ['1001'], 'only the changed row (checked by version), not every row');
    assert.deepEqual(outbox(E2), []);
    await pullAll(E2);
    assert.equal(local(E2, 'm_ingredients')[0].price, 99, 'the next pull keeps 99');
    await db.close();
  });
}

test('the unconfirmed path (mark) does not undo another device’s change or bring back its deleted row; this device’s change is written (before: every row was upserted — Claude routine 6838247224 P3-2)', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const a = local(A, 'm_ingredients'); a[1].price = 33;
  assert.equal(await save(A, 'm_ingredients', a), true);
  assert.equal(await save(A, 'm_ingredients', local(A, 'm_ingredients').filter(r => r.code !== 1003)), true);
  /* B は A の変更を取り込んでいない。起動の途中に 1001 の値段を変え（覚えを確かめられない＝印）、そのあと名前を変える */
  B._supaBooting = true;
  const b = local(B, 'm_ingredients'); b[0].price = 40;
  run(B, `lsSet('m_ingredients', ${JSON.stringify(b)})`);
  B._supaBooting = false;
  const b2 = local(B, 'm_ingredients'); b2[0].name = 'Salmon B';
  assert.equal(await save(B, 'm_ingredients', b2), true);
  const r1 = await rowOf(db, 'ingredients', 1001);
  assert.deepEqual({ price: r1.price, name: r1.name }, { price: 40, name: 'Salmon B' }, 'the version had not changed: the whole device row is written (the unrecorded price too)');
  assert.equal((await rowOf(db, 'ingredients', 1002)).price, 33, 'A’s change is not undone');
  assert.equal((await rowOf(db, 'ingredients', 1003))._deleted, true, 'A’s deleted row does not come back');
  assert.deepEqual(wrote(B), ['1001']);
  assert.deepEqual(local(B, 'm_ingredients').map(x => [x.code, x.price]), [[1001, 40], [1002, 33]], 'the device rows become the cloud rows');
  assert.ok(B.logs.some(m => /消したほうにしました（1 行）/.test(m)) && B.logs.some(m => /先に直した行はクラウドのほうにしました（1 行/.test(m)), 'both are in the log');
  assert.equal(JSON.parse(B.LSM.get('_mr_unk_v1') || '{}').m_ingredients, undefined, 'mark cleared');
  await db.close();
});

test('the unconfirmed path: a row changed both here (not recorded) and on another device first keeps the cloud row and logs it; a recorded change on another row is written', { skip: !HAS_MR }, async () => {
  const { db, A, B } = await twoDevices();
  const a = local(A, 'm_ingredients'); a[0].unit = 'lb';
  assert.equal(await save(A, 'm_ingredients', a), true);
  B._supaBooting = true;
  const b = local(B, 'm_ingredients'); b[0].price = 40;
  run(B, `lsSet('m_ingredients', ${JSON.stringify(b)})`);
  B._supaBooting = false;
  const b2 = local(B, 'm_ingredients'); b2[1].price = 31;
  assert.equal(await save(B, 'm_ingredients', b2), true);
  const r1 = await rowOf(db, 'ingredients', 1001);
  assert.deepEqual({ price: r1.price, unit: r1.unit }, { price: 20, unit: 'lb' }, 'A wrote first (its version is newer): the cloud row stays');
  assert.equal((await rowOf(db, 'ingredients', 1002)).price, 31);
  assert.deepEqual(wrote(B), ['1002']);
  assert.equal(local(B, 'm_ingredients')[0].unit, 'lb', 'the device row becomes the cloud row');
  assert.ok(B.logs.some(m => /先に直した行はクラウドのほうにしました（1 行/.test(m)));
  await db.close();
});

test('the unconfirmed path with an empty table: the deleted rows are still marked deleted (before: an empty table returned before sending them — Claude routine 6838247224 P3-1)', { skip: !HAS_MR }, async () => {
  const db = await cloudDb();
  await seedCloud(db, 'categories', [{ code: 'C1', name: 'Fish' }, { code: 'C2', name: 'Meat' }]);
  const C = device(db, { name: 'C' });
  await pullAll(C);
  C._supaBooting = true;
  run(C, `lsSet('m_categories', ${JSON.stringify([{ code: 'C1', name: 'Fish!' }, { code: 'C2', name: 'Meat' }])})`);
  C._supaBooting = false;
  assert.ok(JSON.parse(C.LSM.get('_mr_unk_v1')).m_categories);
  assert.equal(await save(C, 'm_categories', []), true);
  assert.deepEqual(live(await rowsOf(db, 'categories')), [], 'both rows are marked deleted');
  assert.equal(JSON.parse(C.LSM.get('_mr_unk_v1') || '{}').m_categories, undefined, 'mark cleared');
  await db.close();
});

test('the unconfirmed path cannot read the whole cloud table: nothing is written, it stays unsent and the mark stays (it is not treated as an empty cloud)', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[0].price = 40;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  const fetchAll = A.supaFetchAll;
  A.supaFetchAll = async () => null;
  const a2 = local(A, 'm_ingredients'); a2[1].price = 41;
  assert.equal(await save(A, 'm_ingredients', a2), false);
  assert.deepEqual(wrote(A), [], 'nothing written');
  assert.deepEqual(outbox(A), ['m_ingredients']);
  assert.ok(JSON.parse(A.LSM.get('_mr_unk_v1')).m_ingredients, 'the mark stays');
  A.supaFetchAll = fetchAll;
  assert.equal(await save(A, 'm_ingredients', local(A, 'm_ingredients')), true);
  assert.deepEqual(live(await rowsOf(db, 'ingredients')).map(x => x.price), [40, 41, 2]);
  await db.close();
});

test('the unconfirmed mark is not cleared when the table is saved again while it is being checked: that save (here a list with the same number twice, so not recorded) is checked and sent by the queued send', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[0].price = 40;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  const g = gateAt(A, 'write');
  const a2 = local(A, 'm_ingredients'); a2[1].price = 41;
  const pa = save(A, 'm_ingredients', a2);
  await g.reached;
  /* 送っているあいだの保存：同じ番号が 2 つ（覚えを確かめられない＝印はもう付いている）。1003 の値段も変える */
  const a3 = local(A, 'm_ingredients'); a3[2].price = 3; a3.push({ ...a3[0] });
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a3)})`);
  const pq = run(A, `Promise.resolve(_lsPushP['m_ingredients'])`);   /* 待っている次の送信 */
  g.release();
  await pa;
  assert.equal(await pq, true);
  assert.deepEqual(live(await rowsOf(db, 'ingredients')).map(x => x.price), [40, 41, 3], 'the change saved during the send is sent by the queued send (before the mark was kept: it was lost)');
  await db.close();
});

test('the unconfirmed path: a row marked deleted without a new version (e.g. by hand in SQL) still counts as deleted (not written back)', { skip: !HAS_MR }, async () => {
  const { db, A } = await twoDevices();
  const v0 = (await rowOf(db, 'ingredients', 1003))._mrv;
  await db.query(`update ingredients set data = data || '{"_deleted":true}'::jsonb where code='1003'`);
  assert.equal((await rowOf(db, 'ingredients', 1003))._mrv, v0, 'same version as the device row');
  A._supaBooting = true;
  const a = local(A, 'm_ingredients'); a[2].price = 5;
  run(A, `lsSet('m_ingredients', ${JSON.stringify(a)})`);
  A._supaBooting = false;
  const a2 = local(A, 'm_ingredients'); a2[0].price = 21;
  assert.equal(await save(A, 'm_ingredients', a2), true);
  assert.equal((await rowOf(db, 'ingredients', 1003))._deleted, true, 'still deleted');
  assert.deepEqual(wrote(A), ['1001']);
  assert.deepEqual(local(A, 'm_ingredients').map(x => x.code), [1001, 1002], 'removed here too');
  await db.close();
});
