// 確認済み invoice の全店仕入れ集計（Moto 2026-10-14・UI案48）— the server side.
// Real SQL (db/invoice-intake.sql on PGlite) and the real handler, with synthetic stores, vendors, invoices, lines, QuickBooks
// ledger rows and app copies. Nothing here reaches production, Drive, QuickBooks or mail.
//   A 確認済み (posted, reconciled, sent to QuickBooks or put in Drive before the ledger) / B 確認済み・未転送 / C 確認待ち /
//   D 除外 / E 集計保留. Lines take tax, shipping and discounts in proportion to their amounts, in whole cents.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const U = { gm: '00000000-0000-4000-8000-0000000000b1', office: '00000000-0000-4000-8000-0000000000b2', crew: '00000000-0000-4000-8000-0000000000b3',
  ceo: '00000000-0000-4000-8000-0000000000b4', other: '00000000-0000-4000-8000-0000000000b5' };
const WORKER_KEY = 'synthetic-worker-key-purchase-0123456789';
const SINCE = '2026-10-13T07:00:00-10:00';

async function setup({ categories = null } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.employees(id text primary key, name text); grant select on public.employees to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    insert into public.ingredients values ('I-MISO','Miso','BAG','Minato',1,'{"cat":1000}'),('I-GLOVE','Gloves','PK','Minato',1,'{"cat":40000}'),
     ('I-SAKE','Sake','BTL','Minato',1,'{"cat":21000}'),('I-TEA','Tea','CS','Minato',1,'{"cat":31000}'),('I-OWN','Own class','EA','Minato',1,'{"cat":1000,"cls":"supply"}'),
     ('I-FISH','Fish','LB','Minato',1,'{"cat":6100}');`);
  if (categories) {
    await pg.exec(`create table public.categories(code text primary key, name text, cls text, data jsonb); grant select on public.categories to service_role;`);
    for (const [code, cls] of categories) await pg.query('insert into public.categories values($1,$1,$2,$3)', [code, cls, JSON.stringify({ code, cls })]);
  }
  for (const [k, r] of [['gm', 'gm'], ['office', 'office'], ['crew', 'office_crew'], ['ceo', 'ceo']]) await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, 'e-' + k]);
  await pg.exec(`insert into employees values ('e-office','Akane Sample'),('e-gm','Gina Sample');`);
  await pg.exec(SQL);
  await pg.query(`update invoice_settings set value=jsonb_build_object('key',$1::text,'enabled',true) where key='worker'`, [WORKER_KEY]);
  await pg.exec(`
    update invoice_settings set value=value||'{"intake":false,"mirror":true,"start_at":"2026-10-01T00:00:00Z"}' where key='mode';
    update invoice_settings set value=value||'{"closed_through":"2026-08"}' where key='rules';
    update invoice_settings set value=value||'{"route":"external","enabled":true,"since":"${SINCE}"}' where key='qb';
    insert into invoice_stores(store_id,label,active) values('F06','LaLa',true),('F01','ToriTon',true),('F04-K','Kaimuki',true),('F99','Closed',false);
    insert into invoice_vendor_rules(vendor_key,display_name,food_kind) values('minato','Minato Seika','food'),('clean','Clean Co','nonfood'),('nokind','No Kind Co',null),
     ('fish','Umi Fish','food');`);
  await pg.exec('set role service_role');
  const q = async (sql, p = []) => (await pg.query(sql, p)).rows;
  let n = 0;
  // One document straight into the tables, the way the intake leaves it (status, reconciliation, QuickBooks ledger row, app copy).
  async function doc({ store = 'F06', vk = 'minato', type = 'invoice', status = 'posted', total = 10000, date = '2026-10-05', recon = 'reconciled',
    qb = 'sent', created = '2026-10-14T00:00:00Z', ingested = null, source = 'drive', lines = [[null, null]], fk, reasons = [], related = null, relation = 'credit_for',
    mirror = undefined, currency = 'USD', adj = false, mode = 'manual', name = null, sha = null } = {}) {
    n++;
    const sh = sha || n.toString(16).padStart(64, '0');
    const [f] = await q(`insert into invoice_files(drive_file_id,store_id,source,original_name,current_name,drive_created_at,current_sha256,intake_status,ingested_at)
      values($1,$2,$3,$4,$4,$5,$6,'posted',$7) returning id`, ['drv' + n, store, source, name || ('scan' + n + '.pdf'), created, sh, ingested || created]);
    const kind = fk !== undefined ? fk : (vk === 'clean' ? 'nonfood' : vk === 'nokind' ? null : 'food');
    const linesIn = lines.map(l => (Array.isArray(l) ? l : [l, null]));
    const lineAmt = linesIn.reduce((a, [x]) => a + (x == null ? 0 : x), 0);
    const [d] = await q(`insert into invoice_docs(source_key,file_id,sha256,internal_no,store_id,doc_type,posting_kind,vendor_key,vendor_name,vendor_raw,food_kind,invoice_no,
       invoice_date,effective_date,currency,total_cents,subtotal_cents,tax_cents,status,recon_status,recon_by,recon_at,reasons,related_doc_id,relation,posted_mode,posted_at,needs_adjustment)
      values($1,$2,$3,$4,$5,$6,'purchase',$7,(select display_name from invoice_vendor_rules where vendor_key=$7),$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,
       case when $16='reconciled' then now() end,$18,$19,$20,case when $15='posted' then $21 end,case when $15='posted' then now() end,$22) returning id`,
      ['k' + n, f.id, sh, 'INT-' + n, store, type, vk, kind, String(5000 + n), date, currency, total, lineAmt, total == null ? null : total - lineAmt, status, recon,
        recon === 'reconciled' ? U.office : null, JSON.stringify(reasons.map(code => ({ code }))), related, related ? relation : null, mode, adj]);
    let i = 0;
    for (const [amt, code] of linesIn) { i++; await q(`insert into invoice_lines(doc_id,line_no,raw_name,raw,qty,amount_cents,ingredient_code) values($1,$2,$3,'{}',1,$4,$5)`, [d.id, i, 'item ' + i, amt, code]); }
    if (qb) await q(`insert into invoice_qb_outbox(file_id,sha256,to_address,route,state,attempt_key,sent_at) values($1,$2,'qb@example.test','external',$3,$4,case when $3='sent' then now() end)`,
      [f.id, sh, qb, 'qb-' + sh]);
    if (mirror) await q(`insert into invoice_app_mirror(doc_id,app_inv_id,store_id,state) values($1,$2,$3,$4)`, [d.id, 'drv_INT-' + n, store, mirror]);
    return { id: d.id, file: f.id, sha: sh, n };
  }
  const month = async ym => (await q(`select public.invoice_purchase_month($1) v`, [ym]))[0].v;
  const publish = async (p = {}) => (await q(`select public.invoice_purchase_publish($1::jsonb) v`, [JSON.stringify(p)]))[0].v;
  const state = async key => { const r = await q(`select value from app_state where key=$1`, [key]); return r.length ? r[0].value : null; };
  const users = { 'tok-gm': U.gm, 'tok-office': U.office, 'tok-crew': U.crew, 'tok-ceo': U.ceo, 'tok-other': U.other };
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const drive = { async get() { return { status: 404 } }, async listFolder() { return { files: [], next: null }; } };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, fetch, db, drive, ai: async () => ({ ok: false }), now: () => Date.parse('2026-10-14T20:00:00Z') });
  const call = async (body, headers = {}) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const api = (tok, body) => call(body, tok ? { authorization: 'Bearer ' + tok } : {});
  return { pg, q, doc, month, publish, state, call, api, worker: () => call({ action: 'worker' }, { 'x-invoice-worker-key': WORKER_KEY }) };
}

const tot = (s, cat) => (s.tot[cat] || { n: 0, c: 0, u: 0, cost: 0, non: 0, unc: 0 });
const N = x => Number(x);
const byId = (s, id) => s.docs.find(d => d.id === id);

test('the fixed example of the request: confirmed $1,100 for cost, $200 not for cost, $1,300 net; $500 not forwarded; $400 waiting', async () => {
  const E = await setup();
  const inv = await E.doc({ total: 140000, lines: [[120000, 'I-MISO'], [20000, 'I-GLOVE']] });                 // 食材 1,200 + 消耗品 200
  const cm = await E.doc({ type: 'credit_memo', total: 10000, lines: [[10000, 'I-MISO']], related: inv.id });   // 食材の返品 100
  await E.doc({ total: 50000, lines: [[50000, 'I-MISO']], qb: 'pending' });                                   // 確認済み・未転送 500
  await E.doc({ total: 40000, lines: [[40000, 'I-MISO']], recon: 'unreconciled' });                           // 未確認 400
  const s = (await E.month('2026-10')).summary.stores.F06;
  assert.deepEqual([N(tot(s, 'A').cost), N(tot(s, 'A').non), N(tot(s, 'A').c), N(tot(s, 'A').n)], [110000, 20000, 130000, 2]);
  assert.deepEqual([N(tot(s, 'B').c), N(tot(s, 'B').n), N(tot(s, 'C').c), N(tot(s, 'C').n)], [50000, 1, 40000, 1]);
  assert.deepEqual(s.tot.B.by, { qb_pending: { n: 1, c: 50000, u: 0 } });
  assert.deepEqual(s.tot.C.by, { unreconciled: { n: 1, c: 40000, u: 0 } });
  assert.deepEqual(s.cls, { food: 110000, liquor: 0, beverage: 0, supply: 20000, nonfood: 0 });
  assert.deepEqual(s.cr, { n: 1, c: -10000 });
  const c = byId(s, cm.id);
  assert.equal(c.t, 'c'); assert.equal(N(c.c), -10000); assert.equal(N(c.cost), -10000); assert.equal(c.rel, 'credit_for'); assert.equal(c.rno, '5001');
  const v = s.vendors.find(x => x.k === 'minato');
  assert.deepEqual([v.a.n, N(v.a.c), N(v.a.cost), N(v.a.non), v.cr.n, N(v.cr.c), v.p.n, N(v.p.c)], [2, 130000, 110000, 20000, 1, -10000, 2, 90000]);
  // 仕入率 (棚卸未反映) = 1,100 ÷ 10,000 = 11.0%; 原価 = 2,000 + 1,100 + 100 − 50 − 1,800 = 1,350 → 13.5% (the app computes these; tests/invoice-purchase-ui.test.mjs)
  assert.equal(Math.round(N(tot(s, 'A').cost) / 1000000 * 1000) / 10, 11);
});

test('lines take tax, shipping and discounts in proportion, in whole cents that add up to the total', async () => {
  const E = await setup();
  const a = await E.doc({ store: 'F01', total: 10301, lines: [[3333, null], [6667, null], [0, null]] });      // +$3.01 tax/shipping
  const b = await E.doc({ store: 'F01', total: 9000, lines: [[6000, 'I-MISO'], [4000, 'I-GLOVE']] });       // −$10.00 discount
  const c = await E.doc({ store: 'F01', total: 5000, lines: [] });                                           // no lines: the vendor's class
  const d = await E.doc({ store: 'F01', total: 12000, lines: [[13000, 'I-MISO'], [-2000, 'I-GLOVE']] });    // a returned line inside the invoice
  const m = await E.month('2026-10');
  const L = m.lines.F01;
  assert.deepEqual(L[a.id].l.map(x => N(x[5])), [3433, 6868, 0]);
  assert.deepEqual(L[b.id].l.map(x => [N(x[5]), x[6], x[7]]), [[5400, 'food', 'm'], [3600, 'supply', 'm']]);
  assert.deepEqual([L[c.id].l, N(L[c.id].u), L[c.id].uc], [[], 5000, 'food']);
  assert.deepEqual(L[d.id].l.map(x => N(x[5])), [14000, -2000]);           // tax goes to the bought line; the return keeps its own amount
  for (const doc of m.summary.stores.F01.docs) assert.equal(N(doc.cost) + N(doc.non) + N(doc.unc), N(doc.c), 'cost + not for cost + unclassified = the original total');
  assert.deepEqual([N(byId(m.summary.stores.F01, b.id).cost), N(byId(m.summary.stores.F01, b.id).non)], [5400, 3600]);
  assert.deepEqual([N(byId(m.summary.stores.F01, a.id).pc), N(byId(m.summary.stores.F01, b.id).pc)], [10301, 0], 'provisional (by vendor) only where no product is mapped');
});

test('2・3・4: reconciled but not sent is B; automatic and sent but not reconciled is C; sending, error, unknown and none are B', async () => {
  const E = await setup();
  const ids = {};
  for (const st of ['pending', 'sending', 'error', 'unknown']) ids[st] = (await E.doc({ qb: st })).id;
  ids.none = (await E.doc({ qb: null })).id;                                         // put in Drive after the ledger started, not queued yet
  ids.auto = (await E.doc({ mode: 'auto', recon: 'unreconciled', qb: 'sent' })).id;   // automatic and forwarded, nobody reconciled it
  ids.diff = (await E.doc({ recon: 'discrepancy', qb: 'sent' })).id;
  ids.review = (await E.doc({ status: 'review', recon: 'unreconciled', qb: null })).id;
  ids.noamt = (await E.doc({ status: 'review', recon: 'unreconciled', qb: null, total: null, lines: [[null, null]] })).id;
  ids.unread = (await E.doc({ status: 'review', type: 'unknown', recon: 'unreconciled', qb: null, total: null, lines: [] })).id;
  const s = (await E.month('2026-10')).summary.stores.F06;
  for (const st of ['pending', 'sending', 'error', 'unknown', 'none']) { assert.equal(byId(s, ids[st]).cat, 'B', st); assert.deepEqual(byId(s, ids[st]).why, ['qb_' + st]); }
  assert.deepEqual([byId(s, ids.auto).cat, byId(s, ids.auto).why], ['C', ['unreconciled']]);
  assert.deepEqual([byId(s, ids.diff).cat, byId(s, ids.diff).why], ['C', ['discrepancy']]);
  assert.deepEqual([byId(s, ids.review).cat, byId(s, ids.review).why], ['C', ['review']]);
  assert.deepEqual([byId(s, ids.noamt).cat, byId(s, ids.noamt).why, byId(s, ids.noamt).c], ['C', ['review', 'no_amount'], null]);
  assert.deepEqual([byId(s, ids.unread).cat, byId(s, ids.unread).why], ['C', ['review', 'unreadable', 'no_amount']]);
  assert.deepEqual([tot(s, 'B').n, N(tot(s, 'B').c), tot(s, 'C').n, N(tot(s, 'C').c), tot(s, 'C').u], [5, 50000, 5, 30000, 2], 'an unknown amount is counted, never as $0');
  assert.equal(tot(s, 'A').n, 0);
});

test('4・7: no class, several stores on one page, not USD and a closed-month adjustment are held (E), each counted once', async () => {
  const E = await setup();
  const noclass = await E.doc({ vk: 'nokind', total: 999 });
  const multi = await E.doc({ total: 3000, reasons: ['multi_store', 'app_duplicate_candidate'] });
  const jpy = await E.doc({ total: 2000, currency: 'JPY' });
  const adj = await E.doc({ total: 1500, adj: true, reasons: ['multi_store'] });
  const mapped = await E.doc({ vk: 'nokind', total: 700, lines: [[700, 'I-MISO']] });   // the line's product decides: not held
  const s = (await E.month('2026-10')).summary.stores.F06;
  assert.deepEqual(byId(s, noclass.id).why, ['no_class']); assert.equal(N(byId(s, noclass.id).unc), 999);
  assert.deepEqual(byId(s, multi.id).why, ['multi_store']);
  assert.deepEqual(byId(s, jpy.id).why, ['currency']);
  assert.deepEqual(byId(s, adj.id).why, ['multi_store', 'closed_adjustment']);
  assert.equal(byId(s, mapped.id).cat, 'A');
  assert.deepEqual([tot(s, 'E').n, N(tot(s, 'E').c)], [4, 999 + 3000 + 2000 + 1500], 'held once each although some have two reasons');
  assert.deepEqual(s.tot.E.by, { no_class: { n: 1, c: 999, u: 0 }, multi_store: { n: 2, c: 4500, u: 0 }, currency: { n: 1, c: 2000, u: 0 } });
  assert.deepEqual(s.ad, { n: 0, c: 0 }, 'a held invoice is not also shown as a possible app duplicate');
});

test('8・pre-ledger・start: the invoice month decides; before the ledger, reconciled is enough; taken in before the start, the app counts it', async () => {
  const E = await setup();
  const late = await E.doc({ date: '2026-10-30', created: '2026-11-02T01:00:00Z', qb: 'sent' });   // October invoice, sent and reconciled in November
  const pre = await E.doc({ created: '2026-10-12T20:00:00Z', qb: null });                      // in Drive before qb.since: no ledger row expected
  const preUnrec = await E.doc({ created: '2026-10-12T20:00:00Z', qb: null, recon: 'unreconciled' });
  const after = await E.doc({ created: '2026-10-13T17:00:01Z', qb: null });                    // just after qb.since: must be sent
  const app = await E.doc({ source: 'app', created: '2026-10-15T00:00:00Z', qb: null });        // not a Drive original: never forwarded by the ledger
  const before = await E.doc({ created: '2026-09-30T23:00:00Z', ingested: '2026-09-30T23:00:00Z' });           // taken in before the start, not copied
  const copied = await E.doc({ created: '2026-09-30T23:00:00Z', ingested: '2026-09-30T23:00:00Z', mirror: 'mirrored' });   // copied under an earlier start
  const deleted = await E.doc({ mirror: 'tombstoned' });                                      // its app copy was deleted in the app
  const oct = (await E.month('2026-10')).summary.stores.F06, nov = (await E.month('2026-11')).summary.stores.F06;
  assert.equal(byId(oct, late.id).cat, 'A'); assert.equal(nov.docs.length, 0);
  assert.deepEqual([byId(oct, pre.id).cat, byId(oct, pre.id).why], ['A', ['pre_ledger']]);
  assert.equal(byId(oct, preUnrec.id).cat, 'C');
  assert.deepEqual([byId(oct, after.id).cat, byId(oct, after.id).why], ['B', ['qb_none']]);
  assert.deepEqual([byId(oct, app.id).cat, byId(oct, app.id).why], ['A', ['pre_ledger']]);
  assert.deepEqual([byId(oct, before.id).cat, byId(oct, before.id).why], ['E', ['before_start']]);
  assert.equal(byId(oct, copied.id).cat, 'A');
  assert.deepEqual([byId(oct, deleted.id).cat, byId(oct, deleted.id).why], ['E', ['deleted_in_app']]);
  assert.deepEqual(oct.pre, { n: 2, c: 20000 });
  // With no qb.since set the ledger never started: nothing is exempted.
  await E.q(`update invoice_settings set value=value-'since' where key='qb'`);
  assert.equal(byId((await E.month('2026-10')).summary.stores.F06, pre.id).cat, 'B');
});

test('5・6: renaming, resending, repeated results and publishing again add nothing; credits, corrections, rejects and duplicates count once', async () => {
  const E = await setup();
  const a = await E.doc({ total: 20000, qb: 'error' });
  // resent: the error row is cancelled (the ledger keeps one live row per content and address) and a new send is recorded twice
  await E.q(`update invoice_qb_outbox set state='cancelled' where sha256=$1`, [a.sha]);
  await E.q(`insert into invoice_qb_outbox(file_id,sha256,to_address,route,state,attempt_key,sent_at) values($1,$2,'qb@example.test','external','sent','qb-again',now())`, [a.file, a.sha]);
  await E.q(`insert into invoice_qb_outbox(file_id,sha256,to_address,route,state,attempt_key,sent_at) values($1,$2,'other@example.test','external','sent','qb-other',now())`, [a.file, a.sha]);
  await E.q(`update invoice_files set current_name='2026-10-05_Minato-Seika_5001.pdf' where id=$1`, [a.file]);   // renamed in Drive
  const old = await E.doc({ total: 30000, status: 'superseded' });
  const fixed = await E.doc({ total: 31000, related: old.id, relation: 'correction_of' });
  const rej = await E.doc({ total: 4000, status: 'rejected', recon: 'unreconciled', qb: null });
  const dup = await E.doc({ total: 20000, status: 'duplicate', recon: 'unreconciled', qb: null });
  const cm = await E.doc({ type: 'credit_memo', total: -2500, related: a.id });   // printed negative: still −$25 once
  const p1 = await E.publish();
  const s = (await E.state('invoice_purchase_2026-10')).stores.F06;
  assert.deepEqual([tot(s, 'A').n, N(tot(s, 'A').c)], [3, 20000 + 31000 - 2500]);
  assert.deepEqual([tot(s, 'D').n, N(tot(s, 'D').c), s.tot.D.by], [3, 54000, { superseded: { n: 1, c: 30000, u: 0 }, rejected: { n: 1, c: 4000, u: 0 }, duplicate: { n: 1, c: 20000, u: 0 } }]);
  assert.equal(byId(s, a.id).fn, '2026-10-05_Minato-Seika_5001.pdf'); assert.equal(byId(s, a.id).qb, 'sent');
  assert.equal(N(byId(s, cm.id).c), -2500); assert.equal(byId(s, fixed.id).rel, 'correction_of');
  assert.deepEqual(p1.changed, ['2026-10']);
  const p2 = await E.publish();
  assert.deepEqual(p2.changed, [], 'nothing changed: nothing is written again');
  assert.deepEqual((await E.state('invoice_purchase_2026-10')).stores.F06.tot, s.tot);
  // a correction of the amount replaces the invoice's share (never old + new)
  await E.q(`update invoice_docs set total_cents=21000 where id=$1`, [a.id]);
  assert.deepEqual((await E.publish()).changed, ['2026-10']);
  assert.equal(N(tot((await E.state('invoice_purchase_2026-10')).stores.F06, 'A').c), 21000 + 31000 - 2500);
});

test('12・1: more invoices than one list page are all counted; totals equal the sum of the invoices by store, vendor and month', async () => {
  const E = await setup();
  let want = 0;
  for (let i = 0; i < 230; i++) { const t = 1000 + i * 7; want += t; await E.doc({ total: t, vk: i % 3 ? 'minato' : 'fish', date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0') }); }
  const s = (await E.month('2026-10')).summary.stores.F06;
  assert.equal(s.docs.length, 230); assert.equal(tot(s, 'A').n, 230); assert.equal(N(tot(s, 'A').c), want);
  assert.equal(s.vendors.reduce((a, v) => a + N(v.a.c), 0), want);
  assert.equal(s.vendors.reduce((a, v) => a + v.a.n, 0), 230);
});

// An independent model of the rules (written from the request and Moto's answers, not from the SQL) on random invoices.
function model(docs, since, start) {
  const out = {};
  for (const d of docs) {
    const credit = d.type === 'credit_memo', f = d.total != null && d.total < 0 ? -1 : 1, mul = credit ? -1 : f;
    let shares = null, ua = 0;
    if (d.total != null) {
      const tp = BigInt(Math.abs(d.total)), a = d.lines.map(([x]) => BigInt(f * (x ?? 0)));
      const wpos = a.reduce((s, x) => s + (x > 0n ? x : 0n), 0n), wabs = a.reduce((s, x) => s + (x < 0n ? -x : x), 0n);
      const W = wpos > 0n ? wpos : wabs, wt = a.map(x => (wpos > 0n ? (x > 0n ? x : 0n) : (x < 0n ? -x : x)));
      const rem = tp - a.reduce((s, x) => s + x, 0n);
      const fl = wt.map(w => { if (W === 0n) return 0n; const num = rem * w; let q = num / W; if (num % W !== 0n && num < 0n) q -= 1n; return q; });
      const frn = wt.map((w, i) => (W === 0n ? 0n : rem * w - fl[i] * W));
      const k = W === 0n ? 0n : rem - fl.reduce((s, x) => s + x, 0n);
      const order = frn.map((x, i) => i).sort((i, j) => (frn[j] > frn[i] ? 1 : frn[j] < frn[i] ? -1 : i - j));
      shares = a.map((x, i) => x + fl[i] + (order.indexOf(i) < Number(k) ? 1n : 0n));
      ua = Number(tp - shares.reduce((s, x) => s + x, 0n));
      shares = shares.map(Number);
    }
    const cls = d.lines.map(([, c]) => c || (d.fk === 'food' ? 'food' : d.fk === 'nonfood' ? 'nonfood' : 'unclass'));
    const sum = want => (shares ? shares.reduce((s, x, i) => s + (want.includes(cls[i]) ? x : 0), 0) : 0)
      + (want.includes(d.fk === 'food' ? 'food' : d.fk === 'nonfood' ? 'nonfood' : 'unclass') ? ua : 0);
    const cost = sum(['food', 'liquor', 'beverage']), non = sum(['supply', 'nonfood']), unc = sum(['unclass']);
    const link = d.mirror === 'mirrored' ? true : d.mirror === 'tombstoned' ? false : (d.mirror === 'held' || d.mirror === 'error') ? true : Date.parse(d.ingested) >= Date.parse(start);
    const pre = !(d.source === 'drive' && Date.parse(d.created) >= Date.parse(since));
    let cat;
    if (['rejected', 'duplicate', 'superseded'].includes(d.status)) cat = 'D';
    else if (!link) cat = 'E';
    else if (d.status === 'review') cat = 'C';
    else if (d.multi || d.currency !== 'USD' || d.adj || unc !== 0 || d.total == null) cat = 'E';
    else if (d.recon !== 'reconciled') cat = 'C';
    else if (d.qb === 'sent' || pre) cat = 'A';
    else cat = 'B';
    const z = x => (x === 0 ? 0 : x);   // no −0
    out[d.id] = { cat, c: d.total == null ? null : z(mul * Math.abs(d.total)), cost: z(mul * cost), non: z(mul * non), unc: z(mul * unc), store: d.store, ym: d.date.slice(0, 7) };
  }
  return out;
}

test('random invoices: every invoice is in the place the rules give, with the same amounts, and the totals add up', async () => {
  const E = await setup();
  let seed = 20261014;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const docs = [];
  const codes = { 'I-MISO': 'food', 'I-GLOVE': 'supply', 'I-SAKE': 'liquor', 'I-TEA': 'beverage', 'I-OWN': 'supply', 'I-FISH': 'food' };
  for (let i = 0; i < 160; i++) {
    const nLines = Math.floor(rnd() * 5);
    const lines = Array.from({ length: nLines }, () => [rnd() < 0.08 ? null : Math.floor(rnd() * 40000) - (rnd() < 0.15 ? 30000 : 0), rnd() < 0.4 ? pick(Object.keys(codes)) : null]);
    const sum = lines.reduce((a, [x]) => a + (x ?? 0), 0);
    const status = pick(['posted', 'posted', 'posted', 'posted', 'review', 'rejected', 'duplicate', 'superseded']);
    const total = status === 'review' && rnd() < 0.2 ? null : sum + Math.floor(rnd() * 3000) - 900;
    const d = { store: pick(['F06', 'F01', 'F04-K']), vk: pick(['minato', 'clean', 'nokind', 'fish']), type: rnd() < 0.15 ? 'credit_memo' : 'invoice', status, total,
      date: pick(['2026-10-', '2026-11-']) + String(1 + Math.floor(rnd() * 28)).padStart(2, '0'),
      recon: pick(['reconciled', 'reconciled', 'unreconciled', 'discrepancy']), qb: pick(['sent', 'sent', 'pending', 'sending', 'error', 'unknown', null]),
      created: pick(['2026-10-12T20:00:00Z', '2026-10-14T00:00:00Z', '2026-11-03T00:00:00Z']), source: rnd() < 0.1 ? 'app' : 'drive',
      mirror: pick([undefined, undefined, 'mirrored', 'tombstoned', 'held', 'error']), lines, adj: rnd() < 0.05, currency: rnd() < 0.05 ? 'CAD' : 'USD' };
    d.ingested = rnd() < 0.15 ? '2026-09-29T00:00:00Z' : d.created;
    d.multi = rnd() < 0.06;
    d.fk = d.vk === 'clean' ? 'nonfood' : d.vk === 'nokind' ? null : 'food';
    const r = await E.doc({ ...d, lines: lines.map(([x, c]) => [x, c]), reasons: d.multi ? ['multi_store'] : [] });
    docs.push({ ...d, lines: lines.map(([x, c]) => [x, c ? codes[c] : null]), id: r.id });
  }
  const want = model(docs, SINCE, '2026-10-01T00:00:00Z');
  for (const ym of ['2026-10', '2026-11']) {
    const m = await E.month(ym);
    for (const [sid, s] of Object.entries(m.summary.stores)) {
      for (const d of s.docs) {
        const w = want[d.id];
        assert.equal(w.ym, ym); assert.equal(w.store, sid);
        assert.deepEqual([d.cat, d.c == null ? null : N(d.c), N(d.cost), N(d.non), N(d.unc)], [w.cat, w.c, w.cost, w.non, w.unc], JSON.stringify(docs.find(x => x.id === d.id)));
        if (d.c != null) assert.equal(N(d.cost) + N(d.non) + N(d.unc), N(d.c));
        const lines = m.lines[sid][d.id];
        if (d.c != null) assert.equal(lines.l.reduce((a, l) => a + N(l[5]), 0) + N(lines.u || 0), N(d.c), 'the line shares and what no line carries add up to the total');
      }
      for (const cat of ['A', 'B', 'C', 'D', 'E']) {
        const mine = s.docs.filter(d => d.cat === cat);
        assert.equal(tot(s, cat).n, mine.length, sid + cat);
        assert.equal(N(tot(s, cat).c), mine.reduce((a, d) => a + (d.c == null ? 0 : N(d.c)), 0), sid + cat);
        assert.equal(N(tot(s, cat).cost), mine.reduce((a, d) => a + N(d.cost), 0), sid + cat);
      }
      assert.equal(s.vendors.reduce((a, v) => a + N((v.a || {}).c || 0), 0), N(tot(s, 'A').c));
    }
    assert.equal(Object.values(m.summary.stores).reduce((a, s) => a + s.docs.length, 0), docs.filter(d => d.date.startsWith(ym)).length, 'every invoice of the month once');
  }
});

test('classes: the item\'s own class, its category (the table when there is one, the app\'s defaults otherwise) and merged categories', async () => {
  const E = await setup();
  const r = (await E.q(`select public.invoice_purchase_classes(array['I-MISO','I-GLOVE','I-SAKE','I-TEA','I-OWN','I-FISH','I-NONE']) v`))[0].v;
  assert.deepEqual(r, { 'I-MISO': 'food', 'I-GLOVE': 'supply', 'I-SAKE': 'liquor', 'I-TEA': 'beverage', 'I-OWN': 'supply', 'I-FISH': 'food' });
  const E2 = await setup({ categories: [['1000', 'beverage'], ['40000', 'supply'], ['6000', 'liquor']] });
  const r2 = (await E2.q(`select public.invoice_purchase_classes(array['I-MISO','I-GLOVE','I-SAKE','I-OWN','I-FISH']) v`))[0].v;
  assert.deepEqual(r2, { 'I-MISO': 'beverage', 'I-GLOVE': 'supply', 'I-SAKE': 'food', 'I-OWN': 'supply', 'I-FISH': 'liquor' }, 'a category missing from the table is food, like the app');
});

test('publishing: rows for the app, a closed month kept as it was, the switch to stop, and no browser access', async () => {
  const E = await setup();
  await E.doc({ total: 1000, date: '2026-08-20', created: '2026-10-14T00:00:00Z' });   // closed month (2026-08), never published yet
  await E.doc({ total: 2000 });
  const p = await E.publish();
  assert.deepEqual([p.changed, p.frozen], [['2026-08', '2026-10'], []]);
  const aug = await E.state('invoice_purchase_2026-08');
  assert.equal(aug.closed, true); assert.equal(N(tot(aug.stores.F06, 'A').c), 1000);
  const st = await E.state('invoice_purchase_status');
  assert.ok(st.checked_at && st.months['2026-10'].at && st.months['2026-08'].closed === true && st.months['2026-10'].closed === false);
  const lines = await E.state('invoice_purchase_lines_2026-10_F06');
  assert.equal(lines.store, 'F06'); assert.equal(Object.keys(lines.docs).length, 1);
  // a later change in the closed month is not written (the closing procedure decides); force writes it
  await E.doc({ total: 500, date: '2026-08-21' });
  const p2 = await E.publish();
  assert.deepEqual([p2.changed, p2.frozen], [[], ['2026-08']]);
  assert.equal(N(tot((await E.state('invoice_purchase_2026-08')).stores.F06, 'A').c), 1000);
  assert.deepEqual((await E.publish({ months: ['2026-08'], force: true })).changed, ['2026-08']);
  assert.equal(N(tot((await E.state('invoice_purchase_2026-08')).stores.F06, 'A').c), 1500);
  // stores: the active ones even with no invoice, and an inactive one only with invoices
  const oct = await E.state('invoice_purchase_2026-10');
  assert.deepEqual(Object.keys(oct.stores).sort(), ['F01', 'F04-K', 'F06']);
  // stop / start
  await E.pg.exec(fs.readFileSync(new URL('../db/invoice-purchase-stop.sql', import.meta.url), 'utf8'));
  assert.equal((await E.state('invoice_purchase_status')).off, true);
  await E.doc({ total: 700 });
  assert.equal((await E.publish()).off, true);
  await E.pg.exec(fs.readFileSync(new URL('../db/invoice-purchase-start.sql', import.meta.url), 'utf8'));
  assert.equal((await E.state('invoice_purchase_status')).off, undefined);
  assert.equal(N(tot((await E.state('invoice_purchase_2026-10')).stores.F06, 'A').c), 2700);
  // browsers cannot read the new tables or run the new functions
  await E.pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['invoice_purchase_checks', 'invoice_purchase_published'])
      assert.equal((await E.q(`select has_table_privilege($1, 'public.' || $2, 'select,insert,update,delete') v`, [role, t]))[0].v, false);
    for (const f of ['invoice_purchase_classes(text[])', 'invoice_purchase_month(text)', 'invoice_purchase_publish(jsonb)', 'invoice_purchase_check(jsonb)'])
      assert.equal((await E.q(`select has_function_privilege($1, 'public.' || $2, 'execute') v`, [role, f]))[0].v, false);
  }
});

test('11: the statement check is for accounting, 事務Crew, GM and CEO; checked on the server; shown with who and when', async () => {
  const E = await setup();
  await E.doc({ total: 2000 });
  const body = { action: 'purchase_check', store_id: 'F06', vendor_key: 'minato', ym: '2026-10', state: 'complete', statement_cents: 2000 };
  assert.equal((await E.api(null, body)).status, 401);
  assert.equal((await E.api('tok-other', body)).status, 403, 'an account without an invoice role');
  assert.equal((await E.api('tok-office', { ...body, state: 'missing' })).body.error, 'note_required');
  assert.equal((await E.api('tok-office', { ...body, state: 'maybe' })).body.error, 'bad_value');
  assert.equal((await E.api('tok-office', { ...body, ym: '2026-13' })).body.error, 'bad_value');
  assert.equal((await E.api('tok-office', { ...body, ym: '2099-01' })).body.error, 'bad_value', 'not a future month');
  assert.equal((await E.api('tok-office', { ...body, statement_cents: 12.5 })).body.error, 'bad_value');
  assert.equal((await E.api('tok-office', { ...body, vendor_key: 'nobody' })).status, 404);
  assert.equal((await E.api('tok-office', { ...body, store_id: 'F77' })).status, 404);
  assert.equal((await E.api('tok-office', { ...body, ym: '2026-08' })).body.error, 'closed_month');
  const ok = await E.api('tok-crew', body);
  assert.equal(ok.status, 200); assert.equal(ok.body.ok, true); assert.equal(ok.body.summary, true, 'the summary was written at once');
  let v = (await E.state('invoice_purchase_2026-10')).stores.F06.vendors.find(x => x.k === 'minato');
  assert.deepEqual([v.chk.s, N(v.chk.sc), v.chk.after], ['complete', 2000, 0]);
  // an invoice that comes in after the check is pointed out
  await E.doc({ total: 300, created: '2099-01-01T00:00:00Z' });
  await E.publish();
  v = (await E.state('invoice_purchase_2026-10')).stores.F06.vendors.find(x => x.k === 'minato');
  assert.equal(N(v.chk.after), 1);
  // missing, with what is missing; then cleared; a vendor with no invoice this month can be recorded too
  await E.api('tok-office', { ...body, state: 'missing', note: '10/12 の 1 枚が届いていない', statement_cents: null });
  v = (await E.state('invoice_purchase_2026-10')).stores.F06.vendors.find(x => x.k === 'minato');
  assert.deepEqual([v.chk.s, v.chk.note, v.chk.by, v.chk.sc], ['missing', '10/12 の 1 枚が届いていない', 'Akane Sample', null]);
  await E.api('tok-gm', { ...body, vendor_key: 'clean', state: 'missing', note: '請求明細に 2 枚あるが 0 枚' });
  const cl = (await E.state('invoice_purchase_2026-10')).stores.F06.vendors.find(x => x.k === 'clean');
  assert.deepEqual([cl.chk.s, cl.chk.by, cl.a], ['missing', 'Gina Sample', undefined]);
  await E.api('tok-office', { ...body, state: 'none' });
  v = (await E.state('invoice_purchase_2026-10')).stores.F06.vendors.find(x => x.k === 'minato');
  assert.equal(v.chk, null);
  assert.equal((await E.q(`select count(*)::int n from invoice_purchase_checks`))[0].n, 4, 'kept as history');
  assert.equal((await E.q(`select count(*)::int n from invoice_events where kind='purchase_check'`))[0].n, 4);
});

test('people\'s actions, the forwarder\'s result and the worker write the summary at once; the action stands if the summary fails', async () => {
  const E = await setup();
  const a = await E.doc({ total: 4200, recon: 'unreconciled', qb: 'sending' });
  await E.publish();
  const [d] = await E.q(`select version from invoice_docs where id=$1`, [a.id]);
  const r = await E.api('tok-office', { action: 'reconcile', doc_id: a.id, version: d.version, result: 'reconciled' });
  assert.equal(r.status, 200); assert.equal(r.body.summary, true);
  let s = (await E.state('invoice_purchase_2026-10')).stores.F06;
  assert.deepEqual([byId(s, a.id).cat, byId(s, a.id).rby], ['B', 'Akane Sample']);
  // the outside forwarder records the send: confirmed at once
  await E.q(`update invoice_settings set value=jsonb_build_object('key','qb-key-0123456789','enabled',true) where key='qb_external'`);
  const [o] = await E.q(`select id from invoice_qb_outbox where sha256=$1`, [a.sha]);
  const x = await E.call({ action: 'qb_external_result', id: o.id, state: 'sent', message_id: 'm1' }, { 'x-invoice-qb-key': 'qb-key-0123456789' });
  assert.equal(x.status, 200);
  s = (await E.state('invoice_purchase_2026-10')).stores.F06;
  assert.equal(byId(s, a.id).cat, 'A');
  // the worker (intake off) still writes
  const b = await E.doc({ total: 100 });
  const w = await E.worker();
  assert.equal(w.status, 200); assert.equal(w.body.off, true);
  assert.ok(byId((await E.state('invoice_purchase_2026-10')).stores.F06, b.id));
  const [run] = await E.q(`select stats from invoice_runs order by id desc limit 1`);
  assert.equal(run.stats.purchase_published, 1);
  // a broken summary never undoes the action
  await E.q(`update invoice_settings set value=value||'{"start_at":"not a date"}' where key='mode'`);
  await E.pg.exec(`reset role; alter function public.invoice_purchase_publish(jsonb) rename to invoice_purchase_publish_off; set role service_role;`);
  const c = await E.doc({ total: 900, recon: 'unreconciled' });
  const [dc] = await E.q(`select version from invoice_docs where id=$1`, [c.id]);
  const r2 = await E.api('tok-office', { action: 'reconcile', doc_id: c.id, version: dc.version, result: 'reconciled' });
  assert.equal(r2.status, 200); assert.equal(r2.body.summary, false);
  assert.equal((await E.q(`select recon_status from invoice_docs where id=$1`, [c.id]))[0].recon_status, 'reconciled');
});
