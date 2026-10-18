// App v1091 (Moto 2026-10-17): "Tip Rate を A 端末で更新しても B 端末に即時反映されない".
// Two devices run the app's real storage and sync code (ls / lsSet → split rows spl_tip_requests_<name> → opMergePush) against
// one fake app_state table (rows with updated_at, read and written through fetch like PostgREST). No network, no production data.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1090 fails them: device B never takes the change).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
function varLine(name) { const m = new RegExp('^var ' + name + '\\b[^\\n]*$', 'm').exec(SRC); if (!m) throw new Error('var not found: ' + name); return m[0]; }
const plain = v => JSON.parse(JSON.stringify(v));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// The real merge rule line for tip_requests (OP_MERGE) — the devices use exactly what the app registers.
const MERGE_LINE = /^ {2}tip_requests: +\{ merge: (\w+), +covers: (\w+) \}/m.exec(SRC);

/* PostgREST's like is SQL LIKE ('*' is '%'): '%' any run, '_' any one character, '\\' makes the next character literal */
function likeRe(pat) {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '\\') { i++; out += (pat[i] || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (ch === '%' || ch === '*') out += '[\\s\\S]*';
    else if (ch === '_') out += '[\\s\\S]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

/* ---------- one fake app_state (PostgREST-like) ---------- */
function makeCloud() {
  const rows = new Map();   // key -> { value(json string), updated_at }
  const cloud = { rows, log: [], failPost: false, delay: 1 };
  cloud.fetch = async (url, opts = {}) => {
    for (let i = 0; i < cloud.delay; i++) await new Promise(r => setImmediate(r));
    const u = new URL(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => '' });
    if ((opts.method || 'GET') === 'POST') {
      cloud.log.push(['POST', JSON.parse(opts.body).map(r => r.key)]);
      if (cloud.failPost) return { ok: false, status: 503, text: async () => 'down', json: async () => ({}) };
      JSON.parse(opts.body).forEach(r => rows.set(r.key, { value: JSON.stringify(r.value), updated_at: r.updated_at || new Date().toISOString() }));
      return ok([]);
    }
    const p = u.searchParams; const eq = p.get('key'); const sel = p.get('select');
    cloud.log.push(['GET', u.search]);
    let list = [...rows.entries()].map(([key, r]) => ({ key, value: JSON.parse(r.value), updated_at: r.updated_at }));
    if (eq && eq.startsWith('eq.')) list = list.filter(r => r.key === eq.slice(3));
    if (eq && eq.startsWith('like.')) { const re = likeRe(eq.slice(5)); list = list.filter(r => re.test(r.key)); }
    const gte = p.get('updated_at'); if (gte && gte.startsWith('gte.')) list = list.filter(r => r.updated_at >= gte.slice(4));
    return ok(list.map(r => sel === 'value' ? { value: r.value } : r));
  };
  return cloud;
}

const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);   // relative, so the 3-month rule does not start on its own later
const EMP = [{ name: 'Crew A', store: 'F01', role: 'crew', firstWork: daysAgo(27), status: '在籍' },
             { name: 'Crew B', store: 'F01', role: 'crew', firstWork: daysAgo(22), status: '在籍' },
             { name: 'Crew C', store: 'F01', role: 'crew', firstWork: daysAgo(400), status: '在籍' }];   // past 3 months: 100% automatically
const FUNCS = ['ls', 'lsSet', '_splitPrefix', '_splitRead', '_splitWrite', '_lsRaw', '_lsStoreGet', '_lsWriteVerified', '_lsSetVerified', '_lsSplitOnDemandPrefix',
  '_pushWithOutbox', '_lsPushBlocked', 'syncMasterToSupabase', 'isOpSyncKey', 'isLocalOnlyKey', '_opMergeDef', 'opMergePush', '_fetchOpValue', 'supaUpsert',
  '_opUpsertRow', '_opWriteBack', 'supaHeaders', 'pullOpKey', '_srPending', 'mergeSkillReq', '_coversSkillReq',
  'effectiveTipRate', 'firstWorkDate', 'isThreeMonths', 'applyTipRaise', 'approveTip', 'submitTipRequest'];
const NEW = ['mergeTipReq', '_coversTipReq', '_tipDecT', '_tipLatestApproved', 'tipDecStamp', '_tipLiveTimeout', '_tipLiveOn', 'tipPullPerson', 'tipLiveBeacon',
  'tipLiveAfterSave', 'tipLivePull', 'tipLiveRerender', 'tipLivePullSoon', 'tipLiveStart', 'tipLiveStop',
  'tipLiveAutoPage', 'tipLivePill', 'tipLiveApply', 'tipLiveFastPage', '_tipLiveRateSig', '_tipLiveTake', '_tipLiveSigKeys', 'tipLivePillFor', 'tipStampLegacy'];
const NEW_VARS = ['TIP_LIVE_KEY', 'TIP_LIVE_LIKE', '_tipLive'];

