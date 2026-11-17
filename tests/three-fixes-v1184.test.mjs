// v1184（Moto さん 11/16 の依頼）：画面の決まりの試験（本物の関数を index.html から読み、VM で動かす。合成データだけ）。
//   1. 会議タブの KPI は KPI設定（予実 › KPI設定）の「使う」が正（_meetCfgRows・_meetHasAct・_meetCfgStatus）
//   2. 本部所属の人は店舗のスキルマトリクスの表示・集計に入れない（empHqState・skillMatrixStaffAt・skillMatrixHqNote）
//   3. 経費の申請の権限の画面（GM・CEO だけ）と、申請の画面の文（wr の ERR・本部（---）の店の選び方）は e2e（tests/e2e-wr/exp-grants-v1184.mjs）と
//      サーバーの試験（tests/wr-exp-grants-v1184.test.mjs）で見る
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function scanEnd(start, stopAtSemicolon) {
  let i = start, depth = 0, q = null, tpl = [];
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
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (ch === '}' && tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (!stopAtSemicolon && depth === 0 && ch === '}') return i + 1;
    } else if (stopAtSemicolon && depth === 0 && ch === ';') return i + 1;
  }
  throw new Error('unterminated at ' + start);
}
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  return SRC.slice(m.index, scanEnd(SRC.indexOf('{', m.index), false));
}
function wSrc(name) {
  const i = SRC.indexOf('W.' + name + ' = function');
  if (i < 0) throw new Error('W function not found: ' + name);
  return SRC.slice(i, scanEnd(SRC.indexOf('{', i), false));
}
/* 正規表現の文字（/'/g など）を含む大きな関数は、次の行頭の function までをそのまま読む（中身の文字を探すだけ） */
function roughSrc(name) {
  const m = new RegExp('^function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  const n = SRC.indexOf('\nfunction ', m.index + 10);
  return SRC.slice(m.index, n < 0 ? undefined : n);
}
function varSrc(name) {
  const m = new RegExp('^var ' + name + '\\s*=', 'm').exec(SRC);
  if (!m) throw new Error('var not found: ' + name);
  return SRC.slice(m.index, scanEnd(m.index + m[0].length, true));
}
const plain = v => JSON.parse(JSON.stringify(v));

test('版：ページと SW が同じ（1184 以上）', () => {
  const a = +(SRC.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1184 && a === s, a + ' / ' + s);
});

// ---------------------------------------------------------------- 1. 会議タブの KPI は KPI設定が正
function meetWorld({ on = {}, act = {}, tgt = {}, k2 = null, thr = null } = {}) {
  const c = { Array, Object, String, Number, Math, JSON, isFinite, t: (j) => j, statusCalls: [] };
  vm.createContext(c);
  vm.runInContext(varSrc('K2_DEFS'), c);
  vm.runInContext(varSrc('MEET_K2'), c); vm.runInContext(varSrc('MEET_K2R'), c); vm.runInContext(varSrc('MEET_ZERO_OK'), c);
  ['k2Def', '_meetHasAct', '_meetCfgRows', '_meetCfgStatus'].forEach(n => vm.runInContext(fnSrc(n), c));
  c.k2GuestUnit = () => '人';
  c._meetStatus = (key, a, t, lower) => { c.statusCalls.push([key, a, t, lower]); return thr ? thr(key, a, t, lower) : 'ok'; };
  /* KPI設定の行（_k2ActualsRaw と同じ形：{ store, ym, rows:[{ key, def, label, on, act, tgtJudge, diff, j }] }）。並びは K2_DEFS */
  c.k2Actuals = k2 || ((sid, ym) => ({ store: { id: sid }, ym, rows: c.K2_DEFS.map(d => ({ key: d.key, def: d, label: d.label + '（' + sid + '）', on: d.key === 'sales' ? true : (on[d.key] !== undefined ? on[d.key] : true),
    act: act[d.key] !== undefined ? act[d.key] : null, tgtJudge: tgt[d.key] !== undefined ? tgt[d.key] : null, diff: '', j: d.hpd ? (act[d.key] != null && tgt[d.key] != null ? (act[d.key] <= tgt[d.key] ? 'ok' : 'over') : 'none') : 'none' })) }));
  return c;
}
test('1-1 会議の KPI は KPI設定の「使う」が ON のものだけ（KPI設定の並び・名前）。売上はいつも先頭', () => {
  const c = meetWorld({ on: { guests: false, foodCost: false, drinkRate: true, misoUpgradeRate: false, ikuraShowerRate: false, reviewScore: false } });
  const r = c._meetCfgRows('F01', '2026-11', {});
  assert.equal(r.err, null);
  assert.deepEqual(plain(r.rows.map(x => x.k2key)), ['sales', 'ppa', 'repeatRate', 'laborPct', 'laborHours', 'drinkRate']);
  assert.deepEqual(plain(r.rows.map(x => x.key)), ['sales', 'ppa', 'repeat', 'labor', 'hours', 'drink']);
  assert.equal(r.rows[0].isSales, true);
  assert.equal(r.on, 5, '売上のほかに ON の数');
  assert.equal(r.rows[1].label, '客単価（F01）', '名前は KPI設定の行のまま');
  assert.equal(r.rows.find(x => x.key === 'hours').unit, 'h');
  assert.equal(r.rows.find(x => x.key === 'repeat').unit, '%');
  assert.equal(r.rows.find(x => x.key === 'ppa').money, true);
  assert.equal(r.rows.find(x => x.key === 'labor').lower, true);
});
test('1-2 「使う」が全部 OFF（売上のほか）：行は売上だけ・on は 0（既定の KPI に戻さない）', () => {
  const off = {}; ['guests', 'ppa', 'repeatRate', 'foodCost', 'laborPct', 'laborHours', 'drinkRate', 'misoUpgradeRate', 'ikuraShowerRate', 'reviewScore'].forEach(k => (off[k] = false));
  const r = meetWorld({ on: off })._meetCfgRows('F01', '2026-11', { budget: 1000, guestBudget: 50 });
  assert.deepEqual(plain(r.rows.map(x => x.key)), ['sales']);
  assert.equal(r.on, 0); assert.equal(r.err, null);
});
test('1-3 ON で実績・目標が無いものは null のまま（0 にしない）。率の 0 は本当の 0、客数の 0 はデータなし', () => {
  const c = meetWorld({ act: { guests: null, repeatRate: 0, drinkRate: 0, guests2: 0 }, tgt: { repeatRate: 20 } });
  const r = c._meetCfgRows('F01', '2026-11', {});
  const g = r.rows.find(x => x.key === 'guests'), rp = r.rows.find(x => x.key === 'repeat');
  assert.equal(g.act, null); assert.equal(g.tgt, null);
  assert.equal(rp.act, 0); assert.equal(rp.tgt, 20);
  assert.equal(c._meetHasAct('repeat', 0), true, 'リピート率の 0% は値');
  assert.equal(c._meetHasAct('drink', 0), true);
  assert.equal(c._meetHasAct('guests', 0), false, '客数の 0 はデータなし（前と同じ）');
  assert.equal(c._meetHasAct('fc', null), false);
  assert.equal(c._meetHasAct('fc', NaN), false);
  assert.equal(c._meetHasAct('ppa', 12.5), true);
});
test('1-4 目標は KPI設定の行（判定に使う目標）。無ければ予算の目標（periodK）で埋める', () => {
  const c = meetWorld({ tgt: { foodCost: 31, guests: null } });
  const r = c._meetCfgRows('F01', '2026-12', { budget: 5000, guestBudget: 120, ppaBudget: 40, repeatTgt: 25, fcBudgetRate: 33, laborBudgetRate: 28 });
  const by = Object.fromEntries(r.rows.map(x => [x.key, x.tgt]));
  assert.equal(by.fc, 31, 'KPI設定の目標が先');
  assert.equal(by.guests, 120); assert.equal(by.sales, 5000); assert.equal(by.labor, 28); assert.equal(by.repeat, 25);
  assert.equal(by.drink, null, '予算に無い KPI は null');
});
test('1-5 読めないときは理由（黙って消さない・既定に戻さない）', () => {
  const thr = meetWorld({ k2: () => { throw new Error('boom'); } })._meetCfgRows('F01', '2026-11', {});
  assert.deepEqual(plain(thr.rows), []); assert.equal(thr.err, 'boom');
  const nul = meetWorld({ k2: () => null })._meetCfgRows('F01', '2026-11', {});
  assert.ok(nul.err && /読めませんでした/.test(nul.err), nul.err);
  const empty = meetWorld({ k2: () => ({ rows: [] }) })._meetCfgRows('F01', '2026-11', {});
  assert.ok(empty.err);
});
test('1-6 判定：総労働時間は計画以内＝達成・超え＝未達（KPI設定の判定）、ほかは会議のしきい値', () => {
  const c = meetWorld({ act: { laborHours: 30, foodCost: 30 }, tgt: { laborHours: 28, foodCost: 31 } });
  const r = c._meetCfgRows('F01', '2026-11', {});
  assert.equal(c._meetCfgStatus(r.rows.find(x => x.key === 'hours')), 'miss');
  const c2 = meetWorld({ act: { laborHours: 25 }, tgt: { laborHours: 28 } });
  assert.equal(c2._meetCfgStatus(c2._meetCfgRows('F01', '2026-11', {}).rows.find(x => x.key === 'hours')), 'ok');
  const c3 = meetWorld({});
  assert.equal(c3._meetCfgStatus(c3._meetCfgRows('F01', '2026-11', {}).rows.find(x => x.key === 'hours')), 'none', '実績も目標も無い');
  c._meetCfgStatus(r.rows.find(x => x.key === 'fc'));
  assert.deepEqual(plain(c.statusCalls.pop()), ['fc', 30, 31, true], '原価率は上限（lower）で会議と同じ判定');
  c._meetCfgStatus(r.rows[0], 900, 1000);
  assert.deepEqual(plain(c.statusCalls.pop()), ['sales', 900, 1000, false], '売上は前日までの予算で');
});
test('1-7 会議タブの画面は KPI設定の行だけを使う（前の決まった並び _meetKpiRows を店舗カード・一覧・年間の表で使わない）', () => {
  const card = fnSrc('_meetStoreCard'), sum = fnSrc('_meetStoreSummary'), mat = fnSrc('_meetYearMatrix'), rev = fnSrc('renderMeetingReview');
  for (const [n, s] of [['_meetStoreCard', card], ['_meetStoreSummary', sum], ['renderMeetingReview', rev]]) {
    assert.ok(/_meetCfgRows\(/.test(s), n + ' が _meetCfgRows を使う');
    assert.ok(!/_meetKpiRows\(/.test(s), n + ' が前の _meetKpiRows を使わない');
  }
  assert.ok(/onAt\(k, selYm\)/.test(mat) && /k2On\(sid, ym, MEET_K2R\[kk\]\)/.test(mat), '年間の表の行は KPI設定の「使う」');
  assert.ok(/var ORDER=K2_DEFS\.map\(function\(d\)\{ return MEET_K2\[d\.key\]; \}\)\.filter\(Boolean\);/.test(mat) && /META\[kk\]\.label=/.test(mat), '年間の表の並びと名前は KPI設定（①〜⑪）');
  assert.ok(/data-meet-nokpi/.test(fnSrc('_meetNoCfgHtml')) && /表示するKPIが設定されていません/.test(fnSrc('_meetNoCfgHtml')));
  assert.ok(/k2On\(x\.s\.id, ym, 'reviewScore'\)/.test(rev), 'Google の口コミのカードも KPI設定で使うときだけ');
  assert.ok(/meetCfgSyncHtml\(ym\)/.test(rev), '開いたときに KPI設定をクラウドと照らす');
  assert.ok(/_applyKvRows\(rows, okKeys\)/.test(fnSrc('meetCfgSync')), '取り込みはまとめ取りと同じ（欄ごとに新しいほう・送れていない手元の変更は残す）');
  assert.ok(!/lsSet\(|setKpiManual\(/.test(fnSrc('meetCfgSync')), '会議タブは設定を書かない');
});
test('1-8 KPI設定の画面と会議タブの実績は同じ 1 つ（k2KstatR）', () => {
  assert.ok(/k2Kstat\(sid, ym\)/.test(fnSrc('_k2ActualsRaw')));
  assert.ok(/k2KstatR\(s\.id, ym\)/.test(fnSrc('renderMeetingReview')));
});

// ---------------------------------------------------------------- 2. 本部所属はスキルマトリクスに入れない
function hqWorld({ role = 'gm', emps = [] } = {}) {
  const c = { Array, Object, String, t: (j) => j, curRole: role };
  vm.createContext(c);
  vm.runInContext(varSrc('STORE_STAFF_ROLES'), c); vm.runInContext(varSrc('EMP_HQ_STORE'), c);
  ['isStoreStaff', 'empStoresOf', 'empWorksAt', 'empHqState', 'empIsHq', 'skillMatrixStaffAt', 'skillMatrixHqNote', 'escapeHtml'].forEach(n => vm.runInContext(fnSrc(n), c));
  c.getStoresAll = () => [{ id: 'F01' }, { id: 'F02' }];
  c.amStoresOf = () => [];
  c.visibleStaffForManager = () => emps;
  return c;
}
const E = (name, store, extra = {}) => Object.assign({ name, role: 'crew', store, support: [], status: '在籍' }, extra);
test('2-1 本部所属の決め方は従業員マスターの所属（e.store）だけ', () => {
  const c = hqWorld();
  for (const s of ['OFFICE', 'Office', 'office', '本部', 'HQ', 'hq', '---', ' OFFICE ']) assert.equal(c.empHqState(E('x', s)), 'hq', s);
  assert.equal(c.empHqState(E('x', 'ALL')), 'all', '全店は分からない（確認対象）');
  assert.equal(c.empHqState(E('x', '')), 'unknown'); assert.equal(c.empHqState(E('x', null)), 'unknown');
  assert.equal(c.empHqState(E('x', 'ZZZ')), 'unknown', '店舗マスターに無い店');
  assert.equal(c.empHqState(E('x', 'F01')), 'store');
  assert.equal(c.empHqState(null), 'unknown');
  /* 名前・役職・グレード・閲覧の権限では決めない */
  assert.equal(c.empHqState(E('Office Taro', 'F01', { role: 'gm', title: 'General Manager', perms: 'admin' })), 'store');
  assert.equal(c.empHqState(E('x', 'OFFICE', { role: 'crew', title: 'Crew' })), 'hq');
});
test('2-2 店舗の表と集計（Lv3 の人数など）に本部所属を入れない。全店・不明は残して確認対象として出す', () => {
  const emps = [E('Ann Store', 'F01'), E('Hana Hq', 'OFFICE', { support: ['F01'] }), E('Ken Hq2', '本部', { support: ['F01', 'F02'], role: 'chef' }),
    E('Alla All', 'ALL'), E('Nora None', '', { support: ['F01'] }), E('Ota Office', 'ALL', { role: 'office' }), E('Bea Two', 'F02')];
  const c = hqWorld({ emps });
  const names = c.skillMatrixStaffAt('F01').map(e => e.name);
  assert.deepEqual(plain(names), ['Ann Store', 'Alla All', 'Nora None']);
  assert.deepEqual(plain(c.skillMatrixStaffAt('F02').map(e => e.name)), ['Alla All', 'Bea Two']);
  const note = c.skillMatrixHqNote('F01', c.skillMatrixStaffAt('F01'));
  assert.match(note, /data-hq-n="2"/); assert.match(note, /data-chk-n="2"/);
  assert.match(note, /Hana Hq/); assert.match(note, /Ken Hq2/); assert.match(note, /Alla All（全店）/); assert.match(note, /Nora None（所属なし・不明）/);
  assert.doesNotMatch(note, /Ann Store/);
});
test('2-3 一行の知らせは GM・CEO・経理だけ。名前はエスケープ', () => {
  const emps = [E('<b>x</b>', 'OFFICE', { support: ['F01'] })];
  assert.equal(hqWorld({ role: 'sl', emps }).skillMatrixHqNote('F01', []), '');
  assert.equal(hqWorld({ role: 'am', emps }).skillMatrixHqNote('F01', []), '');
  const n = hqWorld({ role: 'office', emps }).skillMatrixHqNote('F01', []);
  assert.match(n, /&lt;b&gt;x&lt;\/b&gt;/); assert.doesNotMatch(n, /<b>x<\/b>/);
  assert.equal(hqWorld({ role: 'gm', emps: [E('a', 'F01')] }).skillMatrixHqNote('F01', [E('a', 'F01')]), '', '外した人も確認対象もいなければ出さない');
});
test('2-4 表示の個別設定より先に外す（表示対象の候補・人ごとの画面・ポジション別も同じ）', () => {
  assert.ok(/!\(typeof empIsHq === 'function' && empIsHq\(e\)\) && empWorksAt\(e, store\)/.test(wSrc('wrViewEdit')), '表示対象の候補（skillMatrixStaffAt と同じ決まり）');
  assert.ok(/empIsHq\(e\)/.test(roughSrc('renderSkillStaffView')), '人ごとの画面');
  assert.ok(/skillMatrixStaffAt\(storeId\)/.test(roughSrc('renderSkillPositionView')), 'ポジション別（Lv3 の人数）');
  assert.ok(/skillMatrixStaffAt\(mgrStoreId\)/.test(roughSrc('renderSkillManager')), '店舗別のマトリクス・Lv3 不在');
});
test('2-5 データは消さない（表示の関数はスキル・評価の保存に触らない）', () => {
  for (const n of ['empHqState', 'skillMatrixStaffAt', 'skillMatrixHqNote']) assert.ok(!/lsSet\(|setSkill|saveSkill|_pushWithOutbox/.test(fnSrc(n)), n);
});
