// v1136：Codex のレビュー（#130 コメント 6627627177・#131 6627869364）の P2 2 件の再現と直しの確かめ。
//   P2-1 新しい 5 つの同期の記録（dev_pipe・dev_pipe_start・att_fix_・tip_cf_・kpi_man_）は、2 台が同じ古い行を読んで続けて書くと、
//        両方「保存しました」でも先の書き込みがクラウドから消えた（読んだ行が変わっていないときだけ書く cas が無かった）
//   P2-2 育成の記録のスキル Lv・カリキュラムは欄全体に 1 つの時刻で、別々の項目を 2 台で直すと、あとの保存が先の変更を戻した
// 本物の関数（index.html の opMergePush・_fetchOpRow・_opCasWrite・合流・getDevData／setDevData など）を VM で動かし、
// クラウドは PGlite（jsonb）の app_state。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) return '';   // 前の版に無い関数（_fsObj など）は無いまま動かす
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
const varLine = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); assert.ok(m, name); return m[0]; };
// 本物の合流の決まり（OP_MERGE・OP_MERGE_PREFIX の宣言の行）
function ruleOf(name) {
  const m = new RegExp("^\\s*'?" + name + "'?:\\s*\\{\\s*merge:\\s*([A-Za-z_$][\\w$]*)\\s*,\\s*covers:\\s*([A-Za-z_$][\\w$]*)\\s*(,[^}]*)?\\}", 'm').exec(SRC);
  assert.ok(m, 'rule: ' + name);
  const rest = m[3] || '';
  return { merge: m[1], covers: m[2], keepLocal: /keepLocal:\s*true/.test(rest), strict: /strict:\s*true/.test(rest), cas: /cas:\s*true/.test(rest) };
}
const RULES = { dev_pipe: ruleOf('dev_pipe'), dev_pipe_start: ruleOf('dev_pipe_start'), att_fix_: ruleOf('att_fix_'), tip_cf_: ruleOf('tip_cf_'), kpi_man_: ruleOf('kpi_man_') };
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);

const FNS = ['_cjson', '_lrObj', '_lrOwn', '_lrAt', '_lrPick', 'mergeLocalRecMap', '_coversLocalRecMap', '_fsHas', '_fsT', '_fsFields', '_fsObj', '_fsFiOf', '_fsSubT', '_fsCont', '_fsSubs',
  '_fsTie', '_fsRecWin', '_fsSameEntry', '_fsFill', 'mergeFieldStampRec', 'mergeFieldStampMap', '_coversFieldStampMap', '_fsStamp', '_lrStamp', 'v1136Moved',
  '_devDataRaw', 'getDevData', 'setDevData', 'opMergePush', '_fetchOpValue', '_fetchOpRow', '_opCasWrite', '_casTs', '_tsMicro', '_opWriteBack'];

async function cloudDb() {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table app_state(key text primary key, value jsonb, updated_at timestamptz)');
  return db;
}
const cloudOf = async (db, k) => { const r = await db.query('select value::text as v from app_state where key=$1', [k]); return r.rows.length ? JSON.parse(r.rows[0].v) : null; };

