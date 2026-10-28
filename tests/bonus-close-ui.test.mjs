// v1109 (UI案61 ② · Moto's answers 10/28: 5A server versions written only by email-authenticated GM / CEO, 6A 「支給済みとして記録」 with a
// payment date, 7A a final may carry provisional values (recorded), 8A the person's own view shows only the effective final, otherwise 「査定中」):
// the app side of the bonus close — the values chosen for unconfirmed parts, the provisional close, the final, the correction from the final,
// the paid record and the adjustment records — run against the real bonus-close handler and SQL (PGlite).
// Runs the real code from index.html (the FUNERGY_KARTE_EVAL and FUNERGY_BONUS_CLOSE blocks) in a VM with the synthetic company of
// tests/karte-eval.test.mjs (fictional staff and numbers). No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/bonus-close/handler.mjs';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
let fixture = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, Q } = await import('data:text/javascript;base64,' + Buffer.from(fixture + '\nexport { company, Q };\n').toString('base64'));
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261028090000_bonus_close.sql', import.meta.url), 'utf8');
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const BC = (() => { const i = SRC.indexOf('/* FUNERGY_BONUS_CLOSE_BEGIN */'), j = SRC.indexOf('/* FUNERGY_BONUS_CLOSE_END */'); assert.ok(i > 0 && j > i); return SRC.slice(i, j); })();
const LSS_GROUPS_SRC = (() => { const i = SRC.indexOf('\nconst LSS_GROUPS = {'), j = SRC.indexOf('\n};', i); return 'var' + SRC.slice(i + 6, j + 3); })();
const fnSrc = name => { const s = SRC.indexOf('\nfunction ' + name + '('); assert.ok(s >= 0, name); return SRC.slice(s + 1, SRC.indexOf('\n}', s + 1) + 2); };
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const runP = async (c, code) => { const v = await vm.runInContext(code, c); return v === undefined ? v : J(v); };
const lastToast = c => (c.TOASTS.at(-1) || [''])[0];

// the server: the real SQL in PGlite and the real handler (synthetic accounts)
const U = { gm: '00000000-0000-4000-8000-0000000000c1', ceo: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
async function server() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values ('E1','GM Sample','在籍'),('E2','CEO Sample','在籍'),('E3','Accounting Sample','在籍');`);
  for (const [k, r, e] of [['gm', 'gm', 'E1'], ['ceo', 'ceo', 'E2'], ['office', 'office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(MIG);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const authFetch = async (url, init) => { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch: authFetch, db });
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(String(url), 'https://db.test/functions/v1/bonus-close');
    const body = JSON.parse(init.body); calls.push(body.action);
    return handler(new Request(String(url), { method: 'POST', headers: init.headers, body: init.body }));
  };
  const direct = async (who, body) => { const r = await handler(new Request('https://db.test/functions/v1/bonus-close', { method: 'POST', headers: { authorization: 'Bearer tok-' + who, 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  return { pg, fetch, calls, direct };
}

// the synthetic company on the v1099 rules (2026 Q3) with the bonus-close block and a GM signed in by email
function co(srv, opts = {}) {
  const c = company(opts);
  vm.runInContext(LSS_GROUPS_SRC, c);
  vm.runInContext(`KEV2_START = '2026-Q3'; var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };`, c);
  for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${Q}|${id}|G4`].fx = { lv: 3, why: '発注量とシフトの見直し（7/15〜）', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
  c.fetch = srv ? srv.fetch : (async () => { throw new Error('no server'); });
  c.Response = Response; c.Promise = Promise;
  c.setTimeout = (f, ms) => (ms <= 10 ? setTimeout(f, ms) : 0);   // long guard timers are not run (no 45-second waits in the test)
  c.SESSION = { access_token: 'tok-gm', refresh_token: 'r' }; c.CLOUD_MISSING = false;
  vm.runInContext(`var curStoreLogin = false, SUPABASE_URL = 'https://db.test', SUPABASE_ANON = 'anon-key', _botSession = null;
    function invInSession(){ return SESSION; } function invInSessionRefresh(){ return Promise.resolve(null); }
    function bizToday(){ return '2026-10-28'; } function ocsFmt(s){ return String(s||'').slice(0, 16); }
    function bonusQKey(cfg){ return String((cfg && cfg.quarter) || '').trim(); }
    function _fetchOpValue(key){ if(typeof CLOUD_MISSING!=='undefined' && CLOUD_MISSING) return Promise.resolve(null); var q=String(key).replace('spl_bonus_q_',''); return Promise.resolve(Object.prototype.hasOwnProperty.call(bqAll(), q) ? JSON.parse(JSON.stringify(bqAll()[q])) : null); }
    ${fnSrc('kevPersonState')}
    ${BC}`, c);
  return c;
}
const totalsBc = (c, ch) => { c.CH = ch || {}; return run(c, 'kevTotals(kbCfg(), bcLiveKv(kbCfg(), CH, false))'); };
const row = (tot, id) => tot.rows.find(r => r.e.id === id);
const state = c => run(c, 'bcStateOf(_bc.data)');
async function load(c) { vm.runInContext(`bcReset('${Q}')`, c); assert.equal(await runP(c, `bcLoad('${Q}')`), true, lastToast(c)); }
// a person with an unscored item (Ken: D3) and one whose evaluation is not marked complete (Neo)
function unconfirmed(c) {
  delete c.SCORES['Ken Sample'].scores.D3;
  c.STORE.bonus_eval[`${Q}|neo|G3`].st = 'draft';
}

