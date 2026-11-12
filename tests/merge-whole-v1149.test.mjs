// v1149（段階 2c の 1 つ目）：合流の決まりの無いキー（丸ごと上書き）は、直す前の値と比べて、この端末で変えた所だけをクラウドの最新に重ねる。
// 本物の関数（index.html の wbMerge3・wbPush・wbIncoming・wbOnEdit・syncMasterToSupabase・_applyKvRows・pullOpKey・_fetchOpRow・_opCasWrite など）を
// VM で動かし、クラウドは PGlite（jsonb）の app_state・app_settings。合成データだけ。本番にはつながない。
// FUNERGY_INDEX に前の版（#142 の head）の index.html を渡すと、場面の試験は落ちる（前は丸ごと上書き）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HAS_WB = /^function wbMerge3\(/m.test(SRC);

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
// 1 行の var（WB_PRE など）と、[ … ] の var（OP_SYNC_KEYS など。中のコメントは外す）
const varLine = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); return m ? m[0] : ''; };
function varArr(name) {
  const m = new RegExp('^var ' + name + '\\s*=\\s*\\[', 'm').exec(SRC); assert.ok(m, name);
  let i = SRC.indexOf('[', m.index), d = 0, j = i;
  for (; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '[') d++; else if (ch === ']') { d--; if (!d) break; } }
  return 'var ' + name + ' = ' + SRC.slice(i, j + 1).replace(/\/\*[\s\S]*?\*\//g, '') + ';';
}
// 合流の決まりのあるキー（OP_MERGE・OP_MERGE_PREFIX の上の段の名前。sl_manual_ は _opMergeDef の中）と分けた行のキー
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

const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const FNS = ['_cjson', '_tsMicro', '_casTs', '_fetchOpRow', '_opCasWrite', 'isLocalOnlyKey', 'isOpSyncKey', 'supaSettingCategory', 'syncMasterToSupabase',
  '_applyKvRows', 'pullOpKey', 'pullSettingKey', '_pullKeepLocal', '_pullPendingMap',
  'wbSecure', 'wbTable', 'wbIsKey', 'wbGet', 'wbSet', 'wbDrop', 'wbParse', 'wbPending', 'wbOnEdit', '_wbEq', '_wbPlain', '_wbOwn', '_wbIds', '_wbConf',
  'wbMerge3', '_wbMergeIds', 'wbMergeTop', 'wbPrefer', 'wbNoteConf', 'wbIncoming', 'wbFetchSetting', 'wbPush'];
const VARS = ['WB_PRE', 'WB_ABS', 'WB_NOBASE', 'WB_MAX_KEYS', 'WB_CONF_LOG', 'LS_LOCAL_ONLY', '_OP_READ_TMO'];

