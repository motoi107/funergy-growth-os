// QuickBooks からすぐ (Moto 2026-10-18・UI案56): the real handler and SQL (PGlite) with a stand-in Google (OAuth, Gmail) and LINE.
// Synthetic data only: nothing here reaches Google, Intuit, LINE or the production database. The spec's tests (1)–(12) are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import http from 'node:http';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';
import { parseResponse } from '../invoice/extract.mjs';
import { buildQbMime, judgeHistory, qbSubject, headerValue, createGmail } from '../invoice/gmail.mjs';
import { noticeText } from '../invoice/notices.mjs';

// The integration fixture (tests/invoice-intake.test.mjs) without running its tests.
const fixtureUrl = new URL('./invoice-intake.test.mjs', import.meta.url);
const src = fs.readFileSync(fixtureUrl, 'utf8');
const cut = src.indexOf("test('Drive invoice intake works end to end on synthetic data'");
assert.ok(cut > 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-qb-gmail-'));
let F;
try {
  const file = path.join(tmp, 'fixture.mjs');
  fs.writeFileSync(file, src.slice(0, cut).replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, q, rel) => JSON.stringify(new URL(rel, fixtureUrl).href))
    + '\nexport { setup, doc, pdf, docsOf, codes, U, WORKER_KEY };\n');
  F = await import(pathToFileURL(file).href);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const { setup, doc, pdf, docsOf, U, WORKER_KEY } = F;

const SEND = 'https://www.googleapis.com/auth/gmail.send', READ = 'https://www.googleapis.com/auth/gmail.readonly';
const TO = 'funergy+expenses@assist.intuit.com';
const SECRET_REFRESH = 'synthetic-refresh';

// ---------------------------------------------------------------- a stand-in Google and LINE
function parseMime(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const split = t => { const i = t.indexOf('\r\n\r\n'); return [t.slice(0, i), t.slice(i + 4)]; };
  const headersOf = h => {
    const out = {};
    for (const line of h.replace(/\r\n[ \t]/g, ' ').split('\r\n')) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
    return out;
  };
  const decodeWords = v => v.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8')).trim();
  const [h0, body] = split(s);
  const H = headersOf(h0);
  const m = /boundary="([^"]+)"/.exec(H['content-type'] || '');
  const parts = [];
  let preamble = null, text = null;
  if (m) {
    const chunks = body.split('--' + m[1]);
    preamble = chunks[0];
    for (const c of chunks.slice(1)) {
      if (c.startsWith('--')) break;
      const [ph, pb] = split(c.replace(/^\r\n/, ''));
      const P = headersOf(ph);
      const data = Buffer.from(pb.replace(/\r\n/g, ''), 'base64');
      const fn = /filename="([^"]*)"/.exec(P['content-disposition'] || '') || /filename\*=UTF-8''([^;]+)/.exec(P['content-disposition'] || '');
      parts.push({ type: (P['content-type'] || '').split(';')[0], disposition: (P['content-disposition'] || '').split(';')[0], filename: fn ? decodeURIComponent(fn[1]) : '', data, raw: P });
    }
  } else text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { from: H.from, to: H.to, cc: H.cc, bcc: H.bcc, subject: decodeWords(H.subject || ''), contentType: H['content-type'], preamble, parts, text };
}

function google({ accounts = { [SECRET_REFRESH]: 'sender@example.test' } } = {}) {
  const G = { sent: [], line: [], calls: [], codes: new Map(), tokens: new Map(), searchFail: 0, searchErr: null, queries: [], sendMode: 'ok', tokenMode: 'ok', gate: null, n: 0, scopes: [SEND, READ],
    tokenInfoScopes: null, logged: [] };
  G.addSent = (subject, { to = TO, attachments = [{ filename: 'old.pdf', size: 10 }], labels = ['SENT'] } = {}) => {
    const id = 'old' + (++G.n);
    G.sent.push({ id, labelIds: labels, internalDate: String(Date.now() - 86400000 + G.n), mime: { from: 'sender@example.test', to, subject, parts: attachments.map(a => ({ ...a, data: Buffer.alloc(a.size), type: 'application/pdf', disposition: 'attachment' })) } });
    return id;
  };
  const json = (v, s = 200, h = {}) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', ...h } });
  const tokenAccount = req => { const t = String(req.headers.authorization || '').replace('Bearer ', ''); return G.tokens.get(t) || null; };
  G.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    G.calls.push(u.origin + u.pathname);
    if (u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/token') {
      const p = new URLSearchParams(String(init.body));
      if (p.get('grant_type') === 'refresh_token') {
        if (G.tokenMode === 'invalid_grant') return json({ error: 'invalid_grant' }, 400);
        if (G.tokenMode === 'down') return json({ error: 'backend' }, 503);
        const acct = accounts[p.get('refresh_token')];
        if (!acct) return json({ error: 'invalid_grant' }, 400);
        const t = 'at-' + (++G.n); G.tokens.set(t, acct); return json({ access_token: t, expires_in: 3599, scope: G.scopes.join(' ') });
      }
      if (p.get('grant_type') === 'authorization_code') {
        const c = G.codes.get(p.get('code'));
        if (!c || c.verifier !== undefined && c.verifierHash !== crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url')) return json({ error: 'invalid_grant' }, 400);
        G.codes.delete(p.get('code'));
        const t = 'at-' + (++G.n); G.tokens.set(t, c.account); accounts[c.refresh] = c.account;
        return json({ access_token: t, refresh_token: c.refresh, scope: c.scopes.join(' ') });
      }
    }
    if (u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/tokeninfo') return json({ scope: (G.tokenInfoScopes || G.scopes).join(' ') });
    if (u.origin === 'https://gmail.googleapis.com') {
      const acct = tokenAccount({ headers: h });
      if (!acct) return json({ error: { code: 401 } }, 401);
      if (u.pathname === '/gmail/v1/users/me/profile') return json({ emailAddress: acct });
      if (u.pathname === '/gmail/v1/users/me/messages' && (init.method || 'GET') === 'GET') {
        if (G.searchFail > 0) { G.searchFail--; return json({ error: { code: 500 } }, 500); }
        if (G.searchErr && G.searchErr.n > 0) { G.searchErr.n--; return json({ error: { code: G.searchErr.status, errors: [{ reason: G.searchErr.reason }] } }, G.searchErr.status); }
        const q = u.searchParams.get('q') || '';
        G.queries.push(q);
        const phrase = (/"([^"]+)"/.exec(q) || [])[1];
        // Like Gmail at its strictest: a quoted word matches a whole word of the subject (a mark is not split at its hyphens).
        const hit = subj => !phrase || (/\s/.test(phrase) ? subj.includes(phrase) : subj.split(/\s+/).includes(phrase));
        const all = G.sent.filter(m => (!q.startsWith('in:sent') || m.labelIds.includes('SENT')) && hit(m.mime.subject));
        const start = Number(u.searchParams.get('pageToken') || 0), size = Math.min(Number(u.searchParams.get('maxResults') || 100), 2);   // two a page: paging is exercised
        const page = all.slice(start, start + size);
        return json({ messages: page.map(m => ({ id: m.id })), nextPageToken: start + size < all.length ? String(start + size) : undefined, resultSizeEstimate: all.length });
      }
      const gm = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(u.pathname);
      if (gm && (init.method || 'GET') === 'GET') {
        const m = G.sent.find(x => x.id === gm[1]); if (!m) return json({ error: { code: 404 } }, 404);
        return json({ id: m.id, labelIds: m.labelIds, internalDate: m.internalDate, payload: { mimeType: 'multipart/mixed',
          headers: [{ name: 'From', value: m.mime.from }, { name: 'To', value: m.mime.to }, { name: 'Subject', value: m.mime.subject }],
          parts: m.mime.parts.map(p => ({ filename: p.filename, mimeType: p.type, body: { size: p.data.length } })) } });
      }
      if (u.pathname === '/gmail/v1/users/me/messages/send' || u.pathname === '/upload/gmail/v1/users/me/messages/send') {
        const upload = u.pathname.startsWith('/upload');
        const raw = upload ? Buffer.from(init.body) : Buffer.from(JSON.parse(init.body).raw, 'base64url');
        if (G.gate) await G.gate;
        if (G.sendMode === 'timeout') throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        if (G.sendMode === '500') return json({ error: { code: 500 } }, 500);
        if (G.sendMode === '429') return json({ error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } }, 429);
        if (G.sendMode === '403') return json({ error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }, 403);
        const mime = parseMime(raw);
        const id = 'msg' + (++G.n).toString(16).padStart(6, '0');
        G.sent.push({ id, labelIds: ['SENT'], internalDate: String(Date.now()), mime, raw, upload, account: acct });
        if (G.sendMode === '500_after') return json({ error: { code: 500 } }, 500);
        return json({ id, threadId: id, labelIds: ['SENT'] });
      }
    }
    if (u.origin === 'https://api.line.me') { G.line.push({ headers: h, body: JSON.parse(init.body) }); return json({}, 200); }
    throw new Error('unexpected network call ' + u.origin + u.pathname);
  };
  return G;
}