test('the engine: without chosen values nothing changes; with them, unconfirmed parts are listed and a value must be chosen for each', () => {
  const c = co(null);
  const base = run(c, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
  assert.equal(base.nBlocked, 0);
  unconfirmed(c);
  // the normal screens (no kv.adopt): Ken is 未評価, Neo waits for 評価完了 (not blocked, as before)
  const plain = run(c, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
  assert.equal(row(plain, 'ken').b.blocked, 'eval');
  assert.equal(row(plain, 'ken').b.parts, null);
  assert.equal(plain.unsel, 0);
  // the close screen with nothing chosen: Ken's ① and Neo's 評価完了 are unselected; amounts are not given
  const t0 = totalsBc(c);
  assert.equal(row(t0, 'ken').b.blocked, 'unsel');
  assert.deepEqual(row(t0, 'ken').b.parts.map(P => [P.k, P.unsel, P.input]), [['c', true, false]]);
  assert.match(row(t0, 'ken').b.parts[0].why.join(), /未評価の項目が 1 あります/);
  assert.equal(row(t0, 'neo').b.blocked, 'unsel');
  assert.deepEqual(row(t0, 'neo').b.parts.map(P => P.k), ['d']);
  assert.deepEqual([t0.unsel, t0.nUnsel, t0.nCfg, t0.prov], [2, 2, 0, 0]);
  // 入力中を仮採用 is not usable for an unscored ① (no 0 points, no guessing); 暫定 1.00 is
  const t1 = totalsBc(c, { ken: { c: { m: 'input' } }, neo: { d: { m: 'input' } } });
  assert.equal(row(t1, 'ken').b.blocked, 'unsel');
  assert.equal(row(t1, 'neo').b.blocked, null, 'the entered evaluation of Neo is used as it is');
  assert.equal(row(t1, 'neo').b.amount, row(base, 'neo').b.amount);
  const t2 = totalsBc(c, { ken: { c: { m: 'tmp' } }, neo: { d: { m: 'input' } } });
  assert.deepEqual([t2.unsel, t2.prov, t2.nBlocked], [0, 2, 0]);
  const ken = row(t2, 'ken').b;
  assert.equal(ken.segs[0].coefs.c, 1);
  assert.equal(ken.amount, 3000, 'G3 base 3000 × ① 1.00 (provisional) — Career Score is used once, never twice');
  assert.deepEqual(ken.adopt, { c: { m: 'tmp', v: 1 } });
  // 係数を指定: one of the 7 steps inside the person's range, with a reason; otherwise unselected
  assert.equal(row(totalsBc(c, { ken: { c: { m: 'set', v: 1.1, why: '面談で確認' } }, neo: { d: { m: 'input' } } }), 'ken').b.amount, 3300);
  for (const bad of [{ m: 'set', v: 1.1 }, { m: 'set', v: 1.12, why: 'x' }, { m: 'set', v: 1.2, why: 'x' }, { m: 'zzz' }]) {
    assert.equal(row(totalsBc(c, { ken: { c: bad }, neo: { d: { m: 'input' } } }), 'ken').b.blocked, 'unsel', JSON.stringify(bad));
  }
  // the person's own range: a step outside it is not usable (Ken's ① range 0.95–1.05)
  c.STORE.bonus_eval_rule = { 'G3-sv|2026-Q3': { set: { c: { on: true, lo: 0.95, hi: 1.05, g2: 1, g3: 1 } }, _at: 1 } };
  assert.equal(row(totalsBc(c, { ken: { c: { m: 'set', v: 1.1, why: 'x' } }, neo: { d: { m: 'input' } } }), 'ken').b.blocked, 'unsel');
  assert.equal(row(totalsBc(c, { ken: { c: { m: 'set', v: 1.05, why: 'x' } }, neo: { d: { m: 'input' } } }), 'ken').b.amount, 3150);
  // a setting that needs checking is not solved by a provisional value (設定の確認が必要: ② range not on the 7 levels)
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { s: { on: true, lo: 0.975, hi: 1.05, g2: 1 } }, _at: 1 } };
  const tc = totalsBc(c, { ken: { c: { m: 'tmp' } }, neo: { d: { m: 'input' } }, mia: { s: { m: 'tmp' } } });
  assert.equal(row(tc, 'mia').b.blocked, 'eval');
  assert.match(row(tc, 'mia').b.missing.join(), /設定の確認が必要/);
  assert.equal(tc.nCfg, 1);
  delete c.STORE.bonus_eval_rule;
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { j: { clo: 0.8, chi: 1.2, g3: 1 } }, _at: 1 } };
  const tj = totalsBc(c, { ken: { c: { m: 'tmp' } }, neo: { d: { m: 'input' } } });
  assert.equal(row(tj, 'aki').b.blocked, 'eval', 'the company rule needs to be chosen again: no provisional value solves it');
  assert.ok(tj.nCfg > 0);
});

