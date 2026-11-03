// v1132 work-requests 2 段目の画面：本物の画面のコード（index.html の FUNERGY_WR）を VM で、本物の handler と SQL（1 段目＋2 段目・PGlite）へ。
// スキル・Career Score・Tip Rate の正式な値の書き込みは、アプリの関数の代わり（合成データ）で記録する。
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
  + fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8');
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
    applyTipRaise: async () => { const n = dom.els['tipraise-name'].value, r = +dom.els['tipraise-rate'].value, f = dom.els['tipraise-from'].value;
      calls.push(['raise', n, r, f]); cloud.tips.push({ id: 'tip' + Date.now(), name: n, rate: r, status: '承認', fromDay: f, decAt: Date.now() }); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { ctx.renderWrTab(); await settle(); return ctx.renderWrTab(); };
  return { ctx, dom, toasts, notifs, calls, settle, render, cloud, S: () => ctx._wrState() };
}

test('skill: a G4 asks from the skill editor (only the changed positions); the GM approves and the level is applied once', async () => {
  const srv = await server(), cloud = shared();
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  assert.equal(g4.ctx.wrIsG4Live(), true);
  g4.dom.els['ssk-p_Grill'] = { value: '2' }; g4.dom.els['ssk-p_Floor'] = { value: '0' }; g4.dom.els['ssk-reason'] = { value: '' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  assert.ok(g4.toasts.some(t => /理由/.test(t[1])), 'a reason is needed');
  g4.dom.els['ssk-reason'].value = 'グリルを一人で回せる';
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  const row = (await srv.pg.query(`select code, status, payload from public.wr_requests where kind = 'skill'`)).rows[0];
  assert.equal(row.status, 'pending'); assert.deepEqual(row.payload.items, [{ pos: 'Grill', from: 1, to: 2 }]);
  assert.equal(g4.calls.filter(c => c[0] === 'skill').length, 0, 'asking changes nothing');
  assert.ok(g4.notifs.some(n => n.toRoles && n.toRoles.includes('gm')), 'the GM is told');
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  const id = (await srv.pg.query(`select id from public.wr_requests where kind = 'skill'`)).rows[0].id;
  gm.ctx.wrOpen(id); await gm.settle();
  assert.match(gm.dom.els['wr-detail'].innerHTML, /Grill.*?<b>2<\/b>/s);
  gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'applied');
  assert.deepEqual(cloud.skills.S1['Cam Crew'].Grill.level, 2); assert.equal(cloud.skills.S1['Cam Crew'].Grill.status, '承認');
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 1, 'written once');
  assert.match(gm.S().d.closed.reason, /Grill 1→2/);
});