/* 端末 1 台。hold(method)：その通信の答えを返す前に待つ（読んだあと・書く前に、ほかの端末を割り込ませる） */
function device(db, now = Date.UTC(2026, 10, 3, 20)) {
  const S = {};
  const c = {
    console: { log() {}, warn() {}, error() {} }, S, NOW: now, SUPABASE_URL: 'https://cloud.invalid', AbortController, setTimeout, clearTimeout,
    _opMergeChain: {}, _opLastPushErr: {}, _opLastPushWhy: {}, hold: null, gets: 0, writes: 0,
    ls: (k, d) => (k in S ? plain(S[k]) : d), _lsRaw: (k, d) => (k in S ? plain(S[k]) : d), _lsStoreGet: k => (k in S ? JSON.stringify(S[k]) : null),
    _lsWriteVerified: (k, j) => { S[k] = JSON.parse(j); return true; }, lsSet: (k, v) => { S[k] = plain(v); return true; },
    localStorage: { getItem: k => (k === '_v1136_moved' ? '1' : null), setItem() {} },
    supaHeaders: () => ({}),
    supaUpsert: async (_t, rows) => {
      c.writes++;
      for (const r of rows) await db.query('insert into app_state(key,value,updated_at) values($1,$2,coalesce($3::timestamptz, now())) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at', [r.key, JSON.stringify(r.value), r.updated_at || null]);
      return true;
    },
    _opUpsertRow: (k, v) => ({ key: k, value: v, updated_at: new Date(c.NOW).toISOString() }),
    fetch: async (url, o = {}) => {
      const method = (o && o.method) || 'GET';
      const k = method === 'POST' ? JSON.parse(o.body).key : decodeURIComponent(/key=eq\.([^&]+)/.exec(url)[1]);
      let res;
      if (method === 'PATCH') {
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
        c.gets++;
        const r = await db.query("select value::text as v, to_json(updated_at)#>>'{}' as u from app_state where key=$1", [k]);
        const rows = r.rows.map(x => (/updated_at/.test(url) ? { value: JSON.parse(x.v), updated_at: x.u } : { value: JSON.parse(x.v) }));
        res = { ok: true, status: 200, json: async () => rows };
      }
      if (c.hold) await c.hold(method);
      return res;
    },
  };
  vm.createContext(c);
  run(c, [varLine('_OP_READ_TMO'), ...FNS.map(fnSrc)].join('\n') + `
    Date.now = function(){ return NOW; };
    var DEFS = ${JSON.stringify(RULES)};
    function _opMergeDef(k){
      var d = DEFS[k]; if(!d){ for (var p in DEFS) if (p.slice(-1)==='_' && k.indexOf(p)===0) d = DEFS[p]; }
      return d ? { merge: eval(d.merge), covers: eval(d.covers), keepLocal: d.keepLocal, strict: d.strict, cas: d.cas } : null;
    }`);
  return c;
}

/* 読んだあとに 1 回だけ止まる（ほかの端末をそのあいだに書かせる） */
function holdAfterFirstRead(c) {
  let release, first = true; const gate = new Promise(r => { release = r; });
  c.hold = async m => { if (m === 'GET' && first) { first = false; await gate; } };
  return release;
}

const CASES = [
  { key: 'dev_pipe', a: { Ken: { stage: 2, _ft: { stage: 100 }, _at: 100 } }, b: { Amy: { stage: 1, _ft: { stage: 200 }, _at: 200 } } },
  { key: 'dev_pipe_start', a: { Ken: { d: '2026-10-01', _ft: { d: 100 }, _at: 100 } }, b: { Amy: { d: '2026-10-05', _ft: { d: 200 }, _at: 200 } } },
  { key: 'att_fix_F01_2026-11', a: { '2026-11-01': { data: [{ n: 'Ken', h: 6 }], _at: 100 } }, b: { '2026-11-02': { data: [{ n: 'Amy', h: 5 }], _at: 200 } } },
  { key: 'tip_cf_F01_2026', a: { '2026-10-16': { by: 'GM', _at: 100 } }, b: { '2026-11-01': { by: 'AM', _at: 200 } } },
  { key: 'kpi_man_2026.11', a: { F01: { repeatRate: 31, _ft: { repeatRate: 100 }, _at: 100 } }, b: { F02: { repeatRate: 28, _ft: { repeatRate: 200 }, _at: 200 } } },
];

test('P2-1: the five new keys write only when the row is still what was read (cas)', () => {
  for (const k of Object.keys(RULES)) assert.equal(RULES[k].cas, true, k);
});

