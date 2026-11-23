// Career Score 2026 Q4（段階 3-2・v1208）：画面（FUNERGY_CS4）と 2026 Q4 の賞与の ①。合成データだけ（本番につながない）。
//   node --test tests/career-score-q4-ui.test.mjs
// 見ること：
//   1. index.html の印（版 1208・FUNERGY_CS4 の場所・前の Career Score を止める道・賞与の ① の道）
//   2. FUNERGY_CS4 を vm で動かす（関数の答えは偽物）：前の版の関数・SQL がまだ・ログインの印なし・Q4 より前は今までどおり／
//      Q4 で新しい関数なら前の採点・申請・承認・OJT・オフィス用の新しい編集を止める／賞与の ① は確定・公開した評価だけ
//   3. 賞与の ① の段（kevCs4Step）を総合点の分数で丸めずに決める（BigInt）＝分数で数えた答えと 4,000 通り同じ
//   4. kevCareer4（係数・幅で止める・足りないものの文）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function between(a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, a);
  return src.slice(i + a.length, j);
}
const CSQ4 = between('/* ==== FUNERGY_CSQ4 gen begin ==== */', '/* ==== FUNERGY_CSQ4 gen end ==== */');
const CS4 = between('/* ==== FUNERGY_CS4 begin ==== */', '/* ==== FUNERGY_CS4 end ==== */');
function fnSrc(name) {
  const i = src.indexOf('\nfunction ' + name + '(');
  assert.ok(i >= 0, name);
  const j = src.indexOf('\n}', i + 1);
  return src.slice(i + 1, j + 2);
}
function lineOf(start) {
  const i = src.indexOf('\n' + start);
  assert.ok(i >= 0, start);
  return src.slice(i + 1, src.indexOf('\n', i + 1));
}
/* vm の中で作った値は別の realm（deepEqual の比べ方が違う）＝JSON にして比べる */
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

/* ---------------------------------------------------------------- 1. 印 */
test('version 1208 in the page and the service worker; FUNERGY_CS4 is its own script with no </script', () => {
  assert.match(src, /\nconst APP_VERSION = '1208';/);
  assert.match(sw, /\nconst SW_BUILD = '1208';/);
  assert.ok(!/<\/script/i.test(CS4));
  assert.ok(CS4.includes('W.FUNERGY_CS4 = {'));
  // CSQ4（計算の芯）の script が先、CS4 が後
  assert.ok(src.indexOf('/* ==== FUNERGY_CSQ4 gen begin ==== */') < src.indexOf('/* ==== FUNERGY_CS4 begin ==== */'));
});

test('the old Career Score is stopped from Q4 through FUNERGY_CS4.oldBlocked (score, request, approve, OJT)', () => {
  for (const [fn, kind] of [['saveLssScores', 'score'], ['submitLssScoreRequest', 'score'], ['approveLssScoreRequest', 'approve'], ['g2RaiseAxisFloor', 'ojt']]) {
    const body = fnSrc(fn).slice(0, 1600);
    assert.ok(body.includes("oldBlocked('" + kind + "')"), fn + ' → ' + kind);
  }
  assert.ok(fnSrc('ssOnLogout').includes('FUNERGY_CS4.onLogout'));
});

