// App v1095 (Moto 2026-10-19 「Handbook の読了が正しく保存されていない」): the read records (handbook_reads) and the chapters
// (handbook_chapters) are merged per person and chapter instead of being replaced whole; a read says 「保存しました」 only after
// the cloud took it; the Handbook reads the cloud again when it opens; the update log has no per-device duplicates.
// Runs the real functions from index.html in a VM with synthetic data and a PGlite jsonb table as the cloud.
// No network, no production data. FUNERGY_INDEX=<path> runs the same checks against another build (v1094 fails the new ones).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(process.env.FUNERGY_SW || new URL('../sw.js', import.meta.url), 'utf8');

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
const opt = n => { try { return fnSrc(n); } catch (_e) { return ''; } };
function varSrc(name) { const m = new RegExp('^var ' + name + '\\b[^\\n]*$', 'm').exec(SRC); return m ? m[0] : ''; }
// The merge rules of the real OP_MERGE table for the Handbook keys (absent in v1094: then the key is written whole, as the app did).
function opMergeLine(key) {
  const m = new RegExp('^\\s*' + key + ':\\s*\\{\\s*merge:\\s*([A-Za-z_$][\\w$]*)\\s*,\\s*covers:\\s*([A-Za-z_$][\\w$]*)\\s*(,[^}]*)?\\}', 'm').exec(SRC);
  if (!m) return null;
  const rest = m[3] || '';
  return { merge: m[1], covers: m[2], keepLocal: /keepLocal:\s*true/.test(rest), strict: /strict:\s*true/.test(rest) };
}
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const FNS = ['mergeHbReads', '_hbReadCmp', '_coversHbReads', '_hbChCmp', 'mergeHbChapters', '_coversHbChapters', '_hbJs', '_logSig', '_canonForSig',
  'mergeAppendLog', '_coversLog', 'opMergePush', 'pullOpKey', '_pushWithOutbox', '_fetchOpValue', '_opWriteBack', '_hbPullKey', '_hbEditBtns', 'hbMarkRead', 'hbAfterReadSave', 'hbPullLatest', '_hbUnsent', 'hbSendNow',
  '_hbChRaw', 'getHbChapters', 'ensureHbSeed', 'hbSyncSeedVersion', 'hbChaptersSorted', 'hbStatus', 'renderHandbook', 'hbRenderReader', 'hbRenderAdmin',
  '_hbLogT', 'hbRenderLog', 'openHbEdit', 'hbSaveChapter', 'hbDeleteChapter', 'hbOpen', 'hbBack', 'hbSetTab'];
const VARS = ['_hbView', '_hbPull', '_lsPushP', '_hbEditBusy'];

// Two short synthetic chapters (the real seed is not used: its text is not what is being checked).
const SEED = [
  { id: 'ch1', order: 1, titleJa: '第一', titleEn: 'One', bodyJa: '<p>a</p>', bodyEn: '<p>a</p>', version: 3 },
  { id: 'ch2', order: 2, titleJa: '第二', titleEn: 'Two', bodyJa: '<p>b</p>', bodyEn: '<p>b</p>', version: 3 },
];
const EMPLOYEES = [
  { id: 'e1', name: 'Ann', store: 'F01', status: '在籍', role: 'crew' },
  { id: 'e2', name: 'Ben', store: 'F01', status: '在籍', role: 'crew' },
  { id: 'e3', name: 'Cat', store: 'F02', status: '在籍', role: 'crew' },
];