function device(cloud, { user = 'Moto', role = 'gm', page = 'tiprate', view = 'matrix', rt = true } = {}) {
  const store = new Map();
  const c = {
    console, cloud, TOASTS: [], RENDERS: [], NOTIFS: [], INTERVALS: [], RT: {}, DOM: {}, CONFIRMS: [], CONFIRM_ANSWER: true,
    curRole: role, curUserName: user, curPage: page, curLang: 'ja', ROLE_CONFIG: { gm: { name: 'Moto', canApprove: true }, am: { name: 'Yuki', canApprove: true }, crew: { name: 'スタッフ' } },
    SUPABASE_URL: 'https://db.example', SUPABASE_ANON: 'anon', SUPA_SYNC_ENABLED: true, _supaBooting: false,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); },
      get length() { return store.size; }, key: i => [...store.keys()][i] },
    fetch: (u, o) => cloud.fetch(u, o), setTimeout, clearTimeout, setImmediate, Promise, JSON, Date, Math,
    STORE: store,
  };
  c.setInterval = (fn, ms) => { c.INTERVALS.push({ fn, ms }); return c.INTERVALS.length; };
  c.clearInterval = () => {};
  c.confirm = m => { c.CONFIRMS.push(m); return c.CONFIRM_ANSWER; };
  const body = { appendChild: el => { el.parentNode = body; c.DOM[el.id] = el; }, removeChild: el => { el.parentNode = null; delete c.DOM[el.id]; } };
  c.document = { hidden: false, body,
    getElementById: id => (c.MODAL && id === 'modal-overlay' ? { classList: { contains: () => true } } : (c.INPUTS && c.INPUTS[id]) || c.DOM[id] || null),
    createElement: () => ({ id: '', style: {}, innerHTML: '', parentNode: null, setAttribute() {} }),
    addEventListener: () => {}, removeEventListener: () => {} };
  c.window = rt ? { supabase: { createClient: () => ({ channel: (name) => { const ch = { name, state: 'joined', on: (ev, f, h) => { c.RT[name] = h; return ch; }, subscribe: () => ch }; return ch; },
    removeChannel: () => {} }) } } : {};
  vm.createContext(c);
  const load = names => names.map(n => { try { return fnSrc(n); } catch (_e) { return ''; } }).join('\n');
  vm.runInContext(load(FUNCS.concat(NEW)) + '\n' + NEW_VARS.map(n => { try { return varLine(n); } catch (_e) { return ''; } }).join('\n') + '\n' + varLine('LS_LOCAL_ONLY') + `
    var _SPLIT_KEYS = { tip_requests: { type: 'arr', by: function(r){ return r && r.name; } } };
    var _STAMP_LIST_KEYS = {}, _LS_ONDEMAND_PREFIX = ['spl_tip_history_'], _LS_FETCHED = {}, _LS_SAVE_FAIL = {}, _lsEscalatedAt = 0, _opMergeChain = {}, _opLastPushErr = {}, _lastSupaError = null;
    var _idbState = 'unavailable', _IDB_MEM = null, _rtClient = null;
    var SUPA_MASTER_MAP = {}, SUPA_SETTING_KEYS = [], SUPA_SETTING_PREFIX = [], OP_SYNC_KEYS = ['tip_requests'], OP_SYNC_PREFIX = ['spl_'];
    var OP_MERGE = { tip_requests: { merge: ${MERGE_LINE ? MERGE_LINE[1] : 'mergeSkillReq'}, covers: ${MERGE_LINE ? MERGE_LINE[2] : '_coversSkillReq'} } };
    var OP_MERGE_PREFIX = { 'spl_tip_requests_': OP_MERGE.tip_requests };   /* as _registerSplitMergeDefs does */
    function _idbQueue(){ return false; }
    function lsKeys(p){ var o=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(!p || k.indexOf(p)===0) o.push(k); } return o; }
    function _lsRequestDeferredPrefix(){} function _lsOnDemand(){ return false; } function _lsMarkFetched(k){ _LS_FETCHED[k]=1; }
    function _lsNoteSaveFailure(){} function _lsClearSaveFailure(){} function _lsFreeOldLaborKeys(){ return 0; } function freeRecoverableSpace(){}
    function _outboxAdd(k){ (OUTBOX[k]=1); } function _outboxRemove(k){ delete OUTBOX[k]; } var OUTBOX = {};
    function _handleLegacySplitRow(){ return false; } function _empTyping(){ return false; } function empPushDirty(){ return true; }
    function getEmployees(){ return ${JSON.stringify(EMP)}; }
    function workedShiftCount(){ return 10; } function noTipShifts(){ return 3; }
    function t(ja){ return ja; } function todayJP(){ return '2026/10/17'; }
    function showToast(m, k){ TOASTS.push([m, k]); } function renderPage(p){ RENDERS.push(p); } function closeModalDirect(){}
    function addNotif(n){ NOTIFS.push(n); } function addApproval(){} function apDecidedFromPage(){} function apNotifyAcctApplied(){}
    function myName(){ return curUserName; } function supaSettingCategory(){ return null; }
    var STORES = [{ id: 'F01', name: 'ToriTon' }]; var tipPeriodView = ${JSON.stringify(view)};`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const rate = (c, n = 'Crew A') => run(c, 'effectiveTipRate(' + JSON.stringify(n) + ')');
const KEY = 'spl_tip_requests_Crew A';
function seed(cloud, devices, list, at = new Date(Date.now() - 3600e3).toISOString()) {
  cloud.rows.set(KEY, { value: JSON.stringify(list), updated_at: at });
  devices.forEach(d => d.STORE.set(KEY, JSON.stringify(list)));
}
const OLD80 = [{ id: 'tip100', name: 'Crew A', rate: 80, status: '承認', date: '2026/09/30', approver: 'Moto' }];
async function raise(c, name, r) {
  c.INPUTS = { 'tipraise-name': { value: name }, 'tipraise-rate': { value: String(r) } };
  await run(c, 'applyTipRaise()'); await settle(60);   // the raise reads the row first, then saves, sends and signals
  await new Promise(r => setTimeout(r, 15)); await settle(60);   // the signal waits on a timer (setTimeout 0) before it is written
}
const pill = c => c.DOM['tip-live-pill'] || null;

test('the change on device A reaches device B without logging in again (Realtime signal → B reads the changed rows)', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  seed(cloud, [A, B], OLD80);
  run(A, 'tipLiveStart()'); run(B, 'tipLiveStart()');
  assert.equal(rate(A), 80); assert.equal(rate(B), 80);
  await raise(A, 'Crew A', 90);
  assert.equal(rate(A), 90);
  // saved to the cloud (the person's row), and only then the signal row
  const row = JSON.parse(cloud.rows.get(KEY).value);
  assert.equal(row.at(-1).rate, 90); assert.ok(row.at(-1).decAt > 0, 'decision time kept');
  const posts = cloud.log.filter(x => x[0] === 'POST').map(x => x[1][0]);
  assert.ok(posts.indexOf('live_tip_rate') > posts.lastIndexOf(KEY), 'signal after the data: ' + posts.join(','));
  assert.equal(rate(B), 80, 'nothing has pulled on B yet (this is the reported problem without the signal)');
  // B receives the Realtime event for the signal row → reads the changed rows
  assert.equal(typeof B.RT['rt-tip-rate'], 'function', 'B subscribed to the signal row');
  B.RT['rt-tip-rate']({}); await settle();
  assert.equal(rate(B), 90);
  assert.ok(B.RENDERS.includes('tiprate'), 'B redraws the page it shows');
  assert.ok(B.TOASTS.some(x => /ほかの端末で変わった Tip Rate/.test(x[0])));
  // the signal row is never stored on a device and never sent from one
  assert.equal(B.STORE.has('live_tip_rate'), false);
  assert.equal(run(B, "isOpSyncKey('live_tip_rate')"), false);
});

