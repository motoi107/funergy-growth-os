// v1149（Codex #143 6823638883）：IndexedDB を読む前の保存 → 送る前に閉じて開き直す → 次の保存、でも変更が消えない。
// 本物の保存の層（_idbBoot・_idbQueue・_lsWriteVerified・v1138 の写しの記録 _lsj:）を fake-indexeddb の上で、
// 本物の lsSet・_pushWithOutbox・送信待ち（op_outbox）・v1149 の重ね方（wbOnEdit・wbPush・syncMasterToSupabase）と一緒に動かす。
// クラウドは PGlite（jsonb）の app_state・app_settings。1 つの device ＝ 1 台の端末（localStorage と IndexedDB）、1 つの vm ＝ 1 回の起動。
// 合成データだけ。本番にはつながない。FUNERGY_INDEX に前の版の index.html を渡すと、開き直しの試験は落ちる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HAS_WB = /^function wbMerge3\(/m.test(SRC);
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
function varArr(name) {
  const m = new RegExp('^var ' + name + '\\s*=\\s*\\[', 'm').exec(SRC); assert.ok(m, name);
  let i = SRC.indexOf('[', m.index), d = 0, j = i;
  for (; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '[') d++; else if (ch === ']') { d--; if (!d) break; } }
  return 'var ' + name + ' = ' + SRC.slice(i, j + 1).replace(/\/\*[\s\S]*?\*\//g, '') + ';';
}
function topKeys(name) {
  const m = new RegExp('^var ' + name + '\\s*=\\s*\\{', 'm').exec(SRC); assert.ok(m, name);
  let i = SRC.indexOf('{', m.index), d = 0, j = i;
  for (; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '{') d++; else if (ch === '}') { d--; if (!d) break; } }
  const b = SRC.slice(i, j + 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out = []; let depth = 0; const re = /([A-Za-z_$][\w$]*|'[^']*')\s*:/y;
  for (let k = 1; k < b.length - 1; k++) {
    const ch = b[k];
    if ('{[('.includes(ch)) depth++; else if ('}])'.includes(ch)) depth--;
    else if (depth === 0) { re.lastIndex = k; const mm = re.exec(b); if (mm) { out.push(mm[1].replace(/'/g, '')); k = re.lastIndex - 1; } }
  }
  return out;
}
const MERGE_KEYS = topKeys('OP_MERGE'), MERGE_PREFIX = topKeys('OP_MERGE_PREFIX').concat(['sl_manual_']), SPLIT = topKeys('_SPLIT_KEYS');
const slimBlock = (() => { const a = SRC.indexOf('var LS_SLIM_KEEP'), b = SRC.indexOf('\nfunction _lsWriteVerified('); assert.ok(a > 0 && b > a, 'v1138 block'); return SRC.slice(a, b); })();

/* 保存の層（v1138 の試験と同じもの）＋ 送信待ちと送る順（本物）＋ lsSet（本物）＋ v1149 の重ね方（本物） */
const STORE_VARS = ['IDB_NAME', '_idbDB', '_idbState', '_IDB_MEM', '_idbQ', '_idbTimer', '_idbStat', '_idbInflight', '_IDB_WATCH', '_idbGen', '_idbReopening', 'LS_DEVICE_LOCAL'];   // 1 行の var（IDB_STORE・_idbKeyGen は同じ行）
const STORE_FNS = ['_idbAvailable', '_idbOpen', '_idbLoadAll', '_idbWatched', '_idbTrack', '_idbWriteBatch', '_idbFlush', '_idbFlushP', '_idbReopen',
  '_idbStale', '_idbRequeue', '_idbQueue', '_idbBackfill', '_idbBoot', 'lsIsDeviceLocal', '_lsStoreGet', '_lsRawStr', '_lsRawDel', '_lsWriteVerified'];
const PUSH_FNS = ['_outboxGet', '_outboxSet', '_outboxAdd', '_outboxRemove', '_pushWithOutbox', '_pushQOf', '_pushBusy', '_pushRun', '_smallGet', '_smallSet', 'lsSet'];
const WB_FNS = ['_cjson', '_tsMicro', '_casTs', '_fetchOpRow', '_opCasWrite', 'isLocalOnlyKey', 'isOpSyncKey', 'supaSettingCategory', 'syncMasterToSupabase',
  'wbSecure', 'wbTable', 'wbIsKey', 'wbGet', 'wbSet', 'wbDrop', 'wbParse', 'wbPending', 'wbOnEdit', '_wbEq', '_wbPlain', '_wbOwn', '_wbIds', '_wbConf',
  'wbMerge3', '_wbMergeIds', 'wbMergeTop', 'wbPrefer', 'wbNoteConf', 'wbFetchSetting', 'wbPush', 'wbWholeSent',
  '_wbUnkAll', '_wbUnkSave', 'wbUnkHas', 'wbUnkMark', 'wbUnkClear', 'wbIncoming'];
/* 取り込み（本物）：_applyKvRows と v1136 の「送れていない手元を残す」決め方・直した時刻 */
const PULL_FNS = ['_applyKvRows', '_pullPendingMap', '_pullKeepLocal', '_pendEditAtRaw', '_pendEditAtSetRaw', '_pendEditAtAll', '_pendEditAtMark', '_pendEditAtDrop'];
const WB_VARS = ['WB_PRE', 'WB_ABS', 'WB_NOBASE', 'WB_MAX_KEYS', 'WB_CONF_LOG', 'LS_LOCAL_ONLY', '_OP_READ_TMO', '_wbUnk', 'WB_UNK_KEY', '_pushQ', '_lsPushP', 'PEND_EDIT_KEY'];
const CODE = [...STORE_VARS.map(varLine).filter(Boolean), ...STORE_FNS.map(fnSrc), slimBlock,
  ...WB_VARS.map(varLine).filter(Boolean), varArr('OP_SYNC_KEYS'), varArr('OP_SYNC_PREFIX'), varArr('SUPA_SETTING_KEYS'), varArr('SUPA_SETTING_PREFIX'),
  ...PUSH_FNS.map(fnSrc), ...WB_FNS.map(fnSrc), ...PULL_FNS.map(fnSrc)].join('\n') + `
  function _lskBump(){} var _lsEscalatedAt=0; function _lsFreeOldLaborKeys(){}
  function _lsNoteSaveFailure(k){ __fails.push(k); } function _lsClearSaveFailure(){} var __fails=[];
  function lsKeys(p){ p=p||""; var s=new Set(); for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(p)===0) s.add(k);} if(_idbState==="ready"&&_IDB_MEM) _IDB_MEM.forEach(function(v,k){ if(String(k).indexOf(p)===0) s.add(k); }); return Array.from(s); }
  function ls(k, d){ var s=_lsStoreGet(k); if(s==null) return d; try{ return JSON.parse(s); }catch(e){ return d; } }
  function _lsMarkFetched(){} function _lsPushBlocked(){ return false; } function _lsOnDemand(){ return false; } function _handleLegacySplitRow(){ return false; }
  function _saveWho(){ return 'p:1'; }
  /* 合流の決まり：本物の表の名前だけ（ここで送るキーには決まりが無いことを確かめる） */
  function _opMergeDef(k){
    if(MERGE_KEYS.indexOf(k)>=0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
    for(var i=0;i<MERGE_PREFIX.length;i++) if(String(k).indexOf(MERGE_PREFIX[i])===0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
    for(var j=0;j<SPLIT.length;j++) if(String(k).indexOf('spl_'+SPLIT[j]+'_')===0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
    return null;
  }
  var _idbBootP = new Promise(function(res){ setTimeout(function(){ try{ Promise.resolve(_idbBoot()).then(res, res); }catch(e){ res(); } }, 0); });`;

async function cloudDb() {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table app_state(key text primary key, value jsonb, updated_at timestamptz); create table app_settings(key text primary key, value jsonb, category text)');
  return db;
}
const cloudOf = async (db, k, t = 'app_state') => { const r = await db.query(`select value::text as v from ${t} where key=$1`, [k]); return r.rows.length ? JSON.parse(r.rows[0].v) : undefined; };
const putCloud = async (db, k, v, at = '2026-11-12T00:00:00.000Z') => db.query('insert into app_state(key,value,updated_at) values($1,$2,$3::timestamptz) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at', [k, JSON.stringify(v), at]);

/* localStorage の代わり */
function lsObject(map) {
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); },
    key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
/* 1 台の端末：localStorage と IndexedDB（閉じても残る） */
const device = () => ({ ls: new Map(), factory: new IDBFactory() });
/* 1 回の起動（vm）。vm を作った直後は IndexedDB を読み終える前（_idbState='init'）。ready() で読み終えるのを待つ */
function open(dev, db, { offline = false } = {}) {
  const c = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval: () => 0, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array,
    navigator: {}, IDBKeyRange, localStorage: lsObject(dev.ls), indexedDB: dev.factory, AbortController,
    SUPABASE_URL: 'https://cloud.invalid', supaHeaders: () => ({}), FUNERGY_STATUS: { log() {} }, t: ja => ja,
    _supaBooting: false, SUPA_SYNC_ENABLED: true, _opLastPushErr: {}, _opLastPushWhy: {}, _SPLIT_KEYS: Object.fromEntries(SPLIT.map(k => [k, { kind: 'test' }])),
    SUPA_MASTER_MAP: { m_stores: { type: 'rows' }, m_employees: { type: 'rows' } }, MERGE_KEYS, MERGE_PREFIX, SPLIT, offline,
    opMergePush: async () => { throw new Error('opMergePush must not be used for these keys'); },
    supaUpsert: async (t, rows) => {
      if (c.offline) return false;
      for (const r of rows) {
        if (t === 'app_settings') await db.query('insert into app_settings(key,value,category) values($1,$2,$3) on conflict(key) do update set value=excluded.value', [r.key, JSON.stringify(r.value), r.category || null]);
        else await db.query('insert into app_state(key,value,updated_at) values($1,$2,coalesce($3::timestamptz, now())) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at', [r.key, JSON.stringify(r.value), r.updated_at || null]);
      }
      return true;
    },
    fetch: async (url, o = {}) => {
      if (c.offline) throw new Error('offline');
      const method = (o && o.method) || 'GET', table = /\/rest\/v1\/(app_state|app_settings)/.exec(url)[1];
      const k = method === 'POST' ? JSON.parse(o.body).key : decodeURIComponent(/key=eq\.([^&]+)/.exec(url)[1]);
      if (table === 'app_settings') {
        const r = await db.query('select value::text as v from app_settings where key=$1', [k]);
        return { ok: true, status: 200, json: async () => r.rows.map(x => ({ value: JSON.parse(x.v) })) };
      }
      if (method === 'PATCH') {
        const b = JSON.parse(o.body), ue = /updated_at=eq\.([^&]+)/.exec(url);
        const ret = "returning key, to_json(updated_at)#>>'{}' as u";
        const r = ue ? await db.query('update app_state set value=$1, updated_at=$2::timestamptz where key=$3 and updated_at=$4::timestamptz ' + ret, [JSON.stringify(b.value), b.updated_at, k, decodeURIComponent(ue[1])])
                     : await db.query('update app_state set value=$1, updated_at=$2::timestamptz where key=$3 and updated_at is null ' + ret, [JSON.stringify(b.value), b.updated_at, k]);
        return { ok: true, status: 200, json: async () => r.rows.map(x => (/select=[^&]*updated_at/.test(url) ? { key: x.key, updated_at: x.u } : { key: x.key })) };
      }
      if (method === 'POST') {
        const b = JSON.parse(o.body);
        const r = await db.query('insert into app_state(key,value,updated_at) values($1,$2,$3::timestamptz) on conflict(key) do nothing returning key', [b.key, JSON.stringify(b.value), b.updated_at]);
        return r.rows.length ? { ok: true, status: 201, json: async () => r.rows.map(x => ({ key: x.key })) } : { ok: false, status: 409, json: async () => ({ code: '23505' }) };
      }
      const r = await db.query("select value::text as v, to_json(updated_at)#>>'{}' as u from app_state where key=$1", [k]);
      return { ok: true, status: 200, json: async () => r.rows.map(x => (/updated_at/.test(url) ? { value: JSON.parse(x.v), updated_at: x.u } : { value: JSON.parse(x.v) })) };
    },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(CODE, c);
  return c;
}
const ready = async c => { await c._idbBootP; return c._idbState; };
/* 閉じる（書き出しを待たない）：IndexedDB への書き出しの残りを捨てる。localStorage の写し（_lsj:）は残る */
function crash(c) { try { clearTimeout(c._idbTimer); } catch (e) { } c._idbTimer = null; c._idbQ = new Map(); try { c._idbDB.close(); } catch (e) { } c._idbDB = null; }
/* 本物の lsSet で保存し、送った結果を待つ */
async function save(c, key, val) {
  const ok = vm.runInContext(`lsSet(${JSON.stringify(key)}, ${JSON.stringify(val)})`, c);
  const r = await vm.runInContext(`Promise.resolve(_lsPushP[${JSON.stringify(key)}])`, c);
  return { ok, r };
}
/* クラウドの行を本物の _applyKvRows で取り込む */
async function pull(c, db, key) {
  const r = await db.query("select value::text as v, to_json(updated_at)#>>'{}' as u from app_state where key=$1", [key]);
  return vm.runInContext(`_applyKvRows(${JSON.stringify(r.rows.map(x => ({ key, value: JSON.parse(x.v), updated_at: x.u })))})`, c);
}
const local = (c, k) => JSON.parse(c._lsStoreGet(k));
const outbox = c => vm.runInContext('_outboxGet()', c).map(x => x.key);
const unk = (c, k) => (typeof c.wbUnkHas === 'function' ? c.wbUnkHas(k) : !!(c._wbUnk && c._wbUnk[k]));
/* その端末に、クラウドの値を前の起動で受け取ってある（IndexedDB に入っている）ことにする */
async function seed(dev, rows) {
  await new Promise(res => {
    const rq = dev.factory.open('funergy_os_kv', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { const d = rq.result, tx = d.transaction('kv', 'readwrite'); for (const [k, v] of Object.entries(rows)) tx.objectStore('kv').put(JSON.stringify(v), k); tx.oncomplete = () => { d.close(); res(); }; };
  });
}

test('restart (real storage layer): a save before IndexedDB was read, the app closed before sending it, then the next save after reopening still sends it (Codex #143 6823638883)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'shift_sections';
  await putCloud(db, K, { F01: ['A'], F02: ['B'] });
  const dev = device();
  /* 1 回目の起動：IndexedDB を読み終える前に保存（起動の途中＝送らない・送信待ちにも入らない。前から） */
  const a = open(dev, db);
  a._supaBooting = true;
  assert.equal(a._idbState, 'init');
  assert.equal((await save(a, K, { F01: ['A', 'C'], F02: ['B'] })).ok, true);
  assert.equal(await ready(a), 'ready');
  assert.deepEqual(local(a, K), { F01: ['A', 'C'], F02: ['B'] }, 'the device has C (the key was not on the device yet: the write before reading is kept, v1138)');
  assert.deepEqual(outbox(a), [], 'not queued (start-up, as before)');
  assert.equal(await cloudOf(db, K).then(v => JSON.stringify(v)), JSON.stringify({ F01: ['A'], F02: ['B'] }), 'nothing sent yet');
  crash(a);
  /* 開き直す：メモリは消える。端末の保存と小さな印は残る */
  const b = open(dev, db);
  assert.equal(await ready(b), 'ready');
  assert.deepEqual(local(b, K), { F01: ['A', 'C'], F02: ['B'] }, 'C is still on the device after reopening');
  const s = await save(b, K, { F01: ['A', 'C'], F02: ['D'] });
  assert.equal(s.r, true, 'sent');
  assert.deepEqual(await cloudOf(db, K), { F01: ['A', 'C'], F02: ['D'] }, 'C is not lost (before the fix: the next save took the value holding C as “before” and sent the cloud value back)');
  assert.deepEqual(local(b, K), { F01: ['A', 'C'], F02: ['D'] });
  assert.equal(unk(b, K), false, 'sent whole: the mark is cleared');
  assert.equal(dev.ls.has('_wb_unk_v1'), false);
  /* そのあとはまた重ねる（ほかの端末の変更を消さない） */
  await putCloud(db, K, { F01: ['A', 'C'], F02: ['D'], F03: ['E'] }, '2026-11-12T06:00:00.000Z');
  assert.equal((await save(b, K, { F01: ['A', 'C', 'G'], F02: ['D'] })).r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: ['A', 'C', 'G'], F02: ['D'], F03: ['E'] }, 'merged: the other device’s F03 stays');
  await db.close();
});

test('restart (real storage layer): the mark survives a failed send and another restart; it is cleared only when the whole value is sent', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const dev = device();
  const a = open(dev, db);
  a._supaBooting = true;
  await save(a, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-11-21': 'Closed' } });
  await ready(a);
  crash(a);
  /* 2 回目：通信が無い。保存は送信待ちへ（印は残る） */
  const b = open(dev, db, { offline: true });
  await ready(b);
  const s1 = await save(b, K, { ...local(b, K), F02: { '2026-11-25': 'Party' } });
  assert.equal(s1.r, false);
  assert.deepEqual(outbox(b), [K]);
  assert.equal(unk(b, K), true, 'a failed send keeps the mark');
  assert.equal(b._lsStoreGet('whole_base_v1/' + K), null, 'no base');
  crash(b);
  /* 3 回目：つながる。送信待ち（前からの送り直しと同じ：今の値を送る） */
  const c = open(dev, db);
  await ready(c);
  assert.equal(unk(c, K), true, 'the mark survived two restarts');
  const s2 = await save(c, K, { ...local(c, K), F03: { '2026-12-01': 'Inventory' } });
  assert.equal(s2.r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving', '2026-11-21': 'Closed' }, F02: { '2026-11-25': 'Party' }, F03: { '2026-12-01': 'Inventory' } },
    'the change before IndexedDB was read, the offline change and this change are all sent');
  assert.deepEqual(outbox(c), []);
  assert.equal(unk(c, K), false);
  await db.close();
});

test('restart (real storage layer): a save before IndexedDB was read on a key the device already has keeps the device value (v1138, as before); the mark only makes the next save whole', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'shift_sections';
  await putCloud(db, K, { F01: ['A'], F02: ['B'] });
  const dev = device();
  await seed(dev, { [K]: { F01: ['A'], F02: ['B'] } });
  const a = open(dev, db);
  a._supaBooting = true;
  await save(a, K, { F01: ['A', 'C'], F02: ['B'] });
  await ready(a);
  assert.deepEqual(local(a, K), { F01: ['A'], F02: ['B'] }, 'the device value read from IndexedDB wins over the write before reading (v1138, unchanged)');
  crash(a);
  const b = open(dev, db);
  await ready(b);
  assert.equal(unk(b, K), true);
  assert.equal((await save(b, K, { F01: ['A'], F02: ['D'] })).r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: ['A'], F02: ['D'] }, 'sent whole (as before)');
  assert.equal(unk(b, K), false);
  await putCloud(db, K, { F01: ['A'], F02: ['D'], F03: ['E'] }, '2026-11-12T06:00:00.000Z');
  assert.equal((await save(b, K, { F01: ['A', 'G'], F02: ['D'] })).r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: ['A', 'G'], F02: ['D'], F03: ['E'] }, 'merged again');
  await db.close();
});