test('a pending Career Score change is an unconfirmed part with 入力中を仮採用 (the current official points)', () => {
  const c = co(null);
  vm.runInContext(`function lssPendingFor(n, k){ return n === 'Ken Sample' && k === 'score'; }`, c);
  const t0 = totalsBc(c);
  assert.equal(row(t0, 'ken').b.blocked, 'unsel');
  assert.deepEqual(row(t0, 'ken').b.parts.map(P => [P.k, P.input]), [['c', true]], '入力中を仮採用 is offered');
  const t1 = totalsBc(c, { ken: { c: { m: 'input' } } });
  assert.equal(row(t1, 'ken').b.blocked, null);
  assert.equal(row(t1, 'ken').b.amount, row(run(c, 'kevTotals(kbCfg(), kevApplies(kbCfg()))'), 'ken').b.amount);
});

test('provisional close → final → paid, through the real server; the person sees only the effective final', async () => {
  const srv = await server();
  const c = co(srv);
  unconfirmed(c);
  await load(c);
  assert.equal(state(c).k, 'draft');
  assert.equal(run(c, `bcSaveVersion('${Q}','provisional')`), false, 'unselected parts: not saved');
  assert.match(lastToast(c), /使う値を選んでいない部分が 2/);
  // the self view before anything is confirmed: 査定中, no amount
  const self0 = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='aki'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.deepEqual([self0.pending, self0.amt], [true, 0]);
  // 未確定部分を 1.00 で試算 (a reason is required; only the unselected parts)
  vm.runInContext(`_bc.draft.choices = { ken: { c: { m: 'set', v: 1.05, why: '面談で確認', at: 'x', by: 'GM' } } };`, c);
  vm.runInContext(`bcBulkOpen('${Q}')`, c);
  assert.match(c.MODAL.at(-1), /Neo Sample.*評価完了/);
  assert.doesNotMatch(c.MODAL.at(-1), /Ken Sample/, 'a part with a chosen value is not overwritten');
  c.DOM['bc-bulk-why'] = { value: '' };
  vm.runInContext('bcBulkApply()', c);
  assert.match(lastToast(c), /理由/);
  c.DOM['bc-bulk-why'] = { value: '締めの試算（評価待ち 1 名）' };
  vm.runInContext('bcBulkApply()', c);
  assert.deepEqual(run(c, '_bc.draft.choices.neo.d.m'), 'input');
  assert.equal(run(c, '_bc.draft.bulk.length'), 1);
  assert.equal(run(c, '_bc.dirty'), true);
  // the provisional close: the server accepts the app's snapshot (its own checks pass) and names v1
  const ok = await runP(c, `bcSaveVersion('${Q}','provisional')`);
  assert.equal(ok, true, lastToast(c));
  let S = state(c);
  assert.deepEqual([S.k, S.last.ver, S.last.kind, S.last.has_prov], ['prov', 1, 'provisional', true]);
  const live = totalsBc(c, run(c, '_bc.data.latest.snap.choices'));
  assert.equal(S.last.paid_total, live.paid);
  assert.equal(run(c, '_bc.data.latest.snap.lid'), `BC-${Q}-v1`);
  assert.deepEqual(run(c, '_bc.data.latest.snap.people.ken.adopt'), { c: { m: 'set', v: 1.05, why: '面談で確認', at: 'x', by: 'GM' } });
  // a provisional close is not shown to the person and is not the app's confirmed record
  assert.equal(run(c, `bqGet('${Q}').locked`), false);
  assert.equal(run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()).pending; })()`), true);
  // a new evaluation after the provisional close: v1 keeps its numbers, the screen says 新しい評価があります
  c.SCORES['Ken Sample'].scores.D3 = 3;
  const V = run(c, `bcView(kbCfg(), kevTotals(kbCfg(), kevApplies(kbCfg())))`);
  assert.equal(V.mode, 'ver');
  assert.equal(V.tot.paid, S.last.paid_total);
  const ne = run(c, `bcNewEval(kbCfg(), bcView(kbCfg(), kevTotals(kbCfg(), kevApplies(kbCfg()))))`);
  assert.deepEqual(ne.map(x => x.id), ['ken']);
  assert.match(ne[0].why, /① の評価が届いた/);
  // 支給額を確定 from v1 (it carries provisional values → a reason is required): v2, the same amounts
  vm.runInContext(`bcConfirm('${Q}')`, c);
  assert.match(c.MODAL.at(-1), /未確定の評価に仮の値を使った部分があります/);
  assert.match(c.MODAL.at(-1), /新しい評価が 1 人あります/);
  c.DOM['bc-ask-why'] = { value: '' };
  vm.runInContext('bcAskOk()', c);
  assert.match(lastToast(c), /理由を入れてください/);
  c.DOM['bc-ask-why'] = { value: '支給日に間に合わせるため（Neo は評価待ち）' };
  vm.runInContext('bcAskOk()', c);
  await new Promise(r => setTimeout(r, 300));
  S = state(c);
  assert.deepEqual([S.k, S.ef.ver, S.ef.from_ver, S.ef.has_prov, S.ef.paid_total], ['final', 2, 1, true, live.paid], lastToast(c));
  // the app's confirmed record (bonus_q.evSnap) is the server's v2: other screens, the person's view and the pay history read it
  const d = run(c, `bqGet('${Q}')`);
  assert.equal(d.locked, true);
  assert.equal(d.evSnap.lid, `BC-${Q}-v2`);
  assert.equal(run(c, `kevSnapOk(bqGet('${Q}'))`), true);
  assert.equal(run(c, `kevTotals(kbCfg(), kevApplies(kbCfg())).paid`), live.paid);
  assert.equal(run(c, `bcMirrorState('${Q}', bcStateOf(_bc.data))`), 'ok');
  const self1 = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.deepEqual([self1.eff, self1.amt], [true, d.evSnap.finals.ken]);
  assert.match(run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfExplainHtml(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`), /評価が終わる前の値/);
  // 支給済みとして記録 with a payment date: not while the confirmed record has not reached the cloud
  c.CLOUD_MISSING = true;
  vm.runInContext(`bcPaidOpen('${Q}')`, c);
  c.DOM['bc-paid-on'] = { value: '2026-11-13' };
  assert.equal(await runP(c, `bcPaidApply('${Q}')`), false);
  assert.match(lastToast(c), /まだクラウドに届いていない/);
  assert.equal(state(c).k, 'final');
  c.CLOUD_MISSING = false;
  // the server marks v2 paid, the pay history gets the v2 amounts with the date
  vm.runInContext(`bcPaidOpen('${Q}')`, c);
  c.DOM['bc-paid-on'] = { value: 'x' };
  assert.equal(run(c, `bcPaidApply('${Q}')`), false);
  assert.match(lastToast(c), /支給日/);
  c.DOM['bc-paid-on'] = { value: '2026-11-13' };
  assert.equal(await runP(c, `bcPaidApply('${Q}')`), true, lastToast(c));
  S = state(c);
  assert.deepEqual([S.k, S.ef.paid_on], ['paid', '2026-11-13']);
  const log = run(c, `getKarte('ken').payLog`).filter(p => p.src === 'auto' && p.quarter === Q);
  assert.equal(log.length, 1);
  assert.equal(Number(String(log[0].amount).replace(/[$,]/g, '')), d.evSnap.finals.ken);
  assert.equal(log[0].date, '2026-11-13');
  assert.equal(run(c, `kbCfg().confirmedLog['${Q}'].paidOn`), '2026-11-13');
  // a second paid record is refused by the server
  assert.equal((await srv.direct('gm', { action: 'mark_paid', quarter: Q, expect_rev: run(c, '_bc.data.rev'), ver: 2, paid_on: '2026-11-14' })).body.error, 'already_paid');
  // nothing was sent to payroll or anywhere else: only the bonus-close API was called
  assert.deepEqual([...new Set(srv.calls)].sort(), ['confirm', 'get', 'mark_paid', 'save', 'version']);
});