async function env0(opts = {}) {
  const E = await setup();
  const G = google(opts);
  const users = { 'tok-gm': U.gm, 'tok-office': U.office, 'tok-crew': U.crew, 'tok-ceo': U.ceo, 'tok-other': U.other };
  const fetch = async (url, init = {}) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    return G.fetch(url, init);
  };
  const ai = async parts => {
    const key = Buffer.from(parts[0].base64, 'base64').toString('latin1');
    const fx = [...E.fixtures.entries()].filter(([tag]) => key.includes(tag)).sort((x, y) => y[0].length - x[0].length)[0];
    if (!fx) return { ok: true, readable: false, reason: 'unreadable', documents: [] };
    return { ...parseResponse(JSON.stringify(fx[1])), model: 'synthetic' };
  };
  const bg = [], logs = [];
  const envs = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key',
    GMAIL_OAUTH_CLIENT_ID: 'client-1', GMAIL_OAUTH_CLIENT_SECRET: 'client-secret-1', LINE_CHANNEL_ACCESS_TOKEN: 'line-token-1' };
  // hooks: a step that runs once just before a database call (to change something at that moment).
  const hooks = {}, baseDb = opts.db ? opts.db(E.db) : E.db;
  const db = { async rpc(name, p) { if (hooks[name]) { const f = hooks[name]; delete hooks[name]; await f(p); } return baseDb.rpc(name, p); } };
  const h = createHandler({ env: k => envs[k], fetch, db, drive: E.drive, ai, background: p => { bg.push(p); }, sleep: async () => {}, ...(opts.deps || {}) });
  const call = async (body, headers = {}) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const settle = async () => { while (bg.length) await bg.shift(); };
  const X = { ...E, G, h, bg, settle, logs, envs, hook: (name, fn) => { hooks[name] = fn; },
    worker: () => call({ action: 'worker' }, { 'x-invoice-worker-key': WORKER_KEY }),
    api: (tok, body) => call(body, tok ? { authorization: 'Bearer ' + tok } : {}),
    get: async url => { const r = await h(new Request(url, { method: 'GET' })); return { status: r.status, location: r.headers.get('location') }; },
  };
  // The mails to QuickBooks this system sent (notices to the account itself and the stand-ins of earlier sends are not counted).
  X.qbSent = () => G.sent.filter(m => m.mime.to === TO && !m.id.startsWith('old'));
  X.sentFor = id => X.qbSent().filter(m => m.mime.subject.includes('FPQB-ID-' + id + ' ')).length;
  X.row = async drive_file_id => (await E.q(`select o.* from invoice_qb_outbox o join invoice_files f on f.id=o.file_id where f.drive_file_id=$1`, [drive_file_id]))[0];
  // An invoice that waits for a person (the store is not automatic here), then posted by accounting.
  X.review = async (tag, no, date = '2026-10-06') => {
    await E.q('update invoice_stores set auto_post=false');
    E.fixtures.set(tag, { readable: true, documents: [doc(no, date, [['06263', 'SHIRO MISO 12/500G', '1', '61.20', '61.20', 'CS', '12/500G']])] });
    const id = E.drive.file(tag + '.pdf', pdf(tag), 'U6');
    await X.worker();
    const [d] = await docsOf(E, id);
    assert.equal(d.status, 'review');
    return { id, doc: d };
  };
  X.post = d => X.api('tok-office', { action: 'post', doc_id: d.id, version: d.version, reason: '経理の確認' });
  return X;
}
const hst = t => new Date(t).toISOString();

// ---------------------------------------------------------------- the mail and the judging of the sent mail
test('(10) the mail: from, to, the three marks, one attachment of the original bytes and type, no body, no CC/BCC', () => {
  const bytes = Buffer.from(pdf('MIME-1') + 'x'.repeat(500));
  const subject = qbSubject({ currentName: '2026-10-06_VendorA_1001.pdf', driveFileId: 'drive-file-0001', sha256: 'a'.repeat(64), attemptKey: 'qb-' + 'a'.repeat(64) + '-' + 'b'.repeat(32) });
  assert.equal(subject, '2026-10-06_VendorA_1001.pdf FPQB-ID-drive-file-0001 FPQB-SHA256-' + 'a'.repeat(64) + ' FPQB-ATTEMPT-qb-' + 'a'.repeat(64) + '-' + 'b'.repeat(32));
  const m = parseMime(buildQbMime({ from: 'sender@example.test', to: TO, subject, filename: '2026-10-06_VendorA_1001.pdf', mime: 'application/pdf', bytes }));
  assert.equal(m.from, 'sender@example.test'); assert.equal(m.to, TO); assert.equal(m.cc, undefined); assert.equal(m.bcc, undefined);
  assert.equal(m.subject, subject);                                   // folding keeps the subject exactly
  assert.match(m.contentType, /^multipart\/mixed; boundary="fpqb-/);
  assert.equal(m.parts.length, 1); assert.equal(m.parts[0].disposition, 'attachment'); assert.equal(m.parts[0].type, 'application/pdf');
  assert.equal(m.parts[0].filename, '2026-10-06_VendorA_1001.pdf'); assert.ok(m.parts[0].data.equals(bytes));
  assert.equal(m.preamble.trim(), '');                               // no text before the part, no text part
  // a JPEG keeps its type; a name outside ASCII is encoded and comes back the same
  const j = parseMime(buildQbMime({ from: 'a@example.test', to: TO, subject: 'x', filename: '請求書.jpg', mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) }));
  assert.equal(j.parts[0].type, 'image/jpeg'); assert.equal(j.parts[0].filename, '請求書.jpg');
  assert.equal(parseMime(buildQbMime({ from: 'a@example.test', to: TO, subject: '請求書 FPQB-ID-1', filename: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('x') })).subject, '請求書 FPQB-ID-1');
  assert.ok(!/\r?\n(?![ \t])[^:\r\n]+\r?\n/.test(headerValue('Subject', subject)), 'folded lines start with a space');
});

test('(6) judging the sent mail: this content (new or old subject form) is sent; the same Drive file with another content is for a person', () => {
  const sha = 'c'.repeat(64), id = '1abcDEF_-x', key = 'qb-' + sha + '-' + 'd'.repeat(32);
  const msg = (subject, extra = {}) => ({ id: extra.id || 'm1', labelIds: extra.labels || ['SENT'], internalDate: extra.at || '1',
    payload: { headers: [{ name: 'To', value: extra.to || TO }, { name: 'Subject', value: subject }], parts: extra.parts || [{ filename: 'a.pdf', mimeType: 'application/pdf', body: { size: 100 } }] } });
  const o = { sha256: sha, driveFileId: id, attemptKey: key, to: TO, size: 100 };
  assert.deepEqual(judgeHistory([msg(`FPQB-ID-${id} FPQB-SHA256-${sha} | JFC.2026-09-29.pdf`)], o), { state: 'sent', messageId: 'm1', own: false });   // the September form
  assert.deepEqual(judgeHistory([msg(`x.pdf FPQB-ID-${id} FPQB-SHA256-${sha} FPQB-ATTEMPT-${key}`)], o), { state: 'sent', messageId: 'm1', own: true });
  assert.deepEqual(judgeHistory([msg(`y.pdf FPQB-ID-other FPQB-SHA256-${sha}`)], o).state, 'sent');                                   // another Drive file, same content
  assert.deepEqual(judgeHistory([msg(`y.pdf FPQB-ID-${id} FPQB-SHA256-${'e'.repeat(64)}`)], o), { state: 'conflict', reason: 'same_drive_id_other_content', messageId: 'm1' });
  assert.equal(judgeHistory([msg(`x FPQB-SHA256-${sha}`, { labels: ['DRAFT'] })], o).state, 'none');                                  // not sent
  assert.equal(judgeHistory([msg(`x FPQB-SHA256-${sha}`, { to: 'someone@example.test' })], o).state, 'none');                         // not to QuickBooks
  assert.equal(judgeHistory([msg(`x FPQB-SHA256-${sha}`, { parts: [] })], o).state, 'conflict');                                       // no attachment: a person looks
  assert.equal(judgeHistory([msg(`x FPQB-SHA256-${sha}`, { parts: [{ filename: 'a.pdf', body: { size: 99 } }] })], o).state, 'conflict');   // another size
  assert.equal(judgeHistory([msg('unrelated subject')], o).state, 'none');
});

test('the notices: Japanese, names and counts only, never a QuickBooks mark', () => {
  for (const kind of ['first_sent', 'unknown', 'error_final', 'content_changed', 'backlog', 'auth', 'intake_error', 'rename_error']) {
    const t = noticeText({ kind, data: { name: '2026-10-06_VendorA_1001.pdf', store: 'F06', waiting: 2, unknown: 1, sent_at: '2026-10-19T19:12:10Z', message_id: 'msg1' } });
    assert.ok(t.title && t.text && t.line.startsWith('【'), kind);
    assert.ok(!/FPQB-/.test(t.text + t.title), kind);
  }
  assert.match(noticeText({ kind: 'first_sent', data: { posted_at: '2026-10-19T19:12:04Z', sent_at: '2026-10-19T19:12:10Z' } }).text, /反映 10\/19 09:12:04 → .* → 送信済み 09:12:10/);   // Hawaii time
});

