// PR #194（v1191）の Codex P2-2：FUNERGY TIMES の設定を 2 台（CEO・GM）が同じ古い値から保存しても、先に保存した設定が消えない。
// 本物の saveTimesSettings・timesCfg と、本物の送り方（opMergePush の cas・_fetchOpRow・_opCasWrite・本物の合流の決まり mergeMapByTime）を
// 2 つの VM で動かし、クラウドは PGlite（jsonb）の app_state。合成データだけ。本番にはつながない。
// FUNERGY_INDEX に v1191 の最初の head（ced90be）の index.html を渡すと落ちる（前は手元の前の値だけで履歴を作り、合流の決まりも無かった）。
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
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);

const FNS_OLD = ['_cjson', '_lrObj', '_lrOwn', '_lrAt', '_lrPick', 'mergeLocalRecMap', '_coversLocalRecMap', '_fsHas', '_fsT', '_fsFields', '_fsObj', '_fsFiOf', '_fsSubT', '_fsCont', '_fsSubs',
  '_fsElemT', '_fsOrder', '_fsTie', '_fsRecWin', '_fsSameEntry', '_fsFill', 'mergeFieldStampRec', 'mergeFieldStampMap', '_coversFieldStampMap', '_fsStamp', '_lrStamp', 'v1136Moved',
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
  run(c, [varLine('_OP_READ_TMO'), ...FNS.map(fnSrc)].filter(Boolean).join('\n') + `
    Date.now = function(){ return NOW; };
    var DEFS = ${JSON.stringify(RULES)};
    function _opMergeDef(k){
      var d = DEFS[k]; if(!d){ for (var p in DEFS) if (p.slice(-1)==='_' && k.indexOf(p)===0) d = DEFS[p]; }
      return d ? { merge: eval(d.merge), covers: eval(d.covers), keepLocal: d.keepLocal, strict: d.strict, cas: d.cas } : null;
    }`);
  return c;
}

const RULES = { funergy_times: ruleOf('funergy_times') };
const FNS = ['_recAt', 'mergeMapByTime', '_coversMapByTime', 'opMergePush', '_fetchOpValue', '_fetchOpRow', '_opCasWrite', '_casTs', '_tsMicro', '_opWriteBack',
  'timesHostOk', 'timesSafeUrl', 'timesEntryOk', 'timesLogOf', 'timesMapOf', 'timesCfg', 'timesMonthLabel', 'timesNewId', 'openTimesSettings', 'timesSaveMsg', 'saveTimesSettings'];
const optVar = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); return m ? m[0] : ''; };
function timesDevice(db, role, name) {
  const c = device(db);
  Object.assign(c, { curRole: role, curUserName: name, curLang: 'ja', curPage: 'settings', ROLE_CONFIG: {}, TOASTS: [], CLOSED: 0, FIELDS: {}, MSG: { style: {} }, URL, _lsPushP: {}, SUPA_SYNC_ENABLED: true });
  run(c, [optVar('TIMES_DEFAULT_URL'), optVar('_tmSave')].filter(Boolean).join('\n') + `
    function escapeHtml(s){ return String(s==null?'':s); } function t(ja){ return ja; }
    function showToast(m, ty){ TOASTS.push([m, ty]); } function openModal(){} function closeModalDirect(){ CLOSED++; } function renderPage(){}
    function langDateLocale(){ return 'ja'; }
    var document = { getElementById: function(id){ if (id === 'tm-msg') return MSG; if (id === 'tm-save') return {};
      return Object.prototype.hasOwnProperty.call(FIELDS, id) ? { value: FIELDS[id] } : null; } };
    /* 本物の lsSet と同じ順：端末に書く → 合流の決まりのあるキーは opMergePush で送る（結果を _lsPushP に） */
    lsSet = function(k, v){ S[k] = JSON.parse(JSON.stringify(v)); var d = _opMergeDef(k);
      _lsPushP[k] = d ? Promise.resolve(opMergePush(k, JSON.parse(JSON.stringify(v)))) : Promise.resolve(undefined); return true; };
  `);
  return c;
}
async function saveOn(c, title, url, at) {
  c.NOW = at;
  if (typeof c.openTimesSettings === 'function') run(c, 'openTimesSettings()');
  c.FIELDS = { 'tm-url': url, 'tm-title': title, 'tm-month': '', 'tm-cover': '' };
  return run(c, 'saveTimesSettings()');
}
async function pullTo(c, db) { const v = await cloudOf(db, 'funergy_times'); c.S.funergy_times = run(c, '_opMergeDef("funergy_times")') ? run(c, `_opMergeDef("funergy_times").merge(${JSON.stringify(v)}, ls("funergy_times", null))`) : v; }
const OLD = { o1: { url: 'https://times.funergygroup.com/', title: '10月号', month: '2026-10', cover: '', by: 'Moto', at: Date.UTC(2026, 9, 1), _at: Date.UTC(2026, 9, 1) } };
const putState = async (db, k, v) => db.query("insert into app_state(key,value,updated_at) values($1,$2,'2026-11-01T00:00:00.000Z') on conflict(key) do update set value=excluded.value", [k, JSON.stringify(v)]);
const titles = v => Object.values(v || {}).filter(e => e && !e._deleted).map(e => e.title).sort();

