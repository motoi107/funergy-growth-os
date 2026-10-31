// v1121 (request 10/30 ③): vendor master — categories, deactivate / delete that stay on every device, and
// sending only the vendors (and fields) this device changed. The "cloud" is a PGlite database with the real
// migration (the vendors_keep_state guard) behind a tiny PostgREST stand-in, used as the anon role.
// Two app "devices" run the real functions from index.html in VMs. Synthetic vendors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.VENDOR_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = fs.readFileSync(process.env.VENDOR_MIGRATION_PATH || new URL('../supabase/migrations/20261101090000_vendor_state_guard.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
function pick(src, name) {
  for (const head of ['\nfunction ' + name + '(', '\nasync function ' + name + '(']) {
    const start = src.indexOf(head);
    if (start < 0) continue;
    const eol = src.indexOf('\n', start + 1), line = src.slice(start + 1, eol);
    if ((line.match(/{/g) || []).length === (line.match(/}/g) || []).length) return line;   // a one-line function
    const end = src.indexOf('\n}', start + 1);
    return src.slice(start + 1, end + 2);
  }
  assert.fail('missing ' + name);
}
const varLine = (src, name) => { const m = src.match(new RegExp('\\nvar ' + name + ' = [^\\n]*')); assert.ok(m, 'missing var ' + name); return m[0].slice(1); };
const NAMES = ['getVendors', 'vendorCatOf', 'vendorCatLabel', 'vendorStateOf', 'getVendorsPickable', '_vbBase', '_vbJson', '_vbNorm', '_vbEq', '_vbLog', '_vbStamp', 'vendorMerge3', 'vendorStampAfter', 'vendorTouch',
  '_vendorFormVals', '_vendorSmOf', 'matchVendorBest', '_vnNorm', '_vnTokens',
  'vendorFetchRows', 'vendorMergePulled', 'vendorPushDirty', '_vendorPushDirty', 'vendorRefs', 'vendorSetState', 'vendorSetCats',
  'setVmView', 'renderVendorMaster', 'openVendorModal', 'saveVendor', 'deleteVendor', 'vendorDeleteRender', 'vendorDoState', 'vendorsSorted', 'ingVendorOptions',
  'vendorCanon', 'normVendor', 'vmgAll', 'vmgHas', 'vmgRec', 'vmgResolve', 'vmgHiddenIds', 'vmgCardHidden', 'getIngV2', 'vmgKey', 'getVendorsVisible', 'vmgPool', 'escapeHtml', 't'];
// the names the Codex fixes on acba177 added (and the ones they replaced): taken when present, so the file also runs on acba177 (VENDOR_INDEX_PATH) to show the new tests fail there
const has = n => new RegExp('\\n(async )?function ' + n + '\\(|\\nvar ' + n + ' = ').test(source);
const OPT_NAMES = ['vendorTouchedAll', '_vendorTouchedPut', 'vendorTouchedClear', '_vendorOverlayTouched', 'vendorsWithDeleted'].filter(has);
const VARS = ['VENDOR_BASE_KEY', 'VENDOR_STATE_F', 'VENDOR_CAT_F', '_vendorPushQ', 'VMG_KEY', '_vmgC', '_vendorPushedAt'].concat(['_vendorTouched', 'VENDOR_TOUCHED_KEY', '_vendorTouchedMem'].filter(has));

