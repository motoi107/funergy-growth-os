// v1133 反映の押さえ（#124 の Codex のレビュー P2 の再現と回帰）：本物の画面のコード（index.html の FUNERGY_WR）を VM で、本物の handler と SQL（1 段目＋2 段目＋v1133・PGlite）へ。
// 下の土台は tests/work-requests-eval-ui.test.mjs と同じ（正式な値の書き込みは合成の代わりで記録する）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* ==== FUNERGY_WR（v1131'), html.indexOf('/* ==== FUNERGY_WR end ==== */'));
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8') + '\n'
  + fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8') + '\n'
  + fs.readFileSync(new URL('../supabase/migrations/20261106090000_work_requests_apply_claim.sql', import.meta.url), 'utf8');
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'sl', 'Kitchen Leader', 'S2', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const EMPS = PEOPLE.map(([id, name, role, title, store]) => ({ id, name, role, title, store, support: [], status: '在籍' }));

async function server({ pre = '' } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  if (pre) await pg.exec(pre);
  await pg.exec(MIG);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  return { pg, handler };
}

function fakeDom() {
  const els = {};
  const mk = id => { let ih = ''; return { id, value: '', checked: false, options: [], get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); }, insertAdjacentHTML(_w, h) { ih = h + ih; } }; };
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tagName, a1, id, a2] = m, attrs = a1 + a2, el = els[id] || (els[id] = mk(id));
      if (tagName === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? v[1] : ''; el.checked = /\bchecked\b/.test(attrs); }
      if (tagName === 'select') { const rest = h.slice(m.index); const body = rest.slice(0, rest.indexOf('</select>'));
        el.options = [...body.matchAll(/<option value="([^"]*)"/g)].map(x => ({ value: x[1] }));
        const sel = /<option value="([^"]*)"[^>]*selected/.exec(body) || /<option value="([^"]*)"/.exec(body); el.value = sel ? sel[1] : ''; }
      if (tagName === 'textarea') { const rest = h.slice(m.index + m[0].length); el.value = rest.slice(0, rest.indexOf('</textarea>')); }
    }
  };
  return { els, parse, mk };
}

// 正式な値の代わり（スキル・Career Score・Tip Rate）。2 つの端末で同じものを見る（クラウドの代わり）
function shared() {
  return { skills: { S1: { 'Cam Crew': { Grill: { level: 1, status: '承認' } } } }, lss: [], scores: { 'Cam Crew': { scores: { 'B-2': 3 } } }, tips: [], history: [] };
}

