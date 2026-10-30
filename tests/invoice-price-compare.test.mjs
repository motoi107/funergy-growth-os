// 仕入れの単価を比べる（10/30 の依頼 ②）: the comparison the app reads (app_state 'invoice_purchase_prices').
// The real schema (db/invoice-intake.sql = every invoice migration) on PGlite; synthetic stores, vendors, products and invoices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(process.env.INVOICE_SQL || new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.app_state(key text primary key, value json, updated_at timestamptz);`);
  await pg.exec(SQL);
  await pg.exec(`insert into invoice_stores(store_id, label, active) values ('F01','F01',true),('F02','F02',true)`);
  let n = 0;
  // One invoice: its lines [{ code, spec, pu, qty, ppp, amt, pc, cu, pb, bu }], posted by a person (default) or as given.
  const inv = async ({ store = 'F01', vendor = 'v-a', vname = 'Vendor A', date, no, mode = 'manual', recon = 'unreconciled', status = 'posted', reasons = [], lines }) => {
    n++;
    const f = (await pg.query(`insert into invoice_files(drive_file_id, store_id, original_name, current_name) values($1,$2,$3,$3) returning id`, ['drv' + n, store, 'inv' + n + '.pdf'])).rows[0].id;
    const d = (await pg.query(`insert into invoice_docs(source_key, file_id, sha256, internal_no, store_id, doc_type, posting_kind, vendor_key, vendor_name,
        invoice_no, invoice_no_norm, invoice_date, effective_date, effective_basis, status, posted_mode, recon_status, reasons)
      values($1,$2,$3,$4,$5,'invoice','purchase',$6,$7,$8,$8,$9,$9,'invoice',$10,$11,$12,$13) returning id`,
      ['src' + n, f, 'sha' + n, 'INT-' + n, store, vendor, vname, no || String(1000 + n), date, status, status === 'posted' ? mode : null, recon, JSON.stringify(reasons)])).rows[0].id;
    let i = 0;
    for (const l of lines) {
      i++;
      const lid = (await pg.query(`insert into invoice_lines(doc_id, line_no, raw_name, raw, qty, amount_cents, ingredient_code, page) values($1,$2,$3,'{}',$4,$5,$6,1) returning id`,
        [d, i, 'item ' + l.code, l.qty ?? 1, l.amt ?? Math.round((l.qty ?? 1) * l.ppp * 100), l.code])).rows[0].id;
      await pg.query(`insert into invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, doc_id, line_id, effective_date, effective_basis,
          invoice_date, invoice_no_norm, price_per_purchase, price_per_count, count_unit, price_per_base, base_unit, created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,'invoice',$8,$9,$10,$11,$12,$13,$14,'test')`,
        [store, vendor, l.code, l.spec ?? '', l.pu ?? 'CS', d, lid, date, no || String(1000 + n), l.ppp, l.pc ?? null, l.cu ?? null, l.pb ?? null, l.bu ?? null]);
    }
    return d;
  };
  const publish = async (p = {}) => (await pg.query(`select public.invoice_price_compare_publish($1::jsonb) v`, [JSON.stringify(p)])).rows[0].v;
  const row = async () => { const r = (await pg.query(`select value::text v from app_state where key='invoice_purchase_prices'`)).rows[0]; return r ? JSON.parse(r.v) : null; };
  const group = async (code, store = 'F01') => (await row()).groups.find(g => g.c === code && g.s === store);
  return { pg, inv, publish, row, group };
}
const today = new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);
const day = k => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };

test('the request’s example: 2 cases of 12 at $120 then 4 cases at $240 is $5 a piece both times — not a rise; a real change is', async () => {
  const S = await setup();
  // 12 pieces a case: the mapping gives a count unit (EA) and 12 per case → price per piece
  await S.inv({ date: day(30), lines: [{ code: 'A1', spec: '12EA', qty: 2, ppp: 60, amt: 12000, pc: 5, cu: 'ea' }] });
  await S.inv({ date: day(10), lines: [{ code: 'A1', spec: '12EA', qty: 4, ppp: 60, amt: 24000, pc: 5, cu: 'ea' }] });
  assert.equal((await S.publish()).changed, true);
  let g = await S.group('A1');
  assert.deepEqual([g.st, g.u, Number(g.v), Number(g.pv), Number(g.pct)], ['same', 'EA', 5, 5, 0]);
  assert.equal(g.obs.length, 2); assert.deepEqual(g.obs.map(o => Number(o.q)), [4, 2]); assert.deepEqual(g.obs.map(o => Number(o.amt)), [24000, 12000]);
  // a price change: $66 a case → $5.50 a piece, +10 %
  await S.inv({ date: day(2), lines: [{ code: 'A1', spec: '12EA', qty: 1, ppp: 66, pc: 5.5, cu: 'ea' }] });
  await S.publish(); g = await S.group('A1');
  assert.deepEqual([g.st, Number(g.v), Number(g.pv), Number(g.dv), Number(g.pct)], ['up', 5.5, 5, 0.5, 10]);
});

test('weight and volume: per 1 LB from grams or from a purchase unit of KG / LB; per 1 L from ml or GAL; another pack size is another row', async () => {
  const S = await setup();
  // 50 LB bag: base g → per LB
  await S.inv({ date: day(20), lines: [{ code: 'R1', spec: '50LB', pu: 'BAG', ppp: 45, pb: 45 / (50 * 453.59237), bu: 'g' }] });
  await S.inv({ date: day(5), lines: [{ code: 'R1', spec: '50LB', pu: 'BAG', ppp: 47.5, pb: 47.5 / (50 * 453.59237), bu: 'g' }] });
  // bought by the KG without a spec, then by the KG again
  await S.inv({ date: day(20), lines: [{ code: 'M1', pu: 'KG', ppp: 10 }] });
  await S.inv({ date: day(4), lines: [{ code: 'M1', pu: 'KG', ppp: 11 }] });
  // oil by the gallon
  await S.inv({ date: day(20), lines: [{ code: 'O1', pu: 'GAL', ppp: 18.927059 }] });
  // the same rice in a 25 LB bag: another spec → another row, never compared with the 50 LB bag
  await S.inv({ date: day(3), lines: [{ code: 'R1', spec: '25LB', pu: 'BAG', ppp: 30, pb: 30 / (25 * 453.59237), bu: 'g' }] });
  await S.publish();
  const r = (await S.row()).groups.filter(g => g.c === 'R1');
  assert.equal(r.length, 2);
  const b50 = r.find(g => g.sp === '50LB'), b25 = r.find(g => g.sp === '25LB');
  assert.deepEqual([b50.st, b50.u, Number(b50.v), Number(b50.pv), Number(b50.pct)], ['up', 'LB', 0.95, 0.9, 5.6]);
  assert.deepEqual([b25.st, b25.u, Number(b25.v)], ['first', 'LB', 1.2]);
  const m = await S.group('M1');
  assert.deepEqual([m.st, m.u, m.by, Number(m.v), Number(m.pv), Number(m.pct)], ['up', 'LB', 'unit', 4.989516, 4.535924, 10]);
  const o = await S.group('O1');
  assert.deepEqual([o.st, o.u, Number(o.v)], ['first', 'L', 5]);
});