async function cloud() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.vendors(id text primary key, name text, contact text, phone text, email text, method text, data jsonb);
    grant select, insert, update on public.vendors to anon, authenticated;`);
  await pg.exec(MIGRATION);
  const S = { pg, fail: null, failAfter: null, calls: [], posted: [] };
  S.asAnon = async (sql, params) => { await pg.exec('set role anon'); try { return await pg.query(sql, params); } finally { await pg.exec('reset role'); } };
  S.fetch = async (url, opt = {}) => {
    const u = new URL(url), method = (opt.method || 'GET').toUpperCase();
    S.calls.push(method);
    if (S.fail && S.fail(method, u)) return { ok: false, status: 500, json: async () => ({}), text: async () => 'down' };
    assert.equal(u.pathname, '/rest/v1/vendors');
    if (method === 'GET') {
      const ids = [...String(u.searchParams.get('id') || '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\(.)/g, '$1'));   // PostgREST's quoted values
      const r = await S.asAnon('select id, data from public.vendors where id = any($1) order by id', [ids]);
      return { ok: true, status: 200, json: async () => r.rows };
    }
    const rows = JSON.parse(opt.body), ignore = /ignore-duplicates/.test(String((opt.headers || {}).Prefer || ''));
    S.posted.push(rows.map(r => r.id));
    for (const r of rows) {
      await S.asAnon(`insert into public.vendors(id, name, contact, phone, email, method, data) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (id) do ${ignore ? 'nothing' : 'update set name = excluded.name, contact = excluded.contact, phone = excluded.phone, email = excluded.email, method = excluded.method, data = excluded.data'}`,
        [r.id, r.name, r.contact, r.phone, r.email, r.method, JSON.stringify(r.data)]);
    }
    if (S.failAfter && S.failAfter(method, u)) return { ok: false, status: 504, json: async () => ({}), text: async () => 'timeout' };   // written, but the answer was lost
    return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
  };
  S.row = async (id) => (await pg.query('select data from public.vendors where id = $1', [id])).rows[0]?.data || null;
  S.rows = async () => (await pg.query('select data from public.vendors order by id')).rows.map(r => r.data);
  return S;
}

function device(S, role = 'office') {
  const c = { console, window: {}, STORE: {}, TOASTS: [], MODAL: {}, FORM: {}, curRole: role, curLang: 'ja', curPage: 'vendor_master', curUserName: 'Synthetic ' + role, SUPA_SYNC_ENABLED: true, SUPABASE_URL: 'https://db.test',
    Object, JSON, Math, Date, String, Array, Number, Promise, URL, encodeURIComponent, AbortController, setTimeout, clearTimeout,
    STORES: [{ id: 'F01', name: 'Store One' }], ORDER_METHODS: ['Email', 'Phone', 'LINE'], DEFAULT_VENDORS: [] };
  c.fetch = S.fetch;
  vm.createContext(c);
  vm.runInContext(VARS.map(v => varLine(source, v)).join('\n') + '\n' + NAMES.concat(OPT_NAMES).map(n => pick(source, n)).join('\n') + `
    var _lsPushP = {}, _opLastPushErr = {}, _vmg = { usage:null, usageErr:'' };
    var SUPA_MASTER_MAP = { m_vendors: { type:'rows', table:'vendors', pk:'id', map:function(o){ return { id:o.id, name:o.name, contact:o.contact||null, phone:o.phone||null, email:o.email||null, method:o.method||null, data:o }; } } };
    function supaHeaders(x){ return Object.assign({ apikey:'k' }, x||{}); }
    async function supaUpsert(table, rows){ var r = await fetch(SUPABASE_URL+'/rest/v1/'+table, { method:'POST', headers:supaHeaders({ Prefer:'resolution=merge-duplicates,return=minimal' }), body:JSON.stringify(rows) }); return r.ok; }
    function _stripTestRows(k, v){ return v; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _lsStoreGet(k){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null; }
    function _lsWriteVerified(k, json){ STORE[k] = JSON.parse(json); return true; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); if (k === 'm_vendors' && SUPA_SYNC_ENABLED) _lsPushP[k] = vendorPushDirty(v).catch(function(){ return false; }); return true; }
    function getIngredients(){ return ls('m_ingredients', []); }
    function myName(){ return curUserName; }
    function vmgCan(){ return ['ceo','gm','office','office_crew'].indexOf(curRole) >= 0; }
    function vmgCardHtml(){ return ''; }
    function vmgUsageLine(){ return '<i>sign-in</i>'; }
    function vmgUsageEnsure(){}
    function showToast(m, k){ TOASTS.push([m, k]); }
    function openModal(h){ MODAL.html = h; MODAL.open = true; }
    function closeModalDirect(){ MODAL.open = false; }
    function renderPage(){}
    function alert(m){ TOASTS.push([m, 'alert']); }
    var document = { getElementById: function(id){ if (id === 'modal-overlay') return { classList:{ contains:function(){ return !!MODAL.open; } } }; return Object.prototype.hasOwnProperty.call(FORM, id) ? { value: FORM[id], disabled:false, textContent:'' } : null; },
      querySelectorAll: function(){ return []; } };`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const plain = v => JSON.parse(JSON.stringify(v));
const V = (id, name, extra) => Object.assign({ id, name, contact: '', phone: '', email: '', method: 'Email', rating: 3, minOrder: 0, delivery: '', terms: 'NET30', storeMethods: {} }, extra || {});
async function seedCloud(S, list) { for (const v of list) await S.pg.query('insert into public.vendors(id, name, data) values ($1,$2,$3)', [v.id, v.name, JSON.stringify(v)]); }
async function pull(S, c, t0) { const arr = (await S.rows()); c.STORE.m_vendors = plain(run(c, `vendorMergePulled(${JSON.stringify(arr)}${t0 ? ', ' + t0 : ''})`)); }
const ids = c => plain(run(c, 'getVendors()')).map(v => v.id).sort();
const pushed = async c => run(c, '_lsPushP.m_vendors');

test('a stale device sends only what it changed: another device\'s edit to another field or vendor is kept', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v2', 'Beta Supply')]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  run(A, `var a = getVendors(); a.find(function(v){ return v.id==='v1'; }).phone = '808-111'; lsSet('m_vendors', a)`);
  assert.equal(await pushed(A), true);
  assert.deepEqual(S.posted.at(-1), ['v1'], 'only the vendor A changed is sent');
  run(B, `var b = getVendors(); b.find(function(v){ return v.id==='v2'; }).rating = 5; b.find(function(v){ return v.id==='v1'; }).rating = 1; lsSet('m_vendors', b)`);   // B still has the old phone of v1
  assert.equal(await pushed(B), true);
  const v1 = await S.row('v1'), v2 = await S.row('v2');
  assert.equal(v1.phone, '808-111', 'A\'s phone is not undone by B');
  assert.equal(v1.rating, 1, 'B\'s own change to v1 is written');
  assert.equal(v2.rating, 5);
  // B pulls: both changes are on B too
  await pull(S, B);
  assert.equal(plain(run(B, 'getVendors()')).find(v => v.id === 'v1').phone, '808-111');
});

test('deleting an unused vendor: it is gone on every device and does not come back from stale devices or old app versions', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v9', 'Unused Example', { vcat: 'purchase', vcatAt: '2026-10-01T00:00:00.000Z' })]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  run(A, `_vmg.usage = { vendors: [], unknown: [] }`);   // the intake counts were read (signed in)
  const r = plain(await run(A, `vendorSetState('v9', 'deleted', 'not used')`));
  assert.equal(r.ok, true, JSON.stringify(r));
  const z = await S.row('v9');
  assert.equal(z.vst, 'deleted'); assert.equal(z.vstWhy, 'not used'); assert.equal(z.vstBy, 'Synthetic office'); assert.equal(z.vstLog.length, 1);
  assert.deepEqual(ids(A), ['v1']);
  // B has not pulled yet and edits that vendor: it stays deleted (the device sends its field; the state is the newer one)
  run(B, `var b = getVendors(); b.find(function(v){ return v.id==='v9'; }).phone = '808-999'; lsSet('m_vendors', b)`);
  assert.equal(await pushed(B), true);
  assert.equal((await S.row('v9')).vst, 'deleted');
  await pull(S, B);
  assert.deepEqual(ids(B), ['v1'], 'gone on B after its next pull');
  // an old app version sends the whole list from an old copy (no state, no stamps): the guard keeps the deletion and the category
  await S.fetch('https://db.test/rest/v1/vendors', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([V('v9', 'Unused Example', { phone: 'old' })].map(o => ({ id: o.id, name: o.name, contact: '', phone: o.phone, email: '', method: 'Email', data: o }))) });
  const z2 = await S.row('v9');
  assert.equal(z2.vst, 'deleted'); assert.equal(z2.vcat, 'purchase'); assert.equal(z2.vcatAt, '2026-10-01T00:00:00.000Z');
  assert.equal(z2.phone, 'old', 'other fields are written as before');
  await pull(S, A);
  assert.deepEqual(ids(A), ['v1']);
});

test('a vendor in use cannot be deleted; without the intake counts it cannot be deleted either; deactivating keeps it out of the choices', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { kind: 'food' }), V('v2', 'Beta Supply')]);
  const A = device(S);
  await pull(S, A);
  A.STORE.invoices = [{ vendor: 'alpha foods  ', total: 10 }];
  A.STORE.m_ingredients = [{ code: 1, name: 'x', vendor: 'Beta Supply' }];
  assert.equal(plain(run(A, `vendorRefs(getVendors()[0])`)).intake, null, 'not signed in');
  run(A, `_vmg.usage = { vendors: [], unknown: [] }`);
  const r1 = plain(run(A, `vendorRefs(getVendors().find(function(v){ return v.id==='v1'; }))`));
  assert.equal(r1.inv, 1); assert.ok(r1.total > 0);
  assert.ok(plain(run(A, `vendorRefs(getVendors().find(function(v){ return v.id==='v2'; }))`)).ing >= 1);
  run(A, `deleteVendor('v1')`);
  assert.ok(!A.MODAL.html.includes("vendorDoState(&quot;v1&quot;,'deleted')"), 'no delete button');
  assert.ok(A.MODAL.html.includes("vendorDoState(&quot;v1&quot;,'inactive')"));
  A.FORM['vd-why'] = 'closed'; A.FORM['vd-msg'] = '';
  await run(A, `vendorDoState('v1', 'deleted')`);
  assert.equal((await S.row('v1')).vst, undefined, 'refused');
  await run(A, `vendorDoState('v1', 'inactive')`);
  assert.equal((await S.row('v1')).vst, 'inactive');
  assert.deepEqual(plain(run(A, 'getVendorsPickable()')).map(v => v.id), ['v2']);
  assert.deepEqual(plain(run(A, 'vendorsSorted()')).map(v => v.id), ['v2']);
  assert.deepEqual(plain(run(A, 'getVendors()')).map(v => v.id).sort(), ['v1', 'v2'], 'kept for the records');
  assert.ok(!plain(run(A, 'ingVendorOptions()')).includes('Alpha Foods'));
  let html = run(A, `setVmView('all'); renderVendorMaster()`);
  assert.ok(!html.includes('Alpha Foods'));
  html = run(A, `setVmView('inactive'); renderVendorMaster()`);
  assert.ok(html.includes('Alpha Foods') && html.includes('無効の理由：closed'));
  // reactivate
  await run(A, `vendorDoState('v1', '')`);
  assert.equal((await S.row('v1')).vst, '');
  assert.equal(plain(run(A, 'getVendorsPickable()')).length, 2);
  // without the intake counts: no delete
  run(A, `_vmg.usage = null`); A.STORE.invoices = []; A.STORE.m_ingredients = [];
  run(A, `deleteVendor('v2')`);
  assert.ok(!A.MODAL.html.includes("'deleted')"));
  // only accounting / office crew / GM / CEO
  const AM = device(S, 'am'); await pull(S, AM);
  run(AM, `deleteVendor('v2')`);
  assert.ok(AM.TOASTS.some(x => /経理・事務Crew・GM・CEO/.test(x[0])));
});

test('when the cloud cannot be reached, the state change is not shown as done and this device goes back', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v9', 'Unused Example')]);
  const A = device(S);
  await pull(S, A);
  run(A, `_vmg.usage = { vendors: [], unknown: [] }`);
  S.fail = (m) => m === 'POST';
  A.FORM['vd-why'] = ''; A.FORM['vd-msg'] = '';
  await run(A, `vendorDoState('v9', 'deleted')`);
  assert.ok(!A.TOASTS.some(x => /削除しました/.test(x[0])), 'no success message');
  assert.equal((await S.row('v9')).vst, undefined);
  assert.deepEqual(ids(A), ['v9'], 'this device is back to before');
  assert.equal(plain(run(A, `ls('m_vendors', [])`))[0].vst, undefined);
  // a save that cannot reach the cloud says so
  S.fail = (m) => m === 'POST';
  Object.assign(A.FORM, { 'v-name': 'Unused Example', 'v-cat': 'purchase', 'v-contact': '', 'v-phone': '1', 'v-sms': '', 'v-email': '', 'v-line': '', 'v-method': 'Email', 'v-webform': '', 'v-cutoff': '', 'v-leadtime': '1', 'v-min': '0', 'v-terms': 'NET30', 'v-delivery': '', 'v-memo': '', 'v-addr': '', 'v-cgroup': '', 'v-w9': '', 'v-w9note': '' });
  await run(A, `saveVendor('v9')`);
  assert.ok(A.TOASTS.some(x => x[1] === 'warning' && /クラウドへはまだ送れていません/.test(x[0])));
  assert.ok(!A.TOASTS.some(x => x[1] === 'success'));
  // the change was kept on this device and goes out with the next save once the cloud is back
  S.fail = null;
  run(A, `lsSet('m_vendors', ls('m_vendors', []))`);
  assert.equal(await pushed(A), true);
  assert.equal((await S.row('v9')).vcat, 'purchase');
});

test('categories: saved, changed, filtered; unclassified by default; the bulk "purchase" sets only what was ticked', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { kind: 'food' }), V('v2', 'Beta Supply', { kind: 'nonfood' }), V('v3', 'Gamma Things')]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  assert.deepEqual(plain(run(A, 'getVendors()')).map(v => run(A, `vendorCatOf(${JSON.stringify(v)})`)), ['', '', ''], 'the intake food / non-food does not set the category');
  const r = plain(await run(A, `vendorSetCats(['v1'], 'purchase')`));
  assert.equal(r.ok, true);
  Object.assign(A.FORM, { 'v-name': 'Gamma Things', 'v-cat': 'construction', 'v-contact': '', 'v-phone': '', 'v-sms': '', 'v-email': '', 'v-line': '', 'v-method': 'Email', 'v-webform': '', 'v-cutoff': '', 'v-leadtime': '1', 'v-min': '0', 'v-terms': 'NET30', 'v-delivery': '', 'v-memo': 'roofing', 'v-addr': '', 'v-cgroup': 'Roof', 'v-w9': '必要', 'v-w9note': '' });
  await run(A, `saveVendor('v3')`);
  assert.equal((await S.row('v3')).vcat, 'construction');
  assert.equal((await S.row('v3')).cgroup, 'Roof');
  assert.equal((await S.row('v1')).vcat, 'purchase');
  assert.equal((await S.row('v1')).kind, 'food', 'the intake kind is unchanged');
  // B (stale) changes v1 back to unclassified later: newer stamp wins on both sides
  await run(B, `vendorSetCats(['v1'], 'none')`);
  assert.equal((await S.row('v1')).vcat, 'none');
  await pull(S, A);
  let html = run(A, `setVmView('purchase'); renderVendorMaster()`);
  assert.ok(!html.includes('Alpha Foods'));
  html = run(A, `setVmView('none'); renderVendorMaster()`);
  assert.ok(html.includes('Alpha Foods') && html.includes('Beta Supply') && !html.includes('Gamma Things'));
  assert.ok(html.includes('vendorBulkPurchaseOpen'), 'the review button');
  html = run(A, `setVmView('construction'); renderVendorMaster()`);
  assert.ok(html.includes('Gamma Things') && html.includes('Roof') && html.includes('W9必要'));
  // the bulk action only takes the ids it is given (the review screen)
  await run(A, `vendorSetCats(['v2'], 'purchase')`);
  assert.equal((await S.row('v2')).vcat, 'purchase');
  assert.equal((await S.row('v1')).vcat, 'none');
});

test('Moto (10/30): the construction list with personal contacts is not in the public code; cards put in the cloud by the private SQL are read, listed and escaped', async () => {
  assert.doesNotMatch(source, /\nvar CONSTRUCTION_VENDORS = /, 'the list is not in the app');
  assert.doesNotMatch(source, /vendorSeedConstruction|vendorConstructionSeeds/, 'the app does not seed cards any more');
  const S = await cloud();
  const card = (id, name, extra) => V(id, name, Object.assign({ vcat: 'construction', vcatAt: '2026-10-30T00:00:00.000Z', vcatBy: 'v1121', src: 'construction_list', method: '' }, extra));
  await seedCloud(S, [V('v1', 'Alpha Foods'), card('vc-pipe', 'Pipe Example LLC', { w9: '必要', cgroup: 'Plumbing', cicon: 'ti-droplet', phone: '808-000-0001' }),
    card('vc-volt', 'Volt <Sample>', { cgroup: 'Electric', contact: 'Sam Person' }), card('vc-gone', 'Gone Contractor', { vst: 'deleted', vstAt: '2026-10-31T00:00:00.000Z' })]);
  const A = device(S); await pull(S, A);
  assert.deepEqual(ids(A).filter(x => x.startsWith('vc-')).sort(), ['vc-pipe', 'vc-volt'], 'the deleted card is not on the device');
  const html = run(A, `setVmView('construction'); renderVendorMaster()`);
  assert.ok(html.includes('Pipe Example LLC'));
  assert.ok(!html.includes('<Sample>') && html.includes('Volt &lt;Sample&gt;'), 'escaped');
  assert.ok(!html.includes('Gone Contractor'));
  // the card is edited on a device: only that field goes back to the cloud
  run(A, `var a = ls('m_vendors', []); a.find(function(v){ return v.id==='vc-pipe'; }).phone = '808-EDITED'; vendorTouch('vc-pipe', ['phone']); lsSet('m_vendors', a)`);
  await run(A, 'vendorPushDirty()');
  const pipe = await S.row('vc-pipe');
  assert.equal(pipe.phone, '808-EDITED'); assert.equal(pipe.w9, '必要'); assert.equal(pipe.vcat, 'construction');
});

test('a vendor this device knew was deleted and then created again with the same id comes back; a pull keeps changes not sent yet', async () => {
  const S = await cloud();
  await seedCloud(S, [V('k-1', 'Key Vendor', { vst: 'deleted', vstAt: '2026-10-29T00:00:00.000Z' }), V('v2', 'Beta Supply')]);
  const A = device(S);
  await pull(S, A);
  assert.deepEqual(ids(A), ['v2']);
  // a card with the same id but without the re-create mark (an old copy, a row put back on this device) stays deleted
  run(A, `var a = getVendors(); a.push({ id:'k-1', name:'Key Vendor', phone:'old' }); lsSet('m_vendors', a)`);
  assert.equal(await pushed(A), true);
  assert.equal((await S.row('k-1')).vst, 'deleted', 'no mark: the deletion stays');
  await pull(S, A);
  run(A, `var a = getVendors(); a.push({ id:'k-1', name:'Key Vendor', kind:'food', src:'invoice_intake', _recreate:true }); lsSet('m_vendors', a)`);   // like ivdMakeCard
  assert.equal(await pushed(A), true);
  const k = await S.row('k-1');
  assert.equal(k._recreate, undefined, 'the mark is not stored');
  assert.equal(plain(run(A, `ls('m_vendors', [])`)).find(v => v.id === 'k-1')._recreate, undefined, 'and not left on this device');
  assert.equal(k.vst, ''); assert.ok(k.vstAt > '2026-10-29T00:00:00.000Z'); assert.equal(k.kind, 'food');
  // a change that could not be sent survives the next pull
  S.fail = (m) => m === 'POST';
  run(A, `var a = getVendors(); a.find(function(v){ return v.id==='v2'; }).delivery = 'Tue'; lsSet('m_vendors', a)`);
  assert.equal(await pushed(A), false);
  await S.pg.query(`update public.vendors set data = jsonb_set(data, '{phone}', '"808-NEW"') where id = 'v2'`);
  S.fail = null;
  await pull(S, A);
  const v2 = plain(run(A, 'getVendors()')).find(v => v.id === 'v2');
  assert.equal(v2.delivery, 'Tue', 'not sent yet: kept');
  assert.equal(v2.phone, '808-NEW', 'the other device\'s change came in');
  run(A, `lsSet('m_vendors', ls('m_vendors', []))`);
  assert.equal(await pushed(A), true);
  assert.equal((await S.row('v2')).delivery, 'Tue');
  assert.equal((await S.row('v2')).phone, '808-NEW');
});

test('the guard: the browser roles cannot run it directly; a newer stamp passes; names in the list and the form are escaped', async () => {
  const S = await cloud();
  const priv = (await S.pg.query(`select has_function_privilege('anon', 'public.vendors_keep_state()', 'execute') as a, has_function_privilege('authenticated', 'public.vendors_keep_state()', 'execute') as b`)).rows[0];
  assert.deepEqual(priv, { a: false, b: false });
  await seedCloud(S, [V('x<1>', 'Name "<b>bold</b>"', { contact: '<img src=x>', vst: 'inactive', vstAt: '2026-10-29T00:00:00.000Z', vstWhy: '<script>' })]);
  await S.asAnon(`update public.vendors set data = data || '{"vst":"","vstAt":"2026-10-30T00:00:00.000Z"}' where id = 'x<1>'`);
  assert.equal((await S.row('x<1>')).vst, '', 'newer stamp from the anon role passes');
  await S.asAnon(`update public.vendors set data = data || '{"vst":"deleted","vstAt":"2026-10-01T00:00:00.000Z"}' where id = 'x<1>'`);
  assert.equal((await S.row('x<1>')).vst, '', 'older stamp is kept out');
  await S.asAnon(`update public.vendors set data = data || '{"vst":"inactive","vstAt":"2026-10-31T00:00:00.000Z","vstWhy":"<script>"}' where id = 'x<1>'`);
  const A = device(S); await pull(S, A);
  const html = run(A, `setVmView('inactive'); renderVendorMaster()`);
  assert.ok(!/<b>bold<\/b>|<img src=x>|<script>/.test(html), 'escaped in the list');
  run(A, `openVendorModal('x<1>')`);
  assert.ok(!/<b>bold<\/b>|<img src=x>|<script>/.test(A.MODAL.html), 'escaped in the form');
  assert.ok(A.MODAL.html.includes('&quot;x&lt;1&gt;&quot;'), 'the id is quoted for the onclick');
});

test('a device whose clock is behind still changes the state (the stamp goes past the last one)', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { vst: 'inactive', vstAt: '2099-01-01T00:00:00.000Z' })]);
  const A = device(S); await pull(S, A);
  const r = plain(await run(A, `vendorSetState('v1', '', 'back')`));
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = await S.row('v1');
  assert.equal(v.vst, ''); assert.ok(v.vstAt > '2099-01-01T00:00:00.000Z');
});

test('the app sends vendors through the new path and keeps the read copy on this device only', () => {
  const body = (name) => pick(source, name);
  const sync = body('syncMasterToSupabase');
  assert.ok(sync.indexOf("if (key === 'm_vendors') return await vendorPushDirty(val);") >= 0 && sync.indexOf("if (key === 'm_vendors')") < sync.indexOf("def.type==='rows'"), 'vendors do not go through the whole-list upsert');
  assert.ok(/if \(key === 'm_vendors'\) arr = vendorMergePulled\(arr, _vT0\);/.test(body('supaPullAllMasters')));
  assert.ok(/var _vT0 = Date\.now\(\);[^\n]*\n\s*var _mp = \{\}; for \(var _k in SUPA_MASTER_MAP\)/.test(body('supaPullAllMasters')), 'the time is taken before the reads start');
  assert.ok(/if \(del\) card\._recreate = true;/.test(body('ivdMakeCard')), 'the intake marks a re-created card');
  assert.ok(/key === 'm_vendors' && Array\.isArray\(val\) && val\.length\) \{\s*var _vp = await vendorPushDirty\(val\);/.test(body('supaPushAllMasters')));
  assert.ok(/var LS_LOCAL_ONLY = \[[^\]]*'vendor_base_v1'/.test(source));
  assert.ok(/matchVendorBest[\s\S]{0,600}getVendorsPickable\(\)/.test(body('matchVendorBest')));
  assert.ok(/getVendorsPickable\(\)/.test(body('vendorsSorted')));
  assert.ok(/var cats = getCategories\(\); var vendors = getVendorsPickable\(\);/.test(source));
  assert.ok(/<datalist id="inv-vendor-list">\$\{vendorsSorted\(\)\.map\(v=>`<option value="\$\{escapeHtml\(v\.name\)\}">`\)/.test(source));
  assert.ok(/vmView === 'construction'\)\) return;/.test(source));
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const ver = (source.match(/const APP_VERSION = '(\d+)'/) || [])[1];
  assert.ok(Number(ver) >= 1121 && sw.includes("const SW_BUILD = '" + ver + "'"));
});

test('merging without a read copy (a device that never pulled): the newer state and category win, the device\'s other fields are sent', () => {
  const S = { fetch: async () => ({ ok: false }) };
  const A = device(S);
  const m = plain(run(A, `vendorMerge3(null, { id:'v1', name:'A', phone:'1', vcat:'purchase', vcatAt:'2026-10-02T00:00:00.000Z' }, { id:'v1', name:'A', phone:'0', vst:'deleted', vstAt:'2026-10-01T00:00:00.000Z', vstBy:'x', vcat:'none', vcatAt:'2026-10-01T00:00:00.000Z' })`));
  assert.equal(m.vst, 'deleted'); assert.equal(m.vstBy, 'x');
  assert.equal(m.vcat, 'purchase');
  assert.equal(m.phone, '1');
  const m2 = plain(run(A, `vendorMerge3(null, { id:'v1', vst:'inactive', vstAt:'2026-10-01T00:00:00.000Z', vcat:'none', vcatAt:'2026-10-05T00:00:00.000Z' }, { id:'v1', vst:'deleted', vstAt:'2026-10-02T00:00:00.000Z', vcat:'purchase', vcatAt:'2026-10-03T00:00:00.000Z' })`));
  assert.equal(m2.vst, 'deleted', 'an older state on this device does not undo a newer one');
  assert.equal(m2.vcat, 'none', 'a newer category on this device wins');
});

test('a vendor removed from the cloud by hand is dropped on the next pull; a new one not sent yet is kept', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v2', 'Beta Supply')]);
  const A = device(S); await pull(S, A);
  S.fail = (m) => m === 'POST';
  run(A, `var a = getVendors(); a.push({ id:'v3', name:'New One' }); lsSet('m_vendors', a)`);
  assert.equal(await pushed(A), false);
  S.fail = null;
  await S.pg.query(`delete from public.vendors where id = 'v2'`);
  await pull(S, A);
  assert.deepEqual(ids(A), ['v1', 'v3']);
});

test('deleting needs the intake counts even when called directly; a newer state from another device is not overwritten', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v2', 'Beta Supply')]);
  const A = device(S); await pull(S, A);
  A.FORM['vd-why'] = ''; A.FORM['vd-msg'] = '';
  await run(A, `vendorDoState('v1', 'deleted')`);
  assert.equal((await S.row('v1')).vst, undefined, 'not signed in: refused');
  // Codex (PR #111・acba177): calling vendorSetState directly is checked the same way (no intake counts → no delete)
  const d = plain(await run(A, `vendorSetState('v1', 'deleted', 'x')`));
  assert.equal(d.ok, false); assert.match(d.why, /確かめられない/); assert.equal((await S.row('v1')).vst, undefined);
  // another device deleted v2 with a stamp later than this device's clock; this device has not pulled
  await S.pg.query(`update public.vendors set data = data || '{"vst":"deleted","vstAt":"2099-01-01T00:00:00.000Z","vstBy":"other"}' where id = 'v2'`);
  const r = plain(await run(A, `vendorSetState('v2', 'inactive', 'x')`));
  assert.equal(r.ok, false);
  assert.match(r.why, /ほかの端末/);
  assert.equal((await S.row('v2')).vst, 'deleted');
  assert.equal(plain(run(A, `ls('m_vendors', [])`)).find(v => v.id === 'v2').vst, 'deleted', 'this device shows what is in the cloud');
});

test('the deploy set: the SQL to paste is the migration, the check is read-only and says ok, stopping removes only the guard', async () => {
  const dir = new URL('../deploy/vendor-master-v1121/', import.meta.url);
  assert.equal(fs.readFileSync(new URL('1_追加のSQL.sql', dir), 'utf8'), fs.readFileSync(new URL('../supabase/migrations/20261101090000_vendor_state_guard.sql', import.meta.url), 'utf8'));
  const S = await cloud();
  await S.pg.exec(MIGRATION);   // twice is the same
  await seedCloud(S, [V('v1', 'A', { vst: 'deleted', vstAt: '2026-10-30T00:00:00.000Z', vcat: 'purchase' })]);
  const rows = (await S.pg.query(fs.readFileSync(new URL('2_確認のSQL_読むだけ.sql', dir), 'utf8'))).rows;
  for (const n of ['guard function', 'guard trigger on vendors', 'browser roles cannot run the guard directly']) assert.equal(rows.find(r => r.name === n).ok, true, n);
  assert.equal(rows.find(r => r.name === 'invoice seed skips deleted vendors').ok, false, 'not yet');
  // 1b: the Invoice intake's vendor candidates (the migration as it is); it stops without 業者の統合 and changes nothing
  assert.equal(fs.readFileSync(new URL('1b_追加のSQL_Invoice取込の候補.sql', dir), 'utf8'), fs.readFileSync(new URL('../supabase/migrations/20261101100000_invoice_vendor_seed_skip_deleted.sql', import.meta.url), 'utf8'));
  await assert.rejects(S.pg.exec(fs.readFileSync(new URL('1b_追加のSQL_Invoice取込の候補.sql', dir), 'utf8')), /先に 20261022090000/);
  await S.pg.exec(`create table public.invoice_vendor_rules(vendor_key text primary key, merged_into text);
    create function public.invoice_vendor_seed(p jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  await S.pg.exec(fs.readFileSync(new URL('1b_追加のSQL_Invoice取込の候補.sql', dir), 'utf8'));
  await S.pg.exec(fs.readFileSync(new URL('1b_追加のSQL_Invoice取込の候補.sql', dir), 'utf8'));   // twice is the same
  const rows2 = (await S.pg.query(fs.readFileSync(new URL('2_確認のSQL_読むだけ.sql', dir), 'utf8'))).rows;
  assert.equal(rows2.find(r => r.name === 'invoice seed skips deleted vendors').ok, true);
  assert.equal(rows.find(r => r.name === 'deleted (kept as a mark)').note, '1');
  await S.pg.exec(fs.readFileSync(new URL('止める.sql', dir), 'utf8'));
  assert.equal((await S.pg.query(`select to_regprocedure('public.vendors_keep_state()') as f`)).rows[0].f, null);
  assert.equal((await S.row('v1')).vst, 'deleted', 'data unchanged');
  // without the table the SQL stops and changes nothing
  const pg2 = new PGlite();
  await assert.rejects(pg2.exec(MIGRATION), /public\.vendors がありません/);
});

