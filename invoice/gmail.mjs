// Gmail for forwarding originals to QuickBooks (Moto 2026-10-18・UI案56): the account that was connected in the app sends
// each original as one mail (no body, one attachment) and its sent mail is searched before every send. Only two scopes are
// asked for: sending, and reading (to search the sent mail). Tokens never leave this module except to Google; errors carry
// short codes only (no token, no header, no file content).

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const API = 'https://gmail.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// A message up to this size goes as base64url "raw" in a JSON body; a larger one through the upload endpoint (message/rfc822).
export const RAW_JSON_MAX = 3 * 1048576;

const enc = new TextEncoder();
export function b64url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Text(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

// PKCE (RFC 7636): the verifier stays on the server, Google sees only its hash.
export async function pkcePair() {
  const v = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const c = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(v))));
  return { verifier: v, challenge: c };
}
export function randomState() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

export function authUrl({ clientId, redirectUri, state, challenge, loginHint }) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256' });
  if (loginHint) p.set('login_hint', loginHint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

// One request within the time, the body included (a body that does not come is a timeout too, never a hang).
async function timed(fetch, url, init, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const body = await r.arrayBuffer();
    return new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status, headers: r.headers });
  } finally { clearTimeout(t); }
}
// Gmail's reason for a refusal (error.errors[0].reason, or the newer error.status).
const reasonOf = j => (j && j.error && Array.isArray(j.error.errors) && j.error.errors[0] ? String(j.error.errors[0].reason || '')
  : j && j.error && j.error.status ? String(j.error.status) : '');
// A 403 that is a rate or quota limit is a busy Gmail, not a permission taken back (Google's own names for it).
const limited = reason => /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED)$/.test(reason);

// The code Google returned to the redirect: exchanged once, with the verifier.
export async function exchangeCode({ fetch, clientId, clientSecret, code, verifier, redirectUri }) {
  try {
    const r = await timed(fetch, TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString() }, 20000);
    let j = null; try { j = await r.json(); } catch { j = null; }
    if (!r.ok || !j) return { ok: false, error: 'exchange_failed' };
    if (!j.refresh_token) return { ok: false, error: 'no_refresh_token', accessToken: j.access_token || null };
    return { ok: true, refreshToken: j.refresh_token, accessToken: j.access_token, scopes: String(j.scope || '').split(/\s+/).filter(Boolean) };
  } catch { return { ok: false, error: 'exchange_failed' }; }
}

// A new access token from the saved refresh token. invalid_grant: the permission was taken back or ran out (a person must connect again).
export async function refreshAccess({ fetch, clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) return { ok: false, error: 'gmail_not_connected' };
  try {
    const r = await timed(fetch, TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString() }, 20000);
    let j = null; try { j = await r.json(); } catch { j = null; }
    if (r.ok && j && j.access_token) return { ok: true, token: j.access_token, scopes: j.scope ? String(j.scope).split(/\s+/).filter(Boolean) : null };
    if (r.status === 400 && j && /invalid_grant|unauthorized_client/.test(String(j.error))) return { ok: false, auth: true, error: 'gmail_auth_revoked' };
    if (r.status === 401) return { ok: false, auth: true, error: 'gmail_client_rejected' };
    return { ok: false, error: 'gmail_token_' + r.status };
  } catch { return { ok: false, error: 'gmail_token_network' }; }
}

// Nothing here ever revokes a token at Google: Google takes back the whole grant of an account to a client, and the Drive
// connection may use the same client and account. A connection that is not kept is only forgotten.

// The account a token belongs to (gmail.readonly reads the profile), and whether the sent mail can be searched.
export async function profileOf({ fetch, token }) {
  try {
    const r = await timed(fetch, API + '/gmail/v1/users/me/profile', { headers: { authorization: 'Bearer ' + token } }, 15000);
    if (!r.ok) return null;
    const j = await r.json(); return j && j.emailAddress ? String(j.emailAddress) : null;
  } catch { return null; }
}
export async function canSearchWith({ fetch, token }) {
  try {
    const r = await timed(fetch, API + '/gmail/v1/users/me/messages?' + new URLSearchParams({ q: 'in:sent', maxResults: '1' }).toString(), { headers: { authorization: 'Bearer ' + token } }, 15000);
    return r.ok;
  } catch { return false; }
}

