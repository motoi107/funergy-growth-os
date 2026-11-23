// Career Score 2026 Q4（新制度 CAREER_2026_Q4_V1）の計算の核の試験。合成データだけ（実従業員の評価は使わない）
// 対象：careerscore/q4-core.mjs と careerscore/cs-q4-v1.json（Excel から scripts/gen-cs-q4-master.py が作る）
// 依頼の「9. 必須の検証」のうち、計算・マスター・期間の境界（4・6 の一部・9〜17 の計算・19・20 の計算の部分）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../careerscore/q4-core.mjs';

const M = JSON.parse(fs.readFileSync(new URL('../careerscore/cs-q4-v1.json', import.meta.url), 'utf8'));
const { STATUS, NA_REASON } = C;

// ---------- 入力の形 ----------
const S = (score) => ({ status: STATUS.SCORED, score });
const UA = (reason = '担当の機会がまだない（合成）') => ({ status: STATUS.UNASSIGNED, score: 0, unassignedReason: reason });
const NR = (reason = '職務上該当しない（合成）') => ({ status: STATUS.NOT_APPLICABLE, score: null, naReasonType: NA_REASON.ROLE, naReason: reason });
const NC = (from = '2026-10-01', to = '2026-12-31') => ({ status: STATUS.NOT_APPLICABLE, score: null, naReasonType: NA_REASON.COMPANY, naReason: '会社都合で今期は任せていない（合成）', periodOnly: true, periodFrom: from, periodTo: to });
const UN = () => ({ status: STATUS.UNASSESSED, score: null });
const items = (sys) => C.csq4System(M, sys).items;
const fill = (sys, fn) => { const e = {}; for (const it of items(sys)) { const v = fn(it); if (v) e[it.id] = v; } return e; };
const cat = (r, key) => r.categories.find((c) => c.key === key);
const fr = (s) => { const [n, d] = s.split('/'); return C.frac(n, d); };

// 決まった数を確かめるための小さなマスター（本物のマスターの形を写し、系統 G だけ入れ替える）
function mini(cats, opts = {}) {
  const m = JSON.parse(JSON.stringify(M));
  const its = [];
  const w = {};
  for (const c of cats) {
    w[c.key] = c.weight;
    for (let i = 1; i <= c.n; i++) its.push({ id: c.key + '-' + String(i).padStart(4, '0'), cat: c.key, name: c.key + ' ' + i, desc: '合成', cls: c.cls });
  }
  const grade = opts.grade || 'G3';
  m.systems.G = { name: '合成', unassigned: true, categories: cats.map((c) => ({ key: c.key, name: c.key })), items: its, weights: { [grade]: { T: { weights: w } } }, mainMap: {}, mainMapNote: '合成' };
  return m;
}

// ---------- 4) マスター ----------
test('4) master: G122・Prep11（品質3は別枠）・S Chef52・S Office46、ID・文面・説明の欠落と重複がない', () => {
  assert.equal(M.version, 'CAREER_2026_Q4_V1');
  assert.equal(M.version, C.CSQ4_VERSION);
  assert.equal(M.source.sha256, '380884c8095898570ce2423ef5b424266299218797333bc9ff17a8dfd8bf6174');
  assert.deepEqual(M.period, { tz: 'Pacific/Honolulu', quarter: '2026-Q4', start: '2026-10-01', endExclusive: '2027-01-01' });
  assert.equal(items('G').length, 122);
  assert.equal(items('PREP').length, 11);
  assert.equal(M.systems.PREP.quality.length, 3);
  assert.deepEqual(M.systems.PREP.quality.map((q) => q.id), ['Q1', 'Q2', 'Q3']);
  assert.ok(M.systems.PREP.quality.every((q) => !items('PREP').some((i) => i.id === q.id)), '品質 Q1〜Q3 は行動確認の項目に入れない');
  assert.equal(items('S_CHEF').length, 52);
  assert.equal(items('S_OFFICE').length, 46);
  const txt = (v) => typeof v === 'string' && v.trim().length > 0;
  for (const sys of ['G', 'S_CHEF', 'S_OFFICE', 'PREP']) {
    const its = items(sys);
    const ids = its.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, sys + ' の ID が重複しない');
    for (const it of its) {
      assert.ok(txt(it.id) && txt(it.name), sys + ' ' + it.id + ' の ID と名前');
      if (sys !== 'PREP') assert.ok(txt(it.desc), sys + ' ' + it.id + ' の説明');
      if (sys === 'S_CHEF' || sys === 'S_OFFICE') assert.ok(txt(it.detail), sys + ' ' + it.id + ' の詳しい説明');
    }
    if (sys === 'PREP') continue;
    const keys = C.csq4System(M, sys).categories.map((c) => c.key);
    for (const it of its) assert.ok(keys.includes(it.cat), sys + ' ' + it.id + ' のカテゴリー');
    for (const c of M.philoClasses) assert.ok(its.some((i) => i.cat === 'PHILO' && i.cls === c.key), sys + ' 理念の分類 ' + c.key);
    for (const it of its.filter((i) => i.cat === 'PHILO')) assert.ok(M.philoClasses.some((c) => c.key === it.cls), sys + ' ' + it.id + ' の理念の分類');
  }
  // カテゴリーごとの数（G）
  const gc = {}; for (const i of items('G')) gc[i.cat] = (gc[i.cat] || 0) + 1;
  assert.deepEqual(gc, { PHILO: 16, BASIC: 13, SERVICE: 12, KITCHEN: 20, MARKETING: 13, MGMT: 21, NUMBERS: 15, DEVELOP: 12 });
  // S Office の技術・専門実務は 1 項目 1 領域（共通 ID を分けない・二重に数えない）
  const O = M.systems.S_OFFICE;
  for (const it of O.items.filter((i) => i.cat === 'TECH')) {
    const hits = O.domains.filter((d) => d.key === it.domain);
    assert.equal(hits.length, 1, it.id + ' の領域は 1 つ');
    assert.ok(hits[0].prefixes.some((p) => it.id.startsWith(p)), it.id + ' の領域と ID の頭が合う');
  }
  for (const it of O.items.filter((i) => i.cat !== 'TECH')) assert.ok(!it.domain, it.id + ' は技術実務の領域に入らない');
  // 欠番は埋めない
  for (const id of ['02-06', '05-07']) assert.ok(!items('G').some((i) => i.id === id), 'G に ' + id + ' を足さない');
  assert.ok(!items('S_OFFICE').some((i) => i.id === '01-04'), 'Office の理念に 01-04 を足さない');
  // 「OF-Q-01／HR-Q-01」などはスラッシュを含む文字列全体で 1 項目（分けない）
  const shared = O.items.filter((i) => i.id.includes('／'));
  assert.equal(shared.length, 11);
  assert.ok(shared.some((i) => i.id === 'OF-Q-01／HR-Q-01'));
  for (const it of shared) for (const part of it.id.split('／')) assert.ok(!O.items.some((x) => x.id === part), part + ' を別の項目にしない');
  // 分野でカテゴリーを決める（AC-Q は ID が経理でも品質・管理のまま。領域は技術実務だけ）
  for (const it of O.items.filter((i) => i.id.startsWith('AC-Q-'))) { assert.equal(it.cat, 'QUALITY', it.id); assert.ok(!it.domain); }
  // 共通の理念でも系統ごとに別の項目（同じ 01-03 を他系統の文面で上書きしない）
  const t = (sys, id) => items(sys).find((i) => i.id === id).name;
  assert.notEqual(t('S_OFFICE', '01-03'), t('G', '01-03'));
  assert.equal(items('G').filter((i) => i.cat === 'PHILO').length, 16);
  assert.equal(items('S_CHEF').filter((i) => i.cat === 'PHILO').length, 16);
  assert.equal(items('S_OFFICE').filter((i) => i.cat === 'PHILO').length, 15);
});

