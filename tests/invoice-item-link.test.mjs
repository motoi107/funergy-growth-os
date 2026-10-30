// 紐づけ 段階 1（Moto 2026-10-18・UI案55 決まったこと 1〜8）— the invoice intake side, on synthetic data: real SQL (PGlite), the real
// worker/handler code, and in-memory stand-ins for Google Drive, the AI and mail (the harness of tests/invoice-vendor-register.test.mjs).
// Nothing here reaches production, Drive, QuickBooks or mail. Names, codes and amounts are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';
import { parseResponse } from '../invoice/extract.mjs';
import { evaluate } from '../invoice/rules.mjs';
import { groupItems, relink, itemKey, MAP_REASONS } from '../invoice/link.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const U = { gm: '00000000-0000-4000-8000-0000000000a1', office: '00000000-0000-4000-8000-0000000000a2', crew: '00000000-0000-4000-8000-0000000000a3',
  ceo: '00000000-0000-4000-8000-0000000000a4', other: '00000000-0000-4000-8000-0000000000a5',
  chef: '00000000-0000-4000-8000-0000000000c1', am: '00000000-0000-4000-8000-0000000000c2', left: '00000000-0000-4000-8000-0000000000c3',
  demoted: '00000000-0000-4000-8000-0000000000c4', osoff: '00000000-0000-4000-8000-0000000000c5', off: '00000000-0000-4000-8000-0000000000c6' };
const WORKER_KEY = 'synthetic-worker-key-0123456789';

class FakeDrive {
  constructor() { this.items = new Map(); this.n = 0; }
  folder(id, name, parent) { this.items.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : [], trashed: false }); return id; }
  file(name, bytes, parent, { created = '2026-10-06T19:00:00Z' } = {}) {
    const id = 'f' + (++this.n), b = Buffer.from(bytes);
    this.items.set(id, { id, name, mimeType: 'application/pdf', parents: [parent], trashed: false, bytes: b, size: String(b.length),
      md5Checksum: crypto.createHash('md5').update(b).digest('hex'), createdTime: created, modifiedTime: created, owners: [] });
    return id;
  }
  meta(f) { const { bytes, ...m } = f; return m; }
  async listFolder(folderId, pageToken, opts) {
    const after = opts && opts.createdAfter ? Date.parse(opts.createdAfter) : null;
    const all = [...this.items.values()].filter(f => f.parents.includes(folderId) && !f.trashed && !f.mimeType.includes('folder')
      && (after == null || Date.parse(f.createdTime) >= after));
    const start = pageToken ? Number(pageToken) : 0;
    return { files: all.slice(start, start + 2).map(f => this.meta(f)), next: start + 2 < all.length ? String(start + 2) : null };
  }
  async get(id) { const f = this.items.get(id); return f ? { status: 200, file: this.meta(f) } : { status: 404, file: null }; }
  async download(id) { return new Uint8Array(this.items.get(id).bytes); }
  async update(id, { name, addParents, removeParents }) {
    const f = this.items.get(id);
    if (name) f.name = name;
    if (removeParents) f.parents = f.parents.filter(p => !removeParents.split(',').includes(p));
    if (addParents) f.parents.push(addParents);
    return this.meta(f);
  }
  async findFolders(parent, name) { return [...this.items.values()].filter(f => f.mimeType.includes('folder') && f.parents.includes(parent) && f.name === name && !f.trashed).map(f => ({ id: f.id, name: f.name })); }
  async createFolder(parent, name) { const id = 'd' + (++this.n); this.folder(id, name, parent); return { id, name }; }
  async listNames(folder) { return [...this.items.values()].filter(f => f.parents.includes(folder) && !f.trashed).map(f => ({ id: f.id, name: f.name })); }
}