export async function tokenScopes({ fetch, token }) {
  try {
    const r = await timed(fetch, 'https://oauth2.googleapis.com/tokeninfo', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: token }).toString() }, 15000);
    if (!r.ok) return null;
    const j = await r.json(); return String(j.scope || '').split(/\s+/).filter(Boolean);
  } catch { return null; }
}
export const scopesOk = s => Array.isArray(s) && GMAIL_SCOPES.every(x => s.includes(x));

// ------------------------------------------------------------------ the mail
// Subject: the original's name and three marks, as the forwarder before used them (ChatGPT 2026-10-18):
// <current_name> FPQB-ID-<Drive file ID> FPQB-SHA256-<SHA-256> FPQB-ATTEMPT-<attempt_key>
export function qbSubject({ currentName, driveFileId, sha256, attemptKey }) {
  return `${currentName} FPQB-ID-${driveFileId} FPQB-SHA256-${sha256} FPQB-ATTEMPT-${attemptKey}`;
}
const ascii = s => /^[\x20-\x7e]*$/.test(s);
const noBreak = s => String(s).replace(/[\r\n]+/g, ' ');
// A header value: printable ASCII is folded at its own spaces (unfolding gives the same text back); anything else is
// RFC 2047 B-encoded in words of whole characters.
export function headerValue(name, value) {
  const v = noBreak(value);
  if (ascii(v)) {
    const words = v.split(' '); const lines = []; let line = name + ': ';
    for (let i = 0; i < words.length; i++) {
      const w = words[i], add = (i === 0 ? '' : ' ') + w;
      if (i > 0 && line.length + add.length > 76) { lines.push(line); line = ' ' + w; } else line += add;
    }
    lines.push(line);
    return lines.join('\r\n');
  }
  const chunks = []; let cur = [];
  for (const ch of v) { const b = [...enc.encode(ch)]; if (cur.length + b.length > 45) { chunks.push(cur); cur = []; } cur.push(...b); }
  if (cur.length) chunks.push(cur);
  return name + ': ' + chunks.map(c => '=?UTF-8?B?' + b64(new Uint8Array(c)) + '?=').join('\r\n ');
}
function fileParams(name) {
  const n = noBreak(name);
  if (ascii(n) && !/["\\]/.test(n)) return { ct: `name="${n}"`, cd: `filename="${n}"` };
  const pct = encodeURIComponent(n).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const ew = '=?UTF-8?B?' + b64(enc.encode(n)) + '?=';
  return { ct: `name="${ew}"`, cd: `filename*=UTF-8''${pct}` };
}
// One original as the only part of a multipart/mixed message: no text part (an empty body makes no extra document in QuickBooks),
// no signature, no CC or BCC. The original's bytes are carried unchanged (base64 in lines of 76).
export function buildQbMime({ from, to, subject, filename, mime, bytes, boundary }) {
  const bd = boundary || ('fpqb-' + b64url(crypto.getRandomValues(new Uint8Array(18))));
  const p = fileParams(filename), body = b64(bytes).replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '');
  const head = [headerValue('From', from), headerValue('To', to), headerValue('Subject', subject), 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${bd}"`, '',
    '--' + bd, `Content-Type: ${mime}; ${p.ct}`, `Content-Disposition: attachment; ${p.cd}`, 'Content-Transfer-Encoding: base64', '', ''].join('\r\n');
  return enc.encode(head + body + '\r\n--' + bd + '--\r\n');
}
// A notice to the connected account itself (in Japanese): one text part, UTF-8. Never carries the QuickBooks marks.
export function buildNoticeMime({ from, to, subject, text }) {
  const body = b64(enc.encode(String(text).replace(/\r?\n/g, '\r\n'))).replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '');
  return enc.encode([headerValue('From', from), headerValue('To', to), headerValue('Subject', subject), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body, ''].join('\r\n'));
}

