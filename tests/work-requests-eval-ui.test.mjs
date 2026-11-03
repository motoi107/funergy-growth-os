// v1132 work-requests 2 段目の画面：本物の画面のコード（index.html の FUNERGY_WR）を VM で、本物の handler と SQL（1 段目＋2 段目＋v1133 の反映の押さえ・PGlite）へ。
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
  + fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8') + '\n'
  + fs.readFileSync(new URL('../supabase/migrations/20261106090000_work_requests_apply_claim.sql', import.meta.url), 'utf8');
// v1135：UI案68 の答えの SQL も重ねる（server({ mig4:false }) で前の段）
const MIG4 = fs.readFileSync(new URL('../supabase/migrations/20261107090000_work_requests_ui68.sql', import.meta.url), 'utf8');
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'sl', 'Kitchen Leader', 'S2', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const EMPS = PEOPLE.map(([id, name, role, title, store]) => ({ id, name, role, title, store, support: [], status: '在籍' }));
// v1135：アプリの名簿だけにいる人（サーバーには入れない）：S2 の G2・肩書きが G3 の経理
EMPS.push({ id: 'E20', name: 'Gus Crewlead', role: 'g2', title: 'Crew Leader', store: 'S2', support: [], status: '在籍' },
  { id: 'E21', name: 'Ana Lead', role: 'office', title: 'Accounting Leader', store: 'OFFICE', support: [], status: '在籍' });