// ---------------------------------------------------------------- the independent review of e95b7d4 (R1–R5 and the P3 items)
const FORM_OF = (name, extra) => Object.assign({ 'v-name': name, 'v-cat': 'none', 'v-contact': '', 'v-phone': '', 'v-sms': '', 'v-email': '', 'v-line': '', 'v-method': 'Email', 'v-webform': '', 'v-cutoff': '',
  'v-leadtime': '1', 'v-min': '0', 'v-terms': 'NET30', 'v-delivery': '', 'v-memo': '', 'v-addr': '', 'v-cgroup': '', 'v-w9': '', 'v-w9note': '' }, extra || {});

test('R1: a deletion that reached the cloud is not undone — a lost answer is checked by reading again, a row without a state does not re-create it, the history is kept', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v9', 'Unused Example'), V('v8', 'Other Unused')]);
  const A = device(S); await pull(S, A);
  run(A, `_vmg.usage = { vendors: [], unknown: [] }`);
  // the write lands but its answer is lost: reading again shows it, so it is done (nothing goes back)
  S.failAfter = (m) => m === 'POST';
  let r = plain(await run(A, `vendorSetState('v9', 'deleted', 'gone')`));
  assert.equal(r.ok, true, JSON.stringify(r));
  S.failAfter = null;
  assert.equal((await S.row('v9')).vst, 'deleted');
  // the write and the reading both fail: not known — this device keeps the change and does not say it failed for sure
  S.fail = () => true;
  r = plain(await run(A, `vendorSetState('v8', 'deleted', 'gone too')`));
  assert.equal(r.ok, false); assert.equal(r.unknown, true); assert.match(r.why, /確かめられませんでした/);
  assert.equal(plain(run(A, `ls('m_vendors', [])`)).find(v => v.id === 'v8').vst, 'deleted', 'not put back');
  S.fail = null;
  run(A, `lsSet('m_vendors', ls('m_vendors', []))`);   // the outbox sends it again later
  assert.equal(await pushed(A), true);
  assert.equal((await S.row('v8')).vst, 'deleted');
  // a row on this device without a state (an old copy) is sent: the deletion stays and its history is kept
  const log0 = (await S.row('v9')).vstLog.length;
  run(A, `var a = ls('m_vendors', []); var x = a.find(function(v){ return v.id==='v9'; }); delete x.vst; delete x.vstAt; delete x.vstLog; x.phone = '1'; lsSet('m_vendors', a)`);
  assert.equal(await pushed(A), true);
  const z = await S.row('v9');
  assert.equal(z.vst, 'deleted'); assert.equal(z.vstLog.length, log0, 'history kept'); assert.equal(z.phone, '1');
});