test('Q4 bonus ①: kevCareer3 hands Q4 to kevCareer4; freeze, adoption and the old base checks are off in Q4', () => {
  const k3 = fnSrc('kevCareer3');
  assert.ok(k3.split('\n')[1].includes('window.FUNERGY_CS4.bonusQ(kv && kv.q)) return kevCareer4('), 'early return');
  assert.ok(fnSrc('kevAdoptPending').includes("T.src==='cs4'"));
  assert.ok(fnSrc('bqCsFreezeOne').split('\n')[1].includes('FUNERGY_CS4.bonusQ(q)'));
  assert.ok(fnSrc('bqCsFreezeAll').split('\n')[1].includes('FUNERGY_CS4.bonusQ(q)'));
  const mf = fnSrc('kevMisfits3');
  assert.ok(mf.includes('var _cs4q='));
  assert.equal((mf.match(/if\(!_cs4q\) try\{/g) || []).length, 4);
  assert.ok(mf.includes('if(ov.set.c && !_cs4q){'));
  assert.ok(src.includes("kevCareerCardHtml4(e, it.c, I, kv) : kevCareerCardHtml3(e, it.c, I, kv)"));
  const snap = fnSrc('kevSnapSeg3');
  assert.ok(snap.includes('cs4:(T.cs4 ?') && snap.includes('exact:T.exact||null'));
  // 個人設定の ① の基準得点は Q4 では使わない（文を出す）
  assert.ok(src.includes("&& !(I.items.c.total && I.items.c.total.src==='cs4')){"));
});

/* ---------------------------------------------------------------- 2. FUNERGY_CS4 を vm で */
function app(opts = {}) {
  const calls = [];
  const toasts = [];
  const c = {
    curUserName: opts.user || 'Gina Manager', curRole: opts.role || 'gm', curRealRole: opts.role || 'gm', curStoreLogin: null, curPage: opts.page || 'dashboard',
    _ssGen: 1, _today: opts.today || '2026-11-23',
    console, Intl, Date, JSON, Math, Promise, Object, Array, String, Number, BigInt, RegExp, Error, isFinite,
  };
  c.window = c;
  c.bizToday = () => c._today;
  c.t = (ja) => ja;
  c.showToast = (m, k) => toasts.push([m, k]);
  c.confirm = () => c._confirm !== false;
  c.askInput = async () => null;
  c.setTimeout = () => 0; c.clearTimeout = () => {};
  c.matchMedia = () => ({ matches: false });
  c.addEventListener = () => {};
  c.document = { getElementById: () => null, addEventListener: () => {}, activeElement: null, visibilityState: 'visible' };
  c.renderPage = () => {};
  c.ssCall = async (p) => { calls.push(p); return c._reply ? c._reply(p) : { legacy: true }; };
  // 包まれる関数（前からある）
  c.go = (p) => { c._went = p; };
  c.setLssView = (v) => { c._view = v; };
  c.doLogout = () => { c._out = true; };
  c.ocsStartEdit = () => { c._ocs = 'start'; };
  c.ocsSaveEdit = () => { c._ocs = 'save'; return Promise.resolve('saved'); };
  c.ocsConfirm = (id, per) => { c._ocs = 'confirm:' + per; return Promise.resolve('ok'); };
  c.ocsPeriodNow = () => '2026-Q4';
  vm.createContext(c);
  vm.runInContext(CSQ4, c, { filename: 'csq4.js' });
  vm.runInContext(CS4, c, { filename: 'cs4.js' });
  c._calls = calls; c._toasts = toasts;
  return c;
}
const PUB = { id: 41, rev: 2, system: 'G', grade: 'G3', type: 'Kitchen', version: 'CAREER_2026_Q4_V1', confirmed_at: '2026-11-20T21:00:00Z', confirmed_by_name: 'Gina Manager',
  shared: { result: { state: 'complete', totalProvisional: false, total: { exact: '1561/20', value: 78.05, display: '78.05' }, base: 75 } } };
function meJ(published) { return { period: { quarter: '2026-Q4' }, version: 'CAREER_2026_Q4_V1', state: published ? 'published' : 'none', assign: null, published: published || null, open: null, past: [], reqs: [], hist: [] }; }
function rosterJ(rows) { return { rows }; }
function rosterRow(emp, name, pub) {
  return { emp, name, store: 'S1', title: '', role: 'crew', grade: 'G3', out: false, suggest: null, assign: null, open: null, reqs: [], can: {},
    published: pub ? Object.assign({ id: 50, rev: 1, status: 'published', ver: 'CAREER_2026_Q4_V1', system: 'G', grade: 'G3', type: 'Kitchen', at: '2026-11-21T00:00:00Z', confirmed_at: '2026-11-21T00:00:00Z',
      state: 'complete', confirmable: true, provisional: false, baseMet: true }, pub) : null };
}

test('before Q4 nothing changes: off, old scoring open, Q3 bonus uses the old Career Score', async () => {
  const c = app({ today: '2026-09-30' });
  c._reply = () => ({ ok: true, j: meJ(PUB) });
  const F = c.FUNERGY_CS4;
  assert.equal(F.on(), false);
  assert.equal(F.oldBlocked('score'), '');
  assert.equal(F.bonusQ('2026-Q3'), false);
  await settle();
  assert.equal(c._calls.length, 0, 'no call before Q4');
});

test('Q4 with a previous-version function (legacy) or no SQL: old screens stay, Q4 bonus ① stays on the old way', async () => {
  for (const reply of [{ legacy: true }, { status: 503, error: '' }, { ok: true, j: { nosql: true } }]) {
    const c = app();
    c._reply = () => reply;
    const F = c.FUNERGY_CS4;
    F.on();
    await settle();
    assert.equal(F._t.srv(), 'old', JSON.stringify(reply));
    assert.equal(F.on(), false);
    assert.equal(F.oldBlocked('score'), '');
    assert.equal(F.bonusQ('2026-Q4'), false);
    same(F.bonusRow({ id: 'E1', name: 'Sue' }, '2026-Q4'), { code: 'off' });
    assert.equal(F._t.ocsBlocked('2026-Q4'), '');
  }
});

test('Q4 with the new function: old scoring, requests, approvals, OJT and new office edits are stopped', async () => {
  const c = app();
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(null) } : { ok: true, j: rosterJ([]) });
  const F = c.FUNERGY_CS4;
  // まだ分からないあいだは「確かめています」（止める）
  assert.match(F.oldBlocked('score'), /確かめています/);
  await settle();
  assert.equal(F._t.srv(), 'new');
  assert.equal(F.on(), true);
  assert.match(F.oldBlocked('score'), /止めました/);
  assert.match(F.oldBlocked('approve'), /却下/);
  assert.match(F.oldBlocked('ojt'), /OJT/);
  assert.equal(F._t.ocsBlocked('2026-Q3'), '');
  assert.match(F._t.ocsBlocked('2026-Q4'), /2026 Q3 まで/);
  // オフィス用の編集の 3 つの入口は止まる（前の記録は読むだけ）
  c._ocs = null;
  assert.equal(c.ocsStartEdit(), undefined);
  assert.equal(c._ocs, null);
  assert.equal(await c.ocsConfirm('E9', '2026-Q4'), undefined);
  assert.equal(c._ocs, null);
  await c.ocsConfirm('E9', '2026-Q3');
  assert.equal(c._ocs, 'confirm:2026-Q3');
  assert.ok(c._toasts.some(([m]) => /2026 Q3 まで/.test(m)));
});