async function server({ pre = '', mig4 = true } = {}) {
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
  if (mig4) await pg.exec(MIG4);
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
    empGradeNum: e => { const g = ({ 'Store Manager': 'G4', 'Server Leader': 'G3', 'Kitchen Leader': 'G3', 'Crew Leader': 'G2', 'Accounting Leader': 'G3', Crew: 'G1', 'Area Manager': 'G5', 'General Manager': 'G6' })[e.title] || ''; return g ? +g.slice(1) : 0; }, STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
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
    // v1135：OJT の合格の自動反映（今までの関数の代わり：直接変えたら記録）と Career Score の評価表の代わり
    g2AutoReflect: (n, m) => calls.push(['direct', n, m && m.id]),
    lssCatsForName: () => [{ key: 'A', name: '営業準備', items: ['a1', 'a2', 'a3'] }, { key: 'B', name: '接客', items: ['b1', 'b2'] }],
    lssItemId: (k, i) => k + i, lssItemLabelFor: (_n, id) => ({ label: 'item ' + id }), lssItemSetOf: () => 'general',
    lssSummary: () => ({ totalScore: 10, totalMax: 15, totalPct: 67 }), _lssqId: () => 'lssq_ojt_' + (cloud.lss.length + 1),
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
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where request_id = $1 and action = 'apply_done'`, [tr.id])).rows[0].n, 1, 'recorded once');
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

test('before go-live nothing changes for a G4; 9B: the matrix view is one per store, set by the GM, seen by everyone', async () => {
  const srv = await server(), cloud = shared();
  const old = await app(srv, 'E6', { role: 'am', realRole: 'g4', live: false, cloud });
  assert.equal(old.ctx.wrIsG4Live(), false);
  old.ctx.approveTip('x'); old.ctx.submitSkillReview('y'); old.ctx.openTipRaiseModal();
  assert.deepEqual(old.calls.map(c => c[0]), ['approveTip', 'skillReview', 'raiseModal']);
  const staff = EMPS.filter(e => e.store === 'S1');
  // a G4 reads the store view but has no button (the GM decides)
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.wrMatrixView('S1', staff); await g4.settle();
  let v = g4.ctx.wrMatrixView('S1', staff);
  assert.equal(v.shown.length, staff.length); assert.doesNotMatch(v.bar, /wrViewEdit/, 'no button for a G4');
  g4.ctx.wrViewEdit('S1');
  assert.ok(g4.toasts.some(t => /GM・CEO が決めます/.test(t[1])) && !g4.dom.els['wr-view'], 'the editor does not open');
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  gm.ctx.wrMatrixView('S1', staff); await gm.settle();
  v = gm.ctx.wrMatrixView('S1', staff);
  assert.equal(v.shown.length, staff.length); assert.match(v.bar, /表示対象（店の設定）/);
  gm.ctx.wrViewEdit('S1');
  assert.match(gm.dom.els['wr-view'].innerHTML, /data-a="E8"/); assert.match(gm.dom.els['wr-view'].innerHTML, /全員の表示が変わります/);
  gm.ctx.wrViewPick('E8', false); gm.ctx.wrViewSave(); await gm.settle();
  assert.ok(gm.toasts.some(t => /店の全員に効きます/.test(t[1])));
  v = gm.ctx.wrMatrixView('S1', staff);
  assert.deepEqual(v.shown.map(e => e.id).includes('E8'), false); assert.match(v.bar, /非表示 1 人（GM が決めた店の表示）/);
  // everyone at the store sees the same (a G3, a G4 that opens it again, the CEO's screen)
  for (const [emp, role, real] of [['E7', 'sl', ''], ['E6', 'am', 'g4'], ['E5', 'am', 'am']]) {
    const x = await app(srv, emp, { role, realRole: real, cloud }); await x.render();
    x.ctx.wrMatrixView('S1', staff); await x.settle();
    assert.deepEqual(x.ctx.wrMatrixView('S1', staff).shown.map(e => e.id).includes('E8'), false, emp + ' sees the store view');
  }
  // another GM screen that read the view earlier: its save is stopped and the latest is read again
  const gm2 = await app(srv, 'E2', { cloud }); await gm2.render();
  gm2.ctx._wrState().views = { S1: { load:'done', hidden:[], rev:0, can:true } };
  gm2.ctx.wrViewEdit('S1'); gm2.ctx.wrViewPick('E7', false); gm2.ctx.wrViewSave(); await gm2.settle();
  assert.ok(gm2.toasts.some(t => /先にこの店の表示を変えました/.test(t[1])), JSON.stringify(gm2.toasts));
  const row = (await srv.pg.query(`select hidden, rev from public.wr_store_views where store_id = 'S1'`)).rows[0];
  assert.deepEqual(row, { hidden: ['E8'], rev: 1 }, 'the older screen did not overwrite');
});

test('9B before the v1135 SQL: the view is not used (everyone shown, no button)', async () => {
  const srv = await server({ mig4: false }), cloud = shared();
  const staff = EMPS.filter(e => e.store === 'S1');
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  assert.equal(gm.ctx.wrMatrixView('S1', staff) && gm.ctx.wrMatrixView('S1', staff).shown.length, staff.length);
  await gm.settle();
  assert.equal(gm.ctx.wrMatrixView('S1', staff), null, 'no store mark → the view is off');
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
  assert.ok(g4.toasts.some(t => /前の版です/.test(t[1])), JSON.stringify(g4.toasts));
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
  assert.ok(!(await srv.pg.query(`select action from public.wr_events where request_id = $1`, [id])).rows.some(x => x.action === 'apply_start'), 'v1133: and it does not hold the request');
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('apply'); await gm.settle();
  gm.dom.els['tipraise-from'].value = '2026-12-01';
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(await st(), 'approved', 'a different day is not this request');
  gm.ctx.wrOpen(id); await gm.settle(); gm.ctx.wrAsk('apply'); await gm.settle();
  const ceo = (await srv.pg.query(`select rev from public.wr_requests where id = $1`, [id])).rows[0];
  const h = body => srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', body: JSON.stringify({ pin_session: 'pin-E2', ...body }) }));
  const st1 = await (await h({ action: 'act', id, op: 'apply_start', expect_rev: ceo.rev, client_key: 'k-other-device-0' })).json();
  const r = await h({ action: 'act', id, op: 'apply_done', expect_rev: st1.rev, client_key: 'k-other-device-1', claim: 'k-other-device-0', note: 'other device' });
  assert.equal(r.status, 200);
  const before = gm.toasts.length, raised = gm.calls.filter(c => c[0] === 'raise').length;
  await gm.ctx.applyTipRaise(); await gm.settle(); await gm.settle();
  assert.equal(gm.toasts.slice(before).filter(t => t[0] === 'error').length, 0, 'already applied on another device: no error, no second record');
  assert.equal(gm.calls.filter(c => c[0] === 'raise').length, raised, 'v1133: and no second Tip Rate decision either');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where request_id = $1 and action = 'apply_done'`, [id])).rows[0].n, 1);
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
  const st2 = await h({ action: 'act', id: sk.id, op: 'apply_start', expect_rev: ap.rev, client_key: 'k-other-000003' });
  await h({ action: 'act', id: sk.id, op: 'apply_done', expect_rev: st2.rev, client_key: 'k-other-000002', claim: 'k-other-000003', note: 'other device' });
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
  const mk = (wrApplying, reqWr, role = 'ceo') => {
    const reqs = [{ id: 'q1', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Sam Store', wr: reqWr, diff: [{ id: 'B-2', to: 2 }] }];
    const toasts = [], saved = [];
    const c = { window: {}, getLssRequests: () => reqs, _srPending: r => r.status === '申請中', lssCanApproveScoreFor: () => false, lssReqByMe: () => false, lssScoreSetNg: () => false,
      getLssScores: () => ({ scores: { 'B-2': 3 } }), lssSummary: () => ({ totalPct: 50, totalScore: 10, totalMax: 20 }), setLssScores: (n, v) => saved.push(v), ls: (k, d) => d, lsSet: () => true,
      addNotif: () => {}, showToast: (m) => toasts.push(m), renderPage: () => {}, todayJP: () => '2026/11/02', lssApproverName: () => 'Cora CEO', t: a => a, ROLE_CONFIG: {}, curRole: role, curUserName: 'Cora CEO', lssItemSetOf: () => 'general' };
    c.window._wrApplying = wrApplying; vm.createContext(c); vm.runInContext(src, c); c.approveLssScoreRequest('q1');
    return { status: reqs[0].status, saved: saved.length, toasts };
  };
  assert.deepEqual(mk('CS-2611-0001', 'CS-2611-0001').status, '承認', 'applying the Work Center request it belongs to');
  assert.equal(mk(null, 'CS-2611-0001').status, '申請中', 'not applying: the usual check (only the GM)');
  assert.equal(mk('CS-2611-0002', 'CS-2611-0001').status, '申請中', 'another request’s code does not open it');
  assert.equal(mk('CS-2611-0001', 'CS-2611-0001', 'crew').status, '申請中', 'v1133: the code alone does not open it when the sign-in is not a GM or the CEO');
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
  assert.ok(g4.toasts.some(t => /前の段のまま/.test(t[1])), JSON.stringify(g4.toasts));
});