test('R1 (history): two devices change the state at the same time — both entries stay in the history', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods')]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  assert.equal(plain(await run(A, `vendorSetState('v1', 'inactive', 'A says')`)).ok, true);
  assert.equal(plain(await run(B, `vendorSetState('v1', '', 'B says')`)).ok, true);   // B has not pulled; its stamp is later
  const v = await S.row('v1');
  assert.equal(v.vst, '');
  assert.deepEqual(v.vstLog.map(h => h.why), ['A says', 'B says']);
});

test('R2: saving the form writes only what was changed there — another device\'s memo, address, W9 note and store methods stay', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { phone: '808-000' })]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  // B adds a memo, address, W9 note and a store method
  run(B, `var b = ls('m_vendors', []); var x = b[0]; x.memo = 'B memo'; x.addr = 'B addr'; x.w9note = 'B w9'; x.storeMethods = { F01:'Phone' }; lsSet('m_vendors', b)`);
  assert.equal(await pushed(B), true);
  // A (stale) opens the form and changes only the phone
  run(A, `openVendorModal('v1')`);
  Object.assign(A.FORM, FORM_OF('Alpha Foods', { 'v-phone': '808-111' }));
  await run(A, `saveVendor('v1')`);
  const v = await S.row('v1');
  assert.equal(v.phone, '808-111');
  assert.equal(v.memo, 'B memo'); assert.equal(v.addr, 'B addr'); assert.equal(v.w9note, 'B w9');
  assert.deepEqual(v.storeMethods, { F01: 'Phone' });
  // clearing a field on purpose is still written
  await pull(S, A);
  run(A, `openVendorModal('v1')`);   // the form shows B memo; the person empties it
  Object.assign(A.FORM, FORM_OF('Alpha Foods', { 'v-phone': '808-111', 'v-memo': '' }));
  await run(A, `saveVendor('v1')`);
  assert.equal((await S.row('v1')).memo, '', 'cleared');
  // the empty value and a missing one are the same; the key order of an object does not matter
  assert.equal(run(A, `_vbEq({ a:'', b:{ x:1, y:2 } }, { b:{ y:2, x:1 } })`), true);
  assert.equal(run(A, `_vbEq({ memo:'' }, { memo:'x' })`), false);
});

