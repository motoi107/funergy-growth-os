// 新しい業者を決める（Moto 2026-10-16 ③・UI案52 決めてほしいこと 9〜11 はすべて A）— the invoice intake side, on synthetic data: real SQL
// (PGlite), the real worker/handler code, and in-memory stand-ins for Google Drive, the AI and mail (the harness of
// tests/invoice-vendor-merge.test.mjs). Nothing here reaches production, Drive, QuickBooks or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';
import { parseResponse } from '../invoice/extract.mjs';
import vm from 'node:vm';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const U = { gm: '00000000-0000-4000-8000-0000000000a1', office: '00000000-0000-4000-8000-0000000000a2', crew: '00000000-0000-4000-8000-0000000000a3',
  ceo: '00000000-0000-4000-8000-0000000000a4', other: '00000000-0000-4000-8000-0000000000a5' };
const WORKER_KEY = 'synthetic-worker-key-0123456789';

// ---------------------------------------------------------------- stand-ins
class FakeDrive {
  constructor() { this.items = new Map(); this.n = 0; this.failUpdate = 0; this.authDown = false; this.forbidden = new Set(); this.busy = new Set(); this.limited = new Set(); this.log = []; }
  folder(id, name, parent) { this.items.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : [], trashed: false }); return id; }
  file(name, bytes, parent, { id, mime = 'application/pdf', created = '2026-10-06T19:00:00Z', owner = null } = {}) {
    id = id || 'f' + (++this.n);
    const b = Buffer.from(bytes);
    this.items.set(id, { id, name, mimeType: mime, parents: [parent], trashed: false, bytes: b, size: String(b.length),
      md5Checksum: crypto.createHash('md5').update(b).digest('hex'), createdTime: created, modifiedTime: created,
      owners: owner ? [{ emailAddress: owner }] : [] });
    return id;
  }
  replaceContent(id, bytes) { const f = this.items.get(id); f.bytes = Buffer.from(bytes); f.size = String(f.bytes.length); f.md5Checksum = crypto.createHash('md5').update(f.bytes).digest('hex'); }
  meta(f) { const { bytes, ...m } = f; return m; }
  check() { if (this.authDown) { const e = new Error('drive_auth_400'); e.code = 'drive_auth_400'; throw e; } }
  async listFolder(folderId, pageToken, opts) {
    this.check(); this.log.push(['list', folderId, opts && opts.createdAfter || null]);
    const after = opts && opts.createdAfter ? Date.parse(opts.createdAfter) : null;   // like Drive's "createdTime >= …"
    const all = [...this.items.values()].filter(f => f.parents.includes(folderId) && !f.trashed && !f.mimeType.includes('folder')
      && (after == null || Date.parse(f.createdTime) >= after));
    const start = pageToken ? Number(pageToken) : 0;            // two per page: paging is exercised
    return { files: all.slice(start, start + 2).map(f => this.meta(f)), next: start + 2 < all.length ? String(start + 2) : null };
  }
  async get(id) {
    this.check();
    if (this.forbidden.has(id)) return { status: 403, file: null };
    if (this.busy.has(id)) return { status: 503, file: null };   // Drive briefly unavailable
    if (this.limited.has(id)) return { status: 403, file: null, limited: true };   // a rate limit, sent by Google as 403
    const f = this.items.get(id); return f ? { status: 200, file: this.meta(f) } : { status: 404, file: null };
  }
  async download(id) { this.check(); this.log.push(['download', id]); return new Uint8Array(this.items.get(id).bytes); }
  async update(id, { name, addParents, removeParents }) {
    this.check();
    if (this.failUpdate > 0) { this.failUpdate--; const e = new Error('drive_update_500'); e.status = 500; throw e; }
    const f = this.items.get(id);
    if (name) f.name = name;
    if (removeParents) f.parents = f.parents.filter(p => !removeParents.split(',').includes(p));
    if (addParents) f.parents.push(addParents);
    this.log.push(['update', id, name, addParents]);
    return this.meta(f);
  }
  async findFolders(parent, name) { this.check(); return [...this.items.values()].filter(f => f.mimeType.includes('folder') && f.parents.includes(parent) && f.name === name && !f.trashed).map(f => ({ id: f.id, name: f.name })); }
  async createFolder(parent, name) { this.check(); const id = 'd' + (++this.n); this.folder(id, name, parent); this.log.push(['mkdir', parent, name]); return { id, name }; }
  async listNames(folder) { this.check(); return [...this.items.values()].filter(f => f.parents.includes(folder) && !f.trashed).map(f => ({ id: f.id, name: f.name })); }
  pathOf(id) { const out = []; let f = this.items.get(id); while (f && f.parents[0]) { f = this.items.get(f.parents[0]); if (f) out.unshift(f.name); } return out.join('/'); }
}

const pdf = (tag, pages = 1) => '%PDF-1.4\n' + Array.from({ length: pages }, () => '<< /Type /Page >>\n').join('') + tag + '\n%%EOF';
const jpg = tag => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);

function doc(no, date, lines, { total, tax = '0.00', ship = 'LaLa Izakaya, 100 Test Street', vendor = 'Vendor A Inc.', type = 'invoice', pages = [1],
  marks = ['Page 1 of 1'], refs = [], delivery = null } = {}) {
  const sum = lines.reduce((a, l) => a + Math.round(Number(l[4]) * 100), 0);
  return { doc_type: type, pages, pages_marked: marks, vendor_name: vendor, ship_to: ship, invoice_number: no,
    invoice_date_text: date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : null, invoice_date: date,
    delivery_date_text: delivery ? `${delivery.slice(5, 7)}/${delivery.slice(8, 10)}/${delivery.slice(0, 4)}` : null, delivery_date: delivery,
    currency: 'USD', subtotal: (sum / 100).toFixed(2), tax, total: total ?? ((sum + Math.round(Number(tax) * 100)) / 100).toFixed(2), references: refs,
    lines: lines.map(([code, name, qty, price, amount, unit = 'CS', pack = null]) => ({ page: 1, item_code: code, description: name, qty, unit, pack, unit_price: price, amount })) };
}

