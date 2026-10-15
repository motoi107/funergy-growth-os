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
const FILES = ['invoice', 'db/invoice-intake.sql', 'db/invoice-intake-precheck.sql', 'db/invoice-intake-postcheck.sql', 'db/invoice-intake-rollback.sql', 'db/invoice-intake-office-crew-revert.sql', 'supabase/migrations/20261007090000_invoice_intake.sql', 'supabase/migrations/20261007160000_invoice_intake_review_fixes.sql', 'supabase/migrations/20261007200000_invoice_intake_accounting_checks.sql', 'supabase/migrations/20261008090000_invoice_intake_store_folder.sql', 'supabase/migrations/20261009170000_invoice_office_crew_review.sql', 'supabase/migrations/20261009190000_invoice_office_crew_accounting.sql', 'supabase/migrations/20261012120000_invoice_rename_after_post.sql', 'supabase/migrations/20261019090000_invoice_purchase_summary.sql', 'supabase/migrations/20261020090000_invoice_reconciled_folder.sql', 'supabase/functions/invoice-intake/handler.mjs', 'tests/invoice-intake.test.mjs', 'tests/invoice-rules.test.mjs',
  'db/invoice-purchase-stop.sql', 'db/invoice-purchase-start.sql', 'db/invoice-purchase-report.sql', 'index.html', 'tests/invoice-purchase-summary.test.mjs', 'tests/invoice-purchase-ui.test.mjs'];

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
    // INVOICE_MUTATION_RUN: the deploy-folder check (hashes of the sources) is skipped, so that only behaviour can notice a change.
    const r = spawnSync(process.execPath, ['--test', path.join(dir, testFile)], { env: { ...env, BOT_PGLITE_MODULE: pglite, INVOICE_MUTATION_RUN: '1' }, encoding: 'utf8', timeout: 240000 });
    if (r.status === null) throw new Error('test run did not finish: ' + (r.signal || r.error));
    return r.status;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const E2E = 'tests/invoice-intake.test.mjs', UNIT = 'tests/invoice-rules.test.mjs';
