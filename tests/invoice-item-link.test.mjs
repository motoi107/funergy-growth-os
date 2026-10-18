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
     ('E-OF','Office Person','office','Accounting','在籍','{}'),('E-CH','Chika Test','chef','Head Chef','在籍','{}'),('E-AM','Yuki Test','am','Area Manager','在籍','{}'),
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
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
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
    for (const [tag, no, date, lines, vendor] of list) {
      fixtures.set(tag, { readable: true, documents: [doc(no, date, lines, { vendor })] });
      F[tag] = drive.file(tag + '.pdf', pdf(tag), 'U6');
    }
    const w = await call({ action: 'worker' }, { 'x-invoice-worker-key': WORKER_KEY });
    assert.equal(w.body.ok, true, JSON.stringify(w.body));
    const D = {};
    for (const tag of Object.keys(F)) D[tag] = (await q(`select d.* from invoice_docs d join invoice_files f on f.id=d.file_id where f.drive_file_id=$1`, [F[tag]]))[0];
    return D;
  };
  return { pg, db, api, q, read };
}

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
  const A = await E.read([['E-1', '9301', '2026-10-02', [['06666', 'LIME', '2', '30.00', '59.00', 'CS', null]]]]);
  const r = await E.api('tok-office', { action: 'link_save', links: [{ vendor_key: 'v1', vendor_item_code: '06666', ingredient_code: '10003' }] });
  const m = r.body.maps[0];
  const [l] = await linesOf(E, A['E-1'].id);
  assert.ok(l.reasons.includes('line_math') && l.map_id === m.id, JSON.stringify(l.reasons));
  const base = { line_id: l.id, from_map: m.id, map_id: m.id, ingredient_code: '10003', count_unit: null, count_per_purchase: null, base_unit: null,
    base_per_purchase: null, price_per_count: null, price_per_base: null, reasons: l.reasons };
  // another reason than the link's: refused (nothing in the call is saved)
  await assert.rejects(E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, map_id: null, ingredient_code: null, reasons: ['unmapped'] }] }), /bad_value/);
  await assert.rejects(E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, reasons: [...l.reasons, 'total_mismatch'] }] }), /bad_value/);
  await assert.rejects(E.db.rpc('invoice_link_apply', { actor: U.other, updates: [] }), /forbidden/);
  // from_map not what the line has now: passed over
  let x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, from_map: null, map_id: null, ingredient_code: null, reasons: ['unmapped'] }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  // a code that is not the link's, a link taken back, a superseded invoice: passed over
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [{ ...base, ingredient_code: '50067' }] });
  assert.deepEqual([x.lines, x.skipped], [0, 1]);
  await E.q(`update invoice_item_maps set retired_at=now() where id=$1`, [m.id]);
  x = await E.db.rpc('invoice_link_apply', { actor: U.office, updates: [base] });
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
  ];
  const maps = [
    { id: 'm1', vendor_key: 'v1', vendor_item_code: '07777', alias_key: null, spec_key: '', purchase_unit: '', ingredient_code: '10003', verified: true, auto_post: false },
    { id: 'm2', vendor_key: 'v1', vendor_item_code: null, alias_key: 'gloves nitrile l', spec_key: '10/100', purchase_unit: '', ingredient_code: '40001', verified: false, auto_post: false },
    { id: 'm3', vendor_key: 'v1', vendor_item_code: '01111', alias_key: null, spec_key: '6/1.8L', purchase_unit: 'CS', ingredient_code: 'I-2', count_unit: 'BTL', count_per_purchase: 6,
      base_unit: 'ml', base_per_purchase: 10800, verified: true, auto_post: true },
    { id: 'm4', vendor_key: 'v1', vendor_item_code: '02222', alias_key: null, spec_key: '12/500G', purchase_unit: 'CS', ingredient_code: 'I-1', count_unit: 'BAG', count_per_purchase: 12,
      base_unit: 'g', base_per_purchase: 6000, verified: true, auto_post: false },
  ];
  const ctx = m => ({ store, stores: [store], vendors, maps: m, settings: {}, started: true, docCount: 1 });
  const without = await evaluate(ext(L), ctx([]));
  const withMaps = await evaluate(ext(L), ctx(maps));
  const changed = new Set(maps.map(m => m.id));
  without.lines.forEach((l, i) => {
    const line = { id: 'l' + i, vendor_key: 'v1', store_id: 'F06', item_code: l.item_code, raw_name: l.raw_name, spec: l.spec, spec_key: l.spec_key,
      purchase_unit: l.purchase_unit, unit_price: l.unit_price, map_id: l.map_id || null, ingredient_code: l.ingredient_code || null, reasons: l.reasons };
    const u = relink(line, maps, changed);
    const w = withMaps.lines[i];
    if (!w.map_id) { assert.equal(u, null, 'line ' + i + ': no link for it (another pack), left as it is'); assert.ok(w.reasons.includes('unmapped')); return; }
    assert.ok(u, 'line ' + i + ' changes');
    assert.deepEqual([u.map_id, u.ingredient_code, u.count_unit, u.base_unit], [w.map_id ?? null, w.ingredient_code ?? null, w.count_unit ?? null, w.base_unit ?? null], 'line ' + i);
    assert.deepEqual(strip(u.reasons), strip(w.reasons), 'line ' + i);
    assert.deepEqual([u.price_per_count ?? null, u.price_per_base ?? null], [w.price_per_count ?? null, w.price_per_base ?? null], 'line ' + i);
    // and back: taking every link back gives the line the intake writes with none
    const back = relink({ ...line, map_id: u.map_id, ingredient_code: u.ingredient_code, reasons: u.reasons }, [], new Set());
    assert.deepEqual(back ? [back.map_id, strip(back.reasons)] : null, [null, strip(l.reasons)], 'line ' + i + ' back');
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

test('紐づけ deploy folder: the copies are the repository files and the one-file function is built from the sources in use',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, async () => {
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-item-link-v1093/';
  assert.ok(rd(D + '1_追加のSQL_紐づけ.sql').equals(rd('supabase/migrations/20261025090000_invoice_item_link.sql')));
  assert.ok(rd(D + '2_確認のSQL_読むだけ.sql').equals(rd('db/invoice-intake-postcheck.sql')));
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  // Every source of the one-file function is the repository's as it is now: change one, build the function again.
  for (const [f, h] of Object.entries(src.sources)) assert.equal(sha(rd(f)), h, f + ' changed: build 3_関数 again');
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
  assert.equal(files.at(-1), '20261025090000_invoice_item_link.sql');
  const POST = fs.readFileSync(new URL('../db/invoice-intake-postcheck.sql', import.meta.url), 'utf8');
  const ADD = fs.readFileSync(new URL('../db/invoice-link-add-member.sql', import.meta.url), 'utf8');
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key, email text);
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);
      create table public.employees(id text primary key, name text, role text, title text, status text, data jsonb);
      insert into public.employees values ('E-CH','Chika Test','chef','Head Chef','在籍','{}'),('E-AM','Yuki Test','am','Area Manager','在籍','{}'),('E-AM2','Yuki Other','crew','Server','退職','{}'),
        ('E-X','Sam One','crew','Server','在籍','{}'),('E-Y','Sam Two','crew','Server','在籍','{}');
      insert into auth.users values ('00000000-0000-4000-8000-0000000000c1','chef@example.test'),('00000000-0000-4000-8000-0000000000c2','am@example.test');`);
    for (const f of files.slice(0, -1)) await pg.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    let post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, post.vendor_register, Number(post.tables), Number(post.functions)], [false, true, 19, 84]);
    await pg.exec(fs.readFileSync(new URL(files.at(-1), dir), 'utf8'));
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, post.vendor_register, Number(post.tables), Number(post.functions), Number(post.browser_can_read), Number(post.browser_can_run)],
      [true, true, 21, 94, 0, 0]);
    await pg.exec(`grant execute on function public.invoice_link_save(jsonb) to anon`);
    post = (await pg.query(POST)).rows[0];
    assert.deepEqual([post.item_link, Number(post.browser_can_run)], [false, 1]);
    await pg.exec(`revoke execute on function public.invoice_link_save(jsonb) from anon`);
    const add = (email, name, role) => pg.exec(ADD.replace("'name@example.com'", `'${email}'`).replace("'社員の名前'", `'${name}'`).replace("v_role text := 'chef'", `v_role text := '${role}'`));
    await add('Chef@Example.test', 'Chika%', 'chef');
    await add('am@example.test', 'Yuki%', 'am');   // the other Yuki is 退職: one in service
    await assert.rejects(add('am@example.test', 'Sam%', 'am'), /在籍の人が 2 人/);
    await assert.rejects(add('am@example.test', 'Chika Test', 'am'), /役割が am ではありません/);
    await assert.rejects(add('nobody@example.test', 'Chika%', 'chef'), /アカウントがありません/);
    await assert.rejects(add('am@example.test', 'Yuki%', 'gm'), /役割は chef/);
    const rows = (await pg.query(`select user_id::text u, emp_id, role, enabled from public.invoice_link_members order by emp_id`)).rows;
    assert.deepEqual(rows.map(r => [r.emp_id, r.role, r.enabled]), [['E-AM', 'am', true], ['E-CH', 'chef', true]]);
    assert.equal((await pg.query(`select public.invoice_link_role('00000000-0000-4000-8000-0000000000c1') r`)).rows[0].r, 'chef');
  } finally { await pg.close(); }
});