// ---------------------------------------------------------------- end to end
test('(1)(4)(10) a posting by accounting: renamed, queued and sent at once, after the answer; timestamps in order', async () => {
  const X = await env0();
  try {
    const { id, doc: d } = await X.review('QB-A1', '7101');
    let gate; X.G.gate = new Promise(r => { gate = r; });                         // Gmail answers only when the test lets it
    const r = await X.post(d);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status || 'posted', 'posted');
    assert.deepEqual(r.body.qb, { queued: 1, sending: true });
    // The answer came back while the send is still going on (the screen can be closed): the server carries on.
    let o = await X.row(id);
    assert.ok(['pending', 'sending'].includes(o.state));
    assert.equal(X.qbSent().length, 0);
    gate(); await X.settle();
    o = await X.row(id);
    assert.equal(o.state, 'sent'); assert.match(o.message_id, /^msg/); assert.equal(o.result.via, 'gmail'); assert.equal(o.result.trigger, 'post');
    assert.equal(X.qbSent().length, 1);
    const m = X.qbSent()[0], f = (await X.q('select * from invoice_files where drive_file_id=$1', [id]))[0];
    assert.equal(m.id, o.message_id); assert.equal(m.mime.to, TO); assert.equal(m.mime.from, 'sender@example.test');
    assert.equal(f.current_name, '2026-10-06_VendorA_7101.pdf');
    assert.equal(m.mime.subject, `${f.current_name} FPQB-ID-${id} FPQB-SHA256-${o.sha256} FPQB-ATTEMPT-${o.attempt_key}`);
    assert.equal(m.mime.parts.length, 1); assert.equal(m.mime.parts[0].filename, f.current_name);
    assert.ok(m.mime.parts[0].data.equals(X.drive.items.get(id).bytes)); assert.equal(m.mime.parts[0].type, 'application/pdf');
    assert.equal(m.upload, false);                                             // a small original goes as base64url "raw"
    // 反映 → 名前 → 台帳 → 送信開始 → 送信済み, in that order, all recorded.
    const [t] = await X.q(`select d.posted_at, f.renamed_at, o.created_at, o.reserved_at, o.sent_at from invoice_qb_outbox o join invoice_files f on f.id=o.file_id
      join invoice_docs d on d.file_id=f.id where o.id=$1`, [o.id]);
    assert.ok(t.posted_at <= t.renamed_at && t.renamed_at <= t.created_at && t.created_at <= t.reserved_at && t.reserved_at <= t.sent_at, JSON.stringify(t));
    // The worker afterwards sends nothing more.
    await X.worker(); await X.settle();
    assert.equal(X.qbSent().length, 1);
    // The status card shows it as メール送信済み with its Gmail ID and times; nothing says "booked".
    const st = (await X.api('tok-office', { action: 'qb_status' })).body;
    const sr = st.rows.find(x => x.id === o.id);
    assert.equal(sr.state, 'sent'); assert.equal(sr.message_id, o.message_id); assert.ok(sr.posted_at && sr.renamed_at && sr.reserved_at && sr.sent_at);
    assert.ok(!/book|記帳|received|受信/i.test(JSON.stringify(st.counts)));
  } finally { await X.pg.close(); }
});

test('(2) an automatic posting starts the send the same way (no waiting for a later run)', async () => {
  const X = await env0();
  try {
    X.fixtures.set('QB-AUTO', { readable: true, documents: [doc('7201', '2026-10-06', [['06263', 'SHIRO MISO 12/500G', '1', '61.20', '61.20', 'CS', '12/500G']])] });
    const id = X.drive.file('auto.pdf', pdf('QB-AUTO'), 'U6');
    const w = await X.worker();
    assert.equal(w.body.ok, true);
    assert.ok(X.bg.length >= 1, 'the send was started from the automatic posting');
    await X.settle();
    const o = await X.row(id);
    assert.equal(o.state, 'sent'); assert.equal(X.qbSent().length, 1);
    assert.ok(['auto', 'worker'].includes(o.result.trigger));
    assert.equal((await docsOf(X, id))[0].posted_mode, 'auto');
  } finally { await X.pg.close(); }
});

test('(3) nothing is sent when the rename, the ledger or the posting fails; the worker sends once the rename succeeds', async () => {
  let failEnqueue = 0;
  const X = await env0({ db: real => ({ async rpc(name, p) { if (name === 'invoice_qb_enqueue' && failEnqueue > 0) { failEnqueue--; throw new Error('db_down'); } return real.rpc(name, p); } }) });
  try {
    // the rename fails: posted, not queued, nothing sent
    const a = await X.review('QB-RN', '7301');
    X.drive.failUpdate = 1;
    let r = await X.post(a.doc);
    assert.equal(r.status, 200); assert.equal(r.body.rename.ok, false); assert.deepEqual(r.body.qb, { queued: 0, sending: false });
    await X.settle();
    assert.equal(await X.row(a.id), undefined); assert.equal(X.qbSent().length, 0);
    // the ledger write fails: posted, nothing sent now
    const b = await X.review('QB-LG', '7302');
    failEnqueue = 1;
    r = await X.post(b.doc);
    assert.equal(r.status, 200); assert.deepEqual(r.body.qb, { queued: 0, sending: false });
    await X.settle(); assert.equal(X.qbSent().length, 0);
    // the posting itself is refused (an old version): nothing queued or sent
    const c = await X.review('QB-PV', '7303');
    r = await X.api('tok-office', { action: 'post', doc_id: c.doc.id, version: c.doc.version - 1, reason: '経理の確認' });
    assert.equal(r.status, 409); await X.settle();
    assert.equal(await X.row(c.id), undefined); assert.ok(!X.G.sent.some(m => m.mime.subject.includes('FPQB-ID-' + c.id)));
    // the worker (it ran for the third invoice too) renames the first when its retry is due, queues both and sends each once
    await X.q(`update invoice_files set rename_next_at=now() where drive_file_id=$1`, [a.id]);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent'); assert.equal((await X.row(b.id)).state, 'sent');
    assert.equal(X.qbSent().length, 2);
  } finally { await X.pg.close(); }
});

test('(5) repeated starts, a double press and runs at the same time send once', async () => {
  const X = await env0();
  try {
    const { id, doc: d } = await X.review('QB-DUP', '7401');
    let gate; X.G.gate = new Promise(r => { gate = r; });
    const [p1, p2] = await Promise.all([X.post(d), X.post(d)]);                  // the same button twice
    assert.deepEqual([p1.status, p2.status].sort(), [200, 409]);
    const extra = [X.worker(), X.worker(), X.h(new Request('https://fn.test', { method: 'POST', headers: { 'x-invoice-worker-key': WORKER_KEY }, body: '{"action":"worker"}' }))];
    setTimeout(gate, 50);
    await Promise.all(extra); await X.settle();
    assert.equal(X.qbSent().length, 1);
    assert.equal((await X.row(id)).state, 'sent');
    // a later start for the same original sends nothing
    await X.q(`update invoice_qb_outbox set state='pending' where file_id=(select id from invoice_files where drive_file_id=$1) and false`, [id]);
    await X.worker(); await X.settle(); assert.equal(X.qbSent().length, 1);
  } finally { await X.pg.close(); }
});

