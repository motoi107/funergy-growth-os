// v1116 (Moto 10/29 18:42 HST 「ボーナスの基準額支給と個人別特別報酬の追加」; answers: base-pay people are taken from the pool first,
// special rewards are paid from the pool — neither is reduced; what is short shows as 不足額): per employee and quarter,
// 「無条件で基準額」 (the person's base amount, prorated, becomes the regular bonus without any evaluation; the evaluation data stays)
// and 特別報酬 (an amount and an optional reason, CEO / GM only), final = regular + special.
// Runs the real app code (FUNERGY_KARTE_EVAL and FUNERGY_BONUS_CLOSE from index.html) against the real bonus-close handler and both
// migrations (v1109 + v1116) in PGlite, with the fictional company of tests/karte-eval.test.mjs. No network, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
let fixture = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, Q } = await import('data:text/javascript;base64,' + Buffer.from(fixture + '\nexport { company, Q };\n').toString('base64'));
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const read = u => fs.readFileSync(u, 'utf8');
const MIG = read(new URL('../supabase/migrations/20261028090000_bonus_close.sql', import.meta.url));
const MIG2 = read(process.env.BC_MIG2 ? new URL('file://' + process.env.BC_MIG2) : new URL('../supabase/migrations/20261030090000_bonus_base_special.sql', import.meta.url));
const { createHandler, CODES } = await import(process.env.BC_HANDLER ? 'file://' + process.env.BC_HANDLER : '../supabase/functions/bonus-close/handler.mjs');
const SRC = read(index).replace(/\r\n/g, '\n');
const BC = (() => { const i = SRC.indexOf('/* FUNERGY_BONUS_CLOSE_BEGIN */'), j = SRC.indexOf('/* FUNERGY_BONUS_CLOSE_END */'); assert.ok(i > 0 && j > i); return SRC.slice(i, j); })();
const LSS_GROUPS_SRC = (() => { const i = SRC.indexOf('\nconst LSS_GROUPS = {'), j = SRC.indexOf('\n};', i); return 'var' + SRC.slice(i + 6, j + 3); })();
const fnSrc = name => { const s = SRC.indexOf('\nfunction ' + name + '('); assert.ok(s >= 0, name); return SRC.slice(s + 1, SRC.indexOf('\n}', s + 1) + 2); };
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const runP = async (c, code) => { const v = await vm.runInContext(code, c); return v === undefined ? v : J(v); };
const lastToast = c => (c.TOASTS.at(-1) || [''])[0];
const wait = ms => new Promise(r => setTimeout(r, ms));

