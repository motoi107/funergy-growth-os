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
const FILES = ['invoice', 'db/invoice-intake.sql', 'db/invoice-intake-precheck.sql', 'db/invoice-intake-postcheck.sql', 'db/invoice-intake-rollback.sql', 'supabase/migrations/20261007090000_invoice_intake.sql', 'supabase/migrations/20261007160000_invoice_intake_review_fixes.sql', 'supabase/functions/invoice-intake/handler.mjs', 'tests/invoice-intake.test.mjs', 'tests/invoice-rules.test.mjs'];

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
  ['latest price chosen by posting time', E2E, [['db/invoice-intake.sql', "h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc) x;", 'h.id desc) x;']]],
  ['invoice numbers compared as text for the latest price', E2E, [['db/invoice-intake.sql', "h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc) x;", 'h.effective_date desc, h.invoice_date desc nulls last, h.invoice_no_norm desc nulls last, h.id desc) x;']]],
  ['auto-post allowed with open reasons (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', 'if (!st.existed && result.autoEligible && ctx.mode.auto_post && ctx.started)', 'if (!st.existed && ctx.mode.auto_post)'],
    ['db/invoice-intake.sql', "  if not d.auto_eligible or jsonb_array_length(d.reasons) > 0 or d.doc_type<>'invoice' then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "  if exists(select 1 from public.invoice_lines il left join public.invoice_item_maps im on im.id=il.map_id\n            where il.doc_id=d.id and (im.id is null or not im.verified or not im.auto_post or jsonb_array_length(il.reasons) > 0)) then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "select r->>'code' into blocking from jsonb_array_elements(d.reasons) r where r->>'code' = any(must_fix) limit 1;", 'blocking := null;']]],
  ['unknown QuickBooks results resent automatically', E2E, [['db/invoice-intake.sql', "where state in ('pending','error') and (next_at is null or next_at<=now())", "where state in ('pending','error','unknown') and (next_at is null or next_at<=now())"]]],
  ['QuickBooks route not checked (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', "if (!ctx.qb.enabled || !QB_ROUTES.includes(ctx.qb.route)) return;", 'if (!ctx.qb.enabled) return;'],
    ['db/invoice-intake.sql', " if coalesce(q->>'route','') not in ('invoice-intake','external') then return jsonb_build_object('queued', false, 'why', 'route_not_assigned'); end if;", '']]],
  ['rows of the outside forwarder sent from here (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', "if (ctx.qb.route !== 'invoice-intake' || !mailer) return;", 'if (!mailer) return;'],
    ['db/invoice-intake.sql', "and attempts < 5 and route='invoice-intake' order by created_at", 'and attempts < 5 order by created_at']]],
  ['forwarder key not checked', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "if (!keyMatches(req.headers.get('x-invoice-qb-key') || '', await db.rpc('invoice_qb_external_key', {}))) return json({ error: 'unauthorized' }, 401);", '']]],
  ['a key that is turned off still works', E2E, [['supabase/functions/invoice-intake/handler.mjs', 'if (!stored || !stored.key || !stored.enabled ||', 'if (!stored || !stored.key ||']]],
  ['the forwarder records results on rows it did not reserve or does not own', E2E, [['db/invoice-intake.sql',
    " if p->>'actor' = 'external' and (o.route <> 'external' or o.state not in ('sending','unknown') or s = 'pending') then raise exception 'invalid_state'; end if;", '']]],
  ['settings send the forwarder key to the screen', E2E, [['db/invoice-intake.sql', " return public.invoice_setting(k) - 'key';", ' return public.invoice_setting(k);']]],
  ['folder setup changes Drive on a dry run', E2E, [['supabase/functions/invoice-intake/handler.mjs', "      if (apply) {\n        const c = await drive.createFolder", "      if (true) {\n        const c = await drive.createFolder"]]],
  ['a recorded upload folder is replaced silently', E2E, [['supabase/functions/invoice-intake/handler.mjs', "if (s.upload_folder_id) { row.problems.push('different_upload_folder_recorded'); continue; }", '']]],
  ['organiser moves files outside the store folders', E2E, [['supabase/functions/invoice-intake/handler.mjs', "if (!parents.length || !parents.every(p => allowed.has(p))) throw new Error('outside_store_folders');", '']]],
  ['closed month posted without adjustment', E2E, [['db/invoice-intake.sql', "  if actor is null or not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;\n  update public.invoice_docs set needs_adjustment=true where id=d.id;", '']]],
  ['a moved file is reassigned to the other store automatically', E2E, [['db/invoice-intake.sql', "  update public.invoice_files set drive_state='moved_store', updated_at=now() where id=f.id;", "  update public.invoice_files set store_id=s.store_id, updated_at=now() where id=f.id;"]]],
  ['re-reading replaces a stored reading', E2E, [['db/invoice-intake.sql', "  insert into public.invoice_extractions(sha256, prompt_version, model, raw) values(p->>'sha256', p->>'prompt_version', p->>'model', p->'raw')\n  on conflict do nothing;",
    "  insert into public.invoice_extractions(sha256, prompt_version, model, raw) values(p->>'sha256', p->>'prompt_version', p->>'model', p->'raw')\n  on conflict(sha256, prompt_version) do update set raw=excluded.raw;"]]],
  ['a reconciled correction keeps its reconciliation', E2E, [['db/invoice-intake.sql', "  update public.invoice_docs set recon_status='unreconciled' where id=d.id and recon_status<>'unreconciled';\n", ''],
    ['db/invoice-intake.sql', "  recon_status=case when x.status='posted' and affects and x.recon_status<>'unreconciled' then 'unreconciled' else x.recon_status end,", '']]],
  ['the app copy of a replaced invoice is left in place', E2E, [['supabase/functions/invoice-intake/handler.mjs', "tombstone: d.status === 'superseded' });", 'tombstone: false });']]],
  ['anyone signed in settles forwarding results', E2E, [['db/invoice-intake.sql',
    "  perform public.invoice_require((p->>'actor')::uuid, array['ceo','gm','office']);\n  if o.state <> 'unknown' or s not in ('sent','pending') then raise exception 'invalid_state'; end if;\n", '']]],
  ['a person posting the old reading cancels the re-read', E2E, [['db/invoice-intake.sql',
    "(lease_owner=p->>'owner' or (p->>'owner' is null and intake_status not in ('pending','processing')))", "(lease_owner=p->>'owner' or p->>'owner' is null)"]]],
  ['price rows from another vendor\'s mapping (database: mapping check and unmapped lines)', E2E, [['db/invoice-intake.sql', " and vendor_key=d.vendor_key and (store_id is null or store_id=d.store_id);", ';'],
    ['db/invoice-intake.sql', "'spec_changed','map_ambiguous','unmapped'] then return false; end if;", "'spec_changed','map_ambiguous'] then return false; end if;"]]],
  ['the app copy changes a closed month', E2E, [['db/invoice-intake.sql',
    " if d.needs_adjustment or (public.invoice_setting('rules')->>'closed_through' is not null\n     and to_char(coalesce(d.invoice_date, d.effective_date),'YYYY-MM') <= public.invoice_setting('rules')->>'closed_through') then",
    " if d.needs_adjustment and d.status='posted' then"]]],
  // Candidates and queuing check the same thing (double protection), so both are removed together.
  ['possible duplicates forwarded before a decision', E2E, [['db/invoice-intake.sql',
    "   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review'\n", "   and not exists(select 1 from public.invoice_docs d where false\n"],
    ['db/invoice-intake.sql', "  return jsonb_build_object('queued', false, 'why', 'not_ready');\n", "  null;\n"]]],
  ['C1: a failed or pending reading is forwarded', E2E, [['db/invoice-intake.sql',
    "  where f.source='drive' and f.current_sha256 is not null and f.intake_status in ('review','posted')\n", "  where f.source='drive' and f.current_sha256 is not null and f.intake_status not in ('pending','processing','duplicate','unsupported')\n"],
    ['db/invoice-intake.sql', "   and exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256)\n", ""],
    ['db/invoice-intake.sql', "  return jsonb_build_object('queued', false, 'why', 'not_ready');\n", "  null;\n"]]],
  ['C2: a correction forgets the records registered in the app', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "applyDuplicates(result, classifyDuplicates({ sha256: doc.sha256, store_id: doc.store_id, ...h }, existing, app));", "applyDuplicates(result, classifyDuplicates({ sha256: doc.sha256, store_id: doc.store_id, ...h }, existing, []));"]]],
  ['C3: a posted invoice is corrected into a mismatch without acknowledgement', E2E, [['db/invoice-intake.sql',
    " if d.status='posted' then\n  select r->>'code' into blocking", " if false then\n  select r->>'code' into blocking"]]],
  // A currency change is both an amount change and checked on every correction (double protection): both removed together.
  ['C3a: a currency change alone keeps a posted invoice posted', E2E, [['db/invoice-intake.sql',
    " if d.status='posted' then\n  select r->>'code' into blocking", " if d.status='posted' and (affects or touched_price) then\n  select r->>'code' into blocking"],
    ['db/invoice-intake.sql', "  'vendor_key','invoice_no','doc_type','effective_date','currency'];", "  'vendor_key','invoice_no','doc_type','effective_date'];"]]],
  ['C3b: an acknowledged mismatch is changed without a new acknowledgement', E2E, [['db/invoice-intake.sql',
    "and (amounts or touched_price or not (d.reasons @> jsonb_build_array(r))) limit 1;", "and not (d.reasons @> jsonb_build_array(r)) limit 1;"]]],
  ['C4: a remembered folder is used without checking where it is', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    if (known && known.id) {\n      const g = await drive.get(known.id);", "    if (known && known.id) { return known.id;\n      const g = await drive.get(known.id);"]]],
  ['C5: new content in an already-read file is treated as a new invoice', E2E, [['db/invoice-intake.sql',
    "  rs := rs || jsonb_build_array(jsonb_build_object('code', 'original_replaced', 'detail', prior)); auto := false;", "  null;"]]],
  ['C5: a replaced original is posted beside the earlier version without a decision', E2E, [['db/invoice-intake.sql',
    "may_ack text[] := array['line_math','total_mismatch','original_replaced'];", "may_ack text[] := array['line_math','total_mismatch'];"]]],
  ['C5: a correction drops the replaced-original warning', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "['ai_truncated', 'multiple_documents', 'missing_pages', 'original_replaced'].includes(r.code)", "['ai_truncated', 'multiple_documents', 'missing_pages'].includes(r.code)"]]],
  ['a failed reading is stored as the reading', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "        if (!res.ok) { stats.ai_failed = (stats.ai_failed || 0) + 1; await fail('ai_failed:' + String(res.error || 'unknown').slice(0, 80)); return; }\n        const value = { readable: res.readable, reason: res.reason || null, documents: res.documents, stop_reason: res.stop_reason || null };",
    "        if (!res.ok && res.retryable) { await fail(res.error); return; }\n        const value = res.ok ? { readable: res.readable, reason: res.reason || null, documents: res.documents, stop_reason: res.stop_reason || null } : { readable: false, failed: true, reason: res.error, documents: [] };"]]],
  ['AI output keeps unknown keys', UNIT, [['invoice/extract.mjs', '  return { ok: true, readable: true, documents };', '  return { ok: true, readable: true, documents, ...j };']]],
  // 10/7 production fix: numbers printed with their unit, weight equal to the quantity, delivery date as invoice date.
  ['a printed unit that disagrees with the line is accepted', UNIT, [['invoice/rules.mjs', "if (expect && unitKey(expect) !== unit) return { value: null, unit: null };", '']]],
  ['any printed weight is taken for the quantity', UNIT, [['invoice/rules.mjs', 'weightIsQty = w.value !== null && w.value === qty && wUnit === qtyUnit && !!qtyUnit;', 'weightIsQty = true;']]],
  ['an unreadable invoice date is replaced by the delivery date', UNIT, [['invoice/rules.mjs', "if (!d.value && d.reason === 'date_missing' && h.delivery_date)", 'if (!d.value && h.delivery_date)']]],
  ['the delivery date is not saved with a correction', E2E, [['supabase/functions/invoice-intake/handler.mjs', "if (!('invoice_date' in header) && !g.doc.invoice_date && h.invoice_date && g.doc.status === 'review') header.invoice_date = h.invoice_date;", '']]],
];

test('every protection is covered by a failing test when removed', async (t) => {
  assert.equal(run([], E2E), 0, 'the unmodified end-to-end test must pass');
  assert.equal(run([], UNIT), 0, 'the unmodified unit test must pass');
  for (const [name, file, muts] of CASES) {
    await t.test(name, () => { assert.notEqual(run(muts, file), 0, 'the test did not notice: ' + name); });
  }
});
