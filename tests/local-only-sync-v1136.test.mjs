// v1136（Moto さん 11/03「全体アップデート指示」・決めてほしいこと 1A〜13A）：端末にしか残っていなかった手入力をクラウドへ。
//   ① 勤怠の手動修正・Tip の期間の確定・手入力 KPI・育成の記録は新しい名前で同期の一覧に入り、合流の決まり（strict）を持つ
//   ② 合流：記録は 1 件ずつ新しいほう（取り消しの印）、KPI・育成は欄ごとに新しいほう。どの順に合流しても同じ答え（キーの順にもよらない）
//   ③ 古い写しの端末が別の欄を直しても、ほかの端末で入れた欄は消えない
//   ④ 前の名前の記録の移し替え：新しい名前で保存した記録には負ける・2 回目は何も書かない・起動中と同期 OFF ではしない
//   ⑤ 取り込みが、まだ送れていない手元の変更（合流の決まりの無いキー）を消さない
// 本物の関数（index.html）を VM で動かす。合成データだけ。本番にはつながない。
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
const varLine = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(SRC); assert.ok(m, name); return m[0]; };
function varBlock(name, end) {
  const i = SRC.indexOf('\nvar ' + name + ' ='); assert.ok(i >= 0, name);
  const j = SRC.indexOf(end, i); assert.ok(j > i, name);
  return SRC.slice(i + 1, j + end.length);
}
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);

const MERGE = ['_cjson', '_lrObj', '_lrOwn', '_lrAt', '_lrPick', 'mergeLocalRecMap', '_coversLocalRecMap', '_fsHas', '_fsT', '_fsFields', '_fsObj', '_fsFiOf', '_fsSubT', '_fsCont', '_fsSubs', '_fsTie',
  '_fsRecWin', '_fsSameEntry', '_fsFill', 'mergeFieldStampRec', 'mergeFieldStampMap', '_coversFieldStampMap', '_fsStamp', '_lrStamp', '_lrLegacyAt', '_lrRead', 'v1136Moved', 'v1136MoveLocalOnly',
  '_pullPendingMap', '_pendEditAtAll', '_pendEditAtMark', '_pendEditAtDrop', '_pullKeepLocal'];
const GETSET = ['kpiManualKey', '_kpiManualRaw', 'getKpiManual', 'setKpiManual', 'attFixKey', 'getAttOverride', 'setAttOverride',
  'tipConfirmKey', 'getTipConfirm', 'setTipConfirm', '_devStartRaw', 'getDevStart', 'setDevStart', '_devDataRaw', 'getDevData', 'setDevData'];

/* 端末 1 台：STORE（端末の保存）・LOCAL（localStorage の印）・送ったキー（PUSHES） */
function device(now = Date.UTC(2026, 10, 3, 20)) {
  const c = { console: { log() {}, warn() {}, error() {} }, STORE: new Map(), LOCAL: new Map(), PUSHES: [], NOW: now, OUTBOX: [], BUSY: new Set(), WHO: 'p:1',
    SUPA_SYNC_ENABLED: true, _supaBooting: false, FAILSET: new Set() };
  vm.createContext(c);
  vm.runInContext([varLine('V1136_MOVED_KEY'), varLine('_LR_RO'), varLine('PEND_EDIT_KEY'), ...MERGE.map(fnSrc), ...GETSET.map(fnSrc)].join('\n') + `
    Date.now = function(){ return NOW; };
    var localStorage = { getItem: function(k){ return LOCAL.has(k) ? LOCAL.get(k) : null; }, setItem: function(k, v){ LOCAL.set(k, String(v)); } };
    function _lsStoreGet(k){ return STORE.has(k) ? STORE.get(k) : null; }
    function ls(k, d){ var s=_lsStoreGet(k); if(s==null) return d; var v=JSON.parse(s); return v==null ? d : v; }
    function lsSet(k, v){ if (FAILSET.has(k)) { PUSHES.push(k); return false; } STORE.set(k, JSON.stringify(v)); if (SUPA_SYNC_ENABLED && !_supaBooting) PUSHES.push(k); return true; }
    function lsKeys(p){ return Array.from(STORE.keys()).filter(function(k){ return k.indexOf(p)===0; }).sort(); }
    function myName(){ return 'Moto'; } function nowJP(){ return '2026/11/03 10:00'; }
    var ROLE_CONFIG = { gm:{ name:'GM' } }, curRole = 'gm';
    function _outboxGet(){ return OUTBOX; } function _saveWho(){ return WHO; } function _pushBusy(k){ return BUSY.has(k); }
    function _lsPushBlocked(k){ return k.indexOf('blocked_')===0; }
    var _idbState = 'ready';
    function isOpSyncKey(k){ return k.indexOf('local_')!==0; }
    var DEFS = { 'att_fix_': [mergeLocalRecMap, _coversLocalRecMap], 'tip_cf_': [mergeLocalRecMap, _coversLocalRecMap], 'kpi_man_': [mergeFieldStampMap, _coversFieldStampMap] };
    function _opMergeDef(k){
      if (k==='dev_pipe' || k==='dev_pipe_start') return { merge: mergeFieldStampMap, covers: _coversFieldStampMap, strict: true, keepLocal: true };
      for (var p in DEFS) if (k.indexOf(p)===0) return { merge: DEFS[p][0], covers: DEFS[p][1], strict: true, keepLocal: true };
      if (k==='merged_key') return { merge: function(c, l){ return Object.assign({}, c||{}, l||{}); }, covers: function(){ return true; } };
      return null;
    }`, c);
  return c;
}

/* ------------------------------------------------------------------ ① 同期の一覧と合流の決まり（本物の宣言） */
test('① the new keys are in the sync lists with strict merge rules; the old names stay device-only; both are kept by the storage clean-up', () => {
  const keys = varBlock('OP_SYNC_KEYS', '];'), pre = varBlock('OP_SYNC_PREFIX', '];');
  assert.match(keys, /'dev_pipe','dev_pipe_start'/);
  for (const p of ['att_fix_', 'tip_cf_', 'kpi_man_']) assert.ok(pre.includes(`'${p}'`), p);
  for (const old of ['att_override_', 'tip_confirm_', 'kpi_manual_', "'dev_data'", "'dev_start'"]) { assert.ok(!keys.includes(old) && !pre.includes(old), old); }
  const c = { console };
  vm.createContext(c);
  vm.runInContext([varBlock('OP_SYNC_KEYS', '];'), varBlock('OP_SYNC_PREFIX', '];'), varLine('LS_LOCAL_ONLY'), varLine('SUPA_SETTING_PREFIX'),
    "var SUPA_SETTING_KEYS = ['pl_public'];", fnSrc('isLocalOnlyKey'), fnSrc('isOpSyncKey'), varBlock('LS_NEVER_FREE', "'lala_tasks'];"), fnSrc('_lsProtectedKey')].join('\n'), c);
  for (const k of ['att_fix_F01_2026-11', 'tip_cf_F04-K_2026', 'kpi_man_2026.11', 'dev_pipe', 'dev_pipe_start']) {
    assert.equal(run(c, `isOpSyncKey(${JSON.stringify(k)})`), true, k);
    assert.equal(run(c, `_lsProtectedKey(${JSON.stringify(k)})`), true, 'never freed: ' + k);
  }
  for (const k of ['att_override_F01_2026-11-01', 'tip_confirm_F01_2026-10-16', 'kpi_manual_2026.11', 'dev_data', 'dev_start']) {
    assert.equal(run(c, `isOpSyncKey(${JSON.stringify(k)})`), false, 'old name stays on the device: ' + k);
    assert.equal(run(c, `_lsProtectedKey(${JSON.stringify(k)})`), true, 'old name kept: ' + k);
  }
  const mp = varBlock('OP_MERGE_PREFIX', '} };');
  assert.match(mp, /'att_fix_': \{ merge: mergeLocalRecMap, covers: _coversLocalRecMap, keepLocal: true, strict: true, cas: true \}/);
  assert.match(mp, /'tip_cf_':  \{ merge: mergeLocalRecMap, covers: _coversLocalRecMap, keepLocal: true, strict: true, cas: true \}/);
  assert.match(mp, /'kpi_man_': \{ merge: mergeFieldStampMap, covers: _coversFieldStampMap, keepLocal: true, strict: true, cas: true \}/);
  assert.match(SRC, /\n  dev_pipe:       \{ merge: mergeFieldStampMap, covers: _coversFieldStampMap, keepLocal: true, strict: true, cas: true \},/);
  assert.match(SRC, /\n  dev_pipe_start: \{ merge: mergeFieldStampMap, covers: _coversFieldStampMap, keepLocal: true, strict: true, cas: true \},/);
  // ログインのあとに移し替える（PIN のログインと管理者ページの両方）
  assert.equal((SRC.match(/v1136MoveLocalOnly\(\); \}catch\(e\)\{/g) || []).length, 2);
});