test('(6) an original the forwarder before already sent (the same Drive file, or another with the same content) is recorded, not sent', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_qb_outbox set state='sent' where false`);
    const a = await X.review('QB-OLD', '7501');
    const sha = crypto.createHash('sha256').update(X.drive.items.get(a.id).bytes).digest('hex');
    const size = X.drive.items.get(a.id).bytes.length;
    // two mails with the marks that did not go to QuickBooks come first: the one that did is on the second page of both searches
    X.G.addSent(`fwd FPQB-ID-${a.id} FPQB-SHA256-${sha}`, { to: 'someone@example.test' }); X.G.addSent(`fwd2 FPQB-ID-${a.id} FPQB-SHA256-${sha}`, { to: 'other@example.test' });
    const old = X.G.addSent(`FPQB-ID-${a.id} FPQB-SHA256-${sha} | scan.pdf`, { attachments: [{ filename: 'scan.pdf', size }] });   // September's form, no attempt mark
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'sent'); assert.equal(o.message_id, old); assert.match(o.result.note, /前の転送で送った/);
    assert.equal(X.qbSent().length, 0);
    // another Drive file, the same content sent before under its own ID
    const b = await X.review('QB-OLD2', '7502');
    const shab = crypto.createHash('sha256').update(X.drive.items.get(b.id).bytes).digest('hex');
    const old2 = X.G.addSent(`x.pdf FPQB-ID-someotherfile FPQB-SHA256-${shab} FPQB-ATTEMPT-qb-${shab}-zzz`, { attachments: [{ filename: 'x.pdf', size: X.drive.items.get(b.id).bytes.length }] });
    await X.post(b.doc); await X.settle();
    o = await X.row(b.id);
    assert.equal(o.state, 'sent'); assert.equal(o.message_id, old2);
    // the same Drive file sent before with another content: nothing sent, a person decides
    const c = await X.review('QB-OLD3', '7503');
    X.G.addSent(`y.pdf FPQB-ID-${c.id} FPQB-SHA256-${'f'.repeat(64)}`, { attachments: [{ filename: 'y.pdf', size: 3 }] });
    await X.post(c.doc); await X.settle();
    o = await X.row(c.id);
    assert.equal(o.state, 'unknown'); assert.equal(o.last_error, 'same_drive_id_other_content');
    assert.equal(X.qbSent().length, 0);
    await X.worker(); await X.settle();
    assert.equal(X.qbSent().length, 0, 'an unknown row is never sent again by itself');
  } finally { await X.pg.close(); }
});

test('(7) a replaced original, a start before the switch, another address or the ledger off: nothing is sent', async () => {
  const X = await env0();
  try {
    // the Drive bytes changed after the posting: set aside, a person is told, nothing sent
    const a = await X.review('QB-CH', '7601');
    let gate; X.G.gate = new Promise(r => { gate = r; });
    X.G.searchFail = 0;
    const real = X.drive.download.bind(X.drive);
    X.drive.download = async fid => { if (fid === a.id) X.drive.replaceContent(a.id, pdf('QB-CH') + 'changed'); X.drive.download = real; return real(fid); };
    await X.post(a.doc); gate(); await X.settle();
    let o = (await X.q(`select o.* from invoice_qb_outbox o join invoice_files f on f.id=o.file_id where f.drive_file_id=$1`, [a.id]))[0];
    assert.equal(o.state, 'cancelled'); assert.equal(o.last_error, 'content_changed');
    assert.equal(X.qbSent().length, 0);
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 hour') where key='qb'`);
    await X.worker(); await X.settle();
    assert.ok((await X.q(`select * from invoice_qb_alerts where kind='content_changed'`)).length === 1);
    // the ledger is off: nothing is queued or sent (the posting stands)
    const b = await X.review('QB-OFF', '7602');
    await X.q(`update invoice_settings set value=value||'{"enabled":false}' where key='qb'`);
    let r = await X.post(b.doc); await X.settle();
    assert.equal(r.status, 200); assert.equal(r.body.qb, null);
    await X.worker(); await X.settle();
    assert.equal(await X.row(b.id), undefined); assert.equal(X.qbSent().length, 0);
    // a row already waiting is not even reserved while the ledger is off
    await X.q(`insert into invoice_qb_outbox(file_id, sha256, to_address, route, attempt_key) select f.id, f.current_sha256, $2, 'invoice-intake', 'qb-' || f.current_sha256 || '-off'
      from invoice_files f where f.drive_file_id=$1`, [b.id, TO]);
    await X.worker(); await X.settle();
    assert.deepEqual([(await X.row(b.id)).state, (await X.row(b.id)).attempts, (await X.row(b.id)).reserved_by, (await X.row(b.id)).last_error], ['pending', 0, null, null]);
    await X.q(`update invoice_settings set value=value||'{"enabled":true}' where key='qb'`);
    await X.worker(); await X.settle();
    assert.equal((await X.row(b.id)).state, 'sent');
    // the settings change between the reservation and the send: read again, nothing sent (an error, retried later; the ledger
    // turned off lets the row go without a try: it waits for the ledger)
    for (const [tag, no, change, why, state] of [
      ['QB-SINCE', '7603', `update invoice_settings set value=value||'{"since":"2027-01-01"}' where key='qb'`, 'before_since', 'error'],
      ['QB-TO', '7604', `update invoice_settings set value=value||'{"to":"other@example.test"}' where key='qb'`, 'to_changed', 'error'],
      ['QB-FROM', '7605', `update invoice_settings set value=value||'{"from":"someone@example.test"}' where key='qb'`, 'sender_mismatch', 'error'],
      ['QB-QOFF', '7606', `update invoice_settings set value=value||'{"enabled":false}' where key='qb'`, 'qb_off', 'pending']]) {
      const c = await X.review(tag, no);
      const keep = (await X.q(`select value from invoice_settings where key='qb'`))[0].value;
      X.hook('invoice_qb_send_context', () => X.q(change));
      r = await X.post(c.doc); await X.settle();
      const o = await X.row(c.id);
      assert.deepEqual([o.state, o.last_error], [state, why], tag);
      if (state === 'pending') assert.equal(o.attempts, 0, tag);
      assert.equal(X.sentFor(c.id), 0, tag);
      await X.q(`update invoice_settings set value=$1 where key='qb'`, [keep]);
    }
    // the same, found only at the last check before sending
    const d = await X.review('QB-LATE', '7607');
    const keep = (await X.q(`select value from invoice_settings where key='qb'`))[0].value;
    X.hook('invoice_qb_send_check', () => X.q(`update invoice_settings set value=value||'{"since":"2027-01-01"}' where key='qb'`));
    await X.post(d.doc); await X.settle();
    assert.deepEqual([(await X.row(d.id)).state, (await X.row(d.id)).last_error], ['error', 'before_since']);
    assert.equal(X.sentFor(d.id), 0);
    await X.q(`update invoice_settings set value=$1 where key='qb'`, [keep]);
    // the outside forwarder cannot reserve a row of this system (409)
    await X.q(`update invoice_settings set value=jsonb_build_object('key', repeat('k', 40), 'enabled', true) where key='qb_external'`);
    const ext = await X.h(new Request('https://fn.test', { method: 'POST', headers: { 'x-invoice-qb-key': 'k'.repeat(40) },
      body: JSON.stringify({ action: 'qb_external_reserve', id: (await X.row(d.id)).id }) }));
    assert.equal(ext.status, 409);
  } finally { await X.pg.close(); }
});

test('(8)(9) a failed search, an unknown send, a lost result, an old reservation, five errors', async () => {
  const X = await env0();
  try {
    // the search fails: not sent, retried later (an error, counted)
    const a = await X.review('QB-HF', '7701');
    X.G.searchFail = 1;
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'error'); assert.equal(o.last_error, 'gmail_history_failed'); assert.equal(o.attempts, 1); assert.equal(X.qbSent().length, 0);
    await X.q(`update invoice_qb_outbox set next_at=now() where id=$1`, [o.id]);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent'); assert.equal(X.qbSent().length, 1);
    // Gmail does not answer (the message may have left): unknown, never sent again by itself
    const b = await X.review('QB-UK', '7702');
    X.G.sendMode = 'timeout';
    await X.post(b.doc); await X.settle();
    o = await X.row(b.id);
    assert.equal(o.state, 'unknown'); assert.equal(X.qbSent().length, 1);
    X.G.sendMode = 'ok';
    await X.worker(); await X.worker(); await X.settle();
    assert.equal((await X.row(b.id)).state, 'unknown'); assert.equal(X.qbSent().length, 1);
    // a 500 after the message left: unknown; Gmail shows it later by its attempt mark → sent with that ID (nothing sent again)
    const c = await X.review('QB-500', '7703');
    X.G.sendMode = '500_after';
    await X.post(c.doc); await X.settle();
    o = await X.row(c.id);
    assert.equal(o.state, 'unknown'); assert.equal(X.qbSent().length, 2);
    X.G.sendMode = 'ok';
    await X.q(`update invoice_qb_outbox set updated_at=now() - interval '20 minutes' where id=$1`, [o.id]);
    await X.worker(); await X.settle();
    o = await X.row(c.id);
    assert.equal(o.state, 'sent'); assert.equal(o.message_id, X.qbSent()[1].id); assert.match(o.result.note, /Gmail の送信済みで見つけた/);
    assert.equal(X.qbSent().length, 2);
    // the result could not be written: the mail went once; the row becomes unknown and is then found by its mark (not sent again)
    let failResult = 0;
    const Y = await env0({ db: real => ({ async rpc(name, p) { if (name === 'invoice_qb_result' && p.state === 'sent' && failResult > 0) { failResult--; throw new Error('db_down'); } return real.rpc(name, p); } }) });
    try {
      const d = await Y.review('QB-RR', '7704');
      failResult = 3;
      await Y.post(d.doc); await Y.settle();
      let r = await Y.row(d.id);
      assert.equal(r.state, 'sending'); assert.equal(Y.qbSent().length, 1);
      await Y.q(`update invoice_qb_outbox set reserved_at=now() - interval '16 minutes' where id=$1`, [r.id]);
      await Y.worker(); await Y.settle();                                       // swept to unknown…
      await Y.q(`update invoice_qb_outbox set updated_at=now() - interval '20 minutes' where id=$1`, [r.id]);
      await Y.worker(); await Y.settle();                                       // …found by its attempt mark
      r = await Y.row(d.id);
      assert.equal(r.state, 'sent'); assert.equal(r.message_id, Y.qbSent()[0].id); assert.equal(Y.qbSent().length, 1);
    } finally { await Y.pg.close(); }
    // a reservation older than 13 minutes at the last check is not used to send
    const e = await X.review('QB-EXP', '7705');
    const before = X.qbSent().length;
    X.hook('invoice_qb_send_check', p => X.q(`update invoice_qb_outbox set reserved_at=now() - interval '14 minutes' where id=$1`, [p.id]));
    await X.post(e.doc); await X.settle();
    o = await X.row(e.id);
    assert.deepEqual([o.state, o.last_error], ['error', 'reservation_expired']);
    assert.equal(X.qbSent().length, before);
    // five errors: it stops (error 5/5), Moto is told once
    const f = await X.review('QB-5X', '7706');
    X.G.sendMode = '429';
    await X.post(f.doc); await X.settle();
    const fo = await X.row(f.id);
    for (let i = 0; i < 6; i++) { await X.q(`update invoice_qb_outbox set next_at=now() where id=$1 and state='error'`, [fo.id]); await X.worker(); await X.settle(); }
    o = await X.row(f.id);
    assert.equal(o.state, 'error'); assert.equal(o.attempts, 5); assert.match(o.last_error, /gmail_send_429/);
    X.G.sendMode = 'ok';
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 day') where key='qb'`);
    await X.worker(); await X.settle();
    assert.equal((await X.row(f.id)).state, 'error', 'the five tries are kept');
    assert.equal((await X.q(`select * from invoice_qb_alerts where kind='error_final' and data->>'outbox_id'=$1`, [fo.id])).length, 1);
    await X.worker(); await X.settle();
    assert.equal((await X.q(`select * from invoice_qb_alerts where kind='error_final' and data->>'outbox_id'=$1`, [fo.id])).length, 1, 'told once');
  } finally { await X.pg.close(); }
});