async function cloudDb() {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table app_state(key text primary key, value jsonb, updated_at timestamptz); create table app_settings(key text primary key, value jsonb, category text)');
  return db;
}
const cloudOf = async (db, k, t = 'app_state') => { const r = await db.query(`select value::text as v from ${t} where key=$1`, [k]); return r.rows.length ? JSON.parse(r.rows[0].v) : undefined; };
const putCloud = async (db, k, v, at = '2026-11-12T00:00:00.000Z') => db.query('insert into app_state(key,value,updated_at) values($1,$2,$3::timestamptz) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at', [k, JSON.stringify(v), at]);
const putSetting = async (db, k, v) => db.query('insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [k, JSON.stringify(v)]);

/* 端末 1 台。S＝端末の保存（キー → 文字）。OB＝送信待ち。hold(method, table)：その通信の答えを返す前に待つ */
function device(db, now = Date.UTC(2026, 10, 12, 1)) {
  const S = {}, logs = [];
  const c = {
    console: { log() {}, warn() {}, error() {} }, S, NOW: now, OB: [], busy: {}, PE: {}, logs, hold: null, writes: 0,
    SUPABASE_URL: 'https://cloud.invalid', AbortController, setTimeout, clearTimeout, JSON, Math, Promise, Object, Array, String, Number,
    _supaBooting: false, SUPA_SYNC_ENABLED: true, _opLastPushErr: {}, _opLastPushWhy: {}, _SPLIT_KEYS: Object.fromEntries(SPLIT.map(k => [k, { kind: 'test' }])),
    window: null, FUNERGY_STATUS: { log: (_k, m) => logs.push(m) }, t: (ja) => ja,
    _lsStoreGet: k => (k in S ? S[k] : null),
    _lsWriteVerified: (k, j) => { S[k] = j; return true; }, _lsSetVerified: (k, j) => { S[k] = j; return true; },
    _lsRawDel: k => { delete S[k]; return true; },
    ls: (k, d) => (k in S ? JSON.parse(S[k]) : d), _lsRaw: (k, d) => (k in S ? JSON.parse(S[k]) : d),
    _lsMarkFetched() {}, _lsClearSaveFailure() {}, _lsNoteSaveFailure() {}, _lsPushBlocked: () => false, _lsOnDemand: () => false, _handleLegacySplitRow: () => false,
    _outboxGet: () => c.OB.slice(), _saveWho: () => 'me', _pushBusy: k => !!c.busy[k], _pendEditAtAll: () => c.PE,
    supaHeaders: () => ({}),
    SUPA_MASTER_MAP: { m_stores: { type: 'rows' }, m_employees: { type: 'rows' }, m_ingredients: { type: 'rows' }, m_recipes: { type: 'rows' }, m_vendors: { type: 'rows' }, m_categories: { type: 'rows' } },
    MERGE_KEYS, MERGE_PREFIX, SPLIT,
    opMergePush: async () => { throw new Error('opMergePush must not be used for these keys'); },
    supaUpsert: async (t, rows) => {
      c.writes++;
      for (const r of rows) {
        if (t === 'app_settings') await db.query('insert into app_settings(key,value,category) values($1,$2,$3) on conflict(key) do update set value=excluded.value', [r.key, JSON.stringify(r.value), r.category || null]);
        else await db.query('insert into app_state(key,value,updated_at) values($1,$2,coalesce($3::timestamptz, now())) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at', [r.key, JSON.stringify(r.value), r.updated_at || null]);
      }
      return true;
    },
    fetch: async (url, o = {}) => {
      const method = (o && o.method) || 'GET', table = /\/rest\/v1\/(app_state|app_settings)/.exec(url)[1];
      if (c.hold) await c.hold(method, table, 'before');
      const k = method === 'POST' ? JSON.parse(o.body).key : decodeURIComponent(/key=eq\.([^&]+)/.exec(url)[1]);
      let res;
      if (table === 'app_settings') {
        const r = await db.query('select value::text as v from app_settings where key=$1', [k]);
        res = { ok: true, status: 200, json: async () => r.rows.map(x => ({ value: JSON.parse(x.v) })) };
      } else if (method === 'PATCH') {
        c.writes++;
        const b = JSON.parse(o.body), ue = /updated_at=eq\.([^&]+)/.exec(url);
        const ret = "returning key, to_json(updated_at)#>>'{}' as u";
        const r = ue ? await db.query('update app_state set value=$1, updated_at=$2::timestamptz where key=$3 and updated_at=$4::timestamptz ' + ret, [JSON.stringify(b.value), b.updated_at, k, decodeURIComponent(ue[1])])
                     : await db.query('update app_state set value=$1, updated_at=$2::timestamptz where key=$3 and updated_at is null ' + ret, [JSON.stringify(b.value), b.updated_at, k]);
        res = { ok: true, status: 200, json: async () => r.rows.map(x => (/select=[^&]*updated_at/.test(url) ? { key: x.key, updated_at: x.u } : { key: x.key })) };
      } else if (method === 'POST') {
        c.writes++;
        const b = JSON.parse(o.body);
        const r = await db.query('insert into app_state(key,value,updated_at) values($1,$2,$3::timestamptz) on conflict(key) do nothing returning key', [b.key, JSON.stringify(b.value), b.updated_at]);
        res = r.rows.length ? { ok: true, status: 201, json: async () => r.rows.map(x => ({ key: x.key })) } : { ok: false, status: 409, json: async () => ({ code: '23505' }) };
      } else {
        const r = await db.query("select value::text as v, to_json(updated_at)#>>'{}' as u from app_state where key=$1", [k]);
        res = { ok: true, status: 200, json: async () => r.rows.map(x => (/updated_at/.test(url) ? { value: JSON.parse(x.v), updated_at: x.u } : { value: JSON.parse(x.v) })) };
      }
      if (c.hold) await c.hold(method, table, 'after');
      return res;
    },
  };
  c.window = c;
  vm.createContext(c);
  run(c, [...VARS.map(varLine).filter(Boolean), varArr('OP_SYNC_KEYS'), varArr('OP_SYNC_PREFIX'), varArr('SUPA_SETTING_KEYS'), varArr('SUPA_SETTING_PREFIX'), ...FNS.map(fnSrc)].join('\n') + `
    Date.now = function(){ return NOW; };
    /* 合流の決まり：本物の表の名前だけ（中身は使わない：ここで送る・取り込むキーには決まりが無いことを確かめる） */
    function _opMergeDef(k){
      if(MERGE_KEYS.indexOf(k)>=0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
      for(var i=0;i<MERGE_PREFIX.length;i++) if(String(k).indexOf(MERGE_PREFIX[i])===0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
      /* 本物と同じ：分けた行（spl_<元>_…）は、元のキーが分ける表（_SPLIT_KEYS）にあるときだけ決まりがある */
      for(var j=0;j<SPLIT.length;j++) if(String(k).indexOf('spl_'+SPLIT[j]+'_')===0) return { merge:function(c,l){ return l; }, covers:function(){ return true; } };
      return null;
    }`);
  return c;
}
/* 端末での保存（本物の lsSet と同じ順：直す前の値を覚える → 書く → 直した時刻 → 送る）。offline なら送れずに送信待ちへ */
async function edit(c, key, val, { offline = false } = {}) {
  const prev = c._lsStoreGet(key), json = JSON.stringify(val);
  if (typeof c.wbOnEdit === 'function') c.wbOnEdit(key, prev, json);
  c.S[key] = json; c.PE[key] = c.NOW;
  if (offline) { if (!c.OB.some(x => x.key === key)) c.OB.push({ key, who: 'me' }); return 'offline'; }
  return push(c, key);
}
async function push(c, key) {
  c.busy[key] = 1;
  let r;
  try { r = await run(c, `syncMasterToSupabase(${JSON.stringify(key)}, ls(${JSON.stringify(key)}, null))`); } finally { c.busy[key] = 0; }
  if (r === false) { if (!c.OB.some(x => x.key === key)) c.OB.push({ key, who: 'me' }); }
  else { c.OB = c.OB.filter(x => x.key !== key); delete c.PE[key]; }
  return r;
}
/* クラウドの行を端末に取り込む（本物の _applyKvRows） */
async function pull(c, db, key) {
  const r = await db.query("select value::text as v, to_json(updated_at)#>>'{}' as u from app_state where key=$1", [key]);
  return run(c, `_applyKvRows(${JSON.stringify(r.rows.map(x => ({ key, value: JSON.parse(x.v), updated_at: x.u })))})`);
}
const local = (c, k) => JSON.parse(c.S[k]);
function holdFirstRead(c) {
  let release, first = true; const gate = new Promise(r => { release = r; });
  c.hold = async (m, _t, when) => { if (m === 'GET' && when === 'after' && first) { first = false; await gate; } };
  return release;
}
const tick = () => new Promise(r => setImmediate(r));

// ---------- 1. どのキーが対象か ----------
test('which keys get the base-merge: no merge rule, not secure, not split/master/local-only', { skip: !HAS_WB }, async () => {
  const db = await cloudDb(); const c = device(db);
  const yes = ['store_closures', 'ingredient_transfers', 'meetings', 'meeting_minutes', 'shift_sections', 'tip_hours_config', 'm_ingredients_v2', 'ing_v2_seq', 'pl_config',
    'inv_F01', 'inv_recent_codes_F01', 'kpi_config', 'store_positions', 'goals_v2'];
  for (const k of yes) assert.ok(run(c, `wbIsKey(${JSON.stringify(k)})`), 'covered: ' + k);
  const tableOf = k => run(c, `wbTable(${JSON.stringify(k)})`);
  assert.equal(tableOf('store_closures'), 'app_state'); assert.equal(tableOf('kpi_config'), 'app_settings'); assert.equal(tableOf('goals_v2'), 'app_settings');
  // 合流の決まりのあるキー・分けた行・マスター・この端末だけ・直す前の値そのもの
  // dailyops_template_<店> は設定の表だが、合流の決まり（dailyops_）があるので対象の外
  const no = ['dailyops_template_F01', 'initiatives', 'hq_budget', 'budgets_v2', 'inv_count_F01_2026-11', 'inv_hist_F01', 'sl_manual_F01', 'att_fix_F01_2026-11', 'spl_invoices_F01', 'spl_unknown_base_F01', 'invoices', 'store_ingredients',
    'm_stores', 'm_employees', 'kv_seen_v1', 'financial_save_recovery_v2/x', 'whole_base_v1/store_closures', 'nope_unknown_key'];
  for (const k of no) assert.equal(run(c, `wbIsKey(${JSON.stringify(k)})`), false, 'not covered: ' + k);
  // 関数 secure-state で読み書きするキー（v1139〜v1148）は対象の外
  run(c, `function ssIsKey(k){ return k==='growth_karte' || k==='karte_pin'; } function hrIsKey(k){ return k==='applicants' || k==='growthhub'; }
           function gwIsKey(k){ return k==='mileage_config' || k==='prep_tables'; } function csIsKey(k){ return k==='lss_scores'; }`);
  for (const k of ['growth_karte', 'karte_pin', 'applicants', 'growthhub', 'mileage_config', 'lss_scores']) assert.equal(run(c, `wbIsKey(${JSON.stringify(k)})`), false, 'secure: ' + k);
  // 直す前の値の名前は、この端末だけ（送らない・受け取らない）
  assert.ok(run(c, `isLocalOnlyKey('whole_base_v1/store_closures')`)); assert.equal(run(c, `isOpSyncKey('whole_base_v1/meetings')`), false);
  await db.close();
});

// ---------- 2. 重ね方（純粋） ----------
test('wbMerge3: fields, ids, deletes, conflicts, new-on-both records, neighbour placement', { skip: !HAS_WB }, async () => {
  const db = await cloudDb(); const c = device(db);
  const m3 = (b, l, cl, prefer = 'local') => plain(run(c, `(function(){ var st={conf:[],prefer:${JSON.stringify(prefer)}}; var r=wbMerge3(${JSON.stringify(b)}, ${JSON.stringify(l)}, ${JSON.stringify(cl)}, st, ''); return { r:r, conf:st.conf }; })()`));
  // 別の店を直す
  assert.deepEqual(m3({ F01: 1 }, { F01: 1, F02: 2 }, { F01: 1, F03: 3 }).r, { F01: 1, F03: 3, F02: 2 });
  // 手元で消した欄・クラウドで足した欄
  assert.deepEqual(m3({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2, c: 3 }).r, { a: 1, c: 3 });
  // 片方で消し、片方で直した：直した値を残す
  assert.deepEqual(m3({ a: { x: 1 } }, {}, { a: { x: 2 } }).r, { a: { x: 2 } });
  assert.deepEqual(m3({ a: { x: 1 } }, { a: { x: 3 } }, {}).r, { a: { x: 3 } });
  // 同じ所：prefer
  const cf = m3({ s: '17:00' }, { s: '17:30' }, { s: '18:00' }, 'cloud');
  assert.deepEqual(cf.r, { s: '18:00' }); assert.deepEqual(cf.conf, [{ p: '.s', how: 'cloud' }]);
  assert.deepEqual(m3({ s: '17:00' }, { s: '17:30' }, { s: '18:00' }, 'local').r, { s: '17:30' });
  // id の記録の並び：足す・消す・欄ごと
  const B = [{ id: 'a', n: 1, p: 10 }, { id: 'b', n: 2 }];
  assert.deepEqual(m3(B, [{ id: 'a', n: 1, p: 11 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }], [{ id: 'a', n: 9, p: 10 }]).r,
    [{ id: 'a', n: 9, p: 11 }, { id: 'c', n: 3 }]);   // b はクラウドで消えた（手元は変えていない）。a はクラウドの n と手元の p
  // 手元で前に足した（unshift）記録は前に
  assert.deepEqual(m3([{ id: 'x' }], [{ id: 'new' }, { id: 'x' }], [{ id: 'y' }, { id: 'x' }]).r.map(r => r.id), ['y', 'new', 'x']);
  // 両方が同じ id を新しく作った：欄を混ぜない
  const nb = m3([], [{ id: 'v2_5', name: 'Shiso', spec: { pack: 10 } }], [{ id: 'v2_5', name: 'Yuzu', legacyCode: 77 }]);
  assert.deepEqual(nb.r, [{ id: 'v2_5', name: 'Shiso', spec: { pack: 10 } }]); assert.equal(nb.conf.length, 1);
  // id の無い並びは 1 つの値
  assert.deepEqual(m3({ l: [1, 2] }, { l: [1, 2, 3] }, { l: [0, 1, 2] }).r, { l: [1, 2, 3] });
  // 行が無かった（直す前）：両方の入れ物を合わせる
  run(c, 'var __A=WB_ABS'); const r0 = plain(run(c, 'wbMerge3(WB_ABS, {F01:{d:1}}, {F02:{d:2}}, {conf:[]}, "")'));
  assert.deepEqual(r0, { F02: { d: 2 }, F01: { d: 1 } });
  // 通し番号は大きいほう
  assert.equal(run(c, 'wbMergeTop("ing_v2_seq", 10, 12, 15, {conf:[]})'), 15);
  assert.equal(run(c, 'wbMergeTop("ing_v2_seq", 10, 16, 15, {conf:[]})'), 16);
  // id が重なる並びは記録の並びとして扱わない（1 つの値・両方で違えば手元）
  const dup = m3([{ id: 1, a: 1 }, { id: 1, a: 2 }], [{ id: 1, a: 1 }, { id: 1, a: 2 }, { id: 2, a: 3 }], [{ id: 1, a: 9 }, { id: 1, a: 2 }]);
  assert.deepEqual(dup.r, [{ id: 1, a: 1 }, { id: 1, a: 2 }, { id: 2, a: 3 }]);
  assert.deepEqual(dup.conf, [{ p: '', how: 'local' }]);
  await db.close();
});

// ---------- 3. 2 台がほぼ同時に送る（app_state・cas） ----------
test('two devices save different stores of store_closures at the same time: both stay (before: the later one erased the other)', async () => {
  const db = await cloudDb();
  await putCloud(db, 'store_closures', { F01: { '2026-11-20': 'Thanksgiving' } });
  const A = device(db), B = device(db, Date.UTC(2026, 10, 12, 1, 0, 1));
  for (const d of [A, B]) await pull(d, db, 'store_closures');
  const release = holdFirstRead(B);
  const pb = edit(B, 'store_closures', { ...local(B, 'store_closures'), F03: { '2026-11-27': 'Inventory' } });   // B は読んだところで止まる
  await tick(); await tick();
  assert.equal(await edit(A, 'store_closures', { ...local(A, 'store_closures'), F02: { '2026-11-25': 'Staff party' } }), true);
  release();
  assert.equal(await pb, true);
  const cloud = await cloudOf(db, 'store_closures');
  assert.deepEqual(Object.keys(cloud).sort(), ['F01', 'F02', 'F03'], JSON.stringify(cloud));
  assert.deepEqual(Object.keys(local(B, 'store_closures')).sort(), ['F01', 'F02', 'F03'], 'B has the merged value on the device');
  assert.equal(B.S['whole_base_v1/store_closures'], undefined, 'the base is forgotten once sent');
  await db.close();
});

// ---------- 4. 古い写しの端末の送信 ----------
test('a stale device deletes one transfer: the transfer another device added since stays (before: the stale list overwrote it)', async () => {
  const db = await cloudDb();
  await putCloud(db, 'ingredient_transfers', [{ id: 'it_1', from: 'F01', to: 'F02', amt: 40 }, { id: 'it_2', from: 'F02', to: 'F05', amt: 15 }]);
  const A = device(db), B = device(db);
  await pull(A, db, 'ingredient_transfers'); await pull(B, db, 'ingredient_transfers');
  assert.equal(await edit(A, 'ingredient_transfers', [{ id: 'it_3', from: 'F05', to: 'F01', amt: 22 }, ...local(A, 'ingredient_transfers')]), true);
  // B は取り込み直していない（古い写し）。it_1 を消す
  assert.equal(await edit(B, 'ingredient_transfers', local(B, 'ingredient_transfers').filter(t => t.id !== 'it_1')), true);
  const ids = (await cloudOf(db, 'ingredient_transfers')).map(t => t.id);
  assert.deepEqual(ids, ['it_3', 'it_2'], 'it_3 (A) kept, it_1 (B deleted) gone');
  await db.close();
});

// ---------- 5. 送れていない変更があるあいだの取り込み ----------
test('pull while a change is waiting to be sent: the device shows both, and the send keeps both (before: one of them was lost)', async () => {
  const db = await cloudDb();
  await putCloud(db, 'meetings', [{ id: 'm1', title: 'Weekly', date: '2026-11-05' }], '2026-11-12T00:00:00.000Z');
  const A = device(db, Date.UTC(2026, 10, 12, 2)), B = device(db, Date.UTC(2026, 10, 12, 3));
  await pull(A, db, 'meetings'); await pull(B, db, 'meetings');
  await edit(A, 'meetings', [...local(A, 'meetings'), { id: 'm2', title: 'Kaimuki review', date: '2026-11-12' }], { offline: true });   // A は送れなかった
  assert.equal(await edit(B, 'meetings', local(B, 'meetings').map(m => (m.id === 'm1' ? { ...m, minutes: 'Agreed on the ramen menu' } : m))), true);
  await pull(A, db, 'meetings');   // A が取り込む（B の議事録が届く）
  const la = local(A, 'meetings');
  assert.deepEqual(la.map(m => m.id), ['m1', 'm2']);
  assert.equal(la[0].minutes, 'Agreed on the ramen menu', 'A sees B’s change while its own change waits');
  assert.equal(await push(A, 'meetings'), true);
  const cloud = await cloudOf(db, 'meetings');
  assert.deepEqual(cloud.map(m => m.id), ['m1', 'm2']); assert.equal(cloud[0].minutes, 'Agreed on the ramen menu');
  await db.close();
});

// ---------- 6. 同じ所：新しく直したほう ----------
test('both change the same value: the later edit wins (cloud newer → cloud; this device newer → this device), and it is logged', { skip: !HAS_WB }, async () => {
  for (const [aAt, bAt, expect] of [[Date.UTC(2026, 10, 12, 1), Date.UTC(2026, 10, 12, 2), '18:00'], [Date.UTC(2026, 10, 12, 3), Date.UTC(2026, 10, 12, 2), '17:30']]) {
    const db = await cloudDb();
    await putCloud(db, 'tip_hours_config', { F01: { start: '17:00', end: '22:00' } }, '2026-11-12T00:00:00.000Z');
    const A = device(db, aAt), B = device(db, bAt);
    await pull(A, db, 'tip_hours_config'); await pull(B, db, 'tip_hours_config');
    await edit(A, 'tip_hours_config', { F01: { start: '17:30', end: '22:00' } }, { offline: true });
    await edit(B, 'tip_hours_config', { F01: { start: '18:00', end: '23:00' } });
    assert.equal(await push(A, 'tip_hours_config'), true);
    const cloud = await cloudOf(db, 'tip_hours_config');
    assert.equal(cloud.F01.start, expect, 'start');
    assert.equal(cloud.F01.end, '23:00', 'end (only B changed it) stays');
    assert.ok(A.logs.some(m => m.includes('同じ所')), 'logged in Settings › Diagnostics');
    await db.close();
  }
});

// ---------- 7. 片方が消し、片方が直した ----------
test('one deletes a meeting, the other edits it: the edited meeting stays', async () => {
  const db = await cloudDb();
  await putCloud(db, 'meetings', [{ id: 'm1', title: 'Old' }, { id: 'm2', title: 'Keep' }]);
  const A = device(db), B = device(db);
  await pull(A, db, 'meetings'); await pull(B, db, 'meetings');
  await edit(A, 'meetings', local(A, 'meetings').filter(m => m.id !== 'm1'), { offline: true });
  await edit(B, 'meetings', local(B, 'meetings').map(m => (m.id === 'm1' ? { ...m, title: 'Renamed' } : m)));
  await push(A, 'meetings');
  assert.deepEqual((await cloudOf(db, 'meetings')).map(m => m.title), ['Renamed', 'Keep']);
  await db.close();
});

// ---------- 8. 通し番号 ----------
test('ing_v2_seq never goes back (before: a stale device wrote a smaller number)', async () => {
  const db = await cloudDb();
  await putCloud(db, 'ing_v2_seq', 10);
  const A = device(db), B = device(db);
  await pull(A, db, 'ing_v2_seq'); await pull(B, db, 'ing_v2_seq');
  await edit(B, 'ing_v2_seq', 15);
  await edit(A, 'ing_v2_seq', 12);
  assert.equal(await cloudOf(db, 'ing_v2_seq'), 15);
  await db.close();
});

// ---------- 9. 設定（app_settings） ----------
test('a settings key (kpi_config) saved by a stale device keeps the other store’s change (before: overwritten)', async () => {
  const db = await cloudDb();
  await putSetting(db, 'kpi_config', { F01: { fl: 60 }, F02: { fl: 62 } });
  const A = device(db), B = device(db);
  for (const d of [A, B]) { d.S.kpi_config = JSON.stringify(await cloudOf(db, 'kpi_config', 'app_settings')); }
  assert.equal(await edit(A, 'kpi_config', { ...local(A, 'kpi_config'), F01: { fl: 58 } }), true);
  assert.equal(await edit(B, 'kpi_config', { ...local(B, 'kpi_config'), F02: { fl: 61 } }), true);
  assert.deepEqual(await cloudOf(db, 'kpi_config', 'app_settings'), { F01: { fl: 58 }, F02: { fl: 61 } });
  await db.close();
});
test('settings: pending change survives pullSettingKey and is merged (base becomes the cloud value)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putSetting(db, 'store_positions', { F01: ['Grill'], F02: ['Fry'] });
  const A = device(db), B = device(db);
  for (const d of [A, B]) d.S.store_positions = JSON.stringify(await cloudOf(db, 'store_positions', 'app_settings'));
  await edit(A, 'store_positions', { ...local(A, 'store_positions'), F01: ['Grill', 'Sushi'] }, { offline: true });
  await edit(B, 'store_positions', { ...local(B, 'store_positions'), F02: ['Fry', 'Dish'] });
  assert.equal(await run(A, 'pullSettingKey("store_positions")'), true);
  assert.deepEqual(local(A, 'store_positions'), { F01: ['Grill', 'Sushi'], F02: ['Fry', 'Dish'] });
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/store_positions']).t), { F01: ['Grill'], F02: ['Fry', 'Dish'] });
  await push(A, 'store_positions');
  assert.deepEqual(await cloudOf(db, 'store_positions', 'app_settings'), { F01: ['Grill', 'Sushi'], F02: ['Fry', 'Dish'] });
  await db.close();
});

