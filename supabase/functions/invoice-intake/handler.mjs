// invoice-intake: reads invoices dropped into per-store Google Drive folders,
// posts the clean ones, queues the rest for review, organises originals and
// keeps the QuickBooks forwarding ledger. Runs from a schedule; no browser needed.
import { callModel, PROMPT_VERSION } from '../../../invoice/extract.mjs';
import { evaluate, applyDuplicates } from '../../../invoice/rules.mjs';
import { sha256Hex, contentSignature, classifyDuplicates } from '../../../invoice/dedupe.mjs';
import { organizedName, uniqueName, monthFolders, FOLDER, extensionFor } from '../../../invoice/naming.mjs';
import { hstDate } from '../../../invoice/dates.mjs';
import { createDrive, googleAccessToken, viewUrl, folderUrl } from '../../../invoice/drive.mjs';

const SUPPORTED = { 'application/pdf': true, 'image/jpeg': true, 'image/png': true };
const READ = ['ceo', 'gm', 'office', 'office_crew'];
const QB_ROUTES = ['invoice-intake', 'external'];

// Constant-time comparison of a presented key with the stored one.
function keyMatches(given, stored) {
  if (!stored || !stored.key || !stored.enabled || typeof given !== 'string' || given.length !== stored.key.length) return false;
  let diff = 0; for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ stored.key.charCodeAt(i);
  return diff === 0;
}

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^invoice_[a-z_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 200)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
function looksLike(mime, b) {
  if (mime === 'application/pdf') return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;   // %PDF
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return false;
}
function encryptedPdf(b) {
  const tail = new TextDecoder('latin1').decode(b.subarray(Math.max(0, b.length - 4096)));
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 1 << 20)));
  return /\/Encrypt\s/.test(tail) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(head);
}
// Error text that may reach logs or screens: no tokens, keys or URLs with secrets.
const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);
const pdfPages = b => { const s = new TextDecoder('latin1').decode(b); const m = s.match(/\/Type\s*\/Page[^s]/g); return m ? m.length : null; };

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  // Drive access: the function's own secrets when set, otherwise the connection drive-sync already saved
  // (public.drive_oauth, read with the service role only). Nothing here reaches a browser or a log.
  async function driveToken() {
    let c = { clientId: env('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'), refreshToken: env('GOOGLE_OAUTH_REFRESH_TOKEN') };
    if (!c.clientId || !c.clientSecret || !c.refreshToken) {
      let saved = null;
      try { saved = await db.rpc('invoice_drive_credentials', {}); } catch { saved = null; }
      c = saved ? { clientId: saved.client_id, clientSecret: saved.client_secret, refreshToken: saved.refresh_token } : {};
    }
    return googleAccessToken({ fetch, ...c });
  }
  const drive = deps.drive || createDrive({ fetch, getToken: driveToken });
  const ai = deps.ai || (parts => callModel({ fetch, apiKey: env('ANTHROPIC_API_KEY'), model: env('INVOICE_AI_MODEL') || 'claude-sonnet-4-6', parts }));
  const mailer = deps.mailer || null;
  const now = deps.now || (() => Date.now());
  const origins = ['https://funergy-plus.com', ...String(env('INVOICE_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  // ------------------------------------------------------------------ worker
  async function context() {
    const c = await db.rpc('invoice_worker_context', {});
    const mode = c.settings.mode || {}, rules = c.settings.rules || {}, qb = c.settings.qb || {};
    const startAt = mode.start_at ? Date.parse(mode.start_at) : NaN;
    return { ...c, mode, rules, qb, started: !!mode.intake && Number.isFinite(startAt) && startAt <= now() };
  }

  async function scanStore(store, ctx, stats) {
    const started = new Date(now()).toISOString();
    let page = null, n = 0;
    try {
      do {
        const r = await drive.listFolder(store.upload_folder_id, page);
        for (const f of r.files) {
          n++;
          const owner = f.owners && f.owners[0] && f.owners[0].emailAddress;
          const res = await db.rpc('invoice_file_seen', { folder_id: store.upload_folder_id, drive_file_id: f.id, name: f.name, mime_type: f.mimeType,
            size: f.size ? Number(f.size) : null, md5: f.md5Checksum || null, created_time: f.createdTime, modified_time: f.modifiedTime,
            parents: f.parents || [], submitter: owner || (f.lastModifyingUser && f.lastModifyingUser.emailAddress) || null });
          stats[res.action] = (stats[res.action] || 0) + 1;
        }
        page = r.next;
      } while (page);
      await db.rpc('invoice_run_log', { kind: 'scan', store_id: store.store_id, started_at: started, ok: true, stats: { files: n } });
    } catch (e) {
      stats.scan_errors = (stats.scan_errors || 0) + 1;
      await db.rpc('invoice_run_log', { kind: 'scan', store_id: store.store_id, started_at: started, ok: false, error: safeErr(e) });
      if (/drive_auth|drive_not_configured/.test(safeErr(e))) throw e;
    }
  }

  async function stageDocs(f, store, sha, raw, ctx, pageCount, stats) {
    const docs = raw && raw.readable && raw.documents && raw.documents.length ? raw.documents : [null];
    for (let i = 0; i < docs.length; i++) {
      const ext = docs[i];
      let result;
      if (!ext) {
        result = { header: { doc_type: 'unknown', posting_kind: 'none', store_id: store.store_id }, lines: [],
          reasons: [{ code: raw && raw.failed ? 'ai_failed' : 'unreadable', detail: raw && raw.reason ? String(raw.reason).slice(0, 200) : null }], autoEligible: false };
      } else {
        result = await evaluate(ext, { store, stores: ctx.stores, vendors: ctx.vendors, maps: ctx.maps, settings: ctx.rules, started: ctx.started,
          docCount: docs.length, aiStop: raw.stop_reason, pageCount,
          priceRef: p => db.rpc('invoice_price_ref', { ...p, store_id: store.store_id }) });
        const h = result.header;
        h.content_sig = await contentSignature(h, result.lines);
        const existing = (await db.rpc('invoice_dup_scope', { sha256: sha, vendor_key: h.vendor_key, invoice_no_norm: h.invoice_no_norm,
          store_id: store.store_id, invoice_date: h.invoice_date, total_cents: h.total_cents }))
          .filter(e => !(e.file_id === f.id && e.sha256 === sha));
        const app = await db.rpc('invoice_app_records', { store_id: store.store_id });
        applyDuplicates(result, classifyDuplicates({ sha256: sha, store_id: store.store_id, ...h }, existing, app));
      }
      const h = result.header;
      const certain = result.reasons.find(r => r.code === 'duplicate_certain');
      const st = await db.rpc('invoice_stage', { source_key: `${f.id}:${sha}:${store.store_id}:${i}`, file_id: f.id, sha256: sha, doc_index: i, store_id: store.store_id,
        header: h, lines: result.lines.map(l => { const { raw: r, ...rest } = l; return { ...rest, raw: r }; }), reasons: result.reasons,
        auto_eligible: result.autoEligible, content_sig: h.content_sig || null, duplicate_of: certain ? certain.detail : null,
        ai: ext ? { prompt_version: PROMPT_VERSION, doc_index: i } : null });
      stats.staged = (stats.staged || 0) + (st.existed ? 0 : 1);
      if (!st.existed && result.autoEligible && ctx.mode.auto_post && ctx.started) {
        try { await db.rpc('invoice_post', { doc_id: st.doc_id, version: st.version }); stats.posted = (stats.posted || 0) + 1; }
        catch (e) { stats.post_refused = (stats.post_refused || 0) + 1; }
      }
      // Filed by invoice month only when vendor, date and store are not in doubt; otherwise it stays in 00_Upload.
      const doubt = result.reasons.some(r => ['store_mismatch', 'ship_to_unrecognized', 'multi_store', 'multiple_documents'].includes(r.code));
      if (docs.length === 1 && ext && h.vendor_key && h.invoice_date && !certain && !doubt && ctx.mode.organize) {
        await db.rpc('invoice_organize_request', { file_id: f.id, target: 'unreconciled' });
      }
    }
  }

  async function processFile(f, ctx, owner, stats) {
    const claim = await db.rpc('invoice_file_claim', { file_id: f.id, owner });
    if (!claim.ok) return;
    const store = ctx.stores.find(s => s.store_id === f.store_id);
    const fail = async (error, status = 'error') => db.rpc('invoice_file_fail', { file_id: f.id, owner, error, status });
    try {
      if (!store) { await fail('store_not_active'); return; }
      const g = await drive.get(f.drive_file_id);
      if (g.status === 404 || g.status === 403 || (g.file && g.file.trashed)) {
        const state = g.status === 404 ? 'missing' : g.status === 403 ? 'permission_lost' : 'trashed';
        await db.rpc('invoice_drive_status', { file_id: f.id, drive_state: state });
        await fail('original_' + state); return;
      }
      if (g.status !== 200) throw new Error('drive_get_' + g.status);
      const mime = String(g.file.mimeType || '').toLowerCase();
      if (!SUPPORTED[mime]) { await fail(/hei[cf]/.test(mime) ? 'heic_not_supported' : 'type_not_supported:' + mime.slice(0, 60), 'unsupported'); return; }
      const maxBytes = (Number(ctx.rules.max_file_mb) || 20) * 1048576;
      if (Number(g.file.size || 0) > maxBytes) { await fail('too_large', 'unsupported'); return; }
      const bytes = await drive.download(f.drive_file_id);
      if (bytes.length > maxBytes) { await fail('too_large', 'unsupported'); return; }
      if (!looksLike(mime, bytes)) { await fail('corrupt_or_wrong_type', 'unsupported'); return; }
      if (mime === 'application/pdf' && encryptedPdf(bytes)) { await fail('encrypted_pdf', 'unsupported'); return; }
      const sha = await sha256Hex(bytes);
      await db.rpc('invoice_file_version', { file_id: f.id, sha256: sha, md5: g.file.md5Checksum || null, size: bytes.length });
      let raw = await db.rpc('invoice_extraction', { sha256: sha, prompt_version: PROMPT_VERSION });
      if (!raw) {
        const res = await ai([{ mime, base64: b64(bytes) }]);
        stats.ai_calls = (stats.ai_calls || 0) + 1;
        // A failed reading (network, key, refusal, broken output) is not stored: the file waits and is read again later.
        if (!res.ok) { stats.ai_failed = (stats.ai_failed || 0) + 1; await fail('ai_failed:' + String(res.error || 'unknown').slice(0, 80)); return; }
        const value = { readable: res.readable, reason: res.reason || null, documents: res.documents, stop_reason: res.stop_reason || null };
        raw = await db.rpc('invoice_extraction', { sha256: sha, prompt_version: PROMPT_VERSION, model: res.model || null, raw: value });
      } else stats.ai_reused = (stats.ai_reused || 0) + 1;
      await stageDocs(f, store, sha, raw, ctx, mime === 'application/pdf' ? pdfPages(bytes) : 1, stats);
      await db.rpc('invoice_file_settle', { file_id: f.id, owner });
    } catch (e) {
      stats.file_errors = (stats.file_errors || 0) + 1;
      await fail(safeErr(e));
    }
  }

  // A remembered folder is used only while Drive still shows it, by that name, directly inside the expected parent
  // (and so, level by level, inside the store folder). A folder a person moved, renamed or trashed is never used again.
  async function ensureFolder(store, parentId, name, role) {
    const known = await db.rpc('invoice_folder', { parent_id: parentId, name });
    let stale = false;
    if (known && known.id) {
      const g = await drive.get(known.id);
      if (g.status === 200 && g.file && !g.file.trashed && g.file.mimeType === 'application/vnd.google-apps.folder'
          && g.file.name === name && (g.file.parents || []).includes(parentId)) return known.id;
      if (g.status !== 200 && g.status !== 404) throw new Error('folder_check_' + g.status);
      stale = true;
    }
    const found = await drive.findFolders(parentId, name);
    if (found.length > 1) throw new Error('duplicate_folders:' + name);           // never pick one silently
    const id = found.length ? found[0].id : (await drive.createFolder(parentId, name)).id;
    const saved = await db.rpc('invoice_folder', { id, parent_id: parentId, name, store_id: store.store_id, role, created_by_worker: !found.length, replace: stale });
    if (!saved || saved.id !== id) throw new Error('folder_record_mismatch:' + name);
    return saved.id;
  }

  async function organizeOne(o, ctx, stats) {
    const store = ctx.stores.find(s => s.store_id === o.store_id);
    try {
      if (!store || !store.root_folder_id) throw new Error('store_root_not_set');
      const mf = monthFolders(o.invoice_date);
      if (!mf) throw new Error('date_not_determined');
      // Safety: the file must still be inside this store's configured folders.
      const g = await drive.get(o.drive_file_id);
      if (g.status !== 200 || g.file.trashed) throw new Error('original_unavailable_' + g.status);
      const parents = g.file.parents || [];
      const allowed = new Set([store.upload_folder_id, ...(o.store_folder_ids || []), ...(o.upload_folder_ids || [])]);
      if (!parents.length || !parents.every(p => allowed.has(p))) throw new Error('outside_store_folders');
      const y = await ensureFolder(store, store.root_folder_id, mf.year, 'year');
      const m = await ensureFolder(store, y, mf.month, 'month');
      const target = await ensureFolder(store, m, o.target === 'reconciled' ? FOLDER.reconciled : FOLDER.unreconciled, o.target);
      const ext = extensionFor(o.original_name, g.file.mimeType);
      let name = organizedName({ vendor: o.vendor_name, invoiceDate: o.invoice_date, store: store.label, docType: o.doc_type,
        invoiceNo: o.invoice_no, internalNo: o.internal_no, ext, suffix: o.version_no > 1 ? 'v' + o.version_no : null });
      if (!name) throw new Error('name_not_determined');
      const taken = (await drive.listNames(target)).filter(x => x.id !== o.drive_file_id).map(x => x.name);
      name = uniqueName(name, taken);
      const moved = await drive.update(o.drive_file_id, { name, addParents: parents.includes(target) ? null : target,
        removeParents: parents.filter(p => p !== target).join(',') || null });
      await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: true, target: o.target, folder_id: target, name: moved.name || name });
      stats.organized = (stats.organized || 0) + 1;
    } catch (e) {
      await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: false, target: o.target, error: safeErr(e) });
      stats.organize_errors = (stats.organize_errors || 0) + 1;
    }
  }

  // One ledger for every original, whoever sends it. With route 'external' the existing forwarder
  // reads and records through the qb_external_* actions and nothing is sent from here.
  async function qbStep(ctx, owner, stats) {
    if (!ctx.qb.enabled || !QB_ROUTES.includes(ctx.qb.route)) return;
    await db.rpc('invoice_qb_sweep', {});
    for (const c of await db.rpc('invoice_qb_candidates', { limit: 20 })) {
      const r = await db.rpc('invoice_qb_enqueue', { file_id: c.file_id });
      if (r.queued) stats.qb_queued = (stats.qb_queued || 0) + 1;
    }
    if (ctx.qb.route !== 'invoice-intake' || !mailer) return;   // sending is done by the assigned route only
    for (let i = 0; i < 3; i++) {
      const o = await db.rpc('invoice_qb_reserve', { owner });
      if (!o) break;
      try {
        if (mailer.lookup) {
          const prev = await mailer.lookup(o.attempt_key);
          if (prev && prev.found) { await db.rpc('invoice_qb_result', { id: o.id, state: 'sent', message_id: prev.messageId, result: { via: 'lookup' } }); continue; }
        }
        const f = await db.rpc('invoice_file_brief', { file_id: o.file_id });
        const bytes = await drive.download(f.drive_file_id);
        if ((await sha256Hex(bytes)) !== o.sha256) throw Object.assign(new Error('content_changed'), { definitive: true });
        const res = await mailer.send({ to: o.to_address, idempotencyKey: o.attempt_key, subject: f.current_name,
          text: 'Original document forwarded by Funergy+ invoice intake.', attachment: { name: f.current_name, mime: f.mime_type, bytes } });
        if (res.ok) await db.rpc('invoice_qb_result', { id: o.id, state: 'sent', message_id: res.messageId || null, result: { accepted: true } });
        else await db.rpc('invoice_qb_result', { id: o.id, state: res.unknown ? 'unknown' : 'error', error: res.error || null });
        stats.qb_sent = (stats.qb_sent || 0) + (res.ok ? 1 : 0);
      } catch (e) {
        // A failure after the message may have left the sender is "unknown", not "failed".
        await db.rpc('invoice_qb_result', { id: o.id, state: e && e.definitive ? 'error' : 'unknown', error: safeErr(e) });
      }
    }
  }

  async function mirrorStep(ctx, stats) {
    if (!ctx.mode.mirror) return;
    for (const d of await db.rpc('invoice_mirror_due', { limit: 20 })) {
      const rec = appRecord(d);
      const r = await db.rpc('invoice_mirror_apply', { doc_id: d.id, record: rec, hash: await sha256Hex(new TextEncoder().encode(JSON.stringify({ ...rec, _mut: 0 }))),
        replace: d.mirror_state === 'held' && d.mirror_error === 'edited_after_post', tombstone: d.status === 'superseded' });
      stats['mirror_' + r.state] = (stats['mirror_' + r.state] || 0) + 1;
    }
  }

  function appRecord(d) {
    const ymd = s => (s ? String(s).slice(0, 10).replace(/-/g, '/') : '');
    return {
      id: 'drv_' + d.internal_no, src: 'drive-intake', intakeDocId: d.id, vendor: d.vendor_name, storeId: d.store_id, docType: 'Invoice',
      date: ymd(hstDate(d.ingested_at)), scannedAt: ymd(hstDate(d.ingested_at)), docDate: ymd(d.invoice_date), invoiceNo: d.invoice_no || '',
      lines: (d.lines || []).map(l => ({ code: null, name: l.raw_name, rawName: l.raw_name, newPrice: l.unit_price == null ? 0 : Number(l.unit_price),
        qty: l.qty == null ? 0 : Number(l.qty), lineTotal: l.amount_cents == null ? 0 : l.amount_cents / 100, ingredientCode: l.ingredient_code || null })),
      total: d.total_cents / 100, applied: true, v2Only: true, by: 'Google Drive', byUser: '', imagePath: null,
      purpose: d.food_kind === 'food' ? '仕入れ・仕込み' : '食材以外', reviewStatus: 'Drive取込', reviewNote: '', reviewThread: [],
      driveFileId: '', driveUrl: viewUrl(d.drive_file_id), driveMoved: true, _mut: now(),
    };
  }

  async function integrityStep(ctx, stats) {
    for (const f of await db.rpc('invoice_integrity_due', { limit: 10 })) {
      try {
        const g = await drive.get(f.drive_file_id);
        const state = g.status === 404 ? 'missing' : g.status === 403 ? 'permission_lost' : (g.file && g.file.trashed ? 'trashed' : g.status === 200 ? 'ok' : null);
        if (!state) continue;
        const r = await db.rpc('invoice_drive_status', { file_id: f.id, drive_state: state, name: g.file ? g.file.name : null, parents: g.file ? g.file.parents : null });
        if (state === 'ok' && g.file.md5Checksum && f.drive_md5 && g.file.md5Checksum !== f.drive_md5) {
          // Same file, new content: it is read again as a new version and goes to review.
          await db.rpc('invoice_file_content_changed', { file_id: f.id, md5: g.file.md5Checksum });
          stats.content_changed = (stats.content_changed || 0) + 1;
        }
        if (r.changed) stats.drive_changed = (stats.drive_changed || 0) + 1;
      } catch (e) { stats.integrity_errors = (stats.integrity_errors || 0) + 1; }
    }
  }

  async function runWorker(body) {
    const t0 = now(), owner = 'w-' + crypto.randomUUID();
    const stats = {};
    const lease = await db.rpc('invoice_lease', { name: 'intake', owner, seconds: 280 });
    if (!lease.ok) return { ok: true, skipped: 'busy' };
    const started = new Date(t0).toISOString();
    try {
      const ctx = await context();
      if (!ctx.mode.intake) { await db.rpc('invoice_run_log', { kind: 'intake', started_at: started, ok: true, stats: { off: true } }); return { ok: true, off: true }; }
      const pilot = Array.isArray(ctx.mode.pilot_stores) && ctx.mode.pilot_stores.length ? new Set(ctx.mode.pilot_stores) : null;
      const stores = ctx.stores.filter(s => s.active && s.upload_folder_id && (!pilot || pilot.has(s.store_id)));
      try { for (const s of stores) await scanStore(s, ctx, stats); await db.rpc('invoice_drive_conn', { ok: true }); }
      catch (e) { await db.rpc('invoice_drive_conn', { ok: false, error: safeErr(e) }); throw e; }
      const budget = Number(body.budget_ms) || 100000, batch = Math.max(1, Math.min(10, Number(ctx.rules.batch) || 3));
      for (const f of await db.rpc('invoice_files_due', { limit: batch, stores: stores.map(s => s.store_id) })) {
        if (now() - t0 > budget) { stats.deferred = (stats.deferred || 0) + 1; continue; }
        await processFile(f, ctx, owner, stats);
      }
      if (ctx.mode.organize) for (const o of await db.rpc('invoice_organize_due', { limit: 10 })) { if (now() - t0 > budget * 1.3) break; await organizeOne(o, ctx, stats); }
      try { await qbStep(ctx, owner, stats); } catch (e) { stats.qb_errors = (stats.qb_errors || 0) + 1; console.error('invoice-intake qb', safeErr(e)); }
      await mirrorStep(ctx, stats);
      await integrityStep(ctx, stats);
      await db.rpc('invoice_run_log', { kind: 'intake', started_at: started, ok: true, stats });
      return { ok: true, stats };
    } catch (e) {
      await db.rpc('invoice_run_log', { kind: 'intake', started_at: started, ok: false, stats, error: safeErr(e) });
      return { ok: false, error: safeErr(e), stats };
    } finally {
      await db.rpc('invoice_lease', { name: 'intake', owner, release: true });
    }
  }

  // ------------------------------------------------------------------ people
  async function actorOf(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ' + anon) return null;
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && typeof u.id === 'string' ? u.id : null;
  }

  // The invoice date a recheck starts from. A date a person enters now is used as entered. With no printed invoice
  // date (the AI's transcription has none), the date follows the delivery date (Moto 2026-10-07), also after the
  // delivery date is corrected. Otherwise the stored date is used; with none stored, the AI's printed text decides,
  // so a printed date that could not be read or that disagreed stays a reason for a person and is never filled in.
  function invoiceDateInput(doc, hdr, ai) {
    const printed = ai ? String(ai.invoice_date_text ?? '').trim() : null;   // null: no transcription to go by
    const noPrinted = printed === '';
    if ('invoice_date' in hdr) return { text: hdr.invoice_date || null, iso: hdr.invoice_date || null, derived: false };
    if (noPrinted && (!doc.invoice_date || doc.invoice_date === doc.delivery_date)) return { text: null, iso: null, derived: true };
    if (doc.invoice_date || (doc.overrides && 'invoice_date' in doc.overrides)) return { text: doc.invoice_date || null, iso: doc.invoice_date || null, derived: false };
    return { text: printed || null, iso: ai ? ai.invoice_date || null : null, derived: false };
  }

  // Rebuilds reasons after a person's correction from the current values, never from the AI's.
  // ai: the AI's transcription of this document (invoice_get's ai_doc), used only for what was printed.
  async function recheck(doc, lines, edits, ctx, ai) {
    const H = { ...doc, ...(edits.header || {}) };
    const dateIn = invoiceDateInput(doc, edits.header || {}, ai);
    const byId = Object.fromEntries((edits.lines || []).map(e => [e.line_id, e.set || {}]));
    const store = ctx.stores.find(s => s.store_id === doc.store_id) || { store_id: doc.store_id, auto_post: false };
    const vendor = ctx.vendors.find(v => v.vendor_key === H.vendor_key);
    const cents = c => (c === null || c === undefined ? null : (Number(c) / 100).toFixed(2));
    const ext = {
      doc_type: H.doc_type, vendor_name: vendor ? vendor.display_name : H.vendor_raw, ship_to: doc.ship_to_raw, customer_account: doc.vendor_code,
      invoice_number: H.invoice_no, invoice_date_text: dateIn.text, invoice_date: dateIn.iso,
      delivery_date_text: H.delivery_date || null, delivery_date: H.delivery_date || null, due_date_text: H.due_date || null, due_date: H.due_date || null,
      currency: H.currency, subtotal: cents(H.subtotal_cents), discount_total: cents(H.discount_cents), tax: cents(H.tax_cents),
      shipping: cents(H.shipping_cents), total: cents(H.total_cents),
      other_charges: (doc.other_charges || []).map(o => ({ label: o.label, amount: cents(o.cents) })),
      pages: doc.pages, pages_marked: doc.pages_marked, references: doc.references_raw,
      lines: lines.map(l => { const s = byId[l.id] || {}; const raw = l.raw || {};
        return { page: l.page, item_code: l.item_code, description: l.raw_name, qty: String(s.qty ?? l.qty ?? ''), unit: s.purchase_unit ?? l.purchase_unit ?? raw.unit,
          pack: raw.pack, unit_price: String(s.unit_price ?? l.unit_price ?? ''),
          // The units read at intake (also those printed on the numbers, "$3.52/LB") are kept.
          price_unit: l.price_unit ?? raw.price_unit, weight: l.weight ?? raw.weight, weight_unit: l.weight_unit ?? raw.weight_unit,
          line_discount: cents(s.line_discount_cents ?? l.line_discount_cents ?? 0), amount: cents(s.amount_cents ?? l.amount_cents), taxable: l.taxable }; }),
    };
    // A person's chosen mapping takes precedence over code/alias lookup.
    const forced = lines.map(l => {
      const id = (byId[l.id] && byId[l.id].map_id) || l.map_id;
      const m = id && ctx.maps.find(x => x.id === id);
      return m && m.vendor_key === H.vendor_key && (!m.store_id || m.store_id === doc.store_id) ? id : null;
    });
    const maps = ctx.maps;
    const result = await evaluate(ext, { store, stores: ctx.stores, vendors: ctx.vendors, maps, settings: ctx.rules, started: ctx.started,
      docCount: 1, pageCount: null, forcedMaps: forced, dateFallback: dateIn.derived,
      priceRef: p => db.rpc('invoice_price_ref', { ...p, store_id: doc.store_id }) });
    const h = result.header;
    h.content_sig = await contentSignature(h, result.lines);
    const existing = (await db.rpc('invoice_dup_scope', { sha256: doc.sha256, vendor_key: h.vendor_key, invoice_no_norm: h.invoice_no_norm,
      store_id: doc.store_id, invoice_date: h.invoice_date, total_cents: h.total_cents }))
      .filter(e => e.id !== doc.id && !(e.file_id === doc.file_id && e.sha256 === doc.sha256) && e.status !== 'duplicate' && e.duplicate_of !== doc.id);
    // Records registered through the existing app screen are compared again (copies written by this intake are not returned).
    const app = await db.rpc('invoice_app_records', { store_id: doc.store_id });
    applyDuplicates(result, classifyDuplicates({ sha256: doc.sha256, store_id: doc.store_id, ...h }, existing, app));
    // What the reading itself got wrong, and a replaced original, cannot be fixed by editing values: those reasons stay.
    for (const r of doc.reasons || []) {
      if (['ai_truncated', 'multiple_documents', 'missing_pages', 'original_replaced'].includes(r.code) && !result.reasons.some(x => x.code === r.code)) { result.reasons.push(r); result.autoEligible = false; }
    }
    result.invoiceDateDerived = dateIn.derived;
    return result;
  }

  async function edit(actor, b) {
    const g = await db.rpc('invoice_get', { actor, doc_id: b.doc_id });
    const ctx = await context();
    const header = {};
    const allowed = ['vendor_key', 'invoice_no', 'invoice_date', 'delivery_date', 'due_date', 'doc_type', 'currency',
      'subtotal_cents', 'discount_cents', 'tax_cents', 'shipping_cents', 'total_cents', 'food_kind'];
    for (const k of Object.keys(b.header || {})) { if (!allowed.includes(k)) throw new Error('field_not_editable'); header[k] = b.header[k]; }
    const result = await recheck(g.doc, g.lines, { header, lines: b.lines || [] }, ctx, g.ai_doc || null);
    const h = result.header;
    // An invoice with no printed invoice date takes its delivery date. When that gives a date the record does not
    // have yet (an older record, or a corrected delivery date), it is saved with this correction, so the stored
    // date matches the new reasons.
    if (!('invoice_date' in header) && result.invoiceDateDerived && h.invoice_date && h.invoice_date !== g.doc.invoice_date) header.invoice_date = h.invoice_date;
    if ('vendor_key' in header) { header.vendor_name = h.vendor_name || null; header.food_kind = header.food_kind ?? h.food_kind ?? null; }
    if ('invoice_no' in header) header.invoice_no_norm = h.invoice_no_norm;
    if ('doc_type' in header) header.posting_kind = h.posting_kind;
    if ('invoice_date' in header || 'delivery_date' in header) { header.effective_date = h.effective_date; header.effective_basis = h.effective_basis; header.posting_date = h.posting_date; }
    const lines = (b.lines || []).map(e => {
      const idx = g.lines.findIndex(l => l.id === e.line_id);
      if (idx < 0) throw new Error('line_not_found');
      const n = result.lines[idx];
      const set = { ...(e.set || {}) };
      for (const k of Object.keys(set)) if (!['qty', 'unit_price', 'amount_cents', 'line_discount_cents', 'purchase_unit', 'map_id'].includes(k)) throw new Error('field_not_editable');
      if ('map_id' in set) Object.assign(set, { ingredient_code: n.ingredient_code ?? null, count_unit: n.count_unit ?? null, count_per_purchase: n.count_per_purchase ?? null,
        base_unit: n.base_unit ?? null, base_per_purchase: n.base_per_purchase ?? null });
      Object.assign(set, { price_per_purchase: n.price_per_purchase ?? null, price_per_count: n.price_per_count ?? null, price_per_base: n.price_per_base ?? null, prev_price: n.prev_price ?? null });
      return { line_id: e.line_id, set, reasons: n.reasons };
    });
    // Lines that were not edited still get their reasons refreshed (a header change can affect them).
    const untouched = g.lines.map((l, i) => ({ l, i })).filter(x => !(b.lines || []).some(e => e.line_id === x.l.id))
      .map(x => ({ line_id: x.l.id, set: {}, reasons: result.lines[x.i].reasons }));
    return db.rpc('invoice_edit', { actor, doc_id: b.doc_id, version: b.version, header, lines: [...lines, ...untouched], reason: b.reason,
      reasons: result.reasons, content_sig: h.content_sig, lines_sum_cents: h.lines_sum_cents, adjustment_ack: !!b.adjustment_ack,
      ack: Array.isArray(b.ack) ? b.ack.filter(x => typeof x === 'string') : [] });
  }

  async function folderPlan(actor, b) {
    const who = await db.rpc('invoice_whoami', { actor });
    if (!['ceo', 'gm'].includes(who.role)) throw new Error('forbidden');
    const ctx = await context();
    const out = [];
    for (const s of ctx.all_stores) {
      const row = { store_id: s.store_id, label: s.label, root: null, upload: null, problems: [] };
      for (const [k, id] of [['root', s.root_folder_id], ['upload', s.upload_folder_id]]) {
        if (!id) { row.problems.push(k + '_not_set'); continue; }
        const g = await drive.get(id);
        row[k] = g.status === 200 ? { id, name: g.file.name, url: folderUrl(id), parents: g.file.parents || [] } : { id, status: g.status };
        if (g.status !== 200) row.problems.push(k + '_unreachable_' + g.status);
      }
      if (row.root && row.upload && row.upload.parents && !row.upload.parents.includes(s.root_folder_id)) row.problems.push('upload_not_inside_root');
      out.push(row);
    }
    return { stores: out };
  }

  // 00_Upload of each store: found by name inside the store folder. Without apply it only reports;
  // with apply it records a single match or creates the folder when there is none. A different folder
  // already recorded, or two folders with the same name, are reported and never chosen silently.
  async function folderSetup(actor, b) {
    const who = await db.rpc('invoice_whoami', { actor });
    if (!['ceo', 'gm'].includes(who.role)) throw new Error('forbidden');
    const apply = b.apply === true;
    const ctx = await context();
    const out = [];
    for (const s of ctx.all_stores) {
      if (b.store_id && s.store_id !== b.store_id) continue;
      const row = { store_id: s.store_id, label: s.label, root: null, upload: null, action: 'none', problems: [] };
      out.push(row);
      if (!s.root_folder_id) { row.problems.push('root_not_set'); continue; }
      const g = await drive.get(s.root_folder_id);
      if (g.status !== 200 || g.file.trashed) { row.problems.push('root_unreachable_' + (g.status === 200 ? 'trashed' : g.status)); continue; }
      if (g.file.mimeType !== 'application/vnd.google-apps.folder') { row.problems.push('root_not_a_folder'); continue; }
      row.root = { id: s.root_folder_id, name: g.file.name, url: folderUrl(s.root_folder_id) };
      const found = await drive.findFolders(s.root_folder_id, FOLDER.upload);
      if (found.length > 1) { row.problems.push('duplicate_upload_folders'); row.candidates = found.map(f => ({ id: f.id, url: folderUrl(f.id) })); continue; }
      if (found.length === 1) {
        row.upload = { id: found[0].id, url: folderUrl(found[0].id) };
        if (s.upload_folder_id === found[0].id) { row.action = 'ok'; continue; }
        if (s.upload_folder_id) { row.problems.push('different_upload_folder_recorded'); continue; }
        row.action = apply ? 'recorded' : 'will_record';
        if (apply) await db.rpc('invoice_store_folder', { actor, store_id: s.store_id, upload_folder_id: found[0].id });
        continue;
      }
      if (s.upload_folder_id) { row.problems.push('recorded_upload_not_inside_store_folder'); continue; }
      row.action = apply ? 'created' : 'will_create';
      if (apply) {
        const c = await drive.createFolder(s.root_folder_id, FOLDER.upload);
        await db.rpc('invoice_store_folder', { actor, store_id: s.store_id, upload_folder_id: c.id });
        row.upload = { id: c.id, url: folderUrl(c.id) };
      }
    }
    return { apply, stores: out };
  }

  async function priceHistory(actor, b) {
    if (!b.code || typeof b.code !== 'string') throw new Error('bad_value');
    const rows = await db.rpc('invoice_price_history_list', { actor, code: b.code, stores: Array.isArray(b.stores) ? b.stores : null, include_voided: b.include_voided === true });
    return { rows: rows.map(r => ({ ...r, original_url: viewUrl(r.drive_file_id) })) };
  }

  // Past originals: a separate mode. Dry run first; registration never reads, posts or forwards.
  async function backfill(actor, b) {
    const who = await db.rpc('invoice_whoami', { actor });
    if (!['ceo', 'gm'].includes(who.role)) throw new Error('forbidden');
    const ctx = await context();
    const store = ctx.all_stores.find(s => s.store_id === b.store_id);
    if (!store || !b.folder_id) throw new Error('not_found');
    if (b.folder_id === store.upload_folder_id) throw new Error('bad_value');     // the live upload folder is not a past folder
    const limit = Math.max(1, Math.min(500, Number(b.limit) || 20));
    const files = []; let page = null;
    do { const r = await drive.listFolder(b.folder_id, page); files.push(...r.files); page = r.next; } while (page && files.length < limit);
    const pick = files.slice(0, limit);
    const appIds = new Set(await db.rpc('invoice_app_drive_ids', { store_id: store.store_id }));
    const known = new Set(await db.rpc('invoice_registered', { ids: pick.map(f => f.id) }));
    const report = { listed: pick.length, more: files.length > limit || !!page, matched_app: pick.filter(f => appIds.has(f.id)).length,
      already_registered: pick.filter(f => known.has(f.id)).length, dry_run: b.dry_run !== false };
    report.not_in_app = report.listed - report.matched_app;
    if (b.dry_run === false) {
      const r = await db.rpc('invoice_backfill_register', { actor, store_id: store.store_id, files: pick.filter(f => !known.has(f.id)).map(f => ({
        drive_file_id: f.id, name: f.name, mime_type: f.mimeType, size: f.size ? Number(f.size) : null, md5: f.md5Checksum || null,
        created_time: f.createdTime, modified_time: f.modifiedTime, parents: f.parents || [] })) });
      Object.assign(report, r);
    }
    return report;
  }

  const ACTIONS = {
    backfill,
    list: (a, b) => db.rpc('invoice_list', { ...b, actor: a }).then(r => ({ ...r, rows: r.rows.map(x => ({ ...x, original_url: viewUrl(x.drive_file_id) })) })),
    get: (a, b) => db.rpc('invoice_get', { actor: a, doc_id: b.doc_id }).then(r => ({ ...r, original_url: r.file ? viewUrl(r.file.drive_file_id) : null })),
    health: a => db.rpc('invoice_health', { actor: a }),
    config: a => db.rpc('invoice_config', { actor: a }),
    problems: a => db.rpc('invoice_problems', { actor: a }).then(r => ({ files: r.files.map(f => ({ ...f, original_url: viewUrl(f.drive_file_id) })),
      qb: r.qb.map(o => ({ ...o, original_url: viewUrl(o.drive_file_id) })) })),
    edit,
    post: async (a, b) => {
      const r = await db.rpc('invoice_post', { actor: a, doc_id: b.doc_id, version: b.version, reason: b.reason || '', ack: b.ack || [], adjustment_ack: !!b.adjustment_ack, supersedes: b.supersedes || null });
      const ctx = await context();
      if (ctx.mode.organize && r.file_id) await db.rpc('invoice_organize_request', { file_id: r.file_id, target: 'unreconciled' });
      return r;
    },
    reassign: (a, b) => db.rpc('invoice_reassign', { actor: a, file_id: b.file_id, store_id: b.store_id, reason: b.reason || '' }),
    mark: (a, b) => db.rpc('invoice_mark', { actor: a, doc_id: b.doc_id, version: b.version, action: b.mark, duplicate_of: b.duplicate_of || null, reason: b.reason || '' }),
    relate: (a, b) => db.rpc('invoice_relate', { actor: a, doc_id: b.doc_id, version: b.version, related_doc_id: b.related_doc_id, relation: b.relation }),
    reconcile: (a, b) => db.rpc('invoice_reconcile', { actor: a, doc_id: b.doc_id, version: b.version, result: b.result, note: b.note || '', diff: b.diff || null }),
    retry: (a, b) => db.rpc('invoice_file_retry', { actor: a, file_id: b.file_id }),
    qb_resolve: (a, b) => db.rpc('invoice_qb_result', { actor: a, id: b.id, state: b.state, message_id: b.message_id || null, result: { note: b.note || null, checked_by: a } }),
    latest_prices: async (a, b) => { const w = await db.rpc('invoice_whoami', { actor: a }); if (!READ.includes(w.role)) throw new Error('forbidden'); return db.rpc('invoice_latest_prices', { stores: b.stores || null, codes: b.codes || null }); },
    map_save: (a, b) => db.rpc('invoice_map_save', { actor: a, map: b.map }),
    vendor_save: (a, b) => db.rpc('invoice_vendor_save', { actor: a, vendor: b.vendor }),
    store_save: (a, b) => db.rpc('invoice_store_save', { actor: a, store: b.store }),
    settings_save: (a, b) => db.rpc('invoice_settings_save', { actor: a, key: b.key, value: b.value }),
    folder_plan: folderPlan,
    folder_setup: folderSetup,
    price_history: priceHistory,
    vendor_seed: (a, b) => db.rpc('invoice_vendor_seed', { actor: a, apply: b.apply === true }),
    map_seed: (a, b) => db.rpc('invoice_map_seed', { actor: a, store_id: b.store_id || null, apply: b.apply === true, only_ext: b.only_ext !== false }),
  };
  const ERR = { forbidden: 403, actor_required: 401, conflict: 409, not_found: 404, line_not_found: 404, closed_month: 409, duplicate: 409, invalid_state: 409,
    reason_required: 400, note_required: 400, field_not_editable: 400, bad_value: 400, bad_key: 400, bad_result: 400, bad_relation: 400, bad_action: 400,
    bad_state: 400, bad_target: 400, duplicate_of_required: 400, relation_required: 409, auto_off: 409, not_eligible: 409, bad_supersede: 409,
    not_a_purchase: 409, header_incomplete: 409, posted_use_correction: 409 };

  // The forwarder that runs outside this system (qb.route = 'external'). It presents its own key and can only
  // list what is due, reserve one row, and record what happened to that row.
  const EXTERNAL = {
    qb_external_list: async b => ({ rows: (await db.rpc('invoice_qb_external_list', { limit: Math.max(1, Math.min(100, Number(b.limit) || 20)) }))
      .map(r => ({ ...r, original_url: viewUrl(r.drive_file_id) })) }),
    qb_external_reserve: b => db.rpc('invoice_qb_external_reserve', { id: b.id }),
    qb_external_result: b => {
      if (!['sent', 'error', 'unknown'].includes(b.state)) throw new Error('bad_state');
      return db.rpc('invoice_qb_result', { actor: 'external', id: b.id, state: b.state, message_id: b.message_id ? String(b.message_id).slice(0, 300) : null,
        error: b.error ? String(b.error).slice(0, 300) : null, result: { reported_by: 'external', note: b.note ? String(b.note).slice(0, 300) : null } });
    },
  };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 200000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    try {
      if (body.action === 'worker') {
        if (!keyMatches(req.headers.get('x-invoice-worker-key') || '', await db.rpc('invoice_worker_key', {}))) return json({ error: 'unauthorized' }, 401);
        return json(await runWorker(body));
      }
      if (EXTERNAL[body.action]) {
        if (!keyMatches(req.headers.get('x-invoice-qb-key') || '', await db.rpc('invoice_qb_external_key', {}))) return json({ error: 'unauthorized' }, 401);
        return json(await EXTERNAL[body.action](body));
      }
      const fn = ACTIONS[body.action];
      if (!fn) return json({ error: 'unknown_action' }, 400);
      const actor = await actorOf(req);
      if (!actor) return json({ error: 'unauthorized' }, 401);
      return json(await fn(actor, body));
    } catch (e) {
      const m = /^(blocked):(\w+)/.exec(e.message || '') || [];
      const code = m[1] ? 'blocked' : String(e.message || 'error').split(/[\s:]/)[0];
      const status = ERR[code] || (m[1] ? 409 : 500);
      // Unexpected errors are reported by a short code only; details stay in the server log without secrets.
      if (status === 500) console.error('invoice-intake', body && body.action, safeErr(e));
      return json({ error: m[1] ? e.message : code }, status);
    }
  };
}