test('R3: a device that has no read copy reads the cloud first and sends only what it changed and new vendors', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { phone: 'NEW-from-other' }), V('v2', 'Beta Supply', { phone: 'B-NEW', memo: 'B memo', storeMethods: { F01: 'Phone' } }), V('v4', 'Delta Co', { contact: 'B-contact' })]);
  const A = device(S);
  A.STORE.m_vendors = [V('v1', 'Alpha Foods', { phone: 'old-copy' }), V('v2', 'Beta Supply'), V('v4', 'Delta Co', { contact: 'old' })];   // an old copy, never pulled (no read copy)
  run(A, `openVendorModal('v2')`);
  Object.assign(A.FORM, FORM_OF('Beta Supply', { 'v-delivery': 'Fri' }));
  run(A, `var a = ls('m_vendors', []); a.push({ id:'v3', name:'Brand New' }); STORE.m_vendors = a`);
  await run(A, `saveVendor('v2')`);
  assert.equal((await S.row('v1')).phone, 'NEW-from-other', 'the other device\'s phone is not undone');
  assert.equal((await S.row('v2')).delivery, 'Fri', 'this device\'s change is sent');
  assert.equal((await S.row('v2')).phone, 'B-NEW', 'only the field changed in the form is sent');
  assert.equal((await S.row('v2')).memo, 'B memo');
  assert.deepEqual((await S.row('v2')).storeMethods, { F01: 'Phone' });
  assert.equal((await S.row('v3')).name, 'Brand New', 'a new vendor is sent');
  assert.ok(!S.posted.flat().includes('v1'), 'v1 was not sent');
  assert.equal(plain(run(A, `ls('m_vendors', [])`)).find(v => v.id === 'v1').phone, 'NEW-from-other', 'this device now shows the cloud');
  assert.ok(run(A, `!!_vbBase() && !!_vbBase().v1`), 'a read copy now exists');
  // a state change on a device with no read copy sends the state only
  const B = device(S);
  B.STORE.m_vendors = [V('v4', 'Delta Co', { contact: 'old' })];
  assert.equal(plain(await run(B, `vendorSetState('v4', 'inactive', 'no copy')`)).ok, true);
  assert.equal((await S.row('v4')).vst, 'inactive');
  assert.equal((await S.row('v4')).contact, 'B-contact', 'the old contact is not sent');
});