test('4) master: 配点はどの行も合計 100（配点 0 のカテゴリーも消さない）・基準点の表', () => {
  for (const sys of ['G', 'S_CHEF', 'S_OFFICE']) {
    const def = C.csq4System(M, sys);
    const keys = def.categories.map((c) => c.key).sort();
    const rows = sys === 'G' ? Object.entries(def.weights).flatMap(([g, r]) => Object.entries(r).map(([t, x]) => [g + ' ' + t, x.weights])) : Object.entries(def.weights).map(([g, x]) => [g, x.weights]);
    assert.ok(rows.length > 0);
    for (const [name, w] of rows) {
      assert.deepEqual(Object.keys(w).sort(), keys, sys + ' ' + name + ' のカテゴリー（配点 0 も残る）');
      assert.equal(Object.values(w).reduce((a, b) => a + Number(b), 0), 100, sys + ' ' + name + ' の合計');
    }
  }
  assert.deepEqual(Object.keys(M.systems.G.weights.G3).sort(), ['Kitchen中心', 'Server中心', '両部門育成'].sort());
  assert.equal(M.systems.G.weights.G1['Kitchen中心'].weights.MGMT, 0, 'G1 の店舗運営は配点 0 でも残る');
  assert.deepEqual(M.base, { G: { 1: 55, 2: 65, 3: 75, 4: 85, 5: 90, 6: 95 }, S: { 1: 65, 2: 70, 3: 75, 4: 85, 5: 90, 6: 95 } });
});

test('4) master: 見直しメモは本人向けの一覧に出さない', () => {
  const e = fill('G', (it) => (it.cat === 'KITCHEN' ? UA() : it.cat === 'SERVICE' ? NR() : S(2)));
  const r = C.csq4Score(M, { system: 'G', grade: 'G3', type: 'Kitchen中心', entries: e });
  for (const row of [...r.unassignedList, ...r.roleNaList]) {
    assert.ok(!('memo' in row), 'memo を出さない');
    assert.ok(!('detail' in row));
  }
  assert.equal(r.unassignedList.length, 20);
  assert.equal(r.roleNaList.length, 12);
});

// ---------- 6) 期間の境界（Honolulu）----------
test('6) Honolulu の 9/30 と 10/1・12/31 と 1/1 の境界', () => {
  assert.equal(C.csq4HnlDate('2026-10-01T09:59:59.999Z'), '2026-09-30');
  assert.equal(C.csq4HnlDate('2026-10-01T10:00:00Z'), '2026-10-01');
  assert.equal(C.csq4HnlDate('2027-01-01T09:59:59Z'), '2026-12-31');
  assert.equal(C.csq4HnlDate('2027-01-01T10:00:00Z'), '2027-01-01');
  assert.equal(C.csq4InPeriod(M, '2026-10-01T09:59:59Z'), false);
  assert.equal(C.csq4InPeriod(M, '2026-10-01T10:00:00Z'), true);
  assert.equal(C.csq4InPeriod(M, '2027-01-01T09:59:59Z'), true);
  assert.equal(C.csq4InPeriod(M, '2027-01-01T10:00:00Z'), false);
  assert.equal(C.csq4InPeriod(M, '2026-10-15T12:00:00+09:00'), true, '日本時間の入力も同じ瞬間で判定');
  assert.equal(C.csq4HnlDate('not a date'), null);
  assert.equal(C.csq4InPeriod(M, 'not a date'), false);
  // 入力日時は書き換えない
  const d = new Date('2026-12-31T23:30:00-10:00'); const t0 = d.getTime();
  assert.equal(C.csq4HnlDate(d), '2026-12-31');
  assert.equal(d.getTime(), t0);
});

