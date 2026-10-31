// 業者の統合（Moto 2026-10-15・UI案51 決めてほしいこと 1〜7 はすべて A）— the invoice intake side, on synthetic data: real SQL (PGlite),
// the real worker/handler code, and in-memory stand-ins for Google Drive, the AI and mail (the harness of tests/invoice-intake.test.mjs).
// Nothing here reaches production, Drive, QuickBooks or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';
import { parseResponse } from '../invoice/extract.mjs';

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

async function setup(sql = SQL) {   // sql: another schema to run on (e.g. the production upgrade path)
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
    update invoice_settings set value=value||'{"route":"invoice-intake","enabled":true,"from":"sender@example.test"}' where key='qb';
    -- This system sends from the connected Gmail of qb.from (UI案56); the stand-in mailer sends in its place.
    do $g$ begin if to_regclass('public.invoice_gmail_auth') is not null then insert into invoice_gmail_auth(id, account, refresh_token, scopes, status)
      values (1, 'sender@example.test', 'synthetic-refresh', '{https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly}', 'ok'); end if; end $g$;
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
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
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
  const h = createHandler({ env, fetch, db, drive, ai, mailer, now: () => Date.parse('2026-10-06T20:00:00Z') });
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
const final = async (E, k) => (await E.q(`select public.invoice_vendor_final($1) v`, [k]))[0].v;
const lines1 = (code, amt, qty = '1', unit = 'CS', pack = null) => [[code, code === '06263' ? 'SHIRO MISO 12/500G' : 'SAKE 6/1.8L', qty, (Number(amt) / Number(qty)).toFixed(2), amt, unit, pack]];
// A second card for the same vendor, made when an invoice was read with a slightly different name (the reason for 業者の統合),
// with a product mapping of its own (00777) and one the kept vendor also has (06263: that one stays where it is).
async function seedDuplicate(E) {
  await E.q(`insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post) values('v5','Vendor A Co','{}','food',false)`);
  await E.q(`insert into invoice_item_maps(vendor_key,vendor_item_code,spec_key,purchase_unit,ingredient_code,count_unit,count_per_purchase,base_unit,base_per_purchase,verified,auto_post) values
    ('v5','00777','','CS','I-2','BTL',6,'ml',10800,true,false),('v5','06263','12/500G','CS','I-1','BAG',12,'g',6000,true,false)`);
}
const snapVendors = async E => ({ rules: await E.q(`select * from invoice_vendor_rules order by vendor_key`),
  docs: await E.q(`select id, vendor_key, vendor_name, version, reasons from invoice_docs order by id`),
  maps: await E.q(`select id, vendor_key from invoice_item_maps order by id`), prices: await E.q(`select id, vendor_key from invoice_price_history order by id`),
  checks: await E.q(`select id, vendor_key from invoice_purchase_checks order by id`), merges: await E.q(`select * from invoice_vendor_merges order by merged_at`) });

test('業者の統合: the vendors become one, open months move, closed months and double postings stay; taken back exactly', async () => {
  const E = await setup();
  await seedDuplicate(E);
  // a1 VendorA posted automatically; b1/b4 waiting (the duplicate vendor is in review mode); b2 posted by a person under the
  // duplicate vendor with a1's number (a double posting); b3 in a closed month; u1 a printed name no vendor has; c1 another vendor.
  E.fixtures.set('A-1001', { readable: true, documents: [doc('1001', '2026-10-02', lines1('06263', '120.00', '2', 'CS', '12/500G'), { vendor: 'Vendor A Inc.' })] });
  E.fixtures.set('B-2001', { readable: true, documents: [doc('2001', '2026-10-03', lines1('00777', '30.00'), { vendor: 'Vendor A Co' })] });
  E.fixtures.set('B-1001', { readable: true, documents: [doc('1001', '2026-10-02', lines1('00777', '60.00', '2'), { vendor: 'Vendor A Co' })] });
  E.fixtures.set('B-2003', { readable: true, documents: [doc('2003', '2026-08-20', lines1('00777', '30.00'), { vendor: 'Vendor A Co' })] });
  E.fixtures.set('B-2004', { readable: true, documents: [doc('2004', '2026-10-05', lines1('00777', '45.00'), { vendor: 'Vendor A Co' })] });
  E.fixtures.set('U-3001', { readable: true, documents: [doc('3001', '2026-10-04', lines1('00777', '30.00'), { vendor: 'VENDOR-A HAWAII' })] });
  E.fixtures.set('C-4001', { readable: true, documents: [doc('4001', '2026-10-04', lines1('00777', '30.00'), { vendor: 'VendorB' })] });
  const F = {};
  for (const tag of ['A-1001', 'B-2001', 'B-1001', 'B-2003', 'B-2004', 'U-3001', 'C-4001']) F[tag] = E.drive.file(tag + '.pdf', pdf(tag), 'U6');
  assert.equal((await E.worker()).body.ok, true);
  const D = {}; for (const tag of Object.keys(F)) [D[tag]] = await docsOf(E, F[tag]);
  assert.deepEqual(Object.fromEntries(Object.entries(D).map(([k, d]) => [k, [d.vendor_key, d.status]])), {
    'A-1001': ['v1', 'posted'], 'B-2001': ['v5', 'review'], 'B-1001': ['v5', 'review'], 'B-2003': ['v5', 'review'], 'B-2004': ['v5', 'review'],
    'U-3001': [null, 'review'], 'C-4001': ['v2', 'review'] });
  assert.ok(codes(D['B-2001']).includes('mode_review_vendor')); assert.ok(codes(D['U-3001']).includes('vendor_unknown'));
  const p = await E.api('tok-office', { action: 'post', doc_id: D['B-1001'].id, version: D['B-1001'].version, reason: '確認済み' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await E.q(`select count(*)::int n from invoice_price_history where vendor_key='v5'`))[0].n, 1);
  // A statement check of the duplicate vendor this month, and one of a closed month (written before it closed).
  assert.equal((await E.api('tok-office', { action: 'purchase_check', store_id: 'F06', vendor_key: 'v5', ym: '2026-10', state: 'complete' })).status, 200);
  await E.q(`insert into invoice_purchase_checks(store_id,vendor_key,ym,state,checked_by) values('F06','v5','2026-08','complete','x')`);
  const driveUpdates = () => E.drive.log.filter(x => x[0] === 'update').length;
  const qbRows = async () => (await E.q(`select count(*)::int n from invoice_qb_outbox`))[0].n;
  const up0 = driveUpdates(), qb0 = await qbRows(), names0 = [F['A-1001'], F['B-1001']].map(f => E.drive.items.get(f).name);
  const names = ['VendorA', 'Vendor A Co', 'VENDOR-A HAWAII'];

  // Preview: what would change, and nothing changes.
  const before = await snapVendors(E);
  const pv = await E.api('tok-office', { action: 'vendor_merge', to: 'VendorA', names, preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.deepEqual([pv.body.matched, pv.body.target.vendor_key, pv.body.from.map(x => x.vendor_key), pv.body.docs, pv.body.review, pv.body.posted,
    pv.body.kept.map(x => x.id), pv.body.closed_left, pv.body.unknown, pv.body.maps, pv.body.prices, pv.body.checks],
    [2, 'v1', ['v5'], 2, 2, 0, [D['B-1001'].id], 1, 1, 1, 1, 1]);
  assert.deepEqual(pv.body.added_aliases, ['Vendor A Co', 'VENDOR-A HAWAII']);
  assert.deepEqual(await snapVendors(E), before, 'a preview changes nothing');

  // Merge (accounting may: UI案51 5A).
  const r = await E.api('tok-office', { action: 'vendor_merge', to: 'VendorA', names, group_id: 'vm-test-1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.merge_id); assert.deepEqual(r.body.recheck, { fixed: 3, failed: 0, left: 0 }); assert.equal(r.body.summary, true);
  assert.equal(r.body.review_doc_ids[0], D['U-3001'].id, 'the invoice that had no vendor is worked out first');
  assert.deepEqual((await E.q(`select moved->'unknown' u from invoice_vendor_merges where id=$1`, [r.body.merge_id]))[0].u.map(x => x.id), [D['U-3001'].id], 'and recorded');
  const v1 = await rule(E, 'v1'), v5 = await rule(E, 'v5');
  assert.deepEqual([v1.display_name, v1.aliases, v1.merged_into], ['VendorA', ['VENDOR A INC.', 'Vendor A Co', 'VENDOR-A HAWAII'], null]);
  assert.deepEqual([v5.merged_into, v5.aliases, v5.display_name], ['v1', [], 'Vendor A Co'], 'the merged vendor keeps its own names (taken back exactly)');
  assert.equal(await final(E, 'v5'), 'v1');
  const now = {}; for (const k of Object.keys(D)) now[k] = await one(E, D[k].id);
  assert.deepEqual(Object.fromEntries(Object.entries(now).map(([k, d]) => [k, d.vendor_key])), {
    'A-1001': 'v1', 'B-2001': 'v1', 'B-1001': 'v5', 'B-2003': 'v5', 'B-2004': 'v1', 'U-3001': 'v1', 'C-4001': 'v2' },
    'open months move; the double posting and the closed month stay; another vendor is untouched');
  // Waiting invoices are worked out again with the kept vendor (a correction: new version), the posted ones keep their version.
  for (const k of ['B-2001', 'B-2004', 'U-3001']) { assert.equal(now[k].version, D[k].version + 1, k); assert.equal(now[k].vendor_name, 'VendorA', k); }
  assert.ok(!codes(now['B-2001']).includes('mode_review_vendor'), 'the kept vendor is automatic'); assert.ok(!codes(now['U-3001']).includes('vendor_unknown'));
  assert.equal(now['A-1001'].version, D['A-1001'].version); assert.equal(now['B-1001'].version, 2);
  // Product mappings, price history and this month's statement check go to the kept vendor; the same mapping and the closed month stay.
  assert.deepEqual((await E.q(`select vendor_item_code c, vendor_key k from invoice_item_maps where vendor_item_code in ('00777','06263') order by 1, 2`)).map(x => x.c + ':' + x.k),
    ['00777:v1', '06263:v1', '06263:v5']);
  assert.equal((await E.q(`select count(*)::int n from invoice_price_history where vendor_key='v5'`))[0].n, 0);
  assert.deepEqual((await E.q(`select ym, vendor_key from invoice_purchase_checks order by ym`)).map(x => x.ym + ':' + x.vendor_key), ['2026-08:v5', '2026-10:v1']);
  // Drive is not renamed again and nothing new goes to QuickBooks.
  assert.equal(driveUpdates(), up0); assert.equal(await qbRows(), qb0);
  assert.deepEqual([F['A-1001'], F['B-1001']].map(f => E.drive.items.get(f).name), names0);
  // The month's summary has the moved invoices under the kept vendor.
  const sum = (await E.q(`select value from app_state where key='invoice_purchase_2026-10'`))[0].value;
  const sd = sum.stores.F06.docs;
  assert.deepEqual([D['B-2001'].id, D['U-3001'].id, D['B-1001'].id].map(id => sd.find(x => x.id === id).vk), ['v1', 'v1', 'v5']);
  // A later invoice printed with a merged name is the kept vendor; a screen opened before the merge gets it too.
  E.fixtures.set('B-2005', { readable: true, documents: [doc('2005', '2026-10-06', lines1('00777', '30.00'), { vendor: 'Vendor A Co' })] });
  const f5 = E.drive.file('B-2005.pdf', pdf('B-2005'), 'U6');
  await E.worker();
  assert.equal((await docsOf(E, f5))[0].vendor_key, 'v1');
  const c1 = await one(E, D['C-4001'].id);
  assert.equal((await E.api('tok-office', { action: 'edit', doc_id: c1.id, version: c1.version, header: { vendor_key: 'v5' }, lines: [], reason: '古い画面', ack: [] })).status, 200);
  assert.equal((await one(E, c1.id)).vendor_key, 'v1');
  // A merged vendor is not edited; a statement check given for it is kept for the kept vendor.
  const sv = await E.api('tok-gm', { action: 'vendor_save', vendor: { vendor_key: 'v5', auto_post: true } });
  assert.deepEqual([sv.status, sv.body.error], [409, 'merged']);
  assert.equal((await E.api('tok-crew', { action: 'purchase_check', store_id: 'F06', vendor_key: 'v5', ym: '2026-10', state: 'missing', note: '1 枚足りない' })).status, 200);
  assert.equal((await E.q(`select vendor_key from invoice_purchase_checks order by id desc limit 1`))[0].vendor_key, 'v1');
  // Someone takes a merged name off the kept vendor: an invoice left with the merged vendor (a closed month) is still read as the kept one.
  const kv = (await E.q(`select to_jsonb(updated_at) u from invoice_vendor_rules where vendor_key='v1'`))[0].u;
  assert.equal((await E.api('tok-gm', { action: 'vendor_save', vendor: { vendor_key: 'v1', aliases: ['VENDOR A INC.', 'VENDOR-A HAWAII'], expect_updated_at: kv } })).status, 200);
  const b3 = await one(E, D['B-2003'].id);
  const e3 = await E.api('tok-office', { action: 'edit', doc_id: b3.id, version: b3.version, header: { due_date: '2026-09-30' }, lines: [], reason: '期日', ack: [] });
  assert.equal(e3.status, 200, JSON.stringify(e3.body));
  assert.deepEqual([(await one(E, b3.id)).vendor_key, codes(await one(E, b3.id)).includes('vendor_unknown')], ['v5', false]);
  assert.ok(!codes(await one(E, b3.id)).includes('mode_review_vendor'), 'read with the kept vendor’s settings (automatic), not the merged one’s');
  // What the screen reads.
  const u = await E.api('tok-crew', { action: 'vendor_usage' });
  assert.equal(u.status, 200);
  assert.equal(u.body.vendors.find(x => x.vendor_key === 'v5').merged_into, 'v1');
  assert.deepEqual(u.body.merges.map(m => [m.id, m.to_key, m.group_id]), [[r.body.merge_id, 'v1', 'vm-test-1']]);
  // b4 is corrected to another vendor after the merge: it stays there when the merge is taken back.
  const b4 = await one(E, D['B-2004'].id);
  assert.equal((await E.api('tok-office', { action: 'edit', doc_id: b4.id, version: b4.version, header: { vendor_key: 'v2' }, lines: [], reason: '別の業者', ack: [] })).status, 200);

  // Take it back.
  const upv = await E.api('tok-gm', { action: 'vendor_unmerge', merge_id: r.body.merge_id, preview: true });
  assert.equal(upv.status, 200, JSON.stringify(upv.body));
  assert.deepEqual([upv.body.docs, upv.body.unknown, upv.body.stay, upv.body.review], [1, 1, 1, 2]);
  assert.equal((await rule(E, 'v5')).merged_into, 'v1', 'a preview changes nothing');
  const un = await E.api('tok-gm', { action: 'vendor_unmerge', merge_id: r.body.merge_id });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.deepEqual(un.body.recheck, { fixed: 2, failed: 0, left: 0 });
  const v1b = await rule(E, 'v1'), v5b = await rule(E, 'v5');
  assert.deepEqual([v1b.display_name, v1b.aliases, v1b.food_kind, v5b.merged_into, v5b.merged_by], ['VendorA', ['VENDOR A INC.'], 'food', null, null],
    'the names the merge added are taken off (also when one was taken off by hand since)');
  const back = {}; for (const k of Object.keys(D)) back[k] = await one(E, D[k].id);
  assert.deepEqual(Object.fromEntries(Object.entries(back).map(([k, d]) => [k, d.vendor_key])), {
    'A-1001': 'v1', 'B-2001': 'v5', 'B-1001': 'v5', 'B-2003': 'v5', 'B-2004': 'v2', 'U-3001': null, 'C-4001': 'v1' },
    'what the merge moved goes back (the invoice with a name no vendor had waits for a vendor again); what was corrected or read since stays');
  assert.deepEqual([back['U-3001'].vendor_name, codes(back['U-3001']).includes('vendor_unknown')], [D['U-3001'].vendor_name, true], 'worked out again: no vendor has its name now');
  assert.equal(back['B-2001'].vendor_name, 'Vendor A Co'); assert.ok(codes(back['B-2001']).includes('mode_review_vendor'), 'worked out again with its own vendor');
  assert.deepEqual((await E.q(`select vendor_item_code c, vendor_key k from invoice_item_maps where vendor_item_code in ('00777','06263') order by 1, 2`)).map(x => x.c + ':' + x.k),
    ['00777:v5', '06263:v1', '06263:v5']);
  assert.equal((await E.q(`select count(*)::int n from invoice_price_history where vendor_key='v5'`))[0].n, 1);
  assert.deepEqual((await E.q(`select ym, vendor_key, state from invoice_purchase_checks order by id`)).map(x => x.ym + ':' + x.vendor_key + ':' + x.state),
    ['2026-10:v5:complete', '2026-08:v5:complete', '2026-10:v1:missing'], 'the moved check goes back; the one written for the kept vendor since stays');
  assert.ok((await E.q(`select undone_at from invoice_vendor_merges where id=$1`, [r.body.merge_id]))[0].undone_at);
  assert.deepEqual((await E.api('tok-gm', { action: 'vendor_unmerge', merge_id: r.body.merge_id })).body, { error: 'invalid_state' });
  E.fixtures.set('B-2006', { readable: true, documents: [doc('2006', '2026-10-06', lines1('00777', '31.00'), { vendor: 'Vendor A Co' })] });
  const f6 = E.drive.file('B-2006.pdf', pdf('B-2006'), 'U6');
  await E.worker();
  assert.equal((await docsOf(E, f6))[0].vendor_key, 'v5', 'after taking it back, the name is the duplicate vendor’s again');
  assert.equal(driveUpdates() >= up0, true);
  await E.pg.close();
});

test('業者の統合: a later merge is taken back first; a new name for the kept vendor and its kind come back too; who and what', async () => {
  const E = await setup();
  await seedDuplicate(E);
  E.fixtures.set('A-1001', { readable: true, documents: [doc('1001', '2026-10-02', lines1('06263', '120.00', '2', 'CS', '12/500G'), { vendor: 'Vendor A Inc.' })] });
  const a1 = E.drive.file('A-1001.pdf', pdf('A-1001'), 'U6');
  await E.worker();
  const [d1] = await docsOf(E, a1);
  assert.equal(d1.status, 'posted'); const name1 = E.drive.items.get(a1).name;
  const m = async (tok, body) => E.api(tok, { action: 'vendor_merge', ...body });
  const un = async (tok, id) => E.api(tok, { action: 'vendor_unmerge', merge_id: id });
  const rules0 = await E.q(`select * from invoice_vendor_rules order by vendor_key`);
  // Who may, and what is refused (nothing changes).
  assert.equal((await m('tok-other', { to: 'VendorA', names: ['Vendor A Co'] })).status, 403);
  assert.equal((await E.api('tok-other', { action: 'vendor_usage' })).status, 403);
  for (const bad of [{ to: 'VendorA', names: 'Vendor A Co' }, { to: ' ', names: ['Vendor A Co'] }, { to: 'VendorA', names: [] },
    { to: 'VendorA', names: Array.from({ length: 51 }, (_, i) => 'N' + i) }, { to: 'VendorA', names: ['Vendor A Co'], group_id: 'a b' },
    { to: 'VendorA', names: ['Vendor A Co'], food_kind: 'drink' }, { to: 'x'.repeat(201), names: ['Vendor A Co'] }]) {
    assert.equal((await m('tok-gm', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await un('tok-gm', 'not-a-uuid')).status, 400);
  assert.equal((await un('tok-gm', '00000000-0000-4000-8000-000000000000')).status, 404);
  const none = await m('tok-gm', { to: 'Nobody Co', names: ['Nobody Co', 'NOBODY CO.'] });
  assert.deepEqual([none.status, none.body.matched, none.body.merge_id], [200, 0, null], 'no vendor of the intake has the names: nothing to merge here');
  assert.deepEqual(await E.q(`select * from invoice_vendor_rules order by vendor_key`), rules0);
  assert.equal((await E.q(`select count(*)::int n from invoice_vendor_merges`))[0].n, 0);
  // 事務Crew may merge (UI案51 5A).
  assert.equal((await m('tok-crew', { to: 'VendorA', names: ['Vendor A Co'], preview: true })).status, 200);

  // A chain: v5 into v1, then v1 into v2. The first one is taken back only after the second.
  const m1 = (await m('tok-office', { to: 'VendorA', names: ['Vendor A Co'] })).body;
  const m2 = (await m('tok-gm', { to: 'VendorB', names: ['VendorA'] })).body;
  assert.equal(m2.target.vendor_key, 'v2'); assert.deepEqual(m2.from, ['v1']);
  assert.deepEqual([await final(E, 'v5'), await final(E, 'v1'), await final(E, 'v2'), await final(E, 'nope')], ['v2', 'v2', 'v2', null]);
  assert.deepEqual((await rule(E, 'v2')).aliases, ['VendorA', 'VENDOR A INC.', 'Vendor A Co']);
  assert.equal((await one(E, d1.id)).vendor_key, 'v2'); assert.equal((await one(E, d1.id)).vendor_name, 'VendorB');
  assert.equal(E.drive.items.get(a1).name, name1, 'a posted original is not renamed again');
  // The product seed finds a merged name through the vendor it ended at; a card whose name a vendor has is not added again.
  // A product printed with the first merged vendor's own name (that vendor's row is the first one the database finds).
  await E.pg.query(`reset role`);
  await E.q(`insert into public.ingredients values ('L-9','Sake','BTL','Vendor A Co',6,'{"sku":"00777","extId":"lala-9","orderUnit":"CS","unit":"BTL","qty":6}')`);
  await E.pg.query(`set role service_role`);
  const seed = (await E.api('tok-gm', { action: 'map_seed', store_id: 'F06', apply: false })).body;
  assert.deepEqual(['L-1', 'L-9'].map(k => seed.candidates.find(c => c.ingredient_code === k).vendor_key), ['v2', 'v2']);
  await E.pg.query(`reset role`); await E.q(`insert into public.vendors values('v9','vendor a co','{"kind":"food"}')`); await E.pg.query(`set role service_role`);
  const vs = (await E.api('tok-gm', { action: 'vendor_seed', apply: true })).body;
  assert.equal(vs.vendors.find(v => v.vendor_key === 'v9').exists, true);
  assert.equal(await rule(E, 'v9'), undefined);
  assert.deepEqual((await E.q(`select vendor_key from invoice_vendor_rules order by vendor_key`)).map(x => x.vendor_key), ['v1', 'v2', 'v3', 'v4', 'v5'], 'the other cards are added as before');
  let r = await un('tok-gm', m1.merge_id);
  assert.deepEqual([r.status, r.body.error], [409, 'later_merge']);
  assert.equal((await un('tok-gm', m2.merge_id)).status, 200);
  assert.deepEqual([await final(E, 'v5'), await final(E, 'v1')], ['v1', 'v1']);
  assert.equal((await one(E, d1.id)).vendor_key, 'v1');
  assert.equal((await un('tok-gm', m1.merge_id)).status, 200);
  assert.deepEqual(await E.q(`select vendor_key, display_name, aliases, food_kind, auto_post, merged_into from invoice_vendor_rules where vendor_key in ('v1','v2','v5') order by vendor_key`),
    rules0.map(x => ({ vendor_key: x.vendor_key, display_name: x.display_name, aliases: x.aliases, food_kind: x.food_kind, auto_post: x.auto_post, merged_into: x.merged_into })));
  // Two merges into the same vendor: the later one first.
  const m3 = (await m('tok-gm', { to: 'VendorA', names: ['Vendor A Co'] })).body, m4 = (await m('tok-gm', { to: 'VendorA', names: ['VendorB'] })).body;
  assert.deepEqual([(await un('tok-gm', m3.merge_id)).body.error, (await un('tok-gm', m4.merge_id)).status, (await un('tok-gm', m3.merge_id)).status], ['later_merge', 200, 200]);

  // The kept vendor called by a new name, with a kind chosen for it: both come back when it is taken back.
  const m5 = await m('tok-office', { to: 'Vendor A Hawaii', names: ['VendorA', 'Vendor A Co'], food_kind: 'nonfood' });
  assert.equal(m5.status, 200, JSON.stringify(m5.body));
  let v1 = await rule(E, 'v1');
  assert.deepEqual([m5.body.target.vendor_key, v1.display_name, v1.aliases, v1.food_kind], ['v1', 'Vendor A Hawaii', ['VENDOR A INC.', 'VendorA', 'Vendor A Co'], 'nonfood']);
  assert.equal((await one(E, d1.id)).vendor_name, 'Vendor A Hawaii'); assert.equal((await one(E, d1.id)).version, d1.version);
  assert.equal(E.drive.items.get(a1).name, name1);
  assert.equal((await un('tok-office', m5.body.merge_id)).status, 200);
  v1 = await rule(E, 'v1');
  assert.deepEqual([v1.display_name, v1.aliases, v1.food_kind], ['VendorA', ['VENDOR A INC.'], 'food']);
  assert.equal((await one(E, d1.id)).vendor_name, 'VendorA');
  await E.pg.close();
});

test('業者の統合 deploy folder: the migration copies are the repository files; the check SQL and the one-file function stay as handed over',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, async () => {
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-vendor-merge-v1083/';
  assert.ok(rd(D + '1_追加のSQL_業者の統合だけ.sql').equals(rd('supabase/migrations/20261022090000_invoice_vendor_merge.sql')));
  assert.ok(rd(D + '1_追加のSQL_段階2と段階3と業者の統合.sql').equals(Buffer.concat([rd('supabase/migrations/20261020090000_invoice_reconciled_folder.sql'), Buffer.from('\n'),
    rd('supabase/migrations/20261021090000_invoice_multi_file.sql'), Buffer.from('\n'), rd('supabase/migrations/20261022090000_invoice_vendor_merge.sql')])));
  // The sources and the check SQL moved on with 新しい業者を決める (deploy/invoice-vendor-register-v1089 is built from the current
  // ones): this folder is what goes in for 業者の統合 alone, and the function to go back to from 新しい業者を決める.
  assert.equal(sha(rd(D + '2_確認のSQL_読むだけ.sql')), '0548d13a42fc5db7efe464ecb474441ed34531c427b4d25dcff46551e417b4e0');
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  assert.equal(src.bundle_sha256, '44e433b15c0a2f90b80b0ac7b62dc2e56ca0575a1195e45f40418c69b442a070');
  assert.deepEqual(Object.keys(src.sources).sort(), ['invoice/dates.mjs', 'invoice/decimal.mjs', 'invoice/dedupe.mjs', 'invoice/drive.mjs', 'invoice/extract.mjs', 'invoice/naming.mjs',
    'invoice/rules.mjs', 'invoice/units.mjs', 'supabase/functions/invoice-intake/handler.mjs', 'supabase/functions/invoice-intake/index.ts']);
  const bundle = rd(D + '3_関数_invoice-intake_index.ts').toString();
  assert.ok(!/^\s*import\s/m.test(bundle) && /Deno\.serve\(createHandler/.test(bundle));
  for (const k of ['invoice_vendor_merge', 'invoice_vendor_unmerge', 'invoice_vendor_usage', 'finalVendor', '!v.merged_into', 'invoice_merge', 'reconciled_month', 'invoice_purchase_publish']) assert.ok(bundle.includes(k), k);
  // The steps name the files in the folder, and the order SQL → check → function → app.
  const steps = rd(D + '手順.md').toString();
  for (const f of ['1_追加のSQL_段階2と段階3と業者の統合.sql', '1_追加のSQL_業者の統合だけ.sql', '2_確認のSQL_読むだけ.sql', '3_関数_invoice-intake_index.ts', 'deploy/invoice-stage3-v1082/3_関数_invoice-intake_index.ts']) assert.ok(steps.includes(f), f);
  assert.ok(steps.indexOf('1_追加のSQL') < steps.indexOf('2_確認のSQL') && steps.indexOf('2_確認のSQL') < steps.indexOf('3_関数') && steps.indexOf('3_関数') < steps.indexOf('v1083 をマージ'));
});

// The check SQL says whether 業者の統合 is in: false on a database with everything before it, true after it (and the counts).
test('業者の統合: the check SQL tells before from after', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => /^\d{14}_invoice_.*\.sql$/.test(f)).sort();
  const S4 = '20261022090000_invoice_vendor_merge.sql';
  // 新しい業者を決める (20261024090000) and 紐づけ (20261025090000) came after it: the database here is the one 業者の統合 went on.
  // 削除した業者を候補にしない (20261101100000, 業者マスター v1121) came after them too.
  assert.deepEqual(files.slice(-7), [S4, '20261024090000_invoice_vendor_register.sql', '20261025090000_invoice_item_link.sql', '20261026090000_invoice_qb_gmail.sql', '20261029100000_invoice_purchase_posted.sql',
    '20261101100000_invoice_vendor_seed_skip_deleted.sql', '20261103090000_invoice_price_compare.sql']);
  const POST = fs.readFileSync(new URL('../db/invoice-intake-postcheck.sql', import.meta.url), 'utf8');
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);`);
    for (const f of files.slice(0, -7)) await pg.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    let post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.vendor_merge, Number(post.tables), Number(post.functions), post.multi_file], [false, 18, 77, true]);
    await pg.exec(fs.readFileSync(new URL(S4, dir), 'utf8'));
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.vendor_merge, Number(post.tables), Number(post.functions), Number(post.browser_can_read), Number(post.browser_can_run), post.multi_file],
      [true, 19, 81, 0, 0, true]);
  } finally { await pg.close(); }
});