test('without Realtime, B still takes it on the next poll (every 20 s while visible) and when coming back to the screen', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am', rt: false });
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  assert.equal(B.INTERVALS.length, 1); assert.equal(B.INTERVALS[0].ms, 20000);
  await raise(A, 'Crew A', 100);
  run(B, '_tipLive.at = 0'); B.INTERVALS[0].fn(); await settle();
  assert.equal(rate(B), 100);
  // a poll right after another one does nothing (no request)
  const n = cloud.log.length; B.INTERVALS[0].fn(); await settle();
  assert.equal(cloud.log.length, n);
  // hidden screen: no request
  B.document.hidden = true; run(B, '_tipLive.at = 0'); B.INTERVALS[0].fn(); await settle();
  assert.equal(cloud.log.length, n);
});

test('B reads only rows changed since a little before its last read (5 minutes back for clock differences), and nothing it already has is rewritten', async () => {
  const cloud = makeCloud(); const B = device(cloud, { user: 'Yuki', role: 'am' });
  seed(cloud, [B], OLD80);
  run(B, 'tipLiveStart()');
  const since = run(B, '_tipLive.since');
  // another device wrote 4 minutes "before" B's clock (its clock is behind): still read
  const four = new Date(since - 240e3).toISOString(), six = new Date(since - 360e3).toISOString();
  cloud.rows.set(KEY, { value: JSON.stringify(OLD80.concat([{ id: 'tip200', name: 'Crew A', rate: 90, status: '承認', decAt: since - 240e3 }])), updated_at: four });
  cloud.rows.set('spl_tip_requests_Crew B', { value: JSON.stringify([{ id: 'tip300', name: 'Crew B', rate: 100, status: '承認', decAt: 1 }]), updated_at: six });
  await run(B, "tipLivePull('test')");
  const q = cloud.log.filter(x => x[0] === 'GET').at(-1)[1];
  assert.equal(new URLSearchParams(q).get('key'), 'like.spl\\_tip\\_requests\\_*', 'the "_" are literal (in LIKE a bare "_" is any character)');
  assert.equal(new URLSearchParams(q).get('updated_at'), 'gte.' + new Date(since - 300e3).toISOString());
  assert.equal(rate(B), 90, 'the 4-minute-old row is read');
  assert.equal(B.STORE.has('spl_tip_requests_Crew B'), false, 'older rows were taken by the login pull, not here');
  // the same row comes again within 5 minutes: no write, no redraw
  const r0 = B.RENDERS.length, before = B.STORE.get(KEY);
  await run(B, "tipLivePull('again')");
  assert.equal(B.RENDERS.length, r0); assert.equal(B.STORE.get(KEY), before);
});

test('a change B has not sent yet is kept when B reads the cloud (merge, not replace)', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Crew B', role: 'crew' });
  seed(cloud, [A, B], OLD80);
  // B (the staff's phone) made a request while offline: only on B
  cloud.failPost = true;
  B.STORE.set(KEY, JSON.stringify(OLD80.concat([{ id: 'tip-req', name: 'Crew A', rate: 100, status: '申請中' }])));
  cloud.failPost = false;
  await raise(A, 'Crew A', 90);
  run(B, 'tipLiveStart()'); B.RT['rt-tip-rate']({}); await settle();
  const ids = JSON.parse(B.STORE.get(KEY)).map(r => r.id);
  assert.deepEqual(ids.sort(), ['tip-req', 'tip100', ids.find(x => /^tip\d{10,}$/.test(x))].sort());
  assert.equal(rate(B), 90);
});

test('the current rate is the latest decision, not the last record in the list (an old request approved after a raise counts)', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  // a pending 100% request from before; then the manager raised to 90% directly
  seed(cloud, [A], OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 100, status: '申請中' }]));
  await raise(A, 'Crew A', 90);
  assert.equal(rate(A), 90);
  // now the old request is approved: it is the newest decision → 100%
  await run(A, "approveTip('tip150','承認')"); await settle();
  assert.equal(rate(A), 100, 'the newer decision wins (v1090 kept 90 because the raise is later in the list)');
  // records from before v1091 (no decision time) keep the old rule: the last one in the list
  const B = device(cloud);
  B.STORE.set(KEY, JSON.stringify([{ id: 'a', name: 'Crew A', rate: 90, status: '承認' }, { id: 'b', name: 'Crew A', rate: 100, status: '承認' }, { id: 'c', name: 'Crew A', rate: 80, status: '却下' }]));
  assert.equal(rate(B), 100);
});