test('the Times setting is synced as one record per save with a conditional write (cas)', () => {
  assert.deepEqual(RULES.funergy_times, { merge: 'mergeMapByTime', covers: '_coversMapByTime', keepLocal: false, strict: false, cas: true });
  assert.match(SRC, /^var OP_SYNC_KEYS = \[[\s\S]*?'lunch_challenge','funergy_times'\];/m);
  assert.doesNotMatch(SRC, /'md_all_viewers','funergy_times'\]/, 'no longer an app_settings key (no conditional write there)');
});

test('two devices save from the same old value one after the other: the last one is current and the first one stays in the history', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const A = timesDevice(db, 'ceo', 'CEO Taro'), B = timesDevice(db, 'gm', 'GM Hana');
  for (const d of [A, B]) d.S.funergy_times = await cloudOf(db, 'funergy_times');
  assert.equal(await saveOn(A, '11月号（CEO）', 'https://times.funergygroup.com/2026-11', Date.UTC(2026, 10, 18, 1)), true);
  assert.equal(await saveOn(B, '11月号（GM）', 'https://times.funergygroup.com/2026-11-b', Date.UTC(2026, 10, 18, 2)), true);
  const cloud = await cloudOf(db, 'funergy_times');
  assert.deepEqual(titles(cloud), ['10月号', '11月号（CEO）', '11月号（GM）'], 'all three settings are kept');
  assert.equal(run(B, 'timesCfg().title'), '11月号（GM）');
  await pullTo(A, db);
  const a = run(A, 'timesCfg()');
  assert.equal(a.title, '11月号（GM）');
  assert.deepEqual([...a.hist.map(h => h.title)], ['11月号（CEO）', '10月号']);
  assert.equal(a.hist[0].by, 'CEO Taro');
  assert.equal(A.CLOSED, 1); assert.equal(B.CLOSED, 1);
  await db.close();
});

test('two devices save at the same time (A reads, B writes, then A writes): A re-reads and both records are kept', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const A = timesDevice(db, 'ceo', 'CEO Taro'), B = timesDevice(db, 'gm', 'GM Hana');
  for (const d of [A, B]) d.S.funergy_times = await cloudOf(db, 'funergy_times');
  let release, held = false; const gate = new Promise(r => { release = r; });
  A.hold = async m => { if (m === 'GET' && !held) { held = true; await gate; } };
  const pa = saveOn(A, 'A', 'https://times.funergygroup.com/a', Date.UTC(2026, 10, 18, 1));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(await saveOn(B, 'B', 'https://times.funergygroup.com/b', Date.UTC(2026, 10, 18, 2)), true);
  release(); A.hold = null;
  assert.equal(await pa, true);
  assert.deepEqual(titles(await cloudOf(db, 'funergy_times')), ['10月号', 'A', 'B']);
  // PR #194 の Codex（2bdd2c1）：「保存しました」と出した端末の設定が今の設定（A は B のあとに書き終えたので、B より後の順で付け直した）
  for (const d of [A, B]) { await pullTo(d, db); assert.equal(run(d, 'timesCfg().title'), 'A', 'the save that finished last and said "saved" is current on both'); }
  await db.close();
});