test('R2: a field another device changed after the form was opened is not undone by saving the form (the values the form showed are kept from opening)', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { contact: 'Ann', leadtime: '2' })]);
  const A = device(S), B = device(S);
  await pull(S, A); await pull(S, B);
  run(A, `openVendorModal('v1')`);   // the form shows Ann
  run(B, `var b = ls('m_vendors', []); b[0].contact = 'Bob'; lsSet('m_vendors', b)`);
  assert.equal(await pushed(B), true);
  await pull(S, A);   // A's copy now has Bob, the open form still shows Ann
  Object.assign(A.FORM, FORM_OF('Alpha Foods', { 'v-contact': 'Ann', 'v-phone': '808-9', 'v-leadtime': '2' }));
  await run(A, `saveVendor('v1')`);
  const v = await S.row('v1');
  assert.equal(v.contact, 'Bob'); assert.equal(v.phone, '808-9');
  assert.equal(v.leadtime, '2', 'a number shown as it was is not rewritten');
});

test('a pull that was read before this device sent a change does not put the old state back on this device', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods')]);
  const A = device(S); await pull(S, A);
  const t0 = Date.now(), old = await S.rows();   // the pull starts reading
  await new Promise(r => setTimeout(r, 2));
  assert.equal(plain(await run(A, `vendorSetState('v1', 'inactive', 'now')`)).ok, true);
  A.STORE.m_vendors = plain(run(A, `vendorMergePulled(${JSON.stringify(old)}, ${t0})`));   // …and lands after the change
  assert.equal(plain(run(A, `ls('m_vendors', [])`))[0].vst, 'inactive');
  assert.equal(run(A, `_vbBase().v1.vst`), 'inactive');
  // a pull that started after the change takes the cloud as usual
  await pull(S, A, Date.now() + 1);
  assert.equal(plain(run(A, `ls('m_vendors', [])`))[0].vst, 'inactive');
});