test('correcting from the final: v2 stays effective until re-confirmed; after paid, the differences become adjustment records and the paid history stays', async () => {
  const srv = await server();
  const c = co(srv);
  unconfirmed(c);
  await load(c);
  vm.runInContext(`_bc.draft.choices = { ken: { c: { m: 'tmp' } }, neo: { d: { m: 'input' } } }; _bc.dirty = true;`, c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), true, lastToast(c));
  vm.runInContext(`bcConfirm('${Q}')`, c); c.DOM['bc-ask-why'] = { value: '仮の値で確定' }; vm.runInContext('bcAskOk()', c);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(state(c).k, 'final');
  vm.runInContext(`bcPaidOpen('${Q}')`, c); c.DOM['bc-paid-on'] = { value: '2026-11-13' };
  assert.equal(await runP(c, `bcPaidApply('${Q}')`), true, lastToast(c));
  const v2 = run(c, `bqGet('${Q}').evSnap`), pay0 = run(c, `getKarte('ken').payLog`);
  // Ken's evaluation arrives (higher), Neo marks complete; 確定版から修正
  c.SCORES['Ken Sample'].scores.D3 = 3;
  for (const k of ['A', 'B']) for (let i = 0; i < 30; i++) if (c.SCORES['Ken Sample'].scores[k + i] === 2) c.SCORES['Ken Sample'].scores[k + i] = 3;   // 284 → 321: ① 1.10
  c.STORE.bonus_eval[`${Q}|neo|G3`].st = 'done';
  assert.equal(await runP(c, `bcFixStart('${Q}')`), true, lastToast(c));
  let S = state(c);
  assert.deepEqual([S.k, S.fixing, S.ef.ver], ['fixFinal', 2, 2]);
  const d = run(c, `bqGet('${Q}')`);
  assert.equal(d.evSnap.lid, `BC-${Q}-v2`, 'v2 is still the confirmed record');
  assert.ok(d.bcFix);
  // the self view and the record still use v2
  assert.equal(run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()).amt; })()`), v2.finals.ken);
  assert.equal(run(c, `kevApplies(kbCfg()).eff.lid`), `BC-${Q}-v2`);
  const rw = run(c, `kevRecordWrite('${Q}', null, '2026-11-13')`);
  assert.equal(rw.tot.paid, v2.paid, 'records come from the effective final while correcting');
  assert.equal(Number(String(run(c, `getKarte('ken').payLog`).find(p => p.src === 'auto' && p.quarter === Q).amount).replace(/[$,]/g, '')), v2.finals.ken);
  const pay1 = run(c, `getKarte('ken').payLog`);
  // the correction computes with the new evaluations; Ken's ① is no longer unconfirmed
  const V = run(c, `bcView(kbCfg(), kevTotals(kbCfg(), kevApplies(kbCfg())))`);
  assert.equal(V.mode, 'edit');
  assert.equal(V.tot.unsel, 0);
  assert.ok(row(V.tot, 'ken').b.segs[0].coefs.c > 1);
  // re-confirm: a reason is required
  assert.equal(run(c, `bcSaveVersion('${Q}','final')`), true);
  c.DOM['bc-ask-why'] = { value: '' }; vm.runInContext('bcAskOk()', c);
  assert.match(lastToast(c), /理由/);
  c.DOM['bc-ask-why'] = { value: 'Ken の評価が届いた' }; vm.runInContext('bcAskOk()', c);
  await new Promise(r => setTimeout(r, 400));
  S = state(c);
  assert.deepEqual([S.k, S.ef.ver, S.paid.ver], ['reconf', 3, 2], lastToast(c));
  const v3 = run(c, `bqGet('${Q}').evSnap`);
  assert.equal(v3.lid, `BC-${Q}-v3`);
  assert.equal(run(c, `bqGet('${Q}').bcFix`), undefined);
  // the adjustment records: one per person whose amount changed; the sum of differences equals the change of the total
  const adj = run(c, '_bc.data.adjust');
  const want = Object.keys(v3.finals).filter(id => v3.finals[id] !== v2.finals[id]);
  assert.deepEqual(adj.map(x => x.emp_id).sort(), want.sort());
  assert.ok(adj.every(x => x.state === 'open' && x.paid_ver === 2 && x.prev_ver === 2 && x.new_ver === 3));
  assert.equal(adj.reduce((a, x) => a + Number(x.diff), 0), v3.paid - v2.paid);
  // the person keeps seeing the paid amount (the difference is handled by people); the explanation of another final is not shown
  const self = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.deepEqual([self.amt, self.recorded], [v2.finals.ken, true]);
  assert.equal(run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfExplainHtml(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`), '');
  // the paid pay history is not rewritten by the re-confirm
  assert.deepEqual(run(c, `getKarte('ken').payLog`), pay1);
  assert.equal(pay0.length, pay1.length);
  // the adjustment is marked done with a memo (nothing is paid or deducted by the app)
  vm.runInContext(`bcAdjDoneOpen('${Q}', ${adj[0].id})`, c);
  c.DOM['bc-adj-memo'] = { value: '' };
  assert.equal(run(c, 'bcAdjDoneApply()'), false);
  c.DOM['bc-adj-memo'] = { value: '12 月の支給で調整' };
  assert.equal(await runP(c, 'bcAdjDoneApply()'), true, lastToast(c));
  assert.equal(run(c, '_bc.data.adjust')[0].state, 'done');
  // every version opens with its own numbers
  assert.deepEqual(run(c, '_bc.data.versions').map(v => [v.ver, v.kind, v.status]), [[1, 'provisional', 'kept'], [2, 'final', 'replaced'], [3, 'final', 'effective']]);
});

