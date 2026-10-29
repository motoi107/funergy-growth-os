// The migrations production receives, applied in order, give the same database as db/invoice-intake.sql (which every
// other invoice test runs on). Kept in its own file: the mutation check (tests/invoice-mutations.test.mjs) changes
// db/invoice-intake.sql alone and must see the behaviour tests, not this comparison, notice the change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => /^\d{14}_invoice_.*\.sql$/.test(f)).sort();
const migration = f => fs.readFileSync(new URL(f, dir), 'utf8');
// 紐づけ 段階 1 (20261025090000, Moto 2026-10-18・UI案55) came after every file the older tests below put in: they put it in too.
const S6 = '20261025090000_invoice_item_link.sql';
// QuickBooks からすぐ (20261026090000, Moto 2026-10-18・UI案56) came after 紐づけ: the older tests put it in last too.
const S7 = '20261026090000_invoice_qb_gmail.sql';
// 確認済み＝人の反映か照合済み (20261029100000, Moto 2026-10-29) came after QuickBooks からすぐ: the older tests put it in last too.
const S8 = '20261029100000_invoice_purchase_posted.sql';

const base = `create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);`;
const snap = async pg => {
  const q = async sql => (await pg.query(sql)).rows;
  return {
    columns: await q(`select table_name, ordinal_position, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name like 'invoice\\_%' order by table_name, ordinal_position`),
    constraints: await q(`select c.conrelid::regclass::text t, c.conname, pg_get_constraintdef(c.oid) def from pg_constraint c
      where c.connamespace='public'::regnamespace and c.conrelid::regclass::text like 'invoice\\_%' order by 1, 2`),
    indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename like 'invoice\\_%' order by 1, 2`),
    tables: await q(`select relname, relrowsecurity, relacl::text acl from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'invoice\\_%' order by 1`),
    functions: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) result, l.lanname, p.provolatile,
      p.prosecdef, p.proconfig, p.prosrc, p.proacl::text acl from pg_proc p join pg_language l on l.oid=p.prolang
      where p.pronamespace='public'::regnamespace and p.proname like 'invoice\\_%' order by 1, 2`),
    settings: await q(`select key, value - 'key' value from public.invoice_settings order by key`),
  };
};

// Production received the migrations one by one (20261007090000, then each fix). Applied in that order to an empty database
// set up the way Supabase sets up new objects, they give exactly the database every test here runs on (db/invoice-intake.sql):
// the same tables, columns, defaults, constraints, indexes, row-level security and grants, the same functions (bodies,
// settings, owners' grants) and the same settings (keys aside). Then 20261012120000 again on top changes nothing.
test('the migrations in order give the same database as db/invoice-intake.sql', async () => {
  assert.deepEqual(files, ['20261007090000_invoice_intake.sql', '20261007160000_invoice_intake_review_fixes.sql', '20261007200000_invoice_intake_accounting_checks.sql',
    '20261008090000_invoice_intake_store_folder.sql', '20261009170000_invoice_office_crew_review.sql', '20261009190000_invoice_office_crew_accounting.sql',
    '20261012120000_invoice_rename_after_post.sql', '20261019090000_invoice_purchase_summary.sql', '20261020090000_invoice_reconciled_folder.sql',
    '20261021090000_invoice_multi_file.sql', '20261022090000_invoice_vendor_merge.sql', '20261024090000_invoice_vendor_register.sql',
    '20261025090000_invoice_item_link.sql', '20261026090000_invoice_qb_gmail.sql', '20261029100000_invoice_purchase_posted.sql']);
  const whole = new PGlite(), stepwise = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    await stepwise.exec(base);
    for (const f of files) await stepwise.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    const a = await snap(whole), b = await snap(stepwise);
    assert.ok(a.functions.length === 117 && a.functions.some(f => f.proname === 'invoice_qb_send_check') && a.tables.some(t => t.relname === 'invoice_qb_alerts') && a.tables.some(t => t.relname === 'invoice_purchase_snapshots') && a.functions.some(f => f.proname === 'invoice_link_apply') && a.tables.some(t => t.relname === 'invoice_link_marks') && a.functions.some(f => f.proname === 'invoice_vendor_register') && a.tables.some(t => t.relname === 'invoice_vendor_merges') && a.tables.some(t => t.relname === 'invoice_purchase_checks') && a.columns.some(c => c.table_name === 'invoice_files' && c.column_name === 'rename_state'));
    for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
    // New functions are for the service role only, like every other one (Supabase grants them to the browser roles by default).
    for (const r of a.functions) assert.ok(!/(^|[{,])(anon|authenticated)=/.test(r.acl || ''), r.proname);
    // The last one again on top changes nothing (a production database that already has it).
    await stepwise.exec(fs.readFileSync(new URL(files[files.length - 1], dir), 'utf8'));
    const c = await snap(stepwise);
    for (const k of Object.keys(a)) assert.deepEqual(c[k], a[k], k + ' after running it twice');
  } finally { await whole.close(); await stepwise.close(); }
});