for (const C of CASES) {
  test(`P2-1 (Codex's order): ${C.key} — both devices read the same (no) row, A writes and checks, then B writes: both stay in the cloud`, async () => {
    const db = await cloudDb();
    const A = device(db), B = device(db);
    A.S[C.key] = plain(C.a); B.S[C.key] = plain(C.b);
    const release = holdAfterFirstRead(B);
    const pb = run(B, `opMergePush(${JSON.stringify(C.key)}, ls(${JSON.stringify(C.key)}, null))`);   // B has read: no row
    await new Promise(r => setImmediate(r));
    assert.equal(await run(A, `opMergePush(${JSON.stringify(C.key)}, ls(${JSON.stringify(C.key)}, null))`), true, 'A saved');
    release();
    assert.equal(await pb, true, 'B saved');
    const cloud = await cloudOf(db, C.key);
    for (const id of [...Object.keys(C.a), ...Object.keys(C.b)]) assert.ok(cloud[id], `${C.key}: ${id} is in the cloud (before the fix only B's was)`);
    assert.ok(Object.keys(B.S[C.key]).length >= 2, 'B now has both on the device too');
    await db.close();
  });

  test(`P2-1: ${C.key} — both devices read the same existing row: the later write reads again and keeps the earlier one`, async () => {
    const db = await cloudDb();
    await db.query("insert into app_state values($1,$2,'2026-11-03T10:00:00.123456Z')", [C.key, JSON.stringify({})]);
    const A = device(db), B = device(db);
    A.S[C.key] = plain(C.a); B.S[C.key] = plain(C.b);
    const release = holdAfterFirstRead(B);
    const pb = run(B, `opMergePush(${JSON.stringify(C.key)}, ls(${JSON.stringify(C.key)}, null))`);
    await new Promise(r => setImmediate(r));
    assert.equal(await run(A, `opMergePush(${JSON.stringify(C.key)}, ls(${JSON.stringify(C.key)}, null))`), true);
    release();
    assert.equal(await pb, true);
    const cloud = await cloudOf(db, C.key);
    for (const id of [...Object.keys(C.a), ...Object.keys(C.b)]) assert.ok(cloud[id], `${C.key}: ${id} stays`);
    assert.ok(B.gets >= 2, 'B read the row again after its first write was refused');
    await db.close();
  });
}

test('P2-1: a cloud that cannot be read is not written (strict, as before)', async () => {
  const db = await cloudDb();
  const A = device(db);
  A.S.dev_pipe = { Ken: { stage: 2, _ft: { stage: 100 }, _at: 100 } };
  A.fetch = async () => { throw new Error('offline'); };
  assert.equal(await run(A, `opMergePush('dev_pipe', ls('dev_pipe', null))`), false);
  assert.equal(await cloudOf(db, 'dev_pipe'), null);
  await db.close();
});

/* ------------------------------------------------------------------ P2-2 */
const base = { stage: 2, skillLevels: { Grill: 1, Fry: 1 }, curriculum: { Knife: false, Sauce: false }, tests: [], retrain: [] };

test("P2-2 (Codex's example): A changes Grill and Knife, B later changes Fry and Sauce — all four changes stay, in either merge order", async () => {
  const db = await cloudDb();
  const A = device(db, 500), B = device(db, 500);
  run(A, `setDevData('Ken', ${JSON.stringify(base)})`);
  B.S.dev_pipe = plain(A.S.dev_pipe);
  A.NOW = 1000; run(A, `var d=getDevData('Ken'); d.skillLevels.Grill=3; d.curriculum.Knife=true; setDevData('Ken', d);`);
  B.NOW = 2000; run(B, `var d=getDevData('Ken'); d.skillLevels.Fry=2; d.curriculum.Sauce=true; setDevData('Ken', d);`);
  const want = { Grill: 3, Fry: 2, Knife: true, Sauce: true };
  for (const [x, y] of [[A, B], [B, A]]) {
    const m = plain(run(A, `mergeFieldStampMap(${JSON.stringify(x.S.dev_pipe)}, ${JSON.stringify(y.S.dev_pipe)})`)).Ken;
    assert.deepEqual({ ...m.skillLevels, ...m.curriculum }, want);
    assert.equal(run(A, `_coversFieldStampMap(${JSON.stringify({ Ken: m })}, ${JSON.stringify(x.S.dev_pipe)})`), true, 'covers what each device sent');
  }
  // 端末の画面には時刻の印が見えない
  A.S.dev_pipe = plain(run(A, `mergeFieldStampMap(${JSON.stringify(A.S.dev_pipe)}, ${JSON.stringify(B.S.dev_pipe)})`));
  assert.deepEqual(Object.keys(plain(run(A, `getDevData('Ken')`))).filter(k => k.startsWith('_')), []);
  // クラウドを通して（cas）：2 台が同じ行を読んで続けて送っても同じ
  const db2 = await cloudDb();
  const A2 = device(db2, 500), B2 = device(db2, 500);
  run(A2, `setDevData('Ken', ${JSON.stringify(base)})`); B2.S.dev_pipe = plain(A2.S.dev_pipe);
  assert.equal(await run(A2, `opMergePush('dev_pipe', ls('dev_pipe', null))`), true);
  A2.NOW = 1000; run(A2, `var d=getDevData('Ken'); d.skillLevels.Grill=3; d.curriculum.Knife=true; setDevData('Ken', d);`);
  B2.NOW = 2000; run(B2, `var d=getDevData('Ken'); d.skillLevels.Fry=2; d.curriculum.Sauce=true; setDevData('Ken', d);`);
  const release = holdAfterFirstRead(B2);
  const pb = run(B2, `opMergePush('dev_pipe', ls('dev_pipe', null))`);
  await new Promise(r => setImmediate(r));
  assert.equal(await run(A2, `opMergePush('dev_pipe', ls('dev_pipe', null))`), true);
  release(); assert.equal(await pb, true);
  const k = (await cloudOf(db2, 'dev_pipe')).Ken;
  assert.deepEqual({ ...k.skillLevels, ...k.curriculum }, want);
  await db.close(); await db2.close();
});