async function app(srv, emp, { role = 'gm', realRole = '', live = true, cloud = shared(), user = '' } = {}) {
  const dom = fakeDom(), toasts = [], notifs = [], calls = [];
  const storage = new Map(); if (live) storage.set('_wr_live_v1', '1');
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: f => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: 'pin-' + emp,
    curPage: 'tasks', workTab: 'wr', curRole: role, curRealRole: realRole, curUserName: user || NAME[emp], curStoreLogin: false,
    empGradeNum: e => { const g = ({ 'Store Manager': 'G4', 'Server Leader': 'G3', 'Kitchen Leader': 'G3', Crew: 'G1', 'Area Manager': 'G5', 'General Manager': 'G6' })[e.title] || ''; return g ? +g.slice(1) : 0; }, STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: ja => ja, bizNow: () => new Date('2026-11-02T10:00:00'), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: () => {}, go: p => calls.push(['go', p]), showToast: (m, k) => toasts.push([k, m]), addNotif: n => notifs.push(n), getNotifs: () => notifs,
    openModal: h => dom.parse(h), closeModalDirect: () => {}, confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['tasks'] }],
    ls: (k, d) => (k === 'tip_requests' ? cloud.tips : d), lsSet: (k, v) => { if (k === 'tip_requests') cloud.tips = v; if (k === 'lss_requests') cloud.lss = v; return true; },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: async (url, init) => srv.handler(new Request(url, init)),
    document: { getElementById: id => dom.els[id] || null, createElement: () => ({}) },
    todayJP: () => '2026/11/02', getEmployees: () => EMPS, isTipEligibleRole: () => true, isStoreStaff: () => true, empWorksAt: (e, s) => e.store === s,
    visibleStaffForManager: () => EMPS, empGrade: e => ({ 'Store Manager': 'G4', 'Server Leader': 'G3', 'Kitchen Leader': 'G3', Crew: 'G1' })[e.title] || '',
    getStorePositions: () => ['Grill', 'Floor'], skillPosId: p => 'p_' + p, SKILL_STORE_PREFIX: 'skills_st_', pullOpKey: async () => true,
    getEmpSkillsStore: (n, s) => JSON.parse(JSON.stringify(((cloud.skills[s] || {})[n]) || {})),
    setEmpSkillStore: (n, s, p, d) => { calls.push(['skill', n, s, p, d]); ((cloud.skills[s] = cloud.skills[s] || {})[n] = cloud.skills[s][n] || {})[p] = d; },
    addSkillHistory: (...a) => cloud.history.push(a),
    getLssRequests: () => cloud.lss, getLssScores: n => cloud.scores[n] || null, LSS_EMP_PREFIX: 'lss_emp_',
    approveLssScoreRequest: id => { calls.push(['lssApprove', id]); if (cloud.refuse) return; const q = cloud.lss.find(x => x.id === id); if (q) q.status = '承認'; },
    rejectLssScoreRequest: id => calls.push(['lssReject', id]),
    effectiveTipRate: n => { const d = cloud.tips.filter(x => x.name === n && x.status === '承認').pop(); return d ? d.rate : 80; },
    tipFromRange: () => ({ cur: '2026-11-01', min: '2026-10-16', max: '2027-11-02', today: '2026-11-02' }),
    approveTip: (...a) => calls.push(['approveTip', ...a]),
    submitSkillReview: (...a) => calls.push(['skillReview', ...a]),
    openTipRaiseModal: () => { calls.push(['raiseModal']); dom.parse('<select id="tipraise-name"><option value="Cam Crew">Cam</option></select><select id="tipraise-rate"><option value="80"></option><option value="90"></option><option value="100"></option></select><input id="tipraise-from" value=""><div id="tipraise-preview"></div>'); },
    tipRaisePreview: () => {},
    applyTipRaise: async () => { if (cloud.raiseWait) await cloud.raiseWait; if (cloud.raiseSkip) return; const n = dom.els['tipraise-name'].value, r = +dom.els['tipraise-rate'].value, f = dom.els['tipraise-from'].value;
      calls.push(['raise', n, r, f]); cloud.tips.push({ id: 'tip' + Date.now() + '_' + cloud.tips.length, name: n, rate: r, status: '承認', fromDay: f, decAt: Date.now() }); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { ctx.renderWrTab(); await settle(); return ctx.renderWrTab(); };
  return { ctx, dom, toasts, notifs, calls, settle, render, cloud, S: () => ctx._wrState() };
}

const gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; };
const H = srv => (who, body) => srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })).then(async r => ({ status: r.status, body: await r.json() }));
async function skillApproved(srv, cloud) {
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.dom.els['ssk-p_Grill'] = { value: '2' }; g4.dom.els['ssk-p_Floor'] = { value: '0' }; g4.dom.els['ssk-reason'] = { value: 'グリル' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  const row = (await srv.pg.query(`select id, rev from public.wr_requests where kind = 'skill'`)).rows[0];
  const ap = await H(srv)('E2', { action: 'act', id: row.id, op: 'approve', expect_rev: row.rev, client_key: 'k-approve-00001' });
  return ap.body;
}
async function tipApprovedOpen(srv, cloud) {
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.openTipRaiseModal(); await g4.settle();
  g4.dom.els['wrt-name'].value = 'Cam Crew'; g4.dom.els['wrt-rate'].value = '90'; g4.dom.els['wrt-reason'].value = 'r';
  await g4.ctx.wrTipAskGo(); await g4.settle();
  const id = (await srv.pg.query(`select id from public.wr_requests where kind = 'tiprate'`)).rows[0].id;
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  return { id, gm };
}
const status = async (srv, id) => (await srv.pg.query(`select status from public.wr_requests where id = $1`, [id])).rows[0].status;

test('skill (Codex P2-1): a close from another device during the slow read is refused; the value and the record match', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(r.id); await gm.settle();
  const g = gate(); gm.ctx.pullOpKey = () => g.p;
  gm.ctx.wrAsk('apply'); await gm.settle();
  const ceo = (await H(srv)('E2', { action: 'get', id: r.id })).body;
  assert.deepEqual(ceo.can, ['apply_done', 'apply_fail', 'apply_cancel'], 'the GM holds it (with the key on the first device only)');
  // the same GM on another device (no key) cannot close or record
  const close = await H(srv)('E2', { action: 'act', id: r.id, op: 'reject', expect_rev: ceo.rev, client_key: 'k-close-000001', note: '別の値にした' });
  assert.equal(close.status, 403, 'no close while someone applies');
  const old = await H(srv)('E2', { action: 'act', id: r.id, op: 'reject', expect_rev: r.rev, client_key: 'k-close-000002', note: '古い画面' });
  assert.equal(old.status, 409, 'a screen opened before the claim is behind');
  const rec = await H(srv)('E2', { action: 'act', id: r.id, op: 'apply_done', expect_rev: ceo.rev, client_key: 'k-close-000003', claim: 'k-guess-000001', note: 'x' });
  assert.equal(rec.status, 409, 'another device of the same GM has no key');
  g.open(true); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, r.id), 'applied'); assert.equal(cloud.skills.S1['Cam Crew'].Grill.level, 2, 'written and recorded together');
});