// ---------- 10. 今までどおりの所 ----------
test('no base (a change saved before v1149): sends the whole value as before', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putCloud(db, 'shift_sections', { F01: ['A'], F02: ['B'] });
  const A = device(db);
  A.S.shift_sections = JSON.stringify({ F01: ['A', 'C'] });   // 前の版で送れなかった値（直す前の値は無い）
  A.OB.push({ key: 'shift_sections', who: 'me' });
  assert.equal(await push(A, 'shift_sections'), true);
  assert.deepEqual(await cloudOf(db, 'shift_sections'), { F01: ['A', 'C'] }, 'whole value, same as v1148');
  await db.close();
});
test('nothing changed since the base: the send writes nothing (does not undo others’ changes)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putCloud(db, 'pl_overrides', { F01: { rent: 5000 } });
  const A = device(db), B = device(db);
  await pull(A, db, 'pl_overrides'); await pull(B, db, 'pl_overrides');
  await edit(A, 'pl_overrides', { F01: { rent: 5200 } }, { offline: true });
  await edit(A, 'pl_overrides', { F01: { rent: 5000 } }, { offline: true });   // 戻した（中身は直す前と同じ）
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/pl_overrides']).t), { F01: { rent: 5000 } }, 'the base stays the value before the first edit');
  await edit(B, 'pl_overrides', { F01: { rent: 5000 }, F02: { rent: 4100 } });
  const w = A.writes;
  assert.equal(await push(A, 'pl_overrides'), true);
  assert.equal(A.writes, w, 'no write');
  assert.deepEqual(await cloudOf(db, 'pl_overrides'), { F01: { rent: 5000 }, F02: { rent: 4100 } });
  assert.deepEqual(local(A, 'pl_overrides'), { F01: { rent: 5000 }, F02: { rent: 4100 } }, 'the device takes the cloud value');
  await db.close();
});
test('a base left behind without anything to send is dropped at the next pull (the cloud value is taken as before)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putCloud(db, 'resp_matrix', { F01: { gm: 'Moto' } });
  const A = device(db);
  await pull(A, db, 'resp_matrix');
  A.S['whole_base_v1/resp_matrix'] = JSON.stringify({ v: 1, t: JSON.stringify({ F01: { gm: 'Old' } }), at: 1 });
  A.S.resp_matrix = JSON.stringify({ F01: { gm: 'Local only' } });
  await putCloud(db, 'resp_matrix', { F01: { gm: 'Moto' }, F02: { gm: 'Yuki' } }, '2026-11-12T05:00:00.000Z');
  await pull(A, db, 'resp_matrix');
  assert.deepEqual(local(A, 'resp_matrix'), { F01: { gm: 'Moto' }, F02: { gm: 'Yuki' } });
  assert.equal(A.S['whole_base_v1/resp_matrix'], undefined);
  await db.close();
});
test('editing again while the send is on the way: the new edit is kept and sent next, on top of what was written', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putCloud(db, 'shift_headcount', { F01: { lunch: 4 } });
  const A = device(db), B = device(db);
  await pull(A, db, 'shift_headcount'); await pull(B, db, 'shift_headcount');
  await edit(B, 'shift_headcount', { F01: { lunch: 4 }, F05: { lunch: 3 } });
  const release = holdFirstRead(A);
  const p1 = edit(A, 'shift_headcount', { F01: { lunch: 5 } });
  await tick(); await tick();
  // 送っている途中に、また直す（本物の lsSet と同じく、直す前の値はもうあるのでそのまま）
  const prev = A._lsStoreGet('shift_headcount'); A.wbOnEdit('shift_headcount', prev, JSON.stringify({ F01: { lunch: 5, dinner: 6 } }));
  A.S.shift_headcount = JSON.stringify({ F01: { lunch: 5, dinner: 6 } });
  release();
  assert.equal(await p1, true);
  assert.deepEqual(local(A, 'shift_headcount'), { F01: { lunch: 5, dinner: 6 }, F05: { lunch: 3 } }, 'device: new edit kept, B’s store merged in');
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/shift_headcount']).t), { F01: { lunch: 5 }, F05: { lunch: 3 } }, 'base = what was written');
  assert.equal(await push(A, 'shift_headcount'), true);
  assert.deepEqual(await cloudOf(db, 'shift_headcount'), { F01: { lunch: 5, dinner: 6 }, F05: { lunch: 3 } });
  await db.close();
});
test('a pull that comes while the key is being sent keeps the device value (same as v1136)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putCloud(db, 'shift_postime', { F01: '10:00' });
  const A = device(db);
  await pull(A, db, 'shift_postime');
  await edit(A, 'shift_postime', { F01: '10:30' }, { offline: true });
  A.busy.shift_postime = 1;
  await putCloud(db, 'shift_postime', { F01: '10:00', F02: '9:00' }, '2026-11-12T06:00:00.000Z');
  await pull(A, db, 'shift_postime');
  assert.deepEqual(local(A, 'shift_postime'), { F01: '10:30' });
  await db.close();
});