test('another GM saved first: the save is refused (conflict), the screen reloads and keeps the unsaved choices', async () => {
  const srv = await server();
  const c = co(srv);
  unconfirmed(c);
  await load(c);
  vm.runInContext(`_bc.draft.choices = { ken: { c: { m: 'tmp' } } }; _bc.dirty = true;`, c);
  // the CEO saves a draft from another device
  assert.equal((await srv.direct('ceo', { action: 'draft_save', quarter: Q, expect_rev: 0, draft: { choices: { neo: { d: { m: 'input' } } } } })).status, 200);
  assert.equal(await runP(c, `bcDraftSave('${Q}')`), false);
  assert.match(c.TOASTS.map(x => x[0]).join('|'), /ほかの端末（ほかの人）がこの四半期を先に変えていました/);
  assert.equal(run(c, '_bc.data.rev'), 1);
  assert.deepEqual(run(c, '_bc.draft.choices'), { ken: { c: { m: 'tmp' } } }, 'the unsaved choices stay on the screen');
  assert.equal(run(c, '_bc.data.draft_by'), 'CEO Sample');
  assert.equal(await runP(c, `bcDraftSave('${Q}')`), true, lastToast(c));
  assert.equal(run(c, '_bc.data.rev'), 2);
  // accounting reads only: the buttons are not offered, the server refuses writes
  assert.equal((await srv.direct('office', { action: 'draft_save', quarter: Q, expect_rev: 2, draft: {} })).status, 403);
  c.SESSION.access_token = 'tok-office';
  await load(c);
  assert.equal(run(c, '_bc.data.me.write'), false);
  assert.equal(run(c, `bcDraftSave('${Q}')`), false);
  assert.match(lastToast(c), /GM・CEO/);
});