test('6 (v1135): a G3 asks the GM for a Tip Rate and a Career Score change; a G3 cannot raise or decide; others are not G3', async () => {
  const srv = await server(), cloud = shared();
  const g3 = await app(srv, 'E7', { role: 'sl', cloud }); await g3.render();
  assert.deepEqual([g3.ctx.wrIsG3Live(), g3.ctx.wrIsG4Live(), g3.ctx.wrCanAskLive()], [true, false, true]);
  g3.ctx.openTipRaiseModal(); await g3.settle();
  assert.equal(g3.calls.filter(c => c[0] === 'raiseModal').length, 0, 'the G3 gets the request form, not the raise screen');
  assert.deepEqual(g3.dom.els['wrt-name'].options.map(o => o.value), ['Cam Crew'], 'only people below G3 at their store');
  g3.dom.els['wrt-name'].value = 'Cam Crew'; g3.dom.els['wrt-rate'].value = '90'; g3.dom.els['wrt-reason'].value = 'ドリンクの説明が定着';
  await g3.ctx.wrTipAskGo(); await g3.settle();
  const tr = (await srv.pg.query(`select requester_emp, status, payload from public.wr_requests where kind = 'tiprate'`)).rows[0];
  assert.deepEqual([tr.requester_emp, tr.status, tr.payload.rate_to], ['E7', 'pending', 90]);
  g3.ctx.approveTip('x'); await g3.ctx.applyTipRaise();
  assert.equal(g3.calls.filter(c => c[0] === 'approveTip' || c[0] === 'raise').length, 0, 'a G3 does not decide or raise a Tip Rate');
  cloud.lss.push({ id: 'lssq_g3', kind: 'score', name: 'Cam Crew', status: '申請中', by: 'Lee Leader', diff: [{ id: 'A0', catName: '営業準備', label: 'a1', from: 1, to: 2 }], changeReason: 'OJT' });
  g3.ctx.wrCsAsk(cloud.lss[0], 'Cam Crew'); await g3.settle();
  const cs = (await srv.pg.query(`select code, requester_emp from public.wr_requests where kind = 'cs'`)).rows[0];
  assert.equal(cs.requester_emp, 'E7'); assert.equal(cloud.lss[0].wr, cs.code);
  g3.ctx.submitSkillReview('sr1', 'approve');
  assert.equal(g3.calls.filter(c => c[0] === 'skillReview').length, 1, 'skill reviews stay as before for a G3 (only the G4 is stopped)');
  for (const [emp, role, real, user] of [['E6', 'am', 'g4'], ['E5', 'am', 'am'], ['E2', 'gm', 'gm'], ['E8', 'crew', ''], ['E20', 'g2', '', 'Gus Crewlead'], ['E21', 'office', 'office', 'Ana Lead']]) {
    const x = await app(srv, emp, { role, realRole: real, cloud, user });
    assert.equal(x.ctx.wrIsG3Live(), false, emp + ' is not a G3 (a G2; accounting with a G3 title)');
  }
  const pre = await app(srv, 'E7', { role: 'sl', live: false, cloud });
  assert.equal(pre.ctx.wrCanAskLive(), false, 'not before go-live'); assert.equal(pre.ctx.wrIsG3Live(), false);
  pre.ctx.openTipRaiseModal();
  assert.equal(pre.calls.filter(c => c[0] === 'raiseModal').length, 1, 'before go-live the screens are as before');
});