// ---------- 12. pullOpKey（1 つのキーの取り込み）も同じ ----------
test('pullOpKey while a change is waiting: merges, and the base becomes the cloud value', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const A = device(db), B = device(db);
  await pull(A, db, K); await pull(B, db, K);
  await edit(A, K, { F01: { '2026-11-20': 'Thanksgiving' }, F02: { '2026-11-25': 'Party' } }, { offline: true });
  assert.equal(await edit(B, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } }), true);
  A.FUNERGY_FINANCIAL_SAVE = null;
  assert.equal(await run(A, 'pullOpKey("store_closures")'), true);
  const both = { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' }, F02: { '2026-11-25': 'Party' } };
  assert.deepEqual(local(A, K), both);
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/' + K]).t), { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } });
  await push(A, K);
  assert.deepEqual(await cloudOf(db, K), both);
  await db.close();
});

// ---------- 13. 覚えないとき ----------
test('no base while the app is starting up or sync is off (those saves are not sent, as before)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const A = device(db);
  A.S.store_closures = JSON.stringify({ F01: {} });
  A._supaBooting = true; A.wbOnEdit('store_closures', A.S.store_closures, JSON.stringify({ F01: { x: 1 } }));
  assert.equal(A.S['whole_base_v1/store_closures'], undefined, 'booting');
  A._supaBooting = false; A.SUPA_SYNC_ENABLED = false; A.wbOnEdit('store_closures', A.S.store_closures, JSON.stringify({ F01: { x: 1 } }));
  assert.equal(A.S['whole_base_v1/store_closures'], undefined, 'sync off');
  A.SUPA_SYNC_ENABLED = true; A.wbOnEdit('store_closures', A.S.store_closures, A.S.store_closures);
  assert.equal(A.S['whole_base_v1/store_closures'], undefined, 'same text');
  A.wbOnEdit('m_stores', '[]', '[1]'); A.wbOnEdit('initiatives', '[]', '[1]');
  assert.equal(A.S['whole_base_v1/m_stores'], undefined); assert.equal(A.S['whole_base_v1/initiatives'], undefined, 'keys with a merge rule are left as they are');
  A.wbOnEdit('store_closures', A.S.store_closures, JSON.stringify({ F01: { x: 1 } }));
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/store_closures']).t), { F01: {} });
  await db.close();
});