test('a quarter confirmed by v1108 or earlier is imported without changing any number; the screen does not recount it before', async () => {
  const srv = await server();
  const c = co(srv);
  // the old confirm (kevLockCommit) on this device
  c.CONFIRM = true;
  assert.equal(run(c, `kevLockCommit('${Q}', null, true)`), true);
  const old = run(c, `bqGet('${Q}').evSnap`);
  await load(c);
  assert.equal(state(c).k, 'draft');
  assert.equal(run(c, `bcMirrorState('${Q}', bcStateOf(_bc.data))`), 'old');
  const V = run(c, `bcView(kbCfg(), kevTotals(kbCfg(), kevApplies(kbCfg())))`);
  assert.deepEqual([V.mode, V.oldLock, V.tot.paid], ['live', true, old.paid]);
  assert.equal(await runP(c, `bcImport('${Q}')`), true, lastToast(c));
  const S = state(c);
  assert.deepEqual([S.k, S.ef.ver, S.ef.paid_total, S.ef.has_prov], ['final', 2, old.paid, false]);
  const now = run(c, `bqGet('${Q}').evSnap`);
  assert.equal(now.lid, `BC-${Q}-v2`);
  assert.deepEqual(now.finals, old.finals);
  assert.deepEqual(now.people, old.people);
});

