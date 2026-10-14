// The migrations production receives, applied in order, give the same database as db/invoice-intake.sql (which every
// other invoice test runs on). Kept in its own file: the mutation check (tests/invoice-mutations.test.mjs) changes
// db/invoice-intake.sql alone and must see the behaviour tests, not this comparison, notice the change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');

// Production received the migrations one by one (20261007090000, then each fix). Applied in that order to an empty database
// set up the way Supabase sets up new objects, they give exactly the database every test here runs on (db/invoice-intake.sql):
// the same tables, columns, defaults, constraints, indexes, row-level security and grants, the same functions (bodies,
// settings, owners' grants) and the same settings (keys aside). Then 20261012120000 again on top changes nothing.
test('the migrations in order give the same database as db/invoice-intake.sql', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => /^\d{14}_invoice_.*\.sql$/.test(f)).sort();
  assert.deepEqual(files, ['20261007090000_invoice_intake.sql', '20261007160000_invoice_intake_review_fixes.sql', '20261007200000_invoice_intake_accounting_checks.sql',
    '20261008090000_invoice_intake_store_folder.sql', '20261009170000_invoice_office_crew_review.sql', '20261009190000_invoice_office_crew_accounting.sql',
    '20261012120000_invoice_rename_after_post.sql', '20261019090000_invoice_purchase_summary.sql']);
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
  const whole = new PGlite(), stepwise = new PGlite();
  try {
    await whole.exec(base); await whole.exec(SQL);
    await stepwise.exec(base);
    for (const f of files) await stepwise.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
    const a = await snap(whole), b = await snap(stepwise);
    assert.ok(a.functions.length === 74 && a.tables.some(t => t.relname === 'invoice_purchase_checks') && a.columns.some(c => c.table_name === 'invoice_files' && c.column_name === 'rename_state'));
    for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
    // New functions are for the service role only, like every other one (Supabase grants them to the browser roles by default).
    for (const r of a.functions) assert.ok(!/(^|[{,])(anon|authenticated)=/.test(r.acl || ''), r.proname);
    // The last one again on top changes nothing (a production database that already has it).
    await stepwise.exec(fs.readFileSync(new URL(files[files.length - 1], dir), 'utf8'));
    const c = await snap(stepwise);
    for (const k of Object.keys(a)) assert.deepEqual(c[k], a[k], k + ' after running it twice');
  } finally { await whole.close(); await stepwise.close(); }
});