test('no login mark (nosess): old screens stay, but the Q4 bonus ① does not fall back to the old Career Score', async () => {
  const c = app();
  c._reply = () => ({ none: true });
  const F = c.FUNERGY_CS4;
  F.on();
  await settle();
  assert.equal(F._t.srv(), 'old');
  assert.equal(F.oldBlocked('score'), '');
  assert.equal(F.bonusQ('2026-Q4'), true);
  same(F.bonusRow({ id: 'E1', name: 'Sue' }, '2026-Q4'), { code: 'nosess' });
});

test('bonus ①: only confirmed and published evaluations, from the roster (exact total and base); Prep and provisional are not used', async () => {
  const c = app();
  const rows = [
    rosterRow('E1', 'Sue One', { exact: '1561/20', total: '78.05', base: 75 }),
    rosterRow('E2', 'Pat Prep', { system: 'PREP', exact: null, total: null, base: null }),
    rosterRow('E3', 'Ned None', null),
    rosterRow('E4', 'Val Prov', { exact: '150/2', total: '75.00', base: 75, state: 'in_progress', provisional: true }),
  ];
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(null) } : (p.action === 'cs4_roster' ? { ok: true, j: rosterJ(rows) } : { status: 400 }));
  const F = c.FUNERGY_CS4;
  F.on();
  await settle();
  assert.equal(F.bonusQ('2026-Q4'), true);
  assert.equal(F.bonusQ('2026-Q3'), false);
  // まだ名簿を読んでいない：読み込み中（数えない）
  same(F.bonusRow({ id: 'E1', name: 'Sue One' }, '2026-Q4'), { code: 'loading' });
  await settle();
  const r1 = F.bonusRow({ id: 'E1', name: 'Sue One' }, '2026-Q4');
  assert.equal(r1.ok, true);
  assert.equal(r1.exact, '1561/20');
  assert.equal(r1.base, 75);
  assert.equal(r1.score, 78.05);
  assert.equal(r1.rev, 1);
  same(F.bonusRow({ id: 'E2', name: 'Pat Prep' }, '2026-Q4'), { code: 'prep' });
  same(F.bonusRow({ id: 'E3', name: 'Ned None' }, '2026-Q4'), { code: 'none' });
  same(F.bonusRow({ id: 'E4', name: 'Val Prov' }, '2026-Q4'), { code: 'none' });
  same(F.bonusRow({ id: 'E9', name: 'Who' }, '2026-Q4'), { code: 'hidden' });
  same(F.bonusRow({ id: 'E1', name: 'Sue One' }, '2027-Q1'), { code: 'q' });
  same(F.bonusRow({ id: 'E1', name: 'Sue One' }, '2026-Q3'), { code: 'off' });
  // 名簿に呼んだのは cs4_me と cs4_roster だけ（ほかは書かない）
  assert.deepEqual([...new Set(c._calls.map((x) => x.action))].sort(), ['cs4_me', 'cs4_roster']);
});