const U = { gm: '00000000-0000-4000-8000-0000000000d1', ceo: '00000000-0000-4000-8000-0000000000d2', office: '00000000-0000-4000-8000-0000000000d3' };
async function server(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values ('E1','GM Sample','在籍'),('E2','CEO Sample','在籍'),('E3','Accounting Sample','在籍');`);
  for (const [k, r, e] of [['gm', 'gm', 'E1'], ['ceo', 'ceo', 'E2'], ['office', 'office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(MIG);
  if (!opts.v1109) await pg.exec(MIG2);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const authFetch = async (url, init) => { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch: authFetch, db });
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(String(url), 'https://db.test/functions/v1/bonus-close');
    calls.push(JSON.parse(init.body).action);
    return handler(new Request(String(url), { method: 'POST', headers: init.headers, body: init.body }));
  };
  const direct = async (who, body) => { const r = await handler(new Request('https://db.test/functions/v1/bonus-close', { method: 'POST', headers: { authorization: 'Bearer tok-' + who, 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const rev = async () => (await direct('gm', { action: 'get', quarter: Q })).body.rev;
  return { pg, fetch, calls, direct, rev };
}

// the fictional company on the v1099 rules (2026 Q3) with the bonus-close block, signed in by email (GM unless said otherwise)
function co(srv, who = 'gm') {
  const c = company();
  vm.runInContext(LSS_GROUPS_SRC, c);
  vm.runInContext(`KEV2_START = '2026-Q3'; var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };`, c);
  for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${Q}|${id}|G4`].fx = { lv: 3, why: '発注量とシフトの見直し（7/15〜）', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
  c.fetch = srv ? srv.fetch : (async () => { throw new Error('no server'); });
  c.Response = Response; c.Promise = Promise;
  c.setTimeout = (f, ms) => (ms <= 10 ? setTimeout(f, ms) : 0);
  c.SESSION = { access_token: 'tok-' + who, refresh_token: 'r' }; c.CLOUD_MISSING = false;
  c.curRole = who === 'office' ? 'office' : who;
  vm.runInContext(`var curStoreLogin = false, SUPABASE_URL = 'https://db.test', SUPABASE_ANON = 'anon-key', _botSession = null;
    function invInSession(){ return SESSION; } function invInSessionRefresh(){ return Promise.resolve(null); }
    function bizToday(){ return '2026-10-29'; } function ocsFmt(s){ return String(s||'').slice(0, 16); }
    function bonusQKey(cfg){ return String((cfg && cfg.quarter) || '').trim(); }
    function _fetchOpValue(key){ if(typeof CLOUD_MISSING!=='undefined' && CLOUD_MISSING) return Promise.resolve(null); var q=String(key).replace('spl_bonus_q_',''); return Promise.resolve(Object.prototype.hasOwnProperty.call(bqAll(), q) ? JSON.parse(JSON.stringify(bqAll()[q])) : null); }
    ${fnSrc('kevPersonState')}
    ${BC}`, c);
  return c;
}
const row = (tot, id) => tot.rows.find(r => r.e.id === id);
const state = c => run(c, 'bcStateOf(_bc.data)');
async function load(c) { vm.runInContext(`bcReset('${Q}')`, c); assert.equal(await runP(c, `bcLoad('${Q}')`), true, lastToast(c)); }
const view = c => run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcView(cfg, kevTotals(cfg, kv), kv); })()`);
// Ken has never been evaluated (no Career Score, no 4-item evaluation); Neo's evaluation is entered but not marked complete
function unevaluated(c) {
  c.SCORES['Ken Sample'] = undefined;
  delete c.STORE.bonus_eval[`${Q}|ken|G3`];
  c.STORE.bonus_eval[`${Q}|neo|G3`].st = 'draft';
}
async function payMode(c, id, mode, why = '') {
  assert.equal(run(c, `bcPayModeAsk(${JSON.stringify(id)}, '${mode}')`), true, lastToast(c));
  c.DOM['bc-ask-why'] = { value: why };
  vm.runInContext('bcAskOk()', c);
  await wait(250);
}
async function special(c, id, amount, why = '', del = false) {
  assert.equal(run(c, `bcSpOpen(${JSON.stringify(id)})`), true, lastToast(c));
  c.DOM['bc-sp-amt'] = { value: String(amount) }; c.DOM['bc-sp-why'] = { value: why };
  return runP(c, `bcSpApply(${JSON.stringify(id)}, ${del})`);
}
async function provisional(c) { const r = await runP(c, `bcSaveVersion('${Q}','provisional')`); assert.equal(r, true, lastToast(c)); }
async function confirmFinal(c, why = '確定') {
  vm.runInContext(`bcConfirm('${Q}')`, c);
  c.DOM['bc-ask-why'] = { value: why };
  vm.runInContext('bcAskOk()', c);
  await wait(350);
}

test('「無条件で基準額」 for a person never evaluated: the base becomes the regular bonus, the evaluation data stays, and the quarter can be closed', async () => {
  const srv = await server();
  const c = co(srv);
  unevaluated(c);
  vm.runInContext(`_kevEvBefore = JSON.stringify(STORE.bonus_eval); _scBefore = JSON.stringify(SCORES)`, c);
  await load(c);
  let V = view(c);
  assert.equal(row(V.tot, 'ken').b.blocked, 'unsel', 'without a choice Ken cannot be computed');
  // the row buttons: 「無条件で基準額」 on Ken's row
  const list = run(c, `kevListTableHtml(kbCfg(), (function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcView(cfg, kevTotals(cfg, kv), kv).tot; })(), (function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcView(cfg, kevTotals(cfg, kv), kv); })())`);
  assert.match(list, /bcPayModeAsk\(&quot;ken&quot;,'base'\)">無条件で基準額</);
  assert.match(list, /支給方式.*通常賞与額.*特別報酬.*最終支給額/);
  await payMode(c, 'ken', 'base');
  assert.match(c.MODAL.at(-1), /Ken Sample さんを「無条件で基準額」にします/);
  assert.match(c.MODAL.at(-1), /使う値が未選択（算定未完了）（評価で計算）→ \$3,000（基準額・日割り）/);
  assert.match(c.MODAL.at(-1), /評価の点数・係数・評価の状態はそのまま残ります/);
  assert.deepEqual(run(c, '_bc.data.pay.ken.b'), true, lastToast(c));
  V = view(c);
  const ken = row(V.tot, 'ken').b;
  assert.deepEqual([ken.payMode, ken.blocked, ken.amount, ken.parts], ['base', null, 3000, null], 'G3 base $3,000 for the whole quarter, no evaluation needed');
  // nothing invented: no Career Score, no 4-item evaluation, no completion mark
  assert.equal(run(c, '_kevEvBefore === JSON.stringify(STORE.bonus_eval) && _scBefore === JSON.stringify(SCORES)'), true);
  const list2 = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); var V=bcView(cfg, kevTotals(cfg, kv), kv); return kevListTableHtml(cfg, V.tot, V); })()`);
  assert.match(list2, /基準額支給<\/span><div[^>]*>評価の計算なし（評価の記録はそのまま）/);
  assert.match(list2, /bcPayModeAsk\(&quot;ken&quot;,'normal'\)">通常の評価計算に戻す</);
  // the person page (management): the breakdown and the explanation
  const pg = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); var tot=kevTotals(cfg, kv); var e=EMPS.find(function(x){ return x.id==='ken'; }); var b=kevBonusForEmp(e, cfg, kv); return [kevBreakdownHtml(e, b, kv, tot, false), kevExplainList(e, b, kv, tot).join('|')]; })()`);
  assert.match(pg[0], /基準額支給<\/b>/);
  assert.match(pg[0], /＝ 通常賞与額.*\$3,000/s);
  assert.match(pg[1], /無条件で基準額：評価の計算をせず、基準額（Grade <b>G3<\/b>）<b>\$3,000<\/b> をそのまま通常賞与/);
  assert.equal(c.SCORES['Ken Sample'], undefined);
  assert.equal(run(c, `kevPersonState(EMPS.find(function(e){ return e.id==='ken'; }), ${JSON.stringify(ken)}, kevApplies(kbCfg())).t`), '未着手', 'the evaluation status stays as it is');
  // Neo still needs a value; the quarter closes once that is chosen — Ken never blocks it
  vm.runInContext(`_bc.draft.choices = { neo: { d: { m: 'input' } } }; _bc.dirty = true;`, c);
  await provisional(c);
  const sn = run(c, '_bc.data.latest.snap');
  assert.deepEqual([sn.people.ken.mode, sn.people.ken.raw, sn.people.ken.final, sn.people.ken.reg], ['base', 3000, 3000, 3000]);
  assert.equal(sn.people.ken.adopt, null);
  assert.equal(sn.F, 3000);
  await confirmFinal(c);
  assert.equal(state(c).k, 'final', lastToast(c));
  assert.equal(run(c, `bqGet('${Q}').evSnap.finals.ken`), 3000);
  assert.equal(run(c, `bqGet('${Q}').evSnap.people.ken.mode`), 'base');
});

test('an evaluation in progress keeps its data; 「通常の評価計算に戻す」 brings back the normal rule exactly', async () => {
  const srv = await server();
  const c = co(srv);
  c.STORE.bonus_eval[`${Q}|neo|G3`].st = 'draft';
  delete c.SCORES['Neo Sample'].scores.D3;
  await load(c);
  vm.runInContext(`_bc.draft.choices = { neo: { c: { m: 'set', v: 1.05, why: '面談で確認' }, d: { m: 'input' } } }; _bc.dirty = true;`, c);
  const before = row(view(c).tot, 'neo').b;
  assert.equal(before.blocked, null);
  const evBefore = JSON.stringify(c.STORE.bonus_eval[`${Q}|neo|G3`]), scBefore = JSON.stringify(c.SCORES['Neo Sample']);
  await payMode(c, 'neo', 'base', '評価が間に合わないため');
  assert.equal(run(c, '_bc.dirty'), true, 'the unsaved choices of this screen are kept');
  const b1 = row(view(c).tot, 'neo').b;
  assert.deepEqual([b1.payMode, b1.amount], ['base', 3000]);
  assert.equal(JSON.stringify(c.STORE.bonus_eval[`${Q}|neo|G3`]), evBefore, 'the evaluation in progress is untouched');
  assert.equal(JSON.stringify(c.SCORES['Neo Sample']), scBefore, 'unscored stays unscored');
  assert.equal(c.STORE.bonus_eval[`${Q}|neo|G3`].st, 'draft');
  await payMode(c, 'neo', 'normal');
  assert.match(c.MODAL.at(-1), /「通常の評価計算」に戻します/);
  const b2 = row(view(c).tot, 'neo').b;
  assert.equal(b2.payMode, undefined);
  assert.deepEqual([b2.amount, b2.segs[0].coefs], [before.amount, before.segs[0].coefs], 'the same amount and coefficients as before');
  // the history: who, when, before / after mode and amounts, the reason
  const log = run(c, '_bc.data.paylog');
  assert.deepEqual(log.map(x => [x.action, x.detail.from, x.detail.to]), [['pay_mode', 'base', 'normal'], ['pay_mode', 'normal', 'base']]);
  assert.deepEqual([log[1].by, log[1].role, log[1].detail.why, log[1].detail.amt0, log[1].detail.amt1], ['GM Sample', 'gm', '評価が間に合わないため', before.amount, 3000]);
  assert.match(run(c, 'bcPayLogHtml(_bc.data.paylog, null)'), /支給方式：評価で計算 → 基準額支給.*評価が間に合わないため/s);
});

test('特別報酬: CEO and GM add, change and delete it; accounting cannot (the server checks the role); an empty reason saves and confirms', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  // the spec example: Aki (G2, base $1,000) on 「無条件で基準額」 + special $200 → $1,200
  await payMode(c, 'aki', 'base');
  const finalsBefore = view(c).tot.finals;
  assert.equal(await special(c, 'aki', 200, '新店立ち上げへの貢献'), true, lastToast(c));
  assert.equal(run(c, '_bc.data.pay.aki.sp'), 200);
  let t = view(c).tot;
  assert.deepEqual([row(t, 'aki').b.amount, t.reg.aki, t.sps.aki, t.finals.aki], [1000, 1000, 200, 1200], '基準額 $1,000 ＋ 特別報酬 $200 ＝ $1,200');
  for (const id of Object.keys(finalsBefore)) if (id !== 'aki') assert.equal(t.finals[id], finalsBefore[id], id + ': a special reward never reduces anyone else');
  assert.equal(t.paid, Object.values(finalsBefore).reduce((a, x) => a + x, 0) + 200);
  // the CEO changes it (another device); the GM screen reloads and sees it
  c.SESSION = { access_token: 'tok-ceo', refresh_token: 'r' }; c.curRole = 'ceo';
  await load(c);
  await special(c, 'aki', 250, '');
  assert.deepEqual([run(c, '_bc.data.pay.aki.sp'), run(c, '_bc.data.pay.aki.why'), run(c, '_bc.data.pay.aki.by')], [250, '', 'CEO Sample'], 'an empty reason is fine');
  // decimals and words are refused before anything is sent
  for (const bad of ['12.5', '-1', 'abc', '']) {
    assert.equal(await special(c, 'aki', bad, ''), false);
    assert.match(lastToast(c), /整数/);
  }
  // accounting (office) is refused by the server, whatever the screen does
  const r0 = await srv.rev();
  const off = await srv.direct('office', { action: 'sp_save', quarter: Q, expect_rev: r0, emp_id: 'aki', emp_name: 'Aki Sample', amount: 999, why: 'x' });
  assert.deepEqual([off.status, off.body.error], [403, 'forbidden']);
  const offm = await srv.direct('office', { action: 'pay_mode', quarter: Q, expect_rev: r0, emp_id: 'ken', mode: 'base' });
  assert.deepEqual([offm.status, offm.body.error], [403, 'forbidden']);
  assert.equal(await srv.rev(), r0, 'nothing written');
  // the screen: only CEO / GM see the button working
  c.SESSION = { access_token: 'tok-office', refresh_token: 'r' };
  await load(c);
  assert.equal(run(c, 'bcSpCan()'), false);
  c.SESSION = { access_token: 'tok-gm', refresh_token: 'r' }; c.curRole = 'gm';
  await load(c);
  // a wider write permission later never opens the special reward on the screen (CEO / GM by role)
  vm.runInContext(`_bc.data.me = Object.assign({}, _bc.data.me, { role: 'office', write: true })`, c);
  assert.deepEqual([run(c, 'bcPayCan()'), run(c, 'bcSpCan()')], [true, false]);
  await load(c);
  // a stale screen (old rev) is refused; nothing changes
  const stale = await srv.direct('gm', { action: 'sp_save', quarter: Q, expect_rev: r0 - 1, emp_id: 'aki', amount: 1, why: '' });
  assert.deepEqual([stale.status, stale.body.error], [409, 'conflict']);
  // the amount must be whole dollars (server)
  for (const amount of [12.5, -1, '12', 100000001, null]) assert.equal((await srv.direct('gm', { action: 'sp_save', quarter: Q, expect_rev: await srv.rev(), emp_id: 'aki', amount, why: '' })).body.error, 'bad_value', String(amount));
  // delete
  assert.equal(await special(c, 'aki', 0, '', true), true, lastToast(c));
  assert.equal(run(c, '_bc.data.pay.aki.sp'), undefined);
  assert.equal(run(c, '_bc.data.pay.aki.b'), true, 'deleting the special reward keeps 「無条件で基準額」');
  const log = run(c, '_bc.data.paylog').filter(x => x.action === 'sp');
  assert.deepEqual(log.map(x => [x.detail.from, x.detail.to, x.by]), [[250, 0, 'GM Sample'], [200, 250, 'CEO Sample'], [0, 200, 'GM Sample']]);
  assert.deepEqual([log[1].detail.why0, log[1].detail.why1], ['新店立ち上げへの貢献', '']);
  const logHtml = run(c, 'bcPayLogHtml(_bc.data.paylog, null)');
  assert.match(logHtml, /特別報酬：\$0 → \$200/);
  assert.match(logHtml, /特別報酬：\$200 → \$250.*新店立ち上げへの貢献 → （なし）/s);
  // a non-whole amount that somehow got in is never paid (the server only stores whole dollars)
  assert.equal(run(c, `kevPayOf({ pay: { x: { sp: 12.5 } } }, 'x').sp`), 0);
  // an empty reason confirms
  await special(c, 'aki', 200, '');
  await provisional(c);
  await confirmFinal(c);
  const S = state(c);
  assert.equal(S.k, 'final', lastToast(c));
  assert.equal(run(c, `bqGet('${Q}').evSnap.finals.aki`), 1200);
});

test('totals agree everywhere: the row, the totals, the snapshot, the confirmed copy, the pay history and the person\'s own view', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  await payMode(c, 'ken', 'base');
  await special(c, 'mia', 300, '他店舗への応援');
  await special(c, 'ken', 150, '期間中のハイパフォーマンス');
  const t = view(c).tot;
  assert.equal(t.nBlocked, 0);
  const ids = t.rows.map(r => r.e.id);
  for (const id of ids) assert.equal(t.finals[id], t.reg[id] + t.sps[id], id);
  assert.equal(t.paid, ids.reduce((a, id) => a + t.finals[id], 0));
  assert.equal(t.regPaid + t.SP, t.paid);
  assert.deepEqual([t.SP, t.F, t.nBase, t.nSp], [450, 3000, 1, 2]);
  assert.equal(t.reg.ken, 3000, 'the base amount is not reduced');
  // the evaluated share what is left after the base amounts: R = cap − F (special rewards are on top and reduce nobody)
  const evaluated = t.rows.filter(r => r.b.payMode !== 'base');
  const R = Math.max(0, Math.round((t.cap - t.F) * 100) / 100), Se = evaluated.reduce((a, r) => a + r.b.amount, 0);
  assert.equal(t.Se, Se);
  assert.equal(evaluated.reduce((a, r) => a + t.reg[r.e.id], 0), Math.min(Se, Math.floor(R)));
  assert.ok(Math.abs(t.k - Math.min(1, R / Se)) < 1e-12);
  assert.equal(t.short, Math.max(0, Math.round((t.total + t.SP - t.cap) * 100) / 100));
  // the panel shows the five totals
  const panel = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcPanelHtml(cfg, bcView(cfg, kevTotals(cfg, kv), kv)); })()`);
  for (const lbl of ['通常賞与合計', '特別報酬合計', '最終支給総額（見込み）', '利用可能な原資（支給の上限）', '不足額']) assert.match(panel, new RegExp(lbl), lbl);
  await provisional(c);
  const sn = run(c, '_bc.data.latest.snap');
  assert.deepEqual([sn.paid, sn.SP, sn.F], [t.paid, 450, 3000]);
  assert.deepEqual(sn.finals, t.finals);
  assert.deepEqual([sn.people.mia.sp, sn.people.mia.spWhy, sn.people.mia.reg], [300, '他店舗への応援', t.reg.mia]);
  await confirmFinal(c);
  const eff = run(c, `bqGet('${Q}').evSnap`);
  assert.deepEqual(eff.finals, t.finals);
  assert.equal(eff.people.mia.spWhy, '（理由はサーバーの版）', 'the reason stays in the server version, not in the shared copy');
  // the confirmed view (other screens) shows the same numbers
  const T2 = run(c, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
  assert.deepEqual([T2.paid, T2.SP, T2.regPaid, T2.finals.mia, T2.reg.mia], [t.paid, 450, t.regPaid, t.finals.mia, t.reg.mia]);
  assert.equal(row(T2, 'ken').b.payMode, 'base');
  // paid → the pay history has the final amounts (regular + special), with the breakdown
  vm.runInContext(`bcPaidOpen('${Q}')`, c); c.DOM['bc-paid-on'] = { value: '2026-11-13' };
  assert.equal(await runP(c, `bcPaidApply('${Q}')`), true, lastToast(c));
  const pay = run(c, `getKarte('mia').payLog`).find(p => p.src === 'auto' && p.quarter === Q);
  assert.equal(Number(pay.amount), t.finals.mia);
  assert.deepEqual([pay.snap.sp, pay.snap.reg], [300, t.reg.mia]);
  const payKen = run(c, `getKarte('ken').payLog`).find(p => p.src === 'auto' && p.quarter === Q);
  assert.deepEqual([Number(payKen.amount), payKen.snap.payMode, payKen.snap.sp], [3150, 'base', 150]);
  // the person's own view: the amount, and how it was decided (no reason text)
  const selfMia = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='mia'; }); return bcSelfCur(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.equal(selfMia.amt, t.finals.mia);
  const exMia = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='mia'; }); return bcSelfExplainHtml(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.match(exMia, /特別報酬 <b>\$300<\/b> を加えて、支給額は/);
  assert.doesNotMatch(exMia, /他店舗への応援/);
  const exKen = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='ken'; }); return bcSelfExplainHtml(e, bonusForEmp(e, kbCfg()), kbCfg()); })()`);
  assert.match(exKen, /基準額 <b>\$3,000<\/b> をそのまま支給の通常分.*特別報酬 <b>\$150<\/b>.*支給額は <b>\$3,150<\/b>/);
});

test('nothing is lost or doubled: recalculation, switching the mode, reloading on another device, correcting and re-confirming', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  await special(c, 'neo', 400, '特別な業務への貢献');
  await payMode(c, 'neo', 'base');
  await payMode(c, 'neo', 'normal');
  await payMode(c, 'neo', 'base');
  assert.deepEqual(run(c, '_bc.data.pay.neo').sp, 400, 'switching the mode keeps the special reward');
  // a draft save never touches pay
  vm.runInContext(`_bc.draft.choices = { aki: { c: { m: 'tmp' } } }; _bc.dirty = true;`, c);
  assert.equal(await runP(c, `bcDraftSave('${Q}')`), true, lastToast(c));
  assert.deepEqual([run(c, '_bc.data.pay.neo.sp'), run(c, '_bc.data.pay.neo.b')], [400, true]);
  // recalculating twice gives the same snapshot
  const B1 = run(c, `bcBuild('${Q}', kbCfg(), bcChoices(), [], false).sn`), B2 = run(c, `bcBuild('${Q}', kbCfg(), bcChoices(), [], false).sn`);
  assert.equal(run(c, `bcDigest(${JSON.stringify(B1)})`), run(c, `bcDigest(${JSON.stringify(B2)})`));
  // another device (a fresh app, signed in again) sees the same
  const c2 = co(srv, 'ceo');
  await load(c2);
  assert.deepEqual(run(c2, '_bc.data.pay.neo.sp'), 400);
  assert.equal(row(view(c2).tot, 'neo').b.payMode, 'base');
  assert.equal(view(c2).tot.finals.neo, 3400);
  await provisional(c);
  await confirmFinal(c);
  const v2 = run(c, `bqGet('${Q}').evSnap`);
  assert.equal(v2.finals.neo, 3400);
  assert.equal(run(c, 'bcPayCan()'), false, 'no buttons once a version is saved (until 修正を開始)');
  // pay cannot change once a version is saved (not correcting)
  assert.equal((await srv.direct('gm', { action: 'sp_save', quarter: Q, expect_rev: await srv.rev(), emp_id: 'neo', amount: 1, why: '' })).body.error, 'not_editable');
  // correct from the final: raise the special reward, cancel → back to the confirmed values
  // the column changed outside the screens (SQL): starting a correction puts back the version's base modes and special rewards
  await srv.pg.query(`update public.bc_quarters set pay = '{}'::jsonb where quarter = $1`, [Q]);
  assert.equal(await runP(c, `bcFixStart('${Q}')`), true, lastToast(c));
  assert.deepEqual([run(c, '_bc.data.pay.neo.sp'), run(c, '_bc.data.pay.neo.b'), run(c, 'bcPayCan()')], [400, true, true]);
  await special(c, 'neo', 900, 'やっぱり増やす');
  assert.equal(run(c, '_bc.data.pay.neo.sp'), 900);
  assert.equal(await runP(c, `bcFixCancel('${Q}')`), true, lastToast(c));
  assert.deepEqual([run(c, '_bc.data.pay.neo.sp'), run(c, '_bc.data.pay.neo.why'), run(c, '_bc.data.pay.neo.b')], [400, '特別な業務への貢献', true]);
  assert.ok(run(c, '_bc.data.paylog').some(x => x.action === 'pay_reset' && x.detail.why === 'fix_cancel'));
  // paid, then correct again and re-confirm: the confirmed copy changes, the paid history stays, the difference is an adjustment
  vm.runInContext(`bcPaidOpen('${Q}')`, c); c.DOM['bc-paid-on'] = { value: '2026-11-13' };
  assert.equal(await runP(c, `bcPaidApply('${Q}')`), true, lastToast(c));
  const paid0 = run(c, `getKarte('neo').payLog`);
  assert.equal(await runP(c, `bcFixStart('${Q}')`), true, lastToast(c));
  await special(c, 'neo', 500, '特別な業務への貢献');
  assert.equal(run(c, `bcSaveVersion('${Q}','final')`), true);
  c.DOM['bc-ask-why'] = { value: '特別報酬を見直し' }; vm.runInContext('bcAskOk()', c);
  await wait(400);
  const S = state(c);
  assert.deepEqual([S.k, S.ef.ver], ['reconf', 3], lastToast(c));
  assert.equal(run(c, `bqGet('${Q}').evSnap.finals.neo`), 3500);
  assert.deepEqual(run(c, `getKarte('neo').payLog`), paid0, 'the paid history is not rewritten');
  const adj = run(c, '_bc.data.adjust');
  assert.deepEqual(adj.map(x => [x.emp_id, x.prev_amount, x.new_amount, x.diff]), [['neo', 3400, 3500, 100]], 'one adjustment, no duplicate, nobody else changed');
  assert.equal(run(c, '_bc.data.paylog').filter(x => x.action === 'sp' && x.detail.to === 500).length, 1);
});

test('over the pool: the specified amounts are not reduced, the evaluated share what is left, the shortfall is shown and can be covered', async () => {
  const srv = await server();
  const c = co(srv);
  c.POOL = 20000;
  await load(c);
  await payMode(c, 'gus', 'base');   // G6 $12,000
  await special(c, 'sam', 9000, 'ハイパフォーマンス');
  let t = view(c).tot;
  assert.deepEqual([t.F, t.SP, t.reg.gus], [12000, 9000, 12000]);
  assert.equal(t.fixedOver, Math.round((21000 - t.cap) * 100) / 100, 'base + special exceed the cap');
  const R = Math.max(0, Math.round((t.cap - 12000) * 100) / 100);
  assert.equal(t.rows.filter(r => r.e.id !== 'gus').reduce((a, r) => a + t.reg[r.e.id], 0), Math.floor(R), 'the evaluated share what is left after the base amount');
  assert.equal(t.finals.sam, t.reg.sam + 9000, 'the special reward is on top, not reduced');
  assert.equal(t.paid, 12000 + Math.floor(R) + 9000, 'more than the cap: nothing reduced');
  assert.ok(t.paid > t.cap);
  assert.equal(t.short, Math.round((t.total + t.SP - t.cap) * 100) / 100);
  const panel = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcPanelHtml(cfg, bcView(cfg, kevTotals(cfg, kv), kv)); })()`);
  assert.match(panel, /合計が、利用可能な原資を .* 超えています。指定した額は減らしません。不足額/);
  assert.match(panel, /不足分を補う（＋/);
  // the server accepts this version (the amounts add up)
  await provisional(c);
  assert.equal(run(c, '_bc.data.latest.snap.paid'), t.paid);
  // the base amount alone over the pool: the evaluated get $0, the fixed amounts stay
  const srv2 = await server(), c2 = co(srv2);
  c2.POOL = 9000;
  await load(c2);
  await payMode(c2, 'gus', 'base');
  t = view(c2).tot;
  for (const r of t.rows.filter(r => r.e.id !== 'gus')) assert.equal(t.reg[r.e.id], 0, r.e.id);
  assert.equal(t.paid, 12000);
  assert.match(run(c2, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcPanelHtml(cfg, bcView(cfg, kevTotals(cfg, kv), kv)); })()`), /評価で決まる人の額は \$0 になります/);
  await provisional(c2);
});

test('an older app (or a stale snapshot) cannot drop the base modes or the special rewards; nobody missing from the list is dropped silently', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  await special(c, 'aki', 200, 'x');
  const B = run(c, `bcBuild('${Q}', kbCfg(), {}, [], false).sn`);
  // the v1109 app's snapshot: no special reward in it (the old formula)
  const old = J(B); delete old.people.aki.sp; delete old.people.aki.spWhy; delete old.people.aki.reg; old.finals.aki = old.people.aki.final = old.finals.aki - 200; old.paid -= 200; delete old.F; delete old.SP; delete old.Se;
  // re-share the pool as v1109 would (no special reward): recompute with the app without pay
  const c0 = co(null); const t0 = run(c0, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
  for (const id of Object.keys(old.finals)) { old.finals[id] = t0.finals[id]; old.people[id].final = t0.finals[id]; delete old.people[id].reg; }
  old.paid = t0.paid; old.k = t0.k;
  const r1 = await srv.direct('gm', { action: 'save', quarter: Q, expect_rev: await srv.rev(), kind: 'provisional', snap: old, why: '' });
  assert.deepEqual([r1.status, r1.body.error], [400, 'pay_mismatch'], 'an older app cannot save over a special reward');
  // a wrong reason or amount is refused too
  const wrong = J(B); wrong.people.aki.spWhy = 'y';
  assert.equal((await srv.direct('gm', { action: 'save', quarter: Q, expect_rev: await srv.rev(), kind: 'provisional', snap: wrong, why: '' })).body.error, 'pay_mismatch');
  // someone with a special reward who left the list stops the save (no silent drop) until it is removed
  await special(c, 'gus', 100, '');
  vm.runInContext(`EMPS.find(function(e){ return e.id==='gus'; }).out = true`, c);   // off the list (in the test company: `out`)
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), false);
  assert.match(lastToast(c), /一覧にいない人に「無条件で基準額」・特別報酬が入っています（Gus Sample）/);
  const panel = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); return bcPanelHtml(cfg, bcView(cfg, kevTotals(cfg, kv), kv)); })()`);
  assert.match(panel, /Gus Sample：特別報酬 \$100.*外す/);
  // the server refuses it too (an app that does not check): the snapshot without Gus
  const noGus = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); var t=kevTotals(cfg, bcLiveKv(cfg, {}, false)); return t.rows.map(function(r){ return r.e.id; }); })()`);
  assert.ok(!noGus.includes('gus'));
  const B3 = run(c, `(function(){ var p=_bc.data.pay; _bc.data.pay=JSON.parse(JSON.stringify(p)); delete _bc.data.pay.gus; var r=bcBuild('${Q}', kbCfg(), {}, [], false).sn; _bc.data.pay=p; return r; })()`);
  assert.equal((await srv.direct('gm', { action: 'save', quarter: Q, expect_rev: await srv.rev(), kind: 'provisional', snap: B3, why: '' })).body.error, 'pay_mismatch', 'a special reward of someone not in the version stops the save (server)');
  assert.equal(await runP(c, `bcPayOrphanClear('gus')`), true, lastToast(c));
  assert.equal(run(c, '_bc.data.pay.gus'), undefined);
  // 「無条件で基準額」 alone counts as well
  vm.runInContext(`EMPS.find(function(e){ return e.id==='gus'; }).out = false`, c);
  await payMode(c, 'ray', 'base');
  vm.runInContext(`EMPS.find(function(e){ return e.id==='ray'; }).out = true`, c);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), false);
  assert.match(lastToast(c), /一覧にいない人に「無条件で基準額」・特別報酬が入っています（Ray Sample）/);
  assert.equal(await runP(c, `bcPayOrphanClear('ray')`), true, lastToast(c));
  await provisional(c);
  // after a version is saved, the mode cannot change either (until 修正を開始)
  assert.equal((await srv.direct('gm', { action: 'pay_mode', quarter: Q, expect_rev: await srv.rev(), emp_id: 'neo', mode: 'base' })).body.error, 'not_editable');
});

test('「基準額未設定」: no base for the grade → shown and the close is stopped (no $0, no other value)', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  await payMode(c, 'aki', 'base');
  // the G2 base is removed from the settings after Aki was put on base pay (Aki stays on the list through her G2 history in the test company)
  vm.runInContext(`var _kb=kbCfg; kbCfg=function(){ var x=_kb(); delete x.gradeBase.G2; return x; }; karteEligibleEmps=(function(f){ return function(){ var l=f(); if(!l.some(function(e){ return e.id==='aki'; })) l.push(EMPS.find(function(e){ return e.id==='aki'; })); return l; }; })(karteEligibleEmps);`, c);
  const t = view(c).tot;
  const aki = row(t, 'aki').b;
  assert.deepEqual([aki.blocked, aki.amount, aki.raw], ['nobase', 0, null]);
  assert.match(aki.missing[0], /基準額未設定/);
  assert.equal(t.nNoBase, 1);
  assert.equal(t.paid, null, '算定未完了: no totals');
  assert.deepEqual([t.reg, t.regPaid], [null, null], 'no regular amounts either');
  assert.equal(run(c, `kevPersonState(EMPS.find(function(e){ return e.id==='aki'; }), ${JSON.stringify(aki)}, kevApplies(kbCfg())).t`), '基準額未設定');
  const html = run(c, `(function(){ var cfg=kbCfg(); var kv=kevApplies(cfg); var V=bcView(cfg, kevTotals(cfg, kv), kv); return bcPanelHtml(cfg, V)+kevListTableHtml(cfg, V.tot, V); })()`);
  assert.match(html, /基準額未設定の人が 1 名います（Aki Sample）/);
  assert.match(html, /基準額未設定/);
  assert.equal(await runP(c, `bcSaveVersion('${Q}','provisional')`), false);
  assert.match(lastToast(c), /基準額未設定の人が 1 名/);
  // a valid $0 base is not 「未設定」
  vm.runInContext(`kbCfg=function(){ var x=_kb(); x.gradeBase.G2=0; return x; };`, c);
  const t0 = view(c).tot;
  assert.deepEqual([row(t0, 'aki').b.blocked, row(t0, 'aki').b.amount], [null, 0]);
});

test('without any base mode or special reward the numbers are exactly the v1109 ones (app and server)', async () => {
  const srvOld = await server({ v1109: true }), srvNew = await server();
  const c = co(srvNew);
  await load(c);
  const t = view(c).tot, c0 = co(null);
  const t0 = run(c0, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
  assert.deepEqual([t.paid, t.k, t.finals, t.short, t.total], [t0.paid, t0.k, t0.finals, t0.short, t0.total]);
  // random snapshots (valid and broken): the v1109 check and the v1116 check give the same answer when there is no base mode or special reward
  const { pg: a } = srvOld, { pg: b } = srvNew;
  const chk = async (pg, s) => { try { return String((await pg.query('select public.bc_snap_check($1,$2::jsonb) v', [Q, JSON.stringify(s)])).rows[0].v); } catch (e) { return e.message; } };
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 160; i++) {
    const n = 1 + rnd(6), list = Array.from({ length: n }, (_, j) => ({ id: 'p' + j, raw: rnd(5) === 0 ? 0 : 100 + rnd(9000) }));
    const S = list.reduce((x, y) => x + y.raw, 0), cap = rnd(4) === 0 ? S + rnd(500) : Math.round(rnd(S + 1) * 100 + rnd(100)) / 100;
    const al = run(c0, `kevAlloc(${JSON.stringify(list)}, ${cap})`);
    const s = { q: Q, order: list.map(x => x.id), people: Object.fromEntries(list.map(x => [x.id, { raw: x.raw, final: al.finals[x.id] }])), finals: al.finals, S, paid: al.sum, cap, k: al.k, unsel: 0, prov: 0, choices: {} };
    const m = rnd(5);
    if (m === 1 && n > 1) { s.finals.p0 += 1; s.people.p0.final += 1; s.paid += 1; }
    if (m === 2) s.k = s.k * 0.9;
    if (m === 3) { s.finals.p0 = s.people.p0.raw + 1; s.people.p0.final = s.finals.p0; }
    assert.equal(await chk(b, s), await chk(a, s), JSON.stringify(s));
  }
});

test('the server: tables and functions stay closed to browsers; deploy files are the sources; SQL twice; the checks say OK; rollback only before use', async () => {
  const { pg } = await server();
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role);
  }
  const sec = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\\_%' and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
  assert.equal(sec.rows[0].n, 0);
  assert.ok(CODES.includes('pay_mismatch'));
  const D = new URL('../deploy/bonus-close-base-special-v1116/', import.meta.url);
  assert.equal(read(new URL('1_追加のSQL_基準額支給と特別報酬.sql', D)), MIG2);
  const one = read(new URL('3_関数_bonus-close_index.ts', D)), h = read(new URL('../supabase/functions/bonus-close/handler.mjs', import.meta.url));
  assert.ok(one.includes(h.trimEnd()), 'the handler, unchanged');
  assert.ok(one.trimEnd().endsWith('Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));'));
  assert.doesNotMatch(one, /^import /m);
  // a fresh database: before → v1109 → v1116 twice → the checks
  const fresh = async () => { const p = new PGlite(); await p.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.employees(id text primary key, name text, status text);
    grant select on public.manager_auth, public.employees to service_role; insert into public.manager_auth values ('${U.gm}','gm','E1');`); return p; };
  const p1 = await fresh();
  await assert.rejects(p1.exec(MIG2), /STOP: 先に 20261028090000/);
  assert.equal((await p1.query(`select count(*)::int n from pg_proc where proname like 'bc\\_%'`)).rows[0].n, 0, 'nothing made without v1109');
  await p1.exec(MIG);
  const pre = (await p1.query(read(new URL('0_最初に確認_読むだけ.sql', D)))).rows;
  assert.deepEqual(pre.map(r => r.result), ['OK', '21', '0', '0']);
  await p1.exec(MIG2); await p1.exec(MIG2);
  const post = (await p1.query(read(new URL('2_確認のSQL_読むだけ.sql', D)))).rows;
  assert.deepEqual(post.slice(0, -2).filter(r => r.result !== 'OK').map(r => r.check_item), []);
  assert.deepEqual(post.slice(-2).map(r => r.result), ['0', '0']);
  // rollback before use: back to v1109 (21 functions, no pay column)
  await p1.exec(read(new URL('戻す_使う前だけ.sql', D)));
  assert.equal((await p1.query(`select count(*)::int n from pg_proc where proname like 'bc\\_%'`)).rows[0].n, 21);
  assert.equal((await p1.query(`select count(*)::int n from information_schema.columns where table_name = 'bc_quarters' and column_name = 'pay'`)).rows[0].n, 0);
  const v1109fn = (await p1.query(`select pg_get_functiondef('public.bc_snap_check(text,jsonb)'::regprocedure) d`)).rows[0].d;
  assert.match(v1109fn, /fin > raw/, 'the v1109 check is back');
  // used → the rollback stops and changes nothing
  await p1.exec(MIG2);
  await p1.exec(`set role service_role; select public.bc_sp_save('{"actor":"${U.gm}","quarter":"2026-Q3","expect_rev":0,"emp_id":"aki","amount":5,"why":""}'::jsonb); reset role;`);
  await assert.rejects(p1.exec(read(new URL('戻す_使う前だけ.sql', D))), /STOP/);
  assert.equal((await p1.query(`select pay->'aki'->>'sp' v from public.bc_quarters`)).rows[0].v, '5');
  for (const f of ['手順.md']) assert.ok(fs.existsSync(new URL(f, D)), f);
  assert.equal(createHash('sha256').update(MIG2).digest('hex').length, 64);
});