test('two devices deciding the same request differently end with the same decision everywhere (the newer one; same time → rejected)', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  const PEND = OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 100, status: '申請中' }]);
  seed(cloud, [A, B], PEND);
  // B cannot read the cloud for a moment (offline) and rejects; A approves later … then B's copy reaches the cloud
  cloud.failPost = true;
  const fetch0 = cloud.fetch; cloud.fetch = async (u, o) => ((o && o.method === 'POST') || /key=eq/.test(u) ? { ok: false, status: 0, json: async () => null, text: async () => '' } : fetch0(u, o));
  await run(B, "approveTip('tip150','却下')"); await settle();
  cloud.fetch = fetch0; cloud.failPost = false;
  await new Promise(r => setTimeout(r, 5));
  await run(A, "approveTip('tip150','承認')"); await settle();   // A read the cloud (still pending there) and approved
  await run(B, "opMergePush('" + KEY + "', _lsRaw('" + KEY + "'))"); await settle();   // B's outbox sends its older rejection
  const st = () => JSON.parse(cloud.rows.get(KEY).value).find(r => r.id === 'tip150').status;
  assert.equal(st(), '承認', 'the newer decision (A) stays in the cloud');
  run(B, 'tipLiveStart()'); B.RT['rt-tip-rate']({}); await settle();
  assert.equal(JSON.parse(B.STORE.get(KEY)).find(r => r.id === 'tip150').status, '承認', 'B takes the newer decision (v1090 kept its own)');
  assert.equal(rate(B), 100);
  // same time: rejected stays, from either side
  const m = (cl, lo) => plain(run(A, 'mergeTipReq(' + JSON.stringify(cl) + ',' + JSON.stringify(lo) + ')'))[0].status;
  const ap = { id: 'x', name: 'Crew A', status: '承認', decAt: 500 }, rj = { id: 'x', name: 'Crew A', status: '却下', decAt: 500 };
  assert.equal(m([ap], [rj]), '却下'); assert.equal(m([rj], [ap]), '却下');
  // covers: a cloud copy with an older decision is not "saved yet"
  assert.equal(run(A, '_coversTipReq(' + JSON.stringify([{ ...ap, decAt: 400 }]) + ',' + JSON.stringify([ap]) + ')'), false);
  assert.equal(run(A, '_coversTipReq(' + JSON.stringify([ap]) + ',' + JSON.stringify([ap]) + ')'), true);
  assert.equal(run(A, '_coversTipReq(' + JSON.stringify([ap]) + ',' + JSON.stringify([rj]) + ')'), false, 'same time, the cloud has the losing approval');
});

test('deciding on a device with an old copy: it reads the cloud first, sees the other decision and changes nothing', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  const PEND = OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 100, status: '申請中' }]);
  seed(cloud, [A, B], PEND);
  await run(A, "approveTip('tip150','承認')"); await settle();
  // B still shows it as pending and presses 却下
  assert.equal(JSON.parse(B.STORE.get(KEY)).find(r => r.id === 'tip150').status, '申請中');
  await run(B, "approveTip('tip150','却下')"); await settle();
  assert.ok(B.TOASTS.some(x => /ほかの端末でもう「承認」/.test(x[0])), 'told it was already approved');
  assert.equal(JSON.parse(cloud.rows.get(KEY).value).find(r => r.id === 'tip150').status, '承認');
  assert.equal(rate(B), 100);
});

test('when the cloud cannot be reached the device says so; the signal is sent only after the rows are saved', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  seed(cloud, [A], OLD80);
  cloud.failPost = true;
  await raise(A, 'Crew A', 90);
  assert.ok(A.TOASTS.some(x => /クラウドへ送れていません/.test(x[0])));
  assert.equal(cloud.rows.has('live_tip_rate'), false);
  assert.equal(rate(A), 90, 'kept on this device');
  // the outbox sends it later and then signals (hook in flushOutbox)
  assert.match(fnSrc('flushOutbox'), /key\.indexOf\('spl_tip_requests_'\)===0 && typeof tipLiveBeacon==='function'\) tipLiveBeacon\(\[key\]\)/);
});

test('a page in the middle of typing or with a dialog open is not redrawn; it is redrawn on the next read', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  await raise(A, 'Crew A', 90);
  B.MODAL = true; B.RT['rt-tip-rate']({}); await settle();
  assert.equal(rate(B), 90, 'the data is taken');
  assert.equal(B.RENDERS.length, 0, 'not redrawn under the dialog');
  B.MODAL = false; await run(B, "tipLivePull('later')");
  assert.deepEqual(plain(B.RENDERS), ['tiprate']);
});

test('Codex P2 (#75 ae5c541): other pages are not redrawn; a "Refresh" notice appears only when someone’s rate changed', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  const B = device(cloud, { user: 'Yuki', role: 'am', page: 'budget' });   // e.g. a quarter plan typed but not saved yet
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  // a staff request only (no rate changes): data taken, nothing drawn, no notice
  const S = device(cloud, { user: 'Crew A', role: 'crew' });
  S.STORE.set(KEY, cloud.rows.get(KEY).value);
  S.window._tipSel = 100; S.INPUTS = { 'tip-reason': { value: '' } }; S.myName = undefined;
  run(S, "myName = function(){ return 'Crew A'; }; window._tipSel = 100; submitTipRequest()"); await settle(60);
  B.RT['rt-tip-rate']({}); await settle();
  assert.ok(JSON.parse(B.STORE.get(KEY)).some(r => r.status === '申請中'), 'the request reached B');
  assert.deepEqual(plain(B.RENDERS), [], 'B’s page is not redrawn');
  assert.equal(pill(B), null, 'no notice for a request alone');
  // a rate change: still no redraw, the notice instead
  await raise(A, 'Crew A', 90);
  B.RT['rt-tip-rate']({}); await settle();
  assert.equal(rate(B), 90, 'the new rate is on B');
  assert.deepEqual(plain(B.RENDERS), [], 'still not redrawn (v1091 at ae5c541 redrew budget here)');
  assert.ok(pill(B) && /ほかの端末で Tip Rate が変わりました/.test(pill(B).innerHTML), 'the notice is shown');
  assert.match(pill(B).innerHTML, /onclick="tipLiveApply\(\)"/);
  // pressing "表示を更新" draws the page once and removes the notice
  run(B, 'tipLiveApply()');
  assert.deepEqual(plain(B.RENDERS), ['budget']); assert.equal(pill(B), null);
  // the tip matrix (inputs) is treated like other pages; the rate views redraw by themselves
  const M = device(cloud, { user: 'Yuki', role: 'am', page: 'tip', view: 'matrix' }), R = device(cloud, { user: 'Yuki', role: 'am', page: 'tip', view: 'ratemgmt' });
  [M, R].forEach(d => { d.STORE.set(KEY, JSON.stringify(OLD80)); run(d, 'tipLiveStart()'); });
  await raise(A, 'Crew A', 100);
  for (const d of [M, R]) { d.RT['rt-tip-rate']({}); await settle(); }
  assert.deepEqual(plain(M.RENDERS), []); assert.ok(pill(M));
  assert.deepEqual(plain(R.RENDERS), ['tip']); assert.equal(pill(R), null);
  // logging out removes the notice
  run(M, 'tipLiveStop()'); assert.equal(pill(M), null);
});