test('bonus ①: a staff member sees only themself (their own published evaluation through cs4_me)', async () => {
  const c = app({ user: 'Sue One', role: 'crew' });
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(PUB) } : (p.action === 'cs4_roster' ? { status: 403, error: 'forbidden' } : { status: 400 }));
  const F = c.FUNERGY_CS4;
  F.on();
  await settle(10);
  const me = F.bonusRow({ id: 'E1', name: 'Sue One' }, '2026-Q4');
  await settle();
  assert.equal(me.ok, true);
  assert.equal(me.exact, '1561/20');
  assert.equal(me.rev, 2);
  same(F.bonusRow({ id: 'E7', name: 'Other' }, '2026-Q4'), { code: 'err' });
});

test('fromPub keeps only complete, exact totals', () => {
  const F = app().FUNERGY_CS4;
  same(F._t.fromPub(null), { code: 'none' });
  same(F._t.fromPub({ system: 'PREP' }), { code: 'prep' });
  same(F._t.fromPub({ system: 'G', exact: '78.05', base: 75 }), { code: 'none' });
  same(F._t.fromPub({ system: 'G', exact: '1561/20', base: null }), { code: 'none' });
  same(F._t.fromPub({ system: 'G', exact: '1561/20', base: 75, state: 'in_progress' }), { code: 'none' });
  assert.equal(F._t.fromPub({ system: 'S_CHEF', exact: '1561/20', total: '78.05', base: 85, state: 'complete', provisional: false, rev: 3, id: 9 }).ok, true);
});