test('6) 会社都合の今回非該当の期間は Q4（2026-10-01〜2026-12-31）の中だけ', () => {
  const id = '04-01';
  const chk = (e) => C.csq4CheckEntry(M, 'G', id, e);
  assert.deepEqual(chk(NC('2026-10-01', '2026-12-31')), []);
  assert.deepEqual(chk(NC('2026-12-31', '2026-12-31')), []);
  assert.deepEqual(chk(NC('2026-09-30', '2026-12-31')), ['company_na_period_out_of_quarter']);
  assert.deepEqual(chk(NC('2026-10-01', '2027-01-01')), ['company_na_period_out_of_quarter']);
  assert.deepEqual(chk(NC('2026-11-01', '2026-10-31')), ['company_na_period_out_of_quarter']);
  assert.deepEqual(chk(NC('2026/10/01', '2026-12-31')), ['company_na_period_required']);
  assert.deepEqual(chk({ ...NC(), periodOnly: false }), ['company_na_period_only']);
});

// ---------- 入力の確かめ（サーバーも同じ関数）----------
test('入力の確かめ：点数・理由・種別・系統ごとの決まり', () => {
  const g = (e, id = '04-01') => C.csq4CheckEntry(M, 'G', id, e);
  assert.deepEqual(g(S(0)), []);
  assert.deepEqual(g(S(3)), []);
  for (const bad of [4, -1, 1.5, '2', null]) assert.deepEqual(g({ status: STATUS.SCORED, score: bad }), ['bad_score'], 'score ' + bad);
  assert.deepEqual(g(UA()), []);
  assert.deepEqual(g({ ...UA(), score: 1 }), ['unassigned_score_is_0']);
  assert.deepEqual(g({ status: STATUS.UNASSIGNED, score: 0, unassignedReason: '  ' }), ['unassigned_reason_required']);
  assert.deepEqual(g(NR()), []);
  assert.deepEqual(g({ ...NR(), score: 0 }), ['na_score_is_null']);
  assert.deepEqual(g({ ...NR(), naReason: '' }), ['na_reason_required']);
  assert.deepEqual(g({ status: STATUS.NOT_APPLICABLE, score: null, naReason: '理由' }), ['na_reason_type_required']);
  assert.deepEqual(g({ ...NR(), periodOnly: true }), ['period_only_company_only']);
  assert.deepEqual(g(UN()), []);
  assert.deepEqual(g({ status: STATUS.UNASSESSED, score: 2 }), ['unassessed_score_is_null']);
  assert.deepEqual(g({ status: 'DONE', score: 2 }), ['bad_status']);
  assert.deepEqual(g(S(2), 'ZZ-99'), ['unknown_item']);
  assert.deepEqual(g(null), ['bad_entry']);
  // S・Prep に G の未担当 0 点と会社都合の特例を広げない
  const cid = items('S_CHEF')[0].id, oid = items('S_OFFICE')[0].id, pid = items('PREP')[0].id;
  assert.deepEqual(C.csq4CheckEntry(M, 'S_CHEF', cid, UA()), ['unassigned_only_g']);
  assert.deepEqual(C.csq4CheckEntry(M, 'S_OFFICE', oid, UA()), ['unassigned_only_g']);
  assert.deepEqual(C.csq4CheckEntry(M, 'PREP', pid, UA()), ['unassigned_only_g']);
  assert.deepEqual(C.csq4CheckEntry(M, 'S_CHEF', cid, NC()), ['na_reason_type_g_only']);
  assert.deepEqual(C.csq4CheckEntry(M, 'S_CHEF', cid, NR()), []);
  assert.deepEqual(C.csq4CheckEntry(M, 'S_CHEF', cid, { status: STATUS.NOT_APPLICABLE, score: null, naReason: '理由' }), [], 'S は種別を省いてよい（職務上の非該当）');
  assert.throws(() => C.csq4CheckEntry(M, 'X', 'a', S(1)), /unknown system/);
});

test('入力に誤りのある項目は計算で未評価として扱い、確定させない', () => {
  const e = fill('G', () => S(3));
  e['04-01'] = { status: STATUS.SCORED, score: 5 };
  e['ZZ-1'] = S(3);
  const r = C.csq4Score(M, { system: 'G', grade: 'G3', type: 'Kitchen中心', entries: e });
  assert.deepEqual(r.entryErrors, { '04-01': ['bad_score'] });
  assert.deepEqual(r.unknownItems, ['ZZ-1']);
  assert.equal(r.state, 'in_progress');
  assert.equal(r.confirmable, false);
  assert.equal(r.baseMet, null);
  assert.equal(r.counts.unassessed, 1);
  // 等級・担当型の誤り
  assert.deepEqual(C.csq4Score(M, { system: 'G', grade: 'S3', type: 'Kitchen中心', entries: {} }), { ok: false, error: 'bad_grade' });
  assert.deepEqual(C.csq4Score(M, { system: 'G', grade: 'G3', type: '店長', entries: {} }), { ok: false, error: 'bad_type' });
  assert.deepEqual(C.csq4Score(M, { system: 'S_CHEF', grade: 'G3', entries: {} }), { ok: false, error: 'bad_grade' });
  assert.throws(() => C.csq4Score(M, { system: 'PREP', grade: 'G1', entries: {} }), /csq4Prep/);
});

