// v1144（2b の 6 つ目）のアプリ側：従業員の表の個人の欄（生年月日・会社カードの下 4 桁・保険の加入・保険料）を、関数 secure-state で読み書きする。
// アプリの本物の関数（ssCall・piiLoad・piiSave・piiOverlay・piiFormState・カードの照合・保険料の合計・人件費の storeInsuranceMonthly）を vm で動かし、
// 本物の関数（handler）と合成のクラウドにつなぐ。前の版の関数は、入れる一式の v1143 の 1 ファイル。合成データだけ（架空の人・店）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, ts6 } from './lib/secure-state-world.mjs';

const source = readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  start += 1;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };

// 前の版の関数（v1143）：入れる一式の 1 ファイル
const v1143Src = readFileSync(new URL('../deploy/secure-settings-v1143/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1143-'));
writeFileSync(join(tmp, 'handler.mjs'), v1143Src);
const { createHandler: createHandler1143 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaHeaders', 'escapeHtml', 'docVal', 'empsByCardLast4', 'invMatchEmp', 'empInsuranceAmt', 'storeInsuranceMonthly'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _supaBooting=false, _lastSupaError=null, _opLastPushErr={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curStore='', curPage='staff_master', curLang='ja', __toasts=[], __rendered=[], __tracks=[];
   var MEM=new Map(), EMPLIST=[], __pushed=[];
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsWriteVerified(k, j){ MEM.set(k, j); return true; }
   function _lsMarkFetched(){}
   function ls(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function lsKeys(){ return [...MEM.keys()]; }
   function csIsKey(){ return false; } function csOnLogout(){} function hrOnLogout(){}
   function invInSession(){ return null; } async function invInSessionRefresh(){ return null; }
   function showToast(m, kind){ __toasts.push([kind, m]); } function renderPage(p){ __rendered.push(p); }
   function t(a){ return a; }
   /* アプリの getEmployees と同じ：端末の表に、関数から読んだ個人の欄を重ねる */
   function getEmployees(){ var l=JSON.parse(JSON.stringify(EMPLIST)); piiOverlay(l); return l; }
   function gradeNum(g){ return g ? (parseInt(String(g).replace('G',''))||0) : 0; }
   function empGrade(e){ var m={ 'Store Manager':'G4', 'Server Leader':'G3', 'Crew Leader':'G2', 'Crew':'G1', 'General Manager':'G6' }; return m[e && e.title] || ''; }
   /* 新しい人：社員の行をクラウドに送る（アプリの empPushDirty の代わり） */
   async function empPushDirty(){ __pushed.push(1); if(typeof __onPush==='function') await __onPush(); return true; }
   var __onPush=null;
   var FUNERGY_UX={ _track:function(key, p, opt){ var rec={ key:key, label:opt && opt.label, res:undefined }; __tracks.push(rec); Promise.resolve(p).then(function(r){ rec.res=r; }); return rec; } };
   var document={ getElementById:function(id){ return __els[id] || null; }, createElement:function(){ return { set innerHTML(h){ this.firstChild={ innerHTML:h.replace(/^<div[^>]*>|<\\/div>$/g,'') }; } }; } }, __els={};`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S2', role: 'am', title: 'Area Manager' },
  { id: 'E-SM', name: 'Sam Manager', store: 'S1', role: 'sl', title: 'Store Manager', data: { dob: '1985-05-05', cardLast4: '1111', insurance: true, dental: false, insuranceAmt: 300 } },
  { id: 'E-SL', name: 'Sally Lead', store: 'S2', role: 'sl', title: 'Server Leader', data: { dob: '1990-03-03', cardLast4: '2222', insuranceAmt: 100 } },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', data: { dob: '2001-01-01' } },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tOC: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S2'], am_stores: ['S2'], name: 'Amy Area' },
  tSL: { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Sally Lead', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const USER = { tGM: ['gm', 'Gina M', 'S1'], tOC: ['office_crew', 'Oscar', 'HQ'], tAM: ['am', 'Amy Area', 'S2'], tSL: ['sl', 'Sally Lead', 'S2'], t1: ['crew', 'Kai One', 'S1'], store: ['sl', 'Beta Ward', 'S2'] };
const T0 = ts6(Date.UTC(2026, 10, 3, 9, 0, 0));
const PII0 = { 'E-SL': { dob: '1990-04-04', cardLast4: '2222,3333', insurance: true, dental: true, insuranceAmt: 120, _at: 'x', _by: 'Gina M' } };

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => JSON.parse(JSON.stringify(e))), stores: [], mgr: {}, ...o });
  W.ssHandler = handlerFor(W, o.old);
  W.set('emp_pii', PII0, T0);
  return W;
}
function handlerFor(W, old) {
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  let clock = Date.UTC(2026, 10, 9, 11, 0, 0);
  return (old ? createHandler1143 : createHandler)({ env, fetch: W.fetch, now: () => (clock += 1000) });
}
// 端末の表（アプリが従業員の表から取り込んだ形：data の中身）。v1144 の SQL の前は個人の欄も入っている
const empList = W => W.emps.map(e => ({ ...(e.data || {}), id: e.id, name: e.name, store: e.store, role: e.role, title: e.title, status: e.status || '在籍' }));
function tab(W, who, fetchWrap) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => (fetchWrap ? fetchWrap(u, o) : W.fetch(u, o)), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  vm.runInContext('EMPLIST=' + JSON.stringify(empList(W)) + ';', c);
  if (who) {
    if (who === 'store') vm.runInContext('curStoreLogin=true;', c);
    else c._hwSession = who;
    const [r, n, st] = USER[who];
    vm.runInContext('curRole=' + JSON.stringify(r) + '; curRealRole=curRole; curUserName=' + JSON.stringify(n) + '; curStore=' + JSON.stringify(st) + ';', c);
  }
  return c;
}
const run = (c, src) => vm.runInContext(src, c);
const J = x => JSON.parse(JSON.stringify(x));
const emp = (c, id) => J(run(c, `getEmployees().find(function(e){ return e.id===${JSON.stringify(id)}; })`));
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 30; i++) await flush(); };

test('reading: the function answers piifn:1 -> the device routes the fields; only the scope is placed (memory only); the table copy is overlaid', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  assert.equal(c.piiFnSeen(), false, 'not seen yet');
  assert.equal(await c.piiLoad(), 'ok');
  assert.equal(c.piiFnSeen(), true);
  assert.equal(c.piiLevel(), 'full');
  assert.deepEqual({ dob: emp(c, 'E-SL').dob, amt: emp(c, 'E-SL').insuranceAmt, card: emp(c, 'E-SL').cardLast4 }, { dob: '1990-04-04', amt: 120, card: '2222,3333' }, 'emp_pii first');
  assert.equal(emp(c, 'E-SM').dob, '1985-05-05');
  assert.deepEqual([...c.MEM.keys()], [], 'nothing in the device copy');
  assert.deepEqual([...c.localStorage._m.keys()], ['_ss_pii_fn'], 'only the mark on the device (the fields stay in memory)');
  // ログアウトで消える（次の人に残さない）
  run(c, 'ssOnLogout()');
  assert.equal(c.piiReady(), false);
  run(c, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");   // SQL のあと（従業員の表に無い）
  assert.equal(emp(c, 'E-SL').dob, undefined, 'no overlay after logout');
});

test('reading: an office crew gets only "has a birthday"; a crew does not ask; a store tablet does not ask', async () => {
  const W = world();
  const oc = tab(W, 'tOC');
  assert.equal(await oc.piiLoad(), 'ok');
  assert.equal(oc.piiLevel(), 'flag');
  run(oc, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");
  assert.equal(emp(oc, 'E-1')._dobSet, true);
  assert.equal(emp(oc, 'E-1').dob, undefined);
  assert.equal(emp(oc, 'E-GM')._dobSet, undefined);
  assert.equal(oc.piiDobKnown(), true);
  const crew = tab(W, 't1');
  const n0 = W.calls.ss;
  assert.equal(await crew.piiLoad(), 'none');
  const st = tab(W, 'store');
  assert.equal(await st.piiLoad(), 'none');
  assert.equal(W.calls.ss, n0, 'no request');
});

test('reading: the v1143 function (no piifn) -> as before (the table); seeing it again removes the mark', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  c.localStorage.setItem('_ss_pii_fn', '1');   // 前に v1144 を見ていた（関数を戻した）
  assert.equal(await c.piiLoad(), 'rest');
  assert.equal(c.piiFnSeen(), false, 'back to the employee table');
  assert.equal(c.piiDobKnown(), true, 'the error center checks the table copy as before');
  assert.equal(emp(c, 'E-SM').dob, '1985-05-05');
});

test('reading: the login changed while reading -> nothing placed (a late answer is not given to the next person)', async () => {
  const W = world();
  let c;
  c = tab(W, 'tGM', async (u, o) => { const r = await W.fetch(u, o); vm.runInContext("curUserName='Kai One'; curRole='crew'; _hwSession='t1';", c); return r; });
  assert.equal(await c.piiLoad(), 'stale');
  assert.equal(c.piiReady(), false);
});

test('the error center: "no birthday" is not said until the fields are read (then for the people who see them)', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  c.localStorage.setItem('_ss_pii_fn', '1');
  assert.equal(c.piiDobKnown(), false, 'not read yet');
  await settle();
  assert.equal(c.piiReady(), true, 'piiDobKnown started the read');
  assert.equal(c.piiDobKnown(), true);
  const sl = tab(W, 'tSL');
  sl.localStorage.setItem('_ss_pii_fn', '1');
  assert.equal(await sl.piiLoad(), 'none', 'a store leader does not read (no staff master)');
  assert.equal(sl.piiDobKnown(), false, 'and does not check birthdays (the error center is not theirs)');
});

test('saving: the changed fields with the opened values; the copy is updated; the amount refreshes the store totals', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  await c.piiLoad();
  const base = J(run(c, "piiPick(getEmployees().find(function(e){ return e.id==='E-SM'; }))"));
  const ch = J(run(c, `piiChanges(${JSON.stringify(base)}, { dob:'1985-06-06', cardLast4:'1111', insurance:true, dental:false, insuranceAmt:350, name:'x' })`));
  assert.deepEqual(ch, { set: { dob: '1985-06-06', insuranceAmt: 350 }, base: { dob: '1985-05-05', insuranceAmt: 300 } });
  assert.deepEqual(J(run(c, "piiChanges({ dob:'' }, { dob:'2026-02-30' })")), { bad: 'dob' });
  assert.equal(run(c, "piiChanges({ dob:null, insurance:null }, { dob:'', insurance:false, cardLast4:'' })"), null, 'empty = missing = false');
  const r = await run(c, `piiSave('E-SM', ${JSON.stringify(ch.set)}, ${JSON.stringify(ch.base)}, false)`);
  assert.equal(r, true);
  assert.equal(W.get('emp_pii')['E-SM'].dob, '1985-06-06');
  assert.equal(W.get('emp_pii')['E-SM'].insuranceAmt, 350);
  assert.equal(emp(c, 'E-SM').dob, '1985-06-06', 'the copy shows the new value');
  await settle();
  assert.equal(J(run(c, '_insTot.totals')).S1, 350, 'the store totals were read again');
  const tr = J(run(c, '__tracks'));
  assert.equal(tr[0].key, 'emp_pii_E-SM'); assert.equal(tr[0].res, true);
});

test('saving: another device changed the same field first -> "conflict", a message, the fields are read again; nothing written', async () => {
  const W = world();
  const a = tab(W, 'tGM'), b = tab(W, 'tGM');
  await a.piiLoad(); await b.piiLoad();
  assert.equal(await run(a, "piiSave('E-1', { dob:'2001-02-02' }, { dob:'2001-01-01' }, false)"), true);
  const v0 = JSON.stringify(W.get('emp_pii'));
  assert.equal(await run(b, "piiSave('E-1', { dob:'2001-03-03' }, { dob:'2001-01-01' }, false)"), 'conflict');
  assert.equal(JSON.stringify(W.get('emp_pii')), v0);
  assert.ok(J(run(b, '__toasts')).some(([k, m]) => k === 'warning' && /ほかの端末で同じ欄が先に変わっていました/.test(m)));
  await settle();
  assert.equal(emp(b, 'E-1').dob, '2001-02-02', 'read again');
});

test('saving: a new person by an AM waits for the employee row; a person outside the scope fails with a message (and can be sent again)', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await c.piiLoad();
  // 新しい人：社員の行が送られてから（ここで合成のクラウドに足す）
  c.__onPush = async () => { W.emps.push({ id: 'E-NEW', name: 'New Sample', store: 'S2', role: 'crew', title: 'Crew' }); };
  assert.equal(await run(c, "piiSave('E-NEW', { dob:'2003-03-03' }, { dob:null }, true)"), true);
  assert.equal(J(run(c, '__pushed')).length, 1);
  assert.equal(W.get('emp_pii')['E-NEW'].dob, '2003-03-03');
  // 担当の外の店の人：403 → 失敗（保存していない）
  assert.equal(await run(c, "piiSave('E-SM', { dob:'' }, { dob:'1985-05-05' }, false)"), 'failed');
  assert.ok(J(run(c, '__toasts')).some(([k, m]) => k === 'danger' && /このアカウントでは直せません/.test(m)));
  assert.equal(W.get('emp_pii')['E-SM'], undefined);
});

test('the edit form: the fields are stopped until read; then filled and editable; the amount only for GM・CEO', async () => {
  const W = world();
  const mk = c => run(c, "__els={ 'e-dob':{ value:'', disabled:true }, 'e-cardlast4':{ value:'', disabled:true }, 'e-insurance':{ checked:false, disabled:true }, 'e-dental':{ checked:false, disabled:true }, 'e-insurance-amt':{ value:'', disabled:true }, 'e-pii-note':{ innerHTML:'', remove:function(){ this.removed=true; } } };");
  const c = tab(W, 'tGM');
  c.localStorage.setItem('_ss_pii_fn', '1');
  run(c, "window._empForm={ id:'E-SL', list:getEmployees() };");
  mk(c);
  const st = J(run(c, "piiFormState('E-SL')"));
  assert.equal(st.lock, true); assert.match(st.note, /読み込んでいます/);
  await settle();
  const els = J(run(c, '__els'));
  assert.equal(els['e-dob'].value, '1990-04-04'); assert.equal(els['e-dob'].disabled, false);
  assert.equal(els['e-cardlast4'].value, '2222,3333');
  assert.equal(els['e-insurance'].checked, true); assert.equal(els['e-dental'].checked, true);
  assert.equal(String(els['e-insurance-amt'].value), '120');   // 本物の入力欄は文字にする assert.equal(els['e-insurance-amt'].disabled, false);
  assert.equal(els['e-pii-note'].removed, true);
  assert.deepEqual(J(run(c, 'window._empForm.pii')), { dob: '1990-04-04', cardLast4: '2222,3333', insurance: true, dental: true, insuranceAmt: 120 }, 'the base for the save');
  // AM：4 つは直せる・保険料は止める
  const am = tab(W, 'tAM'); am.localStorage.setItem('_ss_pii_fn', '1');
  await am.piiLoad();
  assert.deepEqual(J(run(am, "piiFormState('E-SL')")), { note: '', lock: false, lockAmt: true });
  // 読めない人（範囲なし）：止めて、そう言う
  const oc = tab(W, 'tOC'); oc.localStorage.setItem('_ss_pii_fn', '1');
  await oc.piiLoad();
  const so = J(run(oc, "piiFormState('E-SL')"));
  assert.equal(so.lock, true); assert.match(so.note, /このアカウントでは/);
  // 前の版の関数：今までどおり（止めない）
  const old = tab(W, 'tGM');
  assert.deepEqual(J(run(old, "piiFormState('E-SL')")), { note: '', lock: false, lockAmt: false });
});

test('card match: asked to the server and cached; the receipt form picks the person; a store tablet chooses by hand', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  c.localStorage.setItem('_ss_pii_fn', '1');
  run(c, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");   // SQL のあと
  run(c, "__els={ 'inv-card4':{ value:'3333' }, 'inv-card-match':{ innerHTML:'' }, 'inv-emp':{ value:'' } };");
  run(c, 'invMatchEmp()');
  assert.match(J(run(c, "__els['inv-card-match'].innerHTML")), /照合しています/);
  await settle();
  assert.match(J(run(c, "__els['inv-card-match'].innerHTML")), /Sally Lead を自動特定/);
  assert.equal(J(run(c, "__els['inv-emp'].value")), 'E-SL');
  assert.deepEqual(J(run(c, "empsByCardLast4('3333')")).map(e => e.id), ['E-SL'], 'from the cache');
  const n0 = W.calls.ss;
  run(c, 'invMatchEmp()'); await settle();
  assert.equal(W.calls.ss, n0, 'cached: no second request');
  // まとめて：何件でも 20 件ずつ
  assert.equal(await run(c, "piiCardFetch(['1111','9999','1111'])"), 'ok');
  assert.deepEqual(J(run(c, "empsByCardLast4('1111')")).map(e => e.name), ['Sam Manager']);
  assert.deepEqual(J(run(c, "empsByCardLast4('9999')")), []);
  // 店舗の PIN のタブレット（関数で確かめられない）：手で選ぶ
  const st = tab(W, 'store');
  st.localStorage.setItem('_ss_pii_fn', '1');
  run(st, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");
  run(st, "__els={ 'inv-card4':{ value:'1111' }, 'inv-card-match':{ innerHTML:'' }, 'inv-emp':{ value:'' } };");
  run(st, 'invMatchEmp()'); await settle();
  assert.match(J(run(st, "__els['inv-card-match'].innerHTML")), /このログインではカードの下4桁から社員を選べません/);
  assert.equal(J(run(st, "__els['inv-emp'].value")), '');
  // 前の版の関数を見ていない端末：今までどおり端末の表で
  const pre = tab(W, 'tSL');
  run(pre, "__els={ 'inv-card4':{ value:'1111' }, 'inv-card-match':{ innerHTML:'' }, 'inv-emp':{ value:'' } };");
  const s0 = W.calls.ss;
  run(pre, 'invMatchEmp()');
  assert.match(J(run(pre, "__els['inv-card-match'].innerHTML")), /Sam Manager を自動特定/);
  assert.equal(W.calls.ss, s0);
});

test('insurance totals: read without login (store tablets too) and used for labor; before v1144 the table sum as before', async () => {
  const W = world();
  const st = tab(W, 'store');
  assert.equal(await run(st, 'insTotalsRefresh(true)'), 'ok');
  assert.equal(st.piiFnSeen(), true, 'the answer said piifn:1');
  run(st, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");   // SQL のあと
  assert.equal(run(st, "storeInsuranceMonthly('S1')"), 300);
  assert.equal(run(st, "storeInsuranceMonthly('S2')"), 120, 'emp_pii first');
  assert.equal(run(st, "storeInsuranceMonthly('S9')"), 0);
  assert.ok([...st.localStorage._m.keys()].includes('_ins_totals_v1'), 'the totals (no person) are kept on the device for the next start');
  // 前の版の関数：今までどおり（端末の表で数える）
  const W2 = world({ old: true });
  const o = tab(W2, 'store');
  o.localStorage.setItem('_ss_pii_fn', '1');
  assert.equal(await run(o, 'insTotalsRefresh(true)'), 'old');
  assert.equal(o.piiFnSeen(), false);
  assert.equal(run(o, "storeInsuranceMonthly('S1')"), 300);
  assert.equal(run(o, "storeInsuranceMonthly('S2')"), 100, 'the table value (no emp_pii before v1144)');
  // 関数が無い・答えない：失敗（前の合計のまま）
  const W3 = world(); W3.ssDown = true;
  const d = tab(W3, 'store');
  assert.equal(await run(d, 'insTotalsRefresh(true)'), 'fail');
});

test('memory only and per login: logout empties it; another login does not get the overlay or the card matches; only the five fields are placed', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  assert.equal(await c.piiLoad(), 'ok');
  assert.equal(await run(c, "piiCardFetch(['3333'])"), 'ok');
  assert.ok(run(c, "piiCardCached('3333')"));
  // 別の人に替わった（ログアウトを通らない道でも）：前の人の値を重ねない・前の人の照合を使わない
  c._hwSession = 't1'; run(c, "curUserName='Kai One'; curRole='crew';");
  run(c, "EMPLIST=EMPLIST.map(function(e){ var x=Object.assign({}, e); PII_FIELDS.forEach(function(k){ delete x[k]; }); return x; });");
  assert.equal(emp(c, 'E-SL').dob, undefined, 'no overlay for the next login');
  assert.equal(run(c, "piiCardCached('3333')"), null, 'no card match from the previous login');
  // ログアウト：メモリから消す（値を残さない）
  c._hwSession = 'tGM'; run(c, "curUserName='Gina M'; curRole='gm';");
  run(c, 'ssOnLogout()');
  assert.equal(run(c, '_pii.map'), null, 'the fields are gone from memory');
  assert.deepEqual(J(run(c, 'Object.keys(_piiCard)')), []);
  // 重ねるのは 5 つの欄（と「あるか」）だけ（サーバーの答えに別の欄が混ざっても、名前・役割は変えない）
  const d = tab(W, 'tGM');
  assert.equal(await d.piiLoad(), 'ok');
  run(d, "_pii.map['E-1']={ dob:'2001-05-05', name:'Evil', role:'gm', perms:'all', _at:'x' };");
  const e1 = emp(d, 'E-1');
  assert.equal(e1.dob, '2001-05-05'); assert.equal(e1.name, 'Kai One'); assert.equal(e1.role, 'crew'); assert.equal(e1.perms, undefined); assert.equal(e1._at, undefined);
  // 店舗のログインは読まない（役割によらず・同じ端末にメールのログインが残っていても）
  const st = tab(W, 'store');
  run(st, "curRole='gm'; invInSession=function(){ return { access_token:'x', email:'someone@example.test' }; };");
  const n0 = W.calls.ss;
  assert.equal(await st.piiLoad(), 'none');
  assert.equal(W.calls.ss, n0);
});
