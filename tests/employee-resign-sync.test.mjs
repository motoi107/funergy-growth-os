// v1085（Moto 10/15「退職完了にした従業員がリストに戻ってくる」）: the app side. Two (or three) devices run the real code of
// index.html in VMs (the storage layer with a stand-in localStorage and IndexedDB memory, the employee sync, the offboarding
// records with their real split / merge / push / pull, the resignation flows) against a stand-in for PostgREST and auth-pin backed
// by PGlite with the real migration 20261023090000 (or without it, like a database where it is not run yet). Synthetic staff only;
// nothing reaches the network or a browser. FUNERGY_BASE_INDEX (or the git history) gives the code before the fix, to show the cause.
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
  const line = start => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n', i)); };
  return { fn, block, varBlock, line, has: m => src.includes(m) };
}

// ---------------------------------------------------------------------------------------------------- the server
const SESSIONS = { 'tok-gm': { role: 'gm', name: 'Gus Sample' }, 'tok-office': { role: 'office', name: 'Ann Sample' }, 'tok-crew': { role: 'office_crew', name: 'Cy Sample' } };
async function server({ guard = true, extra = [] } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz);
    grant select, insert, update on public.employees, public.app_state to anon;
    grant select, insert, update on public.employees, public.app_state, public.auth_pins, public.manager_auth to service_role;
    insert into auth_pins values ('staff', '{"Ann Sample":"4821","Bob Sample":"1357"}');
    insert into manager_auth values ('00000000-0000-4000-8000-0000000000b1', 'office', 'e1');`);
  for (const [id, name, role, title, store] of [['e1', 'Ann Sample', 'office', 'Accountant', 'OFFICE'], ['e2', 'Bob Sample', 'crew', 'Crew', 'F01'], ['e3', 'Gus Sample', 'gm', 'General Manager', 'ALL'], ...extra])
    await pg.query('insert into employees(id,name,role,title,store,status,data) values($1,$2,$3,$4,$5,$6,$7)', [id, name, role, title, store, '在籍', JSON.stringify({ id, name, role, title, store, status: '在籍', support: [] })]);
  if (guard) await pg.exec(MIG);
  const S = { pg, down: false, calls: [], inflight: 0, failAppState: false, hold: null };
  const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const asRole = async (role, f) => { await pg.exec('set role ' + role); try { return await f(); } finally { await pg.exec('reset role'); } };
  S.fetch = async (url, init = {}) => {
    S.inflight++;
    try {
      await tick();
      if (S.hold) await S.hold(url, init);
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
        if (rows.some(o => o.data && o.data.__bad)) return res(400, { code: '22P02', message: 'invalid input (synthetic)' });
        await asRole('anon', async () => {
          for (const o of rows) await pg.query(`insert into employees(id,name,emp_code,role,perms,title,store,support,status,emp_type,email,phone,data)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            on conflict (id) do update set name=excluded.name, emp_code=excluded.emp_code, role=excluded.role, perms=excluded.perms, title=excluded.title, store=excluded.store,
              support=excluded.support, status=excluded.status, emp_type=excluded.emp_type, email=excluded.email, phone=excluded.phone, data=excluded.data`,
            [o.id, o.name, o.emp_code, o.role, o.perms, o.title, o.store, JSON.stringify(o.support || []), o.status, o.emp_type, o.email, o.phone, JSON.stringify(o.data)]);
        });
        return res(201, '');
      }
      if (path === '/rest/v1/app_state' && method === 'GET') {
        const k = u.searchParams.get('key') || '';
        const rows = k.startsWith('eq.') ? (await pg.query('select key, value from app_state where key=$1', [k.slice(3)])).rows : [];
        return res(200, u.searchParams.get('select') === 'value' ? rows.map(r => ({ value: r.value })) : rows);
      }
      if (path === '/rest/v1/app_state' && method === 'POST') {
        if (S.failAppState) return res(500, { message: 'synthetic failure' });
        await asRole('anon', async () => { for (const r of JSON.parse(init.body)) await pg.query('insert into app_state(key, value, updated_at) values($1,$2,$3) on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at', [r.key, JSON.stringify(r.value), r.updated_at || null]); });
        return res(201, '');
      }
      if (path === '/rest/v1/rpc/employee_access_state' && method === 'POST') {
        if (!guard) return res(404, { code: 'PGRST202', message: 'Could not find the function public.employee_access_state' });
        const b = JSON.parse(init.body);
        return res(200, await asRole('anon', async () => (await pg.query('select public.employee_access_state($1, $2) as v', [b.p_emp, !!b.p_fix])).rows[0].v));
      }
      if (path === '/functions/v1/auth-pin' && method === 'POST') {   // the parts of auth-pin v1085 the app uses here
        const b = JSON.parse(init.body || '{}');
        if (S.oldPin) return res(400, { error: 'unknown action' });        // auth-pin v1067 does not know "restore"
        if (b.action === 'restore') {
          const tok = String((init.headers || {}).Authorization || '').replace(/^Bearer /, '');
          const m = SESSIONS[tok];
          if (!m) return res(200, { ok: false, error: 'email_required' });
          if (!['ceo', 'gm', 'am', 'office'].includes(m.role)) return res(200, { ok: false, error: 'forbidden' });
          if (!guard) return res(200, { ok: false, error: 'not_installed' });
          S.restores = (S.restores || []).concat([b]);
          return res(200, await asRole('service_role', async () => (await pg.query('select public.employee_restore($1, $2, $3) as v', [b.emp, m.name, b.keepOffboard === true])).rows[0].v));
        }
        return res(200, { ok: false });
      }
      if (path === '/auth/v1/token' && method === 'POST') {             // e-mail sign-in (synthetic accounts)
        const b = JSON.parse(init.body || '{}'), acc = { 'ann@example.test': 'tok-ann' }[b.email];
        return acc && b.password === 'pw' ? res(200, { access_token: acc, refresh_token: 'r-' + acc }) : res(400, { error: 'invalid_grant' });
      }
      if (path === '/rest/v1/manager_auth' && method === 'GET') {       // RLS: the signed-in account's own row
        const tok = String((init.headers || {}).Authorization || '').replace(/^Bearer /, '');
        const uid = { 'tok-ann': '00000000-0000-4000-8000-0000000000b1' }[tok];
        return res(200, uid ? (await pg.query('select emp_id, role from manager_auth where user_id = $1', [uid])).rows : []);
      }
      if (path.startsWith('/auth/v1/')) return res(200, {});
      return res(200, []);
    } finally { S.inflight--; }
  };
  S.settle = async () => { for (let i = 0; i < 600; i++) { await tick(); if (!S.inflight) { await tick(); await tick(); await tick(); if (!S.inflight) return; } } throw new Error('the requests did not finish'); };
  S.emp = async id => (await pg.query('select status, data from employees where id=$1', [id])).rows[0];
  S.pins = async () => (await pg.query("select data from auth_pins where id='staff'")).rows[0].data;
  S.records = async () => ((await pg.query("select value from app_state where key='spl_offboardings__'")).rows[0] || {}).value || [];
  S.log = async id => (await pg.query('select kind, old_status, new_status from employee_status_log where emp_id=$1 order by id', [id])).rows;
  return S;
}

// ---------------------------------------------------------------------------------------------------- a device
const FNS = ['lsSet', '_pushWithOutbox', 'syncMasterToSupabase', 'supaUpsert', 'supaHeaders', '_stripTestRows', 'getEmployees', 'loginBootstrapPull', 'supaFetchAll',
  'deleteEmp', 'setEmpStatusQuick', 'getOffboardings', 'setOffboardings', 'offboardById', 'offboardProgress', 'offboardCanEdit', 'completeOffboarding', 'restoreEmployee',
  'toggleOBTask', 'finalizePayroll', 'flushOutbox', 'authPinCheck', '_loginFetchT', '_loginServerPing',
  '_lsStoreGet', '_lsRaw', '_lsRawStr', '_lsRawDel', 'lsIsDeviceLocal', '_lsWriteVerified', '_idbQueue', '_lsSetVerified',
  '_opMergeDef', '_fetchOpValue', '_opUpsertRow', '_opWriteBack', 'opMergePush', 'pullOpKey', '_splitRead', '_splitWrite', '_splitPrefix', '_mutBare',
  'ghTxnBegin', 'ghTxnEnd', 'empStatusLabel'];
const FNS_1085 = ['resignRepairCandidates', 'resignRepairApply', 'resignRepairKeep', '_obBusy', 'secAuthSession', 'secAuthEnsure', 'secAuthCall', 'secAuthNeedLogin',
  'secAuthErrText', 'secAuthLoginModal', '_restoreErrText', 'empRestoreServer', 'reopenApproval', '_reopenOffboardApproval', 'saveEmp', 'doManagerLogin', 'managerRoleAllowed'];
function device(S, src, { user = 'Gus Sample', role = 'gm', me = null, idb = true } = {}) {
  const x = extractor(src);
  const v1085 = x.has('/* FUNERGY_EMP_SYNC_BEGIN */');
  const parts = [x.varBlock('SUPA_MASTER_MAP', '\n};'), 'var TEST_STAFF_PREFIX = "tst_";', 'var LOGIN_PIN_TIMEOUT = 30000, LOGIN_PING_TIMEOUT = 8000;',
    x.line('var LS_DEVICE_LOCAL = '), 'var _SPLIT_KEYS = {\n' + x.line('  offboardings:     {type:') + '\n};'];
  for (const n of FNS) parts.push(x.fn(n));
  if (v1085) {
    for (const n of FNS_1085) parts.push(x.fn(n));
    parts.push(x.block('/* FUNERGY_EMP_SYNC_BEGIN */', '/* FUNERGY_EMP_SYNC_END */'), x.block('/* FUNERGY_OFFBOARD_BEGIN */', '/* FUNERGY_OFFBOARD_END */'), 'var _obCompleting = {};',
      'var OP_MERGE = { offboardings: { merge: mergeOffboard, covers: _coversOffboard } };');
  } else parts.push('var OP_MERGE = {};');
  const LSMAP = new Map();
  const c = { console, LSMAP, TOASTS: [], ALERTS: [], OUTBOX: new Set(), LOGOUTS: 0, MODALS: 0, fetch: (...a) => S.fetch(...a), Response, URL, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    curUserName: user, curRole: role, curStoreLogin: false, loginPerson: me, navigator: { onLine: true }, CONFIRM: true, DOMV: {}, SESSION: null, LS_FULL: false, IDB_ON: idb, SECURE: 0 };
  vm.createContext(c);
  vm.runInContext(`var window = this; var document = { getElementById: function(id){ if (id === 'modal-overlay') return { classList: { contains: function(){ return false; } } }; return Object.prototype.hasOwnProperty.call(DOMV, id) ? { value: DOMV[id], checked: false, classList: { contains: function(){ return false; } } } : null; }, querySelectorAll: function(){ return []; }, hidden: false, activeElement: null };
    var localStorage = { getItem: function(k){ return LSMAP.has(k) ? LSMAP.get(k) : null; }, setItem: function(k, v){ if (LS_FULL) throw new Error('QuotaExceededError'); LSMAP.set(k, String(v)); }, removeItem: function(k){ LSMAP.delete(k); }, key: function(i){ return Array.from(LSMAP.keys())[i]; }, get length(){ return LSMAP.size; } };
    var _idbState = IDB_ON ? 'ready' : 'unavailable', _IDB_MEM = IDB_ON ? new Map() : null, _idbQ = new Map(), _idbTimer = null; function _idbFlush(){} function _lskBump(){}
    var SUPABASE_URL = 'https://db.test', SUPABASE_ANON = 'anon-key', SUPA_SYNC_ENABLED = true, _supaBooting = false, _lsEscalatedAt = 0, _LS_SAVE_FAIL = {}, _lastSupaError = null;
    var _opMergeChain = {}, _opLastPushErr = {}, OP_MERGE_PREFIX = {}, _STAMP_LIST_KEYS = {}, _secAuthAfter = null;
    var DEFAULT_EMPLOYEES = [], OFFBOARD_SETTLE = [['pay','給与'],['tip','チップ']], ROLE_CONFIG = { gm:{ name:'GM' } }, STORES = [{ id:'F01', name:'Store One' }];
    var SAVEFAIL = [];
    function ls(k, d){ var sp = _SPLIT_KEYS && _SPLIT_KEYS[k]; if (sp) return _splitRead(k, sp); var v = _lsStoreGet(k); return v ? JSON.parse(v) : d; }
    function lsKeys(p){ var s = {}; LSMAP.forEach(function(v, k){ s[k] = 1; }); if (_IDB_MEM) _IDB_MEM.forEach(function(v, k){ s[k] = 1; }); return Object.keys(s).filter(function(k){ return k.indexOf(p || '') === 0; }); }
    function put(k, v){ return _lsWriteVerified(k, JSON.stringify(v)); }
    function _lsFreeOldLaborKeys(){ return 0; } function freeRecoverableSpace(){ return {}; } function _lsClearSaveFailure(k){ delete _LS_SAVE_FAIL[k]; } function _lsNoteSaveFailure(k){ _LS_SAVE_FAIL[k] = 1; SAVEFAIL.push(k); }
    function _lsPushBlocked(){ return false; } function _outboxAdd(k){ OUTBOX.add(k); } function _outboxRemove(k){ OUTBOX.delete(k); }
    function _outboxGet(){ return Array.from(OUTBOX).map(function(k){ return { key:k }; }); } function _outboxSet(){}
    var _outboxFlushing = false;
    function supaErrorText(){ return ''; } function _lsMarkFetched(){} function _handleLegacySplitRow(){ return false; }
    function t(a){ return a; } function showToast(m, k){ TOASTS.push([m, k]); } function alert(m){ ALERTS.push(m); } function confirm(){ return typeof CONFIRM === 'function' ? CONFIRM() : CONFIRM; }
    function renderPage(){} function closeModalDirect(){} function openModal(){ MODALS++; } function addNotif(){} function openOBTrainingModal(){} function openOffboardingModal(){}
    function todayISO(){ return '2026-10-15'; } function fmtJP(x){ return String(x).slice(0,10); } function escapeHtml(s){ return String(s==null?'':s); }
    function showSyncSplash(){} function hideSyncSplash(){} function refreshStaffPinsFromCloud(){ return Promise.resolve(); } function refreshStores(){}
    function getOBTemplate(){ return [{ id:'t1', label:'Crew化', type:'完了条件' }]; } function getSkills(){ return {}; } function setSkills(){} function setWorkCondition(){} function getWorkCondition(){ return {}; }
    function doLogout(){ LOGOUTS++; curUserName = null; loginPerson = null; } function managerLogout(){ LOGOUTS++; } function showManagerSecure(){ SECURE++; }
    function invInKeepAll(){ var v = _lsRaw('_invin_signin', null); return (v && v.people) ? v : { v:1, people:{} }; }
    function invInKeepSet(rt, w){ var a = invInKeepAll(); if (rt) a.people[w] = { rt:rt, at:Date.now() }; else delete a.people[w]; put('_invin_signin', a); return true; }
    function invInSession(){ return SESSION; } function invInKept(){ return false; } function invInRestore(){ return Promise.resolve(); } function invInSessionRefresh(){ return Promise.resolve(null); }
    function isOpSyncKey(k){ return /^spl_offboardings_/.test(k); } var SUPA_SETTING_KEYS = [], SUPA_SETTING_PREFIX = [];
    function permFromRole(r){ return r; } function canEditWages(){ return false; } function isMonthlyTitle(){ return false; } function saveEmpPrivate(){}
    ` + parts.join('\n'), c);
  c.run = code => { const r = vm.runInContext(code, c); return r && typeof r.then === 'function' ? r : (r === undefined ? r : J(r)); };
  c.list = () => J(vm.runInContext('ls("m_employees", [])', c));
  c.emp = id => c.list().find(e => e.id === id);
  c.v1085 = v1085;
  c.signIn = (tok = 'tok-gm') => { c.SESSION = { access_token: tok }; };
  c.afterSignIn = async (tok = 'tok-gm') => { c.signIn(tok); const f = vm.runInContext('_secAuthAfter', c); vm.runInContext('_secAuthAfter = null', c); if (f) await f(); };
  return c;
}
async function pulled(S, src, opt) { const d = device(S, src, opt); await d.run('loginBootstrapPull()'); await S.settle(); return d; }
const NOW = fs.existsSync(INDEX) ? loadSource(INDEX) : null;
const BASE = baseSource();
const OB = (o) => `setOffboardings(getOffboardings().concat([${JSON.stringify(o)}]))`;

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
test('the server also refuses a v1084 device that loaded the list after the resignation and brings the person back with its old buttons', { skip: !BASE && 'no base index.html' }, async () => {
  const S = await server();
  const gm = await pulled(S, NOW);
  gm.run("deleteEmp('e1')"); await S.settle();
  const old = await pulled(S, BASE);                                // fresh copy: it holds the current version
  assert.equal(old.emp('e1').status, '退職');
  old.run("setEmpStatusQuick('e1', '在籍')"); await S.settle();      // v1084 sets it directly and saves the whole list
  const r = await S.emp('e1');
  assert.equal(r.data.status, '退職'); assert.equal(r.status, '退職');
  assert.equal((await S.pins())['Ann Sample'], '!blocked', 'her PIN stays stopped');
  assert.ok((await S.log('e1')).some(l => l.kind === 'refused' && l.new_status === '在籍'));
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
  const posted = [];
  const f = S.fetch; S.fetch = async (u, i) => { if ((i?.method || 'GET') === 'POST' && String(u).includes('/rest/v1/employees')) posted.push(JSON.parse(i.body)); return f(u, i); };
  a.run("var emps = getEmployees(); emps.find(function(e){ return e.id==='e2'; }).store = 'F02'; lsSet('m_employees', emps);");
  await S.settle();
  assert.deepEqual(posted.map(rows => rows.map(r => r.id)), [['e2']]);
  assert.equal((await S.emp('e3')).data.title, 'GM (synthetic)');
  assert.equal((await S.emp('e2')).data.store, 'F02');
  assert.equal(a.run('empDirtyCount()'), 0, 'nothing left to send');
  assert.equal(a.emp('e2').store, 'F02');
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

test('v1085: on a device whose localStorage is full, the queue goes to IndexedDB; without IndexedDB it is kept in memory and sent at once', async () => {
  // a GM PC with IndexedDB: localStorage full, the offline resignation survives the next load and is sent
  const S = await server();
  const a = await pulled(S, NOW);
  a.LS_FULL = true; S.down = true;
  a.run("deleteEmp('e1')"); await S.settle(); S.down = false;
  assert.equal(a.run("_IDB_MEM.has('emp_dirty_q')"), true, 'the queue is in IndexedDB');
  await a.run('loginBootstrapPull()'); await S.settle();
  assert.equal(a.emp('e1').status, '退職');
  await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  // no IndexedDB and a full localStorage: lsSet says it failed, the queue stays in memory and is sent right away
  const S2 = await server();
  const b = await pulled(S2, NOW, { idb: false });
  b.LS_FULL = true;
  assert.equal(b.run("var emps = getEmployees(); emps.find(function(e){ return e.id==='e1'; }).status = '退職'; lsSet('m_employees', emps)"), false);
  assert.ok(b.run('SAVEFAIL').includes('emp_dirty_q'), 'shown as not saved on this device');
  await S2.settle(); await new Promise(r => setTimeout(r, 5)); await S2.settle();
  assert.equal((await S2.emp('e1')).data.status, '退職', 'sent from memory');
});

test('v1085: a screen that read the list before a reload saves only what it changed (the reload is not undone)', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  b.run("var HELD = getEmployees();");
  a.run("deleteEmp('e1')"); await S.settle();
  await b.run('loginBootstrapPull()'); await S.settle();
  b.run("HELD.find(function(e){ return e.id==='e2'; }).title = 'Crew Leader'; lsSet('m_employees', HELD);");
  await S.settle();
  assert.equal(b.emp('e1').status, '退職', 'the device keeps the reloaded state');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal((await S.emp('e2')).data.title, 'Crew Leader');
  b.run("var H2 = JSON.parse(HELD.__src); H2.find(function(e){ return e.id==='e1'; }).status = '休職'; Object.defineProperty(H2, '__src', { value: HELD.__src }); lsSet('m_employees', H2);");
  await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職', 'the change made on the version read before is not taken');
  assert.equal(b.emp('e1').status, '退職');
  // the same for a change that is not a reinstatement: another device put Bob on leave after the screen read the list
  a.run("setEmpStatusQuick('e2', '休職')"); await S.settle();
  await b.run('loginBootstrapPull()'); await S.settle();
  b.run("var H3 = JSON.parse(HELD.__src); H3.find(function(e){ return e.id==='e2'; }).status = '退職'; Object.defineProperty(H3, '__src', { value: HELD.__src }); lsSet('m_employees', H3);");
  await S.settle();
  assert.equal((await S.emp('e2')).data.status, '休職', 'sent on the version the screen read, not on the reloaded one');
  assert.equal(b.emp('e2').status, '休職');
});

test('v1085: the edit form saves only what was changed on it — a form opened before another device\'s change does not undo it', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  b.run("window._empForm = { id:'e2', list:getEmployees() }");       // B opens Bob's form
  a.run("setEmpStatusQuick('e2', '休職')"); await S.settle();         // A puts Bob on leave
  await b.run('loginBootstrapPull()'); await S.settle();
  // B changes only the title on the old form; the status select still shows 在籍
  Object.assign(b.DOMV, { 'e-name': 'Bob Sample', 'e-code': '', 'e-role': 'crew', 'e-store': 'F01', 'e-emp': 'パート', 'e-step': '1', 'e-hire': '', 'e-resign': '', 'e-status': '在籍', 'e-email': '', 'e-phone': '', 'e-title': 'Crew Leader', 'e-wc-maxh': '40', 'e-insurance': '', 'e-dental': '' });
  b.run("saveEmp('e2')"); await S.settle();
  const r = await S.emp('e2');
  assert.equal(r.data.title, 'Crew Leader');
  assert.equal(r.data.status, '休職', "A's change stays");
  assert.equal(b.emp('e2').status, '休職');
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
  const c = await pulled(S, NOW);
  S.down = true; c.run("setEmpStatusQuick('e2', '休職')"); await S.settle(); S.down = false;
  await a.run("loginBootstrapPull()"); await S.settle(); a.run("deleteEmp('e2')"); await S.settle();
  const posts = S.calls.filter(x => x.startsWith('POST')).length;
  await c.run('loginBootstrapPull()'); await S.settle();
  assert.equal(c.emp('e2').status, '退職', 'the load shows the cloud state at once');
  assert.ok(c.TOASTS.some(([m]) => /Bob Sample さんの状態は、ほかの端末で先に「退職」/.test(m)));
  assert.equal(c.run('empDirtyCount()'), 0);
  assert.equal(S.calls.filter(x => x.startsWith('POST')).length, posts, 'nothing was sent by the load');
});

test('v1085: a second status change made while the first is being sent is kept (not taken for another device\'s change), also when a load or a failed read-back comes in between', async () => {
  const S = await server({ extra: [['e4', 'Dee Sample', 'crew', 'Crew', 'F01'], ['e5', 'Eli Sample', 'crew', 'Crew', 'F01']] });
  const a = await pulled(S, NOW);
  // 1) leave, then the resignation is pressed while the leave is being sent
  let sent1 = false;
  S.hold = async (url, init) => { if (!sent1 && (init.method || 'GET').toUpperCase() === 'POST' && String(url).includes('/rest/v1/employees')) { sent1 = true; a.run("deleteEmp('e2')"); } };
  a.run("setEmpStatusQuick('e2', '休職')");
  await S.settle(); S.hold = null; await a.run('flushOutbox()'); await S.settle();
  assert.equal(sent1, true);
  assert.ok((await S.log('e2')).some(x => x.kind === 'accepted' && x.new_status === '休職'), 'the leave went in first');
  assert.equal((await S.emp('e2')).data.status, '退職', 'the resignation is not lost');
  assert.equal(a.emp('e2').status, '退職');
  assert.ok(!a.TOASTS.some(([m]) => /ほかの端末で先に/.test(m)), 'not told it was another device');
  assert.equal(a.run('empDirtyCount()'), 0);
  // 2) the read-back after the first push fails; the next change is sent on the version the first one made
  let posted = false, failed = false;
  S.hold = async (url, init) => { const m = (init.method || 'GET').toUpperCase(); if (!String(url).includes('/rest/v1/employees')) return;
    if (m === 'POST') posted = true; else if (posted && !failed) { failed = true; throw new TypeError('Failed to fetch'); } };
  a.run("setEmpStatusQuick('e4', '休職')"); await S.settle(); S.hold = null;
  assert.equal(failed, true); assert.equal((await S.emp('e4')).data.status, '休職');
  a.run("deleteEmp('e4')"); await S.settle(); await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e4')).data.status, '退職');
  assert.ok(!a.TOASTS.some(([m]) => /ほかの端末で先に/.test(m)));
  // 3) a load comes in after the first push went in and before its read-back, while a second change is waiting
  let posted3 = false, loaded = false;
  S.hold = async (url, init) => { const m = (init.method || 'GET').toUpperCase(); if (!String(url).includes('/rest/v1/employees')) return;
    if (m === 'POST') { posted3 = true; return; }
    if (posted3 && !loaded && String(url).includes('id=in')) { loaded = true; a.run("deleteEmp('e5')"); await a.run('loginBootstrapPull()'); } };
  a.run("setEmpStatusQuick('e5', '休職')"); await S.settle(); S.hold = null;
  await a.run('flushOutbox()'); await S.settle();
  assert.equal(loaded, true);
  assert.equal((await S.emp('e5')).data.status, '退職');
  assert.equal(a.emp('e5').status, '退職');
  assert.ok(!a.TOASTS.some(([m]) => /ほかの端末で先に/.test(m)));
  assert.equal(a.run('empDirtyCount()'), 0);
});

test('v1085: the manager e-mail sign-in asks the server when this device still shows the person as resigned (restored elsewhere); without the server it refuses', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run("deleteEmp('e1')"); await S.settle();
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'suspended');
  Object.assign(a.DOMV, { 'mgr-email': 'ann@example.test', 'mgr-pass': 'pw' });
  await a.run('doManagerLogin()'); await S.settle();
  assert.equal(a.SECURE, 0, 'resigned: refused');
  await S.pg.query("select public.employee_restore('e1', 'Gus Sample')");     // restored on another device / by the administrator
  assert.equal(a.emp('e1').status, '退職', 'this device still shows the old state');
  S.hold = async (url) => { if (String(url).includes('/rest/v1/employees')) throw new TypeError('Failed to fetch'); };
  await a.run('doManagerLogin()'); await S.settle(); S.hold = null;
  assert.equal(a.SECURE, 0, 'cannot ask the server: refused as before');
  await a.run('doManagerLogin()'); await S.settle();
  assert.equal(a.SECURE, 1, 'the server says in service: signed in');
  assert.equal(a.emp('e1').status, '在籍', 'and this device takes the server state');
});

test('v1085: a load that started before the resignation was sent does not bring the person back on screen (versions only go up)', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  let release, started = false;
  const gate = new Promise(r => { release = r; });
  S.hold = async (url, init) => { if (!started && String(url).includes('/rest/v1/employees?select=data')) { started = true; const snap = (await S.pg.query('select data from employees order by id')).rows; S.snapshot = snap; await gate; } };
  const f = S.fetch;
  S.fetch = async (u, i) => { const r = await f(u, i); if (S.snapshot && String(u).includes('/rest/v1/employees?select=data')) { const s = S.snapshot; S.snapshot = null; return new Response(JSON.stringify(s), { status: 200 }); } return r; };
  const roster = a.run('_empRosterAt = 0; empRosterRefresh(true)');   // the staff master starts a load (it reads the list before the resignation)
  await tick(); await tick();
  S.hold = null;
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', initiatedAt: '2026-10-10T00:00:00Z', checklist: [], settlement: { pay: true, tip: true } }));
  await a.run("completeOffboarding('ob1')");
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  release(); await roster; await S.settle();
  assert.equal(a.emp('e1').status, '退職', 'the late answer of the old load does not overwrite the newer state');
  assert.deepEqual(a.run('resignRepairCandidates()'), []);
});

test('v1085: 退職手続きを完了 — completes only after the server has the resignation and the sign-in is stopped; a failure is not shown as completed', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', initiatedAt: '2026-10-10T00:00:00Z', checklist: [], settlement: { pay: true, tip: true }, accountDisabled: false }));
  await S.settle();
  S.down = true;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  S.down = false;
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.ok(a.TOASTS.some(([m, k]) => k === 'danger' && /完了にできませんでした/.test(m)));
  // the completion record cannot be sent: not completed either (the resignation itself is on the server)
  S.failAppState = true;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.ok(a.TOASTS.at(-1)[0].includes('完了の記録を送れませんでした'));
  S.failAppState = false;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  const ob = a.run("offboardById('ob1')");
  assert.equal(ob.status, '完了'); assert.equal(ob.completedBy, 'Gus Sample'); assert.match(ob.completedAt, /^2\d{3}-/); assert.ok(ob._stAt);
  assert.equal((await S.records()).find(x => x.id === 'ob1').status, '完了', 'the record is on the server');
  const r = await S.emp('e1');
  assert.equal(r.data.status, '退職'); assert.equal(r.data.osDisabled, true); assert.equal(r.data.resignDate, '2026-10-14');
  assert.equal((await S.pins())['Ann Sample'], '!blocked');
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'suspended');
  assert.equal(a.TOASTS.at(-1)[1], 'success');
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
});

test('v1085: completing when this device already shows 退職 but the cloud does not (nothing queued) sends it on the cloud\'s version', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  // the local table says resigned, but nothing is queued (as on a device whose queue was lost before v1085)
  a.run("var L = ls('m_employees', []); L.find(function(e){ return e.id==='e1'; }).status = '退職'; put('m_employees', L);");
  assert.equal(a.run('empDirtyCount()'), 0);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal((await S.pins())['Ann Sample'], '!blocked');
});

test('v1085: the completion is not shown when the server could not stop the manager account (a failure in the middle)', async () => {
  const S = await server();
  await S.pg.exec("alter table manager_auth add constraint role_ok check (role in ('ceo','gm','office','office_crew'))");
  const a = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.match(a.TOASTS.at(-1)[0], /管理者のアカウント：active/);
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.ok((await S.pg.query("select 1 from employee_status_log where kind='apply_failed'")).rows.length > 0);
  await S.pg.exec('alter table manager_auth drop constraint role_ok');
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'suspended');
});

test('v1085: without the server guard the completion is refused (the sign-in stop cannot be checked)', async () => {
  const S = await server({ guard: false });
  const a = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e2', empName: 'Bob Sample', store: 'F01', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.match(a.TOASTS.at(-1)[0], /20261023090000.*入っていないため/);
});

test('v1085: a namesake in service: the PIN cannot be stopped; completing asks first and records it', async () => {
  const S = await server({ extra: [['e5', 'Ann Sample', 'crew', 'Crew', 'F01']] });
  const a = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  let asked = 0;
  a.CONFIRM = () => (++asked === 1);                                  // "items are not done" → yes; the namesake question → no
  await a.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  assert.match(a.TOASTS.at(-1)[0], /同じ名前の在籍者/);
  a.CONFIRM = true;
  await a.run("completeOffboarding('ob1')"); await S.settle();
  const ob = a.run("offboardById('ob1')");
  assert.equal(ob.status, '完了'); assert.ok(ob.pinShared && ob.pinShared.by === 'Gus Sample');
  assert.equal(a.TOASTS.at(-1)[1], 'warn');
  assert.equal((await S.pins())['Ann Sample'], '4821', 'the namesake keeps the PIN');
});

test('v1085: restore (在籍に戻す) goes through the server with e-mail sign-in; a failed restore changes nothing and is never sent later', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  await a.run("completeOffboarding('ob1')"); await S.settle();
  a.curRole = 'crew';
  await a.run("restoreEmployee('e1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職', 'not allowed for crew');
  a.curRole = 'gm';
  // not signed in by e-mail: the sign-in screen opens, nothing changes
  await a.run("restoreEmployee('e1')"); await S.settle();
  assert.equal(a.MODALS, 1); assert.equal(a.emp('e1').status, '退職'); assert.equal(a.run('empDirtyCount()'), 0);
  // signed in, but the network fails: nothing changes here either (not shown as in service, nothing queued)
  S.down = true; await a.afterSignIn(); await S.settle(); S.down = false;
  assert.equal(a.emp('e1').status, '退職'); assert.equal(a.run('empDirtyCount()'), 0);
  assert.equal(a.run("offboardById('ob1').status"), '完了');
  assert.ok(a.TOASTS.at(-1)[0].includes('在籍に戻せませんでした'));
  await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職', 'nothing is sent later');
  // an account that is not CEO / GM / AM / accounting
  a.signIn('tok-crew'); await a.run("restoreEmployee('e1', true)"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.match(a.TOASTS.at(-1)[0], /在籍に戻せません（CEO・GM・AM・経理/);
  // auth-pin is still the old version (does not know "restore"): told so, nothing changes
  a.signIn('tok-gm'); S.oldPin = true; await a.run("restoreEmployee('e1', true)"); await S.settle(); S.oldPin = false;
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.match(a.TOASTS.at(-1)[0], /auth-pin）が古い版/);
  // the GM's e-mail account: in service, the record 取消 on the server and here, the PIN and the manager account back
  a.signIn('tok-gm'); await a.run("restoreEmployee('e1', true)"); await S.settle();
  const r = await S.emp('e1');
  assert.equal(r.data.status, '在籍'); assert.equal(r.data._restoreBy, 'Gus Sample');
  assert.equal(a.emp('e1').status, '在籍');
  assert.equal(a.run("offboardById('ob1').status"), '取消');
  assert.equal((await S.records()).find(x => x.id === 'ob1').status, '取消');
  assert.equal((await S.pins())['Ann Sample'], '4821');
  assert.equal((await S.pg.query("select role from manager_auth where emp_id='e1'")).rows[0].role, 'office');
  assert.equal(a.run('empDirtyCount()'), 0);
});

test('v1085: a record that was cancelled on another device (restored) is not completed from a stale copy', async () => {
  const S = await server();
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  a.run("deleteEmp('e1')"); await S.settle();
  await b.run('offboardPullNow()'); await S.settle();
  a.signIn(); await a.run("restoreEmployee('e1', true)"); await S.settle();   // A restores her (the record becomes 取消 on the server)
  assert.equal((await S.records())[0].status, '取消');
  assert.equal(b.run("offboardById('ob1').status"), '進行中', 'B still shows the old copy');
  await b.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(b.run("offboardById('ob1').status"), '取消');
  assert.match(b.TOASTS.at(-1)[0], /取消/);
  assert.equal((await S.emp('e1')).data.status, '在籍', 'B did not resign her again');
});

test('v1085: the quick status buttons and the onboarding never bring a resigned person back by name', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run("deleteEmp('e1')"); await S.settle();
  a.run(`put('onboardings', [{ id:'on1', name:'Ann Sample', done:[], template:[{ id:'t1', label:'Crew化', type:'完了条件' }] }])`);
  a.run("toggleOBTask('on1', 't1')"); await S.settle();
  assert.equal(a.emp('e1').status, '退職');
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.ok(a.TOASTS.some(([m]) => /在籍には戻していません/.test(m)));
  Object.assign(a.DOMV, { 'pr-role': 'crew', 'pr-emp': 'パート', 'pr-wage': '16', 'pr-firstwork': '', 'pr-days': 'any', 'pr-maxh': '40' });
  a.run("finalizePayroll('on1')");
  assert.equal(a.list().filter(e => e.name === 'Ann Sample').length, 1);
  assert.ok(a.TOASTS.some(([m]) => /同じ名前の退職者がいます/.test(m)));
  a.run(`var emps = getEmployees(); emps.push({ id:'e9', name:'Ann Sample', role:'crew', store:'F01', status:'研修中', step:0 }); lsSet('m_employees', emps);`);
  a.run(`put('onboardings', [{ id:'on2', name:'Ann Sample', empId:'e9', done:[], template:[{ id:'t1', label:'Crew化', type:'完了条件' }] }])`);
  a.run("toggleOBTask('on2', 't1')"); await S.settle();
  assert.equal(a.emp('e9').status, '在籍'); assert.equal(a.emp('e1').status, '退職');
  a.run("var R = []; restoreEmployee = function(id){ R.push(id); }; setEmpStatusQuick('e1', '在籍');");
  assert.deepEqual(a.run('R'), ['e1']);
});

test('v1085: undoing an offboarding approval re-reads the record (completed elsewhere: refused) and restores through the server (record back to 申請中)', async () => {
  const S = await server({ extra: [['e4', 'Dee Sample', 'crew', 'Crew', 'F01']] });
  const a = await pulled(S, NOW), b = await pulled(S, NOW);
  // the approval on A started the offboarding (Ann resigned, record 進行中); B (stale copy of the record) completes it
  a.run(OB({ id: 'ob1', empId: 'e1', empName: 'Ann Sample', store: 'OFFICE', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  a.run("deleteEmp('e1')"); a.run(`put('approvals', [{ id:'ap1', type:'退職', ref:'ob1', status:'approved' }])`); await S.settle();
  await b.run("offboardPullNow()"); await b.run("loginBootstrapPull()"); await S.settle();
  await b.run("completeOffboarding('ob1')"); await S.settle();
  assert.equal(b.run("offboardById('ob1').status"), '完了');
  // A still shows 進行中: the undo reads the server first and refuses
  assert.equal(a.run("offboardById('ob1').status"), '進行中');
  await a.run("reopenApproval('ap1')"); await S.settle();
  assert.match(a.ALERTS.at(-1), /完了しています。承認は取り消せません/);
  assert.equal(a.run("ls('approvals', [])[0].status"), 'approved');
  assert.equal((await S.emp('e1')).data.status, '退職');
  // an in-progress approval can be undone: Bob comes back through the server (e-mail), the record goes back to 申請中
  a.run(OB({ id: 'ob2', empId: 'e2', empName: 'Bob Sample', store: 'F01', status: '進行中', lastWorkDate: '2026-10-14', checklist: [], settlement: { pay: true, tip: true } }));
  a.run("deleteEmp('e2')"); a.run(`put('approvals', [{ id:'ap2', type:'退職', ref:'ob2', status:'approved' }])`); await S.settle();
  await a.run("reopenApproval('ap2')"); await S.settle();
  assert.equal(a.MODALS, 1, 'asks for the e-mail sign-in first'); assert.equal(a.run("ls('approvals', [])[0].status"), 'approved');
  await a.afterSignIn(); await S.settle();
  assert.equal((await S.emp('e2')).data.status, '在籍');
  const o2 = a.run("offboardById('ob2')");
  assert.equal(o2.status, '申請中'); assert.equal(o2._gen, 1);
  assert.equal((await S.records()).find(x => x.id === 'ob2').status, '申請中', 'the server takes 申請中 (the record was not final)');
  assert.equal(a.run("ls('approvals', [])[0].status"), 'pending');
  // the undo races with a completion on another device (the record becomes 完了 while restoring): the record is not set back,
  // the person is in service with a completed record → told, and listed for the repair (no "restored" mark)
  a.run(OB({ id: 'ob4', empId: 'e4', empName: 'Dee Sample', store: 'F01', status: '進行中', lastWorkDate: '2026-10-14', initiatedAt: '2026-10-14T00:00:00Z', checklist: [], settlement: { pay: true, tip: true } }));
  a.run("deleteEmp('e4')"); a.run(`put('approvals', [{ id:'ap4', type:'退職', ref:'ob4', status:'approved' }])`); await S.settle();
  S.hold = async (url, init) => { if (!String(url).includes('/functions/v1/auth-pin') || JSON.parse(init.body).action !== 'restore') return; S.hold = null;
    const v = (await S.records()).map(x => x.id === 'ob4' ? { ...x, status: '完了', completedAt: '2026-10-15T00:00:00Z', completedBy: 'Gus Sample' } : x);
    await S.pg.query("update app_state set value = $1 where key = 'spl_offboardings__'", [JSON.stringify(v)]); };
  await a.run("reopenApproval('ap4', true)"); await S.settle();
  assert.match(a.ALERTS.at(-1), /ほかの端末でこの退職手続きが完了/);
  assert.equal(a.run("ls('approvals', [])[0].status"), 'approved');
  assert.equal((await S.records()).find(x => x.id === 'ob4').status, '完了');
  assert.equal((await S.emp('e4')).data.status, '在籍'); assert.equal((await S.emp('e4')).data._restoreAt, undefined);
  assert.ok(a.run("resignRepairCandidates().map(function(x){ return x.e.id; })").includes('e4'), 'listed for the repair');
  // the edit form cannot leave 退職
  Object.assign(a.DOMV, { 'e-name': 'Ann Sample', 'e-status': '在籍' });
  a.run("saveEmp('e1')"); await S.settle();
  assert.match(a.ALERTS.at(-1), /在籍に戻す/);
  assert.equal((await S.emp('e1')).data.status, '退職');
});

test('v1085: a grade change that is rolled back leaves nothing queued to send', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run(`var tx = ghTxnBegin(); var emps = getEmployees(); emps.find(function(e){ return e.id==='e2'; }).title = 'Shift Leader'; lsSet('m_employees', emps); tx.fail.push('grade_hist'); var OK = ghTxnEnd(tx);`);
  assert.equal(a.run('OK'), false);
  assert.equal(a.emp('e2').title, 'Crew', 'the table is back');
  assert.equal(a.run('empDirtyCount()'), 0, 'and the queue too');
  await a.run('flushOutbox()'); await S.settle();
  assert.equal((await S.emp('e2')).data.title, 'Crew', 'nothing reaches the server');
  // a transaction that succeeds sends as usual
  a.run(`var tx2 = ghTxnBegin(); var e2 = getEmployees(); e2.find(function(e){ return e.id==='e2'; }).title = 'Shift Leader'; lsSet('m_employees', e2); var OK2 = ghTxnEnd(tx2);`);
  await S.settle();
  assert.equal((await S.emp('e2')).data.title, 'Shift Leader');
});

test('v1085: the one-time fixes while the app is starting do not queue the old copy (the load brings the latest, as before)', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  a.run('_supaBooting = true');
  a.run("var L = ls('m_employees', []); L.find(function(e){ return e.id==='e2'; }).title = 'Old fix'; lsSet('m_employees', L);");
  assert.equal(a.run('empDirtyCount()'), 0);
  a.run('_supaBooting = false');
  await a.run('loginBootstrapPull()'); await S.settle();
  assert.equal(a.emp('e2').title, 'Crew');
});

test('v1085: a row the server refuses does not block the others; it is marked and sent again only after it is edited', async () => {
  const S = await server();
  const a = await pulled(S, NOW);
  S.down = true;
  a.run("var L = getEmployees(); L.find(function(e){ return e.id==='e2'; }).__bad = 1; L.find(function(e){ return e.id==='e3'; }).title = 'GM (synthetic)'; lsSet('m_employees', L);");
  await S.settle(); S.down = false;
  await a.run('empPushDirty()'); await S.settle();
  assert.equal((await S.emp('e3')).data.title, 'GM (synthetic)', 'the good row goes in');
  assert.equal(a.run('empDirtyCount()'), 0, 'the refused one is not retried by itself');
  assert.ok(a.run('_empDirtyGet()').e2.err.status === 400);
  assert.ok(a.TOASTS.some(([m]) => /受け付けませんでした（400）/.test(m)));
  // a save of someone else, on a list where the private fields (wage, e-mail) were laid over, does not clear the mark
  const posts = S.calls.filter(x => x.startsWith('POST /rest/v1/employees')).length;
  a.run("window._empPrivate = { e2: { wage: 21, email: 'bob@example.test', phone: '' }, e1: { wage: 30, email: '', phone: '' } }; var L1 = getEmployees(); L1.find(function(e){ return e.id==='e1'; }).title = 'Accountant II'; lsSet('m_employees', L1);");
  await S.settle();
  assert.ok(a.run('_empDirtyGet()').e2.err, 'still marked');
  assert.equal((await S.emp('e1')).data.title, 'Accountant II');
  assert.equal(S.calls.filter(x => x.startsWith('POST /rest/v1/employees')).length, posts + 1, 'only the edited person is sent');
  assert.equal((await S.emp('e1')).data.wage, undefined, 'the private fields are not sent');
  a.run("var L2 = getEmployees(); delete L2.find(function(e){ return e.id==='e2'; }).__bad; lsSet('m_employees', L2);");   // fixed: sent again
  await S.settle();
  assert.equal(a.run('empDirtyCount()'), 0);
});

test('v1085: a signed-in person who is resigned on another device is signed out on the next check; one restored elsewhere is not', async () => {
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
  // Bob's device has a stale local copy that says resigned, but the server says in service: not signed out, the copy is brought up to date
  const bob = await pulled(S, NOW, { user: 'Bob Sample', role: 'crew', me: { id: 'e2', name: 'Bob Sample' } });
  bob.run("var L = ls('m_employees', []); L.find(function(e){ return e.id==='e2'; }).status = '退職'; put('m_employees', L);");
  assert.equal(await bob.run("empAccessCheck('force')"), 'ok');
  assert.equal(bob.LOGOUTS, 0); assert.equal(bob.emp('e2').status, '在籍');
  // the same stale copy with no network: right after the sign-in it decides from the copy (fail closed); later checks wait
  bob.run("var L = ls('m_employees', []); L.find(function(e){ return e.id==='e2'; }).status = '退職'; put('m_employees', L);");
  S.down = true;
  assert.equal(await bob.run("_eacAt = 0; empAccessCheck('tick')"), null);
  assert.equal(await bob.run("empAccessCheck('login')"), 'out');
  S.down = false;
  // a shared store account is not an employee: not checked
  const store = await pulled(S, NOW, { user: 'Store One', role: 'sl' });
  store.run('curStoreLogin = true');
  assert.equal(await store.run("empAccessCheck('force')"), null);
  // secure (e-mail) sign-in: the employee linked to the account decides
  const sec = await pulled(S, NOW, { user: 'Gus Sample', role: 'gm', me: { id: 'e3', name: 'Gus Sample' } });
  sec.run("window._secureMode = true; window._authSession = { emp_id: 'e1' }");
  assert.equal(sec.run('_empMeId()'), 'e1');
  assert.equal(await sec.run("empAccessCheck('force')"), 'out');
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
  const S = await server();
  const g = await pulled(S, NOW);
  // a resurrected Ann (what the old code did): the database owner sets her back in service, so the version moves on
  await S.pg.query(`update employees set status='在籍', data = data || '{"status":"在籍","hireDate":"2025-01-01"}' where id='e1'`);
  await g.run('loginBootstrapPull()'); await S.settle();
  g.run(`put('spl_offboardings__', [
    { id:'ob1', empId:'e1', empName:'Ann Sample', status:'完了', completedAt:'2026-10-12T01:00:00Z', completedBy:'Gus Sample', lastWorkDate:'2026-10-11', initiatedAt:'2026-10-01T00:00:00Z' },
    { id:'ob2', empId:'e2', empName:'Bob Sample', status:'進行中', initiatedAt:'2026-10-05T00:00:00Z' },
    { id:'ob0', empId:'e3', empName:'Gus Sample', status:'取消', initiatedAt:'2026-09-01T00:00:00Z' }])`);
  assert.deepEqual(g.run('resignRepairCandidates().map(function(x){ return x.e.id; })'), ['e1'], 'no record, no guess (Bob is in progress, Gus was cancelled)');
  g.curRole = 'office'; await g.run("resignRepairApply('e1', 'ob1')");
  assert.equal(g.emp('e1').status, '在籍', 'only GM / CEO');
  g.curRole = 'gm'; await g.run("resignRepairApply('e1', 'ob1')"); await S.settle();
  assert.equal((await S.emp('e1')).data.status, '退職');
  assert.equal(g.emp('e1').resignDate, '2026-10-11');
  assert.equal((await S.pins())['Ann Sample'], '!blocked');
  assert.deepEqual(g.run('resignRepairCandidates()'), []);
  // "keep in service" (a rehire) takes the person off the list without changing the status; the mark reaches the server
  await S.pg.query(`update employees set status='在籍', data = data || '{"status":"在籍","osDisabled":false}' where id='e1'`);
  await g.run('loginBootstrapPull()'); await S.settle();
  assert.equal(g.run('resignRepairCandidates().length'), 1);
  g.run("resignRepairKeep('e1', 'ob1')"); await S.settle();
  assert.equal(g.run('resignRepairCandidates().length'), 0);
  assert.equal((await S.emp('e1')).data._resignOk.ob, 'ob1');
  const other = await pulled(S, NOW);
  other.run(`put('spl_offboardings__', [{ id:'ob1', empId:'e1', empName:'Ann Sample', status:'完了', completedAt:'2026-10-12T01:00:00Z', initiatedAt:'2026-10-01T00:00:00Z' }])`);
  assert.equal(other.run('resignRepairCandidates().length'), 0, 'other devices see the mark too');
  assert.equal((await S.emp('e1')).data.status, '在籍');
});

// ---------------------------------------------------------------------------------------------------- the offboarding merge
test('v1085: the offboarding record moves forward only: 完了 is final except 取消; undoing an approval wins by generation before that', () => {
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
  const oldStale = { id: 'o', status: '進行中' };
  assert.equal(m([done], [oldStale])[0].status, '完了');
  assert.equal(m([{ id: 'o', status: '取消' }], [done])[0].status, '取消');
  assert.equal(m([done], [{ id: 'o', status: '取消' }])[0].status, '取消');
  // undoing the approval (申請中 with a higher generation) wins over a stale 進行中 with a later clock …
  const reopened = { id: 'o', status: '申請中', _gen: 1, _stAt: '2026-10-11T00:00:00Z' };
  const later = { id: 'o', status: '進行中', _stAt: '2026-10-12T00:00:00Z' };
  assert.equal(m([later], [reopened])[0].status, '申請中');
  assert.equal(m([reopened], [later])[0].status, '申請中');
  // … but not over a completion (a stale undo does not lose the 完了 record)
  assert.equal(m([done], [{ ...reopened, _gen: 5 }])[0].status, '完了');
  assert.equal(m([{ ...reopened, _gen: 5 }], [done])[0].status, '完了');
  // a rejection on one device does not beat an approval on another by rank: the newer decision
  assert.equal(m([{ id: 'o', status: '却下', _stAt: '2026-10-11T00:00:00Z' }], [{ id: 'o', status: '進行中', _stAt: '2026-10-12T00:00:00Z' }])[0].status, '進行中');
  assert.equal(m([{ id: 'o', status: '却下', _stAt: '2026-10-13T00:00:00Z' }], [{ id: 'o', status: '進行中', _stAt: '2026-10-12T00:00:00Z' }])[0].status, '却下');
  // the same generation: an approval (進行中) is not turned back to 申請中 by a stale copy with a wrong (later) clock
  const pending = { id: 'o', status: '申請中', _stAt: '2026-10-14T00:00:00Z' }, approved = { id: 'o', status: '進行中', _stAt: '2026-10-12T00:00:00Z', approvedBy: 'Gus' };
  assert.equal(m([approved], [pending])[0].status, '進行中');
  assert.equal(m([pending], [approved])[0].approvedBy, 'Gus');
  assert.equal(m([{ ...done, _deleted: true }], [stale])[0]._deleted, true);
  assert.equal(d.run(`_coversOffboard([${JSON.stringify(done)}], [${JSON.stringify(oldStale)}])`), true);
  assert.equal(d.run(`_coversOffboard([${JSON.stringify(stale)}], [${JSON.stringify(done)}])`), false);
  d.run(`setOffboardings([{ id:'x', status:'進行中' }]); var A = getOffboardings(); A[0].status = '完了'; setOffboardings(A);`);
  const x = d.run("offboardById('x')");
  assert.ok(x._stAt && x._mut); assert.equal(x._stBy, 'Gus Sample');
});
