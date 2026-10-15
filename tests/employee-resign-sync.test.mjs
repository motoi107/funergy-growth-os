// v1085（Moto 10/15「退職完了にした従業員がリストに戻ってくる」）: the app side. Two (or three) devices run the real code of
// index.html in VMs (the storage layer, the employee sync, the resignation flows) against a stand-in for PostgREST backed by PGlite
// with the real migration 20261023090000 (or without it, like a database where it is not run yet). Synthetic staff only; nothing
// reaches the network or a browser. FUNERGY_BASE_INDEX (or the git history) gives the code before the fix, to show the cause.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const INDEX = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
const MIG = fs.readFileSync(process.env.FUNERGY_RESIGN_MIG || new URL('../supabase/migrations/20261023090000_employee_resign_guard.sql', import.meta.url), 'utf8');
const J = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));

function loadSource(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function baseSource() {
  if (process.env.FUNERGY_BASE_INDEX) return loadSource(process.env.FUNERGY_BASE_INDEX);
  try { return execFileSync('git', ['show', 'dc5e78b:index.html'], { cwd: new URL('..', import.meta.url).pathname, maxBuffer: 64 << 20 }).toString('utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return null; }
}
function extractor(src) {
  const fn = name => {
    let i = src.indexOf('\nfunction ' + name + '(');
    if (i < 0) i = src.indexOf('\nasync function ' + name + '(');
    assert.ok(i >= 0, 'function ' + name);
    const line = src.slice(i + 1, src.indexOf('\n', i + 1));
    if (/\}\s*(\/\*.*\*\/)?\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
    return src.slice(i + 1, src.indexOf('\n}', i + 1) + 2);
  };
  const block = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j + b.length); };
  const varBlock = (name, close) => block('\nvar ' + name + ' = ', close);
  return { fn, block, varBlock, has: m => src.includes(m) };
}

// ---------------------------------------------------------------------------------------------------- the server
async function server({ guard = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    grant select, insert, update on public.employees to anon;
    insert into auth_pins values ('staff', '{"Ann Sample":"4821","Bob Sample":"1357"}');
    insert into manager_auth values ('00000000-0000-4000-8000-0000000000b1', 'office', 'e1');`);
  for (const [id, name, role, title, store] of [['e1', 'Ann Sample', 'office', 'Accountant', 'OFFICE'], ['e2', 'Bob Sample', 'crew', 'Crew', 'F01'], ['e3', 'Gus Sample', 'gm', 'General Manager', 'ALL']])
    await pg.query('insert into employees(id,name,role,title,store,status,data) values($1,$2,$3,$4,$5,$6,$7)', [id, name, role, title, store, '在籍', JSON.stringify({ id, name, role, title, store, status: '在籍', support: [] })]);
  if (guard) await pg.exec(MIG);
  const S = { pg, down: false, calls: [], inflight: 0 };
  const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  S.fetch = async (url, init = {}) => {
    S.inflight++;
    try {
      await tick();
      if (S.down) throw new TypeError('Failed to fetch');
      const u = new URL(url), path = u.pathname, method = (init.method || 'GET').toUpperCase();
      S.calls.push(method + ' ' + path + u.search);
      if (path === '/rest/v1/employees' && method === 'GET') {
        const sel = u.searchParams.get('select'), inl = u.searchParams.get('id');
        let rows;
        if (inl && inl.startsWith('in.(')) {
          const ids = JSON.parse('[' + inl.slice(4, -1) + ']');
          rows = (await pg.query('select id, data from employees where id = any($1) order by id', [ids])).rows;
        } else rows = (await pg.query('select id, data from employees order by id')).rows;
        return res(200, sel === 'data' ? rows.map(r => ({ data: r.data })) : rows);
      }
      if (path === '/rest/v1/employees' && method === 'POST') {
        const rows = JSON.parse(init.body);
        await pg.exec('set role anon');
        try {
          for (const o of rows) await pg.query(`insert into employees(id,name,emp_code,role,perms,title,store,support,status,emp_type,email,phone,data)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            on conflict (id) do update set name=excluded.name, emp_code=excluded.emp_code, role=excluded.role, perms=excluded.perms, title=excluded.title, store=excluded.store,
              support=excluded.support, status=excluded.status, emp_type=excluded.emp_type, email=excluded.email, phone=excluded.phone, data=excluded.data`,
            [o.id, o.name, o.emp_code, o.role, o.perms, o.title, o.store, JSON.stringify(o.support || []), o.status, o.emp_type, o.email, o.phone, JSON.stringify(o.data)]);
        } finally { await pg.exec('reset role'); }
        return res(201, '');
      }
      if (path === '/rest/v1/rpc/employee_access_state' && method === 'POST') {
        if (!guard) return res(404, { code: 'PGRST202', message: 'Could not find the function public.employee_access_state' });
        const b = JSON.parse(init.body);
        await pg.exec('set role anon');
        try { return res(200, (await pg.query('select public.employee_access_state($1, $2) as v', [b.p_emp, !!b.p_fix])).rows[0].v); }
        finally { await pg.exec('reset role'); }
      }
      if (path.startsWith('/auth/v1/')) return res(200, {});
      return res(200, []);
    } finally { S.inflight--; }
  };
  S.settle = async () => { for (let i = 0; i < 400; i++) { await tick(); if (!S.inflight) { await tick(); await tick(); if (!S.inflight) return; } } throw new Error('the requests did not finish'); };
  S.emp = async id => (await pg.query('select status, data from employees where id=$1', [id])).rows[0];
  S.pins = async () => (await pg.query("select data from auth_pins where id='staff'")).rows[0].data;
  return S;
}

// ---------------------------------------------------------------------------------------------------- a device
const FNS = ['lsSet', '_pushWithOutbox', 'syncMasterToSupabase', 'supaUpsert', 'supaHeaders', '_stripTestRows', 'getEmployees', 'loginBootstrapPull', 'supaFetchAll',
  'deleteEmp', 'setEmpStatusQuick', 'getOffboardings', 'setOffboardings', 'offboardById', 'offboardProgress', 'offboardCanEdit', 'completeOffboarding', 'restoreEmployee',
  'toggleOBTask', 'finalizePayroll', 'resignRepairCandidates', 'resignRepairApply', 'resignRepairKeep', '_obBusy', 'flushOutbox', 'authPinCheck', '_loginFetchT', '_loginServerPing'];
function device(S, src, { user = 'Gus Sample', role = 'gm', me = null } = {}) {
  const x = extractor(src);
  const v1085 = x.has('/* FUNERGY_EMP_SYNC_BEGIN */');
  const parts = [x.varBlock('SUPA_MASTER_MAP', '\n};'), 'var TEST_STAFF_PREFIX = "tst_";', 'var LOGIN_PIN_TIMEOUT = 30000, LOGIN_PING_TIMEOUT = 8000;'];
  for (const n of FNS) { try { parts.push(x.fn(n)); } catch (e) { if (v1085 || !['resignRepairCandidates', 'resignRepairApply', 'resignRepairKeep', '_obBusy'].includes(n)) throw e; } }
  if (v1085) parts.push(x.block('/* FUNERGY_EMP_SYNC_BEGIN */', '/* FUNERGY_EMP_SYNC_END */'), x.block('/* FUNERGY_OFFBOARD_BEGIN */', '/* FUNERGY_OFFBOARD_END */'), 'var _obCompleting = {};');
  const c = { console, STORE: new Map(), TOASTS: [], ALERTS: [], OUTBOX: new Set(), LOGOUTS: 0, PUSHES: [], fetch: (...a) => S.fetch(...a), Response, URL, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    curUserName: user, curRole: role, curStoreLogin: false, loginPerson: me, navigator: { onLine: true }, CONFIRM: true, DOMV: {}, OBPUSH_OK: true };
  vm.createContext(c);
  vm.runInContext(`var window = this; var document = { getElementById: function(id){ if (id === 'modal-overlay') return { classList: { contains: function(){ return false; } } }; return Object.prototype.hasOwnProperty.call(DOMV, id) ? { value: DOMV[id], classList: { contains: function(){ return false; } } } : null; }, hidden: false };
    var SUPABASE_URL = 'https://db.test', SUPABASE_ANON = 'anon-key', SUPA_SYNC_ENABLED = true, _supaBooting = false, _SPLIT_KEYS = {}, _lsEscalatedAt = 0, _LS_SAVE_FAIL = {}, _lastSupaError = null;
    var DEFAULT_EMPLOYEES = [], OFFBOARD_SETTLE = [['pay','給与'],['tip','チップ']], ROLE_CONFIG = { gm:{ name:'GM' } }, STORES = [{ id:'F01', name:'Store One' }];
    function _lsStoreGet(k){ return STORE.has(k) ? STORE.get(k) : null; }
    function _lsWriteVerified(k, j){ STORE.set(k, j); return true; }
    function _lsRaw(k, d){ var v = _lsStoreGet(k); return v ? JSON.parse(v) : d; }
    function _lsRawDel(k){ STORE.delete(k); }
    function ls(k, d){ var v = _lsStoreGet(k); return v ? JSON.parse(v) : d; }
    function _splitWrite(){ throw new Error('no split in this test'); }
    function _lsFreeOldLaborKeys(){ return 0; } function freeRecoverableSpace(){ return {}; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(){}
    function _lsPushBlocked(){ return false; } function _outboxAdd(k){ OUTBOX.add(k); } function _outboxRemove(k){ OUTBOX.delete(k); }
    function _outboxGet(){ return Array.from(OUTBOX).map(function(k){ return { key:k }; }); } function _outboxSet(){}
    var _outboxFlushing = false;
    function supaErrorText(){ return ''; }
    function t(a){ return a; } function showToast(m, k){ TOASTS.push([m, k]); } function alert(m){ ALERTS.push(m); } function confirm(){ return CONFIRM; }
    function renderPage(){} function closeModalDirect(){} function openModal(){} function addNotif(){} function openOBTrainingModal(){} function openOffboardingModal(){}
    function todayISO(){ return '2026-10-15'; } function fmtJP(x){ return String(x).slice(0,10); } function escapeHtml(s){ return String(s==null?'':s); }
    function showSyncSplash(){} function hideSyncSplash(){} function refreshStaffPinsFromCloud(){ return Promise.resolve(); } function refreshStores(){}
    function getOBTemplate(){ return [{ id:'t1', label:'Crew化', type:'完了条件' }]; } function getSkills(){ return {}; } function setSkills(){} function setWorkCondition(){}
    function doLogout(){ LOGOUTS++; curUserName = null; loginPerson = null; } function managerLogout(){ LOGOUTS++; }
    function invInKeepAll(){ var v = _lsRaw('_invin_signin', null); return (v && v.people) ? v : { v:1, people:{} }; }
    function invInKeepSet(rt, w){ var a = invInKeepAll(); if (rt) a.people[w] = { rt:rt, at:Date.now() }; else delete a.people[w]; STORE.set('_invin_signin', JSON.stringify(a)); return true; }
    function _opMergeDef(){ return null; } function isOpSyncKey(){ return false; } var SUPA_SETTING_KEYS = [], SUPA_SETTING_PREFIX = [];
    function opMergePush(k, v){ PUSHES.push([k, JSON.parse(JSON.stringify(v))]); return Promise.resolve(OBPUSH_OK); }
    ` + parts.join('\n'), c);
  c.run = code => { const r = vm.runInContext(code, c); return r && typeof r.then === 'function' ? r : (r === undefined ? r : J(r)); };
  c.list = () => J(vm.runInContext('ls("m_employees", [])', c));
  c.emp = id => c.list().find(e => e.id === id);
  c.v1085 = v1085;
  return c;
}
async function pulled(S, src, opt) { const d = device(S, src, opt); await d.run('loginBootstrapPull()'); await S.settle(); return d; }
const NOW = fs.existsSync(INDEX) ? loadSource(INDEX) : null;
const BASE = baseSource();

// ---------------------------------------------------------------------------------------------------- the cause, before and after
async function staleOverwrite(src, guard) {
  const S = await server({ guard });
  const a = await pulled(S, src), b = await pulled(S, src);       // both devices opened the app before the resignation
  a.run("deleteEmp('e1')");                                          // A: Ann is resigned (what 退職にする / 退職手続きの開始 also do)
  await S.settle();
  const afterA = (await S.emp('e1')).data.status;
  b.run("var emps = getEmployees(); emps.find(function(e){ return e.id==='e2'; }).title = 'Crew Leader'; lsSet('m_employees', emps);");   // B: fixes Bob only
  await S.settle();
  const c = await pulled(S, src);                                    // a third device opens the app later
  return { afterA, cloud: (await S.emp('e1')).data.status, bob: (await S.emp('e2')).data.title, third: c.emp('e1').status, calls: S.calls };
}
test('the cause (code before v1085, database without the guard): a device opened before the resignation saves someone else and brings Ann back', { skip: !BASE && 'no base index.html (set FUNERGY_BASE_INDEX)' }, async () => {
  const r = await staleOverwrite(BASE, false);
  assert.equal(r.afterA, '退職', 'the resignation was saved');
  assert.equal(r.cloud, '在籍', 'and then written back as in service by the stale device');
  assert.equal(r.third, '在籍', 'every device that loads the list sees her again');
  assert.equal(r.bob, 'Crew Leader');
});
test('the cause, second way (code before v1085): a resignation saved while offline is lost when the device loads the list', { skip: !BASE && 'no base index.html' }, async () => {
  const S = await server({ guard: false });
  const a = await pulled(S, BASE);
  S.down = true; a.run("deleteEmp('e1')"); await S.settle(); S.down = false;
  assert.equal(a.emp('e1').status, '退職');
  await a.run('loginBootstrapPull()'); await S.settle();            // the next sign-in loads the list
  assert.equal(a.emp('e1').status, '在籍', 'the unsent resignation is replaced by the cloud copy');
  await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '在籍', 'and the retry sends the replaced list');
});
test('the server guard alone stops the stale write of the old app (v1084 devices until they are updated)', { skip: !BASE && 'no base index.html' }, async () => {
  const r = await staleOverwrite(BASE, true);
  assert.equal(r.cloud, '退職'); assert.equal(r.third, '退職'); assert.equal(r.bob, 'Crew Leader');
});
test('v1085 alone (database without the guard yet) and with the guard: Ann stays resigned; only Bob is sent', async () => {
  for (const guard of [false, true]) {
    const r = await staleOverwrite(NOW, guard);
    assert.equal(r.cloud, '退職', 'guard ' + guard); assert.equal(r.third, '退職'); assert.equal(r.bob, 'Crew Leader');
    const posts = r.calls.filter(x => x.startsWith('POST /rest/v1/employees'));
    assert.equal(posts.length, 2, 'one write each for A and B');
  }
});

test('v1085: what a write sends — only the people and fields changed, on top of the latest cloud row', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  b.run("var emps = getEmployees(); emps.find(function(e){ return e.id==='e3'; }).title = 'GM (synthetic)'; lsSet('m_employees', emps);");
  await S.settle();
  // A changes Bob's store; the cloud copy of Gus (changed by B) is not touched by A's write even though A still holds the old title
  const posted = [];
  const f = S.fetch; S.fetch = async (u, i) => { if ((i?.method || 'GET') === 'POST' && String(u).includes('/rest/v1/employees')) posted.push(JSON.parse(i.body)); return f(u, i); };
  a.run("var emps = getEmployees(); emps.find(function(e){ return e.id==='e2'; }).store = 'F02'; lsSet('m_employees', emps);");
  await S.settle();
  assert.deepEqual(posted.map(rows => rows.map(r => r.id)), [['e2']]);
  assert.equal((await S.emp('e3')).data.title, 'GM (synthetic)');
  assert.equal((await S.emp('e2')).data.store, 'F02');
  assert.equal(a.run('empDirtyCount()'), 0, 'nothing left to send');
  assert.equal(a.emp('e2').store, 'F02');
  // wage / e-mail / phone never go to the public table (as before)
  a.run("var emps = getEmployees(); var g = emps.find(function(e){ return e.id==='e2'; }); g.wage = 31; g.email = 'bob@example.test'; lsSet('m_employees', emps);");
  await S.settle();
  const r2 = await S.emp('e2');
  assert.equal(r2.data.wage, undefined); assert.equal(r2.data.email, undefined);
  assert.equal(a.emp('e2').wage, 31, 'kept on this device as before');
});

test('v1085: a resignation saved offline is kept through the next sign-in and sent when the network is back', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  S.down = true; a.run("deleteEmp('e1')"); await S.settle(); S.down = false;
  await a.run('loginBootstrapPull()'); await S.settle();
  assert.equal(a.emp('e1').status, '退職', 'the unsent change stays on top of the loaded list');
  await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal((await S.pins())['Ann Sample'], '!blocked');
});

test('v1085: a screen that read the list before a reload saves only what it changed (the reload is not undone)', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  b.run("var HELD = getEmployees();");                               // B opened an edit screen
  a.run("deleteEmp('e1')"); await S.settle();                       // A resigns Ann
  await b.run('loginBootstrapPull()'); await S.settle();            // B reloads the list (Ann resigned) while the screen is open
  b.run("HELD.find(function(e){ return e.id==='e2'; }).title = 'Crew Leader'; lsSet('m_employees', HELD);");   // the old screen saves its array
  await S.settle();
  assert.equal(b.emp('e1').status, '退職', 'the device keeps the reloaded state');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal((await S.emp('e2')).data.title, 'Crew Leader');
  // the same old screen now changes Ann (read as in service, version 1): the server keeps the resignation (version 2)
  b.run("var H2 = JSON.parse(HELD.__src); H2.find(function(e){ return e.id==='e1'; }).status = '休職'; Object.defineProperty(H2, '__src', { value: HELD.__src }); lsSet('m_employees', H2);");
  await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職', 'the change made on the version read before is not taken');
  assert.equal(b.emp('e1').status, '退職');
});

test('v1085: two devices change the same person\'s status — the one that read the older version is told and takes the cloud state', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  a.run("deleteEmp('e1')"); await S.settle();
  b.run("setEmpStatusQuick('e1', '休職')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal(b.emp('e1').status, '退職', 'B takes the cloud state');
  assert.ok(b.TOASTS.some(([m]) => /ほかの端末で先に「退職」/.test(m)), 'B is told');
  assert.equal(b.run('empDirtyCount()'), 0);
  // B now has the new version: a deliberate restore from B goes in
  b.CONFIRM = true; await b.run("restoreEmployee('e1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '在籍');
  // a change made offline on the old version is dropped by the next load (the cloud moved on), before anything is sent
  const c = await pulled(S, NOW);
  S.down = true; c.run("setEmpStatusQuick('e2', '休職')"); await S.settle(); S.down = false;
  a.run("loginBootstrapPull()"); await S.settle(); a.run("deleteEmp('e2')"); await S.settle();
  const posts = S.calls.filter(x => x.startsWith('POST')).length;
  await c.run('loginBootstrapPull()'); await S.settle();
  assert.equal(c.emp('e2').status, '退職', 'the load shows the cloud state at once');
  assert.ok(c.TOASTS.some(([m]) => /Bob Sample さんの状態は、ほかの端末で先に「退職」/.test(m)));
  assert.equal(c.run('empDirtyCount()'), 0);
  assert.equal(S.calls.filter(x => x.startsWith('POST')).length, posts, 'nothing was sent by the load');
});

test('v1085: 退職手続きを完了 — completes only after the server has the resignation and the sign-in is stopped; a failure is not shown as completed', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run(`setOffboardings([{ id:'ob1', empId:'e1', empName:'Ann Sample', store:'OFFICE', status:'進行中', lastWorkDate:'2026-10-14', initiatedAt:'2026-10-10T00:00:00Z', checklist:[], settlement:{pay:true,tip:true}, accountDisabled:false }])`);
  // the network fails during the completion: not completed, the reason is shown, the button can be pressed again
  S.down = true;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  S.down = false;
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.ok(a.TOASTS.some(([m, k]) => k === 'danger' && /完了にできませんでした/.test(m)));
  // the completion record cannot be sent: not completed either (the resignation itself is on the server)
  a.OBPUSH_OK = false;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.ok(a.TOASTS.at(-1)[0].includes('完了の記録を送れませんでした'));
  // pressed again with everything working: completed, the PIN and the manager account are stopped
  a.OBPUSH_OK = true;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  const ob = a.run("offboardById('ob1')");
  assert.equal(ob.status, '完了'); assert.equal(ob.completedBy, 'Gus Sample'); assert.match(ob.completedAt, /^2\d{3}-/); assert.ok(ob._stAt);
  const r = await S.emp('e1');
  assert.equal(r.data.status, '退職'); assert.equal(r.data.osDisabled, true); assert.equal(r.data.resignDate, '2026-10-14');
  assert.equal((await S.pins())['Ann Sample'], '!blocked');
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'suspended');
  assert.equal(a.TOASTS.at(-1)[1], 'success');
  // pressing it again does nothing harmful (idempotent)
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
});

test('v1085: the completion is not shown when the server could not stop the manager account (a failure in the middle)', async () => {
  const S = await server();
  await S.pg.exec("alter table manager_auth add constraint role_ok check (role in ('ceo','gm','office','office_crew'))");   // 'suspended' cannot be written
  const a = await pulled(S, NOW);
  a.run(`setOffboardings([{ id:'ob1', empId:'e1', empName:'Ann Sample', store:'OFFICE', status:'進行中', lastWorkDate:'2026-10-14', checklist:[], settlement:{pay:true,tip:true} }])`);
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.match(a.TOASTS.at(-1)[0], /管理者のアカウント：active/);
  assert.equal((await S.emp('e1')).data.status, '退職', 'the resignation itself is in (pressing again finishes the rest)');
  assert.ok((await S.pg.query("select 1 from employee_status_log where kind='apply_failed'")).rows.length > 0);
  // after the cause is fixed, pressing again completes
  await S.pg.exec('alter table manager_auth drop constraint role_ok');
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'suspended');
});

test('v1085: completing on a database without the guard still checks the cloud row and says the guard is missing', async () => {
  const S = await server({ guard: false });
  const a = await pulled(S, NOW);
  a.run(`setOffboardings([{ id:'ob1', empId:'e2', empName:'Bob Sample', store:'F01', status:'進行中', lastWorkDate:'2026-10-14', checklist:[], settlement:{pay:true,tip:true} }])`);
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  assert.equal((await S.emp('e2')).data.status, '退職');
  assert.match(a.TOASTS.at(-1)[0], /20261023090000 がまだ入っていません/);
});

test('v1085: restore (在籍に戻す) is the explicit way back; the offboarding becomes 取消 only after the server took it', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run(`setOffboardings([{ id:'ob1', empId:'e1', empName:'Ann Sample', store:'OFFICE', status:'進行中', lastWorkDate:'2026-10-14', checklist:[], settlement:{pay:true,tip:true} }])`);
  await a.run("completeOffboarding('ob1')"); await S.settle();
  a.curRole = 'crew';
  await a.run("restoreEmployee('e1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職', 'not allowed for crew');
  a.curRole = 'gm';
  S.down = true; await a.run("restoreEmployee('e1')"); await S.settle(); S.down = false;
  assert.equal(a.run("offboardById('ob1').status"), '完了', 'not cancelled while the server does not have it');
  await a.run("restoreEmployee('e1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '在籍');
  assert.equal(a.run("offboardById('ob1').status"), '取消');
  assert.equal((await S.pins())['Ann Sample'], '4821', 'her PIN is back');
  assert.ok((await S.emp('e1')).data._restoreAt);
});

test('v1085: the quick status buttons and the onboarding never bring a resigned person back by name', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run("deleteEmp('e1')"); await S.settle();
  // an onboarding of a new hire with the same name (no employee ID yet): Crew化 does not touch the resigned Ann
  a.run(`STORE.set('onboardings', JSON.stringify([{ id:'on1', name:'Ann Sample', done:[], template:[{ id:'t1', label:'Crew化', type:'完了条件' }] }]))`);
  a.run("toggleOBTask('on1', 't1')"); await S.settle();
  assert.equal(a.emp('e1').status, '退職');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.ok(a.TOASTS.some(([m]) => /在籍には戻していません/.test(m)));
  // registering that hire is stopped (no second Ann with a new ID); a rehire goes through 在籍に戻す
  Object.assign(a.DOMV, { 'pr-role': 'crew', 'pr-emp': 'パート', 'pr-wage': '16', 'pr-firstwork': '', 'pr-days': 'any', 'pr-maxh': '40' });
  a.run("document.querySelectorAll = function(){ return []; }; finalizePayroll('on1')");
  assert.equal(a.list().filter(e => e.name === 'Ann Sample').length, 1);
  assert.ok(a.TOASTS.some(([m]) => /同じ名前の退職者がいます/.test(m)));
  // an onboarding linked by ID activates only that person
  a.run(`var emps = getEmployees(); emps.push({ id:'e9', name:'Ann Sample', role:'crew', store:'F01', status:'研修中', step:0 }); lsSet('m_employees', emps);`);
  a.run(`STORE.set('onboardings', JSON.stringify([{ id:'on2', name:'Ann Sample', empId:'e9', done:[], template:[{ id:'t1', label:'Crew化', type:'完了条件' }] }]))`);
  a.run("toggleOBTask('on2', 't1')"); await S.settle();
  assert.equal(a.emp('e9').status, '在籍'); assert.equal(a.emp('e1').status, '退職');
  // the quick button on a resigned person goes to the explicit restore
  a.run("var R = []; restoreEmployee = function(id){ R.push(id); }; setEmpStatusQuick('e1', '在籍');");
  assert.deepEqual(a.run('R'), ['e1']);
});

test('v1085: undoing the approval of a completed offboarding is refused; the edit form cannot leave 退職', async () => {
  const S = await server();
  const x = extractor(NOW);
  const a = await pulled(S, NOW);
  vm.runInContext(x.fn('reopenApproval') + '\n' + x.fn('saveEmp'), a);
  a.run("deleteEmp('e1')"); await S.settle();
  a.run(`setOffboardings([{ id:'ob1', empId:'e1', empName:'Ann Sample', status:'完了', completedAt:'2026-10-12T00:00:00Z' }]); STORE.set('approvals', JSON.stringify([{ id:'ap1', type:'退職', ref:'ob1', status:'approved' }]));`);
  a.run("reopenApproval('ap1')"); await S.settle();
  assert.match(a.ALERTS.at(-1), /退職手続きは完了しています/);
  assert.equal(a.emp('e1').status, '退職');
  assert.equal(a.run("ls('approvals', [])[0].status"), 'approved');
  Object.assign(a.DOMV, { 'e-name': 'Ann Sample', 'e-status': '在籍' });
  a.run("saveEmp('e1')"); await S.settle();
  assert.match(a.ALERTS.at(-1), /在籍に戻す/);
  assert.equal((await S.emp('e1')).data.status, '退職');
});

test('v1085: a signed-in person who is resigned on another device is signed out on the next check, and their saved sign-in is forgotten', async () => {
  const S = await server();
  const gm = await pulled(S, NOW);
  const ann = await pulled(S, NOW, { user: 'Ann Sample', role: 'office', me: { id: 'e1', name: 'Ann Sample' } });
  ann.run(`invInKeepSet('rt-ann', 'e:e1'); invInKeepSet('rt-gus', 'e:e3');`);
  assert.equal(await ann.run("empAccessCheck('resume')"), 'ok');
  gm.run("deleteEmp('e1')"); await S.settle();
  assert.equal(await ann.run("empAccessCheck('resume')"), null, 'checked less than a minute ago: waits');
  assert.equal(await ann.run("empAccessCheck('force')"), 'out');
  assert.equal(ann.LOGOUTS, 1);
  assert.equal(ann.run('window._sessionPin'), null); assert.equal(ann.run('window._hwSession'), null);
  assert.deepEqual(Object.keys(ann.run('invInKeepAll().people')), ['e:e3'], "only Ann's saved sign-in is forgotten");
  assert.equal(ann.emp('e1').status, '退職');
  // a shared store account is not an employee: not checked
  const store = await pulled(S, NOW, { user: 'Store One', role: 'sl' });
  store.run('curStoreLogin = true');
  assert.equal(await store.run("empAccessCheck('force')"), null);
  // offline: cannot tell, stays signed in
  const ann2 = await pulled(S, NOW, { user: 'Bob Sample', role: 'crew', me: { id: 'e2', name: 'Bob Sample' } });
  S.down = true; assert.equal(await ann2.run("empAccessCheck('force')"), null); S.down = false;
  assert.equal(ann2.LOGOUTS, 0);
  // the next device that loads the list forgets saved sign-ins of resigned people on it
  const d = device(S, NOW); d.run(`invInKeepSet('rt-ann', 'e:e1'); invInKeepSet('rt-bob', 'e:e2');`);
  await d.run('loginBootstrapPull()'); await S.settle();
  assert.deepEqual(Object.keys(d.run('invInKeepAll().people')), ['e:e2']);
});

test('v1085: the PIN sign-in reports a stopped account (the server says inactive) instead of "wrong PIN"', async () => {
  const S = await server();
  const d = device(S, NOW);
  S.fetch = async (u, i) => (String(u).includes('/functions/v1/auth-pin') ? new Response(JSON.stringify({ ok: false, error: 'inactive' }), { status: 200 }) : new Response('[]', { status: 200 }));
  const r = await d.run("authPinCheck('staff', 'Ann Sample', '4821', 'e1')");
  assert.deepEqual(J(r), { ok: false, server: false, inactive: true });
  let body = null;
  S.fetch = async (u, i) => { if (String(u).includes('auth-pin')) body = JSON.parse(i.body); return new Response(JSON.stringify({ ok: true, token: 'v1.x.y' }), { status: 200 }); };
  await d.run("authPinCheck('staff', 'Bob Sample', '1357', 'e2')");
  assert.deepEqual(body, { action: 'verify', scope: 'staff', key: 'Bob Sample', pin: '1357', emp: 'e2' });
});

test('v1085: the repair list shows only people with a completed offboarding who are in service again; GM fixes one by one', async () => {
  // a resurrected Ann made with the old code (stale write) on a database without the guard
  const S = await server({ guard: false });
  const g = await pulled(S, NOW);
  await S.pg.query(`update employees set status='在籍', data = data || '{"status":"在籍","hireDate":"2025-01-01"}' where id='e1'`);
  await g.run('loginBootstrapPull()'); await S.settle();
  g.run(`setOffboardings([
    { id:'ob1', empId:'e1', empName:'Ann Sample', status:'完了', completedAt:'2026-10-12T01:00:00Z', completedBy:'Gus Sample', lastWorkDate:'2026-10-11', initiatedAt:'2026-10-01T00:00:00Z' },
    { id:'ob2', empId:'e2', empName:'Bob Sample', status:'進行中', initiatedAt:'2026-10-05T00:00:00Z' },
    { id:'ob0', empId:'e3', empName:'Gus Sample', status:'取消', initiatedAt:'2026-09-01T00:00:00Z' }])`);
  assert.deepEqual(g.run('resignRepairCandidates().map(function(x){ return x.e.id; })'), ['e1'], 'no record, no guess (Bob is in progress, Gus was cancelled)');
  g.curRole = 'office'; await g.run("resignRepairApply('e1', 'ob1')");
  assert.equal(g.emp('e1').status, '在籍', 'only GM / CEO');
  g.curRole = 'gm'; await g.run("resignRepairApply('e1', 'ob1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal(g.emp('e1').resignDate, '2026-10-11');
  assert.deepEqual(g.run('resignRepairCandidates()'), []);
  // "keep in service" (a rehire) takes the person off the list without changing the status
  g.run(`var emps = getEmployees(); var a = emps.find(function(e){ return e.id==='e1'; }); a.status='在籍'; a.osDisabled=false; lsSet('m_employees', emps);`);
  await S.settle();
  assert.equal(g.run('resignRepairCandidates().length'), 1);
  g.run("resignRepairKeep('e1')"); await S.settle();
  assert.equal(g.run('resignRepairCandidates().length'), 0);
  assert.equal((await S.emp('e1')).data.status, '在籍');
});

// ---------------------------------------------------------------------------------------------------- the offboarding merge
test('v1085: the offboarding record moves forward only (a stale copy does not turn 完了 back into 進行中); undoing an approval wins by generation', () => {
  const S = { fetch: async () => new Response('[]') };
  const d = device(S, NOW);
  const m = (c, l) => J(d.run(`mergeOffboard(${JSON.stringify(c)}, ${JSON.stringify(l)})`));
  const done = { id: 'o', status: '完了', completedAt: '2026-10-15T01:00:00Z', completedBy: 'Gus', _stAt: '2026-10-15T01:00:00Z', _mut: 2000, checklist: [{ done: true }] };
  const stale = { id: 'o', status: '進行中', completedAt: '', completedBy: '', _stAt: '2026-10-10T00:00:00Z', _mut: 3000, checklist: [{ done: true }, { done: true }] };
  for (const [c, l] of [[[done], [stale]], [[stale], [done]]]) {
    const r = m(c, l)[0];
    assert.equal(r.status, '完了'); assert.equal(r.completedBy, 'Gus');
    assert.equal(r.checklist.length, 2, 'the newer checklist edit is kept');
  }
  // the old app's record has no stamps: the rank decides (完了 over 進行中, 取消 over 完了)
  const oldStale = { id: 'o', status: '進行中' };
  assert.equal(m([done], [oldStale])[0].status, '完了');
  assert.equal(m([{ id: 'o', status: '取消' }], [done])[0].status, '取消');
  // undoing the approval (申請中 with a higher generation) wins over a stale 進行中 with a later clock
  const reopened = { id: 'o', status: '申請中', _gen: 1, _stAt: '2026-10-11T00:00:00Z' };
  const later = { id: 'o', status: '進行中', _stAt: '2026-10-12T00:00:00Z' };
  assert.equal(m([later], [reopened])[0].status, '申請中');
  assert.equal(m([reopened], [later])[0].status, '申請中');
  // a delete wins; covers: the cloud copy covers a stale one, not a newer one
  assert.equal(m([{ ...done, _deleted: true }], [stale])[0]._deleted, true);
  assert.equal(d.run(`_coversOffboard([${JSON.stringify(done)}], [${JSON.stringify(oldStale)}])`), true);
  assert.equal(d.run(`_coversOffboard([${JSON.stringify(stale)}], [${JSON.stringify(done)}])`), false);
  // setOffboardings stamps the record whose status changed
  d.run(`setOffboardings([{ id:'x', status:'進行中' }]); var A = getOffboardings(); A[0].status = '完了'; setOffboardings(A);`);
  const x = d.run("offboardById('x')");
  assert.ok(x._stAt && x._mut); assert.equal(x._stBy, 'Gus Sample');
});