// ------------------------------------------------------------------ what was sent before
const hdr = (m, n) => { const h = ((m.payload || {}).headers || []).find(x => String(x.name).toLowerCase() === n); return h ? String(h.value) : ''; };
function attachmentsOf(part, out = []) {
  if (!part) return out;
  if (part.filename) out.push({ filename: part.filename, mimeType: part.mimeType, size: part.body && part.body.size != null ? Number(part.body.size) : null });
  for (const p of part.parts || []) attachmentsOf(p, out);
  return out;
}
// Decides from the messages a search found. A message counts only when Gmail has it as sent and it went to the QuickBooks
// address. Its subject carrying this content's SHA-256 mark is a send of this content (by this ledger or the forwarder before):
// "sent" when it carries one attachment (of the original's size when both are known), else "conflict" for a person. A subject
// with this Drive file's mark but another or no SHA-256 is another content of the same original: "conflict" (a person decides;
// nothing is sent). Nothing found: "none".
export function judgeHistory(messages, { sha256, driveFileId, attemptKey, to, size }) {
  const toLc = String(to || '').toLowerCase();
  let conflict = null;
  const sent = [];
  for (const m of messages) {
    if (!(m.labelIds || []).includes('SENT')) continue;
    if (!hdr(m, 'to').toLowerCase().includes(toLc)) continue;
    const subj = hdr(m, 'subject');
    const shaMark = subj.includes('FPQB-SHA256-' + sha256), idMark = subj.includes('FPQB-ID-' + driveFileId);
    if (!shaMark && !idMark) continue;
    if (!shaMark) { conflict = conflict || { reason: 'same_drive_id_other_content', messageId: m.id }; continue; }
    const att = attachmentsOf(m.payload);
    const okAtt = att.length === 1 && (size == null || att[0].size == null || Number(att[0].size) === Number(size));
    if (!okAtt) { conflict = conflict || { reason: 'found_unverified', messageId: m.id }; continue; }
    sent.push({ id: m.id, own: !!attemptKey && subj.includes('FPQB-ATTEMPT-' + attemptKey), internalDate: Number(m.internalDate) || 0 });
  }
  if (sent.length) {
    sent.sort((a, b) => a.internalDate - b.internalDate);
    const own = sent.find(s => s.own);
    return { state: 'sent', messageId: (own || sent[0]).id, own: !!own };
  }
  if (conflict) return { state: 'conflict', ...conflict };
  return { state: 'none' };
}