test('categories: a choice that another device\'s newer category beat is not reported as done', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v2', 'Beta Supply')]);
  const A = device(S); await pull(S, A);
  await S.pg.query(`update public.vendors set data = data || '{"vcat":"construction","vcatAt":"2099-01-01T00:00:00.000Z"}' where id = 'v1'`);
  const r = plain(await run(A, `vendorSetCats(['v1','v2'], 'purchase')`));
  assert.equal(r.ok, false); assert.equal(r.n, 1); assert.equal(r.lost, 1);
  assert.equal((await S.row('v1')).vcat, 'construction'); assert.equal((await S.row('v2')).vcat, 'purchase');
});

test('R5 and the construction cards: contractors are not matched automatically; LINE is a note, not an id', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Pipe Example LLC', { phone: 'mine' }),
    V('vc-mark', 'Mark', { vcat: 'construction', vcatAt: '2026-10-30T00:00:00.000Z', src: 'construction_list', memo: 'aircon（LINE で連絡）', line: '', phone: '808', method: '' })]);
  const A = device(S);
  await pull(S, A);
  const mark = plain(run(A, `getVendors().find(function(v){ return v.id==='vc-mark'; })`));
  assert.equal(mark.line, ''); assert.match(mark.memo, /aircon（LINE で連絡）/);
  run(A, `var a = ls('m_vendors', []); a.push({ id:'p1', name:'Market Fresh Produce Co' }); STORE.m_vendors = a`);
  const m = plain(run(A, `matchVendorBest('Market Fresh Produce')`));
  assert.equal(m && m.vendor.id, 'p1', 'not “Mark”');
  assert.equal(run(A, `matchVendorBest('Mark')`) && plain(run(A, `matchVendorBest('Mark')`)).vendor.id === mark.id, false, 'a contractor is never the automatic match');
  assert.ok(plain(run(A, 'vendorsSorted()')).some(v => v.name === 'Mark'), 'still in the list to choose from');
});