test('not enough to compare: no spec and a purchase unit that is not a measure → 比較不可 (never $0 or a guess); two prices on one invoice → 結びの確認; over ±50 % → 要確認', async () => {
  const S = await setup();
  await S.inv({ date: day(20), lines: [{ code: 'C1', pu: 'CS', ppp: 40 }] });
  await S.inv({ date: day(2), lines: [{ code: 'C1', pu: 'CS', ppp: 44 }] });
  await S.inv({ date: day(20), lines: [{ code: 'D1', spec: '6EA', ppp: 30, pc: 5, cu: 'ea' }] });
  await S.inv({ date: day(2), lines: [{ code: 'D1', spec: '6EA', ppp: 30, pc: 5, cu: 'ea' }, { code: 'D1', spec: '6EA', ppp: 36, pc: 6, cu: 'ea' }] });
  await S.inv({ date: day(20), lines: [{ code: 'J1', spec: '10EA', ppp: 20, pc: 2, cu: 'ea' }] });
  await S.inv({ date: day(2), lines: [{ code: 'J1', spec: '10EA', ppp: 32, pc: 3.2, cu: 'ea' }] });
  await S.inv({ date: day(20), lines: [{ code: 'J2', spec: '10EA', ppp: 20, pc: 2, cu: 'ea' }] });
  await S.inv({ date: day(2), lines: [{ code: 'J2', spec: '10EA', ppp: 9, pc: 0.9, cu: 'ea' }] });
  await S.publish();
  const c = await S.group('C1');
  assert.deepEqual([c.st, c.v, c.pv, c.pct, c.u], ['no_spec', null, null, null, null]);
  assert.deepEqual(c.obs.map(o => Number(o.ppp)), [44, 40], 'the case prices are still shown as they were');
  const d = await S.group('D1');
  assert.equal(d.st, 'check_link'); assert.equal(d.pct, null); assert.equal(d.obs.filter(o => o.two).length, 2);
  const j1 = await S.group('J1'), j2 = await S.group('J2');
  assert.deepEqual([j1.st, Number(j1.pct)], ['check_jump', 60]); assert.deepEqual([j2.st, Number(j2.pct)], ['check_jump', -55]);
  const st = (await S.row()).stats;
  assert.deepEqual([st.no_spec, st.check_link, st.check_jump], [1, 1, 2]);
});

test('the previous price is from another invoice; prices in another unit are not compared; a voided price is not used', async () => {
  const S = await setup();
  // the newest invoice has the item twice at the same price: compared with the invoice before, not with itself
  await S.inv({ date: day(20), lines: [{ code: 'K1', spec: '1EA', ppp: 10, pc: 10, cu: 'ea' }] });
  await S.inv({ date: day(4), lines: [{ code: 'K1', spec: '1EA', qty: 1, ppp: 11, pc: 11, cu: 'ea' }, { code: 'K1', spec: '1EA', qty: 2, ppp: 11, pc: 11, cu: 'ea' }] });
  // the mapping gave a count unit (bags) before, a weight now: another unit, not compared
  await S.inv({ date: day(20), lines: [{ code: 'K2', pu: 'CS', ppp: 30, pc: 3, cu: 'bag' }] });
  await S.inv({ date: day(4), lines: [{ code: 'K2', pu: 'CS', ppp: 30, pb: 30 / (20 * 453.59237), bu: 'g' }] });
  // a price voided in between (a link taken back) is not the previous price
  await S.inv({ date: day(30), lines: [{ code: 'K3', spec: '1EA', ppp: 5, pc: 5, cu: 'ea' }] });
  await S.inv({ date: day(15), lines: [{ code: 'K3', spec: '1EA', ppp: 50, pc: 50, cu: 'ea' }] });
  await S.pg.query(`update invoice_price_history set status='voided' where ingredient_code='K3' and price_per_purchase=50`);
  await S.inv({ date: day(3), lines: [{ code: 'K3', spec: '1EA', ppp: 5.5, pc: 5.5, cu: 'ea' }] });
  await S.publish();
  const k1 = await S.group('K1');
  assert.deepEqual([k1.st, Number(k1.v), Number(k1.pv), Number(k1.pct)], ['up', 11, 10, 10]);
  const k2 = await S.group('K2');
  assert.deepEqual([k2.st, k2.u, k2.pv, k2.pct], ['no_spec', 'LB', null, null]);
  assert.deepEqual(k2.obs.map(o => o.u), ['LB', 'BAG']);
  const k3 = await S.group('K3');
  assert.deepEqual([k3.st, Number(k3.pv), Number(k3.pct)], ['up', 5, 10]); assert.deepEqual(k3.obs.map(o => Number(o.ppp)), [5.5, 5]);
});