// PR #194 の Codex（c9bdce8・2bdd2c1 の P2）：時計が 1 日進んだ A が先に保存し、A の保存をまだ受け取っていない時計の遅い B があとで保存する。
// 前は B に「保存しました」と出て閉じたのに、今の設定は A のままだった（B は履歴に入るだけ）。
test('a slow-clock device with an old copy saves after a fast-clock device: its save becomes current, or it does not say "saved"', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const A = timesDevice(db, 'ceo', 'CEO Taro'), B = timesDevice(db, 'gm', 'GM Hana');
  for (const d of [A, B]) d.S.funergy_times = await cloudOf(db, 'funergy_times');
  assert.equal(await saveOn(A, '設定A', 'https://times.funergygroup.com/a', Date.UTC(2026, 10, 19, 2)), true);
  const w0 = B.writes;
  assert.equal(await saveOn(B, '設定B', 'https://times.funergygroup.com/b', Date.UTC(2026, 10, 18, 2)), true);
  assert.equal(B.writes - w0, 2, 'B sends once, sees A is newer in the merged value, and sends again ordered after A');
  assert.equal(B.CLOSED, 1); assert.deepEqual(plain(B.TOASTS.at(-1)), ['FUNERGY TIMES の設定を保存しました（全員のマイページに出ます）', 'success']);
  const cloud = await cloudOf(db, 'funergy_times');
  assert.deepEqual(titles(cloud), ['10月号', '設定A', '設定B'], 'nothing is lost and B is one record (not two)');
  for (const d of [A, B]) { await pullTo(d, db); const c = run(d, 'timesCfg()'); assert.equal(c.title, '設定B'); assert.deepEqual([...c.hist.map(h => h.title)], ['設定A', '10月号']); }
  await db.close();
});

test('when another device keeps saving newer settings while this one sends, it stops after 3 tries, keeps the form and does not say "saved"; pressing again wins', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const B = timesDevice(db, 'gm', 'GM Hana'), C = timesDevice(db, 'ceo', 'CEO Taro');
  for (const d of [B, C]) d.S.funergy_times = await cloudOf(db, 'funergy_times');
  let cSaves = 0;
  B.hold = async m => {   // B の 1 回ごとの送信の最初の読み（奇数回目の GET）のあとに、時計の進んだ C が新しい設定を保存する
    if (m === 'GET' && B.gets % 2 === 1 && cSaves < 3) { cSaves++; assert.equal(await saveOn(C, 'C' + cSaves, 'https://times.funergygroup.com/c' + cSaves, Date.UTC(2026, 11, 1) + cSaves * 1000), true); }
  };
  const w0 = B.writes;
  assert.equal(await saveOn(B, '設定B', 'https://times.funergygroup.com/b', Date.UTC(2026, 10, 18, 2)), false);
  assert.equal(cSaves, 3); assert.equal(B.writes - w0 >= 3, true, 'B tried three times');
  assert.equal(B.CLOSED, 0, 'the form stays open');
  assert.ok(!B.TOASTS.some(x => x[1] === 'success'), 'no "saved"');
  assert.match(B.MSG.textContent, /ほかの端末が同じころに別の FUNERGY TIMES の設定を保存したため/);
  assert.equal(run(B, 'timesCfg().title'), 'C3');
  assert.match(B.MSG.textContent, /この保存は履歴に残しません/);
  assert.deepEqual(titles(await cloudOf(db, 'funergy_times')), ['10月号', 'C1', 'C2', 'C3'], 'PR #194 Codex P3: a save that never became current is not shown as an earlier setting');
  assert.ok(!run(B, 'timesCfg().hist').some(h => h.title === '設定B'));
  B.hold = null;
  assert.equal(await run(B, 'saveTimesSettings()'), true, 'pressing again (same form) wins');
  assert.equal(B.CLOSED, 1);
  const cloud = await cloudOf(db, 'funergy_times');
  assert.deepEqual(titles(cloud), ['10月号', 'C1', 'C2', 'C3', '設定B'], 'one record for B (the losing save was taken out of the history), nothing lost');
  for (const d of [B, C]) { await pullTo(d, db); assert.equal(run(d, 'timesCfg().title'), '設定B'); }
  await db.close();
});