// ---------- 11. 本物の lsSet に入っている ----------
test('after a pull, the base is the pulled cloud value: a later removal on another device is not undone by this device', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const A = device(db), B = device(db);
  await pull(A, db, K); await pull(B, db, K);
  await edit(A, K, { ...local(A, K), F02: { '2026-11-25': 'Party' } }, { offline: true });
  assert.equal(await edit(B, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } }), true);
  await pull(A, db, K);                                                     // A は B の Christmas を受け取る
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/' + K]).t), { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } });
  assert.equal(await edit(B, K, { F01: { '2026-11-20': 'Thanksgiving' } }), true);   // B が Christmas を取り消す
  assert.equal(await push(A, K), true);
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving' }, F02: { '2026-11-25': 'Party' } }, 'B’s removal stays; A’s F02 is added');
  await db.close();
});
test('the cloud cannot be read: nothing is written, the change stays unsent with its base, and the next send merges', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const A = device(db), B = device(db);
  await pull(A, db, K); await pull(B, db, K);
  A.hold = async (m) => { if (m === 'GET') throw new Error('network down'); };
  assert.equal(await edit(A, K, { ...local(A, K), F02: { '2026-11-25': 'Party' } }), false);
  assert.match(A._opLastPushErr[K], /読めなかった/);
  assert.ok(A.OB.some(x => x.key === K), 'stays unsent');
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/' + K]).t), { F01: { '2026-11-20': 'Thanksgiving' } }, 'base kept');
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving' } }, 'nothing written');
  assert.equal(await edit(B, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } }), true);
  A.hold = null;
  assert.equal(await push(A, K), true);
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' }, F02: { '2026-11-25': 'Party' } });
  await db.close();
});
test('settings: another device overwrites between our write and the read-back: merged again, both stay', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  await putSetting(db, 'kpi_config', { F01: { fl: 60 } });
  const A = device(db);
  A.S.kpi_config = JSON.stringify({ F01: { fl: 60 } });
  await edit(A, 'kpi_config', { F01: { fl: 60 }, F02: { fl: 62 } }, { offline: true });
  let gets = 0;
  A.hold = async (m, t, when) => {
    if (t !== 'app_settings' || m !== 'GET' || when !== 'before') return;
    gets++;
    if (gets === 2) await putSetting(db, 'kpi_config', { F01: { fl: 60 }, F03: { fl: 55 } });   // 古い写しの端末（v1148）が丸ごと書いた
  };
  assert.equal(await push(A, 'kpi_config'), true);
  assert.ok(gets >= 4, 'read back, saw a different value, merged and wrote again');
  assert.deepEqual(await cloudOf(db, 'kpi_config', 'app_settings'), { F01: { fl: 60 }, F02: { fl: 62 }, F03: { fl: 55 } });
  await db.close();
});
test('pull while a change is waiting, but the device cannot store the merged value: the base stays the old one (no false “others’ change” later)', { skip: !HAS_WB }, async () => {
  const db = await cloudDb();
  const K = 'store_closures';
  await putCloud(db, K, { F01: { '2026-11-20': 'Thanksgiving' } });
  const A = device(db), B = device(db);
  await pull(A, db, K); await pull(B, db, K);
  await edit(A, K, { ...local(A, K), F02: { '2026-11-25': 'Party' } }, { offline: true });
  await edit(B, K, { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' } });
  const realWrite = A._lsWriteVerified;
  A._lsWriteVerified = (k, j) => (k === K ? false : realWrite(k, j));   // 端末の保存がいっぱい
  await pull(A, db, K);
  A._lsWriteVerified = realWrite;
  assert.deepEqual(local(A, K), { F01: { '2026-11-20': 'Thanksgiving' }, F02: { '2026-11-25': 'Party' } }, 'device value unchanged');
  assert.deepEqual(JSON.parse(JSON.parse(A.S['whole_base_v1/' + K]).t), { F01: { '2026-11-20': 'Thanksgiving' } }, 'base not moved to the cloud value');
  assert.equal(await push(A, K), true);
  assert.deepEqual(await cloudOf(db, K), { F01: { '2026-11-20': 'Thanksgiving', '2026-12-25': 'Christmas' }, F02: { '2026-11-25': 'Party' } }, 'B’s change stays');
  await db.close();
});
test('lsSet remembers the value before the edit, before writing (source)', { skip: !HAS_WB }, () => {
  const ls = SRC.slice(SRC.indexOf('function lsSet(key, val) {'), SRC.indexOf('}).apply(this,arguments);', SRC.indexOf('function lsSet(key, val) {')));
  const a = ls.indexOf('wbOnEdit(key, _prevTxt, _json)'), b = ls.indexOf('var _ok=_lsWriteVerified(key, _json);');
  assert.ok(a > 0 && b > a, 'wbOnEdit is called with the previous text before the write');
  const sm = fnSrc('syncMasterToSupabase');
  assert.ok(sm.indexOf('wbPush(key)') > sm.indexOf('_opMergeDef(key)') && sm.indexOf('wbPush(key)') < sm.indexOf("supaUpsert('app_state'"), 'app_state send goes through wbPush before the whole upsert');
  assert.ok(sm.indexOf("wbPush(key)") < sm.indexOf("supaUpsert('app_settings'"), 'settings send goes through wbPush before the whole upsert');
  for (const f of ['_applyKvRows', 'pullOpKey', 'pullSettingKey', 'supaPullAllMasters']) assert.ok(/wbIncoming\(/.test(fnSrc(f)), f + ' merges pending changes');
});