test('changing the login drops everything the previous person read', async () => {
  const c = app();
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(PUB) } : { ok: true, j: rosterJ([rosterRow('E1', 'Sue One', { exact: '1561/20', total: '78.05', base: 75 })]) });
  const F = c.FUNERGY_CS4;
  F.on();
  await settle();
  F.bonusRow({ id: 'E1' }, '2026-Q4');
  await settle();
  assert.equal(F.bonusRow({ id: 'E1' }, '2026-Q4').ok, true);
  c.curUserName = 'Sue One'; c.curRole = 'crew'; c.curRealRole = 'crew';
  c._reply = () => ({ legacy: true });
  assert.notEqual(F.bonusRow({ id: 'E1' }, '2026-Q4').ok, true);
  assert.equal(F._t.E().ros, null);
  assert.equal(F._t.E().me, null);
  F.onLogout();
  assert.equal(F._t.E().me, null);
});

test('leave guards pass through when nothing is unsaved; forced logout is never stopped', async () => {
  const c = app({ page: 'leadership' });
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(null) } : { ok: true, j: rosterJ([]) });
  const F = c.FUNERGY_CS4;
  F.on(); await settle();
  assert.equal(F._t.guardLeave(), true);
  c.go('dashboard');
  assert.equal(c._went, 'dashboard');
  c.setLssView('list');
  assert.equal(c._view, 'list');
  c._confirm = false; c._forceLogout = true;
  c.doLogout();
  assert.equal(c._out, true);
});

test('unsaved changes that need a reason stop leaving the page and logging out (forced logout still goes); saving sends only the change', async () => {
  const c = app({ page: 'leadership' });
  const G = c.FUNERGY_CSQ4_MASTER.systems.G.items[0].id;
  const EV = { id: 77, rev: 2, ver: 5, status: 'draft', system: 'G', grade: 'G3', type: 'Kitchen', version: 'CAREER_2026_Q4_V1', entries: { [G]: { status: 'SCORED', score: 2 } }, feedback: {} };
  c._reply = (p) => {
    if (p.action === 'cs4_me') return { ok: true, j: meJ(null) };
    if (p.action === 'cs4_roster') return { ok: true, j: rosterJ([rosterRow('E1', 'Sue One', null)]) };
    if (p.action === 'cs4_get') return { ok: true, j: { person: { emp: 'E1', name: 'Sue One' }, assign: { system: 'G', grade: 'G3', type: 'Kitchen', ver: 1 }, evals: [EV], reqs: [], log: [], can: { score: true } } };
    return { status: 400, error: 'bad_value' };
  };
  const F = c.FUNERGY_CS4;
  F.on(); await settle();
  const E0 = F._t.E();
  E0.ix.push('E1'); E0.ixm.E1 = 0;
  F.h.open(0); await settle();
  assert.equal(F._t.E().cu.edit, true);
  assert.equal(F.unsaved(), false);
  F.h.st(0, 'S3');
  assert.equal(F.unsaved(), true);
  // 確定・共有したあとの版（rev 2）で前の点を変えた＝変えた理由が要る：理由が無ければ自動では送らない
  assert.equal(F._t.buildSave(false), null);
  c._confirm = false; c._went = null; c._out = false;
  c.go('dashboard');
  assert.equal(c._went, null, 'go blocked');
  c.setLssView('list');
  assert.equal(c._view, undefined, 'view blocked');
  c.doLogout();
  assert.equal(c._out, false, 'logout blocked');
  c._forceLogout = true;
  c.doLogout();
  assert.equal(c._out, true, 'forced logout goes');
  // 理由を書いて「保存する」：送るのは変えた 1 項目と理由と版だけ
  F._t.E().cu.reason = '観察した日を足した';
  const b = JSON.parse(JSON.stringify(F._t.buildSave(true)));
  assert.equal(b.body.action, 'cs4_save');
  assert.equal(b.body.id, 77);
  assert.equal(b.body.expect, 5);
  assert.deepEqual(Object.keys(b.body.entries), [G]);
  assert.equal(b.body.entries[G].score, 3);
  assert.equal(b.used, true);
  c._confirm = true;
  c.go('dashboard');
  assert.equal(c._went, 'dashboard', 'go after confirm');
});