// One device. cloud: the shared PGlite table (or null: the cloud cannot be reached). st: this device's storage.
function device({ user = 'Ann', role = 'crew', st = {}, db = null, sync = true, booting = false, failUpsert = false, failFetch = false, httpError = false } = {}) {
  const S = JSON.parse(JSON.stringify(st));
  if (!S.op_outbox) S.op_outbox = [];
  const DEFS = {};
  for (const k of ['handbook_reads', 'handbook_chapters', 'handbook_log']) { const d = opMergeLine(k); if (d) DEFS[k] = d; }
  const c = {
    console, S, curUserName: user, curRole: role, curPage: 'crew_handbook', curStore: 'ALL', SUPA_SYNC_ENABLED: sync, _supaBooting: booting,
    HANDBOOK_SEED: plain(SEED), toasts: [], rendered: [], notifs: [], modals: [], closed: 0, confirms: true, ups: 0, failUpsert, failFetch, httpError, gate: null, gets: 0,
    t: (ja) => ja, clearTimeout: () => {}, AbortController: class { constructor() { this.signal = {}; } abort() {} },
    _LS_FETCHED: { handbook_log: 1 }, _opMergeChain: {}, _opLastPushErr: {}, _hbLang: 'ja', _hbTab: 'chapters', _hbStore: 'ALL',
    STORES: [{ id: 'F01', name: 'One' }, { id: 'F02', name: 'Two' }], SUPABASE_URL: 'https://cloud.invalid',
    ls: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), _lsRaw: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d),
    lsSet: null, showToast: (m, k) => c.toasts.push([m, k]), renderPage: p => c.rendered.push(p), escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    getEmployees: () => EMPLOYEES, activeStores: () => c.STORES, sortByLoginOrder: a => a, nowJP: () => '2026/10/19 09:30',
    progBar: () => '<bar>', kpi: (a, b, cc) => '<kpi ' + a + '=' + b + (cc ? ' ' + cc : '') + '>', hbTestCard: () => '', hbTestStatus: () => 'wait', hbTestCell: () => '',
    hbLoadTestResults: () => {}, hbTestCfg: () => ({ eName: 'x' }), hbTestResultOf: () => null, hbRenderTest: () => '<test>', openHbTestCfg: () => {},
    addNotif: n => c.notifs.push(n), openModal: h => c.modals.push(h), closeModalDirect: () => { c.closed++; }, confirm: () => c.confirms,
    window: { scrollTo: () => {} }, setTimeout: () => 0, document: { getElementById: id => (c.form && id in c.form ? { value: c.form[id] } : null) },
    _outboxGet: () => S.op_outbox.slice(), _outboxAdd: (k, e) => { if (!S.op_outbox.some(x => x.key === k)) S.op_outbox.push({ key: k, lastErr: String(e) }); },
    _outboxRemove: k => { S.op_outbox = S.op_outbox.filter(x => x.key !== k); },
    flushOutbox: async () => { for (const x of S.op_outbox.slice()) { const r = await c.syncMasterToSupabase(x.key, c.ls(x.key, null)); if (r !== false) c._outboxRemove(x.key); } },
    _lsPushBlocked: () => false, _handleLegacySplitRow: () => false, _lsMarkFetched: () => {}, _lsFreeOldLaborKeys: () => 0,
    _lsSetVerified: (k, json) => { S[k] = JSON.parse(json); return true; },
    _lsWriteVerified: (k, json) => { S[k] = JSON.parse(json); return true; },
    _opUpsertRow: (k, v) => ({ key: k, value: v }),
    _opMergeDef: k => (DEFS[k] ? { merge: c[DEFS[k].merge], covers: c[DEFS[k].covers], keepLocal: DEFS[k].keepLocal, strict: DEFS[k].strict } : null),
    // syncMasterToSupabase, app_state branch (index.html: a key with a merge rule goes through opMergePush, the others are upserted whole)
    syncMasterToSupabase: async (k, v) => (c._opMergeDef(k) ? c.opMergePush(k, v) : c.supaUpsert('app_state', [{ key: k, value: v }])),
    supaUpsert: async (_t, rows) => {
      c.ups++; if (c.failUpsert || !db) return false;
      for (const r of rows) await db.query('insert into app_state values($1,$2) on conflict(key) do update set value=excluded.value', [r.key, JSON.stringify(r.value)]);
      return true;
    },
    // The cloud's REST GET (index.html's _fetchOpValue and pullOpKey call it): failFetch = no connection, httpError = 503, gate = the answer waits.
    fetch: async url => {
      c.gets++;
      if (c.gate) await c.gate;
      if (c.failFetch || !db) throw new Error('offline');
      if (c.httpError) return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) };
      const k = decodeURIComponent(/key=eq\.([^&]+)/.exec(url)[1]);
      const r = await db.query('select value::text as v from app_state where key=$1', [k]);
      return { ok: true, json: async () => r.rows.map(x => ({ value: JSON.parse(x.v) })) };
    },
    supaHeaders: () => ({}),
  };
  vm.createContext(c);
  run(c, FNS.map(opt).join('\n') + '\n' + VARS.map(varSrc).join('\n'));
  if (!('_lsPushP' in c)) c._lsPushP = {};
  // lsSet: write to this device, then hand the push to the app's own _pushWithOutbox (as index.html's lsSet does).
  c.lsSet = (k, v) => { S[k] = JSON.parse(JSON.stringify(v)); if (c.SUPA_SYNC_ENABLED) c._pushWithOutbox(k, v); return true; };
  if (!c._pushWithOutbox) c._pushWithOutbox = (k, v) => { Promise.resolve(c.syncMasterToSupabase(k, v)).then(r => { if (r === false) c._outboxAdd(k, 'push failed'); }); };
  return c;
}
async function cloudDb(rows = {}) {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table app_state(key text primary key, value jsonb)');
  for (const [k, v] of Object.entries(rows)) await db.query('insert into app_state values($1,$2)', [k, JSON.stringify(v)]);
  return db;
}
const cloudOf = async (db, k) => { const r = await db.query('select value::text as v from app_state where key=$1', [k]); return r.rows.length ? JSON.parse(r.rows[0].v) : null; };
const R = (v, t, at = '2026/10/19 09:00') => ({ v, at, _t: t });