test('only invoices accounting confirmed: posted by a person or reconciled; auto-posted, a difference, a possible app duplicate and not posted wait (counted, not compared)', async () => {
  const S = await setup();
  await S.inv({ date: day(30), lines: [{ code: 'E1', spec: '1EA', ppp: 10, pc: 10, cu: 'ea' }] });
  const auto = await S.inv({ date: day(20), mode: 'auto', lines: [{ code: 'E1', spec: '1EA', ppp: 20, pc: 20, cu: 'ea' }] });
  await S.inv({ date: day(15), recon: 'discrepancy', lines: [{ code: 'E1', spec: '1EA', ppp: 30, pc: 30, cu: 'ea' }] });
  await S.inv({ date: day(12), reasons: [{ code: 'app_duplicate_candidate' }], lines: [{ code: 'E1', spec: '1EA', ppp: 40, pc: 40, cu: 'ea' }] });
  await S.inv({ date: day(11), status: 'review', lines: [{ code: 'E1', spec: '1EA', ppp: 50, pc: 50, cu: 'ea' }] });
  await S.inv({ date: day(8), lines: [{ code: 'E1', spec: '1EA', ppp: 11, pc: 11, cu: 'ea' }] });
  await S.publish();
  let g = await S.group('E1');
  assert.deepEqual([g.st, Number(g.v), Number(g.pv)], ['up', 11, 10]);
  assert.deepEqual(g.obs.map(o => Number(o.ppp)), [11, 10]);
  assert.equal((await S.row()).stats.waiting, 3, 'auto, the difference and the possible duplicate are posted but wait');
  // reconciling the auto-posted one brings it in (between the two)
  await S.pg.query(`update invoice_docs set recon_status='reconciled' where id=$1`, [auto]);
  await S.publish(); g = await S.group('E1');
  assert.deepEqual(g.obs.map(o => Number(o.ppp)), [11, 20, 10]);
  assert.deepEqual([g.st, Number(g.pv), Number(g.pct)], ['down', 20, -45]);
});

test('per store and per vendor; publishing again with nothing new writes nothing; stopped with the purchase summary; the browser cannot run it; nothing else changes', async () => {
  const S = await setup();
  await S.inv({ store: 'F01', date: day(9), lines: [{ code: 'P1', spec: '1EA', ppp: 3, pc: 3, cu: 'ea' }] });
  await S.inv({ store: 'F02', date: day(4), lines: [{ code: 'P1', spec: '1EA', ppp: 4, pc: 4, cu: 'ea' }] });
  await S.inv({ store: 'F01', vendor: 'v-b', vname: 'Vendor B', date: day(3), lines: [{ code: 'P1', spec: '1EA', ppp: 5, pc: 5, cu: 'ea' }] });
  const snap = async () => (await S.pg.query(`select (select md5(string_agg(to_jsonb(h)::text, '' order by id)) from invoice_price_history h) h,
    (select md5(string_agg(to_jsonb(d)::text, '' order by id)) from invoice_docs d) d, (select md5(string_agg(to_jsonb(l)::text, '' order by id)) from invoice_lines l) l`)).rows[0];
  const before = await snap();
  await S.publish();
  const gs = (await S.row()).groups.filter(g => g.c === 'P1');
  assert.deepEqual(gs.map(g => [g.s, g.vk, g.st, Number(g.v)]).sort(), [['F01', 'v-a', 'first', 3], ['F01', 'v-b', 'first', 5], ['F02', 'v-a', 'first', 4]]);
  assert.deepEqual(await snap(), before, 'the invoices, lines and price history are not changed');
  const at = (await S.row()).generated_at;
  assert.equal((await S.publish()).changed, false); assert.equal((await S.row()).generated_at, at);
  assert.equal((await S.publish({ force: true })).changed, true);
  await S.pg.query(`insert into invoice_settings(key, value) values('purchase', '{"off":true}') on conflict(key) do update set value = invoice_settings.value || '{"off":true}'`);
  await S.publish();
  assert.deepEqual([(await S.row()).off, (await S.row()).groups], [true, undefined]);
  for (const f of ['invoice_price_compare_publish(jsonb)', 'invoice_price_compare_data()', 'invoice_price_cmp(numeric,numeric,text,numeric,text,text)'])
    assert.deepEqual((await S.pg.query(`select has_function_privilege('anon', 'public.${f}', 'execute') a, has_function_privilege('authenticated', 'public.${f}', 'execute') b`)).rows[0], { a: false, b: false }, f);
});