const PS = 'tests/invoice-purchase-summary.test.mjs', PU = 'tests/invoice-purchase-ui.test.mjs';   // 確認済みの仕入れ集計（Moto 2026-10-14）
const CASES = [
  ['price jump check removed', UNIT, [['invoice/rules.mjs', "if (changedAtLeast(oldR, newR, st.price_jump_pct ?? 15)) r.push('price_jump');", '']]],
  ['total check removed', UNIT, [['invoice/rules.mjs', 'if (Math.abs(calc - h.total_cents) > tol)', 'if (false)']]],
  ['re-photo no longer a certain duplicate', E2E, [['invoice/dedupe.mjs', "out.certain = out.certain || { id: e.id, by: 'content' };", 'out.sameNumberDifferent.push(e.id);']]],
  ['latest price chosen by posting time', E2E, [['db/invoice-intake.sql', "h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc) x;", 'h.id desc) x;']]],
  ['invoice numbers compared as text for the latest price', E2E, [['db/invoice-intake.sql', "h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc) x;", 'h.effective_date desc, h.invoice_date desc nulls last, h.invoice_no_norm desc nulls last, h.id desc) x;']]],
  ['auto-post allowed with open reasons (worker and database)', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', 'if (!st.existed && result.autoEligible && ctx.mode.auto_post && ctx.started)', 'if (!st.existed && ctx.mode.auto_post)'],
    ['db/invoice-intake.sql', "  if not d.auto_eligible or d.doc_type<>'invoice' then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "  if exists(select 1 from jsonb_array_elements(d.reasons) r where not (r->>'code' = any(info))) then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "  if exists(select 1 from public.invoice_lines il, jsonb_array_elements_text(il.reasons) c where il.doc_id=d.id and not (c = any(info))) then raise exception 'not_eligible'; end if;", ''],
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
    "  perform public.invoice_require((p->>'actor')::uuid, array['ceo','gm','office','office_crew']);\n  if o.state <> 'unknown' or s not in ('sent','pending') then raise exception 'invalid_state'; end if;\n", '']]],
  ['a person posting the old reading cancels the re-read', E2E, [['db/invoice-intake.sql',
    "(lease_owner=p->>'owner' or (p->>'owner' is null and intake_status not in ('pending','processing')))", "(lease_owner=p->>'owner' or p->>'owner' is null)"]]],
  ['price rows from another vendor\'s mapping (database: mapping check and unmapped lines)', E2E, [['db/invoice-intake.sql', " and vendor_key=d.vendor_key and (store_id is null or store_id=d.store_id);", ';'],
    ['db/invoice-intake.sql', "'spec_changed','map_ambiguous','unmapped'] then return false; end if;", "'spec_changed','map_ambiguous'] then return false; end if;"]]],
  ['the app copy changes a closed month', E2E, [['db/invoice-intake.sql',
    " if d.needs_adjustment or (public.invoice_setting('rules')->>'closed_through' is not null\n     and to_char(coalesce(d.invoice_date, d.effective_date),'YYYY-MM') <= public.invoice_setting('rules')->>'closed_through') then",
    " if d.needs_adjustment and d.status='posted' then"]]],
  // Candidates and queuing check the same thing (double protection), so both are removed together.
  // From 2026-10-12 an original is forwarded once it is posted (and renamed); a possible duplicate waits in review.
  ['possible duplicates forwarded before a decision', E2E, [['db/invoice-intake.sql',
    "  where f.source='drive' and f.current_sha256 is not null and f.intake_status='posted'\n", "  where f.source='drive' and f.current_sha256 is not null and f.intake_status in ('review','posted')\n"],
    ['db/invoice-intake.sql', "   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review')\n", ""],
    ['db/invoice-intake.sql', "  return jsonb_build_object('queued', false, 'why', 'not_ready');\n", "  null;\n"]]],
  ['C1: a failed or pending reading is forwarded', E2E, [['db/invoice-intake.sql',
    "  where f.source='drive' and f.current_sha256 is not null and f.intake_status='posted'\n", "  where f.source='drive' and f.current_sha256 is not null and f.intake_status not in ('pending','processing','duplicate','unsupported')\n"],
    ['db/invoice-intake.sql', "   and exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted')\n", ""],
    ['db/invoice-intake.sql', "   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review')\n", ""],
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
    "may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing','line_value_missing'];", "may_ack text[] := array['total_mismatch','line_amount_missing','line_value_missing'];"]]],
  ['C5: a correction drops the replaced-original warning', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "['ai_truncated', 'multiple_documents', 'missing_pages', 'original_replaced'].includes(r.code)", "['ai_truncated', 'multiple_documents', 'missing_pages'].includes(r.code)"]]],
  ['a failed reading is stored as the reading', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "        if (!res.ok) { stats.ai_failed = (stats.ai_failed || 0) + 1; await fail('ai_failed:' + String(res.error || 'unknown').slice(0, 80)); return; }\n        const value = { readable: res.readable, reason: res.reason || null, documents: res.documents, stop_reason: res.stop_reason || null };",
    "        if (!res.ok && res.retryable) { await fail(res.error); return; }\n        const value = res.ok ? { readable: res.readable, reason: res.reason || null, documents: res.documents, stop_reason: res.stop_reason || null } : { readable: false, failed: true, reason: res.error, documents: [] };"]]],
  ['AI output keeps unknown keys', UNIT, [['invoice/extract.mjs', '  return { ok: true, readable: true, documents };', '  return { ok: true, readable: true, documents, ...j };']]],
  // 10/7 production fix: numbers printed with their unit, weight equal to the quantity, delivery date as invoice date.
  ['a printed unit that disagrees with the line is accepted', UNIT, [['invoice/rules.mjs', "if (expect && unitKey(expect) !== unit) return { value: null, unit: null };", '']]],
  ['any printed weight is taken for the quantity', UNIT, [['invoice/rules.mjs', 'weightIsQty = w.value !== null && w.value === qty && wUnit === qtyUnit && !!qtyUnit;', 'weightIsQty = true;']]],
  ['an unreadable invoice date is replaced by the delivery date', UNIT, [['invoice/rules.mjs', "if (!d.value && d.reason === 'date_missing' && h.delivery_date &&", 'if (!d.value && h.delivery_date &&']]],
  ['the delivery date is not saved with a correction', E2E, [['supabase/functions/invoice-intake/handler.mjs', "if (!('invoice_date' in header) && result.invoiceDateDerived && h.invoice_date && h.invoice_date !== g.doc.invoice_date) header.invoice_date = h.invoice_date;", '']]],
  // Codex review of 2544826 (R1–R3).
  ['R1: an unread printed invoice date is filled from the delivery date on a correction', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    'if (noPrinted && !saved && (!doc.invoice_date || doc.invoice_date === doc.delivery_date))', 'if (!doc.invoice_date || (noPrinted && !saved && doc.invoice_date === doc.delivery_date))']]],
  ['a derived invoice date no longer follows a corrected delivery date', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    'result.invoiceDateDerived && h.invoice_date && h.invoice_date !== g.doc.invoice_date', '!g.doc.invoice_date && h.invoice_date']]],
  ['R4: an invoice date saved by a correction follows a later delivery-date correction', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    'if (noPrinted && !saved && (!doc.invoice_date || doc.invoice_date === doc.delivery_date))', 'if (noPrinted && (!doc.invoice_date || doc.invoice_date === doc.delivery_date))']]],
  // UI案36: accounting checks vendor, number, amount and store; products and prices are for reference.
  ['a line amount that cannot be read no longer holds the invoice', UNIT, [['invoice/rules.mjs', "if (amount === null || ldisc === null) { r.push('line_amount_missing'); lineBad = true; }", "if (amount === null || ldisc === null) { lineBad = true; }"]]],
  ['every reason is treated as for reference', UNIT, [['invoice/rules.mjs', 'export const blocksPosting = reasons => (reasons || []).some(r => !INFO.has(r.code));', 'export const blocksPosting = reasons => false;']]],
  ['the database posts automatically despite a reason accounting checks', E2E, [
    ['db/invoice-intake.sql', "  if exists(select 1 from jsonb_array_elements(d.reasons) r where not (r->>'code' = any(info))) then raise exception 'not_eligible'; end if;", ''],
    ['db/invoice-intake.sql', "  if exists(select 1 from public.invoice_lines il, jsonb_array_elements_text(il.reasons) c where il.doc_id=d.id and not (c = any(info))) then raise exception 'not_eligible'; end if;", '']]],
  // The vendor known check is in the handler and in the database; the name check only in the database (both removed).
  ['a vendor name is taught when one known vendor is changed to another', E2E, [
    ['supabase/functions/invoice-intake/handler.mjs', 'learn_alias: !!(header.vendor_key && !g.doc.vendor_key && aliasKey(g.doc.vendor_raw))', 'learn_alias: !!header.vendor_key'],
    ['db/invoice-intake.sql', " if coalesce((p->>'learn_alias')::boolean,false) and d.vendor_key is null and akey is not null", " if coalesce((p->>'learn_alias')::boolean,false) and akey is not null"],
    ['db/invoice-intake.sql', "  if not exists(select 1 from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) a(name)", "  if true or not exists(select 1 from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) a(name)"]]],
  ['R6: a name another vendor has is taught again', E2E, [['db/invoice-intake.sql',
    "  if not exists(select 1 from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) a(name)", "  if true or not exists(select 1 from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) a(name)"]]],
  ['R6: a switch writes the stale names back', E2E, [['db/invoice-intake.sql',
    "   aliases=case when v ? 'aliases' then coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}') else x.aliases end,",
    "   aliases=coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}'),"]]],
  ['R6: an older vendor screen overwrites a newer save', E2E, [['db/invoice-intake.sql',
    " if v ? 'expect_updated_at' and (cur.vendor_key is null or cur.updated_at is distinct from (v->>'expect_updated_at')::timestamptz) then raise exception 'conflict'; end if;", '']]],
  ['R6: an older store screen overwrites a newer save', E2E, [['db/invoice-intake.sql',
    " if s ? 'expect_updated_at' and (cur.store_id is null or cur.updated_at is distinct from (s->>'expect_updated_at')::timestamptz) then raise exception 'conflict'; end if;", '']]],
  ['R7: a line read earlier with line_value_missing posts without the check', E2E, [['db/invoice-intake.sql',
    " may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing','line_value_missing'];", " may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing'];"]]],
  ['an unreadable line amount posts without the check', E2E, [['db/invoice-intake.sql',
    " may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing','line_value_missing'];", " may_ack text[] := array['total_mismatch','original_replaced'];"]]],
  ['a line without a readable amount becomes price history', E2E, [['db/invoice-intake.sql', "'line_value_missing','line_qty_price_missing','line_amount_missing','unit_mismatch'", "'line_value_missing','line_qty_price_missing','unit_mismatch'"]]],
  ['a line without a readable quantity becomes price history', E2E, [['db/invoice-intake.sql', "'line_value_missing','line_qty_price_missing','line_amount_missing','unit_mismatch'", "'line_value_missing','line_amount_missing','unit_mismatch'"]]],
  ['R2: the price unit read at intake is dropped on a correction', E2E, [['supabase/functions/invoice-intake/handler.mjs', 'price_unit: l.price_unit ?? raw.price_unit,', 'price_unit: raw.price_unit,']]],
  ['R3: the unit printed on the quantity is not used for the mapping', E2E, [['invoice/rules.mjs', 'unit: qtyUnit, pack: l.pack, raw_name: l.description }', 'unit: l.unit, pack: l.pack, raw_name: l.description }']]],
  // Moto 2026-10-08: invoices put right in the store folder are read too, only from the start, and left where they are.
  ['store folder: invoices put right in it are not read', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    'if (store.root_folder_id && store.root_folder_id !== store.upload_folder_id && since) folders.push([store.root_folder_id, since]);', '']]],
  ['store folder: originals put there are moved and renamed', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "      if (leaveAt) {", "      if (false) {"]]],
  ['store folder: a PDF the app saved to Drive is read again', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    'if (appIds && appIds.has(f.id)) { stats.app_saved = (stats.app_saved || 0) + 1; continue; }', '']]],
  ['store folder: the database takes in files from before the start', E2E, [['db/invoice-intake.sql',
    "if start_at is null or nullif(p->>'created_time', '') is null or (p->>'created_time')::timestamptz < start_at then", 'if false then']]],
  // Store folder (cb2f6e5 review): staff keep originals in their own folders right in the store folder; other files are not read.
  ['a moved store-folder original raises a filing error', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    for (const p of parents) {\n      if (ours.has(p)) continue;", "    for (const p of []) {\n      if (ours.has(p)) continue;"]]],
  ['any folder counts as the staff\'s own', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "\n        && (pf.file.parents || []).some(x => roots.has(x))) return p;", ") return p;"]]],
  ['the store folder\'s other files are taken in', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "if (after && !STORE_FOLDER_TYPES.includes(f.mimeType))", "if (false)"]]],
  ['past-originals registration reads the store folder', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    if (b.folder_id === store.root_folder_id) throw new Error('bad_value');", ""]]],
  // 事務Crew does the invoice work like accounting (Moto 2026-10-09); settings and automatic posting stay with GM・CEO.
  ['事務Crew: may change the settings', E2E, [['db/invoice-intake.sql',
    "k text := p->>'key'; v jsonb := p->'value'; cur jsonb;\nbegin\n perform public.invoice_require(actor, array['ceo','gm']);",
    "k text := p->>'key'; v jsonb := p->'value'; cur jsonb;\nbegin\n perform public.invoice_require(actor, array['ceo','gm','office_crew']);"]]],
  ['事務Crew: may turn automatic posting on for a vendor', E2E, [['db/invoice-intake.sql',
    "if coalesce((v->>'auto_post')::boolean,false) and public.invoice_actor_role(actor) not in ('ceo','gm')",
    "if coalesce((v->>'auto_post')::boolean,false) and public.invoice_actor_role(actor) not in ('ceo','gm','office_crew')"]]],
  ['事務Crew: cannot reconcile', E2E, [['db/invoice-intake.sql',
    "create function public.invoice_reconcile(p jsonb) returns jsonb\nlanguage plpgsql security invoker set search_path=public,pg_temp as $$\ndeclare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; r text := p->>'result';\nbegin\n perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);",
    "create function public.invoice_reconcile(p jsonb) returns jsonb\nlanguage plpgsql security invoker set search_path=public,pg_temp as $$\ndeclare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; r text := p->>'result';\nbegin\n perform public.invoice_require(actor, array['ceo','gm','office']);"]]],
  ['事務Crew: cannot send a forwarding again', E2E, [['db/invoice-intake.sql',
    "  perform public.invoice_require(nullif(p->>'actor','')::uuid, array['ceo','gm','office','office_crew']);\n end if;",
    "  perform public.invoice_require(nullif(p->>'actor','')::uuid, array['ceo','gm','office']);\n end if;"]]],
  ['事務Crew: may list every store folder (folder plan)', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "  async function folderPlan(actor, b) {\n    const who = await db.rpc('invoice_whoami', { actor });\n    if (!['ceo', 'gm'].includes(who.role)) throw new Error('forbidden');",
    "  async function folderPlan(actor, b) {\n    const who = await db.rpc('invoice_whoami', { actor });\n    if (!['ceo', 'gm', 'office_crew'].includes(who.role)) throw new Error('forbidden');"]]],
  ['事務Crew: cannot post into a closed month', E2E, [['db/invoice-intake.sql',
    "  perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);\n  who := actor::text; mode := 'manual';",
    "  perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);\n  if public.invoice_actor_role(actor) = 'office_crew' and coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'forbidden'; end if;\n  who := actor::text; mode := 'manual';"]]],
  // Moto 2026-10-12: 「この内容で反映」 → the original is named 日付_業者名_番号 → then it goes to QuickBooks.
  ['QB: a posted original waiting for its name is a candidate', E2E, [
    ['db/invoice-intake.sql', "   and f.id not in (select w.file_id from public.invoice_rename_waiting_all() w)\n", ""]]],
  ['QB: a posted original waiting for its name can be queued', E2E, [
    ['db/invoice-intake.sql', " if public.invoice_rename_waiting(f.id) then return jsonb_build_object('queued', false, 'why', 'rename_waiting'); end if;\n", ""]]],
  ['QB: originals saved before the start moment are forwarded', E2E, [['db/invoice-intake.sql',
    " if s ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$' then return s::timestamptz; end if;\n",
    " if s ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$' then return s::date::timestamp at time zone 'Pacific/Honolulu'; end if;\n"]]],
  ['QB: the candidates ignore the start', E2E, [['db/invoice-intake.sql', "   and f.drive_created_at >= (select public.invoice_qb_since_at())\n", ""]]],
  ['QB: queuing ignores the start', E2E, [['db/invoice-intake.sql',
    " if not coalesce(f.drive_created_at >= public.invoice_qb_since_at(), false) then return jsonb_build_object('queued', false, 'why', 'before_since'); end if;\n", ""]]],
  ['QB: a start date begins at midnight UTC instead of Hawaii', E2E, [['db/invoice-intake.sql',
    "then return s::date::timestamp at time zone 'Pacific/Honolulu'; end if;\n", "then return s::date::timestamp at time zone 'UTC'; end if;\n"]]],
  ['QB: a broken start value stops the worker', E2E, [['db/invoice-intake.sql', "exception when others then return null;\nend $$;\n", "end $$;\n"]]],
  ['QB: any value is accepted as the start time', E2E, [['db/invoice-intake.sql',
    "  begin perform (v->>'since')::timestamptz; exception when others then raise exception 'bad_value'; end;\n", ""],
    ['db/invoice-intake.sql', "     or (v->>'since') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$')) then raise exception 'bad_value'; end if;\n",
      "     or true)) then raise exception 'bad_value'; end if;\n"]]],
  ['rename: the posting leaves the name to the worker', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "      if (ctx.mode.rename && r.file_id) r.rename = await renameNow(a, r.file_id, ctx);\n", ""]]],
  ['rename: the worker never renames', E2E, [['supabase/functions/invoice-intake/handler.mjs', "      await renameStep(ctx, stats, t0 + budget * 1.3);\n", ""]]],
  ['rename: a correction of a posted invoice is renamed only later, by the worker', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    if (g.doc.status === 'posted' && ctx.mode.rename && saved) saved.rename = await renameNow(actor, g.doc.file_id, ctx);\n", ""]]],
  ['rename: a correction of a posted invoice keeps the old name (the key without the version)', E2E, [
    ['db/invoice-intake.sql', " select f.id, d.id, d.id::text || ':' || d.version\n", " select f.id, d.id, d.id::text\n"],
    ['db/invoice-intake.sql', "\n  and f.rename_key is distinct from (d.id::text || ':' || d.version)\n", "\n  and f.rename_key is distinct from d.id::text\n"],
    ['db/invoice-intake.sql', "\n   and f.rename_key is distinct from (d.id::text || ':' || d.version)\n", "\n   and f.rename_key is distinct from d.id::text\n"]]],
  ['rename: a file outside the store folders is renamed', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "      if (!parents.length || !(parents.every(p => allowed.has(p)) || await staffPlace(parents, store, ctx, t))) throw new Error('outside_store_folders');\n", ""]]],
  ['rename: a name another file has is taken over', E2E, [['supabase/functions/invoice-intake/handler.mjs', "        name = uniqueName(name, taken);\n", ""]]],
  ['rename: an invoice posted before renaming was turned on is renamed', E2E, [['db/invoice-intake.sql',
    "\n  and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz\n", "\n"]]],
  ['rename: the one-file check and the all-files check disagree', E2E, [['db/invoice-intake.sql',
    "\n   and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz\n", "\n"]]],
  ['rename: renaming that is off still holds QuickBooks', E2E, [
    ['db/invoice-intake.sql', " where f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'\n", " where f.source='drive' and f.intake_status='posted'\n"],
    ['db/invoice-intake.sql', "  where f.id=p_file and f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'\n", "  where f.id=p_file and f.source='drive' and f.intake_status='posted'\n"]]],
  ['rename: renaming that is off renames anyway', E2E, [
    ['db/invoice-intake.sql', " where f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'\n", " where f.source='drive' and f.intake_status='posted'\n"],
    ['db/invoice-intake.sql', "  where f.id=p_file and f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'\n", "  where f.id=p_file and f.source='drive' and f.intake_status='posted'\n"],
    ['supabase/functions/invoice-intake/handler.mjs', "    if (!ctx.mode.rename) return;\n", ""],
    ['supabase/functions/invoice-intake/handler.mjs', "      if (ctx.mode.rename && r.file_id) r.rename", "      if (r.file_id) r.rename"]]],
  ['rename: turning it on again renames what was posted while it was off', E2E, [['db/invoice-intake.sql',
    " if k='mode' and v->>'rename' = 'true' and coalesce(cur->>'rename', 'false') <> 'true' then v := v || jsonb_build_object('rename_since', now()); end if;\n",
    " if k='mode' and v->>'rename' = 'true' and nullif(cur->>'rename_since', '') is null then v := v || jsonb_build_object('rename_since', now()); end if;\n"]]],
  ['rename: anyone can choose when renaming started', E2E, [['db/invoice-intake.sql', " if k='mode' and (v ? 'rename_since') then raise exception 'field_not_editable'; end if;\n", ""]]],
  ['rename: a file with two invoices is renamed after one of them', E2E, [['db/invoice-intake.sql',
    "  and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0);\n", ";\n"]]],
  ['rename: a failed rename is tried again at once on every run', E2E, [['db/invoice-intake.sql',
    "        else f.rename_state<>'error' or (f.rename_next_at <= now() and f.rename_attempts < 8) end)\n", "        else true end)\n"]]],
  ['rename: a retry does not clear a failed rename', E2E, [['db/invoice-intake.sql',
    "  rename_state=case when rename_state='error' then 'none' else rename_state end, rename_attempts=0, rename_next_at=null, updated_at=now()\n", "  updated_at=now()\n"]]],
  ['rename: the count on the screen counts something else', E2E, [['db/invoice-intake.sql',
    "  'rename_waiting', (select count(*) from public.invoice_rename_waiting_all()),\n", "  'rename_waiting', (select count(*) from public.invoice_files where rename_state='error'),\n"]]],
  ['organize renames the original again (old names)', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "      const moved = await drive.update(o.drive_file_id, { addParents: parents.includes(target) ? null : target,",
    "      const moved = await drive.update(o.drive_file_id, { name: 'organized_' + o.original_name, addParents: parents.includes(target) ? null : target,"]]],
  // 確認済み invoice の仕入れ集計（Moto 2026-10-14・UI案48）: the server
  ['purchases: not reconciled counted as confirmed', PS, [['db/invoice-intake.sql', "    when recon_status<>'reconciled' then 'C'\n", '']]],
  ['purchases: a send not recorded counts as confirmed', PS, [['db/invoice-intake.sql', "    when qbs='sent' or preledger then 'A'\n", "    when true then 'A'\n"]]],
  ['purchases: every original exempt from the ledger when qb.since is not set', PS, [['db/invoice-intake.sql', "(v_since is not null and not (d0.fsource='drive'", "(not (d0.fsource='drive'"]]],
  ['purchases: taken in before the start counted (twice with the app entry)', PS, [['db/invoice-intake.sql', "    when not link then 'E'\n", '']]],
  ['purchases: a credit memo printed positive is added', PS, [['db/invoice-intake.sql', "case when d1.credit then -1 else d1.f end mul", 'd1.f mul']]],
  ['purchases: the rounding remainder of the shares is lost', PS, [['db/invoice-intake.sql', " + case when l4.wsum > 0 and l4.rn <= l4.rem - l4.flsum then 1 else 0 end", '']]],
  ['purchases: a closed month is written again', PS, [['db/invoice-intake.sql', "  if v_closedm and v_pub.ym is not null and v_pub.closed and v_pub.inputs", '  if false and v_pub.inputs']]],
  ['purchases: a closed month misses invoices reconciled after closing', PS, [['db/invoice-intake.sql', " and v_pub.closed and v_pub.inputs is not distinct from v_in and not coalesce(", " and v_pub.closed and not coalesce("]]],
  ['purchases: a held original counts as copied without a copy in the app', PS, [['db/invoice-intake.sql', "    when d0.mstate='held' then coalesce(d0.hcopy, false)\n", "    when d0.mstate='held' then true\n"]]],
  ['purchases: a held original without a copy is taken as counted by the app', PS, [['db/invoice-intake.sql', " and not dd.link and dd.appentry),", " and not dd.link),"]]],
  ['purchases: held invoices the app entry counts are "not in yet" for the vendor', PS, [['db/invoice-intake.sql', "   count(*) filter (where cat in ('B','C') or (cat='E' and not (not link and appentry))) p_n,", "   count(*) filter (where cat in ('B','C','E')) p_n,"]]],
  ['purchases: the report reads rows written from outside', PS, [['db/invoice-purchase-report.sql', " select x.ym, x.summary || jsonb_build_object('generated_at', x.published_at) v from public.invoice_purchase_published x where x.summary is not null", " select substring(a.key from 18) ym, a.value::jsonb v from public.app_state a where a.key ~ '^invoice_purchase_\\d{4}-\\d{2}$'"]]],
  ['purchases: the full rollback leaves the summaries in use', E2E, [['db/invoice-intake-rollback.sql', "    execute format('update public.app_state set value = %L, updated_at = now() where key = %L',", "    if false then execute format('update public.app_state set value = %L, updated_at = now() where key = %L',"],
    ['db/invoice-intake-rollback.sql', "      json_build_object('v', 1, 'off', true, 'checked_at', now())::text, 'invoice_purchase_status');", "      json_build_object('v', 1, 'off', true, 'checked_at', now())::text, 'invoice_purchase_status'); end if;"]]],
  ['purchases: a month closed later is never written as closed', PS, [['db/invoice-intake.sql', " and v_pub.closed and v_pub.inputs is not distinct from v_in and not coalesce(", " and v_pub.inputs is not distinct from v_in and not coalesce("]]],
  ['purchases: a send to another address counts', PS, [['db/invoice-intake.sql', "   (select o.state from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.to_address=v_to and o.state<>'cancelled'", "   (select o.state from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.state<>'cancelled'"]]],
  ['purchases: with copies off, an original is counted besides the app entry', PS, [['db/invoice-intake.sql', '    else v_mirror and coalesce(d0.ingested_at >= v_start, false) end link,', '    else coalesce(d0.ingested_at >= v_start, false) end link,']]],
  ['purchases: a repair keeps the old version (devices keep the changed rows)', PS, [['db/invoice-intake.sql', "    update public.invoice_purchase_published x set published_at=v_now where x.ym=v_ym;\n    v_repaired := v_repaired || v_ym;\n", "    v_repaired := v_repaired || v_ym;\n"]]],
  ['purchases: a changed lines row alone is not repaired', PS, [['db/invoice-intake.sql', "    exit when v_bad;\n", "    exit when true;\n"]]],
  ['purchases: rows changed from outside stay changed', PS, [['db/invoice-intake.sql', "  if v_sum is not null then\n   v_bad := ", "  if false then\n   v_bad := "]]],
  ['purchases: a store that lost its invoices keeps the old lines row', PS, [['db/invoice-intake.sql', " union select jsonb_object_keys(coalesce(v_pub.lines, '{}'::jsonb)) loop", ' loop']]],
  ['purchases: an invoice moved to another month stays in the old one', PS, [['db/invoice-intake.sql', '    where cardinality(v_ids) > 0 and exists (select 1', '    where false and exists (select 1']]],
  ['purchases: an action writes no month (wrong invoice)', PS, [['supabase/functions/invoice-intake/handler.mjs', "diff: b.diff || null }), b => ids(b.doc_id)),", "diff: b.diff || null }), b => ids()),"]]],
  ['purchases: statement check without a role', PS, [['db/invoice-intake.sql', " perform public.invoice_require(v_actor, array['ceo','gm','office','office_crew']);\n", '']]],
  ['purchases: statement check in a closed month', PS, [['db/invoice-intake.sql', " if v_closed is not null and v_ym <= v_closed then raise exception 'closed_month'; end if;\n", '']]],
  ['purchases: an unclassified amount counted as confirmed', PS, [['db/invoice-intake.sql', " or needs_adjustment or unclass_m<>0 or tp is null then 'E'", " or needs_adjustment or tp is null then 'E'"]]],
  ['purchases: several stores on one page counted in full', PS, [['db/invoice-intake.sql', "    when multi or coalesce(currency,'USD')<>'USD'", "    when coalesce(currency,'USD')<>'USD'"]]],
  ['purchases: the stop switch is ignored', PS, [['db/invoice-intake.sql', " if coalesce((public.invoice_setting('purchase')->>'off')::boolean, false) then\n", " if false then\n"]]],
  ['purchases: a line class from the vendor even when the product is mapped', PS, [['db/invoice-intake.sql', "   coalesce(l4.mcls, case l4.food_kind when 'food' then 'food' when 'nonfood' then 'nonfood' end, 'unclass') c,", "   coalesce(case l4.food_kind when 'food' then 'food' when 'nonfood' then 'nonfood' end, l4.mcls, 'unclass') c,"]]],
  ['purchases: the summary is not written after reconciling', PS, [['supabase/functions/invoice-intake/handler.mjs', '    reconcile: thenSummary((a, b) =>', '    reconcile: ((a, b) =>']]],
  ["purchases: the outside forwarder's send is not followed", PS, [['supabase/functions/invoice-intake/handler.mjs', "      if (b.state === 'sent') await publishSummary(null, { outbox_id: String(b.id || '') });\n", '']]],
  ['purchases: the worker does not write the summary with intake off', PS, [['supabase/functions/invoice-intake/handler.mjs', 'const st = { off: true }; await publishSummary(st);', 'const st = { off: true };']]],
  // the app (v1077)
  ['app: food cost still adds the Drive copies', PU, [['index.html', '  var invoice=(_ips&&_ips.ok)?(_ips.confirmed+_ips.manual):monthInvoiceCostYm(storeId, ym);', '  var invoice=(_ips&&_ips.ok)?(_ips.confirmed+monthInvoiceCostYm(storeId, ym)):monthInvoiceCostYm(storeId, ym);']]],
  ['app: invoices registered in the app are dropped', PU, [['index.html', "    if(noDrive && v.src==='drive-intake') return;", '    if(noDrive) return;']]],
  ['app: the switch applies before October 2026', PU, [['index.html', '  if (!ym || ym < IPS_START) return null;\r\n  if (ipsOff())', '  if (!ym) return null;\r\n  if (ipsOff())']]],
  ['app: a stopped summary is still used', PU, [['index.html', 'function ipsOff(){ var s = ipsStatus(); return !!(s && s.off === true); }', 'function ipsOff(){ return false; }'],
    ['index.html', 'return !!(st && st.off !== true && _ipsObj(st.months)', 'return !!(st && _ipsObj(st.months)']]],
  ['app: a month the list does not name is used (daily)', PU, [['index.html', '  if (!ym || ym < IPS_START || ipsOff() || !_ipsListed(ym)) return false;', '  if (!ym || ym < IPS_START || ipsOff()) return false;']]],
  ['app: a month the list does not name is used (food cost)', PU, [['index.html', "  if (!_ipsListed(ym)) { ipsEnsure(ym); return { ok:false, why:'not_loaded' }; }\r\n", '']]],
  ['app: closed only from the summary', PU, [['index.html', '  d.closed = d.closed0 || !!(st &&', '  d.closed = d.closed0 && !!(st &&']]],
  ['app: stores kept in an ordinary object', PU, [['index.html', '  var st = Object.create(null);\r\n  Object.keys(v.stores)', '  var st = {};\r\n  Object.keys(v.stores)']]],
  ['app: any reason code is counted', PU, [['index.html', "if (!_ipsHas(IPS_WHY, b)) return; ", '']]],
  ['app: vendors kept in an ordinary object', PU, [['index.html', '  var map = Object.create(null), order = [];', '  var map = {}, order = [];']]],
  // 段階 2（Moto 2026-10-14・UI案50）
  ['段階2: reconciled originals filed the old way', E2E, [['supabase/functions/invoice-intake/handler.mjs', "      if (o.target === 'reconciled') { await fileReconciled(o, store, ctx, stats); return; }\n", '']]],
  ['段階2: the reconciled month is not the invoice month', E2E, [['invoice/naming.mjs', "return { root: FOLDER.reconciled, month: invoiceDate.slice(0, 7) };", "return { root: FOLDER.reconciled, month: invoiceDate.slice(0, 4) };"]]],
  ['段階2: the reconciled folders are recorded as other folders', E2E, [['supabase/functions/invoice-intake/handler.mjs', "rf.root, 'reconciled_root');", "rf.root, 'year');"]]],
  ['段階2: one switch for both filings (worker)', E2E, [['supabase/functions/invoice-intake/handler.mjs', "(ctx.mode.organize_reconciled ?? ctx.mode.organize) && 'reconciled'", "ctx.mode.organize && 'reconciled'"]]],
  ['段階2: a packing list is not marked', E2E, [['invoice/rules.mjs', "  if (packing) add('packing_list');\n", '']]],
  ['段階2: a packing list is not compared with the invoice', E2E, [['invoice/dedupe.mjs', ' || doc.packing || e.packing) {', ') {']]],
  ['段階2: the database does not say which are packing lists', E2E, [['db/invoice-intake.sql', ",\n  'packing', d.reasons @> '[{\"code\":\"packing_list\"}]'::jsonb)), '[]')", ")), '[]')"]]],
  ['段階2: a chosen packing list is forgotten by another correction', E2E, [['supabase/functions/invoice-intake/handler.mjs', "    const packing = !('doc_type' in (edits.header || {})) &&", "    const packing = false &&"]]],
  ['段階2: packing_list saved as a document type', E2E, [['supabase/functions/invoice-intake/handler.mjs', "    if ('doc_type' in header) { header.doc_type = h.doc_type; header.posting_kind = h.posting_kind; }", "    if ('doc_type' in header) header.posting_kind = h.posting_kind;"]]],
  ['段階2: any document type accepted', E2E, [['supabase/functions/invoice-intake/handler.mjs', "    if ('doc_type' in header && !['invoice', 'packing_list', 'credit_memo', 'statement', 'receipt', 'other', 'unknown'].includes(header.doc_type)) throw new Error('bad_value');\n", '']]],
  ['段階2: a chosen store is posted automatically (worker)', E2E, [['supabase/functions/invoice-intake/handler.mjs', "      if (f.store_assigned && !result.reasons.some(r => r.code === 'store_assigned'))", "      if (false && !result.reasons.some(r => r.code === 'store_assigned'))"]]],
  ['段階2: a chosen store is posted automatically (database)', E2E, [['db/invoice-intake.sql', "  if exists(select 1 from public.invoice_files where id=d.file_id and store_assigned_by is not null) then raise exception 'not_eligible'; end if;\n", '']]],
  ['段階2: the files due do not say the store was chosen', E2E, [['db/invoice-intake.sql', ", f.store_assigned_by is not null store_assigned from public.invoice_files f", " from public.invoice_files f"]]],
  ['段階2: a correction forgets a document that could not be read', E2E, [['supabase/functions/invoice-intake/handler.mjs', "'original_replaced', 'unreadable', 'ai_failed', 'store_assigned'].includes(r.code)", "'original_replaced', 'store_assigned'].includes(r.code)"]]],
  ['段階2: a correction forgets the chosen store', E2E, [['supabase/functions/invoice-intake/handler.mjs', "'original_replaced', 'unreadable', 'ai_failed', 'store_assigned'].includes(r.code)", "'original_replaced', 'unreadable', 'ai_failed'].includes(r.code)"]]],
  ['段階2: the list order changes between pages', E2E, [['db/invoice-intake.sql', "   (select * from q order by invoice_date desc nulls first, ingested_at desc, id\n", "   (select * from q order by invoice_date desc nulls first, ingested_at desc\n"]]],
  ['段階2: the list does not say the vendor', E2E, [['db/invoice-intake.sql', "  select d.id, d.store_id, d.doc_type, d.vendor_key, d.vendor_name,", "  select d.id, d.store_id, d.doc_type, d.vendor_name,"]]],
  ['段階2: reconciled originals moved from outside the store folder', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    for (const p of parents) if (!(await insideStore(p, store, o)) && !(await staffPlace([p], store, ctx, o))) throw new Error('outside_store_folders');\n", '']]],
  ['段階2: one of two places is enough to move', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    for (const p of parents) if (!(await insideStore(p, store, o)) && !(await staffPlace([p], store, ctx, o)))", "    for (const p of parents.slice(0, 1)) if (!(await insideStore(p, store, o)) && !(await staffPlace([p], store, ctx, o)))"]]],
  ['段階2: recorded folders are not checked in Drive', E2E, [['supabase/functions/invoice-intake/handler.mjs',
    "    if (!(o.store_folder_ids || []).includes(id) || depth > 4) return false;", "    if ((o.store_folder_ids || []).includes(id)) return true;\n    if (depth > 4) return false;"]]],
  ['段階2: the switches are not followed (database)', E2E, [['db/invoice-intake.sql',
    "   and (jsonb_typeof(p->'targets') is distinct from 'array' or f.organize_target in (select jsonb_array_elements_text(case when jsonb_typeof(p->'targets')='array' then p->'targets' else '[]'::jsonb end))\n", "   and (true\n"]]],
  ['段階2: taken-back originals stay in 照合済み (worker)', E2E, [['supabase/functions/invoice-intake/handler.mjs', "back = !!rec && !ctx.mode.organize;", "back = false;"]]],
  ['段階2: taken-back originals stay in 照合済み (database)', E2E, [['db/invoice-intake.sql',
    "    or (coalesce((p->>'back')::boolean,false) and f.organize_target='unreconciled'\n     and exists(select 1 from public.invoice_folders fo where fo.id=f.organized_folder_id and fo.role='reconciled_month')))", "    )"]]],
  ['段階2: a packing list is posted automatically', E2E, [['invoice/rules.mjs', ", 'mixed_tax'];\nconst INFO", ", 'mixed_tax', 'packing_list'];\nconst INFO"],
    ['db/invoice-intake.sql', ",'discount_allocation','mixed_tax'];\n -- A line amount", ",'discount_allocation','mixed_tax','packing_list'];\n -- A line amount"]]],
  ['段階2: a document marked as a duplicate keeps raising candidates', E2E, [['invoice/dedupe.mjs', " && e.status !== 'duplicate') out.candidates.push(e.id);", ") out.candidates.push(e.id);"]]],
  ['段階2: the post check misses the reconciled folder', E2E, [['db/invoice-intake-postcheck.sql', "when 'invoice_organize_due' then p.prosrc like '%targets%'", "when 'invoice_organize_due' then true"]]],
  ['app: the month is fetched on every look', PU, [['index.html', "{ _ipsPull(key, key + '|' + at); return; }", "{ _ipsPull(key, key + '|' + at + '|' + Math.random()); return; }"]]],
  ['app: the login pull takes the summaries', PU, [['index.html', "supaFetchAll('app_state', 'key,value', 'key=not.like.invoice_purchase_*&key=not.like.lunch_photo_*')", "supaFetchAll('app_state', 'key,value', 'key=not.like.lunch_photo_*')"]]],
  ['app: the bonus lock does not read the summaries', PU, [['index.html', "  keys.push('invoice_purchase_status');", '']]],
  ['app: reload draws any page', PU, [['index.html', "    var onTab = typeof curPage !== 'undefined' && curPage === 'budget' && typeof budgetTab !== 'undefined' && budgetTab === 'purchase';", '    var onTab = true;']]],
  ['app: a month of the same version is never checked again', PU, [['index.html', '  if (got && Date.now() - got < IPS_MONTH_TTL) return;', '  return;']]],
  ['app: a "missing" statement of a vendor with no invoice is ignored', PU, [['index.html', "function _ipsChkNeed(c){ return !!c && ((Number(c.docs) || 0) > 0 || !!(c.chk && c.chk.s === 'missing')); }", "function _ipsChkNeed(c){ return !!c && (Number(c.docs) || 0) > 0; }"]]],
  ['app: "not in yet" counts held invoices the app entry counts', PU, [['index.html', 'c:sum.B.c + sum.C.c + sum.E.c - sum.ap.c,', 'c:sum.B.c + sum.C.c + sum.E.c,'], ['index.html', 'n:sum.B.n + sum.C.n + sum.E.n - sum.ap.n,', 'n:sum.B.n + sum.C.n + sum.E.n,']]],
  ['app: old lines are kept for a newer month version', PU, [['index.html', "  if (_ipsLines[key] && String(_ipsLines[key].generated_at || '') !== String(d.generated_at || '')) delete _ipsLines[key];\r\n", '']]],
  ['app: a failed fetch is not tried again', PU, [['index.html', '      if (!ok) { _ipsAsked[flag] = { fail:Date.now() }; return; }', '      if (!ok) return;']]],
  ['app: a failed fetch is tried on every look', PU, [['index.html', '  if (a && !(a.fail && Date.now() - a.fail > IPS_RETRY_MS)) return;', '  if (a && !a.fail) return;']]],
  ['app: closed months are taken again every session', PU, [['index.html', '  if (ipsStatus().months[ym].closed === true) return;\r\n', '']]],
  ['app: the daily food cost head keeps the old count', PU, [['index.html', "  if(_fcIps && _fcIps.ok) _mInv=_fcIps.confirmed+_fcIps.manual;", "  if(false) _mInv=_fcIps.confirmed+_fcIps.manual;"]]],
  ['app: the daily food cost head uses the confirmed count for every store', PU, [['index.html', "  if(_fcIps && _fcIps.ok) _mInv=_fcIps.confirmed+_fcIps.manual;", "  if(typeof IPS_START!=='undefined' && _fcYm>=IPS_START){ var _fcIr=foodCostOf(storeId, _fcYm); _mInv=_fcIr.invoice||0; }"]]],
  ['app: an old month is not read again for newer lines', PU, [['index.html', "      if (String(v.generated_at || '') !== String(d.generated_at || '')) _ipsPull(", "      if (false) _ipsPull("]]],
  ['app: the cost card does not say which invoices', PU, [['index.html', "        d.basis==='confirmed_invoices' ? d.ipsNote\r\n", "        false ? d.ipsNote\r\n"]]],
  ['app: the purchases chip mixes two counts', PU, [['index.html', "    if(typeof IPS_START!=='undefined' && ym>=IPS_START){ var _fr=foodCostOf(s.id, ym);", "    if(typeof ipsOk==='function' && ipsOk(s.id, ym)){ var _fr=foodCostOf(s.id, ym);"]]],
  ['app: the daily cost adds the copies too', PU, [['index.html', "    if(typeof ipsReplacesCopy==='function' && ipsReplacesCopy(v, sids)) return;", '']]],
  ['app: other stores are shown', PU, [['index.html', "  var vis = (typeof getVisibleStores === 'function') ? getVisibleStores() : [];\r\n  var out = vis.map", "  var vis = (typeof getStoresAll === 'function') ? getStoresAll() : [];\r\n  var out = vis.map"]]],
  ['app: a store key that is not a store id is shown', PU, [['index.html', '      if (!_ipsId(sid, IPS_RE.sid) || !_ipsHas(d.stores, sid) || out.some(', '      if (out.some('],
    ['index.html', '{ if (IPS_RE.sid.test(k) && _ipsObj(v.stores[k])) st[k] = v.stores[k]; }', '{ if (_ipsObj(v.stores[k])) st[k] = v.stores[k]; }']]],
  ['app: vendor names are not escaped', PU, [['index.html', "onclick=\"ipsOpenVendor(' + _ipsRef(v.key) + ')\"><td><b>' + escapeHtml(v.n || t('業者未確定', 'Vendor unknown'))", "onclick=\"ipsOpenVendor(' + _ipsRef(v.key) + ')\"><td><b>' + (v.n || t('業者未確定', 'Vendor unknown'))"]]],
  ['app: line names are not escaped', PU, [['index.html', "        return '<tr><td>' + e(String(l[1] || '')) + '</td>", "        return '<tr><td>' + String(l[1] || '') + '</td>"]]],
  ['app: a missing statement needs no note', PU, [['index.html', "  if (state === 'missing' && !note) return fail(", '  if (false) return fail(']]],
  ['app: the 仕入率 uses the net of originals', PU, [['index.html', "ipsPct(A.cost / 100, sales),", 'ipsPct(A.c / 100, sales),']]],
];

test('every protection is covered by a failing test when removed', async (t) => {
  const only = process.env.INVOICE_MUTATION_ONLY ? new RegExp(process.env.INVOICE_MUTATION_ONLY) : null;
  assert.equal(run([], E2E), 0, 'the unmodified end-to-end test must pass');
  assert.equal(run([], UNIT), 0, 'the unmodified unit test must pass');
  if (!only || only.test('purchases') || only.test('app:')) {
    assert.equal(run([], PS), 0, 'the unmodified purchase summary test must pass (without the deploy-folder check)');
    assert.equal(run([], PU), 0, 'the unmodified purchase app test must pass');
  }
  // INVOICE_MUTATION_ONLY=<regex>: run only the matching cases (for checking one protection quickly).
  for (const [name, file, muts] of CASES) {
    if (only && !only.test(name)) continue;
    await t.test(name, () => { assert.notEqual(run(muts, file), 0, 'the test did not notice: ' + name); });
  }
});