test('P2-2: the same item changed on two devices — the later change wins (a curriculum item turned back off stays off)', () => {
  const A = device(null, 500), B = device(null, 500);
  run(A, `setDevData('Ken', ${JSON.stringify(base)})`); B.S.dev_pipe = plain(A.S.dev_pipe);
  A.NOW = 1000; run(A, `var d=getDevData('Ken'); d.skillLevels.Grill=3; d.curriculum.Knife=true; setDevData('Ken', d);`);
  B.NOW = 2000; run(B, `var d=getDevData('Ken'); d.skillLevels.Grill=2; setDevData('Ken', d);`);
  let m = plain(run(A, `mergeFieldStampMap(${JSON.stringify(A.S.dev_pipe)}, ${JSON.stringify(B.S.dev_pipe)})`));
  assert.equal(m.Ken.skillLevels.Grill, 2); assert.equal(m.Ken.curriculum.Knife, true);
  // B が受け取ったあと、Knife を戻す（あとの変更）→ A の古い true は戻らない
  B.S.dev_pipe = m; B.NOW = 3000; run(B, `var d=getDevData('Ken'); d.curriculum.Knife=false; setDevData('Ken', d);`);
  m = plain(run(A, `mergeFieldStampMap(${JSON.stringify(A.S.dev_pipe)}, ${JSON.stringify(B.S.dev_pipe)})`));
  assert.equal(m.Ken.curriculum.Knife, false);
  // 時計の遅れた端末でも、読んだ記録より後の時刻で直す（見てから直した項目が勝つ）
  const C = device(null, 10); C.S.dev_pipe = plain(m);
  run(C, `var d=getDevData('Ken'); d.skillLevels.Fry=4; setDevData('Ken', d);`);
  const m2 = plain(run(C, `mergeFieldStampMap(${JSON.stringify(m)}, ${JSON.stringify(C.S.dev_pipe)})`));
  assert.equal(m2.Ken.skillLevels.Fry, 4); assert.equal(m2.Ken.skillLevels.Grill, 2);
  // 何も変えずに保存しても時刻は進まない
  const before = JSON.stringify(C.S.dev_pipe); run(C, `setDevData('Ken', getDevData('Ken'))`);
  assert.equal(JSON.stringify(C.S.dev_pipe), before);
});

test('P2-2: tests recorded for the same person on two devices both stay; the newer one is last (the screens read the last as the latest)', () => {
  const A = device(null, 500), B = device(null, 500);
  run(A, `setDevData('Ken', ${JSON.stringify({ ...base, tests: [{ course: 'Grill', score: 60, date: '2026/10/01' }] })})`); B.S.dev_pipe = plain(A.S.dev_pipe);
  A.NOW = 1000; run(A, `var d=getDevData('Ken'); d.tests.push({ course:'Fry', score:85, date:'2026/11/03' }); setDevData('Ken', d);`);
  B.NOW = 2000; run(B, `var d=getDevData('Ken'); d.tests.push({ course:'Grill', score:95, date:'2026/11/03' }); setDevData('Ken', d);`);
  for (const [x, y] of [[A, B], [B, A]]) {
    const t = plain(run(A, `mergeFieldStampMap(${JSON.stringify(x.S.dev_pipe)}, ${JSON.stringify(y.S.dev_pipe)})`)).Ken.tests;
    assert.equal(t.length, 3);
    assert.deepEqual(t.map(r => r.score).sort((p, q) => p - q), [60, 85, 95]);
    assert.equal(t[t.length - 1].score, 95, 'the newest test is last');
  }
});