test('the outside forwarder keeps its rows (6A); with the route on this system only the new rows are this system’s', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    await X.q(`update invoice_settings set value=jsonb_build_object('key', repeat('k', 40), 'enabled', true) where key='qb_external'`);
    const a = await X.review('QB-EXT', '7801');
    await X.post(a.doc); await X.settle();
    assert.equal((await X.row(a.id)).route, 'external'); assert.equal(X.qbSent().length, 0);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'pending', 'this system never sends the forwarder’s row');
    // switching to this system needs the connected Gmail of qb.from, checked (確かめる); then the next posting is this system's
    let r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.deepEqual([r.status, r.body.error], [409, 'gmail_not_ready'], 'not checked yet');
    assert.equal((await X.api('tok-gm', { action: 'gmail_check' })).body.check_result.history_probe.tried, false, 'nothing was sent before: nothing to look up');
    r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.equal(r.status, 200); assert.ok(r.body.route_since);
    const b = await X.review('QB-NEW', '7802');
    await X.post(b.doc); await X.settle();
    assert.equal((await X.row(b.id)).route, 'invoice-intake'); assert.equal((await X.row(b.id)).state, 'sent');
    assert.equal((await X.row(a.id)).state, 'pending');
    // the forwarder before watches with its own key (read only)
    const mon = await X.h(new Request('https://fn.test', { method: 'POST', headers: { 'x-invoice-qb-key': 'k'.repeat(40) }, body: '{"action":"qb_external_monitor"}' }));
    const mb = await mon.json();
    assert.equal(mon.status, 200); assert.equal(mb.route, 'invoice-intake'); assert.equal(mb.gmail, 'ok'); assert.equal(Number(mb.external_waiting), 1);
    assert.ok(!/refresh|synthetic-refresh|token/i.test(JSON.stringify(mb)));
    assert.equal((await X.h(new Request('https://fn.test', { method: 'POST', body: '{"action":"qb_external_monitor"}' }))).status, 401);
  } finally { await X.pg.close(); }
});

test('connecting Gmail: only CEO・GM, only the account of qb.from with both scopes; the state is used once; the route needs it', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    await X.pg.exec(`reset role; delete from invoice_gmail_auth; set role service_role;`);
    let r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.deepEqual([r.status, r.body.error], [409, 'gmail_not_ready']);
    assert.equal((await X.api('tok-office', { action: 'gmail_connect' })).status, 403);
    assert.equal((await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { from: 'x@example.test' } })).body.error, 'field_not_editable');
    const start = async () => {
      const s = await X.api('tok-gm', { action: 'gmail_connect' });
      assert.equal(s.status, 200);
      const u = new URL(s.body.url);
      assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(u.searchParams.get('scope'), SEND + ' ' + READ); assert.equal(u.searchParams.get('access_type'), 'offline');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('login_hint'), 'sender@example.test');
      assert.equal(u.searchParams.get('redirect_uri'), 'https://db.test/functions/v1/invoice-intake');
      return { state: u.searchParams.get('state'), challenge: u.searchParams.get('code_challenge') };
    };
    const back = (state, code) => X.get('https://fn.test/?state=' + encodeURIComponent(state) + '&code=' + code);
    // another account: not kept
    let s = await start();
    X.G.codes.set('C-WRONG', { account: 'someone@example.test', refresh: 'r-wrong', scopes: [SEND, READ], verifierHash: s.challenge, verifier: '' });
    let g = await back(s.state, 'C-WRONG');
    assert.equal(g.status, 302); assert.match(g.location, /invoice_gmail=wrong_account$/);
    assert.equal((await X.q('select count(*)::int n from invoice_gmail_auth'))[0].n, 0);
    // the same state again: refused
    assert.match((await back(s.state, 'C-WRONG')).location, /invoice_gmail=bad_state$/);
    // a scope left out: not kept
    s = await start();
    X.G.codes.set('C-SCOPE', { account: 'sender@example.test', refresh: 'r-scope', scopes: [SEND], verifierHash: s.challenge, verifier: '' });
    assert.match((await back(s.state, 'C-SCOPE')).location, /invoice_gmail=scope_missing$/);
    // the person cancelled on Google's page
    s = await start();
    assert.match((await X.get('https://fn.test/?state=' + encodeURIComponent(s.state) + '&error=access_denied')).location, /invoice_gmail=denied$/);
    // the right account with both scopes: kept, never shown
    s = await start();
    X.G.codes.set('C-OK', { account: 'Sender@Example.test', refresh: 'r-ok-secret', scopes: [SEND, READ], verifierHash: s.challenge, verifier: '' });
    g = await back(s.state, 'C-OK');
    assert.match(g.location, /^https:\/\/funergy-plus\.com\/\?invoice_gmail=ok$/);
    assert.ok(!g.location.includes('r-ok-secret'));
    const cfg = (await X.api('tok-office', { action: 'config' })).body.settings;
    assert.equal(cfg.gmail.status, 'ok'); assert.equal(cfg.gmail.from_ok, true); assert.equal(cfg.gmail.send_scope, true); assert.equal(cfg.gmail.read_scope, true);
    assert.ok(!JSON.stringify(cfg).includes('r-ok-secret'));
    assert.ok(!JSON.stringify(await X.q('select data from invoice_events')).includes('r-ok-secret'), 'the history never keeps the token');
    // 確かめる
    const c = await X.api('tok-gm', { action: 'gmail_check' });
    assert.equal(c.status, 200); assert.equal(c.body.status, 'ok'); assert.equal(c.body.check_result.search_ok, true); assert.ok(!JSON.stringify(c.body).includes('r-ok-secret'));
    assert.equal((await X.api('tok-office', { action: 'gmail_check' })).status, 403);
    // now the route can be this system
    r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.equal(r.status, 200); assert.ok(r.body.route_since);
    // 切る: the token is forgotten (never revoked at Google), sending waits
    r = await X.api('tok-gm', { action: 'gmail_disconnect' });
    assert.equal(r.body.status, 'disconnected');
    assert.equal((await X.q('select refresh_token from invoice_gmail_auth'))[0].refresh_token, null);
    assert.ok(!X.G.calls.some(u => /revoke/.test(u)), 'nothing is revoked at Google');
    const a = await X.review('QB-DISC', '7901');
    await X.post(a.doc); await X.settle(); await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'pending'); assert.equal(X.qbSent().length, 0);
  } finally { await X.pg.close(); }
});