test('skill: closed on another device before the GM pressed apply → the old screen writes nothing', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(r.id); await gm.settle();
  const close = await H(srv)('E2', { action: 'act', id: r.id, op: 'reject', expect_rev: r.rev, client_key: 'k-close-000004', note: '別の値にした' });
  assert.equal(close.status, 200);
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0, 'nothing written from the closed request');
  assert.equal(cloud.skills.S1['Cam Crew'].Grill.level, 1);
  assert.ok(gm.toasts.some(t => /先に進めました/.test(t[1])), JSON.stringify(gm.toasts));
  assert.equal(gm.S().d.status, 'rejected', 'the latest is shown');
});

test('skill: two GM devices press apply at once → written once, the other device writes nothing', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const a = await app(srv, 'E2', { cloud }); await a.render();
  const b = await app(srv, 'E2', { cloud }); await b.render();
  a.ctx.wrOpen(r.id); b.ctx.wrOpen(r.id); await a.settle(); await b.settle();
  const g = gate(); a.ctx.pullOpKey = () => g.p;
  a.ctx.wrAsk('apply'); await a.settle();
  b.ctx.wrAsk('apply'); await b.settle(); await b.settle();
  g.open(true); await a.settle(); await a.settle();
  assert.equal(b.calls.filter(c => c[0] === 'skill').length, 0, 'the second device writes nothing');
  assert.equal(a.calls.filter(c => c[0] === 'skill').length, 1);
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where request_id = $1 and action = 'apply_done'`, [r.id])).rows[0].n, 1);
  assert.match(b.dom.els['wr-detail'].innerHTML, /反映しています|反映済み/, 'the second device shows who is applying (or that it is done)');
});

test('Career Score (Codex P2-2): the sign-in changes during the read → nothing approved, nothing written, no record', async () => {
  const srv = await server(), cloud = shared();
  cloud.lss.push({ id: 'lssq_2', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Sam Store', diff: [{ id: 'B-2', from: 3, to: 2 }] });
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.wrCsAsk(cloud.lss[0], 'Cam Crew'); await g4.settle();
  const cs = (await srv.pg.query(`select id, rev from public.wr_requests where kind = 'cs'`)).rows[0];
  assert.equal((await H(srv)('E2', { action: 'act', id: cs.id, op: 'approve', expect_rev: cs.rev, client_key: 'k-approve-00002' })).status, 200);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(cs.id); await gm.settle();
  const g = gate(); gm.ctx.pullOpKey = () => g.p;
  gm.ctx.wrAsk('apply'); await gm.settle();
  // the GM signs out; a crew member signs in on the same device
  gm.ctx.mrAuthKey = () => 'p|E8'; gm.ctx._hwSession = 'pin-E8'; gm.ctx.curRole = 'crew'; gm.ctx.curUserName = 'Cam Crew';
  g.open(true); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'lssApprove').length, 0, 'the score request is not approved under the next person');
  assert.equal(cloud.lss[0].status, '申請中');
  const st = (await srv.pg.query(`select status, apply_emp from public.wr_requests where id = $1`, [cs.id])).rows[0];
  assert.deepEqual(st, { status: 'approved', apply_emp: 'E2' }, 'still approved; the GM’s claim ends after 30 minutes');
});

test('Tip Rate (Codex P2-1): the raise screen is open, another device closes the request, then the old screen saves → no decision', async () => {
  const srv = await server(), cloud = shared();
  const { id, gm } = await tipApprovedOpen(srv, cloud);
  assert.equal(gm.dom.els['tipraise-rate'].value, '90', 'the raise screen is open');
  const cur = (await H(srv)('E2', { action: 'get', id })).body;
  assert.deepEqual(cur.can, ['apply_start', 'reject'], 'opening the screen does not hold the request');
  assert.equal((await H(srv)('E2', { action: 'act', id, op: 'reject', expect_rev: cur.rev, client_key: 'k-close-000010', note: '別の率にする' })).status, 200);
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'raise').length, 0, 'no Tip Rate decision from the closed request');
  assert.equal(cloud.tips.length, 0);
  assert.ok(gm.toasts.some(t => /先に進めました/.test(t[1])), JSON.stringify(gm.toasts));
  assert.equal(await status(srv, id), 'rejected');
});

test('Tip Rate: a save that writes nothing lets go; while the save runs nobody can close it; a lost record is finished without a second decision', async () => {
  const srv = await server(), cloud = shared();
  const { id, gm } = await tipApprovedOpen(srv, cloud);
  // 1) the save writes nothing (the dialog was closed or changed during the check): the claim is let go
  cloud.raiseSkip = true;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  let cur = (await H(srv)('E2', { action: 'get', id })).body;
  assert.deepEqual(cur.can, ['apply_start', 'reject'], 'free again: nothing changed');
  assert.ok(cur.events.some(e => e.action === 'apply_cancel'));
  // 2) during the save (a slow cloud check inside the raise), another device cannot close it
  cloud.raiseSkip = false; const g = gate(); cloud.raiseWait = g.p;
  const saving = gm.ctx.applyTipRaise(); await gm.settle();
  cur = (await H(srv)('E2', { action: 'get', id })).body;
  assert.deepEqual(cur.can, ['apply_done', 'apply_fail', 'apply_cancel'], 'held while saving (only the key holder can record)');
  assert.equal((await H(srv)('E2', { action: 'act', id, op: 'reject', expect_rev: cur.rev, client_key: 'k-close-000011', note: 'x' })).status, 403);
  // 3) the record after the decision does not arrive (network): the next press only records it
  const realFetch = gm.ctx.fetch; let drop = true;
  gm.ctx.fetch = async (url, init) => { const b = JSON.parse(init.body); if (drop && b.op === 'apply_done') { drop = false; throw new Error('offline'); } return realFetch(url, init); };
  g.open(true); await saving; await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'raise').length, 1, 'decided once');
  assert.equal(await status(srv, id), 'approved', 'not recorded yet');
  gm.ctx.wrOpen(id); await gm.settle();
  assert.match(gm.dom.els['wr-detail'].innerHTML, /この端末で反映しています/);
  assert.match(gm.dom.els['wr-detail'].innerHTML, /wrAsk\('apply'\)/, 'the button stays on this device (it holds the key)');
  const opened = gm.calls.filter(c => c[0] === 'raiseModal').length;
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, id), 'applied');
  assert.equal(gm.calls.filter(c => c[0] === 'raise').length, 1, 'no second decision');
  assert.equal(gm.calls.filter(c => c[0] === 'raiseModal').length, opened, 'the raise screen is not opened again just to record');
});

test('a v1132 function (fn 2) or the stage-2 SQL is reported by name when applying; nothing is written', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const wrap = (fn, sql, refuse) => ({ handler: async req => {
    const body = JSON.parse(await req.clone().text());
    if (body.action === 'act' && body.op === 'apply_start') return new Response(JSON.stringify({ error: refuse }), { status: refuse === 'forbidden' ? 403 : 400 });
    const res = await srv.handler(req); const j = await res.json();
    if (body.action === 'whoami') { j.fn = fn; j.sql = sql; }
    return new Response(JSON.stringify(j), { status: res.status });
  } });
  for (const [fn, sql, refuse, want] of [[2, 3, 'bad_value', /関数を v1133/], [3, 2, 'forbidden', /SQL（deploy\/work-requests-v1131-v1133/]]) {
    const gm = await app(wrap(fn, sql, refuse), 'E2', { cloud }); await gm.render();
    gm.ctx.wrOpen(r.id); await gm.settle(); gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
    assert.ok(gm.toasts.some(t => want.test(t[1])), JSON.stringify(gm.toasts));
    assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0);
  }
});

test('the v1132 app on the v1133 server applies nothing (no “apply” is offered any more)', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const cur = (await H(srv)('E2', { action: 'get', id: r.id })).body;
  assert.ok(!cur.can.includes('apply'), 'the v1132 screen checks for “apply” before writing; it is not there');
  assert.equal((await H(srv)('E2', { action: 'act', id: r.id, op: 'apply', expect_rev: cur.rev, client_key: 'k-v1132-000001', note: 'x' })).status, 400);
});

test('skill: the sign-in changes during the read → nothing written, no record', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(r.id); await gm.settle();
  const g = gate(); gm.ctx.pullOpKey = () => g.p;
  gm.ctx.wrAsk('apply'); await gm.settle();
  gm.ctx.mrAuthKey = () => 'p|E8'; gm.ctx._hwSession = 'pin-E8'; gm.ctx.curRole = 'crew'; gm.ctx.curUserName = 'Cam Crew';
  g.open(true); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0);
  assert.equal(cloud.skills.S1['Cam Crew'].Grill.level, 1);
  assert.equal(await status(srv, r.id), 'approved');
});

test('Tip Rate: an older decision with the same rate and day does not count as this save; nothing saved → let go, not “applied”', async () => {
  const srv = await server(), cloud = shared();
  const { id, gm } = await tipApprovedOpen(srv, cloud);
  cloud.tips.push({ id: 'tip-older', name: 'Cam Crew', rate: 90, status: '承認', fromDay: '2026-11-16', decAt: Date.now() - 60e3 });
  cloud.raiseSkip = true;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, id), 'approved', 'not recorded from the older decision');
  const ev = (await H(srv)('E2', { action: 'get', id })).body.events.map(e => e.action);
  assert.deepEqual(ev.slice(-2), ['apply_start', 'apply_cancel']);
});

/* ---------------------------------------------------------------- 独立レビュー（2f59713）の P2-A・P2-B・R4・R5 */
const dropAfter = (dev, op) => { const real = dev.ctx.fetch; let drop = true; dev.ctx.fetch = async (url, init) => { const b = JSON.parse(init.body); const res = await real(url, init); if (drop && b.op === op) { drop = false; throw new Error('offline after the server answered'); } return res; }; };

test('P2-A: the “apply” answer is lost, 30 minutes pass and another device closes it → pressing again writes nothing', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(r.id); await gm.settle();
  dropAfter(gm, 'apply_start');
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0, 'first press: the answer was lost, nothing written');
  await srv.pg.exec(`reset role; update public.wr_requests set apply_at = now() - interval '31 minutes' where id = '${r.id}'; set role service_role;`);
  const cur = (await H(srv)('E2', { action: 'get', id: r.id })).body;
  assert.equal((await H(srv)('E2', { action: 'act', id: r.id, op: 'reject', expect_rev: cur.rev, client_key: 'k-close-pa-0001', note: '別の値にした' })).status, 200);
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, r.id), 'rejected');
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0, 'nothing written for the closed request');
  assert.equal(cloud.skills.S1['Cam Crew'].Grill.level, 1);
});

test('P2-A: the “apply” answer is lost; pressing again within 30 minutes (same key) carries on and applies once', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(r.id); await gm.settle();
  dropAfter(gm, 'apply_start');
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  gm.ctx.wrOpen(r.id); await gm.settle();
  assert.match(gm.dom.els['wr-detail'].innerHTML, /この端末で反映しています/, 'refreshed: this device may carry on');
  assert.match(gm.dom.els['wr-detail'].innerHTML, /wrAsk\('apply'\)/);
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, r.id), 'applied');
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 1);
});

test('P2-A (server): a replayed apply_start answers only while that key still holds the request', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const k = 'k-replay-000001', h = H(srv);
  const first = await h('E2', { action: 'act', id: r.id, op: 'apply_start', expect_rev: r.rev, client_key: k });
  assert.equal(first.status, 200);
  assert.equal((await h('E2', { action: 'act', id: r.id, op: 'apply_start', expect_rev: r.rev, client_key: k })).status, 200, 'still held: the same answer');
  await srv.pg.exec(`reset role; update public.wr_requests set apply_at = now() - interval '31 minutes' where id = '${r.id}'; set role service_role;`);
  assert.equal((await h('E2', { action: 'act', id: r.id, op: 'apply_start', expect_rev: r.rev, client_key: k })).status, 409, 'stale: no longer an answer to rely on');
});

test('P2-B: the raise screen stays open more than 30 minutes; the save still holds the request first and records it once', async () => {
  const srv = await server(), cloud = shared();
  const { id, gm } = await tipApprovedOpen(srv, cloud);
  gm.S().tipApply.t0 -= 31 * 60000;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(await status(srv, id), 'applied', 'recorded (not a plain raise)');
  assert.equal(cloud.tips.length, 1);
  const ev = (await H(srv)('E2', { action: 'get', id })).body.events.map(e => e.action);
  assert.deepEqual(ev.slice(-2), ['apply_start', 'apply_done']);
});

test('R4: the same GM on another device took over a stale hold → this device sees it is no longer its hold and writes nothing', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const a = await app(srv, 'E2', { cloud }); await a.render();
  a.ctx.wrOpen(r.id); await a.settle();
  const realA = a.ctx.fetch; let drop = true;
  a.ctx.fetch = async (url, init) => { const b = JSON.parse(init.body); if (drop && b.op === 'apply_done') { drop = false; throw new Error('offline'); } return realA(url, init); };
  a.ctx.wrAsk('apply'); await a.settle(); await a.settle();
  assert.equal(await status(srv, r.id), 'approved');
  await srv.pg.exec(`reset role; update public.wr_requests set apply_at = now() - interval '31 minutes' where id = '${r.id}'; set role service_role;`);
  const b = await app(srv, 'E2', { cloud }); await b.render();
  b.ctx.wrOpen(r.id); await b.settle();
  const gB = gate(); b.ctx.pullOpKey = () => gB.p;
  b.ctx.wrAsk('apply'); await b.settle();
  a.ctx.wrOpen(r.id); await a.settle();
  assert.doesNotMatch(a.dom.els['wr-detail'].innerHTML, /この端末で反映しています/, 'not “this device”');
  const before = a.calls.filter(c => c[0] === 'skill').length;
  a.ctx.wrAsk('apply'); await a.settle(); await a.settle();
  assert.equal(a.calls.filter(c => c[0] === 'skill').length, before, 'A writes nothing while B holds it');
  gB.open(true); await b.settle(); await b.settle();
  assert.equal(await status(srv, r.id), 'applied');
});

test('R5: a raise screen opened directly from the Tip Rate page is not taken as the Work Center request', async () => {
  const srv = await server(), cloud = shared();
  const { id, gm } = await tipApprovedOpen(srv, cloud);
  const from = gm.dom.els['tipraise-from'].value;
  const cur = (await H(srv)('E2', { action: 'get', id })).body;
  assert.equal((await H(srv)('E2', { action: 'act', id, op: 'reject', expect_rev: cur.rev, client_key: 'k-close-r5-0001', note: 'x' })).status, 200);
  gm.ctx.openTipRaiseModal(); await gm.settle();
  gm.dom.els['tipraise-name'].value = 'Cam Crew'; gm.dom.els['tipraise-rate'].value = '90'; gm.dom.els['tipraise-from'].value = from;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(cloud.tips.length, 1, 'the direct raise goes through as before');
  assert.equal(await status(srv, id), 'rejected');
});

test('P2-A: this device still holds a hold older than 30 minutes → pressing again holds it anew, so a close during the read is refused', async () => {
  const srv = await server(), cloud = shared();
  const r = await skillApproved(srv, cloud);
  const a = await app(srv, 'E2', { cloud }); await a.render();
  a.ctx.wrOpen(r.id); await a.settle();
  const realA = a.ctx.fetch; let drop = true;
  a.ctx.fetch = async (url, init) => { const b = JSON.parse(init.body); if (drop && b.op === 'apply_done') { drop = false; throw new Error('offline'); } return realA(url, init); };
  a.ctx.wrAsk('apply'); await a.settle(); await a.settle();
  await srv.pg.exec(`reset role; update public.wr_requests set apply_at = now() - interval '31 minutes' where id = '${r.id}'; set role service_role;`);
  a.ctx.wrOpen(r.id); await a.settle();
  const g = gate(); a.ctx.pullOpKey = () => g.p;
  a.ctx.wrAsk('apply'); await a.settle();
  const cur = (await H(srv)('E2', { action: 'get', id: r.id })).body;
  assert.equal((await H(srv)('E2', { action: 'act', id: r.id, op: 'reject', expect_rev: cur.rev, client_key: 'k-close-sr-0001', note: '閉じる' })).status, 403, 'held anew: no close during the read');
  g.open(true); await a.settle(); await a.settle();
  assert.equal(await status(srv, r.id), 'applied');
});