// PR #194・#195 の Codex（fdbdc1f の 6986520267・31bed6e の 6986713362 の P2）：時計が 1 日進んだ A の保存をまだ受け取っていない B が保存し、
// 送る道が合流した値を B の端末に書き戻せない（_opWriteBack の書き込みが断られる）。前は B の端末の写しだけで「今の設定か」を見たので、
// クラウドの今の設定は A のままなのに「保存しました」と出て閉じた。いまはクラウドの行で確かめ、A より後の順で付け直してから「保存しました」。
test('when the merged value cannot be written back to this device, "saved" is decided from the cloud row, not from the local copy', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const A = timesDevice(db, 'ceo', 'CEO Taro'), B = timesDevice(db, 'gm', 'GM Hana');
  for (const d of [A, B]) d.S.funergy_times = await cloudOf(db, 'funergy_times');
  assert.equal(await saveOn(A, '設定A', 'https://times.funergygroup.com/a', Date.UTC(2026, 10, 19, 2)), true);
  B._lsWriteVerified = () => false;   // この端末にもう書けない（容量など）：合流した値の書き戻しだけが断られる
  const res = await saveOn(B, '設定B', 'https://times.funergygroup.com/b', Date.UTC(2026, 10, 18, 2));
  const cloud = await cloudOf(db, 'funergy_times');
  const current = Object.values(cloud).filter(e => e && !e._deleted).sort((x, y) => y.at - x.at)[0];
  if (res === true) {
    assert.equal(current.title, '設定B', '"saved" only when B is the current setting in the cloud');
    assert.ok(B.TOASTS.some(x => x[1] === 'success'));
  } else {
    assert.equal(B.CLOSED, 0, 'the form stays open');
    assert.ok(!B.TOASTS.some(x => x[1] === 'success'), 'no "saved"');
  }
  assert.equal(res, true, 'B re-sends ordered after A and becomes current');
  assert.deepEqual(titles(cloud), ['10月号', '設定A', '設定B'], 'nothing lost, B is one record');
  const rec = Object.values(cloud).find(e => e.title === '設定B');
  assert.equal(rec.saved, Date.UTC(2026, 10, 18, 2), 'the time shown is when B pressed, not the order value');
  assert.ok(rec.at > Object.values(cloud).find(e => e.title === '設定A').at, 'ordered after A');
  await db.close();
});

test('when the cloud row cannot be read back after sending, it does not say "saved"; the form stays and pressing again checks again', async () => {
  const db = await cloudDb();
  await putState(db, 'funergy_times', OLD);
  const B = timesDevice(db, 'gm', 'GM Hana');
  B.S.funergy_times = await cloudOf(db, 'funergy_times');
  const real = B.fetch; let failReads = 1;
  B.fetch = async (url, o = {}) => {   // 送ったあとの確かめ（値だけの読み＝select=value）を 1 回だけ失敗させる
    if (((o && o.method) || 'GET') === 'GET' && /select=value$/.test(url) && failReads > 0) { failReads--; return { ok: false, status: 503, json: async () => ({}) }; }
    return real(url, o);
  };
  assert.equal(await saveOn(B, '設定B', 'https://times.funergygroup.com/b', Date.UTC(2026, 10, 18, 2)), false);
  assert.equal(B.CLOSED, 0);
  assert.ok(!B.TOASTS.some(x => x[1] === 'success'), 'no "saved"');
  assert.match(B.MSG.textContent, /今の設定になったかを確かめられませんでした/);
  assert.deepEqual(titles(await cloudOf(db, 'funergy_times')), ['10月号', '設定B'], 'it was sent');
  assert.equal(await run(B, 'saveTimesSettings()'), true, 'pressing again confirms it');
  assert.equal(B.CLOSED, 1);
  assert.deepEqual(titles(await cloudOf(db, 'funergy_times')), ['10月号', '設定B'], 'still one record (the same id)');
  await db.close();
});

test('the shown change time is the real save time even when the order value is ahead (a fast-clock device saved before)', () => {
  const c = timesDevice(null, 'gm', 'GM Hana');
  const pressed = Date.UTC(2026, 10, 18, 2), ahead = Date.UTC(2026, 10, 19, 3);
  c.S.funergy_times = { x1: { url: 'https://times.funergygroup.com/x', title: 'X', month: '', cover: '', by: 'GM Hana', at: ahead, saved: pressed, _at: ahead } };
  const cfg = run(c, 'timesCfg()');
  assert.equal(cfg.saved, pressed);
  const html = fnSrc('openTimesSettings');
  assert.match(html, /h\.saved/, 'the history uses the save time');
  assert.match(SRC, /new Date\(\(typeof c\.saved==='number'&&isFinite\(c\.saved\)&&c\.saved\)\?c\.saved:c\.at\)/, 'the My Page card uses the save time');
});