test('usage: Invoice intake documents filed under the card\'s id count too (a renamed card cannot be deleted while in use); an id with a quote is read back', async () => {
  const S = await cloud();
  await seedCloud(S, [V('vk-1', 'Renamed In App'), V('q"1', 'Quote Id')]);
  const A = device(S); await pull(S, A);
  run(A, `_vmg.usage = { vendors: [{ vendor_key:'vk-1', display_name:'Old Intake Name', docs:4 }], unknown: [] }`);
  assert.equal(plain(run(A, `vendorRefs(getVendors().find(function(v){ return v.id==='vk-1'; }))`)).intake, 4);
  const r = plain(await run(A, `vendorSetState('q"1', 'inactive', 'x')`));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await S.row('q"1')).vst, 'inactive');
});

test('Codex (PR #111・acba177) P2: vendorSetState checks the role itself — a role outside accounting / office crew / GM / CEO cannot change a state even by calling it directly', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods')]);
  for (const role of ['sl', 'am', 'staff']) {
    const X = device(S, role); await pull(S, X);
    const r = plain(await run(X, `vendorSetState('v1', 'inactive', 'x')`));
    assert.equal(r.ok, false, role); assert.match(r.why, /経理・事務Crew・GM・CEO/);
  }
  assert.equal((await S.row('v1')).vst, undefined, 'nothing reached the cloud');
  const O = device(S, 'office_crew'); await pull(S, O);
  assert.equal(plain(await run(O, `vendorSetState('v1', 'inactive', 'x')`)).ok, true);
  assert.equal(plain(await run(O, `vendorSetState('v1', 'bogus', 'x')`)).ok, false, 'only known states');
});

test('Codex (PR #111・acba177) P2: a change made before the first pull and not sent survives a reload — the next pull keeps it and the next send delivers it', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods', { memo: 'cloud memo' }), V('v2', 'Beta Supply')]);
  const A = device(S);
  A.STORE.m_vendors = plain(await S.rows());          // this device has the vendors but has never pulled (no read copy)
  S.fail = (m) => m === 'POST';                       // the send fails
  run(A, `(function(){ var a = ls('m_vendors', []); a[0].phone = '808-555-0100'; vendorTouch('v1', ['phone']); lsSet('m_vendors', a); })()`);
  assert.equal(await pushed(A), false);
  assert.notEqual((await S.row('v1')).phone, '808-555-0100', 'not sent');
  // another device changes another field meanwhile
  await S.pg.query(`update public.vendors set data = data || '{"memo":"newer memo"}' where id = 'v1'`);
  // reload: a fresh device on the same storage (memory is gone, the device storage stays)
  const B = device(S); B.STORE = A.STORE;
  S.fail = null;
  await pull(S, B);
  let v1 = plain(run(B, `ls('m_vendors', [])`)).find(v => v.id === 'v1');
  assert.equal(v1.phone, '808-555-0100', 'the pull keeps the unsent phone'); assert.equal(v1.memo, 'newer memo', 'and takes the other device\'s memo');
  run(B, `lsSet('m_vendors', ls('m_vendors', []))`);
  assert.equal(await pushed(B), true);
  assert.equal((await S.row('v1')).phone, '808-555-0100', 'delivered'); assert.equal((await S.row('v1')).memo, 'newer memo');
  assert.deepEqual(plain(run(B, `vendorTouchedAll()`)), {}, 'the mark is cleared once the cloud has it');
});

test('Codex (PR #111・acba177) P3: saving another vendor keeps the deleted vendors\' marks on this device', async () => {
  const S = await cloud();
  await seedCloud(S, [V('v1', 'Alpha Foods'), V('v2', 'Beta Supply', { vst: 'deleted', vstAt: '2026-10-30T00:00:00.000Z', vstBy: 'x' })]);
  const A = device(S); await pull(S, A);
  assert.deepEqual(ids(A), ['v1']);
  Object.assign(A.FORM, { 'vm-name': 'Alpha Foods', 'vm-phone': '808-555-0101' });
  run(A, `(function(){ var vs = getVendors(); vs[0].phone = '808-555-0101'; lsSet('m_vendors', vendorsWithDeleted(vs)); })()`);
  await pushed(A);
  const raw = plain(run(A, `ls('m_vendors', [])`));
  assert.ok(raw.some(v => v.id === 'v2' && v.vst === 'deleted'), 'the deleted mark stays on this device');
  assert.equal((await S.row('v2')).vst, 'deleted');
  // every place that saves the list from getVendors() keeps the marks
  const saves = source.split('\n').filter(l => /lsSet\('m_vendors', (vendors|vs)\)/.test(l));
  assert.deepEqual(saves, [], 'no save writes getVendors() back without the deleted marks');
});