// ---------- 9)・10) 未担当・採点 0・非該当・未評価 ----------
test('9) 30 点枠で 2・2・2・未担当は 15 点、最後が採点 0 点でも 15 点、理由付き非該当なら 20 点', () => {
  const m = mini([{ key: 'X', weight: 30, n: 4 }, { key: 'Y', weight: 70, n: 1 }]);
  const run = (last) => C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: { 'X-0001': S(2), 'X-0002': S(2), 'X-0003': S(2), 'X-0004': last, 'Y-0001': S(3) } });
  const a = run(UA()), b = run(S(0)), c = run(NR());
  assert.equal(cat(a, 'X').score.exact, '15/1');
  assert.equal(cat(b, 'X').score.exact, '15/1');
  assert.equal(cat(c, 'X').score.exact, '20/1');
  assert.equal(cat(a, 'X').targetWeight, 30);
  assert.equal(cat(c, 'X').targetWeight, 30);
  assert.equal(a.total.exact, '85/1');
  assert.equal(c.total.exact, '90/1');
  assert.deepEqual(cat(a, 'X').counts, { items: 4, scored: 3, unassigned: 1, naRole: 0, naCompany: 0, unassessed: 0 });
  assert.equal(a.counts.unassigned, 1, '未担当は採点数と別に数える');
  assert.equal(a.counts.scored, 4);
  assert.equal(a.state, 'complete');
  assert.equal(a.confirmable, true);
  // G で全項目が未担当なら 0 点で配点を残す
  const z = C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: { 'X-0001': UA(), 'X-0002': UA(), 'X-0003': UA(), 'X-0004': UA(), 'Y-0001': S(3) } });
  assert.equal(cat(z, 'X').state, 'counted');
  assert.equal(cat(z, 'X').targetWeight, 30);
  assert.equal(cat(z, 'X').score.exact, '0/1');
  assert.equal(z.total.exact, '70/1');
});

test('10) 最後が未評価なら確定できない・全項目非該当で対象配点 0 なら算出不可（0 点・100 点・達成にしない）', () => {
  const m = mini([{ key: 'X', weight: 30, n: 4 }, { key: 'Y', weight: 70, n: 1 }]);
  const p = C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: { 'X-0001': S(2), 'X-0002': S(2), 'X-0003': S(2), 'X-0004': UN(), 'Y-0001': S(3) } });
  assert.equal(p.state, 'in_progress');
  assert.equal(p.confirmable, false);
  assert.equal(p.totalProvisional, true);
  assert.equal(p.baseMet, null);
  assert.equal(cat(p, 'X').state, 'partial');
  assert.equal(p.counts.unassessed, 1);
  // 入っていない項目も未評価
  const q = C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: { 'X-0001': S(2) } });
  assert.equal(q.state, 'in_progress');
  assert.equal(cat(q, 'Y').state, 'pending');
  const none = C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: {} });
  assert.equal(none.state, 'not_started');
  assert.equal(none.total, null);
  // 全項目非該当
  const na = C.csq4Score(m, { system: 'G', grade: 'G3', type: 'T', entries: { 'X-0001': NR(), 'X-0002': NR(), 'X-0003': NC(), 'X-0004': NR(), 'Y-0001': NR() } });
  assert.equal(na.state, 'not_calculable');
  assert.equal(na.total, null);
  assert.equal(na.targetWeight, 0);
  assert.equal(na.baseMet, null);
  assert.equal(na.confirmable, false);
  assert.ok(na.categories.every((c) => c.state === 'excluded'));
  // 本物のマスター
  const r = C.csq4Score(M, { system: 'S_CHEF', grade: 'S2', entries: fill('S_CHEF', () => NR()) });
  assert.equal(r.state, 'not_calculable');
  assert.equal(r.total, null);
});