test('the cause, reproduced: a device with an old copy that saves a read no longer erases what others read', async () => {
  const db = await cloudDb({ handbook_reads: { Ann: { ch1: R(3, 1) } }, handbook_chapters: SEED });
  // Both devices last read the cloud when only Ann's chapter 1 was there.
  const ann = device({ user: 'Ann', db, st: { handbook_reads: { Ann: { ch1: R(3, 1) } }, handbook_chapters: plain(SEED) } });
  const ben = device({ user: 'Ben', db, st: { handbook_reads: { Ann: { ch1: R(3, 1) } }, handbook_chapters: plain(SEED) } });
  run(ben, "hbMarkRead('ch1')"); await tick(30);
  run(ann, "hbMarkRead('ch2')"); await tick(30);   // Ann's device still has the old copy without Ben's read
  const cloud = await cloudOf(db, 'handbook_reads');
  assert.ok(cloud.Ben && cloud.Ben.ch1, "Ben's read is still in the cloud (v1094 erased it: the whole object was upserted)");
  assert.deepEqual(Object.keys(cloud.Ann).sort(), ['ch1', 'ch2']);
  // Ben's device reads the cloud again: everything is there, nothing of his is lost.
  assert.equal(await run(ben, 'hbPullLatest(true)'), true);
  assert.deepEqual(Object.keys(ben.S.handbook_reads).sort(), ['Ann', 'Ben']);
  assert.ok(ben.toasts.some(([m, k]) => /読了を保存しました/.test(m) && k === 'success'));
  await db.close();
});

test('a read that could not be sent is kept on the device through a cloud read, then sent; retries do not add a second record', async () => {
  const db = await cloudDb({ handbook_reads: { Ben: { ch1: R(3, 5) } }, handbook_chapters: SEED });
  const ann = device({ user: 'Ann', db, st: { handbook_reads: {}, handbook_chapters: plain(SEED) } });
  ann.failUpsert = true;
  run(ann, "hbMarkRead('ch1')"); await tick(30);
  assert.ok(ann.toasts.some(([m, k]) => /まだクラウドに送れていません/.test(m) && k === 'warning'), 'not told it was saved');
  assert.ok(!ann.toasts.some(([m]) => /読了を保存しました/.test(m)));
  assert.equal(run(ann, '_hbUnsent()'), true);
  assert.match(run(ann, 'renderHandbook()'), /まだクラウドに送れていません/, 'the list says so');
  // Logging in again / 最新に更新 reads the cloud before the unsent read is sent (v1094 replaced the device copy with the cloud's).
  ann.failUpsert = false;
  assert.equal(await run(ann, 'pullOpKey("handbook_reads")'), true);
  assert.ok(ann.S.handbook_reads.Ann && ann.S.handbook_reads.Ann.ch1, 'the unsent read is still on the device');
  assert.ok(ann.S.handbook_reads.Ben, 'and the cloud reads came in');
  await run(ann, 'hbSendNow()'); await tick(30);
  const cloud = await cloudOf(db, 'handbook_reads');
  assert.ok(cloud.Ann.ch1 && cloud.Ben.ch1);
  assert.equal(run(ann, '_hbUnsent()'), false);
  // Sending the same read again keeps one record per person and chapter.
  await run(ann, 'flushOutbox()'); ann._outboxAdd('handbook_reads', 'again'); await run(ann, 'flushOutbox()');
  assert.deepEqual(Object.keys((await cloudOf(db, 'handbook_reads')).Ann), ['ch1']);
  await db.close();
});

test('the read waits for the cloud before it says 保存しました; during start-up it is put in the unsent list; sync off says so', async () => {
  const db = await cloudDb({});
  const a = device({ user: 'Ann', db, st: { handbook_chapters: plain(SEED) } });
  run(a, "hbMarkRead('ch1')");
  assert.ok(!a.toasts.some(([m]) => /読了を保存しました/.test(m)), 'not before the cloud answered');
  assert.ok(a.toasts.some(([m]) => /保存しています/.test(m)));
  await tick(30);
  assert.ok(a.toasts.some(([m, k]) => /第1章の読了を保存しました/.test(m) && k === 'success'));
  const b = device({ user: 'Ben', db, booting: true, st: { handbook_chapters: plain(SEED) } });
  run(b, "hbMarkRead('ch1')"); await tick(30);
  assert.ok(b.S.op_outbox.some(x => x.key === 'handbook_reads'), 'kept to send later (v1094 sent nothing and kept nothing)');
  assert.ok(b.toasts.some(([m, k]) => /まだクラウドに送れていません/.test(m) && k === 'warning'));
  const off = device({ user: 'Cat', db, sync: false, st: { handbook_chapters: plain(SEED) } });
  run(off, "hbMarkRead('ch2')"); await tick(10);
  assert.ok(off.toasts.some(([m]) => /同期が OFF/.test(m)));
  await db.close();
});