test('Tip Rate: a G4 asks from the Tip Rate screen; the GM approves, checks on the raise screen and the apply is recorded', async () => {
  const srv = await server(), cloud = shared();
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.openTipRaiseModal(); await g4.settle();
  assert.equal(g4.calls.filter(c => c[0] === 'raiseModal').length, 0, 'the G4 gets the request form, not the raise screen');
  assert.ok(g4.dom.els['wrt-name'], 'request form');
  assert.deepEqual(g4.dom.els['wrt-from'].options.map(o => o.value), ['2026-11-16', '2026-11-01']);
  g4.dom.els['wrt-name'].value = 'Cam Crew'; g4.dom.els['wrt-rate'].value = '90'; g4.dom.els['wrt-reason'].value = 'ドリンクの説明が定着';
  await g4.ctx.wrTipAskGo(); await g4.settle();
  const tr = (await srv.pg.query(`select id, code, payload, effective_date::text e from public.wr_requests where kind = 'tiprate'`)).rows[0];
  assert.equal(tr.payload.rate_from, 80); assert.equal(tr.payload.rate_to, 90); assert.equal(tr.e, '2026-11-16');
  g4.ctx.approveTip('x'); await g4.ctx.applyTipRaise(); g4.ctx.submitSkillReview('sr1', 'approve');
  assert.equal(g4.calls.filter(c => c[0] === 'approveTip' || c[0] === 'raise' || c[0] === 'skillReview').length, 0, 'a G4 cannot approve, raise or decide a skill request directly');
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(tr.id); await gm.settle();
  gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'approved', 'approved; the raise screen is open for the check');
  assert.equal(gm.dom.els['tipraise-name'].value, 'Cam Crew'); assert.equal(gm.dom.els['tipraise-rate'].value, '90'); assert.equal(gm.dom.els['tipraise-from'].value, '2026-11-16');
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.deepEqual(gm.calls.filter(c => c[0] === 'raise'), [['raise', 'Cam Crew', 90, '2026-11-16']]);
  const st = (await srv.pg.query(`select status, close_reason from public.wr_requests where id = $1`, [tr.id])).rows[0];
  assert.equal(st.status, 'applied'); assert.match(st.close_reason, /Cam Crew 90%/);
  await gm.ctx.applyTipRaise(); await gm.settle();
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where request_id = $1 and action = 'apply'`, [tr.id])).rows[0].n, 1, 'recorded once');
});

test('Career Score: the G4’s score request becomes a CS request; only Work Center decides it; apply errors are recorded and retried', async () => {
  const srv = await server(), cloud = shared();
  cloud.lss.push({ id: 'lssq_1', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Sam Store', diff: [{ id: 'B-2', catName: '接客', label: 'お客様の名前', from: 3, to: 2 }], baseScore: 312, wantScore: 309, changeReason: '初動が遅れた' });
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.wrCsAsk(cloud.lss[0], 'Cam Crew'); await g4.settle();
  const cs = (await srv.pg.query(`select id, code, payload from public.wr_requests where kind = 'cs'`)).rows[0];
  assert.equal(cs.payload.lss_req, 'lssq_1'); assert.equal(cs.payload.items[0].to, 2); assert.equal(cloud.lss[0].wr, cs.code);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.approveLssScoreRequest('lssq_1');
  assert.equal(gm.calls.filter(c => c[0] === 'lssApprove').length, 0, 'the Career Score screen does not approve a Work Center request');
  // first apply fails: the score request is not on this device
  const keep = cloud.lss; cloud.lss = [];
  gm.ctx.wrOpen(cs.id); await gm.settle();
  gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'apply_error');
  assert.match(gm.dom.els['wr-detail'].innerHTML, /反映エラー/);
  cloud.lss = keep; cloud.refuse = true;
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'apply_error', 'the score request was not approved: recorded as an error, not as applied');
  cloud.refuse = false;
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'applied'); assert.equal(cloud.lss[0].status, '承認');
  assert.deepEqual(gm.calls.filter(c => c[0] === 'lssApprove'), [['lssApprove', 'lssq_1'], ['lssApprove', 'lssq_1']]);
});

test('before go-live nothing changes for a G4; the matrix view keeps my hidden people per store', async () => {
  const srv = await server(), cloud = shared();
  const old = await app(srv, 'E6', { role: 'am', realRole: 'g4', live: false, cloud });
  assert.equal(old.ctx.wrIsG4Live(), false);
  old.ctx.approveTip('x'); old.ctx.submitSkillReview('y'); old.ctx.openTipRaiseModal();
  assert.deepEqual(old.calls.map(c => c[0]), ['approveTip', 'skillReview', 'raiseModal']);
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  const staff = EMPS.filter(e => e.store === 'S1');
  let v = gm.ctx.wrMatrixView('S1', staff); await gm.settle();
  v = gm.ctx.wrMatrixView('S1', staff);
  assert.equal(v.shown.length, staff.length); assert.match(v.bar, /表示対象/);
  gm.ctx.wrViewEdit('S1');
  assert.match(gm.dom.els['wr-view'].innerHTML, /data-a="E8"/);
  gm.ctx.wrViewPick('E8', false); gm.ctx.wrViewSave(); await gm.settle();
  v = gm.ctx.wrMatrixView('S1', staff);
  assert.deepEqual(v.shown.map(e => e.id).includes('E8'), false); assert.match(v.bar, /非表示 1/);
  const other = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await other.render();
  other.ctx.wrMatrixView('S1', staff); await other.settle();
  assert.equal(other.ctx.wrMatrixView('S1', staff).shown.length, staff.length, 'someone else’s view is not changed');
});

test('the v1131 function (no fn in whoami) is reported as the earlier version, not as a bad value', async () => {
  const srv = await server(), cloud = shared();
  const old = { handler: async req => {
    const body = JSON.parse(await req.clone().text());
    if (body.action === 'submit' && ['skill', 'cs', 'tiprate'].includes(body.kind)) return new Response(JSON.stringify({ error: 'bad_value' }), { status: 400 });
    const res = await srv.handler(req); const j = await res.json();
    if (body.action === 'whoami') delete j.fn;
    return new Response(JSON.stringify(j), { status: res.status });
  } };
  const g4 = await app(old, 'E6', { role: 'am', realRole: 'g4', cloud });
  g4.dom.els['ssk-p_Grill'] = { value: '2' }; g4.dom.els['ssk-reason'] = { value: '理由' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  assert.ok(g4.toasts.some(t => /前の版（v1131）/.test(t[1])), JSON.stringify(g4.toasts));
  const now = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud });
  now.dom.els['ssk-p_Grill'] = { value: '9' }; now.dom.els['ssk-reason'] = { value: '理由' };
  await now.ctx.wrSkillAsk('Cam Crew', 'S1'); await now.settle();
  assert.ok(now.toasts.some(t => /入力の値/.test(t[1])) && !now.toasts.some(t => /前の版/.test(t[1])), 'a real bad value stays a bad value');
});

test('Tip Rate: saving a different rate or day on the raise screen is not recorded as this request; another GM applying first is no error', async () => {
  const srv = await server(), cloud = shared();
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.openTipRaiseModal(); await g4.settle();
  g4.dom.els['wrt-name'].value = 'Cam Crew'; g4.dom.els['wrt-rate'].value = '90'; g4.dom.els['wrt-reason'].value = 'r';
  await g4.ctx.wrTipAskGo(); await g4.settle();
  const id = (await srv.pg.query(`select id from public.wr_requests where kind = 'tiprate'`)).rows[0].id;
  const st = async () => (await srv.pg.query(`select status from public.wr_requests where id = $1`, [id])).rows[0].status;
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  gm.dom.els['tipraise-rate'].value = '100';
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(await st(), 'approved', 'a different rate is not this request');
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('apply'); await gm.settle();
  gm.dom.els['tipraise-from'].value = '2026-12-01';
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(await st(), 'approved', 'a different day is not this request');
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('apply'); await gm.settle();
  const ceo = (await srv.pg.query(`select rev from public.wr_requests where id = $1`, [id])).rows[0];
  const r = await srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', body: JSON.stringify({ pin_session: 'pin-E2', action: 'act', id, op: 'apply', expect_rev: ceo.rev, client_key: 'k-other-device-1', note: 'other device' }) }));
  assert.equal(r.status, 200);
  const before = gm.toasts.length;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(gm.toasts.slice(before).filter(t => t[0] === 'error').length, 0, 'already applied on another device: no error, no second record');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where request_id = $1 and action = 'apply'`, [id])).rows[0].n, 1);
});