async function setup(sql = SQL, opts = {}) {   // opts.vendorRecheck: how many invoices one call works out again; opts.failGet: ids invoice_get fails on
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.vendors(id text primary key, name text, data jsonb); grant select on public.vendors to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    insert into public.vendors values ('v1','VendorA','{"kind":"food"}'),('v3','VendorC','{"kind":"nonfood"}'),('v4','VendorD','{}');
    insert into public.ingredients values
     ('L-1','Shiro miso','BAG','VendorA',12,'{"sku":"06263","extId":"lala-1","orderUnit":"CS","unit":"BAG","qty":12}'),
     ('L-2','Gloves','PK','VendorC',10,'{"sku":"00123","extId":"lala-2","orderUnit":"CS","unit":"PK","qty":10}'),
     ('L-3','Wagyu','g','VendorC',453.59237,'{"sku":"00777","extId":"lala-3","orderUnit":"LB","unit":"g","qty":453.59237}'),
     ('L-4','Old item','EA','Unknown Vendor',1,'{"sku":"9","extId":"lala-4"}'),
     ('T-1','Totoya item','EA','VendorA',1,'{"sku":"55"}');`);
  for (const [k, r] of [['gm', 'gm'], ['office', 'office'], ['crew', 'office_crew'], ['ceo', 'ceo']]) await pg.query('insert into manager_auth(user_id, role) values($1,$2)', [U[k], r]);
  await pg.exec(sql);
  await pg.query(`update invoice_settings set value=jsonb_build_object('key',$1::text,'enabled',true) where key='worker'`, [WORKER_KEY]);
  await pg.exec(`
    update invoice_settings set value=value||'{"intake":true,"auto_post":true,"organize":true,"mirror":true,"start_at":"2026-10-01T00:00:00Z","rename":true,"rename_since":"2026-10-01T00:00:00Z"}' where key='mode';
    update invoice_settings set value=value||'{"currency_when_absent":"USD","closed_through":"2026-08","batch":10}' where key='rules';
    update invoice_settings set value=value||'{"route":"invoice-intake","enabled":true}' where key='qb';
    insert into invoice_stores(store_id,label,root_folder_id,upload_folder_id,active,auto_post,aliases) values
     ('F06','LaLa','R6','U6',true,true,'{"LaLa Izakaya","100 Test Street"}'),('F04-K','Kaimuki','RK','UK',true,true,'{"Totoya Kaimuki","200 Sample Ave"}');
    insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post) values
     ('v1','VendorA','{"VENDOR A INC."}','food',true),('v2','VendorB','{}','food',false);
    insert into invoice_item_maps(vendor_key,vendor_item_code,spec_key,purchase_unit,ingredient_code,count_unit,count_per_purchase,base_unit,base_per_purchase,verified,auto_post) values
     ('v1','06263','12/500G','CS','I-1','BAG',12,'g',6000,true,true),('v1','01111','6/1.8L','CS','I-2','BTL',6,'ml',10800,true,true);
    insert into app_state(key,value) values
     ('inv_hist_F06','[{"ym":"2026-09","grand":1234.56,"lines":[{"code":"I-1","qty":3,"value":15}]}]'),
     ('inv_count_F06_2026-09','{"I-1":3}'),('fc_monthly_F06','{"2026-09":{"beginInv":1000,"endInv":1234.56}}'),
     ('spl_invoices_F06','[{"id":"inv123","storeId":"F06","vendor":"VendorA","docDate":"2026/10/07","total":122.4,"driveFileId":"app-drive-1"}]');`);
  await pg.exec('set role service_role');
  const failGet = opts.failGet || new Set();
  const db = { async rpc(name, p) { if (name === 'invoice_get' && p && failGet.has(p.doc_id)) throw new Error('synthetic_failure');
    const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const drive = new FakeDrive();
  drive.folder('R6', 'LaLa', 'INV'); drive.folder('U6', '00_Upload', 'R6'); drive.folder('RK', 'Kaimuki', 'INV'); drive.folder('UK', '00_Upload', 'RK');
  const fixtures = new Map(); let aiCalls = 0; let aiFail = 0; let aiDown = null;
  const ai = async parts => {
    aiCalls++;
    if (aiFail > 0) { aiFail--; return { ok: false, error: 'ai_network', retryable: true }; }
    if (aiDown) return { ok: false, error: aiDown };
    const key = Buffer.from(parts[0].base64, 'base64').toString('latin1');
    const fx = [...fixtures.entries()].filter(([tag]) => key.includes(tag)).sort((x, y) => y[0].length - x[0].length)[0];   // most specific tag
    if (!fx) return { ok: true, readable: false, reason: 'unreadable', documents: [] };
    const r = parseResponse(JSON.stringify(fx[1]));          // the same parsing as real responses
    return { ...r, model: 'synthetic' };
  };
  const sent = []; let mailMode = 'ok';
  const mailer = { async send(m) { if (mailMode === 'timeout') throw new Error('timeout'); sent.push(m); return { ok: true, messageId: '<msg-' + sent.length + '@synthetic>' }; },
    async lookup(k) { const m = sent.find(x => x.idempotencyKey === k); return m ? { found: true, messageId: 'found' } : { found: false }; } };
  const users = { 'tok-gm': U.gm, 'tok-office': U.office, 'tok-crew': U.crew, 'tok-ceo': U.ceo, 'tok-other': U.other };
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, fetch, db, drive, ai, mailer, now: () => Date.parse('2026-10-06T20:00:00Z'), vendorRecheck: opts.vendorRecheck });
  const call = async (body, headers = {}) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const worker = () => call({ action: 'worker' }, { 'x-invoice-worker-key': WORKER_KEY });
  const api = (tok, body) => call(body, tok ? { authorization: 'Bearer ' + tok } : {});
  const q = async (sql, p = []) => (await pg.query(sql, p)).rows;
  return { pg, db, drive, fixtures, get aiCalls() { return aiCalls; }, failAi(n) { aiFail = n; }, setAiDown(x) { aiDown = x; }, sent, setMail(m) { mailMode = m; }, worker, api, call, q };
}

const docsOf = async (E, drive_file_id) => E.q(`select d.* from invoice_docs d join invoice_files f on f.id=d.file_id where f.drive_file_id=$1 order by d.created_at, d.doc_index`, [drive_file_id]);
const codes = d => d.reasons.map(r => r.code);
const rule = async (E, k) => (await E.q(`select * from invoice_vendor_rules where vendor_key=$1`, [k]))[0];
const one = async (E, id) => (await E.q(`select * from invoice_docs where id=$1`, [id]))[0];
const lines1 = (code, amt) => [[code, 'SAKE 6/1.8L', '1', Number(amt).toFixed(2), amt, 'CS', null]];
const snap = async E => ({ rules: await E.q(`select * from invoice_vendor_rules order by vendor_key`),
  docs: await E.q(`select id, vendor_key, vendor_name, version, reasons from invoice_docs order by id`),
  events: await E.q(`select count(*)::int n from invoice_events`) });
// Invoices read by the worker: tag → [invoice no, date, printed vendor name].
async function read(E, list) {
  const F = {};
  for (const [tag, no, date, vendor] of list) {
    E.fixtures.set(tag, { readable: true, documents: [doc(no, date, lines1('00777', '30.00'), { vendor })] });
    F[tag] = E.drive.file(tag + '.pdf', pdf(tag), 'U6');
  }
  assert.equal((await E.worker()).body.ok, true);
  const D = {}; for (const tag of Object.keys(F)) [D[tag]] = await docsOf(E, F[tag]);
  return D;
}

test('新しい業者を決める: a printed name no vendor has becomes a new vendor; the invoices waiting with it (open months) get it', async () => {
  const E = await setup();
  const D = await read(E, [['N-1', '5001', '2026-10-02', 'ALOHA FISH MKT'], ['N-2', '5002', '2026-10-03', 'aloha  fish mkt'],
    ['N-3', '5003', '2026-08-20', 'ALOHA FISH MKT'], ['N-4', '5004', '2026-10-04', 'Aloha Fish Market'], ['N-5', '5005', '2026-10-04', 'Other Name Co']]);
  for (const k of ['N-1', 'N-2', 'N-3', 'N-4', 'N-5']) { assert.equal(D[k].vendor_key, null, k); assert.ok(codes(D[k]).includes('vendor_unknown'), k); }
  // On screen: N-2 (registered from it). Accounting may (10A).
  const r = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v900', display_name: '  Aloha Fish Market ', food_kind: 'food' }, printed: 'ALOHA FISH MKT', doc_id: D['N-2'].id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.doc_ids, [D['N-2'].id, D['N-1'].id, D['N-4'].id], 'the one on screen first; the typed name too; not the closed month');
  assert.deepEqual([r.body.closed_left, r.body.months, r.body.recheck, r.body.summary], [1, ['2026-10'], { fixed: 3, failed: 0, left: 0 }, true]);
  const v = await rule(E, 'v900');
  assert.deepEqual([v.display_name, v.aliases, v.food_kind, v.auto_post, v.merged_into, v.verified_by], ['Aloha Fish Market', ['ALOHA FISH MKT'], 'food', false, null, '00000000-0000-4000-8000-0000000000a2']);
  for (const k of ['N-1', 'N-2', 'N-4']) {
    const d = await one(E, D[k].id);
    assert.deepEqual([d.vendor_key, d.vendor_name, d.food_kind, d.version], ['v900', 'Aloha Fish Market', 'food', D[k].version + 1], k);
    assert.ok(!codes(d).includes('vendor_unknown') && codes(d).includes('mode_review_vendor'), k + ': a new vendor starts in review mode');
  }
  for (const k of ['N-3', 'N-5']) { const d = await one(E, D[k].id); assert.deepEqual([d.vendor_key, d.version], [null, D[k].version], k + ' stays'); }
  assert.equal((await E.q(`select count(*)::int n from invoice_events where kind='vendor_registered' and doc_id=$1`, [D['N-2'].id]))[0].n, 1);
  assert.equal((await E.q(`select count(*)::int n from invoice_events where kind='vendor_alias_learned'`))[0].n, 0, 'nothing more is learned');
  // The month's summary has the invoices under the new vendor (written by the registration itself).
  const sd = (await E.q(`select value from app_state where key='invoice_purchase_2026-10'`))[0].value.stores.F06.docs;
  assert.equal(sd.find(x => x.id === D['N-1'].id).vk, 'v900');
  // A later invoice printed with the name is the vendor by itself.
  const L = await read(E, [['N-6', '5006', '2026-10-05', 'Aloha Fish MKT']]);
  assert.deepEqual([L['N-6'].vendor_key, codes(L['N-6']).includes('vendor_unknown')], ['v900', false]);
  await E.pg.close();
});

test('新しい業者を決める: a name a vendor has already is not registered (the vendor is named); who may; bad values', async () => {
  const E = await setup();
  const D = await read(E, [['T-1', '6001', '2026-10-02', 'VENDOR A HAWAII']]);
  await E.q(`insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post,merged_into) values('v7','Old VendorB','{}','food',false,'v2')`);
  const before = await snap(E);
  const reg = (tok, vendor, printed = 'VENDOR A HAWAII', doc_id = D['T-1'].id) => E.api(tok, { action: 'vendor_register', vendor, printed, doc_id });
  // The typed name is VendorA's own name / one of VendorA's names / the printed name is one of VendorA's names.
  for (const [vendor, printed, name] of [[{ vendor_key: 'v901', display_name: 'vendora', food_kind: 'food' }, 'VENDOR A HAWAII', 'VendorA'],
    [{ vendor_key: 'v901', display_name: 'Vendor A  Inc.', food_kind: 'food' }, 'VENDOR A HAWAII', 'VENDOR A INC.'],
    [{ vendor_key: 'v901', display_name: 'Vendor A Hawaii', food_kind: 'food' }, 'vendor a inc.', 'VENDOR A INC.']]) {
    const r = await reg('tok-office', vendor, printed);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { ok: false, taken: { why: 'name', vendor_key: 'v1', display_name: 'VendorA', name } });
  }
  // A key in use (also a merged vendor's: the vendor it ended at is named).
  let r = await reg('tok-office', { vendor_key: 'v2', display_name: 'Brand New', food_kind: 'food' });
  assert.deepEqual(r.body.taken, { why: 'key', vendor_key: 'v2', display_name: 'VendorB', name: 'VendorB' });
  r = await reg('tok-office', { vendor_key: 'v7', display_name: 'Brand New', food_kind: 'food' });
  assert.deepEqual(r.body.taken, { why: 'key', vendor_key: 'v2', display_name: 'VendorB', name: 'Old VendorB' });
  // Not allowed: someone without the role; bad values change nothing.
  assert.equal((await reg('tok-other', { vendor_key: 'v901', display_name: 'Brand New', food_kind: 'food' })).status, 403);
  assert.equal((await reg(null, { vendor_key: 'v901', display_name: 'Brand New', food_kind: 'food' })).status, 401);
  for (const [vendor, printed, doc_id] of [[{ vendor_key: 'v901', display_name: 'Brand New' }, 'X', null], [{ vendor_key: 'v901', display_name: 'Brand New', food_kind: 'drink' }, 'X', null],
    [{ vendor_key: 'v 901', display_name: 'Brand New', food_kind: 'food' }, 'X', null], [{ vendor_key: 'v901', display_name: '   ', food_kind: 'food' }, 'X', null],
    [{ vendor_key: 'v901', display_name: 'B'.repeat(201), food_kind: 'food' }, 'X', null], [{ vendor_key: 'v901', display_name: 'Brand New', food_kind: 'food' }, 'P'.repeat(201), null],
    [{ vendor_key: 'v901', display_name: 'Brand New', food_kind: 'food' }, 'X', 'not-a-uuid'], [{ vendor_key: 'v901', display_name: 'Brand New', food_kind: 'food' }, 42, null], ['x', 'X', null]]) {
    const b = await E.api('tok-office', { action: 'vendor_register', vendor, printed, doc_id });
    assert.equal(b.status, 400, JSON.stringify([vendor, printed, doc_id, b.body]));
  }
  assert.deepEqual(await snap(E), before, 'nothing was changed');
  // 事務Crew, GM and CEO may register too (10A).
  for (const [tok, key, name] of [['tok-crew', 'v902', 'Crew Vendor'], ['tok-gm', 'v903', 'GM Vendor'], ['tok-ceo', 'v904', 'CEO Vendor']]) {
    const x = await E.api(tok, { action: 'vendor_register', vendor: { vendor_key: key, display_name: name, food_kind: 'nonfood' } });
    assert.equal(x.status, 200, JSON.stringify(x.body)); assert.equal(x.body.ok, true); assert.deepEqual(x.body.doc_ids, []);
    assert.deepEqual([(await rule(E, key)).display_name, (await rule(E, key)).aliases, (await rule(E, key)).food_kind], [name, [], 'nonfood']);
  }
  // A merged vendor's own name is free (an invoice is never read as a merged vendor; its kept vendor has only the names it was given).
  const om = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v906', display_name: 'Old VendorB', food_kind: 'food' } });
  assert.deepEqual([om.body.ok, (await rule(E, 'v906')).display_name], [true, 'Old VendorB']);
  // The same name twice: the second one is refused (one writer at a time, then the name is taken).
  assert.equal((await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v905', display_name: 'crew vendor', food_kind: 'food' } })).body.taken.vendor_key, 'v902');
  await E.pg.close();
});

test('新しい業者を決める: an invoice with no printed name gets the new vendor on its own; the printed name same as the typed one is not added twice', async () => {
  const E = await setup();
  const D = await read(E, [['B-1', '7001', '2026-10-02', ''], ['B-2', '7002', '2026-10-02', ''], ['B-3', '7003', '2026-10-03', 'KONA ICE']]);
  assert.equal(D['B-1'].vendor_raw ?? '', '');
  let r = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v910', display_name: 'Pali Paper', food_kind: 'nonfood' }, printed: '', doc_id: D['B-1'].id });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual([r.body.doc_ids, r.body.vendor.aliases], [[D['B-1'].id], []]);
  assert.deepEqual([(await one(E, D['B-1'].id)).vendor_key, (await one(E, D['B-2'].id)).vendor_key], ['v910', null], 'only the one on screen');
  r = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v911', display_name: 'Kona Ice', food_kind: 'food' }, printed: 'KONA ICE', doc_id: D['B-3'].id });
  assert.deepEqual([r.body.ok, r.body.vendor.aliases, r.body.doc_ids], [true, [], [D['B-3'].id]], 'case only: the name is the same name');
  // A posted invoice or one with a vendor is never given the vendor through doc_id.
  const p = await one(E, D['B-3'].id);
  r = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v912', display_name: 'Third', food_kind: 'food' }, doc_id: p.id });
  assert.deepEqual(r.body.doc_ids, []);
  await E.pg.close();
});

test('新しい業者を決める: vendor_apply gives the waiting invoices the vendor that has their name now; two vendors or none: nothing', async () => {
  const E = await setup();
  const D = await read(E, [['A-1', '8001', '2026-10-02', 'VENDORB HAWAII'], ['A-2', '8002', '2026-10-03', 'VendorB Hawaii'], ['A-3', '8003', '2026-08-03', 'VENDORB HAWAII'],
    ['S-1', '8101', '2026-10-02', 'SHARED NAME'], ['Z-1', '8201', '2026-10-02', 'NOBODY CO']]);
  // A name added in the settings later: the invoices read before stay waiting.
  const v2 = await rule(E, 'v2');
  assert.equal((await E.api('tok-gm', { action: 'vendor_save', vendor: { vendor_key: 'v2', aliases: ['VENDORB HAWAII'], expect_updated_at: v2.updated_at } })).status, 200);
  assert.equal((await one(E, D['A-1'].id)).vendor_key, null);
  const r = await E.api('tok-crew', { action: 'vendor_apply', name: 'vendorb  hawaii', doc_id: D['A-3'].id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.vendor.vendor_key, r.body.doc_ids, r.body.closed_left, r.body.recheck.fixed], [true, 'v2', [D['A-3'].id, D['A-1'].id, D['A-2'].id], 0, 3],
    'the one on screen is given the vendor even in a closed month (a person looked at it)');
  for (const k of ['A-1', 'A-2', 'A-3']) assert.equal((await one(E, D[k].id)).vendor_key, 'v2', k);
  // The one on screen is given it whatever its printed name reads like (the person looked at it and pressed).
  const T = await read(E, [['A-9', '8009', '2026-10-05', 'VENDORB HAWAI']]);
  const t9 = await E.api('tok-office', { action: 'vendor_apply', name: 'VENDORB HAWAII', doc_id: T['A-9'].id });
  assert.deepEqual([t9.body.doc_ids, (await one(E, T['A-9'].id)).vendor_key], [[T['A-9'].id], 'v2']);
  // Without the one on screen, a closed month's invoice waits.
  await E.q(`update invoice_docs set vendor_key=null, vendor_name=null where id=$1`, [D['A-3'].id]);
  const r2 = await E.api('tok-office', { action: 'vendor_apply', name: 'VENDORB HAWAII' });
  assert.deepEqual([r2.body.doc_ids, r2.body.closed_left], [[], 1]);
  // Two vendors have the name: nothing is changed (a person chooses on the invoice).
  await E.q(`update invoice_vendor_rules set aliases=aliases||'{"SHARED NAME"}' where vendor_key in ('v1','v2')`);
  const before = await snap(E);
  const s = await E.api('tok-office', { action: 'vendor_apply', name: 'SHARED NAME' });
  assert.deepEqual([s.body.ok, s.body.vendors.map(x => x.vendor_key)], [false, ['v1', 'v2']]);
  const z = await E.api('tok-office', { action: 'vendor_apply', name: 'NOBODY CO' });
  assert.deepEqual(z.body, { ok: false, vendors: [] });
  assert.deepEqual(await snap(E), before);
  assert.equal((await E.api('tok-other', { action: 'vendor_apply', name: 'NOBODY CO' })).status, 403);
  for (const name of ['', '   ', 'N'.repeat(201), 7]) assert.equal((await E.api('tok-office', { action: 'vendor_apply', name })).status, 400, String(name));
  await E.pg.close();
});

// 今の業者に統合 from an invoice is 業者の統合 itself (vendor_merge_into checks first, under the same lock, that nothing else is
// merged, then calls invoice_vendor_merge): its record can be taken back from the vendor master.
const into = (E, tok, body) => E.api(tok, { action: 'vendor_merge_into', ...body });
test('新しい業者を決める: merging the printed name into a vendor — the waiting invoices get it, the one on screen too; taken back exactly', async () => {
  const E = await setup();
  const D = await read(E, [['M-1', '9001', '2026-10-02', 'VENDR A'], ['M-2', '9002', '2026-10-03', 'Vendr  A'], ['M-3', '9003', '2026-10-03', 'VendorB'],
    ['M-4', '9004', '2026-08-20', 'VENDR A'], ['M-5', '9005', '2026-08-21', 'VENDR A']]);
  const before = await snap(E);
  // Preview (nothing changes): the waiting ones of open months and the one on screen (M-4, a closed month) on top.
  const pv = await into(E, 'tok-office', { vendor_key: 'v1', name: 'VENDR A', doc_id: D['M-4'].id, preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.deepEqual([pv.body.ok, pv.body.matched, pv.body.target.vendor_key, pv.body.target.display_name, pv.body.from, pv.body.unknown, pv.body.waiting, pv.body.closed_left, pv.body.here, pv.body.added_aliases],
    [true, 1, 'v1', 'VendorA', [], 2, 3, 1, true, ['VENDR A']]);
  assert.deepEqual(await snap(E), before, 'a preview changes nothing');
  const m = await into(E, 'tok-crew', { vendor_key: 'v1', name: 'VENDR A', doc_id: D['M-4'].id, group_id: 'vm-inv-1' });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.ok(m.body.merge_id); assert.deepEqual(m.body.from, []);
  assert.deepEqual(m.body.review_doc_ids, [D['M-4'].id, D['M-1'].id, D['M-2'].id], 'the one on screen first');
  assert.deepEqual([m.body.recheck, m.body.closed_left, m.body.waiting, m.body.summary], [{ fixed: 3, failed: 0, left: 0 }, 1, 3, true]);
  const vk = async k => (await one(E, D[k].id)).vendor_key;
  assert.deepEqual([await vk('M-1'), await vk('M-2'), await vk('M-3'), await vk('M-4'), await vk('M-5')], ['v1', 'v1', 'v2', 'v1', null], 'a closed month stays, but not the one on screen');
  assert.deepEqual((await rule(E, 'v1')).aliases, ['VENDOR A INC.', 'VENDR A']);
  assert.equal((await E.q(`select group_id from invoice_vendor_merges where id=$1`, [m.body.merge_id]))[0].group_id, 'vm-inv-1');
  const u = await E.api('tok-office', { action: 'vendor_unmerge', merge_id: m.body.merge_id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual((await rule(E, 'v1')).aliases, ['VENDOR A INC.'], 'the name is taken back');
  await E.pg.close();
});

test('新しい業者を決める: merging never merges another vendor and never renames the vendor; who may; bad values', async () => {
  const E = await setup();
  const D = await read(E, [['X-1', '9101', '2026-10-02', 'VENDR A'], ['X-2', '9102', '2026-10-02', 'VENDOR A INC.'.toLowerCase() + ' x']]);
  // The vendor was renamed on another screen (its old name kept as one of its names): a screen that read the old name merges into
  // it as it is called now, and does not rename it back.
  await E.q(`update invoice_vendor_rules set display_name='VendorA Hawaii', aliases=aliases||'{"VendorA"}' where vendor_key='v1'`);
  const r = await into(E, 'tok-office', { vendor_key: 'v1', name: 'VENDR A', doc_id: D['X-1'].id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.target.display_name, r.body.target.before, (await rule(E, 'v1')).display_name], ['VendorA Hawaii', 'VendorA Hawaii', 'VendorA Hawaii']);
  // Another vendor has the vendor's name: refused, nothing changes (the vendor master's 業者の統合 is the place for that).
  await E.q(`insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post) values('v8','VendorA Hawaii Co','{"VENDORA HAWAII"}','food',false)`);
  const b1 = await snap(E);
  let x = await into(E, 'tok-office', { vendor_key: 'v1', name: 'VENDOR NEW', doc_id: D['X-2'].id });
  assert.deepEqual(x.body, { ok: false, why: 'shared', vendors: [{ vendor_key: 'v8', display_name: 'VendorA Hawaii Co' }] });
  // The printed name is a vendor's already (registered or merged on another screen): refused, that vendor is named.
  x = await into(E, 'tok-office', { vendor_key: 'v2', name: 'vendr  a' });
  assert.deepEqual(x.body, { ok: false, why: 'owned', vendors: [{ vendor_key: 'v1', display_name: 'VendorA Hawaii' }] });
  // A vendor merged into another one, or none.
  await E.q(`update invoice_vendor_rules set merged_into='v2' where vendor_key='v8'`);
  for (const k of ['v8', 'v99']) assert.deepEqual((await into(E, 'tok-office', { vendor_key: k, name: 'SOMETHING ELSE' })).body, { ok: false, why: 'gone', vendors: [] }, k);
  await E.q(`update invoice_vendor_rules set merged_into=null where vendor_key='v8'`);
  assert.deepEqual(await snap(E), b1, 'nothing was changed');
  assert.equal((await into(E, 'tok-other', { vendor_key: 'v2', name: 'SOMETHING ELSE' })).status, 403);
  for (const body of [{ vendor_key: 'v 2', name: 'X' }, { vendor_key: 'v2', name: '  ' }, { vendor_key: 'v2', name: 'N'.repeat(201) }, { vendor_key: 'v2', name: 'X', doc_id: 'nope' },
    { vendor_key: 2, name: 'X' }, { vendor_key: 'v2', name: 'X', group_id: 5 }]) assert.equal((await into(E, 'tok-office', body)).status, 400, JSON.stringify(body));
  await E.pg.close();
});

test('新しい業者を決める: an invoice that cannot be worked out never holds the others back; the rest are left for the next call', async () => {
  const failGet = new Set();
  const E = await setup(SQL, { vendorRecheck: 2, failGet });
  const D = await read(E, [['L-1', '9201', '2026-10-01', 'SLOW CO'], ['L-2', '9202', '2026-10-02', 'SLOW CO'], ['L-3', '9203', '2026-10-03', 'SLOW CO'], ['L-4', '9204', '2026-10-04', 'SLOW CO']]);
  failGet.add(D['L-1'].id);
  const r = await E.api('tok-office', { action: 'vendor_register', vendor: { vendor_key: 'v930', display_name: 'Slow Co', food_kind: 'food' }, printed: 'SLOW CO' });
  assert.deepEqual([r.body.doc_ids.length, r.body.recheck], [4, { fixed: 2, failed: 1, left: 1 }]);
  const a = await E.api('tok-office', { action: 'vendor_apply', name: 'SLOW CO', vendor_key: 'v930' });
  assert.deepEqual([a.body.ok, a.body.recheck], [true, { fixed: 1, failed: 1, left: 0 }], 'the next call reaches the last one');
  assert.deepEqual(await Promise.all(['L-1', 'L-2', 'L-3', 'L-4'].map(async k => (await one(E, D[k].id)).vendor_key)), [null, 'v930', 'v930', 'v930']);
  // The vendor the screen showed is checked: another one has the name now → nothing.
  const b = await E.api('tok-office', { action: 'vendor_apply', name: 'SLOW CO', vendor_key: 'v1' });
  assert.deepEqual([b.body.ok, b.body.vendors.map(v => v.vendor_key)], [false, ['v930']]);
  await E.pg.close();
});

test('新しい業者を決める: "this invoice only" learns no name; an older screen still learns it as before', async () => {
  const E = await setup();
  const D = await read(E, [['O-1', '9301', '2026-10-02', 'ONE OFF NAME'], ['O-2', '9302', '2026-10-02', 'TWO OFF NAME']]);
  let r = await E.api('tok-office', { action: 'edit', doc_id: D['O-1'].id, version: D['O-1'].version, header: { vendor_key: 'v2' }, lines: [], reason: '業者を選んだ：VendorB', ack: [], learn: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.alias_learned, (await rule(E, 'v2')).aliases, (await one(E, D['O-1'].id)).vendor_key], [undefined, [], 'v2']);
  r = await E.api('tok-office', { action: 'edit', doc_id: D['O-2'].id, version: D['O-2'].version, header: { vendor_key: 'v2' }, lines: [], reason: 'x', ack: [] });
  assert.deepEqual([r.body.alias_learned, (await rule(E, 'v2')).aliases], ['TWO OFF NAME', ['TWO OFF NAME']]);
  await E.pg.close();
});

// The screen (index.html v1089: the invoice intake module with 業者を決める, and the vendor merge module it records merges with)
// against the real server: the review list offers 業者を決める; merging, registering and giving the vendor change the database as the
// screen says, and the app's vendor master gets its card and its merge record.
function screenOn(E, tok = 'tok-office', mem = { m_vendors: [{ id: 'v1', name: 'VendorA', kind: 'food' }], vendor_merges: {}, m_vendor_alias: {} }) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
  const MOD = cut('/* FUNERGY_INVOICE_INTAKE_BEGIN */', '/* FUNERGY_INVOICE_INTAKE_END */') + '\n' + cut('/* FUNERGY_VENDOR_MERGE_BEGIN */', '/* FUNERGY_VENDOR_MERGE_END */');
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dom = {};
  const c = { toasts: [], modals: [], curLang: 'ja', curRole: 'office', curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview', t: ja => ja, escapeHtml: esc,
    STORES: [{ id: 'F06', name: 'LaLa', color: '#777' }], getStoresAll: () => c.STORES, getIngredients: () => [], showToast: (m, k) => c.toasts.push([m, k]),
    openModal: h => { c.modals.push(h); if (/id="ivd-modal"/.test(h)) dom['ivd-modal'] = { innerHTML: '' }; else delete dom['ivd-modal']; }, closeModalDirect: () => { delete dom['ivd-modal']; },
    renderPage: () => {}, acSetSub: x => { c._acSub = x; }, go: () => {}, myName: () => 'Akane', nowJP: () => '2026/10/16 18:00',
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), lsSet: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    _lsStoreGet: k => (k in mem ? JSON.stringify(mem[k]) : null), getVendors: () => c.ls('m_vendors', []), getIngV2: () => [], pullOpKey: async () => true,
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon', _botSession: { access_token: tok }, botResetShared: () => {}, botTime: v => String(v || ''),
    window: {}, setTimeout: () => {}, clearTimeout: () => {}, document: { getElementById: k => dom[k] || null, querySelectorAll: () => [], activeElement: null },
    fetch: async (url, init) => { const body = JSON.parse(init.body); c.sent.push(body.action);
      if (c.failConfig && body.action === 'config') return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) };   // the list cannot be read now
      const r = await E.api(tok, body); return { ok: r.status < 400, status: r.status, json: async () => r.body }; }, sent: [] };
  vm.createContext(c);
  vm.runInContext(MOD + '\nthis.M = { _invIn, get m(){ return _ivd.m; } };', c);
  c.M._invIn.loaded = {}; c.M._invIn.cand = {};
  c.fn = n => vm.runInContext(n, c);
  c.mem = mem; c.box = () => (dom['ivd-modal'] ? dom['ivd-modal'].innerHTML : null);
  return c;
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

test('新しい業者を決める: the screen against the real server — merge, register and the vendor that has the name now', async () => {
  const E = await setup();
  const D = await read(E, [['W-1', '9101', '2026-10-02', 'VENDR A'], ['W-2', '9102', '2026-10-03', 'Vendr A'], ['W-3', '9103', '2026-10-03', 'ALOHA FISH MKT'],
    ['W-4', '9104', '2026-10-04', 'ALOHA FISH MKT'], ['W-5', '9105', '2026-10-04', 'VENDORB HAWAII']]);
  const ui = screenOn(E, 'tok-crew');
  ui.curRole = 'office_crew';
  await ui.fn('invInLoadQueue')('review');
  ui.M._invIn.config = (await E.api('tok-crew', { action: 'config' })).body;
  const list = ui.fn('invInReviewTable')(ui.M._invIn.review);
  for (const k of ['W-1', 'W-3', 'W-5']) assert.ok(list.includes(`ivdOpenRow('${D[k].id}')`), k + ': 業者を決める on its row');
  // 今の業者に統合: VENDR A → VendorA (spelled slightly differently), the two waiting invoices get it, the app records the merge.
  await ui.fn('ivdOpenRow')(D['W-1'].id); await settle();
  assert.deepEqual([ui.M.m.mode, ui.M.m.pick], ['merge', 'v1']);
  assert.match(ui.box(), /綴りが少し違う/); assert.match(ui.box(), /待っている invoice 2 件の業者も直します/);
  await ui.fn('ivdMerge')(); await settle();
  assert.equal(ui.toasts.at(-1)[1], 'success', JSON.stringify(ui.toasts.at(-1)));
  assert.deepEqual([(await one(E, D['W-1'].id)).vendor_key, (await one(E, D['W-2'].id)).vendor_key], ['v1', 'v1']);
  assert.deepEqual((await rule(E, 'v1')).aliases, ['VENDOR A INC.', 'VENDR A']);
  const gk = Object.keys(ui.mem.vendor_merges).find(k => k.startsWith('g:'));
  const merge = (await E.q(`select * from invoice_vendor_merges`))[0];
  assert.deepEqual([ui.mem.vendor_merges[gk].server.id, merge.group_id, ui.mem.vendor_merges['n:vendr a'].to], [merge.id, gk.slice(2), 'VendorA']);
  assert.ok(ui.sent.includes('vendor_merge_into') && !ui.sent.includes('vendor_merge'), 'through the checked merge');
  // 新しい業者として登録 (事務Crew may: 10A): both waiting invoices get it; the app vendor master gets its card (11A).
  ui.M._invIn.config = (await E.api('tok-crew', { action: 'config' })).body;
  await ui.fn('ivdOpenRow')(D['W-3'].id); await settle();
  assert.equal(ui.M.m.mode, 'register');
  ui.fn('ivdNameIn')('Aloha Fish Market'); ui.fn('ivdKind')('food');
  await ui.fn('ivdRegister')(); await settle();
  const key = ui.mem.m_vendors.at(-1).id;
  const nv = await rule(E, key);
  assert.deepEqual([nv.display_name, nv.aliases, nv.food_kind, ui.mem.m_vendors.at(-1).name, ui.mem.m_vendors.length], ['Aloha Fish Market', ['ALOHA FISH MKT'], 'food', 'Aloha Fish Market', 2]);
  assert.deepEqual([(await one(E, D['W-3'].id)).vendor_key, (await one(E, D['W-4'].id)).vendor_key], [key, key]);
  // Opened again, the vendor list is read again: the name is that vendor's now (no second registration offered).
  await ui.fn('ivdOpen')(D['W-4'].id, 1, 'ALOHA FISH MKT'); await settle();
  assert.equal(ui.M.m.mode, 'owned');
  // The list cannot be read (the one read before is used, without the new vendor): the server refuses, names it, no second card.
  ui.M._invIn.config = { vendors: [] }; ui.failConfig = true;
  await ui.fn('ivdOpen')(D['W-4'].id, 1, 'ALOHA FISH MKT'); await settle();
  ui.fn('ivdMode')('register'); ui.fn('ivdKind')('food'); await ui.fn('ivdRegister')(); await settle();
  assert.match(ui.box(), /「Aloha Fish Market」がもうこの名前を持っています/);
  assert.equal(ui.mem.m_vendors.length, 2);
  ui.failConfig = false;
  // A name added in the settings since: the waiting invoice gets that vendor.
  const v2 = await rule(E, 'v2');
  await E.api('tok-gm', { action: 'vendor_save', vendor: { vendor_key: 'v2', aliases: ['VENDORB HAWAII'], expect_updated_at: v2.updated_at } });
  ui.M._invIn.config = (await E.api('tok-crew', { action: 'config' })).body;
  await ui.fn('ivdOpenRow')(D['W-5'].id); await settle();
  assert.equal(ui.M.m.mode, 'owned');
  await ui.fn('ivdApply')(); await settle();
  assert.equal((await one(E, D['W-5'].id)).vendor_key, 'v2');
  assert.ok(ui.toasts.every(([, k]) => k !== 'warning'), JSON.stringify(ui.toasts));
  await E.pg.close();
});

test('新しい業者を決める deploy folder: the copies are the repository files and the one-file function is built from the sources in use',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, async () => {
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-vendor-register-v1089/', M = 'supabase/migrations/';
  assert.ok(rd(D + '1_追加のSQL_新しい業者だけ.sql').equals(rd(M + '20261024090000_invoice_vendor_register.sql')));
  assert.ok(rd(D + '1_追加のSQL_段階2と段階3と業者の統合と新しい業者.sql').equals(Buffer.concat([rd(M + '20261020090000_invoice_reconciled_folder.sql'), Buffer.from('\n'),
    rd(M + '20261021090000_invoice_multi_file.sql'), Buffer.from('\n'), rd(M + '20261022090000_invoice_vendor_merge.sql'), Buffer.from('\n'), rd(M + '20261024090000_invoice_vendor_register.sql')])));
  assert.ok(rd(D + '2_確認のSQL_読むだけ.sql').equals(rd('db/invoice-intake-postcheck.sql')));
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  // Every source of the one-file function is the repository's as it is now: change one, build the function again.
  for (const [f, h] of Object.entries(src.sources)) assert.equal(sha(rd(f)), h, f + ' changed: build 3_関数 again');
  assert.deepEqual(Object.keys(src.sources).sort(), ['invoice/dates.mjs', 'invoice/decimal.mjs', 'invoice/dedupe.mjs', 'invoice/drive.mjs', 'invoice/extract.mjs', 'invoice/naming.mjs',
    'invoice/rules.mjs', 'invoice/units.mjs', 'supabase/functions/invoice-intake/handler.mjs', 'supabase/functions/invoice-intake/index.ts']);
  const bundle = rd(D + '3_関数_invoice-intake_index.ts').toString();
  assert.ok(!/^\s*import\s/m.test(bundle) && /Deno\.serve\(createHandler/.test(bundle));
  for (const k of ['invoice_vendor_register', 'invoice_vendor_waiting', 'vendor_apply', 'invoice_vendor_merge', 'finalVendor', 'invoice_merge', 'invoice_purchase_publish']) assert.ok(bundle.includes(k), k);
  // The steps name the files in the folder, and the order SQL → check → function → app.
  const steps = rd(D + '手順.md').toString();
  for (const f of ['1_追加のSQL_段階2と段階3と業者の統合と新しい業者.sql', '1_追加のSQL_新しい業者だけ.sql', '2_確認のSQL_読むだけ.sql', '3_関数_invoice-intake_index.ts',
    'deploy/invoice-vendor-merge-v1083/3_関数_invoice-intake_index.ts']) assert.ok(steps.includes(f), f);
  assert.ok(steps.indexOf('1_追加のSQL') < steps.indexOf('2_確認のSQL') && steps.indexOf('2_確認のSQL') < steps.indexOf('3_関数') && steps.indexOf('3_関数') < steps.indexOf('v1089 をマージ'));
});

// The check SQL says whether 新しい業者を決める is in: false on a database with everything before it, true after it (and the counts).
test('新しい業者を決める: the check SQL tells before from after', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => /^\d{14}_invoice_.*\.sql$/.test(f)).sort();
  const S5 = '20261024090000_invoice_vendor_register.sql';
  assert.equal(files.at(-1), S5);
  const POST = fs.readFileSync(new URL('../db/invoice-intake-postcheck.sql', import.meta.url), 'utf8');
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);`);
    for (const f of files.slice(0, -1)) await pg.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    let post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.vendor_register, post.vendor_merge, Number(post.tables), Number(post.functions)], [false, true, 19, 81]);
    await pg.exec(fs.readFileSync(new URL(S5, dir), 'utf8'));
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.vendor_register, post.vendor_merge, Number(post.tables), Number(post.functions), Number(post.browser_can_read), Number(post.browser_can_run)],
      [true, true, 19, 84, 0, 0]);
    // A browser role that could run one of them is told.
    await pg.exec(`grant execute on function public.invoice_vendor_register(jsonb) to anon`);
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.vendor_register, Number(post.browser_can_run)], [false, 1]);
  } finally { await pg.close(); }
});