/* ------------------------------------------------------------------ ② 合流 */
let seed = 11; const rnd = n => {   // mulberry32（下の桁も偏らない）
  seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0; };
const shuffleKeys = o => { if (!o || typeof o !== 'object') return o; if (Array.isArray(o)) return o.map(shuffleKeys);
  const ks = Object.keys(o).sort(() => rnd(3) - 1); const r = {}; for (const k of ks) r[k] = shuffleKeys(o[k]); return r; };

test('② record maps: newest record wins, an undo mark wins over an older record, ties do not depend on order or key order (jsonb)', () => {
  const c = device();
  const m = (a, b) => plain(run(c, `mergeLocalRecMap(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
  const A = { '2026-11-01': { data: { X: { lunch: 5 } }, by: 'A', _at: 10 } }, B = { '2026-11-01': { _deleted: true, by: 'B', _at: 20 }, '2026-11-02': { data: { Y: {} }, _at: 5 } };
  assert.deepEqual(m(A, B), { '2026-11-01': { _deleted: true, by: 'B', _at: 20 }, '2026-11-02': { data: { Y: {} }, _at: 5 } });
  assert.deepEqual(m(B, A), m(A, B));
  for (let k = 0; k < 300; k++) {
    const rec = () => rnd(4) ? { data: { ['S' + rnd(3)]: { lunch: rnd(9), dinner: rnd(9) } }, by: 'U' + rnd(3), _at: rnd(3) } : { _deleted: true, _at: rnd(3) };
    const x = {}, y = {}, z = {};
    for (const o of [x, y, z]) for (let i = 0; i < 3; i++) if (rnd(2)) o['2026-11-0' + (1 + rnd(3))] = rec();
    const xy_z = m(m(x, y), z), z_yx = m(z, m(y, x)), y_xz = m(m(y, shuffleKeys(z)), shuffleKeys(x));
    assert.deepEqual(run(c, `_cjson(${JSON.stringify(xy_z)})`), run(c, `_cjson(${JSON.stringify(z_yx)})`), 'any order: ' + JSON.stringify([x, y, z]));
    assert.deepEqual(run(c, `_cjson(${JSON.stringify(xy_z)})`), run(c, `_cjson(${JSON.stringify(y_xz)})`), 'any key order');
    assert.deepEqual(m(xy_z, xy_z), xy_z, 'idempotent');
    assert.equal(run(c, `_coversLocalRecMap(${JSON.stringify(shuffleKeys(xy_z))}, ${JSON.stringify(xy_z)})`), true, 'covers itself with another key order');
    assert.deepEqual(m(xy_z, x), xy_z, 'merging an input again changes nothing');
  }
  // 足りない・古い記録は covers しない
  assert.equal(run(c, `_coversLocalRecMap({}, ${JSON.stringify(A)})`), false);
  assert.equal(run(c, `_coversLocalRecMap({ '2026-11-01': { _at: 9 } }, ${JSON.stringify(A)})`), false);
  assert.equal(run(c, `_coversLocalRecMap({ '2026-11-01': { data: { X: { lunch: 6 } }, by: 'A', _at: 10 } }, ${JSON.stringify(A)})`), false, 'same time, other content');
});

test('② field-stamped maps: per field the newest wins (a cleared field stays cleared); ties merge the same way in any order', () => {
  const c = device();
  const m = (a, b) => plain(run(c, `mergeFieldStampMap(${JSON.stringify(a)}, ${JSON.stringify(b)})`));
  const A = { F01: { repeatRate: 31, _ft: { repeatRate: 100 }, _at: 100 } }, B = { F01: { tMisoAll: 12, _ft: { tMisoAll: 200, repeatRate: 150 }, _at: 200 } };
  assert.deepEqual(m(A, B), { F01: { tMisoAll: 12, _ft: { repeatRate: 150, tMisoAll: 200 }, _at: 200 } }, 'B cleared repeatRate later: it stays cleared');
  const A2 = { F01: { repeatRate: 31, _ft: { repeatRate: 300 } } };
  assert.deepEqual(m(A2, B).F01.repeatRate, 31, 'set again after the clear: the newer set wins');
  assert.deepEqual(m(A2, B).F01.tMisoAll, 12, 'the other device’s field stays');
  for (let k = 0; k < 300; k++) {
    const rec = () => { const r = {}, ft = {}; for (const f of ['a', 'b', 'tests', 'skills']) { if (!rnd(3)) continue; const t = rnd(3);
      if (rnd(4)) r[f] = f === 'tests' ? Array.from({ length: rnd(3) }, () => ({ d: rnd(5) })) : f === 'skills' ? { ['s' + rnd(3)]: rnd(4) } : rnd(5); if (t) ft[f] = t; }
      if (Object.keys(ft).length) r._ft = ft; return r; };
    const x = { P: rec() }, y = { P: rec() }, z = { P: rec() };
    const xy_z = m(m(x, y), z), z_yx = m(z, m(y, x));
    assert.equal(run(c, `_cjson(${JSON.stringify(xy_z)})`), run(c, `_cjson(${JSON.stringify(z_yx)})`), 'any order: ' + JSON.stringify([x, y, z]));
    assert.equal(run(c, `_cjson(mergeFieldStampMap(${JSON.stringify(xy_z)}, ${JSON.stringify(xy_z)}))`), run(c, `_cjson(${JSON.stringify(xy_z)})`), 'idempotent');
    assert.equal(run(c, `_coversFieldStampMap(${JSON.stringify(shuffleKeys(xy_z))}, ${JSON.stringify(xy_z)})`), true, 'covers itself with another key order');
    // 時刻のある欄は、いちばん新しい時刻の側の値になる
    for (const f of ['a', 'b']) {
      const ts = [x, y, z].map(o => (o.P._ft || {})[f] || 0), top = Math.max(...ts);
      if (top > 0 && ts.filter(t => t === top).length === 1) {
        const w = [x, y, z][ts.indexOf(top)].P;
        assert.deepEqual(xy_z.P[f], w[f], 'newest wins for ' + f + ': ' + JSON.stringify([x, y, z]));
      }
    }
  }
  // covers：古い・足りない・同じ時刻で違う中身は covers しない
  const W = { P: { a: 1, b: 2, _ft: { a: 10, b: 20 } } };
  assert.equal(run(c, `_coversFieldStampMap({}, ${JSON.stringify(W)})`), false, 'missing record');
  assert.equal(run(c, `_coversFieldStampMap({ P: { a: 1, b: 2, _ft: { a: 10, b: 19 } } }, ${JSON.stringify(W)})`), false, 'older field');
  assert.equal(run(c, `_coversFieldStampMap({ P: { a: 1, b: 3, _ft: { a: 10, b: 20 } } }, ${JSON.stringify(W)})`), false, 'same time, other value');
  assert.equal(run(c, `_coversFieldStampMap({ P: { a: 1, _ft: { a: 10, b: 20 } } }, ${JSON.stringify(W)})`), false, 'cleared on one side only');
  assert.equal(run(c, `_coversFieldStampMap({ P: { a: 1, b: 9, _ft: { a: 10, b: 30 } } }, ${JSON.stringify(W)})`), true, 'newer field');
  // 時刻 0（前の版の記録どうし）：テストの記録は和集合
  const L1 = { P: { tests: [{ c: 'A' }], stage: 3 } }, L2 = { P: { tests: [{ c: 'B' }], stage: 3 } };
  assert.deepEqual(m(L1, L2).P.tests.map(x => x.c).sort(), ['A', 'B']);
  assert.deepEqual(m(L2, L1).P.tests, m(L1, L2).P.tests);
});

/* ------------------------------------------------------------------ ③ 古い写しの端末 */
test('③ a device with a stale copy changes one field: the fields another device saved are not lost; it saves later than what it read', () => {
  const A = device(Date.UTC(2026, 10, 3, 20)), B = device(Date.UTC(2026, 10, 3, 20));
  // どちらの端末も同じ記録を持っている
  run(A, `setDevData('Ken', { stage: 2, tests: [], skillLevels: {} })`);
  B.STORE.set('dev_pipe', A.STORE.get('dev_pipe'));
  // A がテストを足す（クラウドへ）・B は受け取る前にステージを進める
  A.NOW += 60000; run(A, `var d=getDevData('Ken'); d.tests.push({ course:'Grill', score:90 }); setDevData('Ken', d);`);
  B.NOW += 120000; run(B, `var d=getDevData('Ken'); d.stage = 3; setDevData('Ken', d);`);
  const merged = plain(run(B, `mergeFieldStampMap(${A.STORE.get('dev_pipe')}, ${B.STORE.get('dev_pipe')})`));
  assert.equal(merged.Ken.stage, 3); assert.deepEqual(merged.Ken.tests, [{ course: 'Grill', score: 90 }], 'A’s test stays');
  // 時計の遅れた端末でも、読んだ記録より後の時刻で保存する（見てから直した欄が勝つ）
  const C = device(Date.UTC(2026, 9, 1)); C.STORE.set('dev_pipe', JSON.stringify(merged));
  run(C, `var d=getDevData('Ken'); d.stage = 4; setDevData('Ken', d);`);
  const c2 = JSON.parse(C.STORE.get('dev_pipe'));
  assert.ok(c2.Ken._ft.stage > merged.Ken._ft.stage, 'later than what it read');
  assert.equal(plain(run(C, `mergeFieldStampMap(${JSON.stringify(merged)}, ${JSON.stringify(c2)})`)).Ken.stage, 4);
  // 無かった欄に空の配列・入れ物（画面の初期値）は「直した」にしない
  assert.equal(run(C, `JSON.stringify(_fsStamp(null, { tests: [], skillLevels: {}, stage: 1 })._ft)`), JSON.stringify({ stage: C.NOW }));
  // 何も変えずに保存しても時刻は進めない
  const before = C.STORE.get('dev_pipe'); run(C, `setDevData('Ken', getDevData('Ken'))`);
  assert.equal(C.STORE.get('dev_pipe'), before);
  assert.deepEqual(Object.keys(plain(run(C, `getDevData('Ken')`))).filter(k => k.startsWith('_')), [], 'the screen does not see the stamps');
});

test('③（独立レビュー 9fe3a66 P1）a device with no record does not wipe other devices’ tests and skills with the empty defaults', () => {
  // ロールアウト中：B（v1136・Ken の記録なし）が志望を入れる → A（前の版の記録あり）があとで移し替える
  const A = device(), B = device();
  A.STORE.set('dev_data', JSON.stringify({ Ken: { stage: 3, tests: [{ course: 'Grill', score: 90 }], skillLevels: { Grill: 3 }, curriculum: { Knife: true }, retrain: [{ item: 'Fry' }], ojtStatus: 'OJT Started' } }));
  run(B, `var d=getDevData('Ken'); d.aspiration = true; setDevData('Ken', d);`);
  const bRec = JSON.parse(B.STORE.get('dev_pipe')).Ken;
  assert.deepEqual(Object.keys(bRec._ft), ['aspiration'], 'only the edited field is stamped');
  A.STORE.set('dev_pipe', B.STORE.get('dev_pipe'));   // A が B の記録を受け取ってから移し替える
  run(A, 'v1136MoveLocalOnly()');
  const k = plain(run(A, `getDevData('Ken')`));
  assert.equal(k.aspiration, true);
  assert.deepEqual(k.tests, [{ course: 'Grill', score: 90 }]); assert.deepEqual(k.skillLevels, { Grill: 3 });
  assert.deepEqual(k.curriculum, { Knife: true }); assert.deepEqual(k.retrain, [{ item: 'Fry' }]); assert.equal(k.ojtStatus, 'OJT Started');
  // v1136 の 2 台がまだ同期していない新しい人：B がスキル、C が 1 分あとにテスト → 両方残る
  const B2 = device(), C2 = device(); C2.NOW += 60000;
  run(B2, `var d=getDevData('Amy'); d.skillLevels.Grill = 3; setDevData('Amy', d);`);
  run(C2, `var d=getDevData('Amy'); d.tests.push({ course: 'Fry', score: 85 }); setDevData('Amy', d);`);
  const m = plain(run(B2, `mergeFieldStampMap(${B2.STORE.get('dev_pipe')}, ${C2.STORE.get('dev_pipe')})`)).Amy;
  assert.deepEqual([m.skillLevels, m.tests], [{ Grill: 3 }, [{ course: 'Fry', score: 85 }]]);
  // 時刻の無い記録どうし：値（ステージと OJT の状態）は同じ記録から（食い違わない）。テストは和集合
  const L1 = { Ken: { stage: 4, ojtStatus: 'OJT Completed', tests: [{ c: 'A' }] } }, L2 = { Ken: { stage: 2, ojtStatus: 'Skill Level In Progress', tests: [{ c: 'B' }] } };
  for (const r of [plain(run(A, `mergeFieldStampMap(${JSON.stringify(L1)}, ${JSON.stringify(L2)})`)).Ken, plain(run(A, `mergeFieldStampMap(${JSON.stringify(L2)}, ${JSON.stringify(L1)})`)).Ken]) {
    assert.ok((r.stage === 4 && r.ojtStatus === 'OJT Completed') || (r.stage === 2 && r.ojtStatus === 'Skill Level In Progress'), JSON.stringify(r));
    assert.deepEqual(r.tests.map(x => x.c).sort(), ['A', 'B']);
  }
  assert.deepEqual(plain(run(A, `mergeFieldStampMap(${JSON.stringify(L1)}, ${JSON.stringify(L2)})`)), plain(run(A, `mergeFieldStampMap(${JSON.stringify(L2)}, ${JSON.stringify(L1)})`)));
});

test('③ KPI: the repeat rate and the Totoya counts entered on two devices both stay; clearing a value goes to the other device', () => {
  const A = device(), B = device();
  run(A, `setKpiManual('F04-K', '2026.11', { repeatRate: 33 })`);
  B.NOW += 1000; run(B, `setKpiManual('F04-K', '2026.11', { tMisoAll: 40, tIkura: 7 })`);
  const box = plain(run(A, `mergeFieldStampMap(${A.STORE.get('kpi_man_2026.11')}, ${B.STORE.get('kpi_man_2026.11')})`));
  A.STORE.set('kpi_man_2026.11', JSON.stringify(box));
  assert.deepEqual(plain(run(A, `getKpiManual('F04-K', '2026.11')`)), { repeatRate: 33, tMisoAll: 40, tIkura: 7 });
  A.NOW += 5000; run(A, `var v=getKpiManual('F04-K','2026.11'); v.tIkura = undefined; setKpiManual('F04-K','2026.11', v);`);
  const after = plain(run(B, `mergeFieldStampMap(${B.STORE.get('kpi_man_2026.11')}, ${A.STORE.get('kpi_man_2026.11')})`));
  assert.equal(after['F04-K'].tIkura, undefined, 'cleared on A → cleared on B');
  assert.equal(after['F04-K'].tMisoAll, 40);
});

test('③ attendance fix and tip finalization: one record per day / period start, the undo reaches other devices', () => {
  const A = device(), B = device();
  run(A, `setAttOverride('F01', '2026-11-02', { data: { X: { lunch: 4, dinner: 0 } }, by: 'Moto', at: '2026/11/03 10:00' })`);
  assert.deepEqual(Object.keys(JSON.parse(A.STORE.get('att_fix_F01_2026-11'))), ['2026-11-02'], 'month box');
  assert.equal(plain(run(A, `getAttOverride('F01', '2026-11-02')`)).data.X.lunch, 4);
  run(A, `getAttOverride('F01', '2026-11-02').data.X.lunch = 99`);
  assert.equal(run(A, `getAttOverride('F01', '2026-11-02').data.X.lunch`), 4, 'a caller cannot change the cached box');
  B.STORE.set('att_fix_F01_2026-11', A.STORE.get('att_fix_F01_2026-11'));
  assert.equal(plain(run(B, `getAttOverride('F01', '2026-11-02')`)).by, 'Moto', 'the other device sees it');
  B.NOW += 1000; run(B, `setAttOverride('F01', '2026-11-02', null)`);
  assert.equal(run(B, `getAttOverride('F01', '2026-11-02')`), null);
  const m = plain(run(A, `mergeLocalRecMap(${A.STORE.get('att_fix_F01_2026-11')}, ${B.STORE.get('att_fix_F01_2026-11')})`));
  A.STORE.set('att_fix_F01_2026-11', JSON.stringify(m));
  assert.equal(run(A, `getAttOverride('F01', '2026-11-02')`), null, 'undo reached A');
  assert.equal(run(A, `getAttOverride('F01', '2026-11-03')`), null);
  // Tip
  run(A, `setTipConfirm('F01', { from: '2026-10-16' }, { status: '確定済み', from: '2026-10-16', at: '2026/11/01 09:00' })`);
  assert.deepEqual(Object.keys(JSON.parse(A.STORE.get('tip_cf_F01_2026'))), ['2026-10-16']);
  assert.equal(run(A, `getTipConfirm('F01', { from: '2026-10-16' }).status`), '確定済み');
});

/* ------------------------------------------------------------------ ④ 移し替え */
function legacy(c) {
  c.STORE.set('att_override_F01_2026-10-28', JSON.stringify({ data: { X: { lunch: 3 } }, by: 'Old', at: '2026/10/28 15:00' }));
  c.STORE.set('att_override_F04-K_2026-11-01', JSON.stringify({ data: { Y: { dinner: 6 } }, by: 'Old', at: '2026/11/01 21:00' }));
  c.STORE.set('att_override_F01_2026-10-29', 'null');   // 前の版で取り消した
  c.STORE.set('tip_confirm_F01_2026-10-16', JSON.stringify({ status: '確定済み', from: '2026-10-16', at: '2026/11/01 09:00', rows: [] }));
  c.STORE.set('tip_confirm_F02_2026-10-16', 'null');
  c.STORE.set('kpi_manual_2026.10', JSON.stringify({ F01: { repeatRate: 28, reviewScore: 4.4 } }));
  c.STORE.set('dev_data', JSON.stringify({ Ken: { stage: 3, tests: [{ course: 'Old' }] } }));
  c.STORE.set('dev_start', JSON.stringify({ Ken: '2026-09-01' }));
}
test('④ moving the old names: every record goes to the new names; a second run writes nothing; the flag is set; old records are kept', () => {
  const c = device(); legacy(c);
  // 移す前でも、この端末の前の記録が見える
  assert.equal(plain(run(c, `getAttOverride('F01', '2026-10-28')`)).by, 'Old');
  assert.equal(run(c, `getTipConfirm('F01', { from: '2026-10-16' }).status`), '確定済み');
  assert.equal(plain(run(c, `getKpiManual('F01', '2026.10')`)).repeatRate, 28);
  assert.equal(run(c, `getDevData('Ken').stage`), 3); assert.equal(run(c, `getDevStart({ name: 'Ken' })`), '2026-09-01');
  const n = run(c, 'v1136MoveLocalOnly()');
  assert.ok(n > 0);
  assert.equal(c.LOCAL.get('_v1136_moved'), '1');
  assert.deepEqual([...c.PUSHES].sort(), ['att_fix_F01_2026-10', 'att_fix_F04-K_2026-11', 'dev_pipe', 'dev_pipe_start', 'kpi_man_2026.10', 'tip_cf_F01_2026']);
  const a = JSON.parse(c.STORE.get('att_fix_F01_2026-10'));
  assert.deepEqual(Object.keys(a), ['2026-10-28'], 'the undone day is not moved');
  assert.equal(a['2026-10-28']._at, Math.floor(new Date('2026/10/28 15:00').getTime() / 60000), 'old-version band (minutes)');
  assert.ok(a['2026-10-28']._at < 1e9);
  assert.equal(JSON.parse(c.STORE.get('tip_cf_F01_2026'))['2026-10-16'].status, '確定済み');
  assert.equal(c.STORE.get('tip_cf_F02_2026'), undefined);
  // 移したあとも同じに見える
  assert.equal(plain(run(c, `getAttOverride('F04-K', '2026-11-01')`)).data.Y.dinner, 6);
  assert.equal(plain(run(c, `getKpiManual('F01', '2026.10')`)).reviewScore, 4.4);
  assert.deepEqual(plain(run(c, `getDevData('Ken').tests`)), [{ course: 'Old' }]);
  assert.equal(run(c, `getDevStart({ name: 'Ken' })`), '2026-09-01');
  assert.ok(c.STORE.has('dev_data') && c.STORE.has('att_override_F01_2026-10-28'), 'old records are kept');
  // 2 回目は何も書かない
  c.PUSHES.length = 0;
  assert.equal(run(c, 'v1136MoveLocalOnly()'), 0); assert.deepEqual([...c.PUSHES], []);
  // 移したあとは前の名前を見ない（新しい名前で消えた・まだ無いものを前の記録で出さない）
  c.STORE.set('att_override_F01_2026-10-30', JSON.stringify({ data: { Z: {} }, by: 'Old', at: '2026/10/30 10:00' }));
  c.STORE.set('kpi_manual_2026.09', JSON.stringify({ F01: { repeatRate: 1 } }));
  assert.equal(run(c, `getAttOverride('F01', '2026-10-30')`), null);
  assert.deepEqual(plain(run(c, `getKpiManual('F01', '2026.09')`)), {});
});

test('④ before the move, editing one field of an old record stamps only that field (the untouched old fields do not beat other devices)', () => {
  const c = device(); legacy(c);
  run(c, `var v=getKpiManual('F01','2026.10'); v.reviewScore = 4.6; setKpiManual('F01','2026.10', v);`);
  const r = JSON.parse(c.STORE.get('kpi_man_2026.10')).F01;
  assert.deepEqual(Object.keys(r._ft), ['reviewScore']);
  assert.equal(r.repeatRate, 28, 'the old field is carried');
  run(c, `var d=getDevData('Ken'); d.stage = 4; setDevData('Ken', d);`);
  assert.deepEqual(Object.keys(JSON.parse(c.STORE.get('dev_pipe')).Ken._ft), ['stage']);
  run(c, `setDevStart('Ken', '2026-09-01')`);
  assert.equal(JSON.parse(c.STORE.get('dev_pipe_start')).Ken._ft, undefined, 'same date as the old record: nothing stamped');
});

test('④ an old record never beats a record already saved under the new name on another device; old records among themselves go by time', () => {
  const c = device(); legacy(c);
  // ほかの端末が新しい名前で取り消し・別の値を保存した（クラウドから受け取った）
  c.STORE.set('att_fix_F01_2026-10', JSON.stringify({ '2026-10-28': { _deleted: true, by: 'GM', _at: Date.UTC(2026, 9, 29) } }));
  c.STORE.set('kpi_man_2026.10', JSON.stringify({ F01: { repeatRate: 35, _ft: { repeatRate: Date.UTC(2026, 10, 1) } } }));
  c.STORE.set('dev_pipe', JSON.stringify({ Ken: { stage: 4, _ft: { stage: Date.UTC(2026, 10, 1) } } }));
  run(c, 'v1136MoveLocalOnly()');
  assert.equal(run(c, `getAttOverride('F01', '2026-10-28')`), null, 'the undo on the new name stays');
  assert.deepEqual(plain(run(c, `getKpiManual('F01', '2026.10')`)), { repeatRate: 35, reviewScore: 4.4 }, 'new value stays, the old-only field fills the gap');
  assert.equal(run(c, `getDevData('Ken').stage`), 4); assert.deepEqual(plain(run(c, `getDevData('Ken').tests`)), [{ course: 'Old' }]);
  // 前の版の記録どうし：新しいほう
  const d = device(); d.STORE.set('att_fix_F01_2026-10', JSON.stringify({ '2026-10-28': { data: { X: { lunch: 9 } }, by: 'Other', at: '2026/10/28 18:00', _at: Math.floor(new Date('2026/10/28 18:00').getTime() / 60000), _from: 'v1135' } }));
  legacy(d); run(d, 'v1136MoveLocalOnly()');
  assert.equal(plain(run(d, `getAttOverride('F01', '2026-10-28')`)).by, 'Other', 'the later old record (18:00) beats the earlier one (15:00)');
});

test('④ not while starting up or with sync off (nothing is marked done); a failed save keeps the flag unset', () => {
  const c = device(); legacy(c);
  c._supaBooting = true; assert.equal(run(c, 'v1136MoveLocalOnly()'), false); assert.equal(c.LOCAL.get('_v1136_moved'), undefined);
  c._supaBooting = false; run(c, `_idbState = 'init'`); assert.equal(run(c, 'v1136MoveLocalOnly()'), false, 'not before the device storage was read');
  run(c, `_idbState = 'ready'`);
  c.SUPA_SYNC_ENABLED = false; assert.equal(run(c, 'v1136MoveLocalOnly()'), false); assert.equal(c.STORE.get('dev_pipe'), undefined);
  c.SUPA_SYNC_ENABLED = true; c.FAILSET.add('dev_pipe');
  assert.equal(run(c, 'v1136MoveLocalOnly()'), false); assert.equal(c.LOCAL.get('_v1136_moved'), undefined, 'retried at the next login');
  assert.equal(run(c, `getDevData('Ken').stage`), 3, 'still reads the old record');
  c.FAILSET.clear(); assert.ok(run(c, 'v1136MoveLocalOnly()') > 0); assert.equal(c.LOCAL.get('_v1136_moved'), '1');
  const u = device(); legacy(u); run(u, `_idbState = 'unavailable'`);   // IndexedDB を使えない端末（localStorage だけ）
  assert.ok(run(u, 'v1136MoveLocalOnly()') > 0);
});

/* ------------------------------------------------------------------ ⑤ 取り込みが手元の送れていない変更を消さない */
function pullApp() {
  const c = device();
  vm.runInContext([varLine('LS_LOCAL_ONLY'), fnSrc('isLocalOnlyKey'), fnSrc('_applyKvRows'), fnSrc('pullOpKey'), fnSrc('pullSettingKey')].join('\n') + `
    var _SPLIT_KEYS = {}, window = {}, SUPABASE_URL = 'https://x.supabase.co', CLOUD = {}, CLOUD_AT = {}, FETCHED = [], LAST_URL = '';
    function _handleLegacySplitRow(){ return false; }
    function _lsOnDemand(k){ return k.indexOf('blocked_')===0; }
    function _lsRaw(k, d){ var s=_lsStoreGet(k); return s==null ? d : JSON.parse(s); }
    function _lsWriteVerified(k, js){ STORE.set(k, js); return true; }
    function _lsSetVerified(k, js){ return _lsWriteVerified(k, js); }
    function _lsMarkFetched(k){ FETCHED.push(k); } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(){} function _lsFreeOldLaborKeys(){}
    function supaHeaders(){ return {}; }
    function fetch(u){ LAST_URL=String(u); var k=decodeURIComponent(String(u).split('key=eq.')[1].split('&')[0]); var has=Object.prototype.hasOwnProperty.call(CLOUD, k);
      return Promise.resolve({ ok:true, json:function(){ return Promise.resolve(has ? [{ value: CLOUD[k], updated_at: CLOUD_AT[k] }] : []); } }); }`, c);
  return c;
}
test('⑤ a pull keeps my unsent change only when it is newer than the cloud row; a newer cloud row, someone else’s change or an unknown time take the cloud value', async () => {
  const c = pullApp();
  const T = c.NOW, old = new Date(T - 3600000).toISOString(), newer = new Date(T + 60000).toISOString();
  c.STORE.set('evaluations', JSON.stringify({ mine: 'typed offline' }));
  c.STORE.set('meeting_reviews', JSON.stringify({ old: 1 }));
  c.STORE.set('applicants', JSON.stringify(['local']));
  c.STORE.set('growthhub', JSON.stringify({ local: 1 }));
  c.STORE.set('ing_v2_seq', JSON.stringify(5));
  c.STORE.set('merged_key', JSON.stringify({ a: 1 }));
  c.OUTBOX.push({ key: 'evaluations', who: 'p:1' }, { key: 'applicants', who: 'p:2' }, { key: 'growthhub', who: 'p:1' }, { key: 'ing_v2_seq' }, { key: 'merged_key', who: 'p:1' });
  run(c, `['evaluations','applicants','growthhub','merged_key'].forEach(_pendEditAtMark)`);   // 直した時刻＝T（ing_v2_seq は v1135 までの送信待ち＝時刻なし）
  c.OKOUT = [];
  run(c, `_applyKvRows(${JSON.stringify([
    { key: 'evaluations', value: { cloud: 'older' }, updated_at: old },
    { key: 'meeting_reviews', value: { cloud: 2 }, updated_at: old },
    { key: 'applicants', value: ['cloud'], updated_at: old },
    { key: 'growthhub', value: { cloud: 'written after my edit' }, updated_at: newer },
    { key: 'ing_v2_seq', value: 9, updated_at: old },
    { key: 'merged_key', value: { b: 2 }, updated_at: newer }])}, OKOUT)`);
  assert.deepEqual(JSON.parse(c.STORE.get('evaluations')), { mine: 'typed offline' }, 'my unsent change is newer: kept');
  assert.deepEqual(JSON.parse(c.STORE.get('meeting_reviews')), { cloud: 2 }, 'nothing pending: cloud value');
  assert.deepEqual(JSON.parse(c.STORE.get('applicants')), ['cloud'], 'someone else’s pending change on a shared device: as before');
  assert.deepEqual(JSON.parse(c.STORE.get('growthhub')), { cloud: 'written after my edit' }, 'someone wrote after my edit: the newer cloud value (no stale overwrite)');
  assert.equal(JSON.parse(c.STORE.get('ing_v2_seq')), 9, 'no edit time (pending from before v1136): as before');
  assert.deepEqual(JSON.parse(c.STORE.get('merged_key')), { b: 2, a: 1 }, 'a key with a merge rule is merged as before');
  assert.deepEqual(plain(c.OKOUT).sort(), ['applicants', 'growthhub', 'ing_v2_seq', 'meeting_reviews', 'merged_key'], 'the kept row is fetched again next time');
  // 送っている途中は、時刻によらず手元
  c.BUSY.add('meeting_reviews'); c.STORE.set('meeting_reviews', JSON.stringify({ sending: 1 }));
  run(c, `_applyKvRows([{ key: 'meeting_reviews', value: { cloud: 3 }, updated_at: '${newer}' }])`);
  assert.deepEqual(JSON.parse(c.STORE.get('meeting_reviews')), { sending: 1 });
  // まだ取得していない必要時のキーは今までどおり取り込む（手元は部分の値）
  c.STORE.set('blocked_log', JSON.stringify(['part'])); c.OUTBOX.push({ key: 'blocked_log', who: 'p:1' }); run(c, `_pendEditAtMark('blocked_log')`);
  run(c, `CLOUD['blocked_log'] = ['full', 'part']; CLOUD_AT['blocked_log'] = '${old}'`);
  assert.equal(await run(c, `pullOpKey('blocked_log')`), true);
  assert.deepEqual(JSON.parse(c.STORE.get('blocked_log')), ['full', 'part']);
  // pullOpKey：クラウドの行の時刻で比べる
  run(c, `CLOUD['evaluations'] = { cloud: 'still older' }; CLOUD_AT['evaluations'] = '${old}'`);
  assert.equal(await run(c, `pullOpKey('evaluations')`), true);
  assert.deepEqual(JSON.parse(c.STORE.get('evaluations')), { mine: 'typed offline' });
  run(c, `CLOUD['evaluations'] = { cloud: 'newer' }; CLOUD_AT['evaluations'] = '${newer}'`);
  assert.equal(await run(c, `pullOpKey('evaluations')`), true);
  assert.deepEqual(JSON.parse(c.STORE.get('evaluations')), { cloud: 'newer' }, 'a newer cloud row wins');
  assert.match(run(c, 'LAST_URL'), /select=value,updated_at/);
  // 合流の決まりのあるキーは、送信待ちがあっても合流する（pullOpKey）
  c.STORE.set('merged_key', JSON.stringify({ a: 1 })); run(c, `CLOUD['merged_key'] = { c: 3 }; CLOUD_AT['merged_key'] = '${old}'`);
  assert.equal(await run(c, `pullOpKey('merged_key')`), true);
  assert.deepEqual(JSON.parse(c.STORE.get('merged_key')), { c: 3, a: 1 });
  c.BUSY.add('merged_key'); c.STORE.set('merged_key', JSON.stringify({ d: 4 }));   // 送っている途中でも合流（手元の値だけにしない）
  run(c, `_applyKvRows([{ key: 'merged_key', value: { e: 5 }, updated_at: '${newer}' }])`);
  assert.deepEqual(JSON.parse(c.STORE.get('merged_key')), { e: 5, d: 4 });
  run(c, `CLOUD['merged_key'] = { f: 6 }`);
  assert.equal(await run(c, `pullOpKey('merged_key')`), true);
  assert.deepEqual(JSON.parse(c.STORE.get('merged_key')), { f: 6, e: 5, d: 4 }, 'pullOpKey too');
  // 設定（app_settings）は送っている途中だけ手元
  c.STORE.set('tip_policy', JSON.stringify('mine')); c.OUTBOX.push({ key: 'tip_policy' }); run(c, `CLOUD['tip_policy'] = 'cloud'`);
  assert.equal(await run(c, `pullSettingKey('tip_policy')`), true);
  assert.equal(JSON.parse(c.STORE.get('tip_policy')), 'cloud', 'pending only: as before');
  c.STORE.set('tip_policy', JSON.stringify('mine')); c.BUSY.add('tip_policy');
  assert.equal(await run(c, `pullSettingKey('tip_policy')`), true);
  assert.equal(JSON.parse(c.STORE.get('tip_policy')), 'mine', 'sending: kept');
});

test('⑤ the edit time is recorded only for synced keys without a merge rule, and forgotten once the key is sent', () => {
  const c = device();
  run(c, `_pendEditAtMark('evaluations'); _pendEditAtMark('att_fix_F01_2026-11'); _pendEditAtMark('local_flag')`);
  assert.deepEqual(Object.keys(JSON.parse(c.LOCAL.get('_pend_edit_at'))), ['evaluations']);
  run(c, `_pendEditAtDrop('evaluations')`);
  assert.deepEqual(JSON.parse(c.LOCAL.get('_pend_edit_at')), {});
  assert.doesNotMatch(fnSrc('_pushWithOutbox'), /_pendEditAtMark/, 'not on every push attempt (retries, bulk pushes)');
  assert.match(fnSrc('lsSet'), /_prevTxt!==_json && typeof _pendEditAtMark==='function'\) _pendEditAtMark\(key, _prevTxt, _json\)/);
  assert.match(fnSrc('_outboxRemove'), /_pendEditAtDrop\(key\)/);
  assert.match(fnSrc('_kvFetchKeys'), /select=key,value,updated_at/);
  assert.match(fnSrc('_kvPullRows'), /supaFetchAll\('app_state', 'key,value,updated_at', f\)/);
});

/* 本物の lsSet（端末の保存の部分は代わり）：直した時刻は中身が変わった保存のときだけ */
function lsSetApp() {
  const c = device();
  vm.runInContext(fnSrc('lsSet').replace('function lsSet(', 'function realLsSet(') + `
    var _SPLIT_KEYS = {}, _lsEscalatedAt = 0, window = {}, PUSHED = [];
    function _lsWriteVerified(k, js){ STORE.set(k, js); return true; }
    function _lsClearSaveFailure(){} function _lsNoteSaveFailure(){} function _lsFreeOldLaborKeys(){}
    function _pushWithOutbox(k){ PUSHED.push(k); }`, c);
  return c;
}
test('⑤（2 回目の独立レビュー P2-1）the edit time moves only when a save really changes the stored value — not on retries, same-value saves or while starting up', () => {
  const c = lsSetApp(), at = () => JSON.parse(c.LOCAL.get('_pend_edit_at') || '{}');
  c.NOW = 1000; run(c, `realLsSet('evaluations', { a: 1 })`);
  assert.equal(at().evaluations, 1000, 'first save');
  c.NOW = 2000; run(c, `realLsSet('evaluations', { a: 1 })`);
  assert.equal(at().evaluations, 1000, 'same value saved again (e.g. a re-render that saves): the time does not move');
  assert.deepEqual(plain(run(c, 'PUSHED')), ['evaluations', 'evaluations'], 'it is still sent as before');
  c.STORE.set('evaluations', '{"b":2,"a":1}'); c.NOW = 2500; run(c, `realLsSet('evaluations', { a: 1, b: 2 })`);
  assert.equal(at().evaluations, 1000, 'same content with the keys in another order: the time does not move');
  c.NOW = 3000; run(c, `realLsSet('evaluations', { a: 2 })`);
  assert.equal(at().evaluations, 3000, 'changed value');
  c.NOW = 4000; run(c, `_pushWithOutbox('evaluations', { a: 2 })`);   // 送信待ちの送り直し・まとめて送る（lsSet を通らない）
  assert.equal(at().evaluations, 3000, 'a retry does not move the time');
  c._supaBooting = true; c.NOW = 5000; run(c, `realLsSet('evaluations', { a: 3 })`);
  assert.equal(at().evaluations, 3000, 'not while starting up');
  c._supaBooting = false; c.SUPA_SYNC_ENABLED = false; run(c, `realLsSet('evaluations', { a: 4 })`);
  assert.equal(at().evaluations, 3000, 'not with sync off');
  c.SUPA_SYNC_ENABLED = true; c.NOW = 6000; run(c, `realLsSet('att_fix_F01_2026-11', { x: 1 }); realLsSet('local_flag', 1)`);
  assert.deepEqual(Object.keys(at()), ['evaluations'], 'keys with a merge rule and device-only keys are not recorded');
});
test('⑤ a grade change that is rolled back also rolls back the edit time it recorded', () => {
  const c = lsSetApp();
  vm.runInContext(fnSrc('ghTxnBegin') + fnSrc('ghTxnEnd') + `
    lsSet = realLsSet;
    function _lsRawStr(k){ return _lsStoreGet(k); } function _lsRawDel(k){ STORE.delete(k); return true; }`, c);
  c.NOW = 1000; run(c, `realLsSet('evaluations', { a: 1 })`);
  c.NOW = 2000; run(c, `var tx = ghTxnBegin(); lsSet('evaluations', { a: 2 }); lsSet('applicants', ['x']); tx.fail.push('grade_hist'); var OK = ghTxnEnd(tx);`);
  assert.equal(run(c, 'OK'), false);
  assert.deepEqual(JSON.parse(c.LOCAL.get('_pend_edit_at')), { evaluations: 1000 }, 'back to before the change');
  assert.equal(c.STORE.get('evaluations'), '{"a":1}');
  c.NOW = 3000; run(c, `var tx2 = ghTxnBegin(); lsSet('evaluations', { a: 3 }); var OK2 = ghTxnEnd(tx2);`);
  assert.equal(run(c, 'OK2'), true); assert.equal(JSON.parse(c.LOCAL.get('_pend_edit_at')).evaluations, 3000, 'kept when it is saved');
});
test('⑤ the cloud row time is read to the microsecond (PostgREST): an edit in the same millisecond as a later cloud write does not win', () => {
  const c = device();
  vm.runInContext(fnSrc('_tsMicro'), c);
  const T = Date.UTC(2026, 10, 3, 20, 0, 0, 500);
  c.STORE.set('evaluations', '{"a":1}'); c.OUTBOX.push({ key: 'evaluations', who: 'p:1' });
  c.LOCAL.set('_pend_edit_at', JSON.stringify({ evaluations: T }));
  const iso = (ms, us) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.' + String(ms % 1000).padStart(3, '0') + us + '+00:00');
  assert.equal(run(c, `_pullKeepLocal('evaluations', null, '${iso(T - 1, '999')}')`), true, 'cloud written just before my edit');
  assert.equal(run(c, `_pullKeepLocal('evaluations', null, '${iso(T, '001')}')`), false, 'cloud written later in the same millisecond');
  assert.equal(run(c, `_pullKeepLocal('evaluations', null, '${iso(T, '000')}')`), false, 'same time: the cloud value');
  assert.equal(run(c, `_pullKeepLocal('evaluations', null, 'not a time')`), false, 'unknown time: the cloud value');
  assert.equal(run(c, `_pullKeepLocal('evaluations', null, '${new Date(T - 5).toISOString()}')`), true, 'the plain form (Z) too');
});

/* ------------------------------------------------------------------ ③ ロールアウトのあいだ（2 回目の独立レビュー P2-2） */
test('③（2 回目の独立レビュー P2-2）a field another device already changed does not drop what only the not-yet-updated device had (skills, tests, retraining, stage history)', () => {
  // A（前の版・Ken の記録あり）と B（v1136・Ken の記録なし）。A が更新する前に、B がスキルを 1 つ・テストを 1 つ入れ、志望を登録
  const A = device(), B = device(); B.NOW += 60000;
  A.STORE.set('dev_data', JSON.stringify({ Ken: { stage: 3, skillLevels: { Grill: 3, Fry: 2 }, curriculum: { Knife: true },
    tests: [{ course: 'Grill', score: 90, pass: true, date: '2026/10/01' }], retrain: [{ item: 'Fry', reason: 'low', done: false, date: '2026/10/01' }],
    stageHistory: [{ stage: 3, enteredAt: '2026/09/20', by: 'GM' }] } }));
  run(B, `var d=getDevData('Ken'); d.skillLevels.Fry = 1; setDevData('Ken', d);`);
  B.NOW += 1000; run(B, `var d=getDevData('Ken'); d.tests.push({ course: 'Fry', score: 70, pass: true, date: '2026/11/03' }); setDevData('Ken', d);`);
  B.NOW += 1000; run(B, `var d=getDevData('Ken'); if(!d.stageHistory) d.stageHistory=[]; d.stageHistory.push({ stage: 4, enteredAt: '2026/11/03', by: 'AM' }); setDevData('Ken', d);`);
  A.STORE.set('dev_pipe', B.STORE.get('dev_pipe'));   // A が更新して B の記録を受け取ってから移し替える
  run(A, 'v1136MoveLocalOnly()');
  const k = plain(run(A, `getDevData('Ken')`));
  assert.deepEqual(k.skillLevels, { Fry: 1, Grill: 3 }, 'B’s Fry=1 wins; A’s Grill stays');
  assert.deepEqual(k.tests.map(t => t.course), ['Grill', 'Fry'], 'both tests; the old-only one goes first (the screens read the last one as the latest)');
  assert.deepEqual(k.stageHistory.map(h => h.stage), [3, 4], 'both history entries, old first');
  assert.deepEqual(k.retrain, [{ item: 'Fry', reason: 'low', done: false, date: '2026/10/01' }]);
  assert.deepEqual(k.curriculum, { Knife: true });
  // 3 回目の独立レビュー P3-1：前の版の古いテストが「最新の結果」にならない（画面は配列の最後を最新と読む）
  const g = plain(run(A, `mergeFieldStampRec({ tests:[{ course:'Grill', score:60, pass:false, date:'2026/10/01' }] }, { tests:[{ course:'Grill', score:95, pass:true, date:'2026/11/03' }], _ft:{ tests: 5 } })`));
  assert.deepEqual(g.tests.map(t => t.score), [60, 95]);
  // 合流の順によらない・何度合流しても同じ・B が受け取っても同じ
  const a = A.STORE.get('dev_pipe'), b = B.STORE.get('dev_pipe');
  const ab = run(A, `_cjson(mergeFieldStampMap(${a}, ${b}))`), ba = run(A, `_cjson(mergeFieldStampMap(${b}, ${a}))`);
  assert.equal(ab, ba); assert.equal(ab, run(A, `_cjson(mergeFieldStampMap(${ab}, ${ab}))`));
  assert.equal(run(A, `_coversFieldStampMap(${ab}, ${a})`), true, 'what A sent is covered after the merge');
});
test('③（P2-2）on the same device, the old record moved again at each login does not bring back the not-done copy of a finished retraining or an old skill value', () => {
  const c = device();
  c.STORE.set('dev_data', JSON.stringify({ Ken: { skillLevels: { Grill: 2 }, retrain: [{ item: 'Fry', reason: 'low', done: false, date: '2026/10/01' }],
    tests: [{ course: 'Grill', score: 60, pass: false, retrain: true, date: '2026/10/01' }] } }));
  run(c, 'v1136MoveLocalOnly()');
  c.NOW += 1000; run(c, `var d=getDevData('Ken'); d.retrain[0].done = true; d.skillLevels.Grill = 3; d.tests.push({ course: 'Grill', score: 95, pass: true, retrain: false, date: '2026/11/03' }); setDevData('Ken', d);`);
  const before = c.STORE.get('dev_pipe'); c.PUSHES.length = 0;
  assert.equal(run(c, 'v1136MoveLocalOnly()'), 0, 'the next login writes nothing');
  assert.equal(c.STORE.get('dev_pipe'), before); assert.deepEqual([...c.PUSHES], []);
  const k = plain(run(c, `getDevData('Ken')`));
  assert.deepEqual(k.retrain.map(r => r.done), [true], 'no second, not-done copy');
  assert.equal(k.skillLevels.Grill, 3); assert.equal(k.tests.length, 2);
  assert.equal(k.tests.slice(-1)[0].score, 95, 'the latest test is still the last one');
  // 「同じ要素」は真偽の欄だけが違うもの。ほかの欄が違えば別の要素として足す
  assert.equal(run(c, `_fsSameEntry({ item:'Fry', done:false }, { item:'Fry', done:true })`), true);
  assert.equal(run(c, `_fsSameEntry({ item:'Fry', done:false }, { item:'Fry', done:'yes' })`), false);
  assert.equal(run(c, `_fsSameEntry({ item:'Fry', done:false }, { item:'Fry' })`), false, 'other fields');
  assert.equal(run(c, `_fsSameEntry({ c:'A', s:60 }, { c:'A', s:61 })`), false);
  assert.deepEqual(plain(run(c, `_fsFill(['a', 1], ['a', 'b', 'b', 1, 2])`)), ['b', 2, 'a', 1], 'plain values: added once, already-present ones not again');
  assert.deepEqual(plain(run(c, `_fsFill({ x: 1 }, { x: 2, y: 3 })`)), { x: 1, y: 3 });
  // 時刻のある欄どうし（新しい版の 2 台）の配列も足す（Codex の P2・6627627177：2 台が 1 つずつ入れたテストの片方が消えていた。画面は要素を消さない）。
  // 新しいほうの要素が最後（画面は配列の最後を最新と読む）
  const m = plain(run(c, `mergeFieldStampRec({ tests:[{c:'A'}], _ft:{ tests: 10 } }, { tests:[{c:'B'}], _ft:{ tests: 20 } })`));
  assert.deepEqual(m.tests, [{ c: 'A' }, { c: 'B' }]);
  // 真偽の欄だけ違う同じ要素は、どちらかで true なら true（再教育の「済み」が、あとから別の再教育を足した端末の写しで戻らない）
  const r2 = plain(run(c, `mergeFieldStampRec({ retrain:[{item:'Fry', done:true}], _ft:{ retrain: 10 } }, { retrain:[{item:'Fry', done:false}, {item:'Knife', done:false}], _ft:{ retrain: 20 } })`));
  assert.deepEqual(r2.retrain, [{ item: 'Fry', done: true }, { item: 'Knife', done: false }]);
  // 値（ステージなど）は今までどおり新しいほう
  assert.equal(run(c, `mergeFieldStampRec({ stage: 4 }, { stage: 2, _ft:{ stage: 5 } }).stage`), 2);
});

test('⑤ the same keep-local rule is used for app_settings and master tables in the full pull', () => {
  assert.match(SRC, /if \(typeof _pullKeepLocal==='function' && _pullKeepLocal\(row\.key, _spend\)\) return;/);   // 設定：時刻を渡さない＝送っている途中だけ
  assert.match(SRC, /if \(key !== 'm_employees' && key !== 'm_vendors' && typeof _pullKeepLocal==='function' && _pullKeepLocal\(key\)\) \{ results\.push/);
});

/* ------------------------------------------------------------------ 版 */
test('version 1136 or later in the page and the service worker (the same number); the tip question no longer says “on this device”', () => {
  const a = Number((SRC.match(/const APP_VERSION = '(\d+)';/) || [])[1]), b = Number((SW.match(/const SW_BUILD = '(\d+)';/) || [])[1]);
  assert.ok(a >= 1136, String(a)); assert.equal(a, b);   // v1137 で版を上げても落ちないように
  assert.ok(!SRC.includes('この端末で確定した記録はありません'));
});