test('the screen: the panel, the list column and the person view follow the state; amounts of incomplete runs are not shown', async () => {
  const srv = await server();
  const c = co(srv);
  unconfirmed(c);
  await load(c);
  const html = () => run(c, `(function(){ var cfg=kbCfg(), tot=kevTotals(cfg, kevApplies(cfg)), V=bcView(cfg, tot); return bcPanelHtml(cfg, V)+kevResultTopHtml(cfg, V.tot)+kevListTableHtml(cfg, V.tot, V); })()`);
  let h = html();
  assert.match(h, /作成中・試算中/);
  assert.match(h, /算定未完了/);
  assert.match(h, /未確定の部分に使う値/);
  assert.match(h, /未選択/);
  assert.match(h, /未確定部分を 1\.00 で試算（未選択 2）/);
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /×[01]\.\d{3}/, 'no k while anything is unselected');
  assert.doesNotMatch(h, /支給の合計（見込み）/, 'no estimated total while anything is unselected');
  // choose for Ken in the modal: 入力中を仮採用 is disabled for an unscored ①; a set value needs a reason
  vm.runInContext(`bcChooseOpen('ken')`, c);
  assert.match(c.MODAL.at(-1), /value="input" disabled/);
  c.DOM['@bcch-c'] = { value: 'set' }; c.DOM['@bcch-c-v'] = { value: '1.1' }; c.DOM['bcch-c-why'] = { value: '' };
  vm.runInContext(`bcChooseApply('ken')`, c);
  assert.match(lastToast(c), /理由/);
  c.DOM['bcch-c-why'] = { value: '面談で確認' };
  vm.runInContext(`bcChooseApply('ken')`, c);
  assert.deepEqual(run(c, '_bc.draft.choices.ken.c.v'), 1.1);
  h = html();
  assert.match(h, /指定 1\.10/);
  assert.match(h, /保存していない変更があります/);
  vm.runInContext(`_bc.draft.choices.neo = { d: { m: 'input' } };`, c);
  h = html();
  assert.doesNotMatch(h, /算定未完了/);
  assert.match(h.replace(/<[^>]+>/g, ' '), /k ×[01]\.\d{3}/);
  assert.match(h, /仮締めを保存/);
  assert.match(h, /暫＝暫定 1\.00/);
  // the person view's tile says 査定中 before the final (8A)
  const tile = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='aki'; }); var b=bonusForEmp(e, kbCfg()); return bcSelfCur(e, b, kbCfg()); })()`);
  assert.equal(tile.pending, true);
  // no emoji as UI icons in the block
  assert.doesNotMatch(BC, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test('the save reads the other devices first: when an evaluation changed meanwhile, nothing is saved', async () => {
  const srv = await server();
  const c = co(srv);
  unconfirmed(c);
  await load(c);
  vm.runInContext(`_bc.draft.choices = { ken: { c: { m: 'tmp' } }, neo: { d: { m: 'input' } } }; _bc.dirty = true;`, c);
  // the pull (kevLockPull → pullOpKey) brings another device's change of Mia's evaluation
  vm.runInContext(`var PULLED = 0; function pullOpKey(k){ if(k === 'bonus_eval' && !PULLED++){ STORE.bonus_eval['${Q}|mia|G4'].ab.lv = 5; } return Promise.resolve(true); }`, c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), false);
  assert.match(c.TOASTS.map(x => x[0]).join('|'), /ほかの端末で評価・設定・原資などが変わっていたため、保存していません/);
  assert.equal(state(c).k, 'draft', 'no version on the server');
  assert.deepEqual(run(c, '_bc.draft.choices.ken'), { c: { m: 'tmp' } }, 'the choices stay');
  // the pull fails: nothing is saved
  vm.runInContext(`pullOpKey = function(){ return Promise.resolve(false); };`, c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), false);
  assert.match(lastToast(c), /読み切れなかった/);
  // the next press with nothing changing saves
  vm.runInContext(`pullOpKey = function(){ return Promise.resolve(true); };`, c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), true, lastToast(c));
  assert.equal(state(c).k, 'prov');
});

test('the app record must be the server\'s effective final: a different copy is shown, blocks the paid record, and can be set back', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), true, lastToast(c));
  assert.equal(run(c, '_bc.data.versions[0].has_prov'), false, 'nothing unconfirmed: no provisional values');
  vm.runInContext(`bcConfirm('${Q}')`, c);
  assert.doesNotMatch(c.MODAL.at(-1), /仮の値を使った部分/);
  c.DOM['bc-ask-why'] = { value: '' };
  vm.runInContext('bcAskOk()', c);   // no provisional values: the reason is optional
  await new Promise(r => setTimeout(r, 300));
  assert.equal(state(c).k, 'final', lastToast(c));
  assert.equal(run(c, `bcMirrorState('${Q}', bcStateOf(_bc.data))`), 'ok');
  // an older device rewrote the copy (another confirm): the panel says so, and the paid record waits
  vm.runInContext(`(function(){ var d=bqGet('${Q}'); d.evSnap.lid='Lold-1'; bqSet('${Q}', d); })()`, c);
  assert.equal(run(c, `bcMirrorState('${Q}', bcStateOf(_bc.data))`), 'bad');
  const h = run(c, `(function(){ var cfg=kbCfg(), tot=kevTotals(cfg, kevApplies(cfg)); return bcPanelHtml(cfg, bcView(cfg, tot)); })()`);
  assert.match(h, /サーバーの有効な確定版 v2 と違います/);
  assert.match(h, /アプリの記録を v2 に合わせる/);
  assert.equal(run(c, `bcPaidOpen('${Q}')`), false);
  assert.match(lastToast(c), /先にアプリの確定の記録を v2 に合わせて/);
  assert.equal(await runP(c, `bcMirrorFix('${Q}')`), true, lastToast(c));
  assert.equal(run(c, `bqGet('${Q}').evSnap.lid`), `BC-${Q}-v2`);
  assert.equal(run(c, `bcPaidOpen('${Q}')`), true);
});