test('independent review P1 (ae5c541): with v1090 and v1091 devices mixed, a later raise on an old device still counts', () => {
  const cloud = makeCloud(); const A = device(cloud);
  // v1091 raised 80 → 90 (with a decision time); afterwards a v1090 device raised to 100 (no time, added at the end)
  A.STORE.set(KEY, JSON.stringify([{ id: 'a', name: 'Crew A', rate: 80, status: '承認' }, { id: 'b', name: 'Crew A', rate: 90, status: '承認', decAt: 5000 },
    { id: 'c', name: 'Crew A', rate: 100, status: '承認' }]));
  assert.equal(rate(A), 100, 'the v1090 rule (the last one in the list) for the undated record (ae5c541 gave 90)');
  // a dated decision after an undated one is newer
  A.STORE.set(KEY, JSON.stringify([{ id: 'a', name: 'Crew A', rate: 100, status: '承認' }, { id: 'b', name: 'Crew A', rate: 90, status: '承認', decAt: 5000 }]));
  assert.equal(rate(A), 90);
  // an undated rejection after a dated approval does not hide it; dated records keep their time order
  A.STORE.set(KEY, JSON.stringify([{ id: 'b', name: 'Crew A', rate: 100, status: '承認', decAt: 9000 }, { id: 'c', name: 'Crew A', rate: 90, status: '承認', decAt: 5000 },
    { id: 'd', name: 'Crew A', rate: 80, status: '却下' }]));
  assert.equal(rate(A), 100);
});

test('a writer whose clock is far behind still reaches B at once: the signal names the changed rows and B reads them by key', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  await raise(A, 'Crew A', 90);
  const sig = JSON.parse(cloud.rows.get('live_tip_rate').value);
  assert.deepEqual(sig.keys, [KEY], 'the signal holds the changed row');
  assert.equal('by' in sig, false, 'no person’s name in the signal row');
  // A's clock is 10 minutes slow: its row looks older than B's 5-minute window
  cloud.rows.get(KEY).updated_at = new Date(Date.now() - 600e3).toISOString();
  B.RT['rt-tip-rate']({ new: { key: 'live_tip_rate', value: sig } }); await settle(60);
  assert.equal(rate(B), 90, 'read by key');
  assert.ok(cloud.log.some(x => x[0] === 'GET' && new URLSearchParams(x[1]).get('key') === 'eq.' + KEY));
  // without the keys (an old signal) the slow row is not seen until the next login (the remaining limit)
  const C = device(cloud, { user: 'Yuki', role: 'am' }); C.STORE.set(KEY, JSON.stringify(OLD80)); run(C, 'tipLiveStart()');
  C.RT['rt-tip-rate']({}); await settle(60);
  assert.equal(rate(C), 80);
  // keys from a signal that arrives while a read is running are kept for the next read
  const D = device(cloud, { user: 'Yuki', role: 'am' }); D.STORE.set(KEY, JSON.stringify(OLD80)); run(D, 'tipLiveStart()');
  run(D, '_tipLive.busy = true'); D.RT['rt-tip-rate']({ new: { value: JSON.stringify(sig) } });
  assert.deepEqual(plain(run(D, '_tipLive.keys')), [KEY]);
  run(D, '_tipLive.busy = false'); await run(D, "tipLivePull('again')");
  assert.equal(rate(D), 90);
});

test('polls every 20 s only on the Tip Rate screens (and until a signal has arrived); other screens every 60 s', async () => {
  const cloud = makeCloud();
  const B = device(cloud, { user: 'Yuki', role: 'am', page: 'budget', rt: false });
  seed(cloud, [B], OLD80); run(B, 'tipLiveStart()');
  const gets = () => cloud.log.filter(x => x[0] === 'GET').length;
  let n = gets(); run(B, '_tipLive.at = Date.now() - 21000'); B.INTERVALS[0].fn(); await settle();
  assert.equal(gets(), n, 'budget: no read after 20 s');
  run(B, '_tipLive.at = Date.now() - 61000'); B.INTERVALS[0].fn(); await settle();
  assert.equal(gets(), n + 1, 'budget: read after 60 s');
  for (const pg of ['tiprate', 'tip', 'mypage']) {
    run(B, 'curPage = ' + JSON.stringify(pg)); n = gets();
    run(B, '_tipLive.at = Date.now() - 21000'); B.INTERVALS[0].fn(); await settle();
    assert.equal(gets(), n + 1, pg + ': read after 20 s');
  }
  run(B, "curPage = 'tiprate'; _tipLive.rtOk = true"); n = gets();
  run(B, '_tipLive.at = Date.now() - 21000'); B.INTERVALS[0].fn(); await settle();
  assert.equal(gets(), n, 'after a signal has arrived: 60 s');
});