// ------------------------------------------------------------------ the transport
// getCreds(): { clientId, clientSecret, refreshToken, account } from the server's own store. timeoutMs: per request.
export function createGmail({ fetch, getCreds, timeoutMs = 30000, sendTimeoutMs = 90000, maxPages = 20, maxMessages = 60 }) {
  let token = null, account = null;
  async function ready() {
    const c = await getCreds();
    if (!c || !c.refreshToken) return { ok: false, error: 'gmail_not_connected' };
    const r = await refreshAccess({ fetch, ...c });
    if (!r.ok) { token = null; return r; }
    token = r.token; account = c.account;
    return { ok: true, account };
  }
  async function call(path, init = {}, ms = timeoutMs) {
    if (!token) { const e = new Error('gmail_not_ready'); e.code = 'gmail_not_ready'; throw e; }
    const r = await timed(fetch, API + path, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + token } }, ms);
    return r;
  }
  async function getJson(path) {
    let r;
    try { r = await call(path); } catch { const e = new Error('gmail_history_network'); e.code = e.message; throw e; }
    if (r.status === 401 || r.status === 403) {
      let j = null; try { j = await r.json(); } catch { j = null; }
      const reason = reasonOf(j);
      const e = new Error('gmail_history_' + r.status + (limited(reason) ? '_limit' : '')); e.code = e.message;
      if (r.status === 401 || !limited(reason)) e.auth = true;
      throw e;
    }
    if (!r.ok) { const e = new Error('gmail_history_' + r.status); e.code = e.message; throw e; }
    return r.json();
  }
  // Every page of a search; one failed page fails the whole search (a failure is never read as "not sent").
  async function search(q) {
    const ids = []; let page = null, n = 0;
    do {
      // A sent mail moved to the trash was sent all the same.
      const p = new URLSearchParams({ q, maxResults: '100', includeSpamTrash: 'true' }); if (page) p.set('pageToken', page);
      const j = await getJson('/gmail/v1/users/me/messages?' + p.toString());
      for (const m of j.messages || []) ids.push(m.id);
      page = j.nextPageToken || null;
      if (++n >= maxPages && page) { const e = new Error('gmail_history_too_many'); e.code = e.message; throw e; }
    } while (page);
    return ids;
  }
  const FIELDS = 'id,labelIds,internalDate,payload(headers,filename,mimeType,body/size,parts(filename,mimeType,body/size,parts(filename,mimeType,body/size)))';
  async function message(id) {
    const p = new URLSearchParams({ format: 'full', fields: FIELDS });
    return getJson('/gmail/v1/users/me/messages/' + encodeURIComponent(id) + '?' + p.toString());
  }
  // The sent mail is searched for this content's mark and for the Drive file's mark, whole (FPQB-SHA256-…, FPQB-ID-…: the search
  // the forwarder before uses; a whole mark is found whether Gmail splits it at the hyphens or not). Both forms of the subject.
  async function history(o) {
    const ids = new Set();
    for (const q of [`in:sent "FPQB-SHA256-${o.sha256}"`, `in:sent "FPQB-ID-${o.driveFileId}"`]) for (const id of await search(q)) ids.add(id);
    if (ids.size > maxMessages) { const e = new Error('gmail_history_too_many'); e.code = e.message; throw e; }
    const msgs = []; for (const id of ids) msgs.push(await message(id));
    return judgeHistory(msgs, o);
  }
  // Sends one message. ok: Gmail answered with the message's ID. A 4xx (other than a server's) means it was not taken; a 5xx, a
  // timeout or a lost connection may have sent it: "unknown" (never sent again automatically).
  async function sendRaw(bytes) {
    let r;
    try {
      r = bytes.length <= RAW_JSON_MAX
        ? await call('/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: b64url(bytes) }) }, sendTimeoutMs)
        : await call('/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: bytes }, sendTimeoutMs);
    } catch { return { ok: false, unknown: true, error: 'gmail_send_no_answer' }; }
    let j = null; try { j = await r.json(); } catch { j = null; }
    if (r.ok && j && typeof j.id === 'string' && j.id) return { ok: true, messageId: j.id, labelIds: j.labelIds || [] };
    if (r.ok) return { ok: false, unknown: true, error: 'gmail_send_no_id' };
    if (r.status >= 500) return { ok: false, unknown: true, error: 'gmail_send_' + r.status };
    const reason = reasonOf(j);
    const auth = r.status === 401 || (r.status === 403 && !limited(reason) && /insufficient|forbidden|authError/i.test(reason));
    return { ok: false, auth, error: 'gmail_send_' + r.status + (reason ? '_' + reason.replace(/[^A-Za-z]/g, '').slice(0, 40) : '') };
  }
  return {
    ready, history,
    async send({ from, to, subject, attachment }) {
      return sendRaw(buildQbMime({ from, to, subject, filename: attachment.name, mime: attachment.mime, bytes: attachment.bytes }));
    },
    async notify({ to, subject, text }) { return sendRaw(buildNoticeMime({ from: account || to, to, subject, text })); },
    profile: () => (token ? profileOf({ fetch, token }) : null),
    canSearch: () => (token ? canSearchWith({ fetch, token }) : false),
    scopes: () => (token ? tokenScopes({ fetch, token }) : null),
  };
}