test('the small row for the dashboards: only rises, falls and 要確認 of the last 30 days, without the price lists; written with the full row', async () => {
  const S = await setup();
  await S.inv({ date: day(60), lines: [{ code: 'Q1', spec: '1EA', ppp: 1, pc: 1, cu: 'ea' }, { code: 'Q2', spec: '1EA', ppp: 1, pc: 1, cu: 'ea' }] });
  await S.inv({ date: day(45), lines: [{ code: 'Q1', spec: '1EA', ppp: 1.2, pc: 1.2, cu: 'ea' }] });   // an old rise: not in the small row
  await S.inv({ date: day(5), lines: [{ code: 'Q2', spec: '1EA', ppp: 1.1, pc: 1.1, cu: 'ea' }, { code: 'Q3', spec: '1EA', ppp: 2, pc: 2, cu: 'ea' }] });
  await S.publish();
  const a = JSON.parse((await S.pg.query(`select value::text v from app_state where key='invoice_purchase_prices_alerts'`)).rows[0].v);
  assert.deepEqual(a.groups.map(g => [g.c, g.st]), [['Q2', 'up']]);
  assert.equal(a.groups[0].obs, undefined);
  assert.equal(a.hash, (await S.row()).hash);
});

test('deploy/invoice-price-compare-v1123: copies of the repository files; the one-file function is today’s sources; the steps in order; making it now changes nothing else',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, async () => {
  const crypto = await import('node:crypto');
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-price-compare-v1123/';
  assert.deepEqual(fs.readdirSync(new URL('../' + D, import.meta.url)).sort(), ['1_追加のSQL_単価の比較.sql', '2_確認のSQL_読むだけ.sql', '3_関数_invoice-intake_index.ts', '4_すぐに作る.sql', 'source.json', '手順.md'].sort());
  assert.ok(rd(D + '1_追加のSQL_単価の比較.sql').equals(rd('supabase/migrations/20261103090000_invoice_price_compare.sql')));
  assert.ok(rd(D + '2_確認のSQL_読むだけ.sql').equals(rd('db/invoice-intake-postcheck.sql')));
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  const want = ['supabase/functions/invoice-intake/index.ts', 'supabase/functions/invoice-intake/handler.mjs',
    ...fs.readdirSync(new URL('../invoice/', import.meta.url)).filter(f => f.endsWith('.mjs')).sort().map(f => 'invoice/' + f)];
  assert.deepEqual(Object.keys(src.sources).sort(), want.sort());
  for (const f of want) assert.equal(src.sources[f], sha(rd(f)), f + ' changed after the bundle was built (build it again)');
  const bundle = rd(D + '3_関数_invoice-intake_index.ts').toString();
  assert.ok(!/^\s*import\s/m.test(bundle) && /Deno\.serve\(createHandler/.test(bundle));
  for (const k of ['invoice_price_compare_publish', 'invoice_purchase_publish', 'invoice_link_apply', 'invoice_qb_send_check']) assert.ok(bundle.includes(k), k);
  const steps = rd(D + '手順.md').toString();
  const at = k => { const i = steps.indexOf(k); assert.ok(i >= 0, k); return i; };
  assert.ok(at('1. **Supabase → SQL Editor**') < at('2. `2_確認のSQL') && at('2. `2_確認のSQL') < at('3. **Edge Functions') && at('3. **Edge Functions') < at('4. （すぐ見たいとき）') && at('4. （すぐ見たいとき）') < at('5. アプリ v1123 をマージ'));
  for (const k of ['functions` が 120', 'price_compare` が true', '元の invoice・明細・単価の記録・経理の確認・会計の記録は変えません', 'deploy/invoice-qb-gmail-v1094/3_関数_invoice-intake_index.ts']) assert.ok(steps.includes(k), k);
  // 4_すぐに作る.sql writes only the two rows the app reads
  const S = await setup();
  await S.inv({ date: day(5), lines: [{ code: 'Z1', spec: '1EA', ppp: 2, pc: 2, cu: 'ea' }] });
  await S.pg.exec(rd(D + '4_すぐに作る.sql').toString());
  assert.deepEqual((await S.pg.query(`select key from app_state order by key`)).rows.map(r => r.key), ['invoice_purchase_prices', 'invoice_purchase_prices_alerts']);
});