test('merging reads: union per person and chapter, the newer chapter version wins, any order gives the same result, covers holds', () => {
  const c = device({});
  const m = (a, b) => plain(run(c, 'mergeHbReads(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')'));
  const a = { Ann: { ch1: R(2, 10), ch2: R(3, 5) }, Ben: { ch1: R(3, 1) } };
  const b = { Ann: { ch1: R(3, 2), ch3: R(1, 9) }, Cat: { ch2: R(3, 4) } };
  const ab = m(a, b), ba = m(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.Ann.ch1.v, 3, 'a read of the newer version wins over an older one, whatever its time');
  assert.deepEqual(Object.keys(ab).sort(), ['Ann', 'Ben', 'Cat']);
  assert.deepEqual(Object.keys(ab.Ann).sort(), ['ch1', 'ch2', 'ch3']);
  // Same version: the later read time (the record that was written last) is kept, on every device.
  assert.equal(m({ Ann: { ch1: R(3, 7) } }, { Ann: { ch1: R(3, 9) } }).Ann.ch1._t, 9);
  assert.equal(m({ Ann: { ch1: R(3, 9) } }, { Ann: { ch1: R(3, 7) } }).Ann.ch1._t, 9);
  // Random: commutative, idempotent, associative; the merge covers both sides; jsonb's reordered keys do not matter.
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const gen = () => { const o = {}; for (let i = 0; i < 1 + rnd(3); i++) { const nm = ['Ann', 'Ben', 'Cat'][rnd(3)]; o[nm] = o[nm] || {}; o[nm]['ch' + (1 + rnd(3))] = { at: '2026/10/1' + rnd(9) + ' 0' + rnd(9) + ':00', v: 1 + rnd(3), _t: rnd(4) }; } return o; };
  const rev = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
  for (let i = 0; i < 300; i++) {
    const x = gen(), y = gen(), z = gen();
    const xy = m(x, y);
    assert.equal(JSON.stringify(run(c, '_canonForSig')(xy)), JSON.stringify(run(c, '_canonForSig')(m(y, x))));
    assert.equal(JSON.stringify(run(c, '_canonForSig')(m(xy, xy))), JSON.stringify(run(c, '_canonForSig')(xy)));
    assert.equal(JSON.stringify(run(c, '_canonForSig')(m(m(x, y), z))), JSON.stringify(run(c, '_canonForSig')(m(x, m(y, z)))));
    assert.equal(run(c, '_coversHbReads(' + JSON.stringify(rev(xy)) + ',' + JSON.stringify(x) + ')'), true);
    assert.equal(run(c, '_coversHbReads(' + JSON.stringify(rev(xy)) + ',' + JSON.stringify(y) + ')'), true);
  }
  assert.equal(run(c, '_coversHbReads(' + JSON.stringify({ Ann: { ch1: R(2, 1) } }) + ',' + JSON.stringify({ Ann: { ch1: R(3, 1) } }) + ')'), false, 'an older version does not cover');
});

test('pushing through a jsonb cloud row is confirmed in one write (keys come back reordered)', async () => {
  const db = await cloudDb({});
  const a = device({ user: 'Ann', db, st: { handbook_chapters: plain(SEED) } });
  run(a, "hbMarkRead('ch1')"); await tick(30);
  assert.equal(a.ups, 1, 'no retry because of the key order');
  assert.equal(a._opLastPushErr.handbook_reads, '');
  await db.close();
});

test('chapters: an edit, a deletion and the seed merge per chapter; a deleted chapter does not come back; edits made on top of another person\'s are refused', async () => {
  const db = await cloudDb({ handbook_chapters: SEED, handbook_log: [] });
  const gm = device({ user: 'Moto', role: 'gm', db, st: { handbook_chapters: plain(SEED), handbook_log: [] } });
  // GM edits chapter 1 (v3 → v4).
  gm.form = { 'hbe-v': '3', 'hbe-order': '1', 'hbe-tja': '第一（改）', 'hbe-ten': 'One', 'hbe-bja': '<p>new</p>', 'hbe-ben': '<p>new</p>', 'hbe-note': '直した' };
  await run(gm, "hbSaveChapter('ch1')"); await tick(30);
  assert.equal((await cloudOf(db, 'handbook_chapters')).find(x => x.id === 'ch1').version, 4);
  assert.ok(gm.toasts.some(([m, k]) => /章を更新しました/.test(m) && k === 'success'));
  // A device that still had the v3 copy edits the same chapter from its old copy: refused (the cloud is read first).
  const ceo = device({ user: 'Tac', role: 'ceo', db, st: { handbook_chapters: plain(SEED), handbook_log: [] } });
  ceo.form = Object.assign({}, gm.form, { 'hbe-tja': '別の直し', 'hbe-note': '別' });
  await run(ceo, "hbSaveChapter('ch1')"); await tick(30);
  assert.ok(ceo.toasts.some(([m]) => /ほかの人が先にこの章を更新しました/.test(m)));
  assert.equal((await cloudOf(db, 'handbook_chapters')).find(x => x.id === 'ch1').titleJa, '第一（改）');
  // GM deletes chapter 2: it stays deleted in the cloud and on a device whose seed or old copy still has it.
  await run(gm, "hbDeleteChapter('ch2')"); await tick(30);
  const old = device({ user: 'Ann', db, st: { handbook_chapters: plain(SEED) } });
  run(old, 'hbSyncSeedVersion()'); await run(old, 'hbPullLatest(true)'); run(old, 'hbSyncSeedVersion()');
  assert.deepEqual(run(old, 'hbChaptersSorted()').map(x => x.id), ['ch1'], 'chapter 2 does not come back (v1094 re-added it)');
  assert.ok((await cloudOf(db, 'handbook_chapters')).find(x => x.id === 'ch2')._deleted);
  // A brand-new device (nothing yet) seeds and then merges: the cloud's newer chapter 1 and the deletion win.
  const fresh = device({ user: 'Ben', db, st: {} });
  run(fresh, 'ensureHbSeed()'); await tick(30); await run(fresh, 'hbPullLatest(true)');
  assert.deepEqual(run(fresh, 'hbChaptersSorted()').map(x => [x.id, x.version]), [['ch1', 4]]);
  await db.close();
});

test('merging chapters: the higher version wins even with an older save time; a person\'s edit beats the seed at the same version; any order gives the same result; covers holds', () => {
  const c = device({});
  const m = (a, b) => plain(run(c, 'mergeHbChapters(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')'));
  const v5 = { id: 'ch1', order: 1, version: 5, titleJa: 'five', _at: 100 }, v4 = { id: 'ch1', order: 1, version: 4, titleJa: 'four', _at: 200 };
  assert.equal(m([v5], [v4])[0].version, 5, 'a device whose clock was ahead does not bring back an older version');
  assert.equal(m([v4], [v5])[0].version, 5);
  const seed = { id: 'ch2', order: 2, version: 3, titleJa: 'seed' }, edited = { id: 'ch2', order: 2, version: 3, titleJa: 'edited', updatedAt: '2026/10/01 10:00' };
  assert.equal(m([seed], [edited])[0].titleJa, 'edited'); assert.equal(m([edited], [seed])[0].titleJa, 'edited');
  assert.deepEqual(m([v5, seed], [{ id: 'ch9', order: 9, version: 1 }]).map(x => x.id), ['ch1', 'ch2', 'ch9'], 'chapters only one side has are kept');
  let s = 3; const rnd = n => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  const gen = () => Array.from({ length: 1 + rnd(3) }, () => ({ id: 'ch' + (1 + rnd(3)), order: 1 + rnd(3), version: 1 + rnd(3), _at: rnd(3) ? rnd(5) : undefined, titleJa: 't' + rnd(3), _deleted: rnd(5) === 0 || undefined }));
  const canon = v => JSON.stringify(run(c, '_canonForSig')(v));
  for (let i = 0; i < 300; i++) {
    const x = gen(), y = gen(), z = gen();
    assert.equal(canon(m(x, y)), canon(m(y, x)));
    assert.equal(canon(m(m(x, y), z)), canon(m(x, m(y, z))));
    assert.equal(run(c, '_coversHbChapters(' + JSON.stringify(m(x, y)) + ',' + JSON.stringify(x) + ')'), true);
  }
  assert.equal(run(c, '_coversHbChapters(' + JSON.stringify([v4]) + ',' + JSON.stringify([v5]) + ')'), false, 'an older version in the cloud does not cover');
  // A deleted chapter stays deleted and untouched when the app's seed is newer than the deletion mark (no log record either).
  const d = device({ st: { handbook_chapters: [{ id: 'ch1', order: 1, version: 3, titleJa: 'x', bodyJa: '' }, { id: 'ch2', order: 2, version: 2, _deleted: true, _at: 5 }], handbook_log: [] } });
  run(d, 'hbSyncSeedVersion()');
  assert.deepEqual(plain(d.S.handbook_chapters).find(x => x.id === 'ch2'), { id: 'ch2', order: 2, version: 2, _deleted: true, _at: 5 });
  assert.equal(d.S.handbook_log.length, 0);
});

test('the update log: the seed update is one record whatever the number of devices, with the right version; first-edition only once', async () => {
  const OLD = SEED.map(x => Object.assign({}, x, { version: 2 }));
  const a = device({ st: { handbook_chapters: plain(OLD), handbook_log: [] }, db: null });
  const b = device({ st: { handbook_chapters: plain(OLD), handbook_log: [] }, db: null });
  b.nowJP = () => '2026/10/20 11:11';
  run(a, 'hbSyncSeedVersion()'); run(b, 'hbSyncSeedVersion()');
  const merged = plain(run(a, 'mergeAppendLog(' + JSON.stringify(a.S.handbook_log) + ',' + JSON.stringify(b.S.handbook_log) + ')'));
  assert.equal(merged.length, 1, 'two devices, one record (v1094 wrote one per device)');
  assert.equal(merged[0].ver, 3, 'the version is the seed version (v1094 always wrote v2)');
  // Running again on the same device adds nothing.
  run(a, 'hbSyncSeedVersion()'); assert.equal(a.S.handbook_log.length, 1);
  // A device that has not read the cloud log yet does not write 「初版」 again.
  const fresh = device({ st: {} }); fresh._LS_FETCHED.handbook_log = 0;
  run(fresh, 'ensureHbSeed()');
  assert.equal((fresh.S.handbook_log || []).length, 0);
  // Newest first, also when a device's record was appended after the cloud's.
  const lg = [{ at: '2026/10/18 10:00', by: 'A', ch: 'x', ver: 4, note: 'later' }, { at: '2026/10/01 10:00', by: 'B', ch: 'y', ver: 3, note: 'earlier' }, { at: '2026/10/19 08:00', ts: new Date(2026, 9, 19, 8).getTime(), by: 'C', ch: 'z', ver: 5, note: 'newest' }];
  const view = device({ role: 'gm', st: { handbook_log: lg } });
  const html = run(view, 'hbRenderLog()');
  assert.ok(html.indexOf('newest') < html.indexOf('later') && html.indexOf('later') < html.indexOf('earlier'));
});

test('進捗管理 shows the same counts as each person\'s own list, from the same records; when the cloud cannot be read it says it shows this device\'s copy', async () => {
  const db = await cloudDb({ handbook_reads: { Ann: { ch1: R(3, 1), ch2: R(3, 2) }, Ben: { ch1: R(2, 1) } }, handbook_chapters: SEED });
  const mgr = device({ user: 'Moto', role: 'gm', db, st: { handbook_reads: {}, handbook_chapters: plain(SEED) } });
  mgr._hbTab = 'admin'; run(mgr, "_hbTab='admin'");
  assert.equal(await run(mgr, 'hbPullLatest(true)'), true);
  const admin = run(mgr, 'renderHandbook()');
  assert.match(admin, /クラウドから読み直し/);
  assert.match(admin, /<b>Ann<\/b>.*?>2\/2</s);
  assert.match(admin, /<b>Ben<\/b>.*?>0\/2<br><span[^>]*>要再確認1</s, 'Ben read an older version of chapter 1');
  for (const [nm, want] of [['Ann', '2 / 2章'], ['Ben', '0 / 2章']]) {
    const own = device({ user: nm, db, st: { handbook_reads: plain(mgr.S.handbook_reads), handbook_chapters: plain(SEED) } });
    assert.match(run(own, 'renderHandbook()'), new RegExp(want.replace(/\//g, '\\/')));
  }
  mgr.failFetch = true;
  assert.equal(await run(mgr, 'hbPullLatest(true)'), false);
  assert.match(run(mgr, 'renderHandbook()'), /読み直せませんでした。この端末の写しを出しています/);
  // Opening the Handbook is enough to read the cloud again (v1094 read it only at login and 最新に更新).
  const other = device({ user: 'Moto', role: 'gm', db, st: { handbook_reads: {}, handbook_chapters: plain(SEED) } });
  run(other, "_hbTab='admin'"); run(other, 'renderHandbook()'); await tick(30);
  assert.ok(other.S.handbook_reads.Ann && other.S.handbook_reads.Ann.ch2, 'read on opening');
  assert.ok(other.rendered.includes('crew_handbook'), 'and drawn again');
  await db.close();
});

test('進捗管理: the average check score counts only people whose result has a score', () => {
  const c = device({ user: 'Moto', role: 'gm', st: { handbook_reads: {}, handbook_chapters: plain(SEED) } });
  c.hbTestStatus = () => 'done';
  c.hbTestResultOf = nm => (nm === 'Ann' ? { score: 8, max_score: 10 } : {});
  run(c, "_hbTab='admin'");
  const html = run(c, 'renderHandbook()');
  assert.match(html, /平均 8\/10/, 'Ben and Cat have no score yet (v1094 divided by 3)');
});

test('scrolling alone does not mark a chapter as read (only the button does), and the Handbook keys are kept when storage is freed', () => {
  assert.match(fnSrc('hbCheckScroll'), /btn\.disabled=false/);
  assert.doesNotMatch(fnSrc('hbCheckScroll'), /hbMarkRead|handbook_reads/);
  const nf = /^var LS_NEVER_FREE = \[[\s\S]*?\];/m.exec(SRC)[0];
  assert.match(nf, /'handbook_reads'/); assert.match(nf, /'handbook_chapters'/);
  assert.match(SRC, /crew_handbook:'handbook'/, 'the page 同期 reads the Handbook again');
});

test('review P2-1: when the cloud read fails (HTTP 503), an old-copy device does not write its copy over the cloud; the read stays unsent and is sent later', async () => {
  const db = await cloudDb({ handbook_reads: { Ann: { ch1: R(3, 1) }, Ben: { ch1: R(3, 2) } }, handbook_chapters: SEED });
  const cat = device({ user: 'Cat', db, st: { handbook_reads: { Ann: { ch1: R(3, 1) } }, handbook_chapters: plain(SEED) } });
  cat.httpError = true;
  run(cat, "hbMarkRead('ch1')"); await tick(30);
  assert.equal(cat.ups, 0, 'nothing written blind');
  assert.ok((await cloudOf(db, 'handbook_reads')).Ben, "Ben's read is still in the cloud");
  assert.ok(cat.toasts.some(([m, k]) => /まだクラウドに送れていません/.test(m) && k === 'warning'));
  assert.ok(cat.S.op_outbox.some(x => x.key === 'handbook_reads'));
  cat.httpError = false; await run(cat, 'flushOutbox()');
  assert.deepEqual(Object.keys(await cloudOf(db, 'handbook_reads')).sort(), ['Ann', 'Ben', 'Cat']);
  await db.close();
});

test('review P2-2: reads erased from the cloud (an old app version wrote its copy) come back when a device that has them opens the Handbook', async () => {
  const db = await cloudDb({ handbook_reads: { Ann: { ch1: R(3, 1), ch2: R(3, 2) } }, handbook_chapters: SEED });
  const ann = device({ user: 'Ann', db, st: { handbook_reads: { Ann: { ch1: R(3, 1), ch2: R(3, 2) } }, handbook_chapters: plain(SEED) } });
  await db.query("update app_state set value=$1 where key='handbook_reads'", [JSON.stringify({ Ben: { ch1: R(3, 9) } })]);   // a v1094 device upserted its own copy
  assert.equal(await run(ann, 'hbPullLatest(true)'), true); await tick(30);
  const cloud = await cloudOf(db, 'handbook_reads');
  assert.deepEqual(Object.keys(cloud.Ann || {}).sort(), ['ch1', 'ch2'], "Ann's reads are written back");
  assert.ok(cloud.Ben, "and Ben's stay");
  // Nothing to repair: opening again writes nothing.
  const before = ann.ups; await run(ann, 'hbPullLatest(true)'); await tick(30);
  assert.equal(ann.ups, before);
  await db.close();
});

test('review P2-3: saving a chapter twice quickly, or closing the dialog while the cloud is read, does not make two chapters or save after closing', async () => {
  const db = await cloudDb({ handbook_chapters: SEED, handbook_log: [] });
  const gm = device({ user: 'Moto', role: 'gm', db, st: { handbook_chapters: plain(SEED), handbook_log: [] } });
  gm.form = { 'hbe-v': '', 'hbe-order': '3', 'hbe-tja': '新しい章', 'hbe-ten': 'New', 'hbe-bja': '<p>x</p>', 'hbe-ben': '<p>x</p>', 'hbe-note': '追加' };
  let open; gm.gate = new Promise(r => { open = r; });
  const p1 = run(gm, 'hbSaveChapter(null)'); const p2 = run(gm, 'hbSaveChapter(null)');
  open(); gm.gate = null; await p1; await p2; await tick(30);
  assert.equal((await cloudOf(db, 'handbook_chapters')).filter(x => x.titleJa === '新しい章').length, 1, 'one chapter (two before)');
  assert.ok(gm.toasts.some(([m]) => /保存しています。少し待って/.test(m)));
  // Closing the dialog while the cloud is read saves nothing.
  gm.gate = new Promise(r => { open = r; });
  gm.form = Object.assign({}, gm.form, { 'hbe-tja': 'もう一つ' });
  const p3 = run(gm, 'hbSaveChapter(null)'); gm.form = null; open(); gm.gate = null; await p3; await tick(30);
  assert.equal((await cloudOf(db, 'handbook_chapters')).filter(x => x.titleJa === 'もう一つ').length, 0);
  assert.ok(gm.toasts.some(([m]) => /閉じたので保存していません/.test(m)));
  // When the chapters cannot be read, nothing is saved (an old copy would make a second version with the same number).
  gm.form = { 'hbe-v': '3', 'hbe-order': '2', 'hbe-tja': 'off', 'hbe-ten': 'x', 'hbe-bja': '<p>x</p>', 'hbe-ben': '', 'hbe-note': 'x' };
  gm.httpError = true; await run(gm, "hbSaveChapter('ch2')"); gm.httpError = false;
  assert.ok(gm.toasts.some(([m]) => /読めなかったので保存していません/.test(m)));
  assert.equal((await cloudOf(db, 'handbook_chapters')).find(x => x.id === 'ch2').version, 3);
  await db.close();
});

test('review P3: delete reads the cloud first and refuses a stale copy; a deletion always wins over any version; a read made while another is sent stays on the device; a stuck read does not block the next', async () => {
  const db = await cloudDb({ handbook_chapters: SEED.map(x => (x.id === 'ch2' ? Object.assign({}, x, { version: 5, titleJa: 'edited', _at: 9, updatedAt: '2026/10/19 09:00' }) : x)), handbook_reads: {} });
  const gm = device({ user: 'Moto', role: 'gm', db, st: { handbook_chapters: plain(SEED), handbook_log: [] } });
  gm.form = { 'hbe-v': '3' };
  await run(gm, "hbDeleteChapter('ch2')"); await tick(30);
  assert.ok(gm.toasts.some(([m]) => /ほかの人が先にこの章を更新しました/.test(m)));
  assert.ok(!(await cloudOf(db, 'handbook_chapters')).find(x => x.id === 'ch2')._deleted, 'not deleted from the stale copy');
  const c = device({});
  const del = { id: 'ch2', order: 2, version: 2, _deleted: true, _at: 1 }, newer = { id: 'ch2', order: 2, version: 9, titleJa: 'seed v9' };
  assert.ok(plain(run(c, 'mergeHbChapters(' + JSON.stringify([newer]) + ',' + JSON.stringify([del]) + ')'))[0]._deleted, 'a later seed version does not bring a deleted chapter back');
  // keepLocal: chapter 2 read while chapter 1 is being sent is not dropped by the first write-back.
  const ann = device({ user: 'Ann', db, st: { handbook_reads: {}, handbook_chapters: plain(SEED) } });
  let open; ann.gate = new Promise(r => { open = r; });
  run(ann, "hbMarkRead('ch1')"); const p1 = ann._lsPushP.handbook_reads;
  run(ann, "hbMarkRead('ch2')");
  open(); ann.gate = null; await p1;
  assert.ok(ann.S.handbook_reads.Ann.ch2, 'chapter 2 is still on the device after the first send');
  await tick(40);
  assert.deepEqual(Object.keys((await cloudOf(db, 'handbook_reads')).Ann).sort(), ['ch1', 'ch2']);
  // A read that never answers does not keep the Handbook from reading again after 20 seconds.
  run(ann, '_hbPull.busy = Date.now() - 25000; _hbPull.ok = null');
  assert.equal(await run(ann, 'hbPullLatest(true)'), true);
  await db.close();
});

test('review P3: saving a chapter with sync off says this device only', async () => {
  const gm = device({ user: 'Moto', role: 'gm', sync: false, st: { handbook_chapters: plain(SEED), handbook_log: [] } });
  gm.form = { 'hbe-v': '3', 'hbe-order': '1', 'hbe-tja': 'x', 'hbe-ten': 'x', 'hbe-bja': '<p>x</p>', 'hbe-ben': '', 'hbe-note': 'x' };
  await run(gm, "hbSaveChapter('ch1')");
  assert.ok(gm.toasts.some(([m]) => /同期が OFF のため、この端末だけ/.test(m)));
  assert.ok(!gm.toasts.some(([m]) => /送り直します/.test(m)));
});

test('the release markers match', () => {
  const v = (/const APP_VERSION = '(\d+)'/.exec(SRC) || [])[1];
  assert.ok(Number(v) >= 1095, 'APP_VERSION ' + v);
  assert.equal((/const SW_BUILD = '(\d+)'/.exec(SW) || [])[1], v);
});