test('a second ask for the same person adds to the open request (skills); another store’s open request stops it', async () => {
  const srv = await server({ pre: `update public.employees set support = '["S2"]' where id in ('E6','E8');` }), cloud = shared();
  cloud.skills.S2 = { 'Cam Crew': {} };
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  const ask = async (store, sel) => { g4.dom.els = Object.assign(g4.dom.els, { 'ssk-p_Grill': { value: '1' }, 'ssk-p_Floor': { value: '0' }, 'ssk-reason': { value: 'r' } }, sel); await g4.ctx.wrSkillAsk('Cam Crew', store); await g4.settle(); };
  await ask('S1', { 'ssk-p_Grill': { value: '2' } });
  await ask('S1', { 'ssk-p_Floor': { value: '1' } });
  let row = (await srv.pg.query(`select code, store_id, version, payload from public.wr_requests where kind = 'skill'`)).rows;
  assert.equal(row.length, 1); assert.equal(row[0].version, 2);
  assert.deepEqual(row[0].payload.items.map(i => i.pos + i.to).sort(), ['Floor1', 'Grill2'], 'the earlier position is kept');
  const before = g4.toasts.length;
  await ask('S2', { 'ssk-p_Floor': { value: '3' } });
  row = (await srv.pg.query(`select store_id, version, payload from public.wr_requests where kind = 'skill'`)).rows;
  assert.equal(row.length, 1); assert.equal(row[0].store_id, 'S1'); assert.equal(row[0].version, 2, 'not replaced by another store');
  assert.ok(g4.toasts.slice(before).some(t => /ほかの店/.test(t[1])), JSON.stringify(g4.toasts.slice(before)));
});

