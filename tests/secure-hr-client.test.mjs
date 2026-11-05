// v1142（2b の 4 つ目）のアプリ側：採用（応募者・不採用ログ）とお悩み相談室を、REST（公開の鍵）ではなく関数 secure-state で読み書きする。
// アプリの本物の関数（ssCall・hrLoad・hrDo・保存のボタンの関数・描く関数）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 前の版の関数は、入れる一式の v1141 の 1 ファイル。合成データだけ（架空の人・店・応募者。本番に接続しない）。
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

// 前の版の関数（v1141）：入れる一式の 1 ファイル
const v1141Src = readFileSync(new URL('../deploy/secure-settings-v1141/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1141-'));
writeFileSync(join(tmp, 'handler.mjs'), v1141Src);
const { createHandler: createHandler1141 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

const HIRING = ['getApplicants', 'setApplicants', 'getRejectLog', 'addRejectLog', 'findPriorRejects', 'visibleApplicants', 'saveApplicant', 'saveApplicantRest',
  'confirmHire', 'confirmHireRest', 'startOnboardingFromApplicant', 'startOnboardingRest', 'confirmReject', 'confirmRejectRest', 'updateApplicant',
  'hrBtn', 'hrPutApplicant', 'hrSaveApplicant', 'hrConfirmHire', 'hrStartOnboarding', 'hrConfirmReject', 'apRehireShow', 'apCheckRehire', 'renderRejectedList'];
const GHF = ['hrGhOp', 'ghIsManager', 'ghScopeStores', 'ghAssignMe', 'ghAssignMeRest', 'ghPostCard', 'saveGHPost', 'saveGHPostRest', 'saveGHReply', 'saveGHReplyRest', 'ghSetStatus', 'ghSetStatusRest'];
const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  varLine(/^var _hrBusy = .*$/m),
  varLine(/^var _apRehireSeq = .*$/m),
  varLine(/^var _apResumeData = .*$/m),
  varLine(/^var _apNewId = .*$/m),
  varLine(/^var _ghCid = .*$/m),
  ...['supaUpsert', '_supaWriteMs', 'supaHeaders', 'escapeHtml'].map(fn),
  ...HIRING.map(fn), ...GHF.map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _supaBooting=false, _lastSupaError=null, _opLastPushErr={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curStore='', curPage='hiring', curLang='ja', __pending={}, __toasts=[], __notifs=[], __rendered=[], __closed=0, __obs=0;
   var MEM=new Map(), __outboxRemoved=[];
   var STORES=[{ id:'S1', name:'Alpha Kaimuki', brand:'Alpha' }, { id:'S2', name:'Beta Ward', brand:'Beta' }];
   var ROLE_CONFIG={ gm:{ name:'Moto' }, sl:{ name:'Store Leader' }, am:{ name:'Yuki' }, crew:{ name:'スタッフ' } };
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsWriteVerified(k, j){ MEM.set(k, j); return true; }
   function _lsMarkFetched(){}
   function ls(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   /* アプリの lsSet と同じ順：v1142 の止め（hrLocalWriteOk）→ 端末に置く → REST で送る（前の版の道） */
   var __restPush=[];
   function lsSet(k, v){ if(typeof hrLocalWriteOk==='function' && !hrLocalWriteOk(k)) return false; MEM.set(k, JSON.stringify(v));
     if(k==='applicants'||k==='reject_log'||k==='growthhub') __restPush.push(supaUpsert('app_state', [{ key:k, value:v, updated_at:new Date().toISOString() }])); return true; }
   function lsKeys(){ return [...MEM.keys()]; }
   /* アプリの pullOpKey と同じ：REST で 1 行読んで置く。行があれば（全部の値）印を外す（本物の pullOpKey の該当の行は下の試験で確かめる） */
   async function pullOpKey(k){ var r=await fetch(SUPABASE_URL+'/rest/v1/app_state?key=eq.'+encodeURIComponent(k)+'&select=value,updated_at', { headers: supaHeaders() });
     if(!r.ok) return false; var rows=await r.json(); if(Array.isArray(rows) && rows.length){ _lsWriteVerified(k, JSON.stringify(rows[0].value)); if(hrIsKey(k)) hrRestPlaced(k); } return true; }
   function _lsCloudPending(k){ return !!__pending[k]; }
   function _outboxRemove(k){ __outboxRemoved.push(k); delete __pending[k]; }
   function csIsKey(){ return false; } function csOnLogout(){}
   function invInSession(){ return null; } async function invInSessionRefresh(){ return null; }
   function showToast(m, kind){ __toasts.push([kind, m]); } function closeModalDirect(){ __closed++; } function renderPage(p){ __rendered.push(p); }
   function todayISO(){ return '2026-11-04'; } function todayJP(){ return '2026/11/4'; } function nowJP(){ return '2026/11/4 10:00'; }
   function t(a){ return a; } function tStatus(s){ return s; }
   function goOnboarding(){} function addNotif(n){ __notifs.push(n); }
   function myAmStores(){ return ['S2']; } function isStoreManager(){ return curRole==='sl'; } function myStoreId(){ return curStore; }
   function getStoresAll(){ return STORES; } function getEmployees(){ return []; }
   function createOnboarding(o){ __obs++; var obs=ls('onboardings', []); var c='C'+__obs; obs.push(Object.assign({ id:'ob'+__obs, candId:c }, o)); MEM.set('onboardings', JSON.stringify(obs)); return c; }
   var document={ getElementById:function(id){ return __els[id] || null; } }, __els={};`,
].join('\n');

const STORES = [{ id: 'S1', name: 'Alpha Kaimuki', brand: 'Alpha' }, { id: 'S2', name: 'Beta Ward', brand: 'Beta' }];
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-SM', name: 'Sam Manager', store: 'S1', role: 'sl', title: 'Store Manager' },
  { id: 'E-SL', name: 'Sally Lead', store: 'S2', role: 'sl', title: 'Server Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tSM: { emp: 'E-SM', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Sam Manager', confirmed: true },
  tSL: { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Sally Lead', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const USER = { tGM: ['gm', 'Gina M', 'S1'], tSM: ['sl', 'Sam Manager', 'S1'], tSL: ['sl', 'Sally Lead', 'S2'], t1: ['crew', 'Kai One', 'S1'], nopin: ['gm', 'Gina M', 'S1'] };
const T0 = ts6(Date.UTC(2026, 10, 3, 9, 0, 0));
const APPS = [
  { id: 'a1', name: 'Ann Alpha', store: 'Alpha', phone: '808-555-0001', email: 'ann@x.test', status: '応募中', date: '2026-10-01' },
  { id: 'a2', name: 'Bob Beta', store: 'Beta', phone: '808-555-0002', email: 'bob@x.test', status: '応募中', date: '2026-10-02' },
];
const LOG = [{ name: 'Rex Again', phone: '8085559999', email: '', store: 'Beta', rejectDate: '2026-01-10', reason: '連絡が取れない', memo: '' }];
const GH = [{ id: 'gh1', title: 'shift', body: 'b1', author: 'Kai One', store: 'S1', date: 'd', status: '未対応', replies: [] },
  { id: 'gh2', title: 'pay', body: 'b2', author: 'Bea One', store: 'S2', date: 'd', status: '未対応', replies: [] }];

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), stores: STORES, mgr: {}, rlsHr: !!o.rlsHr, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  let clock = Date.UTC(2026, 10, 4, 10, 0, 0);
  W.ssHandler = (o.old ? createHandler1141 : createHandler)({ env, fetch: W.fetch, now: () => (clock += 1000) });
  W.set('applicants', APPS, T0); W.set('reject_log', LOG, T0); W.set('growthhub', GH, T0);
  return W;
}
function handlerFor(W, old) {
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  let clock = Date.UTC(2026, 10, 4, 11, 0, 0);
  return (old ? createHandler1141 : createHandler)({ env, fetch: W.fetch, now: () => (clock += 1000) });
}
function tab(W, who, fetchWrap) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => (fetchWrap ? fetchWrap(u, o) : W.fetch(u, o)), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  if (who) {
    if (who !== 'nopin') c._hwSession = who;
    const [r, n, st] = USER[who];
    vm.runInContext('curRole=' + JSON.stringify(r) + '; curRealRole=curRole; curUserName=' + JSON.stringify(n) + '; curStore=' + JSON.stringify(st) + ';', c);
  }
  return c;
}
const run = (c, src) => vm.runInContext(src, c);
const local = (c, k) => { const v = c.MEM.get(k); return v ? JSON.parse(v) : undefined; };
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);
const flush = () => new Promise(r => setTimeout(r, 0));
const els = (c, o) => { run(c, '__els=' + JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]))) + ';'); };

test('reading: only through the function, only the scope; nothing placed until the server answered for this login', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  assert.equal(c.hrRouted('applicants'), true);
  assert.equal(c.hrReady('applicants'), false);
  assert.equal(await c.hrLoad('applicants'), 'ok');
  assert.deepEqual(local(c, 'applicants').map(x => x.id), ['a2'], 'Beta only');
  assert.equal(c.hrReady('applicants'), true);
  assert.equal(await c.hrLoad('reject_log'), 'ok');
  assert.deepEqual(local(c, 'reject_log').map(x => x.name), ['Rex Again']);
  assert.equal(W.calls.anonHr, 0, 'never read with the public key');
  // ログインが変わると「読めた」は消える（次の人は読み直すまで見えない）
  c._hwSession = 'tSM'; run(c, "curUserName='Sam Manager';");
  assert.equal(c.hrReady('applicants'), false);
  // ログアウトで写しを消す
  run(c, 'ssOnLogout();');
  assert.equal(c.MEM.has('applicants'), false); assert.equal(c.MEM.has('reject_log'), false);
});

test('a late answer for the previous login is not placed (shared device)', async () => {
  const W = world();
  let release; const gate = new Promise(r => { release = r; });
  const c = tab(W, 'tGM', async (u, o) => { if (String(u).includes('secure-state') && JSON.parse(o.body).action === 'hr_get') await gate; return W.fetch(u, o); });
  const p = c.hrLoad('applicants');
  await flush();
  c._hwSession = 't1'; run(c, "curUserName='Kai One'; curRole='crew';");   // GM の答えを待つあいだに Crew に
  release();
  assert.equal(await p, 'stale');
  assert.equal(c.MEM.has('applicants'), false, 'the GM list is not left for the crew');
});

test('a write whose answer comes after the login changed: nothing placed for the next person, no "saved"', async () => {
  const W = world();
  let release; const gate = new Promise(r => { release = r; });
  const c = tab(W, 'tGM', async (u, o) => { const r = await W.fetch(u, o); if (String(u).includes('secure-state') && JSON.parse(o.body).action === 'hr_op') await gate; return r; });
  await c.hrLoad('applicants');
  c.MEM.delete('applicants');
  const p = c.hrPutApplicant({ id: 'a50', name: 'Late', store: 'Beta', status: '応募中' }, true);
  await flush();
  c._hwSession = 't1'; run(c, "curUserName='Kai One'; curRole='crew';");   // GM の答えを待つあいだに Crew に
  release();
  assert.equal(await p, 'fail');
  assert.equal(c.MEM.has('applicants'), false, 'the GM list is not left for the crew');
  assert.ok(c.__toasts.some(([k, m]) => k === 'error' && /ログインが変わりました/.test(m)), 'says the login changed');
  assert.ok(W.get('applicants').some(x => x.id === 'a50'), 'the server did save it (the message says to check)');
});

test('adding an applicant: one record through the function (server key); the input stays when it fails', async () => {
  const W = world();
  const c = tab(W, 'tSM');
  await c.hrLoad('applicants');
  els(c, { 'ap-name': 'New One', 'ap-store': 'Alpha', 'ap-pos': 'Server', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '2026-11-04', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c, "saveApplicant('');");
  for (let i = 0; i < 20 && !c.__closed; i++) await flush();
  assert.equal(c.__closed, 1, 'closed after the cloud took it');
  const all = W.get('applicants');
  assert.equal(all.length, 3, 'the Beta applicant (not on this device) is still there');
  assert.ok(all.some(x => x.name === 'New One' && x.store === 'Alpha' && x.status === '応募中'));
  assert.deepEqual(writes(W, 'applicants'), ['service']);
  assert.ok(c.__toasts.some(([k, m]) => k === 'success' && /保存しました/.test(m)));
  assert.deepEqual(local(c, 'applicants').map(x => x.name).sort(), ['Ann Alpha', 'New One'], 'the device copy is the scoped view');
  // 通信できない：閉じない・保存しましたを出さない・クラウドも変わらない
  const W2 = world();
  const c2 = tab(W2, 'tSM', async (u, o) => { if (String(u).includes('secure-state') && JSON.parse(o.body).action === 'hr_op') throw new TypeError('offline'); return W2.fetch(u, o); });
  await c2.hrLoad('applicants');
  els(c2, { 'ap-name': 'Lost', 'ap-store': 'Alpha', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c2, "saveApplicant('');");
  for (let i = 0; i < 20 && !c2.__toasts.length; i++) await flush();
  assert.equal(c2.__closed, 0);
  assert.ok(c2.__toasts.some(([k, m]) => k === 'error' && /確かめられません/.test(m)));
  assert.ok(!W2.get('applicants').some(x => x.name === 'Lost'));
});

test('the answer of a create was lost: pressing again finds it saved (no duplicate, no false error)', async () => {
  const W = world();
  let drop = true;
  const c = tab(W, 'tGM', async (u, o) => {
    const r = await W.fetch(u, o);
    if (drop && String(u).includes('secure-state') && JSON.parse(o.body).op === 'put') { drop = false; throw new TypeError('the answer was lost'); }
    return r;
  });
  await c.hrLoad('applicants');
  const rec = { id: 'a777', name: 'Once', store: 'Alpha', status: '応募中' };
  assert.equal(await c.hrPutApplicant(rec, true), 'fail', 'first press: the answer did not arrive');
  assert.equal(await c.hrPutApplicant(rec, true), 'ok', 'second press: already there → saved');
  assert.equal(W.get('applicants').filter(x => x.id === 'a777').length, 1);
});

test('reject: through the function; the server writes the log and removes the applicant', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  await c.hrLoad('applicants');
  els(c, { 'rej-reason': '経験・スキル不足', 'rej-other': '', 'rej-memo': 'm', 'rej-by': 'Sally' });
  run(c, "confirmReject('a2');");
  for (let i = 0; i < 30 && !c.__closed; i++) await flush();
  assert.equal(c.__closed, 1);
  assert.ok(!W.get('applicants').some(x => x.id === 'a2'));
  assert.ok(W.get('applicants').some(x => x.id === 'a1'), 'the Alpha applicant is untouched');
  assert.equal(W.get('reject_log').filter(x => x.aid === 'a2').length, 1);
  assert.deepEqual(writes(W, 'reject_log'), ['service']);
  assert.ok(local(c, 'reject_log').some(x => x.aid === 'a2'), 'the device copy of the log is updated too');
});

test('hire → onboarding: when linking fails, pressing again links the same onboarding (no second one)', async () => {
  const W = world();
  let failLink = true;
  const c = tab(W, 'tGM', async (u, o) => {
    if (failLink && String(u).includes('secure-state')) { const b = JSON.parse(o.body); if (b.op === 'put' && b.rec && b.rec.onboardId) { failLink = false; return new Response(JSON.stringify({ error: 'error', fn: 1, csfn: 1, swfn: 1, hrfn: 1 }), { status: 500 }); } }
    return W.fetch(u, o);
  });
  await c.hrLoad('applicants');
  els(c, { 'hire-store': 'S1', 'hire-pos': 'Server', 'hire-wage': '17', 'hire-start': '2026-11-10', 'hire-visa': '市民/永住権', 'hire-emp': 'Part Time Crew' });
  run(c, "confirmHire('a1');");
  for (let i = 0; i < 40 && !c.__toasts.some(([k]) => k === 'warning'); i++) await flush();
  assert.equal(c.__obs, 1);
  assert.equal(W.get('applicants').find(x => x.id === 'a1').status, '採用');
  assert.ok(!W.get('applicants').find(x => x.id === 'a1').onboardId, 'not linked yet');
  run(c, "startOnboardingFromApplicant('a1');");
  for (let i = 0; i < 40 && !W.get('applicants').find(x => x.id === 'a1').onboardId; i++) await flush();
  assert.equal(c.__obs, 1, 'the same onboarding (no second one)');
  assert.equal(W.get('applicants').find(x => x.id === 'a1').onboardId, 'C1');
  assert.equal(c.__notifs.filter(n => n.type === 'onboard').length, 0, 'not announced twice (the first start did not announce either: it failed)');
});

test('with an older function (v1141) or no PIN mark: today\'s REST way', async () => {
  for (const [o, who] of [[{ old: true }, 'tGM'], [{}, 'nopin']]) {
    const W = world(o);
    const c = tab(W, who);
    assert.equal(await c.hrLoad('applicants'), 'rest');
    assert.equal(c.hrRouted('applicants'), false);
    run(c, "MEM.set('applicants', JSON.stringify(" + JSON.stringify(APPS) + "));");
    els(c, { 'ap-name': 'Old Way', 'ap-store': 'Alpha', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
    run(c, "saveApplicant('');");
    await Promise.all(c.__restPush);
    assert.ok(W.get('applicants').some(x => x.name === 'Old Way'), JSON.stringify(o));
    assert.deepEqual(writes(W, 'applicants'), ['anon'], 'REST with the public key (before the SQL)');
  }
  // 関数が前の版と分からないうちに押した：前の版は「知らない頼み」→ その場で今までの道に戻る
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  run(c, "MEM.set('applicants', JSON.stringify(" + JSON.stringify(APPS) + "));");
  els(c, { 'ap-name': 'Fallback', 'ap-store': 'Alpha', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c, "saveApplicant('');");
  for (let i = 0; i < 30 && !c.__restPush.length; i++) await flush();
  await Promise.all(c.__restPush);
  assert.ok(W.get('applicants').some(x => x.name === 'Fallback'));
});

test('while routed, the old whole-row way is refused (a partial copy never overwrites the cloud)', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  await c.hrLoad('applicants');
  assert.equal(c.lsSet('applicants', [{ id: 'x', name: 'Only Me', store: 'Beta', status: '応募中' }]), false);
  assert.equal(c.__restPush.length, 0);
  assert.equal(W.get('applicants').length, 2);
  assert.ok(c.__toasts.some(([k]) => k === 'warning'));
  // 前の版で送れていなかった変更：控えに移して送信待ちから外す
  const c2 = tab(W, 'tSL');
  run(c2, "MEM.set('growthhub', JSON.stringify([{ id:'ghX', title:'unsent' }])); __pending.growthhub=1;");
  assert.equal(await c2.hrLoad('growthhub'), 'ok');
  assert.deepEqual([...c2.__outboxRemoved], ['growthhub']);
  assert.match(c2.localStorage.getItem('_hr_unsent'), /unsent/);
  assert.ok(!W.get('growthhub').some(x => x.id === 'ghX'));
});

test('the consultation room: post, reply and status through the function; notifications follow the server', async () => {
  const W = world();
  const c = tab(W, 't1');
  await c.hrLoad('growthhub');
  assert.deepEqual(local(c, 'growthhub').map(x => x.id), ['gh1'], 'only my own');
  els(c, { 'gh-title': 'help', 'gh-body': 'please' });
  run(c, 'saveGHPost();');
  for (let i = 0; i < 30 && !c.__closed; i++) await flush();
  const mine = W.get('growthhub').find(x => x.title === 'help');
  assert.equal(mine.author, 'Kai One'); assert.equal(mine.store, 'S1');
  assert.ok(c.__notifs.some(n => n.type === 'consult' && n.toStore === 'S1'));
  els(c, { 'gh-reply': 'more' });
  run(c, "saveGHReply('gh1');");
  for (let i = 0; i < 30 && c.__closed < 2; i++) await flush();
  assert.deepEqual(W.get('growthhub').find(x => x.id === 'gh1').replies.map(r => [r.author, r.byMgr]), [['Kai One', false]]);
  // 店長：返信・解決（通知は相談した人へ）
  const m = tab(W, 'tSM');
  await m.hrLoad('growthhub');
  els(m, { 'gh-reply': 'ok' });
  run(m, "saveGHReply('gh1');");
  for (let i = 0; i < 30 && !m.__closed; i++) await flush();
  const p = W.get('growthhub').find(x => x.id === 'gh1');
  assert.equal(p.replies[1].byMgr, true); assert.equal(p.status, '対応中');
  assert.ok(m.__notifs.some(n => n.toUser === 'Kai One'));
  run(m, "ghSetStatus('gh1','解決');");
  for (let i = 0; i < 30 && W.get('growthhub').find(x => x.id === 'gh1').status !== '解決'; i++) await flush();
  assert.equal(W.get('growthhub').find(x => x.id === 'gh1').status, '解決');
  // ほかの店の相談：断られる（画面は文を出す）
  run(m, "ghSetStatus('gh2','解決');");
  for (let i = 0; i < 30 && !m.__toasts.some(([k]) => k === 'error'); i++) await flush();
  assert.ok(m.__toasts.some(([k, t]) => k === 'error' && /範囲の外/.test(t)));
  assert.equal(W.get('growthhub').find(x => x.id === 'gh2').status, '未対応');
  assert.deepEqual([...new Set(writes(W, 'growthhub'))], ['service']);
});

test('the rehire check asks the server (matches from all stores); the device log is not used', async () => {
  const W = world();
  W.set('reject_log', LOG.concat([{ name: 'Far Away', phone: '', email: 'far@x.test', store: 'Alpha', rejectDate: '2026-02-02', reason: 'r2', memo: '<b>x</b>' }]), T0);
  const c = tab(W, 'tSL');   // Beta：Alpha の不採用ログは端末に無い
  await c.hrLoad('reject_log');
  assert.ok(!local(c, 'reject_log').some(x => x.name === 'Far Away'));
  const box = { innerHTML: '' };
  run(c, "__els={ 'ap-rehire-warn':" + 'null' + ", 'ap-name':{value:''}, 'ap-phone':{value:''}, 'ap-email':{value:'FAR@x.test'} };");
  c.__els['ap-rehire-warn'] = box;
  run(c, 'apCheckRehire();');
  for (let i = 0; i < 50 && !box.innerHTML; i++) await new Promise(r => setTimeout(r, 20));
  assert.match(box.innerHTML, /2026-02-02/); assert.match(box.innerHTML, /Alpha/);
  assert.ok(!box.innerHTML.includes('<b>x</b>') && box.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'), 'escaped');
});

test('lists are text, not HTML (names and memos cannot run code)', () => {
  const W = world();
  const c = tab(W, 'tGM');
  const evil = '<img src=x onerror=alert(1)>';
  run(c, "MEM.set('reject_log', JSON.stringify([{ name:" + JSON.stringify(evil) + ", store:" + JSON.stringify(evil) + ", reason:" + JSON.stringify(evil) + ", memo:" + JSON.stringify(evil) + ", by:" + JSON.stringify(evil) + ", phone:" + JSON.stringify(evil) + " }])); window._showRejected=true; _ss.hrOld={ id:ssSess().id, at:Date.now() };");
  const h = c.renderRejectedList();
  assert.ok(!h.includes('<img'), 'no raw tag'); assert.ok(h.includes('&lt;img'));
  const card = c.ghPostCard({ id: 'gh9', title: evil, body: evil, author: evil, date: evil, store: 'S1', replies: [{ author: evil, text: evil, date: evil, byMgr: true }] }, true);
  assert.ok(!card.includes('<img')); assert.ok(card.includes('&lt;img'));
  assert.equal(c.ghPostCard({ id: "gh1');alert(1);('", title: 't', body: 'b', author: 'a', date: 'd', replies: [] }, true), '', 'an id that does not fit the shape is not put in a button');
});

test('the bulk REST pull leaves the hiring keys to the function (source check)', () => {
  const pull = fn('_kvPullRows');
  assert.match(pull, /var _hrOut=_stale \|\| \(typeof hrRouted==='function' && hrRouted\(\)\);/);
  // アプリの本物の lsSet：v1142 の止めが、端末に書く前にある（このファイルの lsSet はその写し）
  const ls0 = source.indexOf('function lsSet(key, val) {');
  assert.ok(ls0 > 0, 'lsSet found');
  const body = source.slice(ls0, ls0 + 6000);
  const gate = body.indexOf("if(typeof hrLocalWriteOk==='function' && !hrLocalWriteOk(key)) return false;");
  assert.ok(gate > 0, 'the gate is in lsSet');
  assert.ok(gate < body.indexOf('_lsWriteVerified(key, _json)'), 'before anything is stored');
  assert.match(pull, /if\(_hrOut && hrIsKey\(k\)\) return;/);
  assert.match(pull, /if\(_hrOut\) Object\.keys\(HR_KEYS\)\.forEach\(function\(k\)\{ ex\.push\(_kvQuote\(k\)\); \}\);[\s\S]{0,400}if\(ex\.length\) f\+='&key=not\.in\.'/);
  assert.match(pull, /if\(Array\.isArray\(rows\) && _hrOut\) rows=rows\.filter\(function\(r\)\{ return !\(r && hrIsKey\(r\.key\)\); \}\);/);
  const def = fn('_lsRequestDeferred');
  assert.match(def, /if\(typeof hrIsKey==='function' && hrIsKey\(key\) && hrRouted\(key\)\)\{/);
  const push = source.slice(source.indexOf('// app_state 行き（運用データ）'), source.indexOf('function supaSettingCategory'));
  assert.match(push, /if \(typeof hrRouted==='function' && hrIsKey\(key\) && \(hrRouted\(key\) \|\| hrSrcGet\(\)\[key\]\)\) \{ try\{ _opLastPushErr\[key\]='secure_hold'; \}catch\(e\)\{\} return false; \}/);
  // REST：関数から置いた写しを外してから読む・REST の行（全部）を置いたら印を外す・ログインのたびに前の写しを消す
  assert.match(def, /if\(typeof hrIsKey==='function' && hrIsKey\(key\)\) hrDropToRest\(key\);/);
  assert.match(pull, /if\(_hrOut\) hrSweep\(\);/);
  assert.match(pull, /else Object\.keys\(HR_KEYS\)\.forEach\(function\(k\)\{ hrDropToRest\(k\); \}\);/);
  assert.match(fn('_applyKvRows'), /if\(typeof hrIsKey==='function' && hrIsKey\(row\.key\)\) hrRestPlaced\(row\.key\);/);
  const pok = fn('pullOpKey');
  assert.match(pok, /if\(!_viaSs && typeof hrIsKey==='function' && hrIsKey\(key\)\) hrRestPlaced\(key\);/);
  assert.ok(pok.indexOf('hrRestPlaced(key)') > pok.indexOf('if(Array.isArray(rows) && !rows.length)'), 'an empty answer (the row hidden after the SQL) does not clear the mark');
});

test('the function turns out older (rolled back) while a partial copy is on the device: nothing is sent the old way until a REST reload (review P1-1)', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  await c.hrLoad('applicants');
  assert.deepEqual(local(c, 'applicants').map(x => x.id), ['a2'], 'only the Beta applicant (a partial copy)');
  W.ssHandler = handlerFor(W, true);   // 関数を v1141 に戻した（手順.md の「困ったとき」）
  assert.equal(await c.hrLoad('applicants', true), 'rest', 'the app learns that the function is older');
  assert.equal(c.lsSet('applicants', [{ id: 'x', name: 'Only Me', store: 'Beta', status: '応募中' }]), false, 'the old whole-row way refuses (the copy came from the function)');
  assert.equal(c.MEM.has('applicants'), false, 'and the partial copy is gone');
  els(c, { 'ap-name': 'Walk In', 'ap-store': 'Beta', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c, "saveApplicant('');");
  for (let i = 0; i < 40 && !c.__toasts.some(([k]) => k === 'error'); i++) await flush();
  await Promise.all(c.__restPush);
  assert.deepEqual(W.get('applicants').map(x => x.id).sort(), ['a1', 'a2'], 'the cloud keeps the Alpha applicant (no whole-row write from the partial copy)');
  assert.deepEqual(writes(W, 'applicants'), []);
  assert.ok(c.__toasts.some(([k, m]) => k === 'error' && /読み直せていない/.test(m)), 'says it was not saved');
  assert.equal(c.__closed, 0, 'the input stays');
  // REST で読み直したら（SQL の前）今までどおり書ける
  for (let i = 0; i < 20 && c.hrNeed('applicants'); i++) await flush();
  assert.equal(c.hrNeed('applicants'), false, 'reloaded through REST');
  assert.deepEqual(local(c, 'applicants').map(x => x.id).sort(), ['a1', 'a2'], 'the whole row now');
  run(c, "saveApplicant('');");
  for (let i = 0; i < 20 && !c.__restPush.length; i++) await flush();
  await Promise.all(c.__restPush);
  assert.deepEqual(W.get('applicants').map(x => x.name).sort(), ['Ann Alpha', 'Bob Beta', 'Walk In']);
  // SQL のあと（公開の鍵で読めない）：読み直せないので、書かない
  const W2 = world({ rlsHr: true });
  const c2 = tab(W2, 'tSL');
  await c2.hrLoad('growthhub'); W2.ssHandler = handlerFor(W2, true);
  assert.equal(await c2.hrLoad('growthhub', true), 'rest');
  assert.equal(c2.hrShow('growthhub'), false, 'the partial copy is not shown');
  assert.equal(c2.MEM.has('growthhub'), false, 'and is gone from the device');
  run(c2, "saveGHReplyRest('gh2', 'x');");
  for (let i = 0; i < 20; i++) await flush();
  assert.equal(c2.__restPush.length, 0); assert.equal(W2.get('growthhub').find(x => x.id === 'gh2').replies.length, 0);
});

test('the PIN check (whoami) does not answer for a moment: a failure, never the REST way (review P1-1)', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  await c.hrLoad('applicants');
  W.wrDown = '503'; W.ssHandler = handlerFor(W, false);   // 関数の新しい起動（ログインの覚えが無い）
  els(c, { 'ap-name': 'Walk In', 'ap-store': 'Beta', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c, "saveApplicant('');");
  for (let i = 0; i < 40 && !c.__toasts.length; i++) await flush();
  assert.equal(c.hrRouted('applicants'), true, 'still the function');
  assert.ok(c.__toasts.some(([k]) => k === 'error')); assert.equal(c.__restPush.length, 0);
  assert.deepEqual(W.get('applicants').map(x => x.id).sort(), ['a1', 'a2']);
});

test('pressing Save again after a lost answer adds one applicant, not two (review P2-1)', async () => {
  const W = world();
  let drop = true;
  const c = tab(W, 'tSM', async (u, o) => {
    const r = await W.fetch(u, o);
    if (drop && String(u).includes('secure-state') && JSON.parse(o.body).op === 'put') { drop = false; throw new TypeError('the answer was lost'); }
    return r;
  });
  await c.hrLoad('applicants');
  els(c, { 'ap-name': 'Once', 'ap-store': 'Alpha', 'ap-pos': '', 'ap-phone': '', 'ap-email': '', 'ap-source': 'Indeed', 'ap-date': '', 'ap-memo': '', 'ap-history': '', 'ap-skills': '' });
  run(c, "saveApplicant('');");
  for (let i = 0; i < 40 && !c.__toasts.length; i++) await flush();
  assert.ok(c.__toasts.some(([k, m]) => k === 'error' && /確かめられません/.test(m)), 'says it may or may not be saved');
  run(c, "saveApplicant('');");
  for (let i = 0; i < 40 && !c.__closed; i++) await flush();
  assert.equal(c.__closed, 1);
  assert.equal(W.get('applicants').filter(x => x.name === 'Once').length, 1);
});

test('an edit from an old copy keeps what another device changed (review P2-2)', async () => {
  const W = world();
  const sm = tab(W, 'tSM'), gm = tab(W, 'tGM');
  await sm.hrLoad('applicants'); await gm.hrLoad('applicants');
  run(gm, "updateApplicant('a1', '面接予定');");
  for (let i = 0; i < 40 && W.get('applicants').find(x => x.id === 'a1').status !== '面接予定'; i++) await flush();
  els(sm, { 'ap-name': 'Ann Alpha', 'ap-store': 'Alpha', 'ap-pos': '', 'ap-phone': '808-555-0001', 'ap-email': 'ann@x.test', 'ap-source': 'Indeed', 'ap-date': '2026-10-01', 'ap-memo': 'call back', 'ap-history': '', 'ap-skills': '' });
  run(sm, "saveApplicant('a1');");
  for (let i = 0; i < 40 && !sm.__toasts.length; i++) await flush();
  const a1 = W.get('applicants').find(x => x.id === 'a1');
  assert.equal(a1.status, '面接予定', 'the GM change stays'); assert.equal(a1.memo, 'call back', 'the memo is added');
});

test('consultations: a re-sent post is one post; a post with no store goes to GM and AM; status shown as text', async () => {
  const W = world();
  let drop = true;
  const c = tab(W, 'tGM', async (u, o) => {
    const r = await W.fetch(u, o);
    if (drop && String(u).includes('secure-state') && JSON.parse(o.body).op === 'post') { drop = false; throw new TypeError('lost'); }
    return r;
  });
  await c.hrLoad('growthhub');
  els(c, { 'gh-title': 'From HQ', 'gh-body': 'b' });
  run(c, 'saveGHPost();'); for (let i = 0; i < 40 && !c.__toasts.length; i++) await flush();
  run(c, 'saveGHPost();'); for (let i = 0; i < 40 && !c.__closed; i++) await flush();
  assert.equal(W.get('growthhub').filter(x => x.title === 'From HQ').length, 1);
  const n = c.__notifs.find(x => x.type === 'consult');
  assert.ok(n && JSON.stringify(n.toRoles) === JSON.stringify(['gm', 'am']) && !n.toStore, 'GM and AM are told (as before)');
  const html = c.ghPostCard({ id: 'gh9', title: 't', body: 'b', author: 'Kai One', store: 'S1', status: '<img src=x onerror=1>', replies: [] });
  assert.ok(!html.includes('<img src=x'), 'the status is text');
});

test('the device does not keep copies from before (old full copies, the previous person, the stash) — sweep and logout (review P2-5)', async () => {
  const W = world();
  const c = tab(W, 'tSL');
  // 前の版の全部の写し（印なし）と、送れていない変更
  run(c, "MEM.set('applicants', JSON.stringify(" + JSON.stringify(APPS) + ")); MEM.set('reject_log', JSON.stringify(" + JSON.stringify(LOG) + ")); __pending.reject_log=1;");
  c.hrSweep();
  assert.equal(c.MEM.has('applicants'), false); assert.equal(c.MEM.has('reject_log'), false);
  assert.ok(JSON.parse(c.localStorage.getItem('_hr_unsent')).some(x => x.key === 'reject_log'), 'the unsent change is stashed');
  await c.hrLoad('applicants');
  c.hrSweep();
  assert.ok(c.MEM.has('applicants'), 'this login\'s copy stays');
  c._hwSession = 'tSM'; run(c, "curUserName='Sam Manager';");
  c.hrSweep();
  assert.equal(c.MEM.has('applicants'), false, 'the previous person\'s copy is removed');
  await c.hrLoad('applicants');
  c.hrOnLogout();
  assert.equal(c.MEM.has('applicants'), false); assert.equal(c.localStorage.getItem('_hr_unsent'), null); assert.equal(c.localStorage.getItem('_hr_src'), null);
});

test('the login changes while a save is answered by an older function: the save stops (no REST with the previous person\'s input)', async () => {
  const W = world();
  let release; const gate = new Promise(r => { release = r; });
  const c = tab(W, 'tGM', async (u, o) => { if (String(u).includes('secure-state') && JSON.parse(o.body).action === 'hr_op') await gate; return W.fetch(u, o); });
  await c.hrLoad('applicants');
  W.ssHandler = handlerFor(W, true);
  const p = c.hrDo({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'a60', name: 'X', store: 'Alpha', status: '応募中' } });
  await flush();
  c._hwSession = 't1'; run(c, "curUserName='Kai One'; curRole='crew';");
  release();
  const res = await p; assert.equal(res && res.error, 'stale', JSON.stringify(res));
});