test('approving a request lower than the current rate asks first (the newest decision is the rate)', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  seed(cloud, [A], OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 90, status: '申請中' }]));
  await raise(A, 'Crew A', 100);
  A.CONFIRM_ANSWER = false;
  await run(A, "approveTip('tip150','承認')"); await settle();
  assert.match(A.CONFIRMS.at(-1), /いまの Crew A さんの Tip Rate は 100% です。承認すると 90% に下がります/);
  assert.equal(JSON.parse(A.STORE.get(KEY)).find(r => r.id === 'tip150').status, '申請中', 'declined: nothing changed');
  assert.equal(rate(A), 100);
  A.CONFIRM_ANSWER = true;
  await run(A, "approveTip('tip150','承認')"); await settle();
  assert.equal(rate(A), 90);
  // a higher rate or a rejection does not ask
  const k = A.CONFIRMS.length;
  seed(cloud, [A], OLD80.concat([{ id: 'tip160', name: 'Crew A', rate: 100, status: '申請中' }, { id: 'tip170', name: 'Crew A', rate: 80, status: '申請中' }]));
  await run(A, "approveTip('tip160','承認')"); await settle();
  await run(A, "approveTip('tip170','却下')"); await settle();
  assert.equal(A.CONFIRMS.length, k);
});

test('approveTip: a second press while reading says so; a log-out or another person during the read changes nothing; the cloud status is not shown as HTML', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  seed(cloud, [A], OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 100, status: '申請中' }, { id: 'tip151', name: 'Crew A', rate: 90, status: '申請中' }]));
  cloud.delay = 40;
  const p = run(A, "approveTip('tip150','承認')");
  await run(A, "approveTip('tip151','却下')");
  assert.ok(A.TOASTS.some(x => /前の操作を確かめています/.test(x[0])), 'the second press is not silent');
  run(A, "curUserName = 'Someone Else'; curRole = 'crew'");   // the shared tablet changed hands during the read
  await p; await settle();
  cloud.delay = 1;
  const rec = JSON.parse(A.STORE.get(KEY)).find(r => r.id === 'tip150');
  assert.equal(rec.status, '申請中'); assert.equal(rec.approver, undefined);
  // a status from the cloud is shown as a fixed word, not as markup
  run(A, "curUserName = 'Moto'; curRole = 'gm'");
  const bad = OLD80.concat([{ id: 'tip152', name: 'Crew A', rate: 100, status: '申請中' }]);
  A.STORE.set(KEY, JSON.stringify(bad));
  cloud.rows.set(KEY, { value: JSON.stringify(OLD80.concat([{ id: 'tip152', name: 'Crew A', rate: 100, status: '<img src=x onerror=alert(1)>', decAt: Date.now() }])), updated_at: new Date().toISOString() });
  await run(A, "approveTip('tip152','承認')"); await settle();
  const tw = A.TOASTS.at(-1)[0];
  assert.match(tw, /もう「決定済み」/); assert.doesNotMatch(tw, /<img/);
  // a slow read (up to 8 s) shows that it is checking
  seed(cloud, [A], OLD80.concat([{ id: 'tip153', name: 'Crew A', rate: 100, status: '申請中' }]));
  const f0 = cloud.fetch; cloud.fetch = async (u, o) => { if (!(o && o.method === 'POST')) await new Promise(r => setTimeout(r, 900)); return f0(u, o); };
  await run(A, "approveTip('tip153','承認')"); await settle(); cloud.fetch = f0;
  assert.ok(A.TOASTS.some(x => /クラウドの最新を確かめています/.test(x[0])));
});

test('a direct raise reads the person’s row first, so it is newer than a decision made on a device whose clock runs fast', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  // another device (clock 1 hour fast) approved 100% a moment ago; A has not read it yet
  const fast = Date.now() + 3600e3;
  cloud.rows.set(KEY, { value: JSON.stringify(OLD80.concat([{ id: 'tipF', name: 'Crew A', rate: 100, status: '承認', decAt: fast }])), updated_at: new Date().toISOString() });
  A.STORE.set(KEY, JSON.stringify(OLD80));
  await raise(A, 'Crew A', 90);
  const rec = JSON.parse(cloud.rows.get(KEY).value).find(r => r.rate === 90);
  assert.ok(rec.decAt > fast, 'stamped after the other decision');
  assert.equal(rate(A), 90, 'the raise made last is the rate (without the read: 100)');
  // a log-out during the read: nothing saved
  const B = device(cloud); B.STORE.set(KEY, JSON.stringify(OLD80)); cloud.delay = 40;
  B.INPUTS = { 'tipraise-name': { value: 'Crew A' }, 'tipraise-rate': { value: '80' } };
  const p = run(B, 'applyTipRaise()'); run(B, "curUserName = ''"); await p; await settle(); cloud.delay = 1;
  assert.equal(JSON.parse(B.STORE.get(KEY)).filter(r => r.rate === 80 && r.status === '承認').length, JSON.parse(cloud.rows.get(KEY).value).filter(r => r.rate === 80 && r.status === '承認').length);
  assert.ok(!JSON.parse(B.STORE.get(KEY)).some(r => r.rate === 80 && r.decAt > 0), 'no raise recorded');
});

test('with sync off, a failed save on the device does not claim it was sent to the cloud', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  run(A, 'SUPA_SYNC_ENABLED = false');
  await run(A, "tipLiveAfterSave(['Crew A'], false)");
  const tw = A.TOASTS.at(-1)[0];
  assert.match(tw, /この端末に保存できませんでした/); assert.doesNotMatch(tw, /クラウドへは送っています/);
});