// ---------- 11)・14) 丸め ----------
test('11) 全項目 3 点なら 100 点、全項目 2 点なら 66.666…（表示 66.7・判定は丸め前）', () => {
  for (const [sys, grade, type] of [['G', 'G3', 'Kitchen中心'], ['G', 'G6', '全社責任'], ['S_CHEF', 'S4'], ['S_OFFICE', 'S1']]) {
    const a = C.csq4Score(M, { system: sys, grade, type, entries: fill(sys, () => S(3)) });
    assert.equal(a.total.exact, '100/1', sys + ' ' + grade);
    assert.equal(a.total.display, '100.0');
    assert.equal(a.targetWeight, 100);
    assert.equal(a.state, 'complete');
    assert.equal(a.baseMet, true);
    const b = C.csq4Score(M, { system: sys, grade, type, entries: fill(sys, () => S(2)) });
    assert.equal(b.total.exact, '200/3', sys + ' ' + grade);
    assert.equal(b.total.display, '66.7');
    assert.ok(Math.abs(b.total.value - 200 / 3) < 1e-12);
  }
  // G2 の基準 65：66.666… は達成。S2 の基準 70 は未達
  assert.equal(C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Server中心', entries: fill('G', () => S(2)) }).baseMet, true);
  assert.equal(C.csq4Score(M, { system: 'S_CHEF', grade: 'S2', entries: fill('S_CHEF', () => S(2)) }).baseMet, false);
});

test('14) 内部 84.96・基準 85 は表示 85.0 でも未達。未評価・対象配点 0 のときは基準点達成を出さない', () => {
  assert.equal(C.fixed1(C.frac(2124, 25)), '85.0');
  assert.equal(C.fixed1(C.frac(8495, 100)), '85.0', '四捨五入');
  assert.equal(C.fixed1(C.frac(8494, 100)), '84.9');
  assert.equal(C.fixed1(C.frac(0)), '0.0');
  assert.equal(C.fixed1(C.frac(100)), '100.0');
  assert.equal(C.fixed1(C.frac(200, 3)), '66.7');
  assert.equal(C.fixed1(C.frac(1, 20)), '0.1');
  assert.throws(() => C.fixed1(C.frac(-1)), /negative/);
  // 625 項目：3 点 343・2 点 282 → 1593 / 1875 ＝ 0.8496
  const m = mini([{ key: 'X', weight: 100, n: 625 }], { grade: 'G4' });
  const e = {};
  m.systems.G.items.forEach((it, i) => { e[it.id] = S(i < 343 ? 3 : 2); });
  const r = C.csq4Score(m, { system: 'G', grade: 'G4', type: 'T', entries: e });
  assert.equal(r.total.exact, '2124/25');
  assert.equal(r.total.display, '85.0');
  assert.equal(r.base, 85);
  assert.equal(r.baseMet, false, '丸めた 85.0 ではなく 84.96 で判定');
  // 1 項目上げると 85 を超える
  e[m.systems.G.items[343].id] = S(3);
  assert.equal(C.csq4Score(m, { system: 'G', grade: 'G4', type: 'T', entries: e }).baseMet, true);
  // 未評価なら判定しない
  e[m.systems.G.items[0].id] = UN();
  const u = C.csq4Score(m, { system: 'G', grade: 'G4', type: 'T', entries: e });
  assert.equal(u.baseMet, null);
  assert.equal(u.totalProvisional, true);
});

// ---------- 12) Kitchen 30 の未担当と会社都合 ----------
test('12) G3 Kitchen中心：Kitchen 30 が全部未担当・ほか 70 点枠で 42 点なら 42 点。会社都合なら 60 点・対象配点 70', () => {
  const w = M.systems.G.weights.G3['Kitchen中心'].weights;
  assert.equal(w.KITCHEN, 30);
  // 理念 20・基本 10・店舗運営 10 は全部 3 点（40）、数値管理 5 は 15 項目のうち 9 項目 2 点・6 項目 0 点（2）、ほかは 0 点
  const numbers = items('G').filter((i) => i.cat === 'NUMBERS');
  const make = (kitchen) => fill('G', (it) => {
    if (it.cat === 'KITCHEN') return kitchen();
    if (['PHILO', 'BASIC', 'MGMT'].includes(it.cat)) return S(3);
    if (it.cat === 'NUMBERS') return S(numbers.indexOf(it) < 9 ? 2 : 0);
    return S(0);
  });
  const a = C.csq4Score(M, { system: 'G', grade: 'G3', type: 'Kitchen中心', entries: make(() => UA()) });
  assert.equal(cat(a, 'NUMBERS').score.exact, '2/1');
  assert.equal(cat(a, 'KITCHEN').score.exact, '0/1');
  assert.equal(a.total.exact, '42/1');
  assert.equal(a.targetWeight, 100);
  assert.equal(a.counts.unassigned, 20);
  const b = C.csq4Score(M, { system: 'G', grade: 'G3', type: 'Kitchen中心', entries: make(() => NC()) });
  assert.equal(b.total.exact, '60/1');
  assert.equal(b.targetWeight, 70);
  assert.equal(b.baseWeight, 100, '元の配点 100 は残す');
  assert.equal(cat(b, 'KITCHEN').state, 'excluded');
  assert.equal(b.counts.naCompany, 20);
  // 会社都合の今回非該当も本人向けの一覧に残る（完全非該当は別枠）
  assert.equal(b.unassignedList.length, 20);
  assert.ok(b.unassignedList.every((x) => x.naReasonType === NA_REASON.COMPANY && x.periodFrom === '2026-10-01' && x.periodTo === '2026-12-31'));
  assert.equal(b.roleNaList.length, 0);
});

// ---------- 13) 理念 5 分類 ----------
test('13) 理念：1 分類が全部非該当・残り 4 分類が全部 3 点なら 20 点。未担当だけの分類は外さない（0 点）', () => {
  const run = (enjoy) => C.csq4Score(M, { system: 'G', grade: 'G1', type: 'Kitchen中心', entries: fill('G', (it) => (it.cat === 'PHILO' && it.cls === 'ENJOY' ? enjoy() : S(3))) });
  const a = run(() => NR());
  const pa = cat(a, 'PHILO');
  assert.equal(pa.score.exact, '20/1');
  assert.equal(pa.parts.find((p) => p.key === 'ENJOY').state, 'excluded');
  assert.equal(a.total.exact, '100/1');
  const b = run(() => UA());
  const pb = cat(b, 'PHILO');
  assert.equal(pb.parts.find((p) => p.key === 'ENJOY').state, 'counted');
  assert.equal(pb.score.exact, '16/1', '(0+1+1+1+1)/5 × 20');
  // 分類の項目数が違っても分類ごとに等しく（楽しむ 4 項目だけ 0 点 → 項目平均なら 12/16 だが分類平均は 4/5）
  const c = run(() => S(0));
  assert.equal(cat(c, 'PHILO').score.exact, '16/1');
  // 理念全体が非該当なら理念の対象配点 20 を外す
  const d = C.csq4Score(M, { system: 'G', grade: 'G1', type: 'Kitchen中心', entries: fill('G', (it) => (it.cat === 'PHILO' ? NR() : S(3))) });
  assert.equal(cat(d, 'PHILO').state, 'excluded');
  assert.equal(d.targetWeight, 80);
  assert.equal(d.total.exact, '100/1');
});

// ---------- 15) S Office の領域 ----------
test('15) S Office の技術・専門実務は領域ごとの平均を等しく平均（項目数が違っても）', () => {
  const tech = items('S_OFFICE').filter((i) => i.cat === 'TECH');
  const acc = tech.filter((i) => i.domain === 'ACCOUNTING');
  const e = fill('S_OFFICE', (it) => {
    if (it.cat !== 'TECH') return S(3);
    if (it.domain === 'OFFICE') return S(3);
    if (it.domain === 'ACCOUNTING') return it.id === acc[0].id ? S(0) : NR();
    return NR();          // 人事は全部非該当 → 領域ごと外す
  });
  const r = C.csq4Score(M, { system: 'S_OFFICE', grade: 'S1', entries: e });
  const t = cat(r, 'TECH');
  assert.equal(t.weight, 40);
  // 領域の平均：Office 3/3・経理 0/3（人事は外す）→ (1 + 0) / 2 × 40 ＝ 20（項目の平均なら 12/15 × 40 ＝ 32）
  assert.equal(t.score.exact, '20/1');
  assert.deepEqual(t.parts.map((p) => [p.key, p.state]), [['OFFICE', 'counted'], ['ACCOUNTING', 'counted'], ['HR', 'excluded']]);
  assert.equal(t.counts.scored, 5);
  assert.equal(t.counts.naRole, 7);
  assert.equal(r.total.exact, '80/1');
});

// ---------- 16) 等級で項目を自動で隠さない・G5/G6 の追加 10 項目 ----------
test('16) G3 の 08-11・S3 の CF-32 は等級だけで隠したり非該当にしたりしない', () => {
  const g = fill('G', (it) => (it.id === '08-11' ? null : S(3)));
  const r = C.csq4Score(M, { system: 'G', grade: 'G3', type: '両部門育成', entries: g });
  assert.equal(r.state, 'in_progress', '08-11 が未評価のあいだは確定しない');
  assert.equal(cat(r, 'DEVELOP').counts.unassessed, 1);
  g['08-11'] = NR('G3 で次のリーダー候補の担当機会がない（合成）');
  assert.equal(C.csq4Score(M, { system: 'G', grade: 'G3', type: '両部門育成', entries: g }).state, 'complete', '上司が理由を付けて非該当にできる');
  const s = fill('S_CHEF', (it) => (it.id === 'CF-32' ? null : S(3)));
  const q = C.csq4Score(M, { system: 'S_CHEF', grade: 'S3', entries: s });
  assert.equal(q.state, 'in_progress');
  assert.ok(items('S_CHEF').some((i) => i.id === 'CF-32'));
});

test('16) G5・G6 の追加 10 項目も計算に入り、満点は 100 のまま', () => {
  const extra = ['06-16', '06-17', '06-18', '06-19', '06-20', '06-21', '07-13', '07-14', '07-15', '08-12'];
  for (const id of extra) assert.ok(items('G').some((i) => i.id === id), id);
  for (const [grade, type] of [['G5', '管轄責任'], ['G6', '全社責任']]) {
    const full = C.csq4Score(M, { system: 'G', grade, type, entries: fill('G', () => S(3)) });
    assert.equal(full.total.exact, '100/1');
    const r = C.csq4Score(M, { system: 'G', grade, type, entries: fill('G', (it) => S(extra.includes(it.id) ? 0 : 3)) });
    // 店舗運営 21 項目のうち 6 つ・数値 15 のうち 3 つ・育成 12 のうち 1 つが 0 点
    // 50 + 20×15/21 + 15×12/15 + 15×11/12 ＝ 2521/28
    assert.equal(r.total.exact, '2521/28', grade);
    assert.equal(r.targetWeight, 100);
  }
  // G1 でも追加の項目を自動で非該当にしない（未評価なら確定しない）
  const g1 = C.csq4Score(M, { system: 'G', grade: 'G1', type: 'Server中心', entries: fill('G', (it) => (extra.includes(it.id) ? null : S(2))) });
  assert.equal(g1.counts.unassessed, 10);
  assert.equal(g1.state, 'in_progress');
});

// ---------- 17) 未担当 → 会社都合 ----------
test('17) 未担当から会社都合の今回非該当に変えると計算し直し、本人向けの一覧から消えない（計算の部分）', () => {
  const e = fill('G', () => S(3));
  e['04-01'] = UA('仕込みを任せていない（合成）');
  const a = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: e });
  e['04-01'] = NC();
  const b = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: e });
  assert.ok(C.fcmp(fr(a.total.exact), fr(b.total.exact)) < 0, '0 点が分母から外れて上がる');
  assert.equal(b.total.exact, '100/1');
  assert.deepEqual(a.unassignedList.map((x) => [x.id, x.status]), [['04-01', STATUS.UNASSIGNED]]);
  assert.deepEqual(b.unassignedList.map((x) => [x.id, x.status, x.naReasonType]), [['04-01', STATUS.NOT_APPLICABLE, NA_REASON.COMPANY]]);
});