test('the permission taken back: sending stops, nothing is reserved, Moto is told once a day; connecting again sends what waited', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 hour') where key='qb'`);
    X.G.tokenMode = 'invalid_grant';
    const a = await X.review('QB-AUTH', '8001');
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'pending'); assert.equal(o.attempts, 0, 'nothing was reserved');
    assert.equal((await X.q('select status from invoice_gmail_auth'))[0].status, 'expired');
    await X.worker(); await X.settle(); await X.worker(); await X.settle();
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_alerts where kind='auth'`))[0].n, 1);
    const line = X.G.line.filter(l => /Gmail の許可が切れました/.test(l.body.messages[0].text));
    assert.equal(line.length, 0, 'no LINE group is set up here: nothing pushed');
    X.G.tokenMode = 'ok';
    await X.q(`update invoice_gmail_auth set status='ok'`);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent');
  } finally { await X.pg.close(); }
});

test('notices: once each, to the app (app_state), by mail to the account itself and to the LINE group; switches respected', async () => {
  const X = await env0();
  try {
    await X.pg.exec(`reset role; create table public.bot_settings(key text primary key, value jsonb); create table public.bot_groups(group_id text primary key, label text, enabled boolean);
      insert into bot_settings values ('morning_summary', '{"enabled":true,"routes":{"finance":{"group_id":"C${'a'.repeat(32)}","label":"本部業務連絡"}}}');
      insert into bot_groups values ('C${'a'.repeat(32)}', '本部業務連絡', true); grant select on bot_settings, bot_groups to service_role; set role service_role;`);
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 minute') where key='qb'`);
    const a = await X.review('QB-N1', '8101');
    await X.post(a.doc); await X.settle();
    const al = await X.q(`select * from invoice_qb_alerts order by created_at`);
    assert.deepEqual(al.map(x => x.kind), ['first_sent']);
    assert.equal(al[0].line_state, 'sent'); assert.equal(al[0].email_state, 'sent');
    const push = X.G.line.at(-1);
    assert.equal(push.body.to, 'C' + 'a'.repeat(32)); assert.equal(push.headers['x-line-retry-key'], al[0].id);
    assert.match(push.body.messages[0].text, /初めて送れました/);
    const mail = X.G.sent.find(m => m.mime.to === 'sender@example.test');
    assert.ok(mail, 'the notice went to the connected account itself'); assert.match(mail.mime.text, /初めて送れました|送りました/);
    assert.ok(!/FPQB-/.test(mail.mime.subject + mail.mime.text));
    const app = (await X.q(`select value from app_state where key='invoice_qb_alerts'`))[0].value;
    assert.equal(app.rows.length, 1); assert.equal(app.rows[0].kind, 'first_sent');
    assert.ok(!/synthetic-refresh|at-\d/.test(JSON.stringify(app)), 'no token in what the app reads');
    // a second send is not "first" again
    const b = await X.review('QB-N2', '8102');
    await X.post(b.doc); await X.settle(); await X.worker(); await X.settle();
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_alerts where kind='first_sent'`))[0].n, 1);
    // LINE off, mail off: marked so and never sent
    await X.api('tok-gm', { action: 'settings_save', key: 'qb_notify', value: { line: false, email: false } });
    assert.equal((await X.api('tok-gm', { action: 'settings_save', key: 'qb_notify', value: { line: 'yes' } })).status, 400);
    const c = await X.review('QB-N3', '8103');
    X.G.sendMode = 'timeout';
    const pushes = X.G.line.length;
    await X.post(c.doc); await X.settle();
    const u = (await X.q(`select * from invoice_qb_alerts where kind='unknown'`))[0];
    assert.ok(u); assert.equal(u.line_state, 'off'); assert.equal(u.email_state, 'off'); assert.equal(X.G.line.length, pushes);
    assert.equal((await X.q(`select value from app_state where key='invoice_qb_alerts'`))[0].value.rows[0].kind, 'unknown');
    // the 「Gmail の送信済みを調べる」 button (accounting): not there → nothing changes; there → sent with its ID
    X.G.sendMode = 'ok';
    const ub = await X.row(c.id);
    let r = await X.api('tok-office', { action: 'qb_lookup', id: ub.id });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { found: false, summary: true });
    assert.equal((await X.api('tok-other', { action: 'qb_lookup', id: ub.id })).status, 403);
    X.G.addSent(`z.pdf FPQB-ID-${c.id} FPQB-SHA256-${ub.sha256} FPQB-ATTEMPT-${ub.attempt_key}`, { attachments: [{ filename: 'z.pdf', size: X.drive.items.get(c.id).bytes.length }] });
    r = await X.api('tok-crew', { action: 'qb_lookup', id: ub.id });
    assert.equal(r.body.found, true);
    assert.equal((await X.row(c.id)).state, 'sent');
    assert.equal((await X.api('tok-crew', { action: 'qb_lookup', id: ub.id })).status, 409);
  } finally { await X.pg.close(); }
});

test('a large original goes through the upload endpoint, unchanged', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_stores set auto_post=false`);
    X.fixtures.set('QB-BIG', { readable: true, documents: [doc('8201', '2026-10-06', [['06263', 'SHIRO MISO 12/500G', '1', '61.20', '61.20', 'CS', '12/500G']])] });
    const id = X.drive.file('big.pdf', pdf('QB-BIG') + '\n' + crypto.randomBytes(3.2 * 1048576).toString('latin1'), 'U6');
    await X.worker();
    const [d] = await docsOf(X, id);
    await X.post(d); await X.settle();
    const m = X.qbSent().at(-1);
    assert.equal(m.upload, true); assert.equal(m.mime.parts.length, 1); assert.ok(m.mime.parts[0].data.equals(X.drive.items.get(id).bytes));
  } finally { await X.pg.close(); }
});

test('(12) no token, key or original content in logs, the history, the status or the app copy', async () => {
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
  try {
    const X = await env0();
    try {
      const a = await X.review('QB-LOG', '8301');
      X.G.sendMode = '500';
      await X.post(a.doc); await X.settle();
      X.G.sendMode = 'ok'; X.G.searchFail = 2;
      const b = await X.review('QB-LOG2', '8302');
      await X.post(b.doc); await X.settle(); await X.worker(); await X.settle();
      const all = JSON.stringify([errs, await X.q('select * from invoice_events'), await X.q('select * from invoice_qb_outbox'), await X.q('select * from invoice_runs'),
        (await X.api('tok-office', { action: 'qb_status' })).body, (await X.api('tok-office', { action: 'config' })).body, await X.q(`select value from app_state where key='invoice_qb_alerts'`)]);
      for (const secret of [SECRET_REFRESH, 'client-secret-1', 'line-token-1', 'service', WORKER_KEY]) assert.ok(!all.includes(secret) || secret === 'service' && !/"service"/.test(all), secret);
      assert.ok(!/\bat-\d+\b/.test(all), 'no access token');
      assert.ok(!all.includes(pdf('QB-LOG')), 'no original content');
    } finally { await X.pg.close(); }
  } finally { console.error = orig; }
});

// The screen (index.html's own card) drawn from what the real server answers: the shapes agree.
test('the 取込状況 card from the real qb_status: the sent row with its times and Gmail ID, an unknown row with its buttons', async () => {
  const X = await env0();
  try {
    const a = await X.review('QB-UI1', '8401');
    await X.post(a.doc); await X.settle();
    const b = await X.review('QB-UI2', '8402');
    X.G.sendMode = 'timeout';
    await X.post(b.doc); await X.settle();
    const st = (await X.api('tok-office', { action: 'qb_status' })).body;
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const cutH = (x, y) => { const i = html.indexOf(x), j = html.indexOf(y, i); return html.slice(i, j); };
    const fnOf = n => { const i = html.indexOf('\nfunction ' + n + '('); return html.slice(i, html.indexOf('\n}', i) + 2); };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const c = { curLang: 'ja', curRole: 'office', escapeHtml: esc, t: (ja) => ja, _invIn: { qbs: st, loaded: {} }, invInStoreHtml: id => id, invInId: v => String(v),
      invInCanEdit: () => true, invInTime: v => String(v), Date, JSON, Number, String };
    vm.createContext(c);
    vm.runInContext([fnOf('invInL'), fnOf('invInChip'), 'var INVIN_COL = { green:"#15A66A", yel:"#B7791F", red:"#D64545", blue:"#0E78C4", gray:"#7a7a72", org:"#F0661F" };',
      fnOf('invInRouteText'), fnOf('invInQbSinceLocal'), fnOf('invInQbSinceText'), fnOf('invInHstLocal'),
      cutH('/* ===================================================================== v1094（UI案56', 'async function invInRetry(fileId){')].join('\n'), c);
    const h = vm.runInContext('invInQbCard({ qb_settings:{} }, null)', c);
    const sent = await X.row(a.id), unk = await X.row(b.id);
    assert.ok(h.includes(sent.message_id) && /メール送信済み/.test(h) && /反映 \d\d\/\d\d \d\d:\d\d:\d\d → 名前 [\d:]+ → 台帳 [\d:]+ → 送信開始 [\d:]+ → 送信済み [\d:]+/.test(h));
    assert.ok(h.includes("invInQbLookup('" + unk.id + "')"));
    assert.match(h, /送信済み 1[\s\S]*結果不明 1/);
  } finally { await X.pg.close(); }
});