const pdf = tag => '%PDF-1.4\n<< /Type /Page >>\n' + tag + '\n%%EOF';
function doc(no, date, lines, { vendor = 'Vendor A Inc.' } = {}) {
  const sum = lines.reduce((a, l) => a + Math.round(Number(l[4]) * 100), 0);
  return { doc_type: 'invoice', pages: [1], pages_marked: ['Page 1 of 1'], vendor_name: vendor, ship_to: 'LaLa Izakaya, 100 Test Street', invoice_number: no,
    invoice_date_text: `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`, invoice_date: date, delivery_date_text: null, delivery_date: null,
    currency: 'USD', subtotal: (sum / 100).toFixed(2), tax: '0.00', total: (sum / 100).toFixed(2), references: [],
    lines: lines.map(([code, name, qty, price, amount, unit = 'CS', pack = null]) => ({ page: 1, item_code: code, description: name, qty, unit, pack, unit_price: price, amount })) };
}
// The made-up invoices' lines: an item with the vendor's code, one printed without a code (name + pack), a catch-weight one.
const AVO = ['07777', 'AVOCADO 48S', '2', '30.00', '60.00', 'CS', '48 CT'];
const GLOVE = [null, 'Gloves Nitrile  L', '1', '12.00', '12.00', 'BX', '10/100'];
const TUNA = ['05555', 'AHI LOIN', '1', '9.50', '47.50', 'CS', null];   // priced per LB (catch weight): never price history

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.vendors(id text primary key, name text, data jsonb); grant select on public.vendors to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    create table public.employees(id text primary key, name text, role text, title text, status text, data jsonb); grant select on public.employees to service_role;
    insert into public.ingredients values
     ('10003','アボカド','pc','Ala Moana',1,'{"name":"アボカド","nameEN":"Avocado","cat":"10000"}'),
     ('600154','アサヒ 生ビール 樽','EA','Wismettac',1,'{"name":"アサヒ 生ビール 樽","nameEN":"Asahi Draft Keg","cat":"20000"}'),
     ('40001','手袋','BX','VendorA',1,'{"name":"手袋","nameEN":"Gloves","cat":"40000"}'),
     ('50067','マグロ','g','Maguro',1,'{"name":"マグロ","nameEN":"Ahi","cat":"10000"}');
    insert into public.employees values
     ('E-OF','Office Person','office','Accounting','在籍','{}'),('E-CH','Kai Test','chef','Head Chef','在籍','{}'),('E-AM','Lani Test','am','Area Manager','在籍','{}'),
     ('E-LEFT','Left Chef','chef','Head Chef','退職','{}'),('E-CREW','Was AM','crew','Server','在籍','{}'),('E-OS','Os Off','chef','Head Chef','在籍','{"osDisabled":true}'),
     ('E-OFF','Disabled Row','am','Area Manager','在籍','{}');`);
  for (const [k, r, e] of [['gm', 'gm', null], ['office', 'office', 'E-OF'], ['crew', 'office_crew', null], ['ceo', 'ceo', null]]) await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  await pg.query(`insert into invoice_link_members(user_id, emp_id, role, enabled) values ($1,'E-CH','chef',true),($2,'E-AM','am',true),($3,'E-LEFT','chef',true),
    ($4,'E-CREW','am',true),($5,'E-OS','chef',true),($6,'E-OFF','am',false)`, [U.chef, U.am, U.left, U.demoted, U.osoff, U.off]);
  await pg.query(`update invoice_settings set value=jsonb_build_object('key',$1::text,'enabled',true) where key='worker'`, [WORKER_KEY]);
  await pg.exec(`
    update invoice_settings set value=value||'{"intake":true,"auto_post":true,"organize":false,"mirror":false,"start_at":"2026-10-01T00:00:00Z"}' where key='mode';
    update invoice_settings set value=value||'{"currency_when_absent":"USD","closed_through":"2026-08","batch":10}' where key='rules';
    insert into invoice_stores(store_id,label,root_folder_id,upload_folder_id,active,auto_post,aliases) values
     ('F06','LaLa','R6','U6',true,true,'{"LaLa Izakaya","100 Test Street"}');
    insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post) values
     ('v1','VendorA','{"VENDOR A INC."}','food',true),('v2','VendorB','{}','food',false),('v3','Supply Co','{}','nonfood',false);`);
  await pg.exec('set role service_role');
  const hooks = {};
  const db = { async rpc(name, p) {
    if (hooks[name]) { const h = hooks[name]; delete hooks[name]; await h(); }   // once: another operation just before this call
    const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const drive = new FakeDrive();
  drive.folder('R6', 'LaLa', 'INV'); drive.folder('U6', '00_Upload', 'R6');
  const fixtures = new Map();
  const ai = async parts => {
    const key = Buffer.from(parts[0].base64, 'base64').toString('latin1');
    const fx = [...fixtures.entries()].filter(([tag]) => key.includes(tag)).sort((x, y) => y[0].length - x[0].length)[0];
    if (!fx) return { ok: true, readable: false, reason: 'unreadable', documents: [] };
    return { ...parseResponse(JSON.stringify(fx[1])), model: 'synthetic' };
  };
  const users = { 'tok-gm': U.gm, 'tok-office': U.office, 'tok-crew': U.crew, 'tok-ceo': U.ceo, 'tok-other': U.other, 'tok-chef': U.chef, 'tok-am': U.am,
    'tok-left': U.left, 'tok-demoted': U.demoted, 'tok-osoff': U.osoff, 'tok-off': U.off };
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, fetch, db, drive, ai, mailer: null, now: () => Date.parse('2026-10-06T20:00:00Z') });
  const call = async (body, headers = {}) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const api = (tok, body) => call(body, tok ? { authorization: 'Bearer ' + tok } : {});
  const q = async (sql, p = []) => (await pg.query(sql, p)).rows;
  const read = async list => {
    const F = {};
    for (const [tag, no, date, lines, vendor, over] of list) {
      fixtures.set(tag, { readable: true, documents: [{ ...doc(no, date, lines, { vendor }), ...(over || {}) }] });
      F[tag] = drive.file(tag + '.pdf', pdf(tag), 'U6');
    }
    const w = await call({ action: 'worker' }, { 'x-invoice-worker-key': WORKER_KEY });
    assert.equal(w.body.ok, true, JSON.stringify(w.body));
    const D = {};
    for (const tag of Object.keys(F)) D[tag] = (await q(`select d.* from invoice_docs d join invoice_files f on f.id=d.file_id where f.drive_file_id=$1`, [F[tag]]))[0];
    return D;
  };
  return { pg, db, api, q, read, hooks };
}
// The vendor's links in use as invoice_link_apply works them out (ids and versions)
const fpOf = async (E, vk) => (await E.q(`select encode(sha256(convert_to(coalesce(string_agg(m.id::text || ':' || m.version, ',' order by m.id::text collate "C"), ''), 'UTF8')), 'hex') fp
  from invoice_item_maps m where m.vendor_key=$1 and m.retired_at is null`, [vk]))[0].fp;

const linesOf = (E, docId) => E.q(`select * from invoice_lines where doc_id=$1 order by line_no`, [docId]);
const docOf = async (E, id) => (await E.q(`select * from invoice_docs where id=$1`, [id]))[0];
const prices = (E, code) => E.q(`select h.*, l.doc_id from invoice_price_history h join invoice_lines l on l.id=h.line_id where h.ingredient_code=$1 order by h.id`, [code]);
const itemOf = (data, id) => data.items.find(i => i.id === id);
const AVO_ID = 'v1|c:07777', GLOVE_ID = 'v1|a:gloves nitrile l|10/100';
const strip = rs => (rs || []).filter(c => c !== 'no_price_ref' && c !== 'price_jump').sort();

test('紐づけ: link an item; the lines already in (posted and to check) follow at once; a later invoice is linked by the intake the same way', async () => {
  const E = await setup();
  // Posted automatically (vendor, store and switch on, only reasons for reference): the unmapped lines never stopped it.
  const A = await E.read([['A-1', '7001', '2026-10-02', [AVO, GLOVE]]]);
  assert.equal(A['A-1'].status, 'posted');
  for (const l of await linesOf(E, A['A-1'].id)) assert.deepEqual([l.map_id, l.ingredient_code, l.reasons.includes('unmapped')], [null, null, true]);
  await E.q(`update invoice_settings set value=value||'{"auto_post":false}' where key='mode'`);
  const B = await E.read([['A-2', '7002', '2026-10-05', [AVO, GLOVE]]]);
  assert.equal(B['A-2'].status, 'review');
  const before = { a: await docOf(E, A['A-1'].id), b: await docOf(E, B['A-2'].id) };

  // The screen (a Head Chef): the items, keyed as the intake looks a line up.
  let r = await E.api('tok-chef', { action: 'link_data' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, 'chef');
  let it = itemOf(r.body, AVO_ID);
  assert.deepEqual([it.n, it.posted, it.review, it.link, it.links, it.stores, it.names[0], it.last_price.unit_price], [2, 1, 1, null, 0, ['F06'], ['AVOCADO 48S', 2], '30.000000']);
  assert.ok(itemOf(r.body, GLOVE_ID), 'the line printed without a code is an item by its name and pack');

  // Link it (a Head Chef may: decision 5).
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const map = r.body.maps[0];
  assert.deepEqual([map.vendor_item_code, map.alias_key, map.spec_key, map.purchase_unit, map.ingredient_code, map.verified, map.source, map.verified_by, map.auto_post, map.retired_at],
    ['07777', null, '', '', '10003', true, 'review', U.chef, false, null]);
  assert.deepEqual([r.body.sync.lines, r.body.sync.prices, r.body.sync.voided, r.body.sync.skipped], [2, 1, 0, 0]);
  assert.deepEqual(r.body.sync.months, ['2026-10']);
  for (const d of [A['A-1'], B['A-2']]) {
    const [l] = await linesOf(E, d.id);
    assert.deepEqual([l.map_id, l.ingredient_code, Number(l.price_per_purchase), l.reasons.includes('unmapped'), l.reasons.includes('mode_review_item')],
      [map.id, '10003', 30, false, true], d.invoice_no);
    const x = await docOf(E, d.id);
    // only the reasons about the link moved; amounts, version, status and the rest stay
    assert.deepEqual([x.version, x.status, x.total_cents, x.posted_at, x.recon_status], [before[d.id === A['A-1'].id ? 'a' : 'b'].version, d.status, d.total_cents, d.posted_at, d.recon_status]);
    assert.ok(!x.reasons.some(z => z.code === 'unmapped' && z.line_no === 1) && x.reasons.some(z => z.code === 'mode_review_item' && z.line_no === 1));
    assert.ok(x.reasons.some(z => z.code === 'unmapped' && z.line_no === 2), 'the other item is still not linked');
  }
  // The posted line is price history now; the latest price is under the current code.
  let P = await prices(E, '10003');
  assert.deepEqual(P.map(p => [p.doc_id, p.status, Number(p.price_per_purchase), p.created_by, p.reason, p.purchase_unit]), [[A['A-1'].id, 'active', 30, U.chef, 'link', 'CS']]);
  const lp = await E.api('tok-office', { action: 'latest_prices', codes: ['10003'] });
  assert.deepEqual(lp.body.map(x => [x.ingredient_code, x.price_per_purchase, x.vendor_key]), [['10003', '30.000000', 'v1']]);
  assert.equal((await E.q(`select count(*)::int n from invoice_events where kind='map_linked'`))[0].n, 1);
  assert.equal((await E.q(`select count(*)::int n from invoice_events where kind='link_applied'`))[0].n, 2);

  // Posting the one to check gives its price history as it always did.
  const bd = await docOf(E, B['A-2'].id);
  const p = await E.api('tok-office', { action: 'post', doc_id: bd.id, version: bd.version, reason: '確認した' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  P = await prices(E, '10003');
  assert.deepEqual(P.filter(x => x.status === 'active').map(x => x.doc_id).sort(), [A['A-1'].id, B['A-2'].id].sort());

  // A later invoice: the intake links it by itself, to the same values as the lines that followed the link.
  const C = await E.read([['A-3', '7003', '2026-10-06', [AVO, GLOVE]]]);
  const [lc] = await linesOf(E, C['A-3'].id), [la] = await linesOf(E, A['A-1'].id);
  for (const f of ['map_id', 'ingredient_code', 'count_unit', 'count_per_purchase', 'base_unit', 'base_per_purchase', 'price_per_purchase', 'price_per_count', 'price_per_base'])
    assert.deepEqual(lc[f], la[f], f);
  assert.deepEqual(strip(lc.reasons), strip(la.reasons));
  const data = await E.api('tok-am', { action: 'link_data' });
  it = itemOf(data.body, AVO_ID);
  assert.deepEqual([it.n, it.link.id, it.link.ingredient_code, it.applied, it.waiting], [3, map.id, '10003', 3, 0]);
  await E.pg.close();
});

test('紐づけ: take a link back (the lines lose the code, the prices are voided); link it again (the same row); link it to another code', async () => {
  const E = await setup();
  const A = await E.read([['B-1', '8001', '2026-10-02', [AVO]]]);
  await E.q(`update invoice_settings set value=value||'{"auto_post":false}' where key='mode'`);
  const B = await E.read([['B-2', '8002', '2026-10-03', [AVO]]]);
  let r = await E.api('tok-am', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  const m1 = r.body.maps[0];
  r = await E.api('tok-am', { action: 'link_undo', maps: [{ id: m1.id, version: m1.version }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.maps[0].retired_by, !!r.body.maps[0].retired_at, r.body.sync.lines, r.body.sync.voided, r.body.sync.prices], [U.am, true, 2, 1, 0]);
  for (const d of [A['B-1'], B['B-2']]) {
    const [l] = await linesOf(E, d.id);
    assert.deepEqual([l.map_id, l.ingredient_code, l.price_per_purchase, l.reasons.includes('unmapped'), l.reasons.includes('mode_review_item')], [null, null, null, true, false]);
    assert.ok((await docOf(E, d.id)).reasons.some(z => z.code === 'unmapped' && z.line_no === 1));
  }
  assert.deepEqual((await prices(E, '10003')).map(x => [x.status, x.void_reason]), [['voided', 'link']]);
  assert.deepEqual((await E.api('tok-office', { action: 'latest_prices', codes: ['10003'] })).body, []);
  // A link taken back is not used by the intake.
  const C = await E.read([['B-3', '8003', '2026-10-04', [AVO]]]);
  assert.equal((await linesOf(E, C['B-3'].id))[0].map_id, null);
  let data = (await E.api('tok-am', { action: 'link_data' })).body;
  let it = itemOf(data, AVO_ID);
  assert.deepEqual([it.link, it.retired.length, it.retired[0].ingredient_code], [null, 1, '10003']);

  // Linked again: the same row (the mapping table keeps one row per item), and all three invoices follow.
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m2 = r.body.maps[0];
  assert.deepEqual([m2.id, m2.version, m2.retired_at, m2.verified_by], [m1.id, m1.version + 2, null, U.chef]);
  assert.deepEqual([r.body.sync.lines, r.body.sync.prices], [3, 1]);
  assert.deepEqual((await prices(E, '10003')).map(x => x.status), ['voided', 'active']);

  // Linked to another code (the screen showed the link: id and version): the lines keep the link with the new code.
  r = await E.api('tok-am', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '50067', map_id: m2.id, version: m2.version }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.maps[0].id, r.body.maps[0].ingredient_code, r.body.sync.lines, r.body.sync.voided, r.body.sync.prices], [m1.id, '50067', 3, 1, 1]);
  for (const d of [A['B-1'], B['B-2'], C['B-3']]) assert.equal((await linesOf(E, d.id))[0].ingredient_code, '50067');
  assert.deepEqual((await prices(E, '10003')).map(x => x.status), ['voided', 'voided']);
  assert.deepEqual((await prices(E, '50067')).map(x => [x.status, x.doc_id]), [['active', A['B-1'].id]]);
  data = (await E.api('tok-am', { action: 'link_data' })).body;
  it = itemOf(data, AVO_ID);
  assert.deepEqual([it.link.ingredient_code, it.applied, it.waiting, it.retired.length], ['50067', 3, 0, 0]);
  await E.pg.close();
});

test('紐づけ: who may (accounting, 事務Crew, GM, CEO, Head Chef and AM accounts still in the role); Head Chef / AM get nothing else of the intake', async () => {
  const E = await setup();
  await E.read([['C-1', '9001', '2026-10-02', [AVO, GLOVE]]]);
  await E.q(`update invoice_settings set value=value||'{"auto_post":false}' where key='mode'`);
  const C = await E.read([['C-2', '9002', '2026-10-03', [AVO]]]);
  for (const tok of ['tok-office', 'tok-crew', 'tok-gm', 'tok-ceo', 'tok-chef', 'tok-am']) {
    const r = await E.api(tok, { action: 'link_data' });
    assert.equal(r.status, 200, tok + JSON.stringify(r.body));
  }
  const who = await E.api('tok-chef', { action: 'link_whoami' });
  assert.deepEqual(who.body, { role: 'chef', emp_id: 'E-CH' });
  assert.deepEqual((await E.api('tok-office', { action: 'link_whoami' })).body, { role: 'office', emp_id: 'E-OF' });
  // 退職, no longer a Head Chef / AM, OS turned off, the row disabled, no row: refused (the employee master takes access away).
  for (const tok of ['tok-left', 'tok-demoted', 'tok-osoff', 'tok-off', 'tok-other']) {
    for (const body of [{ action: 'link_data' }, { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] },
      { action: 'link_mark', marks: [{ vendor_key: 'v1', vendor_item_code: '07777', state: 'excluded' }] }, { action: 'link_sync' }]) {
      const r = await E.api(tok, body);
      assert.equal(r.status, 403, tok + ' ' + body.action + JSON.stringify(r.body));
    }
    assert.deepEqual((await E.api(tok, { action: 'link_whoami' })).body, { role: null, emp_id: null });
  }
  assert.equal((await E.api(null, { action: 'link_data' })).status, 401);
  // The two Head Chef / AM accounts: nothing else of the intake.
  const d = await docOf(E, C['C-2'].id);
  assert.equal(d.status, 'review');
  for (const tok of ['tok-chef', 'tok-am']) {
    for (const body of [{ action: 'list' }, { action: 'config' }, { action: 'health' }, { action: 'get', doc_id: d.id }, { action: 'post', doc_id: d.id, version: d.version, reason: 'x' },
      { action: 'map_save', map: { vendor_key: 'v1', vendor_item_code: 'X', ingredient_code: '10003', verified: true } }, { action: 'latest_prices', codes: ['10003'] },
      { action: 'vendor_register', vendor: { vendor_key: 'v9', display_name: 'X', food_kind: 'food' } }, { action: 'settings_save', key: 'mode', value: {} }]) {
      const r = await E.api(tok, body);
      assert.equal(r.status, 403, tok + ' ' + body.action + JSON.stringify(r.body));
    }
  }
  await E.pg.close();
});

test('紐づけ: an out-of-date screen, an unknown code, a merged vendor and bad values change nothing; a Head Chef / AM leaves accounting\'s own mappings as they are', async () => {
  const E = await setup();
  await E.read([['D-1', '9101', '2026-10-02', [AVO, GLOVE]]]);
  const snap = async () => ({ maps: await E.q(`select * from invoice_item_maps order by id`), lines: await E.q(`select id, map_id, ingredient_code, reasons from invoice_lines order by id`),
    marks: await E.q(`select * from invoice_link_marks order by id`) });
  const before = await snap();
  const save = (tok, links) => E.api(tok, { action: 'link_save', links });
  assert.equal((await save('tok-office', [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '99999' }])).body.error, 'unknown_ingredient');
  await E.q(`insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post,merged_into) values('v8','Old A','{}','food',false,'v1')`);
  assert.equal((await save('tok-office', [{ vendor_key: 'v8', vendor_item_code: '07777', ingredient_code: '10003' }])).status, 409);
  assert.equal((await save('tok-office', [{ vendor_key: 'v404', vendor_item_code: '07777', ingredient_code: '10003' }])).status, 404);
  for (const links of [[], [{ vendor_key: 'v1', ingredient_code: '10003' }], [{ vendor_key: 'v1', vendor_item_code: '07777', alias_key: 'x', ingredient_code: '10003' }],
    [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '' }], [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003', map_id: 'x', version: 1 }],
    [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003', map_id: '00000000-0000-4000-8000-000000000001' }],
    Array.from({ length: 301 }, () => ({ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' })), 'x']) {
    const r = await save('tok-office', links);
    assert.equal(r.status, 400, JSON.stringify([links, r.body]).slice(0, 200));
  }
  assert.deepEqual(await snap(), before, 'nothing changed');
  // Two screens: the second one did not see the first one's link.
  assert.equal((await save('tok-chef', [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }])).status, 200);
  const r2 = await save('tok-am', [{ vendor_key: 'v1', vendor_item_code: ' 07777 ', ingredient_code: '50067' }]);
  assert.deepEqual([r2.status, r2.body.error], [409, 'conflict'], 'the same item code written another way is the same item');
  const m = (await E.q(`select * from invoice_item_maps where vendor_item_code='07777'`))[0];
  assert.equal((await save('tok-am', [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '50067', map_id: m.id, version: m.version + 5 }])).status, 409);
  assert.equal((await E.api('tok-am', { action: 'link_undo', maps: [{ id: m.id, version: m.version + 1 }] })).status, 409);
  // A whole call is one transaction: one bad link in it and nothing of it is saved.
  const bad = await save('tok-office', [{ vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', ingredient_code: '40001' },
    { vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }]);
  assert.equal(bad.status, 409);
  assert.equal((await E.q(`select count(*)::int n from invoice_item_maps where alias_key='gloves nitrile l'`))[0].n, 0);

  // Accounting's own verified mapping (from the invoice screen): a Head Chef / AM cannot change it or take it back; accounting can.
  const own = await E.api('tok-office', { action: 'map_save', map: { vendor_key: 'v1', store_id: null, vendor_item_code: '05555', alias_key: null, spec_key: '', purchase_unit: '',
    ingredient_code: '50067', verified: true, auto_post: false, source: 'manual' } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  for (const tok of ['tok-chef', 'tok-am']) {
    assert.equal((await save(tok, [{ vendor_key: 'v1', vendor_item_code: '05555', ingredient_code: '10003', map_id: own.body.id, version: own.body.version }])).status, 403);
    assert.equal((await E.api(tok, { action: 'link_undo', maps: [{ id: own.body.id, version: own.body.version }] })).status, 403);
  }
  const ok = await save('tok-office', [{ vendor_key: 'v1', vendor_item_code: '05555', ingredient_code: '10003', map_id: own.body.id, version: own.body.version }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // ...and a link it made, the Head Chef / AM may take back.
  const after = (await E.q(`select * from invoice_item_maps where id=$1`, [own.body.id]))[0];
  assert.equal(after.source, 'review');
  assert.equal((await E.api('tok-chef', { action: 'link_undo', maps: [{ id: after.id, version: after.version }] })).status, 200);
  // Accounting's own mapping screen uses a taken-back row again (no error on the same key).
  const again = await E.api('tok-office', { action: 'map_save', map: { vendor_key: 'v1', store_id: null, vendor_item_code: '05555', alias_key: null, spec_key: '', purchase_unit: '',
    ingredient_code: '50067', verified: false, auto_post: false, source: 'manual' } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual([again.body.id, again.body.retired_at, again.body.ingredient_code, again.body.verified], [own.body.id, null, '50067', false]);
  // ...but not by its id (the screen had it before it was taken back): taken-back rows change only by linking again.
  await E.api('tok-office', { action: 'link_undo', maps: [{ id: again.body.id, version: again.body.version }] });
  const ret = (await E.q(`select * from invoice_item_maps where id=$1`, [own.body.id]))[0];
  assert.equal((await E.api('tok-office', { action: 'map_save', map: { id: ret.id, version: ret.version, ingredient_code: '50067', verified: true } })).status, 409);
  await E.pg.close();
});

test('紐づけ: marks (対象外・新しい品目・あとで・戻す) with versions; a non-food vendor\'s items are shown as left out', async () => {
  const E = await setup();
  await E.read([['M-1', '9201', '2026-10-02', [AVO, GLOVE]], ['M-2', '9202', '2026-10-02', [['77', 'PAPER TOWEL', '1', '20.00', '20.00', 'CS', null]], 'Supply Co']]);
  const mark = (tok, x) => E.api(tok, { action: 'link_mark', marks: [x] });
  let r = await mark('tok-chef', { vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', state: 'excluded', note: '消耗品' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = r.body.marks[0];
  assert.deepEqual([k.state, k.version, k.by_role, k.by_actor, k.note], ['excluded', 1, 'chef', U.chef, '消耗品']);
  assert.equal((await mark('tok-am', { vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', state: 'new_item' })).status, 409, 'the screen did not see the mark');
  r = await mark('tok-am', { vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', state: 'new_item', version: 1 });
  assert.equal(r.body.marks[0].version, 2);
  r = await mark('tok-am', { vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', state: 'none', version: 2 });
  let data = (await E.api('tok-am', { action: 'link_data' })).body;
  assert.deepEqual([itemOf(data, GLOVE_ID).mark, itemOf(data, GLOVE_ID).mark_version], [null, null], 'a cleared mark is no mark');
  // cleared: a screen that saw no mark may mark it again
  assert.equal((await mark('tok-am', { vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', state: 'later' })).status, 200);
  // a non-food vendor's item: the screen gets the vendor's kind (left out at first, decision 6); 'included' takes it back in
  const sup = data.items.find(i => i.vendor_key === 'v3');
  assert.equal(data.vendors.find(v => v.vendor_key === 'v3').food_kind, 'nonfood');
  r = await mark('tok-office', { vendor_key: 'v3', vendor_item_code: sup.vendor_item_code, state: 'included' });
  assert.equal(r.status, 200);
  data = (await E.api('tok-am', { action: 'link_data' })).body;
  assert.equal(data.items.find(i => i.vendor_key === 'v3').mark.state, 'included');
  for (const x of [{ vendor_key: 'v1', alias_key: 'x', state: 'gone' }, { vendor_key: 'v1', state: 'excluded' }, { vendor_key: 'v404', alias_key: 'x', state: 'excluded' }]) {
    const b = await mark('tok-office', x);
    assert.ok([400, 404].includes(b.status), JSON.stringify(b.body));
  }
  await E.pg.close();
});

test('紐づけ: invoice_link_apply only moves the link and its reasons; a line changed meanwhile, a link taken back and other states are passed over', async () => {
  const E = await setup();
  const A = await E.read([['E-1', '9301', '2026-10-02', [['06666', 'LIME', '2', '30.00', '59.00', 'CS', null]]], ['E-2', '9302', '2026-10-03', [['06666', 'LIME', '1', '30.00', '30.00', 'CS', null]]]]);
  const r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '06666', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  const [l] = await linesOf(E, A['E-1'].id), [l2] = await linesOf(E, A['E-2'].id);
  assert.ok(l.reasons.includes('line_math') && l.map_id === m.id && l2.map_id === m.id, JSON.stringify(l.reasons));
  const read = (await E.db.rpc('invoice_link_lines', { actor: U.office })).find(x => x.id === l.id);
  const base = { line_id: l.id, from_map: m.id, unit_price: read.unit_price, purchase_unit: read.purchase_unit, map_id: m.id, ingredient_code: '10003', count_unit: null,
    count_per_purchase: null, base_unit: null, base_per_purchase: null, price_per_count: null, price_per_base: null, reasons: l.reasons, maps_fp: await fpOf(E, 'v1') };
  // the function's own fingerprint is the database's (the same ids and versions)
  const crypto2 = await import('node:crypto');
  const mine = crypto2.createHash('sha256').update((await E.q(`select id::text, version from invoice_item_maps where vendor_key='v1' and retired_at is null`))
    .map(x => x.id + ':' + x.version).sort().join(',')).digest('hex');
  assert.equal(mine, base.maps_fp);
  // links changed since the update was worked out (another fingerprint): passed over
  let x0 = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, map_id: null, ingredient_code: null, reasons: [...l.reasons.filter(c => !MAP_REASONS.includes(c)), 'unmapped'], maps_fp: 'x' }] });
  assert.deepEqual([x0.lines, x0.skipped], [0, 1]);
  const read2 = (await E.db.rpc('invoice_link_lines', { actor: U.office })).find(x => x.id === l2.id);
  const off2 = { ...base, line_id: l2.id, unit_price: read2.unit_price, purchase_unit: read2.purchase_unit, map_id: null, ingredient_code: null,
    reasons: [...l2.reasons.filter(c => !MAP_REASONS.includes(c)), 'unmapped'] };
  // another reason than the link's changed meanwhile (a correction): that line is passed over, the others in the call are done (review P2-2)
  let x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, map_id: null, ingredient_code: null, reasons: ['unmapped'] }, off2] });
  assert.deepEqual([x.lines, x.skipped], [1, 1]);
  assert.deepEqual([(await linesOf(E, A['E-1'].id))[0].map_id, (await linesOf(E, A['E-2'].id))[0].map_id], [m.id, null]);
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, reasons: [...l.reasons, 'total_mismatch'] }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  // the unit price or the purchase unit changed since it was read: passed over (the prices per unit were worked out from the old one)
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, unit_price: '31.000000' }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, purchase_unit: 'EA' }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  await assert.rejects(E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, reasons: 'unmapped' }] }), /bad_value/);
  await assert.rejects(E.db.rpc('invoice_link_apply', { actor: U.other, updates: [] }), /forbidden/);
  // from_map not what the line has now: passed over (the rest of the update is one the line could take)
  const offL = [...l.reasons.filter(c => !MAP_REASONS.includes(c)), 'unmapped'];
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, from_map: null, map_id: null, ingredient_code: null, reasons: offL }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  // a code that is not the link's, a link taken back, a superseded invoice: passed over
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, ingredient_code: '50067' }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  await E.q(`update invoice_item_maps set retired_at=now() where id=$1`, [m.id]);
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, maps_fp: await fpOf(E, 'v1') }] });   // worked out with the links as they are now
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  await E.q(`update invoice_item_maps set retired_at=null where id=$1`, [m.id]);
  await E.q(`update invoice_docs set status='superseded' where id=$1`, [A['E-1'].id]);
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, from_map: m.id, map_id: null, ingredient_code: null, reasons: ['unmapped'] }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  assert.deepEqual((await linesOf(E, A['E-1'].id))[0].map_id, m.id, 'unchanged');
  await E.pg.close();
});

test('紐づけ: そろえる brings in lines taken in before a link (the link written without the function); the purchase summary follows (open months)', async () => {
  const E = await setup();
  const A = await E.read([['F-1', '9401', '2026-10-02', [AVO, GLOVE]]]);
  const sumBefore = (await E.q(`select value from app_state where key='invoice_purchase_2026-10'`))[0];
  // A link saved by the database alone (as if the function stopped before the lines followed).
  await E.db.rpc('invoice_link_save', { actor: U.office, links: [{ vendor_key: 'v1', alias_key: 'gloves nitrile l', spec_key: '10/100', ingredient_code: '40001' }] });
  assert.equal((await linesOf(E, A['F-1'].id))[1].map_id, null);
  let data = (await E.api('tok-chef', { action: 'link_data' })).body;
  assert.deepEqual([itemOf(data, GLOVE_ID).applied, itemOf(data, GLOVE_ID).waiting], [0, 1], 'the screen shows lines waiting');
  const r = await E.api('tok-chef', { action: 'link_sync' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.sync.lines, r.body.sync.prices, r.body.summary], [1, 1, true]);
  assert.equal((await linesOf(E, A['F-1'].id))[1].ingredient_code, '40001');
  data = (await E.api('tok-chef', { action: 'link_data' })).body;
  assert.deepEqual([itemOf(data, GLOVE_ID).applied, itemOf(data, GLOVE_ID).waiting], [1, 0]);
  // run again: nothing to do
  assert.deepEqual((await E.api('tok-chef', { action: 'link_sync' })).body.sync.lines, 0);
  // The gloves are a supply in the current master (category 40000): the month's purchase summary counts them as supplies now (the
  // vendor is food; before the link they were counted by the vendor's class).
  const sum = async () => (await E.q(`select value from app_state where key='invoice_purchase_2026-10'`))[0].value.stores.F06;
  const lines = async () => (await E.q(`select value from app_state where key='invoice_purchase_lines_2026-10_F06'`))[0].value.docs[A['F-1'].id].l;
  assert.deepEqual(sumBefore.value.stores.F06.docs[0].cls, { food: 7200, liquor: 0, supply: 0, nonfood: 0, beverage: 0 });
  assert.deepEqual((await sum()).docs[0].cls, { food: 6000, liquor: 0, supply: 1200, nonfood: 0, beverage: 0 });
  assert.deepEqual((await lines()).map(x => [x[6], x[7], x[8]]), [['food', 'v', null], ['supply', 'm', '40001']]);
  // A closed month stays as it was written when it was closed (the links are not what it is kept by).
  await E.q(`update invoice_settings set value=value||'{"closed_through":"2026-10"}' where key='rules'`);
  await E.db.rpc('invoice_purchase_publish', {});
  const closed = await sum();
  const k = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '600154' }] });
  assert.deepEqual([k.status, k.body.sync.lines, k.body.sync.prices], [200, 1, 1], 'the line and its price follow (prices are not the closed month\'s purchases)');
  assert.deepEqual(await sum(), closed, 'the closed month did not move');
  assert.deepEqual((await lines()).map(x => x[8]), [null, '40001']);
  await E.pg.close();
});

// The link step of invoice/link.mjs is the intake's own (rules.mjs evaluate): on made-up lines and links, a line linked afterwards is the
// line the intake writes when the link is there first (apart from the price comparison, which is for reference).
test('紐づけ: relink gives what the intake gives (rules.mjs evaluate), for every kind of link', async () => {
  const ext = lines => ({ doc_type: 'invoice', vendor_name: 'VendorA', ship_to: 'LaLa Izakaya', invoice_number: '1', invoice_date_text: '10/02/2026', invoice_date: '2026-10-02',
    currency: 'USD', subtotal: null, total: '100.00', lines });
  const vendors = [{ vendor_key: 'v1', display_name: 'VendorA', aliases: [], food_kind: 'food', auto_post: true }];
  const store = { store_id: 'F06', auto_post: true, aliases: ['LaLa Izakaya'] };
  const L = [
    { item_code: '07777', description: 'AVOCADO 48S', qty: '2', unit: 'CS', pack: '48 CT', unit_price: '30.00', amount: '60.00' },
    { item_code: null, description: 'Gloves Nitrile L', qty: '1', unit: 'BX', pack: '10/100', unit_price: '12.00', amount: '12.00' },
    { item_code: '01111', description: 'SAKE 6/1.8L', qty: '1', unit: 'CS', pack: '6/1.8L', unit_price: '60.00', amount: '60.00' },
    { item_code: '01111', description: 'SAKE 6/1.8L', qty: '1', unit: 'EA', pack: '6/1.8L', unit_price: '10.00', amount: '10.00' },
    { item_code: '02222', description: 'MISO 12/500G', qty: '1', unit: 'CS', pack: '12/400G', unit_price: '24.00', amount: '24.00' },
    { item_code: null, description: 'gloves  nitrile l', qty: '1', unit: 'BX', pack: '10/200', unit_price: '12.00', amount: '12.00' },
    { item_code: '03333', description: 'NORI 10/50', qty: '1', unit: 'CS', pack: '10/50', unit_price: '40.00', amount: '40.00' },
    { item_code: '04444', description: 'KIWI', qty: '2', unit: null, pack: null, unit_price: '30.00', amount: '60.00' },
  ];
  const maps = [
    { id: 'm1', vendor_key: 'v1', vendor_item_code: '07777', alias_key: null, spec_key: '', purchase_unit: '', ingredient_code: '10003', verified: true, auto_post: false },
    { id: 'm2', vendor_key: 'v1', vendor_item_code: null, alias_key: 'gloves nitrile l', spec_key: '10/100', purchase_unit: '', ingredient_code: '40001', verified: false, auto_post: false },
    { id: 'm3', vendor_key: 'v1', vendor_item_code: '01111', alias_key: null, spec_key: '6/1.8L', purchase_unit: 'CS', ingredient_code: 'I-2', count_unit: 'BTL', count_per_purchase: 6,
      base_unit: 'ml', base_per_purchase: 10800, verified: true, auto_post: true },
    { id: 'm4', vendor_key: 'v1', vendor_item_code: '02222', alias_key: null, spec_key: '12/500G', purchase_unit: 'CS', ingredient_code: 'I-1', count_unit: 'BAG', count_per_purchase: 12,
      base_unit: 'g', base_per_purchase: 6000, verified: true, auto_post: false },
    // another pack than the link's, with no conversion to compare: spec_changed from the pack alone
    { id: 'm5', vendor_key: 'v1', vendor_item_code: '03333', alias_key: null, spec_key: '10/100', purchase_unit: '', ingredient_code: 'I-3', verified: true, auto_post: true },
    // a purchase unit the line does not print: unit_unverified
    { id: 'm6', vendor_key: 'v1', vendor_item_code: '04444', alias_key: null, spec_key: '', purchase_unit: 'CS', ingredient_code: 'I-4', verified: true, auto_post: true },
  ];
  const ctx = m => ({ store, stores: [store], vendors, maps: m, settings: {}, started: true, docCount: 1 });
  const without = await evaluate(ext(L), ctx([]));
  const withMaps = await evaluate(ext(L), ctx(maps));
  assert.ok(withMaps.lines[6].reasons.includes('spec_changed') && withMaps.lines[7].reasons.includes('unit_unverified'), 'the made-up lines cover both');
  without.lines.forEach((l, i) => {
    const line = { id: 'l' + i, vendor_key: 'v1', store_id: 'F06', item_code: l.item_code, raw_name: l.raw_name, spec: l.spec, spec_key: l.spec_key,
      purchase_unit: l.purchase_unit, unit_price: l.unit_price, map_id: l.map_id || null, ingredient_code: l.ingredient_code || null, reasons: l.reasons };
    const u = relink(line, maps);
    const w = withMaps.lines[i];
    if (!w.map_id) { assert.equal(u, null, 'line ' + i + ': no link for it (another pack), left as it is'); assert.ok(w.reasons.includes('unmapped')); return; }
    assert.ok(u, 'line ' + i + ' changes');
    assert.deepEqual([u.map_id, u.ingredient_code, u.count_unit, u.base_unit], [w.map_id ?? null, w.ingredient_code ?? null, w.count_unit ?? null, w.base_unit ?? null], 'line ' + i);
    assert.deepEqual(strip(u.reasons), strip(w.reasons), 'line ' + i);
    assert.deepEqual([u.price_per_count ?? null, u.price_per_base ?? null], [w.price_per_count ?? null, w.price_per_base ?? null], 'line ' + i);
    // and back: taking every link back gives the line the intake writes with none
    const back = relink({ ...line, map_id: u.map_id, ingredient_code: u.ingredient_code, reasons: u.reasons }, []);
    assert.deepEqual(back ? [back.map_id, strip(back.reasons)] : null, [null, strip(l.reasons)], 'line ' + i + ' back');
    // a line the intake took in with the links there is in step (nothing to do), and stays so with its link's code changed only in the
    // line (left behind: review P2-1) until it follows
    const inStep = { ...line, map_id: w.map_id, ingredient_code: w.ingredient_code, reasons: w.reasons, count_unit: w.count_unit ?? null,
      count_per_purchase: w.count_per_purchase ?? null, base_unit: w.base_unit ?? null, base_per_purchase: w.base_per_purchase ?? null };
    assert.equal(relink(inStep, maps), null, 'line ' + i + ' in step');
    const behind = relink({ ...inStep, ingredient_code: 'OLD' }, maps);
    assert.deepEqual(behind && [behind.map_id, behind.ingredient_code, strip(behind.reasons)], [w.map_id, w.ingredient_code, strip(w.reasons)], 'line ' + i + ' left behind');
    // a reason about the link saved over it (a correction read before the link): put right
    const over = relink({ ...inStep, reasons: [...w.reasons, 'unmapped'] }, maps);
    assert.deepEqual(over && strip(over.reasons), strip(w.reasons), 'line ' + i + ' reason saved over it');
    // the link's conversion changed (accounting): the line follows it; the same numbers written another way are the same
    if (w.count_per_purchase != null) {
      assert.ok(relink({ ...inStep, count_per_purchase: '5' }, maps), 'line ' + i + ' conversion');
      assert.equal(relink({ ...inStep, count_per_purchase: Number(w.count_per_purchase).toFixed(6) }, maps), null, 'line ' + i + ' 6.000000 is 6');
    }
  });
  // the item keys: code, else the printed name with its pack
  assert.deepEqual(itemKey({ item_code: ' 07777 ', raw_name: 'x' }), { vendor_item_code: '07777', alias_key: null, spec_key: '' });
  assert.deepEqual(itemKey({ item_code: null, raw_name: ' Gloves  Nitrile L ', spec_key: '10/100' }), { vendor_item_code: null, alias_key: 'gloves nitrile l', spec_key: '10/100' });
  assert.equal(itemKey({ item_code: '', raw_name: '' }), null);
  assert.ok(MAP_REASONS.includes('unmapped') && MAP_REASONS.includes('spec_changed'));
});

test('紐づけ: a link taken back is never a source of prices, even on a line that still has it', async () => {
  const E = await setup();
  await E.q(`update invoice_settings set value=value||'{"auto_post":false}' where key='mode'`);
  const A = await E.read([['G-1', '9501', '2026-10-02', [AVO]]]);
  const r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  assert.equal((await linesOf(E, A['G-1'].id))[0].map_id, m.id);
  // taken back by the database alone: the line still has it
  await E.q(`update invoice_item_maps set retired_at=now(), retired_by='x' where id=$1`, [m.id]);
  const d = await docOf(E, A['G-1'].id);
  const p = await E.api('tok-office', { action: 'post', doc_id: d.id, version: d.version, reason: '確認した' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(await prices(E, '10003'), []);
  await E.pg.close();
});

// The review of ea17b8f (P2-1・P2-3): a line left on an old code or with a reason saved over it, while its link is still in use, is
// shown as waiting and put right by そろえる (the posted line's old price voided, the new one written). Made by writing the states the
// review reached (an apply that failed after a link changed; a correction read before the link and saved after it).
test('紐づけ: lines left behind with a link in use (an apply that failed, a correction saved over it) wait and そろえる puts them right', async () => {
  const E = await setup();
  const A = await E.read([['L-1', '9601', '2026-10-02', [AVO]], ['L-2', '9602', '2026-10-03', [AVO]]]);
  await E.q(`update invoice_docs set status='review' where id=$1`, [A['L-2'].id]);
  let r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  assert.deepEqual((await prices(E, '10003')).filter(h => h.status === 'active').length, 1);
  // linked again to another code, and the step that brings the lines along failed (the link is saved, the lines are not)
  await E.q(`update invoice_item_maps set ingredient_code='50067', version=version+1 where id=$1`, [m.id]);
  // and the invoice to check got a correction read before the link and saved after it: the link's reasons of that time
  await E.q(`update invoice_lines set reasons = reasons || '["unmapped"]'::jsonb where doc_id=$1`, [A['L-2'].id]);
  let data = (await E.api('tok-chef', { action: 'link_data' })).body;
  assert.deepEqual([itemOf(data, AVO_ID).link.ingredient_code, itemOf(data, AVO_ID).waiting, data.waiting], ['50067', 2, 2], 'the screen shows them');
  r = await E.api('tok-chef', { action: 'link_sync' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.sync.lines, r.body.sync.voided, r.body.sync.prices], [2, 1, 1]);
  const L1 = (await linesOf(E, A['L-1'].id))[0], L2 = (await linesOf(E, A['L-2'].id))[0];
  assert.deepEqual([L1.ingredient_code, L2.ingredient_code, L2.reasons.includes('unmapped'), L1.map_id, L2.map_id], ['50067', '50067', false, m.id, m.id]);
  assert.deepEqual((await prices(E, '10003')).map(h => h.status), ['voided']);
  assert.deepEqual((await prices(E, '50067')).map(h => h.status), ['active']);
  data = (await E.api('tok-chef', { action: 'link_data' })).body;
  assert.deepEqual([itemOf(data, AVO_ID).waiting, data.waiting], [0, 0]);
  assert.equal((await E.api('tok-chef', { action: 'link_sync' })).body.sync.lines, 0, 'nothing more');
  // a line left on a link taken back (its vendor has no link in use any more) is found too
  await E.q(`update invoice_item_maps set retired_at=now() where id=$1`, [m.id]);
  data = (await E.api('tok-office', { action: 'link_data' })).body;
  assert.equal(data.waiting, 2);
  r = await E.api('tok-office', { action: 'link_sync' });
  assert.deepEqual([r.body.sync.lines, r.body.sync.voided], [2, 1]);
  assert.deepEqual((await linesOf(E, A['L-1'].id))[0].map_id, null);
  assert.deepEqual((await prices(E, '50067')).map(h => h.status), ['voided']);
  await E.pg.close();
});

// The review (P2-4): a line whose purchase unit is not printed keeps "unit not printed" when its link (with a purchase unit) is
// linked again: no price is written that the intake would not write.
test('紐づけ: "unit not printed" stays when a link with a purchase unit is linked again (no price the intake would not write)', async () => {
  const E = await setup();
  const KIWI = ['08888', 'KIWI', '2', '30.00', '60.00', null, null];
  const A = await E.read([['K-1', '9701', '2026-10-02', [KIWI]]]);
  // accounting's mapping, with a purchase unit, not checked yet
  const ms = await E.api('tok-office', { action: 'map_save', map: { vendor_key: 'v1', store_id: null, vendor_item_code: '08888', alias_key: null, spec_key: '', purchase_unit: 'CS',
    ingredient_code: '10003', verified: false, auto_post: false, source: 'manual' } });
  assert.equal(ms.status, 200, JSON.stringify(ms.body));
  let r = await E.api('tok-office', { action: 'link_sync' });
  let [l] = await linesOf(E, A['K-1'].id);
  assert.deepEqual([l.map_id, l.reasons.includes('unit_unverified'), l.reasons.includes('map_unverified')], [ms.body.id, true, true], 'as the intake finds it');
  // a Head Chef links it again (not checked by accounting: they may)
  const data = (await E.api('tok-chef', { action: 'link_data' })).body;
  const it = itemOf(data, 'v1|c:08888');
  assert.equal(it.link.id, ms.body.id);
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '08888', ingredient_code: '50067', map_id: it.link.id, version: it.link.version }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  [l] = await linesOf(E, A['K-1'].id);
  assert.deepEqual([l.ingredient_code, l.reasons.includes('unit_unverified'), l.reasons.includes('map_unverified')], ['50067', true, false]);
  assert.deepEqual(await prices(E, '50067'), [], 'no price: the unit was never printed');
  await E.pg.close();
});

// The review's P3s: credit memos follow the links too (no price from a return); a code item whose lines are linked by their printed name
// shows that link and changing it changes that link (no second link made); an item with two links shows none of them; a chosen mapping
// that is not in use is refused by the correction; the mapping screen never takes a reuse flag from the screen; accounting's change makes
// a link accounting's own; the lines are read page by page.
test('紐づけ: credit memos, a code item linked by name, several links, the correction and the mapping screen, pages of lines', async () => {
  const E = await setup();
  await E.q(`update invoice_settings set value=value||'{"auto_post":false}' where key='mode'`);
  const A = await E.read([['C-1', '9801', '2026-10-02', [AVO]], ['C-2', 'CM-1', '2026-10-04', [AVO], undefined, { doc_type: 'credit_memo' }]]);
  assert.equal((await docOf(E, A['C-2'].id)).doc_type, 'credit_memo');
  let r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  assert.deepEqual([r.body.sync.lines, (await linesOf(E, A['C-2'].id))[0].ingredient_code], [2, '10003'], 'the return is coded too');
  let data = (await E.api('tok-office', { action: 'link_data' })).body;
  assert.equal(itemOf(data, AVO_ID).n, 2);
  await E.api('tok-office', { action: 'link_undo', maps: [{ id: r.body.maps[0].id, version: r.body.maps[0].version }] });
  // the printed name (no code link) found the lines: the code item shows that link
  const byName = await E.api('tok-office', { action: 'map_save', map: { vendor_key: 'v1', store_id: null, vendor_item_code: null, alias_key: 'avocado 48s', spec_key: '48CT',
    purchase_unit: '', ingredient_code: '10003', verified: false, auto_post: false, source: 'manual' } });
  assert.equal(byName.status, 200, JSON.stringify(byName.body));
  await E.api('tok-office', { action: 'link_sync' });
  data = (await E.api('tok-office', { action: 'link_data' })).body;
  let it = itemOf(data, AVO_ID);
  assert.deepEqual([it.link && it.link.id, it.links, it.waiting, it.link && it.link.alias_key], [byName.body.id, 1, 0, 'avocado 48s']);
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', alias_key: 'avocado 48s', spec_key: '48CT', ingredient_code: '50067', map_id: it.link.id, version: it.link.version }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await linesOf(E, A['C-1'].id)).map(l => [l.map_id, l.ingredient_code]), [[byName.body.id, '50067']]);
  assert.equal((await E.q(`select count(*)::int n from invoice_item_maps where vendor_key='v1' and retired_at is null`))[0].n, 1, 'no second link');
  // accounting changes it in the mapping screen: it becomes accounting's own (a Head Chef / AM no longer changes it)
  const cur = (await E.q(`select * from invoice_item_maps where id=$1`, [byName.body.id]))[0];
  const ed = await E.api('tok-office', { action: 'map_save', map: { id: cur.id, version: cur.version, ingredient_code: '50067', verified: true, auto_post: false, note: null } });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  assert.equal(ed.body.source, 'manual');
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', alias_key: 'avocado 48s', spec_key: '48CT', ingredient_code: '10003', map_id: cur.id, version: ed.body.version }] });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  // a code link besides it: the item has two links and shows none of them
  await E.db.rpc('invoice_link_save', { actor: U.office, links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  data = (await E.api('tok-office', { action: 'link_data' })).body;
  it = itemOf(data, AVO_ID);
  assert.deepEqual([it.link, it.links], [null, 2]);
  // the correction: a chosen mapping that is not in use (taken back) is refused, not kept with another mapping's code
  const codeMap = (await E.q(`select * from invoice_item_maps where vendor_item_code='07777' and retired_at is null`))[0];
  await E.q(`update invoice_item_maps set retired_at=now() where id=$1`, [codeMap.id]);
  const d = await docOf(E, A['C-1'].id), [l] = await linesOf(E, A['C-1'].id);
  const ec = await E.api('tok-office', { action: 'edit', doc_id: d.id, version: d.version, reason: '対応を選んだ', lines: [{ line_id: l.id, set: { map_id: codeMap.id } }] });
  assert.deepEqual([ec.status, ec.body.error], [409, 'map_not_usable'], JSON.stringify(ec.body));
  // the mapping screen: updating a link taken back by its id is refused whatever the screen sends
  const cm = (await E.q(`select * from invoice_item_maps where id=$1`, [codeMap.id]))[0];
  const rs = await E.api('tok-office', { action: 'map_save', map: { id: cm.id, version: cm.version, retired_again: true, ingredient_code: '10003', verified: true, auto_post: false, note: null } });
  assert.equal(rs.status, 409, JSON.stringify(rs.body));
  // pages: every line, page by page, in one order
  const all = await E.db.rpc('invoice_link_lines', { actor: U.office });
  const p1 = await E.db.rpc('invoice_link_lines', { actor: U.office, limit: 1, offset: 0 }), p2 = await E.db.rpc('invoice_link_lines', { actor: U.office, limit: 1, offset: 1 });
  assert.deepEqual([...p1, ...p2].map(x => x.id), all.map(x => x.id));
  assert.deepEqual(all.map(x => x.doc_type).sort(), ['credit_memo', 'invoice']);
  assert.equal((await E.db.rpc('invoice_link_lines', { actor: U.office, limit: 1, offset: 2 })).length, 0);
  // the made-up groupItems: two links on one item show none; a store's own link on its lines counts as another one
  const gl = [{ id: 'x1', vendor_key: 'v1', item_code: '1', raw_name: 'A', spec_key: '', doc_id: 'd', store_id: 'F06', status: 'posted', map_id: 's1' }];
  const g = groupItems(gl, { maps: [{ id: 'k1', vendor_key: 'v1', vendor_item_code: '1', spec_key: '' }, { id: 's1', vendor_key: 'v1', store_id: 'F06', vendor_item_code: '1', spec_key: '' }] });
  assert.deepEqual([g[0].link && g[0].link.id, g[0].links, g[0].other_lines], ['k1', 1, 1], 'a store\'s own link on a line: counted, does not stop the item');
  await E.pg.close();
});

// The second review (a2ed61d): P1 — an invoice left on a vendor merged into another (a closed month's) was cleared by そろえる (its
// vendor's links moved with the merge, so relink found none and the posted line's price was voided). Such invoices are left as they are.
test('紐づけ: an invoice left on a merged vendor (a closed month) is never cleared by そろえる and never waits', async () => {
  const E = await setup();
  const A = await E.read([['M-1', '6001', '2026-09-20', [AVO], 'VendorB']]);
  let d = A['M-1'];
  assert.equal(d.vendor_key, 'v2');
  let r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v2', vendor_item_code: '07777', ingredient_code: '10003' }] });
  d = await docOf(E, d.id);
  r = await E.api('tok-office', { action: 'post', doc_id: d.id, version: d.version, reason: '確認した' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await prices(E, '10003')).map(h => h.status), ['active']);
  await E.q(`update invoice_settings set value=value||'{"closed_through":"2026-09"}' where key='rules'`);
  r = await E.api('tok-office', { action: 'vendor_merge', to: 'VendorA', names: ['VendorA', 'VendorB'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await docOf(E, d.id)).vendor_key, 'v2', 'the closed month\'s invoice stays on the merged vendor');
  const data = (await E.api('tok-office', { action: 'link_data' })).body;
  assert.equal(data.waiting, 0);
  r = await E.api('tok-office', { action: 'link_sync' });
  assert.deepEqual([r.body.sync.lines, r.body.sync.voided, r.body.sync.skipped], [0, 0, 0], 'not even sent');
  const [l] = await linesOf(E, d.id);
  assert.deepEqual([l.ingredient_code, l.reasons.includes('unmapped')], ['10003', false]);
  assert.deepEqual((await prices(E, '10003')).map(h => h.status), ['active']);
  // and the database passes over such a line whatever it is sent
  const read = (await E.db.rpc('invoice_link_lines', { actor: U.office })).find(x => x.id === l.id);
  const x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ line_id: l.id, from_map: l.map_id, unit_price: read.unit_price, purchase_unit: read.purchase_unit, maps_fp: await fpOf(E, 'v2'),
    map_id: null, ingredient_code: null, count_unit: null, count_per_purchase: null, base_unit: null, base_per_purchase: null, price_per_count: null, price_per_base: null,
    reasons: [...l.reasons.filter(c => !MAP_REASONS.includes(c)), 'unmapped'] }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  await E.pg.close();
});

// The second review: P3-2 — a change of a link's flags alone (not its code) rewrote the posted lines' prices (new rows by the Head Chef,
// the comparison lost). Now the row stays; it is written again only when what it records changes (the code, the conversion).
test('紐づけ: a posted line\'s price row stays when only the reasons change; a new code or conversion writes it again; no price without a printed unit', async () => {
  const E = await setup();
  const A = await E.read([['P-1', '9901', '2026-10-02', [AVO]]]);
  let r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  const first = (await prices(E, '10003'));
  assert.deepEqual(first.map(h => [h.status, h.reason]), [['active', 'link']]);
  // the link gets "post automatically" (GM): the line's mode_review_item goes; its price row is the same row
  await E.q(`update invoice_item_maps set auto_post=true, version=version+1 where id=$1`, [m.id]);
  await E.q(`update invoice_lines set prev_price='{"price_per_purchase":"29.5"}'::jsonb where doc_id=$1`, [A['P-1'].id]);
  r = await E.api('tok-chef', { action: 'link_sync' });
  assert.deepEqual([r.body.sync.lines, r.body.sync.voided, r.body.sync.prices], [1, 0, 0]);
  assert.deepEqual((await prices(E, '10003')).map(h => [h.id, h.status]), [[first[0].id, 'active']]);
  assert.deepEqual((await linesOf(E, A['P-1'].id))[0].prev_price, { price_per_purchase: '29.5' }, 'the comparison stays');
  // accounting gives the link a conversion (48 a case): the line follows and its price is written again per count
  await E.q(`update invoice_item_maps set count_unit='EA', count_per_purchase=48, version=version+1 where id=$1`, [m.id]);
  assert.equal((await E.api('tok-office', { action: 'link_data' })).body.waiting, 1);
  r = await E.api('tok-office', { action: 'link_sync' });
  assert.deepEqual([r.body.sync.lines, r.body.sync.voided, r.body.sync.prices], [1, 1, 1]);
  const now = (await prices(E, '10003')).filter(h => h.status === 'active');
  assert.deepEqual([now.length, Number(now[0].price_per_count).toFixed(4)], [1, '0.6250']);
  assert.equal((await linesOf(E, A['P-1'].id))[0].prev_price, null, 'a new record: nothing to compare with');
  // the link got a purchase unit (CS) after the line came in with no printed unit: a new code gives no price until the unit is checked
  const K = await E.read([['P-2', '9902', '2026-10-03', [['09999', 'LEMON', '1', '20.00', '20.00', null, null]]]]);
  r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '09999', ingredient_code: '10003' }] });
  const lm = r.body.maps[0];
  assert.equal((await linesOf(E, K['P-2'].id))[0].reasons.includes('unit_unverified'), false, 'no purchase unit on the link yet');
  await E.q(`update invoice_item_maps set purchase_unit='CS', version=version+1 where id=$1`, [lm.id]);
  const cur = (await E.q(`select * from invoice_item_maps where id=$1`, [lm.id]))[0];
  r = await E.api('tok-chef', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '09999', ingredient_code: '50067', map_id: cur.id, version: cur.version }] });
  const [kl] = await linesOf(E, K['P-2'].id);
  assert.deepEqual([kl.ingredient_code, kl.reasons.includes('unit_unverified')], ['50067', true]);
  assert.deepEqual(await prices(E, '50067'), []);
  assert.equal((await E.api('tok-office', { action: 'link_data' })).body.waiting, 0, 'settled');
  await E.pg.close();
});

// Codex P2 on PR #77: an older そろえる/戻す, worked out before another person's link change and applied after it, wrote over the newer
// state (a price per piece back to the old conversion; a link linked again lost its code and its price). Made with the real handler and
// SQL: the other operation runs just before the older one's invoice_link_apply. The older one passes over those lines; そろえる then
// finds nothing to do.
test('紐づけ: an older そろえる or 戻す applied after a newer link change never writes over it (Codex P2 on PR #77)', async () => {
  const E = await setup();
  const A = await E.read([['R-1', '9951', '2026-10-02', [AVO]]]);
  let r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  const mapNow = async () => (await E.q(`select * from invoice_item_maps where id=$1`, [m.id]))[0];
  const active = async () => (await prices(E, '10003')).filter(h => h.status === 'active');
  // 1) accounting sets 6 a case; A's そろえる works out 6 a case; meanwhile B sets 48 a case and brings the lines along; then A's apply
  let cur = await mapNow();
  assert.equal((await E.api('tok-office', { action: 'map_save', map: { id: cur.id, version: cur.version, ingredient_code: '10003', count_unit: 'EA', count_per_purchase: '6',
    verified: true, auto_post: false, note: null } })).status, 200);
  E.hooks.invoice_link_apply = async () => {
    const c = await mapNow();
    const b1 = await E.api('tok-office', { action: 'map_save', map: { id: c.id, version: c.version, ingredient_code: '10003', count_unit: 'EA', count_per_purchase: '48',
      verified: true, auto_post: false, note: null } });
    assert.equal(b1.status, 200, JSON.stringify(b1.body));
    const b2 = await E.api('tok-office', { action: 'link_sync' });
    assert.deepEqual([b2.status, b2.body.sync.lines], [200, 1], JSON.stringify(b2.body));
  };
  r = await E.api('tok-office', { action: 'link_sync' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.sync.lines, r.body.sync.skipped], [0, 1], 'the older one is passed over');
  let [l] = await linesOf(E, A['R-1'].id);
  assert.equal(Number(l.count_per_purchase), 48);
  let act = await active();
  assert.deepEqual([act.length, Number(act[0].price_per_count).toFixed(4), Number(act[0].conversion.count_per_purchase)], [1, '0.6250', 48]);
  assert.equal((await E.api('tok-office', { action: 'link_data' })).body.waiting, 0);
  // 2) a Head Chef takes the link back; before the lines follow, an AM links the same item again (the same row) and brings them along
  cur = await mapNow();
  E.hooks.invoice_link_apply = async () => {
    const b = await E.api('tok-am', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '07777', ingredient_code: '10003' }] });
    assert.deepEqual([b.status, b.body.maps[0].id], [200, m.id], JSON.stringify(b.body));
  };
  const und = await E.api('tok-office', { action: 'link_undo', maps: [{ id: cur.id, version: cur.version }] });
  assert.equal(und.status, 200, JSON.stringify(und.body));
  assert.deepEqual([und.body.sync.lines, und.body.sync.voided], [0, 0], 'the older undo is passed over');
  cur = await mapNow();
  [l] = await linesOf(E, A['R-1'].id);
  assert.deepEqual([cur.retired_at, l.map_id, l.ingredient_code], [null, m.id, '10003']);
  act = await active();
  assert.equal(act.length, 1, 'the price under the link linked again is in use');
  assert.equal((await E.api('tok-office', { action: 'link_data' })).body.waiting, 0);
  await E.pg.close();
});

test('紐づけ: the reasons that keep a line from a price are the same in invoice_link_apply and invoice_price_insert', () => {
  const body = name => { const i = SQL.indexOf('create function public.' + name + '('); return SQL.slice(i, SQL.indexOf('\nend $$;', i)); };
  const arr = (txt, re) => { const m = re.exec(txt); assert.ok(m, re); return m[1].replace(/\s+/g, '').split(',').map(x => x.replace(/'/g, '')).sort(); };
  assert.deepEqual(arr(body('invoice_link_apply'), /no_price text\[\] := array\[([^\]]*)\]/), arr(body('invoice_price_insert'), /l\.reasons \?\| array\[([^\]]*)\]/));
});

test('紐づけ deploy folder: the migration copy is the repository file; the check SQL and the one-file function stay as handed over',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, async () => {
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-item-link-v1093/';
  assert.ok(rd(D + '1_追加のSQL_紐づけ.sql').equals(rd('supabase/migrations/20261025090000_invoice_item_link.sql')));
  // The sources and the check SQL moved on with QuickBooks からすぐ (deploy/invoice-qb-gmail-v1094 is built from the current ones):
  // this folder is what went in for 紐づけ (2026-10-18), and the function to go back to from QuickBooks からすぐ.
  assert.equal(sha(rd(D + '2_確認のSQL_読むだけ.sql')), 'e19242e16b892a3d089f18ee2961402a05c7db8daa499a55f03345a486654751');
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  assert.equal(src.bundle_sha256, '785863e937e9e530281691e09e61f0d8a9283e2e8f5a0098288d7cccb44b526b');
  assert.deepEqual(Object.keys(src.sources).sort(), ['invoice/dates.mjs', 'invoice/decimal.mjs', 'invoice/dedupe.mjs', 'invoice/drive.mjs', 'invoice/extract.mjs', 'invoice/link.mjs',
    'invoice/naming.mjs', 'invoice/rules.mjs', 'invoice/units.mjs', 'supabase/functions/invoice-intake/handler.mjs', 'supabase/functions/invoice-intake/index.ts']);
  const bundle = rd(D + '3_関数_invoice-intake_index.ts').toString();
  assert.ok(!/^\s*import\s/m.test(bundle) && /Deno\.serve\(createHandler/.test(bundle));
  for (const k of ['invoice_link_data', 'invoice_link_save', 'invoice_link_apply', 'link_sync', 'groupItems', 'relink', 'invoice_vendor_register', 'invoice_purchase_publish']) assert.ok(bundle.includes(k), k);
  // The steps name the files in the folder, and the order SQL → check → function → app → Head Chef / AM.
  const steps = rd(D + '手順.md').toString();
  for (const f of ['1_追加のSQL_紐づけ.sql', '2_確認のSQL_読むだけ.sql', '3_関数_invoice-intake_index.ts', 'db/invoice-link-add-member.sql',
    'deploy/invoice-vendor-register-v1089/3_関数_invoice-intake_index.ts']) assert.ok(steps.includes(f), f);
  assert.ok(steps.indexOf('1_追加のSQL') < steps.indexOf('2_確認のSQL') && steps.indexOf('2_確認のSQL') < steps.indexOf('3_関数') && steps.indexOf('3_関数') < steps.indexOf('v1093 をマージ')
    && steps.indexOf('v1093 をマージ') < steps.indexOf('Authentication'));
  // No account of a real person in the repository: the add-member SQL is a template.
  const add = rd('db/invoice-link-add-member.sql').toString();
  assert.ok(add.includes("'name@example.com'") && !/@funergygroup\.com/i.test(add + steps));
});

// The check SQL says whether 紐づけ is in: false on a database with everything before it, true after it (and the counts).
test('紐づけ: the check SQL tells before from after; the add-member SQL adds a Head Chef / AM in the role only', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => /^\d{14}_invoice_.*\.sql$/.test(f)).sort();
  const S6 = '20261025090000_invoice_item_link.sql';
  // QuickBooks からすぐ (20261026090000) came after it: the database here is the one 紐づけ went on.
  // 確認済み＝人の反映か照合済み (20261029100000) came after that too.
  assert.deepEqual(files.slice(-4), [S6, '20261026090000_invoice_qb_gmail.sql', '20261029100000_invoice_purchase_posted.sql', '20261101100000_invoice_vendor_seed_skip_deleted.sql']);
  const POST = fs.readFileSync(new URL('../db/invoice-intake-postcheck.sql', import.meta.url), 'utf8');
  const ADD = fs.readFileSync(new URL('../db/invoice-link-add-member.sql', import.meta.url), 'utf8');
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key, email text);
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);
      create table public.employees(id text primary key, name text, role text, title text, status text, data jsonb);
      insert into public.employees values ('E-CH','Kai Test','chef','Head Chef','在籍','{}'),('E-AM','Lani Test','am','Area Manager','在籍','{}'),('E-AM2','Lani Other','crew','Server','退職','{}'),
        ('E-X','Sam One','crew','Server','在籍','{}'),('E-Y','Sam Two','crew','Server','在籍','{}');
      insert into auth.users values ('00000000-0000-4000-8000-0000000000c1','chef@example.test'),('00000000-0000-4000-8000-0000000000c2','am@example.test');`);
    for (const f of files.slice(0, -4)) await pg.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    let post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, post.vendor_register, Number(post.tables), Number(post.functions)], [false, true, 19, 84]);
    await pg.exec(fs.readFileSync(new URL(S6, dir), 'utf8'));
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, post.vendor_register, Number(post.tables), Number(post.functions), Number(post.browser_can_read), Number(post.browser_can_run)],
      [true, true, 21, 94, 0, 0]);
    await pg.exec(`grant execute on function public.invoice_link_save(jsonb) to anon`);
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, Number(post.browser_can_run)], [false, 1]);
    await pg.exec(`revoke execute on function public.invoice_link_save(jsonb) from anon`);
    const add = (email, name, role) => pg.exec(ADD.replace("'name@example.com'", `'${email}'`).replace("'社員の名前'", `'${name}'`).replace("v_role text := 'chef'", `v_role text := '${role}'`));
    await add('Chef@Example.test', 'Kai%', 'chef');
    await add('am@example.test', 'Lani%', 'am');   // the other Lani is 退職: one in service
    await assert.rejects(add('am@example.test', 'Sam%', 'am'), /在籍の人が 2 人/);
    await assert.rejects(add('am@example.test', 'Kai Test', 'am'), /役割が am ではありません/);
    await assert.rejects(add('nobody@example.test', 'Kai%', 'chef'), /アカウントがありません/);
    await assert.rejects(add('am@example.test', 'Lani%', 'gm'), /役割は chef/);
    const rows = (await pg.query(`select user_id::text u, emp_id, role, enabled from public.invoice_link_members order by emp_id`)).rows;
    assert.deepEqual(rows.map(r => [r.emp_id, r.role, r.enabled]), [['E-AM', 'am', true], ['E-CH', 'chef', true]]);
    assert.equal((await pg.query(`select public.invoice_link_role('00000000-0000-4000-8000-0000000000c1') r`)).rows[0].r, 'chef');
  } finally { await pg.close(); }
});