// 段階 3 (20261021090000) replaces invoice_purchase_month, which 20261019090000 makes (with its tables, for the service role only).
// Run without 20261019090000 it would make that function new, open to the browser roles and without its tables: it stops instead
// and changes nothing (2026-10-15). 20261019090000 run again later puts its older invoice_purchase_month back (a merged page
// would be counted again): the check SQL then says multi_file false, and 20261021090000 run again puts its version back.
test('20261021090000 stops, changing nothing, without 20261019090000; run again, it puts its version back', async () => {
  const S1 = '20261019090000_invoice_purchase_summary.sql', S3 = '20261021090000_invoice_multi_file.sql', S4 = '20261022090000_invoice_vendor_merge.sql';
  const S5 = '20261024090000_invoice_vendor_register.sql';
  const post = fs.readFileSync(new URL('../db/invoice-intake-postcheck.sql', import.meta.url), 'utf8');
  const pg = new PGlite(), whole = new PGlite();
  try {
    await pg.exec(base);
    for (const f of files.filter(f => f !== S1 && f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await pg.exec(migration(f));
    const before = await snap(pg);
    await assert.rejects(pg.exec(migration(S3)), /先に 20261019090000_invoice_purchase_summary\.sql を流してください/);
    assert.deepEqual(await snap(pg), before);
    // In order it goes in; 20261019090000 again takes 段階 3 out of invoice_purchase_month, 20261021090000 again puts it back.
    await pg.exec(migration(S1)); await pg.exec(migration(S3));
    const multi = async () => (await pg.query(post)).rows[0].multi_file;
    assert.equal(await multi(), true);
    await pg.exec(migration(S1));
    assert.equal(await multi(), false);
    await pg.exec(migration(S3));
    assert.equal(await multi(), true);
    await pg.exec(migration(S4)); await pg.exec(migration(S5)); await pg.exec(migration(S6)); await pg.exec(migration(S7)); await pg.exec(migration(S8));
    await whole.exec(base); await whole.exec(SQL);
    const a = await snap(whole), b = await snap(pg);
    for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
  } finally { await pg.close(); await whole.close(); }
});

// What goes into production for 段階 3 (deploy/invoice-stage3-v1082): 段階 2 and 段階 3 in one file, in that order. On a database
// with everything before them (production, 2026-10-15) it gives db/invoice-intake.sql, and run again it changes nothing; without
// 20261019090000 it stops at 段階 3 and, run as one statement list (one transaction), leaves the database as it was.
test('deploy/invoice-stage3-v1082: 段階 2 and 段階 3 in one file give db/invoice-intake.sql, twice the same', async () => {
  const S1 = '20261019090000_invoice_purchase_summary.sql', S2 = '20261020090000_invoice_reconciled_folder.sql', S3 = '20261021090000_invoice_multi_file.sql';
  const S4 = '20261022090000_invoice_vendor_merge.sql', S5 = '20261024090000_invoice_vendor_register.sql';
  const both = fs.readFileSync(new URL('../deploy/invoice-stage3-v1082/1_追加のSQL_段階2と段階3.sql', import.meta.url), 'utf8');
  assert.equal(both, migration(S2) + '\n' + migration(S3));
  const pg = new PGlite(), whole = new PGlite(), early = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    const a = await snap(whole);
    await pg.exec(base);
    for (const f of files.filter(f => f !== S2 && f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await pg.exec(migration(f));
    for (const round of [1, 2]) {
      await pg.exec(both);
      await pg.exec(migration(S4)); await pg.exec(migration(S5)); await pg.exec(migration(S6)); await pg.exec(migration(S7)); await pg.exec(migration(S8));   // the whole schema has moved on with 業者の統合 (20261022090000) and 新しい業者 (20261024090000) since
      const b = await snap(pg);
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k + ' round ' + round);
    }
    await early.exec(base);
    for (const f of files.filter(f => f !== S1 && f !== S2 && f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await early.exec(migration(f));
    const before = await snap(early);
    await assert.rejects(early.exec(both), /先に 20261019090000_invoice_purchase_summary\.sql を流してください/);
    assert.deepEqual(await snap(early), before);
  } finally { await pg.close(); await whole.close(); await early.close(); }
});

// 業者の統合 (20261022090000, Moto 2026-10-15・UI案51) goes on top of 段階 3. Without it, it stops and changes nothing. What goes into
// production (deploy/invoice-vendor-merge-v1083): 段階 2, 段階 3 and 業者の統合 in one file, in that order (production may or may not
// have 段階 2 and 3 yet, 2026-10-15). On a database with everything before 段階 2, or with 段階 2 and 3 already, it gives
// db/invoice-intake.sql; run again it changes nothing; without 20261019090000 it stops and, run as one statement list, leaves the
// database as it was. The file for 業者の統合 alone is the migration itself.
test('20261022090000 stops without 段階 3; deploy/invoice-vendor-merge-v1083 gives db/invoice-intake.sql, twice the same', async () => {
  const S1 = '20261019090000_invoice_purchase_summary.sql', S2 = '20261020090000_invoice_reconciled_folder.sql', S3 = '20261021090000_invoice_multi_file.sql';
  const S4 = '20261022090000_invoice_vendor_merge.sql', S5 = '20261024090000_invoice_vendor_register.sql';
  const D = '../deploy/invoice-vendor-merge-v1083/';
  const all = fs.readFileSync(new URL(D + '1_追加のSQL_段階2と段階3と業者の統合.sql', import.meta.url), 'utf8');
  assert.equal(all, migration(S2) + '\n' + migration(S3) + '\n' + migration(S4));
  assert.equal(fs.readFileSync(new URL(D + '1_追加のSQL_業者の統合だけ.sql', import.meta.url), 'utf8'), migration(S4));
  const whole = new PGlite(), noS3 = new PGlite(), fresh = new PGlite(), had = new PGlite(), early = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    const a = await snap(whole);
    // 業者の統合 alone on a database without 段階 3: it stops and changes nothing.
    await noS3.exec(base);
    for (const f of files.filter(f => f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await noS3.exec(migration(f));
    const before = await snap(noS3);
    await assert.rejects(noS3.exec(migration(S4)), /先に 20261021090000_invoice_multi_file\.sql（段階 3）を流してください/);
    assert.deepEqual(await snap(noS3), before);
    // The deploy file on a database without 段階 2 and 3, and on one that has them.
    await fresh.exec(base);
    for (const f of files.filter(f => f !== S2 && f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await fresh.exec(migration(f));
    await had.exec(base);
    for (const f of files.filter(f => f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await had.exec(migration(f));
    for (const pg of [fresh, had]) for (const round of [1, 2]) {
      await pg.exec(all);
      await pg.exec(migration(S5)); await pg.exec(migration(S6)); await pg.exec(migration(S7)); await pg.exec(migration(S8));   // the whole schema has moved on with 新しい業者 (20261024090000) and 紐づけ (20261025090000) since
      const b = await snap(pg);
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k + ' round ' + round);
    }
    // Without 20261019090000 it stops before changing anything.
    await early.exec(base);
    for (const f of files.filter(f => f !== S1 && f !== S2 && f !== S3 && f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await early.exec(migration(f));
    const b0 = await snap(early);
    await assert.rejects(early.exec(all), /先に 20261019090000_invoice_purchase_summary\.sql を流してください/);
    assert.deepEqual(await snap(early), b0);
  } finally { for (const pg of [whole, noS3, fresh, had, early]) await pg.close(); }
});

// 新しい業者を決める (20261024090000, Moto 2026-10-16・UI案52 ③) goes on top of 業者の統合. Without it, it stops and changes nothing.
// What goes into production (deploy/invoice-vendor-register-v1089): 段階 2, 段階 3, 業者の統合 and 新しい業者 in one file, in that order
// (production may or may not have 段階 2, 3 and 業者の統合 yet, 2026-10-16), or 新しい業者 alone (the migration itself). On a database
// with everything before 段階 2, with 段階 2 and 3, or with 業者の統合 already, it gives db/invoice-intake.sql; run again it changes
// nothing; without 20261019090000 it stops and, run as one statement list, leaves the database as it was.
test('20261024090000 stops without 業者の統合; deploy/invoice-vendor-register-v1089 gives db/invoice-intake.sql, twice the same', async () => {
  const S1 = '20261019090000_invoice_purchase_summary.sql', S2 = '20261020090000_invoice_reconciled_folder.sql', S3 = '20261021090000_invoice_multi_file.sql';
  const S4 = '20261022090000_invoice_vendor_merge.sql', S5 = '20261024090000_invoice_vendor_register.sql';
  const D = '../deploy/invoice-vendor-register-v1089/';
  const all = fs.readFileSync(new URL(D + '1_追加のSQL_段階2と段階3と業者の統合と新しい業者.sql', import.meta.url), 'utf8');
  assert.equal(all, migration(S2) + '\n' + migration(S3) + '\n' + migration(S4) + '\n' + migration(S5));
  assert.equal(fs.readFileSync(new URL(D + '1_追加のSQL_新しい業者だけ.sql', import.meta.url), 'utf8'), migration(S5));
  const whole = new PGlite(), noS4 = new PGlite(), fresh = new PGlite(), mid = new PGlite(), had = new PGlite(), early = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    const a = await snap(whole);
    await noS4.exec(base);
    for (const f of files.filter(f => f !== S4 && f !== S5 && f !== S6 && f !== S7 && f !== S8)) await noS4.exec(migration(f));
    const before = await snap(noS4);
    await assert.rejects(noS4.exec(migration(S5)), /先に 20261022090000_invoice_vendor_merge\.sql（業者の統合）を流してください/);
    assert.deepEqual(await snap(noS4), before);
    await fresh.exec(base);
    for (const f of files.filter(f => ![S2, S3, S4, S5, S6, S7, S8].includes(f))) await fresh.exec(migration(f));
    await mid.exec(base);
    for (const f of files.filter(f => ![S4, S5, S6, S7, S8].includes(f))) await mid.exec(migration(f));
    for (const pg of [fresh, mid]) for (const round of [1, 2]) {
      await pg.exec(all); await pg.exec(migration(S6)); await pg.exec(migration(S7)); await pg.exec(migration(S8));   // 紐づけ (20261025090000) came after
      const b = await snap(pg);
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k + ' round ' + round);
    }
    await had.exec(base);
    for (const f of files.filter(f => f !== S5 && f !== S6 && f !== S7 && f !== S8)) await had.exec(migration(f));
    for (const round of [1, 2]) {
      await had.exec(migration(S5)); await had.exec(migration(S6)); await had.exec(migration(S7)); await had.exec(migration(S8));
      const b = await snap(had);
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k + ' alone, round ' + round);
    }
    await early.exec(base);
    for (const f of files.filter(f => ![S1, S2, S3, S4, S5, S6, S7, S8].includes(f))) await early.exec(migration(f));
    const b0 = await snap(early);
    await assert.rejects(early.exec(all), /先に 20261019090000_invoice_purchase_summary\.sql を流してください/);
    assert.deepEqual(await snap(early), b0);
  } finally { for (const pg of [whole, noS4, fresh, mid, had, early]) await pg.close(); }
});

// 紐づけ 段階 1 (20261025090000, Moto 2026-10-18・UI案55) goes on top of 新しい業者を決める. Without it, it stops and changes nothing.
// What goes into production (deploy/invoice-item-link-v1093): the migration itself (production has 新しい業者 since 2026-10-17).
// On a database with everything before it it gives db/invoice-intake.sql, and run again it changes nothing (also with links, marks and
// members in it).
test('20261025090000 stops without 新しい業者; deploy/invoice-item-link-v1093 gives db/invoice-intake.sql, twice the same', async () => {
  const S5 = '20261024090000_invoice_vendor_register.sql';
  const D = '../deploy/invoice-item-link-v1093/';
  assert.equal(fs.readFileSync(new URL(D + '1_追加のSQL_紐づけ.sql', import.meta.url), 'utf8'), migration(S6));
  const whole = new PGlite(), noS5 = new PGlite(), had = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    const a = await snap(whole);
    await noS5.exec(base);
    for (const f of files.filter(f => f !== S5 && f !== S6 && f !== S7 && f !== S8)) await noS5.exec(migration(f));
    const before = await snap(noS5);
    await assert.rejects(noS5.exec(migration(S6)), /先に 20261024090000_invoice_vendor_register\.sql（新しい業者を決める）を流してください/);
    assert.deepEqual(await snap(noS5), before);
    await had.exec(base);
    for (const f of files.filter(f => f !== S6 && f !== S7 && f !== S8)) await had.exec(migration(f));
    for (const round of [1, 2]) {
      await had.exec(migration(S6)); await had.exec(migration(S7)); await had.exec(migration(S8));   // QuickBooks からすぐ (20261026090000) came after
      const b = await snap(had);
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k + ' round ' + round);
      if (round === 1) {
        // rows of every new kind: running the file again keeps them as they are
        await had.exec(`insert into public.invoice_link_members(user_id, emp_id, role) values ('00000000-0000-4000-8000-0000000000b1', 'E-1', 'chef');
          insert into public.invoice_link_marks(vendor_key, alias_key, spec_key, state, by_actor, by_role) values ('v1', 'gloves', '', 'excluded', 'x', 'gm');
          insert into public.invoice_item_maps(vendor_key, vendor_item_code, ingredient_code, verified, source, retired_at, retired_by) values ('v1', 'X1', '100', true, 'review', now(), 'x');`);
      }
    }
    const kept = (await had.query(`select (select count(*) from invoice_link_members) m, (select count(*) from invoice_link_marks) k,
      (select count(*) from invoice_item_maps where retired_at is not null) r`)).rows[0];
    assert.deepEqual([Number(kept.m), Number(kept.k), Number(kept.r)], [1, 1, 1]);
  } finally { for (const pg of [whole, noS5, had]) await pg.close(); }
});