// ---------- 最低条件 ----------
test('最低条件：総合点と別に出す・未担当 0 点も含む・指定項目は G2/S2 から・実務機会なしは達成にしない', () => {
  const kind = (r) => Object.fromEntries(r.minimum.conditions.map((c) => [c.key, c.state]));
  const all3 = fill('G', () => S(3));
  const a = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: all3 });
  assert.equal(a.minimum.overall, 'met');
  assert.deepEqual(kind(a), { philoClass: 'met', basic: 'met', gMain: 'met', gOther: 'met', items: 'met' });
  // G1 は指定項目の条件がない
  assert.ok(!('items' in kind(C.csq4Score(M, { system: 'G', grade: 'G1', type: 'Kitchen中心', entries: all3 }))));
  // 指定項目 1 点・未担当（0 点）は未達
  for (const v of [S(1), UA()]) {
    const r = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: { ...all3, '01-13': v } });
    assert.equal(kind(r).items, 'not_met');
    assert.equal(r.minimum.overall, 'not_met');
    assert.equal(r.minimum.conditions.find((c) => c.key === 'items').parts.find((p) => p.id === '01-13').score, v.status === STATUS.UNASSIGNED ? 0 : 1);
  }
  // 総合点は基準を超えても、最低条件は別に未達になりうる
  const n = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: { ...all3, '01-13': S(1) } });
  assert.equal(n.baseMet, true);
  assert.equal(n.minimum.overall, 'not_met');
  // 他部門（Kitchen中心 → 接客）が全部非該当：実務機会なし・未確認（達成にも未達にもしない）
  const o = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: fill('G', (it) => (it.cat === 'SERVICE' ? NR() : S(3))) });
  assert.equal(kind(o).gOther, 'no_opportunity');
  assert.equal(o.minimum.overall, 'no_opportunity');
  assert.deepEqual(o.minimum.noOpportunity, ['gOther']);
  // 他部門が全部未担当なら 0 点で未達
  const u = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: fill('G', (it) => (it.cat === 'SERVICE' ? UA() : S(3))) });
  assert.equal(kind(u).gOther, 'not_met');
  // 未評価が残れば決まらない
  const i = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: { ...all3, '02-01': UN() } });
  assert.equal(kind(i).basic, 'incomplete');
  assert.equal(i.minimum.overall, 'incomplete');
  // 両部門育成・店長などの主担当／他部門は資料で決まっていない：判定を保留
  for (const [grade, type] of [['G3', '両部門育成'], ['G4', '店長'], ['G5', '管轄責任']]) {
    const p = C.csq4Score(M, { system: 'G', grade, type, entries: all3 });
    assert.equal(kind(p).gMain, 'pending_rule');
    assert.equal(kind(p).gOther, 'pending_rule');
    assert.equal(p.minimum.overall, 'pending_rule');
  }
  // 理念の分類の平均：G2 は 2.0 以上
  const ph = C.csq4Score(M, { system: 'G', grade: 'G2', type: 'Kitchen中心', entries: fill('G', (it) => (it.cls === 'THANK' ? S(1) : S(3))) });
  assert.equal(kind(ph).philoClass, 'not_met');
  // S Chef：衛生・品質
  const sc = C.csq4Score(M, { system: 'S_CHEF', grade: 'S2', entries: fill('S_CHEF', (it) => (it.cat === 'HYGIENE' ? S(1) : S(3))) });
  assert.equal(kind(sc).chefHygiene, 'not_met');
  assert.equal(kind(sc).sQuality, 'met');
  const so = C.csq4Score(M, { system: 'S_OFFICE', grade: 'S1', entries: fill('S_OFFICE', () => S(3)) });
  assert.deepEqual(Object.keys(kind(so)).sort(), ['philoClass', 'sQuality'].sort(), 'S1 は指定項目なし・Office に衛生なし');
});

