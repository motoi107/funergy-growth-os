// invoice-intake: reads invoices dropped into per-store Google Drive folders,
// posts the clean ones, queues the rest for review, organises originals and
// keeps the QuickBooks forwarding ledger. Runs from a schedule; no browser needed.
import { callModel, PROMPT_VERSION } from '../../../invoice/extract.mjs';
import { evaluate, applyDuplicates } from '../../../invoice/rules.mjs';
import { sha256Hex, contentSignature, classifyDuplicates, aliasKey } from '../../../invoice/dedupe.mjs';
import { postedName, uniqueName, monthFolders, reconciledFolders, FOLDER, extensionFor } from '../../../invoice/naming.mjs';
import { hstDate } from '../../../invoice/dates.mjs';
import { createDrive, googleAccessToken, viewUrl, folderUrl } from '../../../invoice/drive.mjs';
import { groupItems, relink } from '../../../invoice/link.mjs';
import { createGmail, authUrl, pkcePair, randomState, sha256Text, exchangeCode, profileOf, canSearchWith, scopesOk, qbSubject, refreshAccess, tokenScopes } from '../../../invoice/gmail.mjs';
import { noticeText } from '../../../invoice/notices.mjs';

const SUPPORTED = { 'application/pdf': true, 'image/jpeg': true, 'image/png': true };
const READ = ['ceo', 'gm', 'office', 'office_crew'];
// From the store folder itself only these are taken in (a HEIC photo is taken in to show how to send it again).
const STORE_FOLDER_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
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
  // Work that goes on after the answer (index.ts passes EdgeRuntime.waitUntil): a posting answers at once and the send runs on.
  const background = deps.background || null;
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  // Gmail (UI案56): the OAuth client is the function's own (GMAIL_OAUTH_CLIENT_ID/SECRET) or else the one the Drive connection uses.
  async function googleClient() {
    let id = env('GMAIL_OAUTH_CLIENT_ID'), secret = env('GMAIL_OAUTH_CLIENT_SECRET');
    if (!id || !secret) {
      let saved = null; try { saved = await db.rpc('invoice_drive_credentials', {}); } catch { saved = null; }
      id = saved && saved.client_id; secret = saved && saved.client_secret;
    }
    return { clientId: id || null, clientSecret: secret || null };
  }
  const redirectUri = () => env('GMAIL_OAUTH_REDIRECT_URI') || (url + '/functions/v1/invoice-intake');
  const appUrl = () => env('INVOICE_APP_URL') || origins[0] + '/';
  async function gmailCreds() {
    const c = await db.rpc('invoice_gmail_creds', {});
    if (!c || !c.refresh_token) return null;
    return { ...(await googleClient()), refreshToken: c.refresh_token, account: c.account };
  }
  // What sends: Gmail (production); a stand-in in tests (qbTransport, or the older mailer stand-in).
  function newTransport() {
    if (deps.qbTransport) return deps.qbTransport();
    if (mailer) return mailerTransport(mailer);
    return createGmail({ fetch, getCreds: gmailCreds });
  }
  const origins = ['https://funergy-plus.com', ...String(env('INVOICE_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  // ------------------------------------------------------------------ worker
  async function context() {
    const c = await db.rpc('invoice_worker_context', {});
    const mode = c.settings.mode || {}, rules = c.settings.rules || {}, qb = c.settings.qb || {};
    const startAt = mode.start_at ? Date.parse(mode.start_at) : NaN;
    return { ...c, mode, rules, qb, started: !!mode.intake && Number.isFinite(startAt) && startAt <= now() };
  }

  // The vendor a key ends at, following merges (業者の統合, Moto 2026-10-15). Null for a key no vendor has.
  function finalVendor(vendors, key) {
    let v = key ? (vendors || []).find(x => x.vendor_key === key) : null;
    for (let i = 0; v && v.merged_into && i < 20; i++) v = (vendors || []).find(x => x.vendor_key === v.merged_into) || null;
    return v;
  }

  async function scanStore(store, ctx, stats) {
    const started = new Date(now()).toISOString();
    let n = 0, nStore = 0;
    // 00_Upload, and (Moto 2026-10-08) the store folder itself: staff also put invoices right in it. From the store folder
    // only the files directly in it (never the folders in it) that were put there at or after the start are read; the
    // database checks the start again. Nothing is read from the store folder while no start is set.
    const startMs = ctx.mode.start_at ? Date.parse(ctx.mode.start_at) : NaN;
    const since = Number.isFinite(startMs) ? new Date(startMs).toISOString() : null;
    const folders = [[store.upload_folder_id, null]];
    if (store.root_folder_id && store.root_folder_id !== store.upload_folder_id && since) folders.push([store.root_folder_id, since]);
    try {
      for (const [folder, after] of folders) {
        // An original the app itself saved to Drive is already in the app: never read again from the store folder.
        const appIds = after ? new Set(await db.rpc('invoice_app_drive_ids', { store_id: store.store_id })) : null;
        let page = null;
        do {
          const r = await drive.listFolder(folder, page, after ? { createdAfter: after } : undefined);
          for (const f of r.files) {
            if (after && !(Date.parse(f.createdTime) >= startMs)) continue;
            // The store folder also holds the store's other files (sheets, documents, shortcuts): only PDFs and photos are taken in.
            if (after && !STORE_FOLDER_TYPES.includes(f.mimeType)) { stats.store_folder_other = (stats.store_folder_other || 0) + 1; continue; }
            if (appIds && appIds.has(f.id)) { stats.app_saved = (stats.app_saved || 0) + 1; continue; }
            n++; if (after) nStore++;
            const owner = f.owners && f.owners[0] && f.owners[0].emailAddress;
            const res = await db.rpc('invoice_file_seen', { folder_id: folder, drive_file_id: f.id, name: f.name, mime_type: f.mimeType,
              size: f.size ? Number(f.size) : null, md5: f.md5Checksum || null, created_time: f.createdTime, modified_time: f.modifiedTime,
              parents: f.parents || [], submitter: owner || (f.lastModifyingUser && f.lastModifyingUser.emailAddress) || null });
            stats[res.action] = (stats[res.action] || 0) + 1;
          }
          page = r.next;
        } while (page);
      }
      await db.rpc('invoice_run_log', { kind: 'scan', store_id: store.store_id, started_at: started, ok: true, stats: { files: n, store_folder_files: nStore } });
    } catch (e) {
      stats.scan_errors = (stats.scan_errors || 0) + 1;
      await db.rpc('invoice_run_log', { kind: 'scan', store_id: store.store_id, started_at: started, ok: false, error: safeErr(e) });
      if (/drive_auth|drive_not_configured/.test(safeErr(e))) throw e;
    }
  }

  async function stageDocs(f, store, sha, raw, ctx, pageCount, stats) {
    const docs = raw && raw.readable && raw.documents && raw.documents.length ? raw.documents : [null];
    let posted = 0;
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
        applyDuplicates(result, classifyDuplicates({ sha256: sha, store_id: store.store_id, ...h, packing: result.reasons.some(r => r.code === 'packing_list') }, existing, app));
      }
      // A person chose the store for this file (reassign): it waits for a person even when nothing else needs checking.
      if (f.store_assigned && !result.reasons.some(r => r.code === 'store_assigned')) { result.reasons.push({ code: 'store_assigned' }); result.autoEligible = false; }
      const h = result.header;
      const certain = result.reasons.find(r => r.code === 'duplicate_certain');
      const st = await db.rpc('invoice_stage', { source_key: `${f.id}:${sha}:${store.store_id}:${i}`, file_id: f.id, sha256: sha, doc_index: i, store_id: store.store_id,
        header: h, lines: result.lines.map(l => { const { raw: r, ...rest } = l; return { ...rest, raw: r }; }), reasons: result.reasons,
        auto_eligible: result.autoEligible, content_sig: h.content_sig || null, duplicate_of: certain ? certain.detail : null,
        ai: ext ? { prompt_version: PROMPT_VERSION, doc_index: i } : null });
      stats.staged = (stats.staged || 0) + (st.existed ? 0 : 1);
      if (!st.existed && result.autoEligible && ctx.mode.auto_post && ctx.started) {
        try { await db.rpc('invoice_post', { doc_id: st.doc_id, version: st.version }); stats.posted = (stats.posted || 0) + 1; posted++; }
        catch (e) { stats.post_refused = (stats.post_refused || 0) + 1; }
      }
      // Filed by invoice month only when vendor, date and store are not in doubt; otherwise it stays in 00_Upload.
      const doubt = result.reasons.some(r => ['store_mismatch', 'ship_to_unrecognized', 'multi_store', 'multiple_documents'].includes(r.code));
      if (docs.length === 1 && ext && h.vendor_key && h.invoice_date && !certain && !doubt && ctx.mode.organize) {
        await db.rpc('invoice_organize_request', { file_id: f.id, target: 'unreconciled' });
      }
    }
    return posted;
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
      const posted = await stageDocs(f, store, sha, raw, ctx, mime === 'application/pdf' ? pdfPages(bytes) : 1, stats);
      await db.rpc('invoice_file_settle', { file_id: f.id, owner });
      // Posted automatically: the same way as a person's posting (UI案56): renamed now, queued now, and the send starts now.
      if (posted) {
        if (ctx.mode.rename) await renameNow(null, f.id, ctx);
        const q = await qbAfterPost([f.id], ctx, 'auto');
        if (q && q.queued) stats.qb_queued = (stats.qb_queued || 0) + q.queued;
      }
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

  // A folder this worker recorded counts as the store's only while Drive still shows it inside the store folder (a person may
  // have moved 照合済み, a year or a month folder out, for example to an archive).
  async function insideStore(id, store, o, depth = 0) {
    if (id === store.root_folder_id || id === store.upload_folder_id || (o.upload_folder_ids || []).includes(id)) return true;
    if (!(o.store_folder_ids || []).includes(id) || depth > 4) return false;
    const g = await drive.get(id);
    // A temporary error (rate limit, Drive down) is retried as such, never shown as "outside the store".
    if (g.limited || (g.status !== 200 && g.status !== 404 && g.status !== 403)) throw new Error('folder_check_' + g.status);
    if (g.status !== 200 || !g.file || g.file.trashed || g.file.mimeType !== 'application/vnd.google-apps.folder') return false;
    for (const p of g.file.parents || []) if (await insideStore(p, store, o, depth + 1)) return true;
    return false;
  }

  // Where staff keep an original themselves: right in the store folder, or in a folder of theirs right in it. The
  // folders this worker makes (year / month / 未照合 / 照合済み) and 00_Upload are not theirs. A file a person assigned
  // to another store may sit in the folder of the store it came from.
  async function staffPlace(parents, store, ctx, o) {
    const roots = new Set([store.root_folder_id]);
    if ((o.upload_folder_ids || []).length) for (const s of ctx.stores) if (s.root_folder_id) roots.add(s.root_folder_id);
    const hit = parents.find(p => roots.has(p));
    if (hit) return hit;
    const ours = new Set([...(o.store_folder_ids || []), ...ctx.stores.map(s => s.upload_folder_id).filter(Boolean)]);
    for (const p of parents) {
      if (ours.has(p)) continue;
      const pf = await drive.get(p);
      // As in insideStore: a temporary error is a Drive error to retry, not "outside the store".
      if (pf.limited || (pf.status !== 200 && pf.status !== 404 && pf.status !== 403)) throw new Error('folder_check_' + pf.status);
      if (pf.status === 200 && pf.file && !pf.file.trashed && pf.file.mimeType === 'application/vnd.google-apps.folder'
        && (pf.file.parents || []).some(x => roots.has(x))) return p;
    }
    return null;
  }

  // Files the original. Not reconciled: by invoice month (year / month / 未照合), originals staff keep themselves stay where
  // they are. Reconciled (Moto 2026-10-14, UI案50 1A・3A・4A): {store folder}/照合済み/YYYY-MM (the invoice date's month),
  // from wherever it is in the store's folders, right in the store folder and staff's own folders in it included. The name
  // is not changed here: a posted original is named 日付_業者名_番号 by renameOne (Moto 2026-10-12), wherever it is.
  async function organizeOne(o, ctx, stats) {
    const store = ctx.stores.find(s => s.store_id === o.store_id);
    try {
      if (!store || !store.root_folder_id) throw new Error('store_root_not_set');
      if (o.target === 'reconciled') { await fileReconciled(o, store, ctx, stats); return; }
      const mf = monthFolders(o.invoice_date);
      if (!mf) throw new Error('date_not_determined');
      // Safety: the file must still be inside this store's configured folders.
      const g = await drive.get(o.drive_file_id);
      if (g.status !== 200 || g.file.trashed) throw new Error('original_unavailable_' + g.status);
      const parents = g.file.parents || [];
      // An original put right in the store folder stays where staff put it (Moto 2026-10-08): the store's own
      // month folders and hand-off use that folder. It is recorded as filed there, not moved or renamed. So does an
      // original staff moved on into a folder they keep right in the store folder (for example "○月 Uploaded").
      const leaveAt = await staffPlace(parents, store, ctx, o);
      if (leaveAt) {
        await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: true, target: o.target, folder_id: leaveAt, name: g.file.name });
        stats.organize_left = (stats.organize_left || 0) + 1;
        return;
      }
      if (!parents.length) throw new Error('outside_store_folders');
      for (const p of parents) if (p === store.root_folder_id || !(await insideStore(p, store, o))) throw new Error('outside_store_folders');
      const y = await ensureFolder(store, store.root_folder_id, mf.year, 'year');
      const m = await ensureFolder(store, y, mf.month, 'month');
      const target = await ensureFolder(store, m, o.target === 'reconciled' ? FOLDER.reconciled : FOLDER.unreconciled, o.target);
      const moved = await drive.update(o.drive_file_id, { addParents: parents.includes(target) ? null : target,
        removeParents: parents.filter(p => p !== target).join(',') || null });
      // The name Drive has now (a rename done meanwhile by the posting is kept).
      await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: true, target: o.target, folder_id: target, name: (moved && moved.name) || g.file.name });
      stats.organized = (stats.organized || 0) + 1;
    } catch (e) {
      await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: false, target: o.target, error: safeErr(e) });
      stats.organize_errors = (stats.organize_errors || 0) + 1;
    }
  }

  async function fileReconciled(o, store, ctx, stats) {
    const rf = reconciledFolders(o.invoice_date);
    if (!rf) throw new Error('date_not_determined');
    const g = await drive.get(o.drive_file_id);
    if (g.status !== 200 || g.file.trashed) throw new Error('original_unavailable_' + g.status);
    const parents = g.file.parents || [];
    // Safety: every place it is in is inside the store's folders (00_Upload, the folders this worker made and that are still
    // in the store folder, the store folder itself, or a folder staff keep right in it). Anything else is not touched: the
    // error is shown and retried (a file kept in two places is not taken out of the one outside).
    if (!parents.length) throw new Error('outside_store_folders');
    for (const p of parents) if (!(await insideStore(p, store, o)) && !(await staffPlace([p], store, ctx, o))) throw new Error('outside_store_folders');
    const root = await ensureFolder(store, store.root_folder_id, rf.root, 'reconciled_root');
    const target = await ensureFolder(store, root, rf.month, 'reconciled_month');
    const moved = parents.length === 1 && parents[0] === target ? null
      : await drive.update(o.drive_file_id, { addParents: parents.includes(target) ? null : target, removeParents: parents.filter(p => p !== target).join(',') || null });
    await db.rpc('invoice_organize_result', { file_id: o.file_id, ok: true, target: o.target, folder_id: target, name: (moved && moved.name) || g.file.name });
    stats.organized = (stats.organized || 0) + 1;
  }

  // Moto 2026-10-12: 「この内容で反映」 (or an automatic posting) → the original's name in Drive becomes 日付_業者名_番号
  // (2026-10-07_Marujuu-Produce_12345.pdf) where it is; only then is it queued for QuickBooks. Nothing is moved here. A file
  // that is no longer in the store's folders (a person moved it away) is not touched: the error is shown and retried.
  // t: a row of invoice_rename_due. actor: the person whose posting or correction asked for it (null: the worker).
  async function renameOne(t, ctx, actor) {
    const store = ctx.all_stores.find(s => s.store_id === t.store_id);
    let name = null;
    try {
      if (!store) throw new Error('store_not_found');
      const g = await drive.get(t.drive_file_id);
      if (g.status !== 200 || !g.file || g.file.trashed) throw new Error('original_unavailable_' + (g.status === 200 ? 'trashed' : g.status));
      const parents = g.file.parents || [];
      const allowed = new Set([store.upload_folder_id, store.root_folder_id, ...(t.store_folder_ids || []), ...(t.upload_folder_ids || [])].filter(Boolean));
      if (!parents.length || !(parents.every(p => allowed.has(p)) || await staffPlace(parents, store, ctx, t))) throw new Error('outside_store_folders');
      // An invoice of several originals: _p1, _p2 … in page order (UI案50 5).
      name = postedName({ invoiceDate: t.invoice_date, vendor: t.vendor_name, docType: t.doc_type, invoiceNo: t.invoice_no, internalNo: t.internal_no,
        part: Number(t.parts) > 1 ? Number(t.part_no) || 1 : null,
        ext: extensionFor(t.original_name, g.file.mimeType), version: t.version_no });
      if (!name) throw new Error('name_not_determined');
      if (g.file.name !== name) {
        // Another file in the same folder already has this name: "_2" is added (nothing is overwritten).
        const taken = [];
        for (const p of parents) taken.push(...(await drive.listNames(p)).filter(x => x.id !== t.drive_file_id).map(x => x.name));
        name = uniqueName(name, taken);
      }
      if (g.file.name !== name) { const done = await drive.update(t.drive_file_id, { name }); name = (done && done.name) || name; }
    } catch (e) {
      await db.rpc('invoice_rename_result', { file_id: t.file_id, ok: false, error: safeErr(e), actor: actor || null });
      return { ok: false, error: safeErr(e) };
    }
    await db.rpc('invoice_rename_result', { file_id: t.file_id, ok: true, key: t.target_key, name, actor: actor || null });
    return { ok: true, name };
  }

  // The posting (and a correction of a posted invoice) renames its own original at once. The posting stands whatever
  // happens here; a failed rename is tried again by the worker.
  async function renameNow(actor, fileId, ctx) {
    try {
      const [t] = await db.rpc('invoice_rename_due', { file_id: fileId, limit: 1 });
      return t ? await renameOne(t, ctx, actor) : null;
    } catch (e) { return { ok: false, error: safeErr(e) }; }
  }

  async function renameStep(ctx, stats, until) {
    if (!ctx.mode.rename) return;
    for (const t of await db.rpc('invoice_rename_due', { limit: 10 })) {
      if (now() > until) break;
      let r;
      try { r = await renameOne(t, ctx, null); } catch (e) { r = { ok: false }; }
      stats[r.ok ? 'renamed' : 'rename_errors'] = (stats[r.ok ? 'renamed' : 'rename_errors'] || 0) + 1;
    }
  }

  // One ledger for every original, whoever sends it. With route 'external' the existing forwarder reads and records through the
  // qb_external_* actions. The rows of this system (route 'invoice-intake') are sent from here, by Gmail (Moto 2026-10-18・UI案56):
  // right after a posting is queued (qbAfterPost), and by every worker run for what that start left (a lost start, a retry).
  async function qbStep(ctx, owner, stats) {
    if (ctx.qb.enabled && QB_ROUTES.includes(ctx.qb.route)) {
      await db.rpc('invoice_qb_sweep', {});
      for (const c of await db.rpc('invoice_qb_candidates', { limit: 20 })) {
        const r = await db.rpc('invoice_qb_enqueue', { file_id: c.file_id });
        if (r.queued) stats.qb_queued = (stats.qb_queued || 0) + 1;
      }
    }
    const s = await qbSend('worker');
    for (const [k, v] of Object.entries(s)) if (typeof v === 'number') stats['qb_' + k] = (stats['qb_' + k] || 0) + v;
    await qbReconcile(stats);
    await qbNotices(stats);
  }

  // The older stand-in for tests that predate Gmail: it records what would be sent and finds what it sent by the attempt key.
  function mailerTransport(m) {
    return {
      async ready() { return { ok: true, account: 'synthetic-sender' }; },
      async history(o) { if (!m.lookup) return { state: 'none' }; const p = await m.lookup(o.attemptKey); return p && p.found ? { state: 'sent', messageId: p.messageId, own: true } : { state: 'none' }; },
      async send(x) { return m.send({ to: x.to, idempotencyKey: x.idempotencyKey, subject: x.subject, attachment: x.attachment }); },
      async notify() { return { ok: false, error: 'not_supported' }; },
    };
  }

  // The permission was taken back, ran out or lacks a scope: sending stops (the rows wait), the connection shows it, Moto is told
  // once a Hawaii day while this system has something to send.
  async function gmailProblem(r) {
    try {
      const m = await db.rpc('invoice_gmail_mark', { status: /scope|403|insufficient/.test(String(r.error)) ? 'denied' : 'expired', error: r.error || 'gmail_auth' });
      const day = new Date(now() - 10 * 3600000).toISOString().slice(0, 10);
      if (m && m.ok) await db.rpc('invoice_qb_alert_put', { kind: 'auth', key: 'auth:' + day, data: { error: r.error || null } });
    } catch (e) { console.error('invoice-intake gmail mark', safeErr(e)); }
  }

  // A result is written once more after a short wait when the database does not answer; a sent message is never sent again for it
  // (a row still "sending" becomes unknown after 15 minutes and is then found by its attempt mark in the sent mail).
  async function qbRecord(id, p) {
    for (let i = 0; i < 3; i++) {
      try { return await db.rpc('invoice_qb_result', { id, ...p }); }
      catch (e) { if (i === 2) { console.error('invoice-intake qb result', p.state, safeErr(e)); return null; } await sleep(1000 * (i + 1)); }
    }
  }

  async function qbSend(trigger, opts = {}) {
    const stats = {};
    let ctx;
    try { ctx = await context(); } catch (e) { return { context_errors: 1 }; }
    if (!ctx.qb.enabled) return stats;                                     // the ledger is off: nothing is sent
    if (!(await db.rpc('invoice_qb_has_due', {}))) return stats;
    const tr = newTransport();
    const rd = await tr.ready();
    if (!rd.ok) { if (rd.auth) await gmailProblem(rd); stats.not_ready = 1; return stats; }
    const owner = 's-' + crypto.randomUUID(), t0 = now(), budget = opts.budgetMs || 100000, max = opts.max || 20;
    for (let i = 0; i < max && now() - t0 < budget; i++) {
      const o = await db.rpc('invoice_qb_reserve', { owner });
      if (!o) break;
      let r;
      try { r = await qbSendOne(o, owner, tr, trigger); }
      catch (e) { console.error('invoice-intake qb send', safeErr(e)); r = 'failed'; }
      stats[r] = (stats[r] || 0) + 1;
      if (r === 'auth') break;
    }
    if (stats.sent) await publishSummary(null, null);
    if (trigger !== 'worker') await qbNotices(null);
    return stats;
  }

  // One reserved row: the settings again → the sent mail → the Drive bytes → the reservation again → one mail → the Gmail ID.
  async function qbSendOne(o, owner, tr, trigger) {
    const fail = (state, error, result) => qbRecord(o.id, { state, error, ...(result ? { result } : {}) });
    let c;
    try { c = await db.rpc('invoice_qb_send_context', { id: o.id, owner }); } catch (e) { await fail('error', 'context_failed'); return 'error'; }
    if (!c.ok) {
      if (c.why === 'not_reserved') return 'skipped';
      if (c.why === 'content_changed') { await db.rpc('invoice_qb_content_changed', { id: o.id, owner }); return 'content_changed'; }
      await fail('error', c.why); return 'error';
    }
    const f = c.file, key = { sha256: o.sha256, driveFileId: f.drive_file_id, attemptKey: o.attempt_key, to: o.to_address, size: f.size };
    // 1) Gmail's sent mail, every page: a send found (this ledger's, or the forwarder's before) is recorded, never sent again; a
    //    failed search is never read as "not sent".
    let prev;
    try { prev = await tr.history(key); }
    catch (e) { if (e && e.auth) await gmailProblem({ auth: true, error: 'gmail_read_refused' }); await fail('error', 'gmail_history_failed'); return e && e.auth ? 'auth' : 'error'; }
    if (prev.state === 'sent') {
      await qbRecord(o.id, { state: 'sent', message_id: prev.messageId, result: { via: 'gmail_history', own: !!prev.own,
        note: prev.own ? 'この台帳の送信を Gmail の送信済みで見つけた（送り直していない）' : '前の転送で送った（Gmail の送信済みで見つけた・送り直していない）' } });
      return 'found';
    }
    if (prev.state === 'conflict') {
      await fail('unknown', prev.reason, { via: 'gmail_history', seen_message: prev.messageId || null,
        note: prev.reason === 'same_drive_id_other_content' ? '同じ原本（Drive の ID）を前に別の中身で送っています。人が確かめてください（送っていない）'
          : '送信済みに同じ原本の印がありますが、添付を確かめられません。人が確かめてください（送っていない）' });
      return 'conflict';
    }
    // 2) The original's bytes: the content that was posted and queued, or nothing is sent.
    let bytes;
    try { bytes = await drive.download(f.drive_file_id); } catch (e) { await fail('error', 'drive_download_failed'); return 'error'; }
    if ((await sha256Hex(bytes)) !== o.sha256) { await db.rpc('invoice_qb_content_changed', { id: o.id, owner }); return 'content_changed'; }
    // 3) Just before sending: still this sender's reservation, young enough, nothing changed.
    let chk;
    try { chk = await db.rpc('invoice_qb_send_check', { id: o.id, owner, sha256: o.sha256, attempt_key: o.attempt_key, drive_file_id: f.drive_file_id }); }
    catch (e) { chk = { ok: false, why: 'check_failed' }; }
    if (!chk.ok) {
      if (chk.why === 'not_reserved') return 'skipped';
      if (chk.why === 'content_changed') { await db.rpc('invoice_qb_content_changed', { id: o.id, owner }); return 'content_changed'; }
      await fail('error', chk.why); return 'error';
    }
    // 4) One mail: the original as its only part, the three marks in the subject, no body.
    const started = new Date(now()).toISOString();
    let res;
    try {
      res = await tr.send({ from: c.from, to: c.to, idempotencyKey: o.attempt_key,
        subject: qbSubject({ currentName: f.current_name, driveFileId: f.drive_file_id, sha256: o.sha256, attemptKey: o.attempt_key }),
        attachment: { name: f.current_name, mime: f.mime_type || 'application/octet-stream', bytes } });
    } catch (e) { res = { ok: false, unknown: true, error: 'gmail_send_failed' }; }
    if (res && res.ok) {
      await qbRecord(o.id, { state: 'sent', message_id: res.messageId || null, result: { via: 'gmail', started_at: started, sent_at: new Date(now()).toISOString(), trigger: trigger || null } });
      return 'sent';
    }
    if (!res || res.unknown) { await fail('unknown', (res && res.error) || 'send_unknown'); return 'unknown'; }
    if (res.auth) await gmailProblem({ auth: true, error: res.error });
    await fail('error', res.error || 'send_failed');
    return res.auth ? 'auth' : 'error';
  }

  // Unknown sends of this system are looked for in the sent mail (15 minutes after, then 30, 60 …, six times): a send found by its
  // marks is recorded as sent. Nothing is ever sent again from here; what is not found stays for a person.
  async function qbReconcile(stats) {
    let rows = [];
    try { rows = await db.rpc('invoice_qb_unknown_due', { limit: 5 }); } catch { rows = []; }
    if (!rows.length) return;
    const tr = newTransport(), rd = await tr.ready();
    if (!rd.ok) { if (rd.auth) await gmailProblem(rd); return; }
    for (const r of rows) {
      let h = null;
      try { h = await tr.history({ sha256: r.sha256, driveFileId: r.drive_file_id, attemptKey: r.attempt_key, to: r.to_address, size: r.size }); } catch { h = null; }
      if (h && h.state === 'sent') {
        await qbRecord(r.id, { state: 'sent', message_id: h.messageId, result: { via: 'gmail_history', own: !!h.own,
          note: '結果が分からなかった送信を Gmail の送信済みで見つけた（送り直していない）' } });
        if (stats) stats.qb_found_later = (stats.qb_found_later || 0) + 1;
      } else await db.rpc('invoice_qb_gmail_checked', { id: r.id });
    }
  }

  // Notices to Moto (decisions 1・2・5): made once in the database, then the mail and LINE (the app reads its own copy).
  async function qbNotices(stats) {
    try { await db.rpc('invoice_qb_alert_scan', {}); } catch (e) { console.error('invoice-intake notices', safeErr(e)); }
    try {
      const lines = await db.rpc('invoice_qb_alert_claim', { channel: 'line', limit: 10 });
      if (lines.length) {
        let route = null; try { route = await db.rpc('invoice_line_route', {}); } catch { route = null; }
        const tok = env('LINE_CHANNEL_ACCESS_TOKEN');
        for (const a of lines) {
          const st = route && tok ? await linePush(route, tok, a) : 'skipped';
          await db.rpc('invoice_qb_alert_done', { id: a.id, channel: 'line', state: st });
        }
      }
      const mails = await db.rpc('invoice_qb_alert_claim', { channel: 'email', limit: 10 });
      if (mails.length) {
        const tr = newTransport(), rd = await tr.ready();
        for (const a of mails) {
          let st;
          if (!rd.ok) st = rd.auth || rd.error === 'gmail_not_connected' ? 'skipped' : 'pending';
          else {
            const t = noticeText(a);
            let r; try { r = await tr.notify({ to: rd.account, subject: '【Funergy+】' + t.title, text: t.text }); } catch { r = { ok: false, unknown: true }; }
            st = r && r.ok ? 'sent' : r && r.unknown ? 'failed' : r && r.error === 'not_supported' ? 'skipped' : 'pending';
          }
          await db.rpc('invoice_qb_alert_done', { id: a.id, channel: 'email', state: st });
        }
      }
    } catch (e) { if (stats) stats.notice_errors = (stats.notice_errors || 0) + 1; console.error('invoice-intake notices', safeErr(e)); }
  }
  async function linePush(route, tok, a) {
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
      let r;
      try {
        r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', signal: ac.signal,
          headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', 'x-line-retry-key': a.id },
          body: JSON.stringify({ to: route.group_id, messages: [{ type: 'text', text: noticeText(a).line.slice(0, 4900) }] }) });
      } finally { clearTimeout(tm); }
      if (r.ok || (r.status === 409 && r.headers.get('x-line-accepted-request-id'))) return 'sent';
      return r.status >= 400 && r.status < 500 && r.status !== 429 ? 'failed' : 'pending';
    } catch { return 'pending'; }
  }

  // After a posting (a person's, or automatic): the original is queued at once (it was renamed just before when renaming is on),
  // and when this system sends, the send starts now and goes on after the answer (the posting never waits for Gmail).
  async function qbAfterPost(files, ctx, trigger) {
    if (!ctx.qb.enabled || !QB_ROUTES.includes(ctx.qb.route) || !files.length) return null;
    let queued = 0;
    for (const f of files) {
      try { const r = await db.rpc('invoice_qb_enqueue', { file_id: f }); if (r && r.queued) queued++; } catch (e) { console.error('invoice-intake qb enqueue', safeErr(e)); }
    }
    const out = { queued, sending: false };
    if (queued && ctx.qb.route === 'invoice-intake' && background) {
      try { background(qbSend(trigger).catch(e => console.error('invoice-intake qb send', safeErr(e)))); out.sending = true; } catch { out.sending = false; }
    }
    return out;
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

  // Confirmed purchases per store, vendor and month (Moto 2026-10-14): the summaries the app reads are written again whenever
  // what they are made of changed. It never changes an invoice, the ledger or Drive, and a failure here never stops anything else.
  // `only` names what a person's action touched (doc_ids, file_id, outbox_id, months): only those months are written then.
  async function publishSummary(stats, only) {
    try {
      const r = await db.rpc('invoice_purchase_publish', only || {});
      if (stats) stats.purchase_published = (r && r.changed ? r.changed.length : 0);
      return { ok: true, changed: r && r.changed ? r.changed : [] };
    } catch (e) {
      if (stats) stats.purchase_errors = (stats.purchase_errors || 0) + 1;
      console.error('invoice-intake purchase summary', safeErr(e));
      return { ok: false };
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
      if (!ctx.mode.intake) {
        // With intake off, reconciling and QuickBooks results still move invoices: the summaries follow them.
        const st = { off: true }; await publishSummary(st);
        await db.rpc('invoice_run_log', { kind: 'intake', started_at: started, ok: true, stats: st }); return { ok: true, off: true };
      }
      const pilot = Array.isArray(ctx.mode.pilot_stores) && ctx.mode.pilot_stores.length ? new Set(ctx.mode.pilot_stores) : null;
      const stores = ctx.stores.filter(s => s.active && s.upload_folder_id && (!pilot || pilot.has(s.store_id)));
      try { for (const s of stores) await scanStore(s, ctx, stats); await db.rpc('invoice_drive_conn', { ok: true }); }
      catch (e) { await db.rpc('invoice_drive_conn', { ok: false, error: safeErr(e) }); throw e; }
      const budget = Number(body.budget_ms) || 100000, batch = Math.max(1, Math.min(10, Number(ctx.rules.batch) || 3));
      for (const f of await db.rpc('invoice_files_due', { limit: batch, stores: stores.map(s => s.store_id) })) {
        if (now() - t0 > budget) { stats.deferred = (stats.deferred || 0) + 1; continue; }
        await processFile(f, ctx, owner, stats);
      }
      // Filing in 00_Upload (organize) and moving reconciled originals (organize_reconciled, Moto 2026-10-14) are two switches.
      // Until the second one is set, it follows the first (as before this change, filing included the reconciled ones). With
      // the second on, an original whose reconciliation is taken back also leaves 照合済み/年-月 (to 年/月/未照合).
      const rec = ctx.mode.organize_reconciled ?? ctx.mode.organize;
      const targets = [ctx.mode.organize && 'unreconciled', rec && 'reconciled'].filter(Boolean), back = !!rec && !ctx.mode.organize;
      if (targets.length) for (const o of await db.rpc('invoice_organize_due', { limit: 10, targets, back })) { if (now() - t0 > budget * 1.3) break; await organizeOne(o, ctx, stats); }
      // Posted originals are renamed before the QuickBooks step queues them (Moto 2026-10-12).
      await renameStep(ctx, stats, t0 + budget * 1.3);
      try { await qbStep(ctx, owner, stats); } catch (e) { stats.qb_errors = (stats.qb_errors || 0) + 1; console.error('invoice-intake qb', safeErr(e)); }
      await mirrorStep(ctx, stats);
      await integrityStep(ctx, stats);
      await publishSummary(stats);
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
  // date (the AI's transcription has none), the date is taken from the delivery date (Moto 2026-10-07) as long as no
  // saved correction has set the invoice date: a date that was ever saved through a correction (overrides) is kept,
  // whatever it equals, and is never moved by a later delivery-date correction. Otherwise the stored date is used;
  // with none stored, the AI's printed text decides, so a printed date that could not be read or that disagreed
  // stays a reason for a person and is never filled in.
  function invoiceDateInput(doc, hdr, ai) {
    const printed = ai ? String(ai.invoice_date_text ?? '').trim() : null;   // null: no transcription to go by
    const noPrinted = printed === '';
    const saved = !!(doc.overrides && Object.prototype.hasOwnProperty.call(doc.overrides, 'invoice_date'));
    if ('invoice_date' in hdr) return { text: hdr.invoice_date || null, iso: hdr.invoice_date || null, derived: false };
    if (noPrinted && !saved && (!doc.invoice_date || doc.invoice_date === doc.delivery_date)) return { text: null, iso: null, derived: true };
    if (doc.invoice_date || saved) return { text: doc.invoice_date || null, iso: doc.invoice_date || null, derived: false };
    return { text: printed || null, iso: ai ? ai.invoice_date || null : null, derived: false };
  }

  // Rebuilds reasons after a person's correction from the current values, never from the AI's.
  // ai: the AI's transcription of this document (invoice_get's ai_doc), used only for what was printed.
  // exclude: ids of documents not to compare with (the pages being merged into this invoice, UI案50 5).
  async function recheck(doc, lines, edits, ctx, ai, exclude) {
    const H = { ...doc, ...(edits.header || {}) };
    const dateIn = invoiceDateInput(doc, edits.header || {}, ai);
    const byId = Object.fromEntries((edits.lines || []).map(e => [e.line_id, e.set || {}]));
    const store = ctx.stores.find(s => s.store_id === doc.store_id) || { store_id: doc.store_id, auto_post: false };
    // A vendor merged into another one (業者の統合, Moto 2026-10-15) is read as the vendor it ended at.
    const vendor = finalVendor(ctx.vendors, H.vendor_key);
    const cents = c => (c === null || c === undefined ? null : (Number(c) / 100).toFixed(2));
    // A packing list stays one through other corrections; choosing the document type again decides anew.
    const packing = !('doc_type' in (edits.header || {})) && H.doc_type === 'invoice' && (doc.reasons || []).some(r => r.code === 'packing_list');
    const ext = {
      doc_type: packing ? 'packing_list' : H.doc_type, vendor_name: vendor ? vendor.display_name : H.vendor_raw, ship_to: doc.ship_to_raw, customer_account: doc.vendor_code,
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
      .filter(e => e.id !== doc.id && !(e.file_id === doc.file_id && e.sha256 === doc.sha256) && e.status !== 'duplicate' && e.duplicate_of !== doc.id
        && !(exclude && exclude.has(e.id)));
    // Records registered through the existing app screen are compared again (copies written by this intake are not returned).
    const app = await db.rpc('invoice_app_records', { store_id: doc.store_id });
    applyDuplicates(result, classifyDuplicates({ sha256: doc.sha256, store_id: doc.store_id, ...h, packing: result.reasons.some(r => r.code === 'packing_list') }, existing, app));
    // What the reading itself got wrong (also a document that could not be read at all), a replaced original and a store a
    // person chose cannot be fixed by editing values: those reasons stay.
    for (const r of doc.reasons || []) {
      if (['ai_truncated', 'multiple_documents', 'missing_pages', 'original_replaced', 'unreadable', 'ai_failed', 'store_assigned'].includes(r.code)
        && !result.reasons.some(x => x.code === r.code)) { result.reasons.push(r); result.autoEligible = false; }
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
    if ('doc_type' in header && !['invoice', 'packing_list', 'credit_memo', 'statement', 'receipt', 'other', 'unknown'].includes(header.doc_type)) throw new Error('bad_value');
    // A screen opened before a merge may still offer a merged vendor: the invoice gets the vendor it ended at (業者の統合).
    if (typeof header.vendor_key === 'string' && header.vendor_key) { const fv = finalVendor(ctx.vendors, header.vendor_key); if (fv) header.vendor_key = fv.vendor_key; }
    const result = await recheck(g.doc, g.lines, { header, lines: b.lines || [] }, ctx, g.ai_doc || null);
    const h = result.header;
    // An invoice with no printed invoice date takes its delivery date. When that gives a date the record does not
    // have yet (an older record, or a corrected delivery date), it is saved with this correction, so the stored
    // date matches the new reasons.
    if (!('invoice_date' in header) && result.invoiceDateDerived && h.invoice_date && h.invoice_date !== g.doc.invoice_date) header.invoice_date = h.invoice_date;
    if ('vendor_key' in header) { header.vendor_name = h.vendor_name || null; header.food_kind = header.food_kind ?? h.food_kind ?? null; }
    if ('invoice_no' in header) header.invoice_no_norm = h.invoice_no_norm;
    if ('doc_type' in header) { header.doc_type = h.doc_type; header.posting_kind = h.posting_kind; }   // packing_list → invoice
    if ('invoice_date' in header || 'delivery_date' in header) { header.effective_date = h.effective_date; header.effective_basis = h.effective_basis; header.posting_date = h.posting_date; }
    const lines = (b.lines || []).map(e => {
      const idx = g.lines.findIndex(l => l.id === e.line_id);
      if (idx < 0) throw new Error('line_not_found');
      const n = result.lines[idx];
      const set = { ...(e.set || {}) };
      for (const k of Object.keys(set)) if (!['qty', 'unit_price', 'amount_cents', 'line_discount_cents', 'purchase_unit', 'map_id'].includes(k)) throw new Error('field_not_editable');
      // A chosen mapping that is not in use (taken back by linking, or an older screen's list) is refused: the line would keep it with
      // another mapping's code (紐づけ 2026-10-18, review P3).
      if (set.map_id != null && set.map_id !== (n.map_id ?? null)) throw new Error('map_not_usable');
      if ('map_id' in set) Object.assign(set, { ingredient_code: n.ingredient_code ?? null, count_unit: n.count_unit ?? null, count_per_purchase: n.count_per_purchase ?? null,
        base_unit: n.base_unit ?? null, base_per_purchase: n.base_per_purchase ?? null });
      Object.assign(set, { price_per_purchase: n.price_per_purchase ?? null, price_per_count: n.price_per_count ?? null, price_per_base: n.price_per_base ?? null, prev_price: n.prev_price ?? null });
      return { line_id: e.line_id, set, reasons: n.reasons };
    });
    // Lines that were not edited still get their reasons refreshed (a header change can affect them).
    const untouched = g.lines.map((l, i) => ({ l, i })).filter(x => !(b.lines || []).some(e => e.line_id === x.l.id))
      .map(x => ({ line_id: x.l.id, set: {}, reasons: result.lines[x.i].reasons }));
    // A person who picks the vendor for a printed name that matched no vendor teaches that name: the next invoice with
    // the same printed name finds the vendor by itself (exact match only, as before). The database does it in the same
    // transaction as the correction, on the latest vendor row, and only appends the name: it never touches the vendor's
    // other settings (Codex R6). Only a name no vendor has yet is taught, so a name never becomes ambiguous.
    const saved = await db.rpc('invoice_edit', { actor, doc_id: b.doc_id, version: b.version, header, lines: [...lines, ...untouched], reason: b.reason,
      reasons: result.reasons, content_sig: h.content_sig, lines_sum_cents: h.lines_sum_cents, adjustment_ack: !!b.adjustment_ack,
      ack: Array.isArray(b.ack) ? b.ack.filter(x => typeof x === 'string') : [],
      // b.learn === false: the vendor of this invoice only (業者を決める: no printed name, or a name two vendors have).
      learn_alias: b.learn !== false && !!(header.vendor_key && !g.doc.vendor_key && aliasKey(g.doc.vendor_raw)) });
    // A correction of a posted invoice (date, vendor, number) gives its original the new name at once (Moto 2026-10-12).
    if (g.doc.status === 'posted' && ctx.mode.rename && saved) {
      saved.rename = await renameNow(actor, g.doc.file_id, ctx);
      for (const x of g.parts || []) await renameNow(actor, x.file_id, ctx);   // the other originals of the invoice (_p2 …)
    }
    // An original that was waiting for its name goes to the ledger now (one already queued or sent is not queued again).
    if (g.doc.status === 'posted' && saved) { try { saved.qb = await qbAfterPost([g.doc.file_id], ctx, 'correction'); } catch { saved.qb = null; } }
    return saved;
  }

  // ------------------------------------------------------------------ several originals, one invoice
  // Moto 2026-10-14「同じinvoice#で続いてるパターンもあるので、重複か複数枚で１つのinvoiceか選択して処理できる様に」(UI案50 5・7A・8A):
  // accounting picks the pages of one invoice number in page order (b.docs) and the ones that are duplicates (b.duplicates). The main
  // invoice is the posted one (a page added to a posted invoice corrects it), else one that already has pages, else the first page.
  // Its header keeps what identifies it (vendor, number, dates: the main page's, or the first page that has them); the amounts are
  // the last page's that has them (the total, tax and shipping are printed on the last page). Every line of every page is worked out
  // again for the whole invoice. b.preview: nothing is saved, the result is returned to be looked at first.
  const KEEP_ON_MERGE = ['ai_truncated', 'original_replaced', 'unreadable', 'ai_failed', 'store_assigned', 'packing_list'];
  async function merge(actor, b) {
    const order = Array.isArray(b.docs) ? b.docs.map(String) : [];
    const dupIds = Array.isArray(b.duplicates) ? b.duplicates.map(String) : [];
    if (order.length < 2 || order.length > 10 || new Set(order).size !== order.length || dupIds.length > 10
      || new Set(dupIds).size !== dupIds.length || dupIds.some(id => order.includes(id))) throw new Error('bad_merge');
    const gs = [];
    for (const id of order) gs.push(await db.rpc('invoice_get', { actor, doc_id: id }));
    if (gs.some(g => !['review', 'posted'].includes(g.doc.status))) throw new Error('invalid_state');
    if (gs.filter(g => g.doc.status === 'posted').length > 1 || gs.filter(g => (g.parts || []).length).length > 1) throw new Error('bad_merge');
    const main = gs.find(g => g.doc.status === 'posted') || gs.find(g => (g.parts || []).length) || gs[0];
    const others = gs.filter(g => g !== main);
    const versions = b.versions && typeof b.versions === 'object' ? b.versions : {};
    if (!b.preview) for (const g of gs) if (Number(versions[g.doc.id]) !== Number(g.doc.version)) throw new Error('conflict');
    // A page set aside as a duplicate is changed only with the version that was looked at.
    if (!b.preview) for (const id of dupIds) if (versions[id] == null || !Number.isInteger(Number(versions[id]))) throw new Error('conflict');
    // Page numbers: the order given; pages added to an invoice that already has some come after them.
    const had = (main.parts || []).length;
    const firstNo = had ? Math.max(Number(main.doc.part_no) || 1, ...main.parts.map(x => Number(x.part_no) || 0)) + 1 : 1;
    const partNo = new Map(had ? others.map((g, i) => [g.doc.id, firstNo + i]) : gs.map((g, i) => [g.doc.id, i + 1]));
    // The pages in page order (an invoice that already has pages counts as one, first).
    const seq = had ? [main, ...others] : gs;
    const pick = (f, last, zeroIsNone) => {
      const vals = seq.map(g => g.doc[f]).filter(v => v !== null && v !== undefined && v !== '' && !(zeroIsNone && Number(v) === 0) && !(Array.isArray(v) && !v.length));
      return vals.length ? vals[last ? vals.length - 1 : 0] : (zeroIsNone ? 0 : null);
    };
    const first = f => (main.doc[f] !== null && main.doc[f] !== undefined && main.doc[f] !== '' ? main.doc[f] : pick(f, false));
    const reasons = [];
    for (const g of gs) for (const r of g.doc.reasons || []) if (KEEP_ON_MERGE.includes(r.code) && !reasons.some(x => x.code === r.code)) reasons.push(r);
    // Lines: the main invoice's own (those of pages merged before included), then each new page's, in page order. A page's
    // page numbers follow the pages before it.
    let pageEnd = Math.max(0, ...main.lines.map(l => Number(l.page) || 0), ...(main.doc.pages || []).map(Number));
    const lines = main.lines.map(l => ({ ...l, moved: false }));
    const pages = [...(main.doc.pages || [])].map(Number);
    if (!pages.length) for (let i = 1; i <= Math.max(1, pageEnd); i++) pages.push(i);
    pageEnd = Math.max(pageEnd, ...pages, 1);
    const marked = [...(main.doc.pages_marked || [])];
    const ordered = had ? others : gs.filter(g => g !== main);
    for (const g of ordered) {
      const own = (g.doc.pages || []).map(Number).filter(n => n > 0);
      const span = Math.max(1, ...own, ...g.lines.map(l => Number(l.page) || 0));
      for (const l of g.lines) lines.push({ ...l, page: pageEnd + (Number(l.page) || 1), moved: true });
      for (let i = 1; i <= span; i++) pages.push(pageEnd + i);
      pageEnd += span;
      marked.push(...(g.doc.pages_marked || []));
    }
    const doc = { ...main.doc, reasons,
      vendor_key: first('vendor_key'), vendor_name: first('vendor_name'), vendor_raw: first('vendor_raw'), vendor_code: first('vendor_code'),
      invoice_no: first('invoice_no'), invoice_no_norm: first('invoice_no_norm'), invoice_date: first('invoice_date'), delivery_date: first('delivery_date'),
      due_date: first('due_date'), currency: first('currency'), ship_to_raw: first('ship_to_raw'),
      subtotal_cents: pick('subtotal_cents', true), total_cents: pick('total_cents', true),
      tax_cents: pick('tax_cents', true, true), shipping_cents: pick('shipping_cents', true, true), discount_cents: pick('discount_cents', true, true),
      other_charges: pick('other_charges', true) || [], pages, pages_marked: marked,
      references_raw: seq.flatMap(g => g.doc.references_raw || []) };
    // What the database refuses is said already at the preview (the same rules as invoice_merge): the same store, vendor, number,
    // kind of document and currency (what could not be read may join), one document per original, read from what it holds now,
    // and never a new reading of an original that is already a page of the invoice.
    const same = (x, y) => x == null || y == null || x === y;
    const kind = (x, y) => x === y || x === 'unknown' || y === 'unknown';
    const files = new Set([main.doc.file_id, ...(main.parts || []).map(x => x.file_id)]);
    for (const g of gs) {
      if (g.doc.store_id !== doc.store_id || !same(g.doc.vendor_key, doc.vendor_key) || !same(g.doc.invoice_no_norm, doc.invoice_no_norm)
        || !kind(g.doc.doc_type, doc.doc_type) || !same(g.doc.currency, doc.currency) || Number(g.file_docs) > 1 || Number(g.doc.doc_index) > 0
        || (g.file && g.file.current_sha256 !== g.doc.sha256)) throw new Error('bad_merge');
      if (g !== main) { if (files.has(g.doc.file_id)) throw new Error('bad_merge'); files.add(g.doc.file_id); }
    }
    const ctx = await context();
    const exclude = new Set([...order, ...dupIds, ...(main.parts || []).map(x => x.id)]);
    const result = await recheck(doc, lines, { header: {}, lines: [] }, ctx, main.ai_doc || null, exclude);
    const h = result.header;
    const where = f => { const i = seq.map(g => g.doc[f]).map(v => (v === null || v === undefined || Number(v) === 0 ? null : v)).lastIndexOf(doc[f]); return i < 0 ? null : seq[i].doc.id; };
    const plan = {
      main: main.doc.id, posted: main.doc.status === 'posted',
      parts: gs.map(g => ({ id: g.doc.id, part_no: g === main ? (Number(main.doc.part_no) || partNo.get(g.doc.id) || 1) : partNo.get(g.doc.id), main: g === main })),
      header: { vendor_name: h.vendor_name || null, invoice_no: h.invoice_no || null, invoice_date: h.invoice_date || null, currency: h.currency || null,
        subtotal_cents: h.subtotal_cents, tax_cents: h.tax_cents, shipping_cents: h.shipping_cents, discount_cents: h.discount_cents, other_cents: h.other_cents,
        total_cents: h.total_cents, lines_sum_cents: h.lines_sum_cents,
        from: { total_cents: where('total_cents'), tax_cents: where('tax_cents'), shipping_cents: where('shipping_cents') } },
      lines_n: result.lines.length, pages: pages.length, reasons: result.reasons,
    };
    if (b.preview) return plan;
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 500) : '複数枚で 1 つの invoice';
    const saved = await db.rpc('invoice_merge', { actor, doc_id: main.doc.id, version: main.doc.version, part_no: plan.parts.find(x => x.main).part_no,
      parts: others.map(g => ({ id: g.doc.id, version: g.doc.version, part_no: partNo.get(g.doc.id) })),
      duplicates: dupIds.map(id => ({ id, version: Number(versions[id]) })),
      // The kind of purchase a person chose for the invoice (food / other) stays: only the vendor's default fills it in.
      header: { ...h, food_kind: first('food_kind') ?? h.food_kind ?? null, pages, pages_marked: marked, other_charges: h.other_charges || [] },
      lines: lines.map((l, i) => { const n = result.lines[i];
        return { line_id: l.id, page: l.page, reasons: n.reasons, map_id: n.map_id ?? null, ingredient_code: n.ingredient_code ?? null, count_unit: n.count_unit ?? null,
          count_per_purchase: n.count_per_purchase ?? null, base_unit: n.base_unit ?? null, base_per_purchase: n.base_per_purchase ?? null,
          price_per_purchase: n.price_per_purchase ?? null, price_per_count: n.price_per_count ?? null, price_per_base: n.price_per_base ?? null, prev_price: n.prev_price ?? null }; }),
      reasons: result.reasons, reason, ack: Array.isArray(b.ack) ? b.ack.filter(x => typeof x === 'string') : [], adjustment_ack: !!b.adjustment_ack });
    // A posted invoice: its originals get their names (_p1, _p2 …) and are filed with it now.
    if (saved && saved.posted) {
      if (ctx.mode.organize) for (const f of saved.file_ids || []) await db.rpc('invoice_organize_request', { file_id: f, target: 'unreconciled' });
      if (ctx.mode.rename) { saved.rename = []; for (const f of saved.file_ids || []) saved.rename.push(await renameNow(actor, f, ctx)); }
    }
    return { ...saved, plan };
  }

  // ------------------------------------------------------------------ 業者の統合 (Moto 2026-10-15・UI案51 1A・2A・3A)
  // The database merges the vendors by their names (invoice_vendor_merge) or takes a merge back (invoice_vendor_unmerge). The
  // invoices waiting for review that it moved (also those whose printed name no vendor had: the database gives them the kept
  // vendor and records them, so taking the merge back makes them wait for a vendor again) are worked out again here, as a person's
  // correction would (reasons, duplicates, the vendor's mode): at most VENDOR_RECHECK in one call, the others when they are
  // corrected. b.preview: nothing is changed; what would change is returned.
  const VENDOR_RECHECK = Math.max(1, Number(deps.vendorRecheck) || 60);
  const strList = x => (Array.isArray(x) ? x.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean) : []);
  // One that cannot be worked out is passed over (counted in failed), so it never holds the others back: up to VENDOR_RECHECK are
  // worked out in one call, trying at most twice as many; the rest are left for the next call (left).
  async function recheckVendorDocs(actor, ids, target, reason) {
    const out = { fixed: 0, failed: 0, left: 0 };
    let i = 0;
    for (; i < ids.length && out.fixed < VENDOR_RECHECK && i < VENDOR_RECHECK * 2; i++) {
      const id = ids[i];
      try {
        const g = await db.rpc('invoice_get', { actor, doc_id: id });
        if (!g || !g.doc || g.doc.status !== 'review') continue;
        await edit(actor, { doc_id: id, version: g.doc.version, header: target && !g.doc.vendor_key ? { vendor_key: target } : {}, lines: [], reason, ack: [] });
        out.fixed++;
      } catch (e) { out.failed++; console.error('invoice-intake vendor recheck', safeErr(e)); }
    }
    out.left = ids.length - i;
    return out;
  }
  async function vendorMerge(actor, b) {
    const names = strList(b.names);
    if (typeof b.to !== 'string' || !b.to.trim() || !names.length || names.length > 50) throw new Error('bad_value');
    if (b.food_kind != null && b.food_kind !== '' && b.food_kind !== 'food' && b.food_kind !== 'nonfood') throw new Error('bad_value');
    const r = await db.rpc('invoice_vendor_merge', { actor, to: b.to.trim(), names, preview: b.preview === true,
      food_kind: b.food_kind || null, group_id: typeof b.group_id === 'string' ? b.group_id : null });
    if (b.preview === true || !r.merge_id) return r;
    r.recheck = await recheckVendorDocs(actor, r.review_doc_ids || [], r.target.vendor_key, '業者の統合：' + r.target.display_name);
    r.summary = (await publishSummary(null, { months: r.months || [], doc_ids: r.review_doc_ids || [] })).ok;
    return r;
  }
  // ------------------------------------------------------------------ 新しい業者を決める (Moto 2026-10-16・UI案52 ③ 9A・10A・11A)
  // From an invoice whose printed vendor name is no vendor's: register it as a new vendor (invoice_vendor_register, under the
  // lock of the other vendor writes: a name some vendor has already is refused and that vendor is named, for the screen to offer
  // the merge instead), or, when the name has become one vendor's since the invoice was read, give the waiting invoices that
  // vendor (vendor_apply). Either way the invoices waiting with the name (and the one on screen) are worked out again with the
  // vendor, as a person's correction would: at most VENDOR_RECHECK in one call (the one on screen first). Merging the printed name
  // into a vendor that exists is vendor_merge_into (業者の統合, after checking that nothing else is merged).
  const docIdOf = x => (typeof x === 'string' && x ? x : null);
  async function vendorRegister(actor, b) {
    const v = b.vendor && typeof b.vendor === 'object' && !Array.isArray(b.vendor) ? b.vendor : {};
    const name = typeof v.display_name === 'string' ? v.display_name.trim() : '';
    if (typeof v.vendor_key !== 'string' || !name || (b.printed != null && typeof b.printed !== 'string')) throw new Error('bad_value');
    const r = await db.rpc('invoice_vendor_register', { actor, vendor: { vendor_key: v.vendor_key, display_name: name, food_kind: v.food_kind ?? null },
      printed: typeof b.printed === 'string' ? b.printed : null, doc_id: docIdOf(b.doc_id) });
    if (!r || !r.ok) return r;
    r.recheck = await recheckVendorDocs(actor, r.doc_ids || [], r.vendor.vendor_key, '新しい業者として登録：' + r.vendor.display_name);
    r.summary = (await publishSummary(null, { months: r.months || [], doc_ids: r.doc_ids || [] })).ok;
    return r;
  }
  async function vendorApply(actor, b) {
    if (typeof b.name !== 'string' || !b.name.trim() || (b.vendor_key != null && typeof b.vendor_key !== 'string')) throw new Error('bad_value');
    const w = await db.rpc('invoice_vendor_waiting', { actor, name: b.name, doc_id: docIdOf(b.doc_id) });
    // Only a name exactly one vendor has (and the one the screen showed, b.vendor_key): with none, with two or with another one,
    // the invoice waits for a person to choose.
    if ((w.vendors || []).length !== 1 || (b.vendor_key && w.vendors[0].vendor_key !== b.vendor_key)) return { ok: false, vendors: w.vendors || [] };
    const vk = w.vendors[0].vendor_key;
    const r = { ok: true, vendor: w.vendors[0], doc_ids: w.doc_ids || [], closed_left: w.closed_left || 0, months: w.months || [] };
    r.recheck = await recheckVendorDocs(actor, r.doc_ids, vk, '業者を決めた：' + w.vendors[0].display_name);
    r.summary = (await publishSummary(null, { months: r.months, doc_ids: r.doc_ids })).ok;
    return r;
  }
  async function vendorMergeInto(actor, b) {
    if (typeof b.vendor_key !== 'string' || typeof b.name !== 'string' || !b.name.trim() || (b.group_id != null && typeof b.group_id !== 'string')) throw new Error('bad_value');
    const r = await db.rpc('invoice_vendor_merge_into', { actor, vendor_key: b.vendor_key, name: b.name, doc_id: docIdOf(b.doc_id),
      group_id: typeof b.group_id === 'string' ? b.group_id : null, preview: b.preview === true });
    if (b.preview === true || !r || !r.ok || !r.merge_id) return r;
    r.recheck = await recheckVendorDocs(actor, r.review_doc_ids || [], r.target.vendor_key, '業者の統合：' + r.target.display_name);
    r.summary = (await publishSummary(null, { months: r.months || [], doc_ids: r.review_doc_ids || [] })).ok;
    return r;
  }
  async function vendorUnmerge(actor, b) {
    if (typeof b.merge_id !== 'string') throw new Error('bad_value');
    const r = await db.rpc('invoice_vendor_unmerge', { actor, merge_id: b.merge_id, preview: b.preview === true });
    if (b.preview === true) return r;
    r.recheck = await recheckVendorDocs(actor, r.review_doc_ids || [], null, '業者の統合を外した');
    r.summary = (await publishSummary(null, { months: r.months || [], doc_ids: r.review_doc_ids || [] })).ok;
    return r;
  }

  // ------------------------------------------------------------------ 紐づけ 段階 1 (Moto 2026-10-18・UI案55 決まったこと 1〜8)
  // The Drive intake's items (a vendor's item code, or its printed name with the pack) linked to codes of the current master. Who may:
  // accounting, 事務Crew, GM, CEO, and the Head Chef / AM accounts (invoice_link_role; nothing else of the intake for those two). A link
  // changes the mapping table only; then the lines already taken in follow at once (relink: the intake's own mapping step, applied by
  // invoice_link_apply), so a posted line gets its price history and the month's purchase summary its classes. Amounts never change.
  const LINK_MAX = 300, APPLY_CHUNK = 500;
  const str = (x, n) => typeof x === 'string' && x.length > 0 && x.length <= n;
  const optStr = (x, n) => x == null || (typeof x === 'string' && x.length <= n);
  const uuidOk = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const verOk = x => x == null || (Number.isInteger(x) && x > 0);
  const itemOk = x => x && typeof x === 'object' && str(x.vendor_key, 100)
    && ((str(x.vendor_item_code, 100) && x.alias_key == null) || (x.vendor_item_code == null && str(x.alias_key, 300) && optStr(x.spec_key, 200)));
  // Every line (of these vendors, or all), page by page: nothing is left out without saying so (LINES_PAGE × LINES_PAGES at most).
  const LINES_PAGE = 20000, LINES_PAGES = 50;
  async function linkLines(actor, vendorKeys) {
    const all = [];
    for (let i = 0; i < LINES_PAGES; i++) {
      const page = await db.rpc('invoice_link_lines', { actor, ...(vendorKeys ? { vendor_keys: vendorKeys } : {}), limit: LINES_PAGE, offset: i * LINES_PAGE });
      all.push(...(page || []));
      if (!page || page.length < LINES_PAGE) return { lines: all, truncated: false };
    }
    return { lines: all, truncated: true };
  }
  async function linkData(actor, b) {
    const r = await db.rpc('invoice_link_data', { actor });
    const { lines, truncated } = await linkLines(actor, null);
    // the lines not in step with the links in use (relink would change them): そろえる puts them right. An invoice left on a vendor merged
    // into another (a closed month's, or one kept apart) is not linked here (its vendor's links moved with the merge): never waiting.
    const merged = mergedKeys(r.vendors);
    const pending = new Set(lines.filter(l => !merged.has(l.vendor_key) && relink(l, r.maps || [])).map(l => l.id));
    return { role: r.role, items: groupItems(lines, { vendors: r.vendors, maps: r.maps, marks: r.marks, pending }), vendors: r.vendors || [],
      people: r.people || {}, lines: lines.length, waiting: pending.size, truncated, at: new Date(now()).toISOString() };
  }
  // The lines of these vendors (null: all) follow the links in use (relink works the whole state out again, so a line left behind is
  // put right too). In chunks (one transaction each); a line changed meanwhile is passed over (the next action or そろえる does it).
  const mergedKeys = vendors => new Set((vendors || []).filter(v => v.merged_into).map(v => v.vendor_key));
  // The same as invoice_link_apply works out: the vendor's links in use, "id:version" in id order, joined with commas, as sha-256 hex.
  const mapsFp = (maps, vk) => sha256Hex(new TextEncoder().encode((maps || []).filter(m => m.vendor_key === vk && !m.retired_at)
    .map(m => m.id + ':' + m.version).sort().join(',')));
  async function linkSync(actor, vendorKeys) {
    const out = { lines: 0, prices: 0, voided: 0, skipped: 0, doc_ids: [], months: [], truncated: false };
    if (vendorKeys && !vendorKeys.length) return out;
    const ctx = await context();
    const got = await linkLines(actor, vendorKeys);
    out.truncated = got.truncated;
    const updates = [], merged = mergedKeys(ctx.vendors);
    for (const l of got.lines) { if (merged.has(l.vendor_key)) continue; const u = relink(l, ctx.maps); if (u) updates.push(u); }
    // the vendor's links in use as read here (ids and versions): the database passes over a line whose vendor's links changed since,
    // so an older そろえる/戻す never writes over a newer link (Codex P2 on PR #77)
    const fps = new Map(), byLine = new Map(got.lines.map(l => [l.id, l.vendor_key]));
    for (const u of updates) {
      const vk = byLine.get(u.line_id);
      if (!fps.has(vk)) fps.set(vk, await mapsFp(ctx.maps, vk));
      u.maps_fp = fps.get(vk);
    }
    for (let i = 0; i < updates.length; i += APPLY_CHUNK) {
      const r = await db.rpc('invoice_link_apply', { actor, updates: updates.slice(i, i + APPLY_CHUNK) });
      out.lines += r.lines || 0; out.prices += r.prices || 0; out.voided += r.voided || 0; out.skipped += r.skipped || 0;
      out.doc_ids.push(...(r.doc_ids || [])); out.months.push(...(r.months || []));
    }
    out.months = [...new Set(out.months)].sort();
    return out;
  }
  async function linkFollow(actor, r, vendorKeys) {
    r.sync = await linkSync(actor, vendorKeys);
    // posted lines with a code now count by the code's class in the purchase summary (open months; a closed month stays as it was)
    r.summary = r.sync.lines ? (await publishSummary(null, { months: r.sync.months, doc_ids: r.sync.doc_ids })).ok : true;
    return r;
  }
  async function linkSave(actor, b) {
    const links = Array.isArray(b.links) ? b.links : null;
    if (!links || !links.length || links.length > LINK_MAX) throw new Error('bad_value');
    const clean = links.map(x => {
      if (!itemOk(x) || !str(x.ingredient_code, 64) || !(x.map_id == null || uuidOk(x.map_id)) || !verOk(x.version) || (x.map_id != null) !== (x.version != null)
        || !optStr(x.note, 300)) throw new Error('bad_value');
      return { vendor_key: x.vendor_key, vendor_item_code: x.vendor_item_code ?? null, alias_key: x.alias_key ?? null, spec_key: x.spec_key ?? '',
        ingredient_code: x.ingredient_code, map_id: x.map_id ?? null, version: x.version ?? null, note: x.note ?? null };
    });
    const r = await db.rpc('invoice_link_save', { actor, links: clean });
    return linkFollow(actor, r, [...new Set(r.maps.map(m => m.vendor_key))]);
  }
  async function linkUndo(actor, b) {
    const maps = Array.isArray(b.maps) ? b.maps : null;
    if (!maps || !maps.length || maps.length > LINK_MAX || !maps.every(x => x && uuidOk(x.id) && verOk(x.version) && x.version != null)) throw new Error('bad_value');
    const r = await db.rpc('invoice_link_retire', { actor, maps: maps.map(x => ({ id: x.id, version: x.version })) });
    return linkFollow(actor, r, [...new Set(r.maps.map(m => m.vendor_key))]);
  }
  async function linkMark(actor, b) {
    const marks = Array.isArray(b.marks) ? b.marks : null;
    if (!marks || !marks.length || marks.length > LINK_MAX) throw new Error('bad_value');
    const clean = marks.map(x => {
      if (!itemOk(x) || !['excluded', 'new_item', 'later', 'included', 'none'].includes(x.state) || !verOk(x.version) || !optStr(x.note, 300)) throw new Error('bad_value');
      return { vendor_key: x.vendor_key, vendor_item_code: x.vendor_item_code ?? null, alias_key: x.alias_key ?? null, spec_key: x.spec_key ?? '',
        state: x.state, version: x.version ?? null, note: x.note ?? null };
    });
    return db.rpc('invoice_link_mark', { actor, marks: clean });
  }
  // そろえる: every line follows the links in use (taken in before a link, left on a link taken back, or left behind). Changes no link.
  async function linkSyncAll(actor) {
    const w = await db.rpc('invoice_link_whoami', { actor });
    if (!w || !w.role) throw new Error('forbidden');
    return linkFollow(actor, { role: w.role }, null);
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
    if (b.folder_id === store.root_folder_id) throw new Error('bad_value');       // nor the store folder, which is read live too (Moto 2026-10-08)
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

  // A person's change that can move an invoice between the purchase summary's places is followed at once by the summary
  // (the worker would otherwise catch up within its next run). The change itself stands whatever happens to the summary.
  // `hint` says which invoices, file, ledger row or month the action touched (null: settings, vendors and stores touch every month).
  const ids = (...x) => ({ doc_ids: x.filter(v => typeof v === 'string' && v) });
  const thenSummary = (fn, hint) => async (a, b) => {
    const r = await fn(a, b);
    const s = await publishSummary(null, hint ? hint(b) : null);
    if (r && typeof r === 'object' && !Array.isArray(r)) r.summary = s.ok;
    return r;
  };
  const ACTIONS = {
    backfill,
    list: (a, b) => db.rpc('invoice_list', { ...b, actor: a }).then(r => ({ ...r, rows: r.rows.map(x => ({ ...x, original_url: viewUrl(x.drive_file_id) })) })),
    get: (a, b) => db.rpc('invoice_get', { actor: a, doc_id: b.doc_id }).then(r => ({ ...r, original_url: r.file ? viewUrl(r.file.drive_file_id) : null })),
    health: a => db.rpc('invoice_health', { actor: a }),
    config: a => db.rpc('invoice_config', { actor: a }),
    problems: a => db.rpc('invoice_problems', { actor: a }).then(r => ({ files: r.files.map(f => ({ ...f, original_url: viewUrl(f.drive_file_id) })),
      qb: r.qb.map(o => ({ ...o, original_url: viewUrl(o.drive_file_id) })) })),
    edit: thenSummary(edit, b => ids(b.doc_id)),
    // Moto 2026-10-14: per store, vendor and month, "compared with the vendor's statement: all here" (or what is missing).
    purchase_check: thenSummary((a, b) => db.rpc('invoice_purchase_check', { actor: a, store_id: b.store_id, vendor_key: b.vendor_key, ym: b.ym,
      state: b.state, note: typeof b.note === 'string' ? b.note.slice(0, 500) : '', statement_cents: b.statement_cents ?? null }), b => ({ months: [String(b.ym || '')] })),
    post: thenSummary(async (a, b) => {
      const r = await db.rpc('invoice_post', { actor: a, doc_id: b.doc_id, version: b.version, reason: b.reason || '', ack: b.ack || [], adjustment_ack: !!b.adjustment_ack, supersedes: b.supersedes || null });
      const ctx = await context();
      // An invoice of several originals (UI案50 5): every one of them, in page order (file_ids).
      const files = Array.isArray(r.file_ids) && r.file_ids.length ? r.file_ids : (r.file_id ? [r.file_id] : []);
      if (ctx.mode.organize) for (const f of files) await db.rpc('invoice_organize_request', { file_id: f, target: 'unreconciled' });
      // Moto 2026-10-12: 「この内容で反映」 → the original's name becomes 日付_業者名_番号 now; QuickBooks follows (worker).
      if (ctx.mode.rename && files.length) {
        r.rename = await renameNow(a, files[0], ctx);
        for (const f of files.slice(1)) await renameNow(a, f, ctx);
      }
      // UI案56: queued at once, and this system's send starts now (it goes on after this answer; the posting stands either way).
      try { r.qb = await qbAfterPost(files, ctx, 'post'); } catch (e) { r.qb = null; }
      return r;
    }, b => ids(b.doc_id, b.supersedes)),
    // A preview saves nothing (and writes no summary).
    merge: (a, b) => (b.preview ? merge(a, b)
      : thenSummary(merge, x => ids(...(Array.isArray(x.docs) ? x.docs : []), ...(Array.isArray(x.duplicates) ? x.duplicates : [])))(a, b)),
    unmerge: thenSummary((a, b) => db.rpc('invoice_unmerge', { actor: a, doc_id: b.doc_id, version: b.version, reason: typeof b.reason === 'string' ? b.reason.slice(0, 500) : '' }), b => ids(b.doc_id)),
    qb_manual: thenSummary((a, b) => db.rpc('invoice_qb_manual', { actor: a, doc_id: b.doc_id, version: b.version, note: typeof b.note === 'string' ? b.note.slice(0, 300) : '' }), b => ids(b.doc_id)),
    reassign: thenSummary((a, b) => db.rpc('invoice_reassign', { actor: a, file_id: b.file_id, store_id: b.store_id, reason: b.reason || '' }), b => ({ file_id: String(b.file_id || '') })),
    mark: thenSummary((a, b) => db.rpc('invoice_mark', { actor: a, doc_id: b.doc_id, version: b.version, action: b.mark, duplicate_of: b.duplicate_of || null, reason: b.reason || '' }), b => ids(b.doc_id, b.duplicate_of)),
    relate: thenSummary((a, b) => db.rpc('invoice_relate', { actor: a, doc_id: b.doc_id, version: b.version, related_doc_id: b.related_doc_id, relation: b.relation }), b => ids(b.doc_id, b.related_doc_id)),
    reconcile: thenSummary((a, b) => db.rpc('invoice_reconcile', { actor: a, doc_id: b.doc_id, version: b.version, result: b.result, note: b.note || '', diff: b.diff || null }), b => ids(b.doc_id)),
    retry: (a, b) => db.rpc('invoice_file_retry', { actor: a, file_id: b.file_id }),
    qb_resolve: thenSummary((a, b) => db.rpc('invoice_qb_result', { actor: a, id: b.id, state: b.state, message_id: b.message_id || null, result: { note: b.note || null, checked_by: a } }), b => ({ outbox_id: String(b.id || '') })),
    latest_prices: async (a, b) => { const w = await db.rpc('invoice_whoami', { actor: a }); if (!READ.includes(w.role)) throw new Error('forbidden'); return db.rpc('invoice_latest_prices', { stores: b.stores || null, codes: b.codes || null }); },
    map_save: (a, b) => db.rpc('invoice_map_save', { actor: a, map: b.map }),
    vendor_save: thenSummary((a, b) => db.rpc('invoice_vendor_save', { actor: a, vendor: b.vendor })),
    store_save: thenSummary((a, b) => db.rpc('invoice_store_save', { actor: a, store: b.store })),
    settings_save: thenSummary((a, b) => db.rpc('invoice_settings_save', { actor: a, key: b.key, value: b.value })),
    folder_plan: folderPlan,
    folder_setup: folderSetup,
    price_history: priceHistory,
    vendor_seed: (a, b) => db.rpc('invoice_vendor_seed', { actor: a, apply: b.apply === true }),
    // 業者の統合 (Moto 2026-10-15・UI案51): the vendor master's merge screen.
    vendor_usage: a => db.rpc('invoice_vendor_usage', { actor: a }),
    vendor_merge: vendorMerge,
    vendor_unmerge: vendorUnmerge,
    // 新しい業者を決める (Moto 2026-10-16・UI案52 ③): an invoice's printed name as a new vendor, or as the vendor that has it now.
    vendor_register: vendorRegister,
    vendor_apply: vendorApply,
    vendor_merge_into: vendorMergeInto,
    map_seed: (a, b) => db.rpc('invoice_map_seed', { actor: a, store_id: b.store_id || null, apply: b.apply === true, only_ext: b.only_ext !== false }),
    // 紐づけ 段階 1 (Moto 2026-10-18・UI案55): 食材マスター › 紐づけ.
    link_whoami: a => db.rpc('invoice_link_whoami', { actor: a }),
    link_data: linkData,
    link_save: linkSave,
    link_undo: linkUndo,
    link_mark: linkMark,
    link_sync: linkSyncAll,
    // QuickBooks からすぐ (Moto 2026-10-18・UI案56): the 取込状況 card, the Gmail connection, and looking an unknown send up.
    qb_status: a => db.rpc('invoice_qb_status', { actor: a }).then(r => ({ ...r, rows: (r.rows || []).map(o => ({ ...o, original_url: viewUrl(o.drive_file_id) })) })),
    gmail_connect: gmailConnect,
    gmail_check: gmailCheck,
    gmail_disconnect: gmailDisconnect,
    qb_lookup: thenSummary(qbLookup, b => ({ outbox_id: String(b.id || '') })),
  };
  const ERR = { forbidden: 403, actor_required: 401, conflict: 409, not_found: 404, line_not_found: 404, closed_month: 409, duplicate: 409, invalid_state: 409,
    reason_required: 400, note_required: 400, field_not_editable: 400, bad_value: 400, bad_key: 400, bad_result: 400, bad_relation: 400, bad_action: 400,
    bad_state: 400, bad_target: 400, duplicate_of_required: 400, relation_required: 409, auto_off: 409, not_eligible: 409, bad_supersede: 409,
    not_a_purchase: 409, header_incomplete: 409, posted_use_correction: 409, has_parts: 409, bad_merge: 409, route_not_assigned: 409, qb_in_progress: 409,
    merged: 409, later_merge: 409, unknown_ingredient: 409, map_not_usable: 409, gmail_not_ready: 409, from_not_set: 409, not_configured: 409 };

  // ------------------------------------------------------------------ Gmail (UI案56)
  // 「Gmail をつなぐ」 (CEO・GM): a Google page for the account of qb.from; the state and the PKCE verifier stay here.
  async function gmailConnect(a) {
    const g = await googleClient();
    if (!g.clientId || !g.clientSecret) throw new Error('not_configured');
    const state = randomState(), pk = await pkcePair();
    const st = await db.rpc('invoice_gmail_start', { actor: a, state_hash: await sha256Text(state), verifier: pk.verifier });
    return { url: authUrl({ clientId: g.clientId, redirectUri: redirectUri(), state, challenge: pk.challenge, loginHint: st.from }), redirect_uri: redirectUri() };
  }
  // Google's answer: the code is exchanged once; the connection is kept only for the account of qb.from with both scopes. The person
  // is sent back to the app with a short result (never a token). A connection that is not kept is only forgotten (never revoked:
  // that would take back the grant the Drive connection may share).
  async function gmailCallback(u) {
    const back = code => new Response(null, { status: 302, headers: { location: appUrl() + (appUrl().includes('?') ? '&' : '?') + 'invoice_gmail=' + encodeURIComponent(code), 'cache-control': 'no-store' } });
    let taken;
    try { taken = await db.rpc('invoice_gmail_take', { state_hash: await sha256Text(u.searchParams.get('state') || '') }); } catch { return back('bad_state'); }
    const code = u.searchParams.get('code');
    if (u.searchParams.get('error') || !code) return back('denied');
    const g = await googleClient();
    if (!g.clientId || !g.clientSecret) return back('not_configured');
    const ex = await exchangeCode({ fetch, ...g, code, verifier: taken.verifier, redirectUri: redirectUri() });
    if (!ex.ok) return back(ex.error === 'no_refresh_token' ? 'no_refresh_token' : 'exchange_failed');
    if (!scopesOk(ex.scopes)) return back('scope_missing');
    const account = await profileOf({ fetch, token: ex.accessToken });
    if (!account) return back('profile_failed');
    const search = await canSearchWith({ fetch, token: ex.accessToken });
    try {
      await db.rpc('invoice_gmail_save', { actor: taken.actor, account, refresh_token: ex.refreshToken, scopes: ex.scopes,
        check_result: { account, send_scope: true, read_scope: true, search_ok: search } });
    } catch (e) {
      const c = String(e.message || '').split(/[\s:]/)[0];
      return back(['wrong_account', 'scope_missing', 'forbidden', 'from_not_set'].includes(c) ? c : 'save_failed');
    }
    return back(search ? 'ok' : 'ok_search_failed');
  }
  // 「確かめる」 (CEO・GM): a new access token, the scopes it carries, the account, a search of the sent mail. No secret is shown.
  async function gmailCheck(a) {
    const who = await db.rpc('invoice_whoami', { actor: a });
    if (!['ceo', 'gm'].includes(who.role)) throw new Error('forbidden');
    const c = await gmailCreds();
    if (!c) throw new Error('gmail_not_ready');
    const r = await refreshAccess({ fetch, ...c });
    if (!r.ok) {
      if (r.auth) await db.rpc('invoice_gmail_mark', { actor: a, status: 'expired', error: r.error, check_result: { ok: false, error: r.error } });
      else await db.rpc('invoice_gmail_mark', { actor: a, check_result: { ok: false, error: r.error } });
      return db.rpc('invoice_gmail_public', {});
    }
    const scopes = await tokenScopes({ fetch, token: r.token });
    const account = await profileOf({ fetch, token: r.token });
    const search = await canSearchWith({ fetch, token: r.token });
    const result = { ok: scopesOk(scopes) && !!account && search, account, send_scope: !!scopes && scopes.includes('https://www.googleapis.com/auth/gmail.send'),
      read_scope: !!scopes && scopes.includes('https://www.googleapis.com/auth/gmail.readonly'), search_ok: search };
    await db.rpc('invoice_gmail_mark', { actor: a, status: result.ok ? 'ok' : (scopes && !scopesOk(scopes) ? 'denied' : undefined), check_result: result,
      ...(result.ok ? { error: null } : {}) });
    return db.rpc('invoice_gmail_public', {});
  }
  // 「切る」 (CEO・GM): the token is forgotten here. Sending stops; the rows wait. (Taking the access away in the Google account is
  // left to the person: Google would take back the whole grant.)
  async function gmailDisconnect(a) { return db.rpc('invoice_gmail_disconnect', { actor: a }); }
  // 「Gmail の送信済みを調べる」 for an unknown send (accounting, 事務Crew, GM, CEO; decision 4A): found by its marks → sent with the
  // message's ID; not found → nothing changes (the person decides with 「確かめて、もう一度送る」).
  async function qbLookup(a, b) {
    const row = await db.rpc('invoice_qb_row', { actor: a, id: b.id });
    if (!row) throw new Error('not_found');
    if (row.state !== 'unknown') throw new Error('invalid_state');
    const tr = newTransport(), rd = await tr.ready();
    if (!rd.ok) { if (rd.auth) await gmailProblem(rd); throw new Error('gmail_not_ready'); }
    let h;
    try { h = await tr.history({ sha256: row.sha256, driveFileId: row.drive_file_id, attemptKey: row.attempt_key, to: row.to_address, size: row.size }); }
    catch (e) { return { found: false, error: 'gmail_history_failed' }; }
    if (h.state === 'sent') {
      await db.rpc('invoice_qb_result', { actor: a, id: row.id, state: 'sent', message_id: h.messageId,
        result: { via: 'gmail_lookup', own: !!h.own, checked_by: a, note: 'Gmail の送信済みで見つけた（送り直していない）' } });
      return { found: true, message_id: h.messageId };
    }
    if (h.state === 'conflict') return { found: false, conflict: h.reason };
    return { found: false };
  }

  // The forwarder that runs outside this system (qb.route = 'external'). It presents its own key and can only
  // list what is due, reserve one row, and record what happened to that row.
  const EXTERNAL = {
    qb_external_list: async b => ({ rows: (await db.rpc('invoice_qb_external_list', { limit: Math.max(1, Math.min(100, Number(b.limit) || 20)) }))
      .map(r => ({ ...r, original_url: viewUrl(r.drive_file_id) })) }),
    qb_external_reserve: b => db.rpc('invoice_qb_external_reserve', { id: b.id }),
    // Read only (UI案56 切り替えの 6): once this system sends, the forwarder before watches what waits, what is unknown and what stopped.
    qb_external_monitor: async () => {
      const r = await db.rpc('invoice_qb_status', { monitor: true });
      return { counts: r.counts, stopped: r.stopped, waiting_30: r.waiting_30, external_waiting: r.external_waiting, oldest_waiting: r.oldest_waiting,
        gmail: r.gmail ? r.gmail.status : null, route: r.qb ? r.qb.route || null : null,
        problems: (r.rows || []).filter(o => ['unknown', 'error'].includes(o.state) || o.last_error === 'content_changed')
          .map(o => ({ id: o.id, route: o.route, state: o.state, attempts: o.attempts, last_error: o.last_error, current_name: o.current_name, updated_at: o.updated_at })) };
    },
    qb_external_result: async b => {
      if (!['sent', 'error', 'unknown'].includes(b.state)) throw new Error('bad_state');
      const r = await db.rpc('invoice_qb_result', { actor: 'external', id: b.id, state: b.state, message_id: b.message_id ? String(b.message_id).slice(0, 300) : null,
        error: b.error ? String(b.error).slice(0, 300) : null, result: { reported_by: 'external', note: b.note ? String(b.note).slice(0, 300) : null } });
      // A send recorded as done moves a reconciled invoice into the confirmed purchases at once (the result stands either way).
      if (b.state === 'sent') await publishSummary(null, { outbox_id: String(b.id || '') });
      return r;
    },
  };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Google comes back here after 「Gmail をつなぐ」 (a page opened by the person, no key): the state decides everything.
    if (req.method === 'GET') {
      let u = null; try { u = new URL(req.url); } catch { u = null; }
      if (u && u.searchParams.has('state')) return gmailCallback(u);
      return json({ error: 'method' }, 405);
    }
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