test('the page renders the three tabs for a GM in Q4 (smoke)', async () => {
  const c = app({ page: 'leadership' });
  c._reply = (p) => (p.action === 'cs4_me' ? { ok: true, j: meJ(PUB) } : { ok: true, j: rosterJ([rosterRow('E1', 'Sue One', { exact: '1561/20', total: '78.05', base: 75 })]) });
  const F = c.FUNERGY_CS4;
  F.on(); await settle();
  const h = F.pageHtml();
  for (const s of ['今期の評価', '評価履歴', 'フィードバック・見直し']) assert.ok(h.includes(s), s);
  const my = F.myCardHtml();
  assert.equal(typeof my, 'string');
});

/* ---------------------------------------------------------------- 3. 段（BigInt）と分数で数えた答え */
function step4App() {
  const c = { BigInt, Number, String };
  vm.createContext(c);
  vm.runInContext([lineOf('var KEV4_STEP='), fnSrc('kevCs4Step'), fnSrc('kevCs4Need'), fnSrc('kevCsStep')].join('\n'), c);
  return c;
}
function gcd(a, b) { a = a < 0n ? -a : a; while (b) { [a, b] = [b, a % b]; } return a; }
function refStep(n, d, base) {
  // 分数で：diff = n/d − base。上は floor(diff/3)、下は −ceil(−diff/3)、どちらも 3 まで
  const diff = n - BigInt(base) * d;
  if (diff >= 0n) { const k = diff / (3n * d); return Number(k > 3n ? 3n : k); }
  const k = (-diff + 3n * d - 1n) / (3n * d); return -Number(k > 3n ? 3n : k);
}
test('the Q4 step is decided on the exact fraction (no rounding), 4,000 random totals and the boundaries', () => {
  const c = step4App();
  let seed = 20261123;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 4000; i++) {
    const d = BigInt(1 + Math.floor(rnd() * 600));
    const n = BigInt(Math.floor(rnd() * Number(d) * 100));
    const g = gcd(n, d) || 1n;
    const base = [55, 65, 70, 75, 85, 90, 95][Math.floor(rnd() * 7)];
    const ex = (n / g) + '/' + (d / g);
    assert.equal(c.kevCs4Step(ex, base), refStep(n / g, d / g, base), ex + ' base ' + base);
  }
  // 境目：ちょうどは上の段・ほんの少し下は下の段
  assert.equal(c.kevCs4Step('75/1', 75), 0);
  assert.equal(c.kevCs4Step('78/1', 75), 1);
  assert.equal(c.kevCs4Step('77999999/1000000', 75), 0);
  assert.equal(c.kevCs4Step('72/1', 75), -1);
  assert.equal(c.kevCs4Step('7199/100', 75), -2);
  assert.equal(c.kevCs4Step('100/1', 75), 3);
  assert.equal(c.kevCs4Step('0/1', 75), -3);
  // 3 で割り切れない分数（1/3 点など）でも丸めない：基準 75 ＋ 3 − 1/3000000
  assert.equal(c.kevCs4Step('233999999/3000000', 75), 0);
  assert.equal(c.kevCs4Step('234000000/3000000', 75), 1);
  // 読めない分数
  for (const bad of ['', '78.05', '1/0', '-1/2', 'a/b', null]) assert.equal(c.kevCs4Step(bad, 75), null, String(bad));
  assert.equal(c.kevCs4Step('78/1', null), null);
  // 小数で表せる点は前の kevCsStep（1 段 3 点）と同じ
  for (let s = 0; s <= 100; s += 0.25) {
    const ex = Math.round(s * 4) + '/4';
    assert.equal(c.kevCs4Step(ex, 75), c.kevCsStep(s, 75, 3), ex);
  }
  // 次の段まで（切り上げ・小数 1 桁）
  assert.equal(c.kevCs4Need('76/1', 75, 0), 2);
  assert.equal(c.kevCs4Need('3001/40', 75, 0), 3);
  assert.equal(c.kevCs4Need('100/1', 75, 3), null);
  assert.equal(c.kevCs4Need('70/1', 75, -2), 2);
});