test('the server check: a snapshot with base modes and special rewards must add up (tampered ones are refused)', async () => {
  const srv = await server();
  const c = co(srv);
  await load(c);
  await payMode(c, 'ken', 'base');
  await special(c, 'mia', 300, '');
  const B = run(c, `bcBuild('${Q}', kbCfg(), {}, [], false).sn`);
  const chk = async s => { try { return String((await srv.pg.query('select public.bc_snap_check($1,$2::jsonb) v', [Q, JSON.stringify(s)])).rows[0].v); } catch (e) { return e.message; } };
  assert.equal(await chk(B), '0');
  const T = f => { const s = J(B); f(s); return s; };
  const evs = B.order.filter(id => id !== 'ken' && id !== 'mia' && B.finals[id] > 10), ev = evs[0], ev2 = evs[1];
  assert.ok(ev2 && B.people.mia.reg > 300);
  const cases = {
    'base reduced (moved to someone evaluated)': s => { s.finals.ken -= 1; s.people.ken.final -= 1; s.people.ken.reg -= 1; s.finals[ev] += 1; s.people[ev].final += 1; s.people[ev].reg += 1; },
    'special not added to the final': s => { s.finals.mia -= 300; s.people.mia.final -= 300; s.people.mia.reg = s.finals.mia - 300; s.paid -= 300; },
    'special changed in people only': s => { s.people.mia.sp = 301; },
    'F wrong': s => { s.F += 1; },
    'SP wrong': s => { s.SP -= 1; },
    'reg inconsistent': s => { s.people.mia.reg += 1; },
    'the evaluated share more than what is left after the base': s => { s.finals[ev] += 1; s.people[ev].final += 1; s.people[ev].reg += 1; s.paid += 1; },
    'k as if the special reduced the pool': s => { s.k = Math.min(1, (s.cap - s.F - s.SP) / s.Se); },
    'a negative special': s => { s.people.mia.sp = -300; s.finals.mia += 600; s.people.mia.final += 600; },
    'mode other than base': s => { s.people.ken.mode = 'free'; },
    // each of these is caught by one check only
    'base reduced alone (the total drops with it)': s => { s.finals.ken -= 1; s.people.ken.final -= 1; s.people.ken.reg -= 1; s.paid -= 1; },
    'two evaluated people swap $5 (the sum stays)': s => { for (const [id, d] of [[ev, -5], [ev2, 5]]) { s.finals[id] += d; s.people[id].final += d; s.people[id].reg += d; } },
    'a negative special that otherwise adds up': s => { s.people.mia.sp = -300; s.finals.mia = s.people.mia.final = s.people.mia.reg - 300; s.paid -= 600; s.SP = -300; },
    'an unknown mode on someone evaluated': s => { s.people[ev].mode = 'free'; },
  };
  for (const [name, f] of Object.entries(cases)) assert.match(await chk(T(f)), /bad_amounts|bad_snapshot/, name);
  // the version must carry the base modes exactly (an app without the pay data, or with one too many): refused, nothing saved
  const r0 = await srv.rev();
  const without = run(c, `(function(){ var p=_bc.data.pay; _bc.data.pay=JSON.parse(JSON.stringify(p)); delete _bc.data.pay.ken; var r=bcBuild('${Q}', kbCfg(), {}, [], false); _bc.data.pay=p; return r.sn || r.err; })()`);
  assert.equal(typeof without, 'object', String(without));
  assert.equal(without.people.ken.mode, undefined);
  assert.equal(await chk(without), '0', 'the numbers add up by themselves');
  assert.equal((await srv.direct('gm', { action: 'save', quarter: Q, expect_rev: r0, kind: 'provisional', snap: without, why: '' })).body.error, 'pay_mismatch');
  const extra = run(c, `(function(){ var p=_bc.data.pay; _bc.data.pay=JSON.parse(JSON.stringify(p)); _bc.data.pay.aki={ b: true }; var r=bcBuild('${Q}', kbCfg(), {}, [], false); _bc.data.pay=p; return r.sn || r.err; })()`);
  assert.equal(extra.people.aki.mode, 'base');
  assert.equal((await srv.direct('gm', { action: 'save', quarter: Q, expect_rev: r0, kind: 'provisional', snap: extra, why: '' })).body.error, 'pay_mismatch');
  assert.equal(await srv.rev(), r0, 'nothing written');
});