test('apply checks the request again first; a Career Score request must point at the same person and values; close without applying', async () => {
  const srv = await server(), cloud = shared();
  cloud.lss.push({ id: 'lssq_self', kind: 'score', name: 'Sam Store', self: true, status: '申請中', by: 'Sam Store', diff: [{ id: 'B-2', from: 1, to: 3 }] });
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  // a crafted call: a request for Cam Crew that names the G4's own self-review
  const j = await g4.ctx.wrAPI({ action: 'submit', kind: 'cs', store_id: 'S1', client_key: 'k-crafted-000001', payload: { target_emp: 'E8', target_name: 'Cam Crew', reason: 'r', lss_req: 'lssq_self', items: [{ key: 'B-2', from: 1, to: 3 }] } });
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(j.id); await gm.settle(); gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'apply_error'); assert.equal(cloud.lss[0].status, '申請中', 'the self-review is not approved');
  assert.match(gm.dom.els['wr-detail'].innerHTML, /反映しないで閉じる/);
  gm.ctx.wrAsk('reject'); gm.dom.els['wr-note'] = { value: '中身が違う' }; gm.ctx.wrAskGo(); await gm.settle(); await gm.settle();
  assert.equal((await srv.pg.query(`select status from public.wr_requests where id = $1`, [j.id])).rows[0].status, 'rejected');
  // stale screen: another device applied first → this device writes nothing
  g4.dom.els['ssk-p_Grill'] = { value: '2' }; g4.dom.els['ssk-reason'] = { value: 'r' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  const sk = (await srv.pg.query(`select id, rev from public.wr_requests where kind = 'skill'`)).rows[0];
  const h = (body) => srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', body: JSON.stringify({ pin_session: 'pin-E2', ...body }) })).then(r => r.json());
  const ap = await h({ action: 'act', id: sk.id, op: 'approve', expect_rev: sk.rev, client_key: 'k-other-000001' });
  gm.ctx.wrOpen(sk.id); await gm.settle();
  await h({ action: 'act', id: sk.id, op: 'apply', expect_rev: ap.rev, client_key: 'k-other-000002', note: 'other device' });
  gm.ctx.wrAsk('apply'); await gm.settle(); await gm.settle();
  assert.equal(gm.calls.filter(c => c[0] === 'skill').length, 0, 'nothing written from the stale screen');
  assert.ok(gm.toasts.some(t => /先に進めました/.test(t[1])));
});

test('G4 by title (a Store Manager whose role is sl) is stopped too; a G3, the AM and before go-live are not; the matrix bar waits for go-live', async () => {
  const srv = await server(), cloud = shared();
  const sm = await app(srv, 'E6', { role: 'sl', realRole: 'sl', cloud });
  assert.equal(sm.ctx.wrIsG4Live(), true);
  sm.ctx.approveTip('x'); assert.equal(sm.calls.filter(c => c[0] === 'approveTip').length, 0);
  const g3 = await app(srv, 'E7', { role: 'sl', realRole: 'sl', cloud });
  assert.equal(g3.ctx.wrIsG4Live(), false);
  const am = await app(srv, 'E5', { role: 'am', realRole: 'am', cloud });
  assert.equal(am.ctx.wrIsG4Live(), false);
  const pre = await app(srv, 'E6', { role: 'sl', realRole: 'sl', cloud, live: false });
  assert.equal(pre.ctx.wrIsG4Live(), false);
  assert.equal(pre.ctx.wrMatrixView('S1', EMPS), null, 'no view bar before go-live');
});

test('Tip Rate: an older decision with the same rate (even one dated ahead) is not taken as this save', async () => {
  const srv = await server(), cloud = shared();
  cloud.tips.push({ id: 'tip-old', name: 'Cam Crew', rate: 90, status: '承認', fromDay: '2026-11-16', decAt: Date.now() + 3600e3 });
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  cloud.tips = []; // the G4 sees 80 now; the old decision comes back on the GM's device
  g4.ctx.openTipRaiseModal(); await g4.settle();
  g4.dom.els['wrt-name'].value = 'Cam Crew'; g4.dom.els['wrt-rate'].value = '90'; g4.dom.els['wrt-reason'].value = 'r';
  await g4.ctx.wrTipAskGo(); await g4.settle();
  cloud.tips.push({ id: 'tip-old', name: 'Cam Crew', rate: 90, status: '承認', fromDay: '2026-11-16', decAt: Date.now() + 3600e3 });
  const id = (await srv.pg.query(`select id from public.wr_requests where kind = 'tiprate'`)).rows[0].id;
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  gm.dom.els['tipraise-rate'].value = '100';
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal((await srv.pg.query(`select status from public.wr_requests where id = $1`, [id])).rows[0].status, 'approved');
});