test('restart (real storage layer): the key was already on the device, so the write before reading was dropped (v1138); a pull after reopening clears the mark, and the next save is merged — another device’s later change stays (Codex #143 6824737733; before: sent whole and erased it)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'shift_sections';
  await putCloud(db, K, { F01: ['A'], F02: ['B'] });
  const dev = device();
  await seed(dev, { [K]: { F01: ['A'], F02: ['B'] } });
  const a = open(dev, db);
  a._supaBooting = true;
  await save(a, K, { F01: ['A', 'C'], F02: ['B'] });
  await ready(a);
  assert.deepEqual(local(a, K), { F01: ['A'], F02: ['B'] }, 'the device value wins (v1138, unchanged)');
  crash(a);
  const b = open(dev, db);
  await ready(b);
  assert.equal(unk(b, K), true, 'the mark survived the restart');
  /* ログインの取り込み：送れていない変更は無いので、クラウドの値で置き換える（今までどおり） */
  await putCloud(db, K, { F01: ['A'], F02: ['B'], F03: ['E'] }, '2026-11-12T06:00:00.000Z');
  assert.equal(await pull(b, db, K), 1);
  assert.deepEqual(local(b, K), { F01: ['A'], F02: ['B'], F03: ['E'] });
  const clearedAtPull = !unk(b, K), goneFromDevice = !dev.ls.has('_wb_unk_v1');
  /* ほかの端末があとで F04 を足す → この端末が F01 を直す */
  await putCloud(db, K, { F01: ['A'], F02: ['B'], F03: ['E'], F04: ['H'] }, '2026-11-12T07:00:00.000Z');
  assert.equal((await save(b, K, { F01: ['A', 'G'], F02: ['B'], F03: ['E'] })).r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: ['A', 'G'], F02: ['B'], F03: ['E'], F04: ['H'] }, 'merged: the other device’s F04 stays (before: the whole send erased it)');
  assert.equal(clearedAtPull, true, 'the pull made the device value the cloud value: the mark was cleared');
  assert.equal(goneFromDevice, true);
  crash(b);
  /* 開き直しても印は戻らない */
  const c = open(dev, db);
  await ready(c);
  assert.equal(unk(c, K), false);
  await db.close();
});
test('restart (real storage layer): a pull while the marked change is still waiting in the outbox keeps the device value and the mark (v1136; the change is sent whole later)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const dev = device();
  const a = open(dev, db);
  a._supaBooting = true;
  await save(a, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-11-21': 'Closed' } });
  await ready(a);
  crash(a);
  const b = open(dev, db, { offline: true });
  await ready(b);
  b._supaBooting = false;
  const s1 = await save(b, K, { ...local(b, K), F02: { '2026-11-25': 'Party' } });
  assert.equal(s1.r, false);
  assert.deepEqual(outbox(b), [K]);
  b.offline = false;
  await pull(b, db, K);
  assert.deepEqual(local(b, K), { F01: { '2026-11-20': 'Thanksgiving', '2026-11-21': 'Closed' }, F02: { '2026-11-25': 'Party' } }, 'the waiting change is newer than the cloud row: kept (v1136)');
  assert.equal(unk(b, K), true, 'something waits to be sent: the mark stays');
  const s2 = await save(b, K, { ...local(b, K), F03: { '2026-12-01': 'Inventory' } });
  assert.equal(s2.r, true);
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving', '2026-11-21': 'Closed' }, F02: { '2026-11-25': 'Party' }, F03: { '2026-12-01': 'Inventory' } }, 'nothing is lost');
  assert.equal(unk(b, K), false);
  await db.close();
});

test('the device mark is a small device-only entry (kept in localStorage like the outbox, never sent)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const a = open(device(), db);
  assert.equal(a.WB_UNK_KEY, '_wb_unk_v1');
  assert.equal(a.lsIsDeviceLocal('_wb_unk_v1'), true, 'device-local: not copied to IndexedDB, not removed by the v1138 sweep');
  assert.equal(a._lsSlimKind('_wb_unk_v1'), 'dev');
  assert.equal(a.wbIsKey('_wb_unk_v1'), false);
  assert.equal(a.isOpSyncKey('_wb_unk_v1'), false, 'never sent');
  await ready(a);
  await db.close();
});