/* 3 台がばらばらに直して、ばらばらに同期する（合成）：どの項目も、いちばんあとで直した値になり、どのテストも残り、全部の端末がそろう */
let seed = 7; const rnd = n => {   // mulberry32
  seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0; };
test('P2-2: three devices editing and syncing in random order converge, and every item keeps its latest change', () => {
  const ctx = device(null, 1);
  const M = (a, b) => plain(run(ctx, `mergeFieldStampMap(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
  const SK = ['Grill', 'Fry', 'Knife', 'Sauce'], CU = ['c1', 'c2', 'c3'], PEOPLE = ['Ken', 'Amy'];
  for (let round = 0; round < 40; round++) {
    let clock = 100, cloud = {};
    const devs = [device(null, 1), device(null, 1), device(null, 1)];
    const last = {}, tests = new Set();
    for (let step = 0; step < 60; step++) {
      const d = devs[rnd(3)];
      if (rnd(3) === 0) { const m = M(cloud, d.S.dev_pipe || {}); cloud = m; d.S.dev_pipe = plain(m); continue; }   // 同期
      d.NOW = ++clock;
      const who = PEOPLE[rnd(2)], kind = rnd(3);
      const before = JSON.stringify(d.S.dev_pipe || {});
      if (kind === 0) { const s = SK[rnd(4)], v = 1 + rnd(4); run(d, `var x=getDevData(${JSON.stringify(who)}); x.skillLevels[${JSON.stringify(s)}]=${v}; setDevData(${JSON.stringify(who)}, x);`);
        if (JSON.stringify(d.S.dev_pipe) !== before) last[who + '.s.' + s] = v; }
      else if (kind === 1) { const s = CU[rnd(3)]; run(d, `var x=getDevData(${JSON.stringify(who)}); x.curriculum[${JSON.stringify(s)}]=!x.curriculum[${JSON.stringify(s)}]; setDevData(${JSON.stringify(who)}, x);`);
        last[who + '.c.' + s] = plain(run(d, `getDevData(${JSON.stringify(who)})`)).curriculum[s]; }
      else { const id = 'T' + step; run(d, `var x=getDevData(${JSON.stringify(who)}); x.tests.push({ course:${JSON.stringify(id)}, score:${rnd(100)} }); setDevData(${JSON.stringify(who)}, x);`); tests.add(who + '.' + id); }
    }
    for (let r = 0; r < 2; r++) for (const d of devs) { cloud = M(cloud, d.S.dev_pipe || {}); d.S.dev_pipe = plain(cloud); }
    const cj = run(ctx, `_cjson(${JSON.stringify(cloud)})`);
    for (const d of devs) assert.equal(run(ctx, `_cjson(${JSON.stringify(d.S.dev_pipe)})`), cj, 'all devices agree');
    for (const [k, v] of Object.entries(last)) {
      const [who, t, s] = k.split('.'); const rec = cloud[who] || {};
      assert.deepEqual((t === 's' ? rec.skillLevels : rec.curriculum)[s], v, 'latest change kept: ' + k + ' round ' + round);
    }
    for (const k of tests) { const [who, id] = k.split('.'); assert.ok((cloud[who].tests || []).some(x => x.course === id), 'test kept: ' + k); }
    assert.equal(run(ctx, `_cjson(mergeFieldStampMap(${JSON.stringify(cloud)}, ${JSON.stringify(cloud)}))`), cj, 'idempotent');
  }
});

test('P2-1: the one-time upload of device data writes the cas keys only through the conditional write (never whole)', async () => {
  const db = await cloudDb();
  const A = device(db);
  A.S.dev_pipe = { Ken: { stage: 2, _ft: { stage: 100 }, _at: 100 } };
  A.S.m_other = { x: 1 };
  run(A, fnSrc('migrateUploadLocalOps'));
  const keys = Object.keys(A.S);
  Object.assign(A, { _supaBooting: false, isOpSyncKey: () => true, upserted: [],
    localStorage: { length: keys.length, key: i => keys[i], getItem: k => (k === '_v1136_moved' ? '1' : null), setItem() {} } });
  // 一覧を読んだあとに、ほかの端末が dev_pipe を作る
  A.supaFetchAll = async () => { await db.query("insert into app_state values('dev_pipe', $1, now())", [JSON.stringify({ Amy: { stage: 1, _ft: { stage: 200 }, _at: 200 } })]); return []; };
  const up = A.supaUpsert; A.supaUpsert = async (t, rows) => { A.upserted.push(...rows.map(r => r.key)); return up(t, rows); };
  await run(A, 'migrateUploadLocalOps()');
  assert.deepEqual(A.upserted, ['m_other'], 'only the key without cas is upserted whole');
  const cloud = await cloudOf(db, 'dev_pipe');
  assert.ok(cloud.Ken && cloud.Amy, 'the row another device made is kept');
  await db.close();
});

test('P2-2: item times in detail — fields stamped before item times, deleted fields, covers per item, stamps never taken from the screen', () => {
  const c = device(null, 100);
  const M = (a, b) => plain(run(c, `mergeFieldStampRec(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
  const CV = (h, w) => run(c, `_coversFieldStampMap(${JSON.stringify({ P: h })}, ${JSON.stringify({ P: w })})`);
  // 欄の時刻だけ（_fi の無い）入れ物：欄の時刻をどの項目にも使う（前の版の記録＝時刻 0 には勝つ）
  assert.deepEqual(M({ x: { a: 1 }, _ft: { x: 5 } }, { x: { a: 9 } }).x, { a: 1 });
  // そういう記録の 1 項目を直しても、触っていない項目は欄の時刻のまま（時刻 0 にならない）
  c.NOW = 10;
  const st = plain(run(c, `_fsStamp({ x: { a: 1, b: 1 }, _ft: { x: 5 } }, { x: { a: 1, b: 2 } })`));
  assert.deepEqual(st._fi.x, { a: 5, b: 10 });
  assert.deepEqual(M(st, { x: { a: 9 } }).x, { a: 1, b: 2 });
  // 項目の時刻の入れ物があれば、欄の時刻を項目に使わない（合流の答えにも残す）
  const r1 = M({ x: { a: 1 }, _ft: { x: 5 }, _fi: { x: {} } }, { x: { a: 2 } });
  assert.deepEqual(r1._fi, { x: {} });
  assert.equal(M(r1, { x: { a: 3 }, _ft: { x: 3 }, _fi: { x: { a: 3 } } }).x.a, 3);
  // 新しいほうが欄ごと消した入れ物は消えたまま（同じ時刻ならどちらかにあれば残す）
  assert.ok(!('x' in M({ x: {}, _ft: { x: 1 }, _fi: { x: {} } }, { _ft: { x: 2 }, _fi: { x: {} } })));
  assert.deepEqual(M({ x: {}, _ft: { x: 2 }, _fi: { x: {} } }, { _ft: { x: 2 }, _fi: { x: {} } }).x, {});
  // covers：項目が古い・同じ時刻で違う値は covers しない（欄の時刻が新しくても）
  const W = { x: { a: 1, b: 1 }, _ft: { x: 10 }, _fi: { x: { a: 10 } } };
  assert.equal(CV({ x: { a: 0, b: 2 }, _ft: { x: 20 }, _fi: { x: { a: 5, b: 20 } } }, W), false, 'item a is older');
  assert.equal(CV({ x: { a: 2, b: 1 }, _ft: { x: 10 }, _fi: { x: { a: 10 } } }, W), false, 'item a: same time, other value');
  assert.equal(CV({ x: { a: 1, b: 3 }, _ft: { x: 20 }, _fi: { x: { a: 10, b: 20 } } }, W), true);
  // 画面から来た記録に _fi があっても使わない（時刻は前の記録から）
  const s2 = plain(run(c, `_fsStamp({ a: 1, _ft: { a: 1 } }, { a: 2, _fi: { x: { y: 99 } } })`));
  assert.ok(!('_fi' in s2), JSON.stringify(s2));
});