/* ---------------------------------------------------------------- 4. kevCareer4 */
function k4App(X) {
  const c = { BigInt, Number, String, Math, isFinite, window: null, X };
  c.window = c;
  c.FUNERGY_CS4 = { bonusRow: () => c.X };
  c.ghMD = (d) => d;
  vm.createContext(c);
  vm.runInContext([lineOf('var KEV3_LV'), lineOf('function kevN('), lineOf('function kevF3('), lineOf('function kevLvOk('), fnSrc('kevRange3Bad'), lineOf('function kevCsSheetName('),
    fnSrc('kevCsMissTxt'), lineOf('var KEV4_STEP='), fnSrc('kevCs4Step'), fnSrc('kevCs4Need'), fnSrc('kevCareer4')].join('\n'), c);
  return c;
}
const RULE = { c: { on: true, lo: 0.85, hi: 1.15 } };
test('kevCareer4: coefficient from the published total and base; capped by the range; nothing published → no coefficient', () => {
  let c = k4App({ ok: true, exact: '1561/20', score: 78.05, base: 75, date: '2026-11-20', rev: 2, id: 41, system: 'G', grade: 'G3', type: 'Kitchen' });
  let r = c.kevCareer4({ title: 'Cook' }, {}, RULE, {}, { q: '2026-Q4' }, 'G3-kt');
  assert.equal(r.gen, 3);
  assert.equal(r.step, 1);
  assert.equal(r.coef, 1.05);
  assert.equal(r.total.src, 'cs4');
  same(r.miss, []);
  assert.equal(r.base.bp, 75);
  assert.equal(r.base.bs, 3);
  same(r.total.cs4, { id: 41, rev: 2, system: 'G', grade: 'G3', type: 'Kitchen' });
  assert.equal(r.next.coef, 1.1);
  assert.equal(r.next.need, 3);   // 次の段は 81 点：81 − 78.05 = 2.95 → 小数 1 桁で切り上げ 3.0
  // 幅で止める
  c = k4App({ ok: true, exact: '100/1', score: 100, base: 55, rev: 1, id: 1, system: 'G', grade: 'G1', type: 'Hall' });
  r = c.kevCareer4({}, {}, { c: { on: true, lo: 0.95, hi: 1.05 } }, {}, { q: '2026-Q4' }, 'G1');
  assert.equal(r.step, 3); assert.equal(r.raw, 1.15); assert.equal(r.coef, 1.05); assert.equal(r.capped, true);
  // 評価が無い → 係数なし（確定できない）・理由の文
  for (const code of ['none', 'loading', 'hidden', 'prep', 'err', 'nosess', 'q', 'off']) {
    c = k4App({ code });
    r = c.kevCareer4({}, {}, RULE, {}, { q: '2026-Q4' }, 'G3-kt');
    assert.equal(r.coef, null, code);
    assert.equal(r.total.missing, 'cs4_' + code);
    assert.ok(r.miss.length === 1 && r.miss[0].startsWith('① ') && r.miss[0].length > 6, code);
  }
  // 幅が新しい決まりに合わない → 係数なし
  c = k4App({ ok: true, exact: '78/1', score: 78, base: 75, rev: 1, id: 1, system: 'G' });
  r = c.kevCareer4({}, {}, { c: { on: true, lo: 0.7, hi: 1.3 } }, {}, { q: '2026-Q4' }, 'G3-kt');
  assert.equal(r.coef, null);
  assert.ok(r.miss.some((m) => /新しい決まり/.test(m)));
});