// ---------- 19) Prep ----------
const P = M.systems.PREP;
const allQ = { Q1: 'clear', Q2: 'clear', Q3: 'clear' };
const meas = (speeds, range = '0.60') => ({ trials: speeds.map((s, i) => ({ date: '2026-10-0' + (i + 1), goodStd: s, actual: '1' })), independentStd: range, allStd: '1' });
const prep = (o) => C.csq4Prep(M, { entries: fill('PREP', () => S(3)), quality: allQ, measure: meas(['0.81', '0.90', '1.20']), currentStep: null, ...o });

test('19) Prep：時給表 P1〜P6 と境界（P2 は速度 0.80 超・範囲 60% 以上、P3 以降の速度は以上）', () => {
  assert.deepEqual(P.pay.map((p) => [p.step, p.wageUsd]), [['P1', 17], ['P2', 18], ['P3', 19], ['P4', 20], ['P5', 21], ['P6', 22]]);
  assert.equal(prep({ measure: meas(['0.80', '1.0', '1.0']) }).pay.step, 'P1', '0.80 ちょうどは P2 にならない');
  assert.equal(prep({ measure: meas(['0.81', '1.0', '1.0']) }).pay.step, 'P2');
  assert.equal(prep({ measure: meas(['0.81', '1.0', '1.0'], '0.59') }).pay.step, 'P1');
  assert.equal(prep({ measure: meas(['1.00', '1.0', '1.0'], '0.70') }).pay.step, 'P3', '1.00 以上・70% 以上');
  assert.equal(prep({ measure: meas(['1.20', '2', '2'], '0.80') }).pay.step, 'P4');
  assert.equal(prep({ measure: meas(['1.30', '2', '2'], '0.90') }).pay.step, 'P5');
  assert.equal(prep({ measure: meas(['1.50', '2', '2'], '0.90') }).pay.step, 'P6');
  assert.equal(prep({ measure: meas(['1.50', '2', '2'], '0.89') }).pay.step, 'P4');
  const p2 = prep({ measure: meas(['0.81', '1.0', '1.0']) });
  assert.equal(p2.pay.wageUsd, 18);
  assert.equal(p2.measure.speed.exact, '81/100');
  assert.equal(p2.measure.range.exact, '3/5');
});

test('19) Prep：品質の未確認・未達はクリアにしない（Score が高くても相殺しない）', () => {
  const u = prep({ quality: { Q1: 'clear', Q2: 'clear' } });
  assert.equal(u.score.exact, '100/1');
  assert.equal(u.qualityState, 'unconfirmed');
  assert.equal(u.quality.find((x) => x.id === 'Q3').state, 'unconfirmed');
  assert.deepEqual([u.pay.state, u.pay.step], ['quality_unconfirmed', null]);
  const n = prep({ quality: { ...allQ, Q2: 'not_clear' } });
  assert.deepEqual([n.qualityState, n.pay.state, n.pay.step], ['not_clear', 'quality_not_clear', null]);
  const junk = prep({ quality: { Q1: 'clear', Q2: 'clear', Q3: 'yes' } });
  assert.equal(junk.qualityState, 'unconfirmed', 'clear 以外の値はクリアにしない');
});

