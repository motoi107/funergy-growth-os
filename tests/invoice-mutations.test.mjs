// Proves the invoice tests would catch a regression: each protection is removed in a
// temporary copy and the relevant test must then fail. Nothing in the repository is changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pglite = path.join(root, 'tests/runtime/node_modules/@electric-sql/pglite/dist/index.js');
const FILES = ['invoice', 'db/invoice-intake.sql', 'supabase/migrations/20261007090000_invoice_intake.sql', 'supabase/functions/invoice-intake/handler.mjs', 'tests/invoice-intake.test.mjs', 'tests/invoice-rules.test.mjs'];

function run(mutations, testFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-mut-'));
  try {
    for (const f of FILES) fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
    for (const [file, from, to] of mutations) {
      const p = path.join(dir, file), s = fs.readFileSync(p, 'utf8');
      assert.equal(s.split(from).length - 1, 1, `mutation anchor must exist once in ${file}: ${from.slice(0, 60)}`);
      fs.writeFileSync(p, s.replace(from, to));
    }
    // NODE_TEST_CONTEXT would make the child report to this runner instead of setting its exit code.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', path.join(dir, testFile)], { env: { ...env, BOT_PGLITE_MODULE: pglite }, encoding: 'utf8', timeout: 240000 });
    if (r.status === null) throw new Error('test run did not finish: ' + (r.signal || r.error));
    return r.status;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const E2E = 'tests/invoice-intake.test.mjs', UNIT = 'tests/invoice-rules.test.mjs';
const CASES = [
  ['price jump check removed', UNIT, [['invoice/rules.mjs', "if (changedAtLeast(oldR, newR, st.price_jump_pct ?? 15)) r.push('price_jump');", '']]],
  ['total check removed', UNIT, [['invoice/rules.mjs', 'if (Math.abs(calc - h.total_cents) > tol)', 'if (false)']]],
  ['re-photo no longer a certain duplicate', E2E, [['invoice/dedupe.mjs', "out.certain = out.certain || { id: e.id, by: 'content' };", 'out.sameNumberDifferent.push(e.id);']]],
  ['latest price chosen by posting time', E2E, [['db/invoice-intake.sql', 'h.effective_date desc, h.invoice_date desc nulls last, h.invoice_no_norm desc nulls last, h.id desc) x;', 'h.id desc) x;']]],
  ['auto-post allowed with open reasons (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', 'if (!st.existed && result.autoEligible && ctx.mode.auto_post && ctx.started)', 'if (!st.existed && ctx.mode.auto_post)'],
    ['db/invoice-intake.sql', "  if not d.auto_eligible or jsonb_array_length(d.reasons) > 0 or d.doc_type<>'invoice' then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "  if exists(select 1 from public.invoice_lines il left join public.invoice_item_maps im on im.id=il.map_id\n            where il.doc_id=d.id and (im.id is null or not im.verified or not im.auto_post or jsonb_array_length(il.reasons) > 0)) then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "select r->>'code' into blocking from jsonb_array_elements(d.reasons) r where r->>'code' = any(must_fix) limit 1;", 'blocking := null;']]],
  ['unknown QuickBooks results resent automatically', E2E, [['db/invoice-intake.sql', "where state in ('pending','error') and (next_at is null or next_at<=now())", "where state in ('pending','error','unknown') and (next_at is null or next_at<=now())"]]],
  ['QuickBooks route not checked (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', "if (!ctx.qb.enabled || ctx.qb.route !== 'invoice-intake') return;", 'if (!ctx.qb.enabled) return;'],
    ['db/invoice-intake.sql', " if q->>'route' is distinct from 'invoice-intake' then return jsonb_build_object('queued', false, 'why', 'route_not_assigned'); end if;", '']]],
  ['organiser moves files outside the store folders', E2E, [['supabase/functions/invoice-intake/handler.mjs', "if (!parents.length || !parents.every(p => allowed.has(p))) throw new Error('outside_store_folders');", '']]],
  ['closed month posted without adjustment', E2E, [['db/invoice-intake.sql', "  if actor is null or not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;\n  update public.invoice_docs set needs_adjustment=true where id=d.id;", '']]],
  ['a moved file is reassigned to the other store automatically', E2E, [['db/invoice-intake.sql', "  update public.invoice_files set drive_state='moved_store', updated_at=now() where id=f.id;", "  update public.invoice_files set store_id=s.store_id, updated_at=now() where id=f.id;"]]],
  ['re-reading replaces a stored reading', E2E, [['db/invoice-intake.sql', "  insert into public.invoice_extractions(sha256, prompt_version, model, raw) values(p->>'sha256', p->>'prompt_version', p->>'model', p->'raw')\n  on conflict do nothing;",
    "  insert into public.invoice_extractions(sha256, prompt_version, model, raw) values(p->>'sha256', p->>'prompt_version', p->>'model', p->'raw')\n  on conflict(sha256, prompt_version) do update set raw=excluded.raw;"]]],
  ['a reconciled correction keeps its reconciliation', E2E, [['db/invoice-intake.sql', "  update public.invoice_docs set recon_status='unreconciled' where id=d.id and recon_status<>'unreconciled';\n", ''],
    ['db/invoice-intake.sql', "  recon_status=case when x.status='posted' and affects and x.recon_status<>'unreconciled' then 'unreconciled' else x.recon_status end,", '']]],
  ['the app copy of a replaced invoice is left in place', E2E, [['supabase/functions/invoice-intake/handler.mjs', "tombstone: d.status === 'superseded' });", 'tombstone: false });']]],
  ['AI output keeps unknown keys', UNIT, [['invoice/extract.mjs', '  return { ok: true, readable: true, documents };', '  return { ok: true, readable: true, documents, ...j };']]],
];

test('every protection is covered by a failing test when removed', async (t) => {
  assert.equal(run([], E2E), 0, 'the unmodified end-to-end test must pass');
  assert.equal(run([], UNIT), 0, 'the unmodified unit test must pass');
  for (const [name, file, muts] of CASES) {
    await t.test(name, () => { assert.notEqual(run(muts, file), 0, 'the test did not notice: ' + name); });
  }
});