// Review (2026-10-18, P2-1): Gmail refusing the permission (a 403 on the send or the read, the refresh still working) stops sending
// without using the row's tries: the row waits, the connection is "denied", 確かめる (when fixed) sends what waited.
test('a permission Gmail refuses (403 on the send or the read): the row waits with its tries; 確かめる sends it once fixed', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 hour') where key='qb'`);
    const a = await X.review('QB-403S', '8101');
    X.G.sendMode = '403';
    let r = await X.post(a.doc); await X.settle();
    assert.equal(r.body.qb.sending, true);
    let o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts, o.reserved_by], ['pending', 0, null], 'let go, the try not counted');
    let g = (await X.q('select status, last_error from invoice_gmail_auth'))[0];
    assert.equal(g.status, 'denied'); assert.match(g.last_error, /gmail_send_403/);
    for (let i = 0; i < 4; i++) { await X.worker(); await X.settle(); }
    o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts], ['pending', 0], 'nothing is reserved while the connection is not good');
    assert.equal(X.qbSent().length, 0);
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_alerts where kind='auth'`))[0].n, 1, 'told once (a day)');
    // a posting meanwhile waits too, and says so
    const b = await X.review('QB-403S2', '8102');
    r = await X.post(b.doc); await X.settle();
    assert.equal(r.body.qb.sending, false); assert.equal(r.body.qb.waiting, 'gmail');
    // fixed at Google: 確かめる finds the connection good again, the next run sends both
    X.G.sendMode = 'ok';
    const c = await X.api('tok-gm', { action: 'gmail_check' });
    assert.equal(c.body.status, 'ok');
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent'); assert.equal((await X.row(b.id)).state, 'sent');
    assert.equal((await X.row(a.id)).attempts, 1);
    // the read refused (403, not a rate limit): the same
    const d = await X.review('QB-403R', '8103');
    X.G.searchErr = { status: 403, reason: 'insufficientPermissions', n: 1 };
    await X.post(d.doc); await X.settle();
    o = await X.row(d.id);
    assert.deepEqual([o.state, o.attempts], ['pending', 0]);
    g = (await X.q('select status, last_error from invoice_gmail_auth'))[0];
    assert.deepEqual([g.status, g.last_error], ['denied', 'gmail_history_403']);
  } finally { await X.pg.close(); }
});

// Review (P2-2): a 403 that is Gmail's rate limit is a busy Gmail, not a lost permission: no "許可が切れました", a try with its wait.
test('a rate limit on the search (403 userRateLimitExceeded) is not a lost permission: an ordinary retry later', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 hour') where key='qb'`);
    const a = await X.review('QB-RATE', '8201');
    X.G.searchErr = { status: 403, reason: 'userRateLimitExceeded', n: 1 };
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts, o.last_error], ['error', 1, 'gmail_history_failed']);
    assert.equal((await X.q('select status from invoice_gmail_auth'))[0].status, 'ok');
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_alerts where kind='auth'`))[0].n, 0);
    await X.q(`update invoice_qb_outbox set next_at=now() where id=$1`, [o.id]);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent');
  } finally { await X.pg.close(); }
});

// Review (deploy order): this system sends only while it is the sender. Rows of this system that wait when the route goes back to the
// forwarder before stay (nobody sends them, nothing is lost) and are sent when it is this system again.
test('this system sends only while it is the sender: its waiting rows stay with the route given back, and go on after', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_gmail_auth set status='expired'`);
    const a = await X.review('QB-ROUTE', '8301');
    const r = await X.post(a.doc); await X.settle();
    assert.equal(r.body.qb.waiting, 'gmail');
    assert.equal((await X.row(a.id)).route, 'invoice-intake');
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    await X.q(`update invoice_gmail_auth set status='ok'`);
    for (let i = 0; i < 2; i++) { await X.worker(); await X.settle(); }
    assert.deepEqual([(await X.row(a.id)).state, (await X.row(a.id)).attempts, (await X.row(a.id)).last_error], ['pending', 0, null], 'not even reserved');
    assert.equal(X.qbSent().length, 0);
    // a reserved row whose route went back meanwhile is let go, not a try
    await X.q(`update invoice_settings set value=value||'{"route":"invoice-intake"}' where key='qb'`);
    X.hook('invoice_qb_send_context', async () => { await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`); });
    await X.worker(); await X.settle();
    assert.deepEqual([(await X.row(a.id)).state, (await X.row(a.id)).attempts, (await X.row(a.id)).last_error], ['pending', 0, 'route_changed']);
    await X.q(`update invoice_settings set value=value||'{"route":"invoice-intake"}' where key='qb'`);
    await X.worker(); await X.settle();
    assert.equal((await X.row(a.id)).state, 'sent'); assert.equal(X.qbSent().length, 1);
  } finally { await X.pg.close(); }
});

// Review (P2-4): before the switch, 確かめる looks up the newest original already sent (the forwarder before's) with the very search
// every send makes; the switch needs it found. The search uses the whole marks (found whether or not Gmail splits them).
test('確かめる finds a sent original in the sent mail with the send’s own search; not found, the switch is refused', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    const a = await X.review('QB-PROBE', '8401');
    await X.post(a.doc); await X.settle();
    const row = await X.row(a.id);
    assert.equal(row.route, 'external');
    const size = X.drive.items.get(a.id).bytes.length;
    const mid = X.G.addSent(`2026-10-06_x.pdf FPQB-ID-${a.id} FPQB-SHA256-${row.sha256} FPQB-ATTEMPT-${row.attempt_key}`, { attachments: [{ filename: 'x.pdf', size }] });
    await X.q(`update invoice_qb_outbox set state='sent', message_id=$2, sent_at=now() where id=$1`, [row.id, mid]);
    // not in the sent mail (moved away): found false, the switch refused
    const keep = X.G.sent.splice(0);
    let c = (await X.api('tok-gm', { action: 'gmail_check' })).body;
    assert.equal(c.status, 'ok'); assert.deepEqual([c.check_result.history_probe.tried, c.check_result.history_probe.found], [true, false]);
    let r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.deepEqual([r.status, r.body.error], [409, 'gmail_not_ready']);
    // in the sent mail: found (the same Gmail ID), the switch goes
    X.G.sent.push(...keep);
    c = (await X.api('tok-gm', { action: 'gmail_check' })).body;
    assert.deepEqual([c.check_result.history_probe.found, c.check_result.history_probe.same_id, c.check_result.history_probe.route], [true, true, 'external']);
    r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.equal(r.status, 200);
    // the searches are the whole marks
    assert.ok(X.G.queries.includes(`in:sent "FPQB-SHA256-${row.sha256}"`) && X.G.queries.includes(`in:sent "FPQB-ID-${a.id}"`), X.G.queries.join(' | '));
  } finally { await X.pg.close(); }
});

// Review (P3): a person who checked and sends an unknown row again gives it one more try, even when it had used its five.
test('a person’s 「確かめて、もう一度送る」 gives an unknown row one more try (it had used its five): it is sent, once', async () => {
  const X = await env0();
  try {
    const a = await X.review('QB-FIVE', '8501');
    X.G.sendMode = 'timeout';
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'unknown');
    // a later posting runs the sender again: it never takes the unknown row along
    X.G.sendMode = 'ok';
    const b = await X.review('QB-FIVE2', '8502');
    await X.post(b.doc); await X.settle(); await X.worker(); await X.settle();
    assert.equal((await X.row(b.id)).state, 'sent');
    assert.equal((await X.row(a.id)).state, 'unknown', 'an unknown row is left for a person'); assert.equal(X.sentFor(a.id), 0);
    await X.q(`update invoice_qb_outbox set attempts=5 where id=$1`, [o.id]);
    X.G.sent.splice(0);   // looked for, not in the sent mail
    const r = await X.api('tok-office', { action: 'qb_resolve', id: o.id, state: 'pending', note: '送信済みに無いのを確かめた' });
    assert.equal(r.status, 200);
    o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts], ['pending', 4], 'one more try, no more');
    X.G.sendMode = 'ok';
    await X.worker(); await X.settle();
    o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts], ['sent', 5]); assert.equal(X.sentFor(a.id), 1);
  } finally { await X.pg.close(); }
});

// Second independent review (9319a56, 2026-10-18) — timed(): a body that never finishes
test('timed(): headers then a stalled body is cut at the timeout (no hang); a send whose answer never ends is unknown; 205 is a network error', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/s205')) { res.writeHead(205); res.end(); return; }
    res.writeHead(403, { 'content-type': 'application/json' }); res.write('{"error":{"errors":[{"reason":"insuff');   // never ends
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let mode = 'stall';
  const fetchLocal = (url, init) => {
    const u = new URL(String(url));
    if (u.origin === 'https://oauth2.googleapis.com') return Promise.resolve(Response.json({ access_token: 't' }));
    return fetch(`http://127.0.0.1:${port}${mode === '205' ? '/s205' : ''}${u.pathname}${u.search}`, init);
  };
  try {
    const g = createGmail({ fetch: fetchLocal, getCreds: async () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', account: 'a@x' }), timeoutMs: 400, sendTimeoutMs: 400 });
    assert.equal((await g.ready()).ok, true);
    const t0 = Date.now();
    await assert.rejects(g.history({ sha256: 'a'.repeat(64), driveFileId: 'd', attemptKey: 'k', to: 'x@y', size: 1 }), e => e.code === 'gmail_history_network' && !e.auth);
    assert.ok(Date.now() - t0 < 3000, 'cut at the timeout');
    const s = await g.send({ from: 'a@x', to: 'x@y', subject: 's', attachment: { name: 'a.pdf', mime: 'application/pdf', bytes: new Uint8Array(3) } });
    assert.deepEqual([s.ok, s.unknown], [false, true], 'a send whose answer body never ends is unknown');
    mode = '205';
    await assert.rejects(g.history({ sha256: 'a'.repeat(64), driveFileId: 'd', attemptKey: 'k', to: 'x@y', size: 1 }), e => e.code === 'gmail_history_network');
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

// Second independent review (9319a56, 2026-10-18) — P3: the ledger turned off mid-run burns tries (route_changed does not)
test('the ledger turned OFF while a send run is going: the reserved row is let go (not a try), nothing more is reserved', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_gmail_auth set status='expired'`);
    const a = await X.review('QB2-OFF1', '9101'); await X.post(a.doc); await X.settle();
    const b = await X.review('QB2-OFF2', '9102'); await X.post(b.doc); await X.settle();
    assert.equal((await X.row(a.id)).state, 'pending'); assert.equal((await X.row(b.id)).state, 'pending');
    await X.q(`update invoice_gmail_auth set status='ok'`);
    // The CEO turns the ledger off just as the worker's sender reserves its first row.
    X.hook('invoice_qb_reserve', async () => { await X.q(`update invoice_settings set value=value||'{"enabled":false}' where key='qb'`); });
    await X.worker(); await X.settle();
    const ra = await X.row(a.id), rb = await X.row(b.id);
    assert.deepEqual([ra.state, ra.attempts, ra.last_error, rb.state, rb.attempts, rb.last_error], ['pending', 0, 'qb_off', 'pending', 0, null],
      'the first row is let go, the second is not reserved: ' + JSON.stringify([ra.state, ra.attempts, ra.last_error, rb.state, rb.attempts, rb.last_error]));
  } finally { await X.pg.close(); }
});

// Second independent review (9319a56, 2026-10-18) — P3: unknown rows' automatic look-ups are used up by a refused read
test('an unknown row looked up while Gmail refuses the read (403): the look-up is not counted, the connection is marked', async () => {
  const X = await env0();
  try {
    const a = await X.review('QB2-UNK', '9201');
    X.G.sendMode = '500_after';                     // sent, but the answer is a 5xx: unknown
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'unknown');
    X.G.sendMode = 'ok';
    await X.q(`update invoice_qb_outbox set updated_at=now() - interval '20 minutes' where id=$1`, [o.id]);
    X.G.searchErr = { status: 403, reason: 'insufficientPermissions', n: 100 };
    await X.worker(); await X.settle();
    o = await X.row(a.id);
    const g = (await X.q('select status from invoice_gmail_auth'))[0];
    assert.deepEqual([o.state, o.gmail_checks, g.status], ['unknown', 0, 'denied'],
      'a refused read should not use a look-up and should mark the connection: ' + JSON.stringify([o.state, o.gmail_checks, g.status]));
  } finally { await X.pg.close(); }
});

// Second independent review (9319a56, 2026-10-18) — P3: the probe is skipped when the forwarder recorded no Gmail IDs
test('確かめる: a forwarder row sent without a Gmail ID is looked up too; not in the sent mail, the switch is refused', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    const a = await X.review('QB2-NOID', '9301');
    await X.post(a.doc); await X.settle();
    const row = await X.row(a.id);
    assert.equal(row.route, 'external');
    await X.q(`update invoice_qb_outbox set state='sent', message_id=null, sent_at=now() where id=$1`, [row.id]);   // sent, no Gmail ID recorded
    X.G.sent.splice(0);                              // and nothing in the sent mail at all
    const c = (await X.api('tok-gm', { action: 'gmail_check' })).body;
    const r = await X.api('tok-gm', { action: 'settings_save', key: 'qb', value: { route: 'invoice-intake' } });
    assert.deepEqual([c.check_result.history_probe.tried, r.status], [true, 409],
      'a sent forwarder row exists; the search should be tried on it: ' + JSON.stringify([c.check_result.history_probe, r.status]));
  } finally { await X.pg.close(); }
});

// Second independent review (9319a56, 2026-10-18) — P3: the second unknown after a person's resend is not told
test('a person resends an unknown row that had used its five; it is unknown again: a new "unknown" notice is made', async () => {
  const X = await env0();
  try {
    await X.q(`update invoice_settings set value=value||jsonb_build_object('route_since', now() - interval '1 hour') where key='qb'`);
    const a = await X.review('QB2-UNK5', '9401');
    X.G.sendMode = 'timeout';
    await X.post(a.doc); await X.settle();
    let o = await X.row(a.id);
    assert.equal(o.state, 'unknown');
    await X.q(`update invoice_qb_outbox set attempts=5, updated_at=now() where id=$1`, [o.id]);   // its fifth try was the unknown one
    await X.worker(); await X.settle();
    const n1 = (await X.q(`select count(*)::int n from invoice_qb_alerts where kind='unknown'`))[0].n;
    X.G.sent.splice(0);
    assert.equal((await X.api('tok-office', { action: 'qb_resolve', id: o.id, state: 'pending', note: '送信済みに無い' })).status, 200);
    await X.worker(); await X.settle();
    o = await X.row(a.id);
    assert.deepEqual([o.state, o.attempts], ['unknown', 5]);
    const n2 = (await X.q(`select count(*)::int n from invoice_qb_alerts where kind='unknown'`))[0].n;
    assert.equal(n2, n1 + 1, `the second unknown of the same row is told too (alerts before ${n1}, after ${n2})`);
  } finally { await X.pg.close(); }
});

// The sender is set once by SQL (the template; the real address is handed to Moto directly, never written here).
test('the sender SQL: the template stops as it is; an address is kept in lower case once; not changed while this system sends', async () => {
  const X = await env0();
  const tpl = fs.readFileSync(new URL('../db/invoice-qb-sender.sql', import.meta.url), 'utf8');
  const runAs = async sql => { try { await X.pg.exec('reset role;\n' + sql); } finally { await X.pg.exec('set role service_role;'); } };
  const from = async () => (await X.q(`select value->>'from' f, value->>'route' r from invoice_settings where key='qb'`))[0];
  try {
    assert.ok(!/@funergygroup\.com/i.test(tpl), 'no real address in the repository');
    await X.q(`update invoice_settings set value=value||'{"route":"external"}' where key='qb'`);
    const before = await from();
    await assert.rejects(runAs(tpl), /name@example\.com のまま/);
    assert.deepEqual(await from(), before);
    const withAddr = a => tpl.replace("'name@example.com'", "'" + a + "'");
    await runAs(withAddr('  New.Sender@Example.org '));
    assert.equal((await from()).f, 'new.sender@example.org');
    await runAs(withAddr('new.sender@example.org'));
    assert.equal((await X.q(`select count(*)::int n from invoice_events where kind='settings_qb_from'`))[0].n, 1, 'the same address twice is one change');
    await assert.rejects(runAs(withAddr('not an address')), /送り元のメールを入れてください/);
    // while this system sends, the sender does not change (the same address is fine)
    await X.q(`update invoice_settings set value=value||'{"route":"invoice-intake"}' where key='qb'`);
    await assert.rejects(runAs(withAddr('other@example.org')), /送っているあいだは送り元を変えられません/);
    await runAs(withAddr('new.sender@example.org'));
    assert.equal((await from()).f, 'new.sender@example.org');
  } finally { await X.pg.close(); }
});

// The folder Moto runs: the SQL is the repository's migration, the check SQL the repository's postcheck, the function the bundle of
// today's sources; the steps name the files and the order (SQL → check → function → sender → app → connect → switch).
test('deploy folder v1094: the copies are the repository files; the one-file function is today’s sources; the steps in order',
  { skip: process.env.INVOICE_MUTATION_RUN ? 'a mutation run checks behaviour only' : false }, () => {
  const rd = f => fs.readFileSync(new URL('../' + f, import.meta.url));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const D = 'deploy/invoice-qb-gmail-v1094/';
  assert.ok(rd(D + '1_追加のSQL_QuickBooksからすぐ.sql').equals(rd('supabase/migrations/20261026090000_invoice_qb_gmail.sql')));
  assert.ok(rd(D + '2_確認のSQL_読むだけ.sql').equals(rd('db/invoice-intake-postcheck.sql')));
  const src = JSON.parse(rd(D + 'source.json'));
  assert.equal(sha(rd(D + '3_関数_invoice-intake_index.ts')), src.bundle_sha256);
  const want = ['supabase/functions/invoice-intake/index.ts', 'supabase/functions/invoice-intake/handler.mjs',
    ...fs.readdirSync(new URL('../invoice/', import.meta.url)).filter(f => f.endsWith('.mjs')).sort().map(f => 'invoice/' + f)];
  assert.deepEqual(Object.keys(src.sources).sort(), want.sort());
  for (const f of want) assert.equal(src.sources[f], sha(rd(f)), f + ' changed after the bundle was built (build it again)');
  const bundle = rd(D + '3_関数_invoice-intake_index.ts').toString();
  assert.ok(!/^\s*import\s/m.test(bundle) && /Deno\.serve\(createHandler/.test(bundle) && /waitUntil/.test(bundle));
  for (const k of ['invoice_qb_send_context', 'invoice_qb_send_check', 'gmail_connect', 'qb_external_monitor', 'FPQB-ATTEMPT-', 'invoice_link_apply']) assert.ok(bundle.includes(k), k);
  assert.ok(!/oauth2\.googleapis\.com\/revoke/.test(bundle), 'nothing revokes at Google');
  const steps = rd(D + '手順.md').toString();
  for (const f of ['1_追加のSQL_QuickBooksからすぐ.sql', '2_確認のSQL_読むだけ.sql', '3_関数_invoice-intake_index.ts', 'db/invoice-qb-sender.sql',
    'deploy/invoice-item-link-v1093/3_関数_invoice-intake_index.ts', 'qb_gmail＝true', 'qb_external_monitor']) assert.ok(steps.includes(f), f);
  const at = k => { const i = steps.indexOf(k); assert.ok(i >= 0, k); return i; };
  assert.ok(at('1. **Supabase → SQL Editor**') < at('2. `2_確認のSQL') && at('2. `2_確認のSQL') < at('3. **Edge Functions') && at('3. **Edge Functions') < at('4. **送り元**')
    && at('4. **送り元**') < at('5. アプリ v1094 をマージ') && at('5. アプリ v1094 をマージ') < at('6. **Invoice取込 → 設定 → Gmail の接続**')
    && at('6. **Invoice取込 → 設定 → Gmail の接続**') < at('7. **送る担当を切り替える**') && at('7. **送る担当を切り替える**') < at('8. **1 件確かめる**'));
  assert.ok(!/@funergygroup\.com/i.test(steps), 'no real address in the repository');
});