test('review 2 P2-1: approving an older request counts even when undated (v1090) decisions come after it in the list', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  // 80% approved, a 100% request, then a direct raise to 90% made on v1090 (no decision time), all from before v1091
  const LEG = [{ id: 'a', name: 'Crew A', rate: 80, status: '承認' }, { id: 'b', name: 'Crew A', rate: 100, status: '申請中' }, { id: 'c', name: 'Crew A', rate: 90, status: '承認' }];
  seed(cloud, [A], LEG);
  assert.equal(rate(A), 90);
  await run(A, "approveTip('b','承認')"); await settle(60);
  assert.equal(rate(A), 100, 'the approval made now is the newest decision (6f75b67 kept 90)');
  assert.equal(A.CONFIRMS.length, 0, 'going up: no question');
  const rows = JSON.parse(cloud.rows.get(KEY).value);
  const t = Object.fromEntries(rows.map(r => [r.id, r.decAt]));
  assert.ok(t.a > 0 && t.c > t.a && t.b > t.c, 'the older decisions got times in their list order, before this approval: ' + JSON.stringify(t));
  const B = device(cloud); B.STORE.set(KEY, cloud.rows.get(KEY).value);
  assert.equal(rate(B), 100, 'another v1091 device reads the same rate');
  // the other way: an older 90% request after an undated 100% → asks, and the rate really goes down when approved
  seed(cloud, [A], [{ id: 'd', name: 'Crew A', rate: 90, status: '申請中' }, { id: 'e', name: 'Crew A', rate: 100, status: '承認' }]);
  A.CONFIRM_ANSWER = true;
  await run(A, "approveTip('d','承認')"); await settle(60);
  assert.match(A.CONFIRMS.at(-1), /Tip Rate は 100% です。承認すると 90% に下がります/);
  assert.equal(rate(A), 90, 'what the question said happens');
});

test('review 2 P3-3: the question and the message use the rate that really applies (3-month 100% etc.)', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  const K = 'spl_tip_requests_Crew C';
  cloud.rows.set(K, { value: JSON.stringify([{ id: 'x', name: 'Crew C', rate: 80, status: '申請中' }]), updated_at: new Date().toISOString() });
  A.STORE.set(K, cloud.rows.get(K).value);
  assert.equal(rate(A, 'Crew C'), 100, 'past 3 months');
  await run(A, "approveTip('x','承認')"); await settle(60);
  assert.equal(A.CONFIRMS.length, 0, 'not "goes down to 80%" (it stays 100%)');
  assert.match(A.TOASTS.at(-1)[0], /承認しました。ただし Crew C さんの Tip Rate は 100% です/);
  assert.equal(rate(A, 'Crew C'), 100);
});

test('review 2 P3-1: a read still running at log-out changes nothing and shows nothing', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am', page: 'budget' });
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  await raise(A, 'Crew A', 90);
  cloud.delay = 40;
  const p = run(B, "tipLivePull('poll')");
  run(B, "tipLiveStop(); curUserName = ''");
  await p; await settle(); cloud.delay = 1;
  assert.equal(pill(B), null, 'no notice on the login screen');
  assert.deepEqual(plain(B.RENDERS), []);
  assert.equal(JSON.parse(B.STORE.get(KEY)).some(r => r.rate === 90), false, 'not written after log-out');
});

test('review 2 P3-2: after the cloud read, approve / raise do not redraw a page the user moved to, and a closed or changed raise dialog raises nothing', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  seed(cloud, [A], OLD80.concat([{ id: 'tip150', name: 'Crew A', rate: 100, status: '申請中' }]));
  cloud.delay = 40;
  let p = run(A, "approveTip('tip150','承認')");
  run(A, "curPage = 'budget'");   // moved on while the read runs
  await p; await settle(60); cloud.delay = 1;
  assert.equal(JSON.parse(A.STORE.get(KEY)).find(r => r.id === 'tip150').status, '承認', 'the approval is saved');
  assert.equal(A.RENDERS.includes('budget'), false, 'the page the user moved to is not redrawn');
  // raise: the dialog closed during the read → nothing raised
  const B = device(cloud); B.STORE.set(KEY, JSON.stringify(OLD80));
  cloud.delay = 40;
  B.INPUTS = { 'tipraise-name': { value: 'Crew A' }, 'tipraise-rate': { value: '90' } };
  p = run(B, 'applyTipRaise()'); B.INPUTS = {}; await p; await settle(60);
  assert.ok(B.TOASTS.some(x => /画面を閉じたので、引き上げていません/.test(x[0])));
  assert.equal(JSON.parse(B.STORE.get(KEY)).some(r => r.basis === 'manual'), false);
  // the raise is saved but the page the user moved to is not redrawn
  B.INPUTS = { 'tipraise-name': { value: 'Crew A' }, 'tipraise-rate': { value: '90' } }; B.RENDERS.length = 0;
  p = run(B, 'applyTipRaise()'); run(B, "curPage = 'budget'"); await p; await settle(60);
  assert.equal(B.RENDERS.includes('budget'), false);
  assert.ok(JSON.parse(B.STORE.get(KEY)).some(r => r.basis === 'manual' && r.rate === 90), 'saved');
  run(B, "curPage = 'tiprate'");
  // changed during the read, then pressed again: told to press again, nothing raised with the old values (another person)
  B.INPUTS = { 'tipraise-name': { value: 'Crew B' }, 'tipraise-rate': { value: '90' } };
  p = run(B, 'applyTipRaise()');
  B.INPUTS['tipraise-rate'].value = '100'; await run(B, 'applyTipRaise()');
  assert.ok(B.TOASTS.some(x => /確かめています。少し待ってください/.test(x[0])), 'the second press is not silent');
  await p; await settle(60); cloud.delay = 1;
  assert.ok(B.TOASTS.some(x => /選び直したので、もう一度「引き上げる」を押してください/.test(x[0])));
  assert.equal(JSON.parse(B.STORE.get('spl_tip_requests_Crew B') || '[]').some(r => r.basis === 'manual'), false, 'no raise recorded');
});