test('the real Career Score approval lets the CEO apply a Work Center request (the server checked the approval), and still refuses otherwise', () => {
  const src = html.slice(html.indexOf('function approveLssScoreRequest(id){'), html.indexOf('/* ★v999: 却下。'));
  const mk = (wrApplying, reqWr) => {
    const reqs = [{ id: 'q1', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Sam Store', wr: reqWr, diff: [{ id: 'B-2', to: 2 }] }];
    const toasts = [], saved = [];
    const c = { window: {}, getLssRequests: () => reqs, _srPending: r => r.status === '申請中', lssCanApproveScoreFor: () => false, lssReqByMe: () => false, lssScoreSetNg: () => false,
      getLssScores: () => ({ scores: { 'B-2': 3 } }), lssSummary: () => ({ totalPct: 50, totalScore: 10, totalMax: 20 }), setLssScores: (n, v) => saved.push(v), ls: (k, d) => d, lsSet: () => true,
      addNotif: () => {}, showToast: (m) => toasts.push(m), renderPage: () => {}, todayJP: () => '2026/11/02', lssApproverName: () => 'Cora CEO', t: a => a, ROLE_CONFIG: {}, curRole: 'ceo', curUserName: 'Cora CEO', lssItemSetOf: () => 'general' };
    c.window._wrApplying = wrApplying; vm.createContext(c); vm.runInContext(src, c); c.approveLssScoreRequest('q1');
    return { status: reqs[0].status, saved: saved.length, toasts };
  };
  assert.deepEqual(mk('CS-2611-0001', 'CS-2611-0001').status, '承認', 'applying the Work Center request it belongs to');
  assert.equal(mk(null, 'CS-2611-0001').status, '申請中', 'not applying: the usual check (only the GM)');
  assert.equal(mk('CS-2611-0002', 'CS-2611-0001').status, '申請中', 'another request’s code does not open it');
});

test('Career Score apply refuses each mismatch on its own: another person, a self-review, other values', async () => {
  const srv = await server(), cloud = shared();
  cloud.lss.push({ id: 'q-other', kind: 'score', name: 'Lee Leader', status: '申請中', by: 'Sam Store', diff: [{ id: 'B-2', from: 1, to: 3 }] },
    { id: 'q-self', kind: 'score', name: 'Cam Crew', self: true, status: '申請中', by: 'Cam Crew', diff: [{ id: 'B-2', from: 1, to: 3 }] },
    { id: 'q-vals', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Sam Store', diff: [{ id: 'B-2', from: 1, to: 2 }] });
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  let n = 0;
  for (const lss of ['q-other', 'q-self', 'q-vals']) {
    const j = await g4.ctx.wrAPI({ action: 'submit', kind: 'cs', store_id: 'S1', client_key: 'k-crafted-00000' + (++n), payload: { target_emp: 'E8', target_name: 'Cam Crew', reason: 'r', lss_req: lss, items: [{ key: 'B-2', from: 1, to: 3 }] } });
    gm.ctx.wrOpen(j.id); await gm.settle(); gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
    assert.equal(gm.S().d.status, 'apply_error', lss);
    gm.ctx.wrAsk('reject'); gm.dom.els['wr-note'] = { value: 'x' }; gm.ctx.wrAskGo(); await gm.settle(); await gm.settle();
  }
  assert.deepEqual(cloud.lss.map(q => q.status), ['申請中', '申請中', '申請中']);
  assert.equal(gm.calls.filter(c => c[0] === 'lssApprove').length, 0);
});

test('a v1132 function on the stage-1 SQL says so (not “check the values”)', async () => {
  const srv = await server(), cloud = shared();
  const stage1 = { handler: async req => {
    const body = JSON.parse(await req.clone().text());
    if (body.action === 'submit' && ['skill', 'cs', 'tiprate'].includes(body.kind)) return new Response(JSON.stringify({ error: 'bad_value' }), { status: 400 });
    const res = await srv.handler(req); const j = await res.json();
    if (body.action === 'whoami') j.sql = 1;
    return new Response(JSON.stringify(j), { status: res.status });
  } };
  const g4 = await app(stage1, 'E6', { role: 'am', realRole: 'g4', cloud });
  g4.dom.els['ssk-p_Grill'] = { value: '2' }; g4.dom.els['ssk-reason'] = { value: 'r' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  assert.ok(g4.toasts.some(t => /1 段目（v1131）のまま/.test(t[1])), JSON.stringify(g4.toasts));
});