test('6 (v1135): a G3 asking before the v1135 SQL is told the database is older', async () => {
  const srv = await server({ mig4: false }), cloud = shared();
  const g3 = await app(srv, 'E7', { role: 'sl', cloud });
  g3.ctx.openTipRaiseModal(); await g3.settle();
  g3.dom.els['wrt-name'].value = 'Cam Crew'; g3.dom.els['wrt-rate'].value = '90'; g3.dom.els['wrt-reason'].value = 'r';
  await g3.ctx.wrTipAskGo(); await g3.settle();
  assert.ok(g3.toasts.some(t => /v1135 の SQL/.test(t[1])), JSON.stringify(g3.toasts));
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud });
  g4.dom.els['ssk-p_Grill'] = { value: '3' }; g4.dom.els['ssk-reason'] = { value: '理由' };
  await g4.ctx.wrSkillAsk('Cam Crew', 'S1'); await g4.settle();
  assert.ok(!g4.toasts.some(t => /v1135 の SQL/.test(t[1])), 'a G4 asks as before on the v1133 SQL');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_requests where kind = 'skill'`)).rows[0].n, 1);
});

test('OJT (Moto 11/03): a pass signed by a G3, a G4 or an AM asks the GM; the GM or CEO signing and before go-live change directly', async () => {
  const srv = await server(), cloud = shared();
  const mod = { id: 'm5', no: 5, axis: 'A', title: 'マルチタスク', reflect: { skill: 'multi', axisFloor: 2 } };
  cloud.skills.S1['Cam Crew'].Floor = { level: 3, status: '承認' };   /* もう 2 以上：上げない */
  cloud.scores['Cam Crew'].scores.A1 = 3;                            /* もう下限以上：申請しない */
  const g3 = await app(srv, 'E7', { role: 'sl', cloud }); await g3.render();
  g3.ctx.g2AutoReflect('Cam Crew', mod); await g3.settle(); await g3.settle();
  assert.equal(g3.calls.filter(c => c[0] === 'direct').length, 0, 'nothing is changed directly');
  assert.equal(g3.calls.filter(c => c[0] === 'skill').length, 0);
  const rows = (await srv.pg.query(`select kind, code, status, requester_emp, payload, rev from public.wr_requests order by kind`)).rows;
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.requester_emp]), [['cs', 'pending', 'E7'], ['skill', 'pending', 'E7']]);
  const sk = rows.find(r => r.kind === 'skill'), cs = rows.find(r => r.kind === 'cs');
  assert.deepEqual(sk.payload.items, [{ pos: 'Grill', from: 1, to: 2 }]); assert.match(sk.payload.reason, /OJT 合格の自動反映：M5 マルチタスク（サイン：Lee Leader）/);
  assert.deepEqual(cs.payload.items.map(i => [i.key, i.from, i.to]), [['A0', null, 2], ['A2', null, 2]]);
  const q = cloud.lss.find(x => x.id === cs.payload.lss_req);
  assert.equal(q.status, '申請中'); assert.equal(q.wr, cs.code); assert.deepEqual(JSON.parse(JSON.stringify(q.ojt)), { axis: 'A', floor: 2 });
  assert.deepEqual([q.baseScore, q.wantScore, q.wantMax], [10, 14, 15], 'the totals for the GM screen');
  assert.ok(g3.toasts.some(t => t[0] === 'success' && /OJT の合格で上がる分を GM に申請しました/.test(t[1])));
  // another pass while both are open: the skill request already has the position (nothing new); Career Score is not replaced → the GM is told; the score request stays for the GM
  const mod2 = { id: 'm6', no: 6, axis: 'B', title: '接客', reflect: { skill: 'multi', axisFloor: 2 } };
  g3.ctx.g2AutoReflect('Cam Crew', mod2); await g3.settle(); await g3.settle();
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_requests`)).rows[0].n, 2, 'no second request');
  const sk2 = (await srv.pg.query(`select rev, payload from public.wr_requests where kind = 'skill'`)).rows[0];
  assert.equal(sk2.rev, sk.rev); assert.doesNotMatch(sk2.payload.reason, /M6/, 'nothing new for the skill request: it is not edited');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_versions v join public.wr_requests r on r.id = v.request_id where r.kind = 'skill'`)).rows[0].n, 1);
  const told = g3.notifs.filter(n => /OJT の合格の反映を GM に申請できませんでした/.test(n.title || ''));
  assert.equal(told.length, 1); assert.deepEqual([...told[0].toRoles], ['gm']); assert.match(told[0].text, /Career Score：同じ人の Career Score の申請 CS-/);
  const q2 = cloud.lss.find(x => x.ojt && x.ojt.axis === 'B');
  assert.equal(q2.status, '申請中'); assert.equal(q2.wr, undefined, 'left for the GM in the Career Score approvals');
  // the GM approves the skill request and applies it: now it changes
  const gm = await app(srv, 'E2', { cloud }); await gm.render();
  const skr = (await srv.pg.query(`select id from public.wr_requests where kind = 'skill'`)).rows[0];
  gm.ctx.wrOpen(skr.id); await gm.settle();
  gm.ctx.wrAsk('approve'); await gm.settle(); await gm.settle();
  assert.equal(gm.S().d.status, 'applied');
  assert.equal(cloud.skills.S1['Cam Crew'].Grill.level, 2, 'applied after the GM approves');
  // the GM signing (and the CEO): direct, as before
  gm.ctx.g2AutoReflect('Cam Crew', mod);
  assert.equal(gm.calls.filter(c => c[0] === 'direct').length, 1);
  // before go-live: direct
  const pre = await app(srv, 'E7', { role: 'sl', live: false, cloud });
  pre.ctx.g2AutoReflect('Cam Crew', mod);
  assert.equal(pre.calls.filter(c => c[0] === 'direct').length, 1);
  // a pass with nothing to raise (no reflect): direct path (nothing changes there either)
  g3.ctx.g2AutoReflect('Cam Crew', { id: 'm9', no: 9, title: 'x' });
  assert.equal(g3.calls.filter(c => c[0] === 'direct').length, 1);
});

test('OJT (Moto 11/03): the AM signing asks for a person of a store they lead; a G4 too; without an employee ID the GM is told', async () => {
  const srv = await server(), cloud = shared();
  const mod = { id: 'm3', no: 3, axis: 'A', title: 'キッチン', reflect: { axisFloor: 2 } };
  const am = await app(srv, 'E5', { role: 'am', realRole: 'am', cloud }); await am.render();
  am.ctx.g2AutoReflect('Cam Crew', mod); await am.settle(); await am.settle();
  const r = (await srv.pg.query(`select kind, requester_emp, store_id from public.wr_requests`)).rows;
  assert.deepEqual(r, [{ kind: 'cs', requester_emp: 'E5', store_id: 'S1' }]);
  assert.equal(am.calls.filter(c => c[0] === 'direct').length, 0);
  const g4 = await app(srv, 'E6', { role: 'am', realRole: 'g4', cloud }); await g4.render();
  g4.ctx.g2AutoReflect('Nobody Here', mod); await g4.settle();
  assert.ok(g4.notifs.some(n => /社員 ID・店が分かりません/.test(n.text || '')), 'the GM is told');
  assert.equal(g4.calls.filter(c => c[0] === 'direct').length, 0);
});