test('19) Prep：速度は別日 3 回の最低値・未測定や分母 0 を合格にしない', () => {
  assert.equal(prep({ measure: meas(['1.20', '0.81', '0.90']) }).measure.speed.exact, '81/100');
  const bad = (m) => prep({ measure: m }).pay;
  assert.deepEqual(bad(undefined), { state: 'unmeasured', step: null, reason: 'no_measure' });
  const two = meas(['1', '1', '1']); two.trials[2].date = two.trials[1].date;
  assert.equal(bad(two).reason, 'need_3_days', '同じ日の 2 回は 1 日');
  assert.equal(bad({ ...meas(['1', '1']) }).reason, 'need_3_days');
  const z = meas(['1', '1', '1']); z.trials[0].actual = '0';
  assert.equal(bad(z).reason, 'zero_actual');
  assert.equal(bad({ ...meas(['1', '1', '1']), allStd: '0' }).reason, 'zero_all_std');
  assert.equal(bad({ ...meas(['1', '1', '1']), independentStd: '1.2' }).reason, 'bad_range');
  assert.equal(bad({ ...meas(['1', '1', '1']), independentStd: undefined }).reason, 'no_range');
  const d = meas(['1', '1', '1']); d.trials[0].date = '2026/10/01';
  assert.equal(bad(d).reason, 'bad_trial_date');
  const v = meas(['1', '1', '1']); v.trials[0].goodStd = '1e2';
  assert.equal(bad(v).reason, 'bad_trial_value');
});

test('19)・20) Prep：行動確認の Score は時給に掛けない・表の判定で今の時給を自動で下げない', () => {
  const low = prep({ entries: fill('PREP', () => S(0)) });
  const high = prep({ entries: fill('PREP', () => S(3)) });
  assert.equal(low.score.exact, '0/1');
  assert.deepEqual(low.pay, high.pay, 'Score の高低で時給の判定が変わらない');
  // 今 P3 の人の表の判定が P2 でも「今のまま」（下げない・承認なしで書かない）
  const k = prep({ currentStep: 'P3', measure: meas(['0.81', '1', '1']) });
  assert.equal(k.pay.step, 'P2');
  assert.equal(k.pay.compare, 'keep_current');
  assert.equal(prep({ currentStep: 'P1', measure: meas(['0.81', '1', '1']) }).pay.compare, 'raise');
  assert.equal(prep({ currentStep: 'P2', measure: meas(['0.81', '1', '1']) }).pay.compare, 'same');
  // 行動確認：非該当は除く・未評価が残れば未確定・全部非該当なら算出不可
  const ids = items('PREP').map((i) => i.id);
  const e = fill('PREP', () => S(3)); e[ids[0]] = NR(); e[ids[1]] = S(0);
  const r = prep({ entries: e });
  assert.equal(r.score.exact, '90/1', '27 /（3 × 10）× 100（非該当の 1 項目は分母に入れない）');
  assert.equal(r.counts.na, 1);
  assert.equal(r.state, 'complete');
  e[ids[2]] = UN();
  assert.equal(prep({ entries: e }).state, 'in_progress');
  const na = prep({ entries: fill('PREP', () => NR()) });
  assert.equal(na.state, 'not_calculable');
  assert.equal(na.score, null);
  const err = prep({ entries: { ...fill('PREP', () => S(3)), [ids[0]]: UA() } });
  assert.deepEqual(err.entryErrors, { [ids[0]]: ['unassigned_only_g'] });
  assert.equal(err.confirmable, false);
});

// ---------- 20) 計算は入力を変えない ----------
test('20) 計算は入力（点数・状態・日時）を書き換えない', () => {
  const e = fill('G', (it) => (it.cat === 'KITCHEN' ? NC() : S(2)));
  e['01-01'] = { ...S(3), feedbackComment: 'よくできている（合成）', reviewedAt: '2026-11-02T10:00:00-10:00' };
  const before = JSON.stringify(e);
  C.csq4Score(M, { system: 'G', grade: 'G3', type: 'Kitchen中心', entries: e });
  assert.equal(JSON.stringify(e), before);
  const pe = fill('PREP', () => S(2)), q = { ...allQ }, mm = meas(['1', '1', '1']);
  const pb = JSON.stringify([pe, q, mm]);
  C.csq4Prep(M, { entries: pe, quality: q, measure: mm, currentStep: 'P2' });
  assert.equal(JSON.stringify([pe, q, mm]), pb);
  const mb = JSON.stringify(M);
  C.csq4Score(M, { system: 'S_OFFICE', grade: 'S5', entries: fill('S_OFFICE', () => S(1)) });
  assert.equal(JSON.stringify(M), mb, 'マスターも書き換えない');
});

// ---------- 分数の道具 ----------
test('分数：10 進の文字列だけ・ゼロ割りは断る', () => {
  assert.equal(C.fstr(C.fdec('0.80')), '4/5');
  assert.equal(C.fstr(C.fdec(0.81)), '81/100');
  assert.equal(C.fstr(C.fdec('12')), '12/1');
  for (const b of ['1e2', 'abc', '', '.5', '1.', NaN, Infinity]) assert.throws(() => C.fdec(b), /not a plain decimal/, String(b));
  assert.throws(() => C.frac(1, 0), /zero denominator/);
  assert.throws(() => C.fdiv(C.frac(1), C.frac(0)), /divide by zero/);
  assert.equal(C.fcmp(C.frac(2124, 25), C.frac(85)), -1);
  assert.equal(C.fcmp(C.frac(170, 2), C.frac(85)), 0);
});