test('review 2 P3-4 / P3-5: staff see the notice only for their own rate; a page drawn instead of the Tip Rate page is not redrawn', async () => {
  const cloud = makeCloud(); const A = device(cloud);
  const S = device(cloud, { user: 'Crew B', role: 'crew', page: 'mypage' });
  seed(cloud, [A, S], OLD80);
  const KB = 'spl_tip_requests_Crew B';
  cloud.rows.set(KB, { value: JSON.stringify([{ id: 'b1', name: 'Crew B', rate: 80, status: '承認' }]), updated_at: new Date(Date.now() - 3600e3).toISOString() });
  S.STORE.set(KB, cloud.rows.get(KB).value); A.STORE.set(KB, cloud.rows.get(KB).value);
  run(S, "myName = function(){ return 'Crew B'; }; tipLiveStart()");
  await raise(A, 'Crew A', 90);
  S.RT['rt-tip-rate']({}); await settle();
  assert.equal(pill(S), null, 'a coworker’s change: no notice for staff');
  await raise(A, 'Crew B', 90);
  S.RT['rt-tip-rate']({}); await settle();
  assert.ok(pill(S), 'their own rate changed');
  // the Tip Rate page hidden for this person (another page is drawn): treated like other pages
  const H = device(cloud, { user: 'Yuki', role: 'am' });
  run(H, "isPageHiddenForMe = function(p){ return p === 'tiprate'; }");
  assert.equal(run(H, 'tipLiveAutoPage()'), false);
  const O = device(cloud, { user: 'Yuki', role: 'am' });
  run(O, "curStore = 'OFFICE'; OFFICE_OK_PAGES = ['dashboard']");
  assert.equal(run(O, 'tipLiveAutoPage()'), false);
  run(O, "OFFICE_OK_PAGES = ['tiprate']");
  assert.equal(run(O, 'tipLiveAutoPage()'), true);
});

test('review 2 P3-6 / P3-9: signal keys that could not be read are kept for the next read; no extra request when the row already came; pulls on page open are not doubled', async () => {
  const cloud = makeCloud(); const A = device(cloud), B = device(cloud, { user: 'Yuki', role: 'am' });
  seed(cloud, [A, B], OLD80);
  run(B, 'tipLiveStart()');
  await raise(A, 'Crew A', 90);
  const sig = JSON.parse(cloud.rows.get('live_tip_rate').value);
  // the row is in the time window: read once, no by-key request
  let n = cloud.log.length;
  B.RT['rt-tip-rate']({ new: { value: sig } }); await settle(60);
  assert.equal(rate(B), 90);
  assert.equal(cloud.log.slice(n).filter(x => x[0] === 'GET' && /key=eq\./.test(x[1])).length, 0, 'no extra request');
  // a slow writer and a failing by-key read: the key is kept and read next time
  await raise(A, 'Crew A', 100);
  cloud.rows.get(KEY).updated_at = new Date(Date.now() - 600e3).toISOString();
  const sig2 = JSON.parse(cloud.rows.get('live_tip_rate').value);
  const f0 = cloud.fetch; cloud.fetch = async (u, o) => (/key=eq\./.test(u) ? { ok: false, status: 503, json: async () => null, text: async () => '' } : f0(u, o));
  B.RT['rt-tip-rate']({ new: { value: sig2 } }); await settle(60);
  assert.equal(rate(B), 90);
  assert.deepEqual(plain(run(B, '_tipLive.keys')), [KEY], 'kept');
  cloud.fetch = f0;
  await run(B, "tipLivePull('poll')");
  assert.equal(rate(B), 100, 'read on the next pull');
  assert.deepEqual(plain(run(B, '_tipLive.keys')), []);
  // Codex 6f75b67 / 27f5ec8: the by-key read throws (network error) → the key is kept too, and read after the network is back
  await raise(A, 'Crew A', 90);
  cloud.rows.get(KEY).updated_at = new Date(Date.now() - 600e3).toISOString();
  const sig3 = JSON.parse(cloud.rows.get('live_tip_rate').value);
  cloud.fetch = async (u, o) => { if (/key=eq\./.test(u)) throw new TypeError('Failed to fetch'); return f0(u, o); };
  B.RT['rt-tip-rate']({ new: { value: sig3 } }); await settle(60);
  assert.equal(rate(B), 100, 'not yet');
  assert.deepEqual(plain(run(B, '_tipLive.keys')), [KEY], 'kept after the error');
  cloud.fetch = f0;
  await run(B, "tipLivePull('poll')");
  assert.equal(rate(B), 90, 'read after the network is back');
  // opening a Tip Rate page while a read runs does not start another
  run(B, "_tipLive.busy = true; _tipLive.at = 0"); n = cloud.log.length;
  run(B, 'tipLivePullSoon()'); await new Promise(r => setTimeout(r, 10)); await settle();
  assert.equal(cloud.log.length, n);
  assert.equal(run(B, '_tipLive.again'), false, 'no second read queued');
  run(B, '_tipLive.busy = false');
});

test('wiring: started at login, stopped at logout, read when the Tip Rate screens open; staff requests also reach approvers', () => {
  assert.match(SRC, /\n {2}try\{ notifRealtimeStart\(\); \}catch\(e\)\{\}\n {2}try\{ tipLiveStart\(\); \}catch\(e\)\{\}/);
  assert.match(fnSrc('doLogout'), /tipLiveStop\(\)/);
  for (const f of ['renderTipRate', 'renderTipMgmt']) assert.match(fnSrc(f), /tipLivePullSoon\(\)/, f);
  assert.match(SRC, /\nfunction renderMypage\(\) \{\n {2}try\{ if\(typeof tipLivePullSoon==='function'\) tipLivePullSoon\(\); \}catch\(e\)\{\}/);   // fnSrc cannot read renderMypage (a regex literal)
  for (const f of ['submitTipRequest', 'submitTipFromSkill', 'approveTip', 'applyTipRaise']) assert.match(fnSrc(f), /tipLiveAfterSave\(/, f);
  assert.ok(MERGE_LINE && MERGE_LINE[1] === 'mergeTipReq' && MERGE_LINE[2] === '_coversTipReq', 'tip_requests uses the new merge rule');
  assert.match(varLine('LS_LOCAL_ONLY'), /'live_tip_rate'/);
  assert.match(fnSrc('renderPage'), /tipLivePill\(false\)/, 'drawing a page removes the "Refresh" notice');
});

test('version markers are 1091 or later and match', () => {
  const v = /const APP_VERSION = '(\d+)';/.exec(SRC)[1];
  const sw = fs.readFileSync(process.env.FUNERGY_SW || new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(Number(v) >= 1091, v);
  assert.equal(/const SW_BUILD = '(\d+)';/.exec(sw)[1], v);
});
