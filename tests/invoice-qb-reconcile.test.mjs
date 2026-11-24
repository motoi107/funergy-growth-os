// B-3 (Moto 2026-11-23): 照合済み → QuickBooks. Synthetic data only: a stand-in database (PGlite), Drive, AI, Gmail and LINE.
// Nothing here reaches a real database, Google or QuickBooks.
//  * a saved 照合済み (事務Crew, 経理, GM; one or many) asks for the send at once, under the same conditions as before
//  * an invoice of several originals is sent as ONE mail with ONE PDF of its pages in order (route invoice-intake)
//  * no double send (two presses, a retry, the worker), an unknown result is never sent again by itself
//  * taking a reconciliation back stops what has not started; reconciled again, it goes on
//  * the six states for the screen, 「もう一度送る」, and 照合済みだが未転送 with what is known and what is not
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
// pdf-lib (the one the Edge Function imports as npm:pdf-lib@1.17.1): from tests/runtime, or the copy a mutation run names.
const { PDFDocument } = await import(process.env.INVOICE_PDFLIB_MODULE || './runtime/node_modules/pdf-lib/cjs/index.js');
import { joinedName } from '../invoice/pdfjoin.mjs';

// The Gmail test's harness (its stand-in Google, env0) without running its tests.
const harnessUrl = new URL('./invoice-qb-gmail.test.mjs', import.meta.url);
const hsrc = fs.readFileSync(harnessUrl, 'utf8');
const hcut = hsrc.indexOf("test('(10) the mail");
assert.ok(hcut > 0);
const htmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-qb-reconcile-'));
let H;
try {
  const file = path.join(htmp, 'harness.mjs');
  fs.writeFileSync(file, hsrc.slice(0, hcut)
    .replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, q, rel) => JSON.stringify(new URL(rel, harnessUrl).href))
    .replace(/import\.meta\.url/g, JSON.stringify(harnessUrl.href))
    + '\nexport { env0, TO, setup, doc, pdf, docsOf, U, WORKER_KEY };\n');
  H = await import(pathToFileURL(file).href);
} finally { fs.rmSync(htmp, { recursive: true, force: true }); }
const { env0, TO, doc, docsOf } = H;

const envR = (opts = {}) => env0({ ...opts, deps: { PDFDocument, ...(opts.deps || {}) } });
const qbSet = (X, v) => X.q(`update invoice_settings set value=value||$1::jsonb where key='qb'`, [JSON.stringify(v)]);
const gmail = (X, status) => X.q(`update invoice_gmail_auth set status=$1 where id=1`, [status]);
const recon = async (X, tok, driveId, result = 'reconciled', note = '一致', { stale = false } = {}) => {
  const [d] = await docsOf(X, driveId);
  return X.api(tok, { action: 'reconcile', doc_id: d.id, version: d.version - (stale ? 1 : 0), result, note });
};
const states = async (X, tok, driveIds) => {
  const ids = [];
  for (const id of driveIds) ids.push((await docsOf(X, id))[0].id);
  const r = await X.api(tok, { action: 'qb_doc_states', doc_ids: ids });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return ids.map(i => r.body.states[i]);
};
// Posted while the ledger is off (the old state of many invoices): no row; then the ledger is turned on.
async function postedWhileOff(X, list) {
  await qbSet(X, { enabled: false });
  const out = [];
  for (const [tag, no] of list) {
    const r = await X.review(tag, no);
    const p = await X.post(r.doc);
    assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.qb, null);
    out.push(r.id);
  }
  await X.settle();
  assert.equal((await X.q('select count(*)::int n from invoice_qb_outbox'))[0].n, 0);
  await qbSet(X, { enabled: true });
  return out;
}

// Real one-page PDFs (pdf-lib, no object streams so the page count of the intake reads them), each a different width, with the
// tag the stand-in AI looks for.
const realPdf = async (tag, width) => {
  const d = await PDFDocument.create(); d.addPage([width, 400]);
  return Buffer.concat([Buffer.from(await d.save({ useObjectStreams: false })), Buffer.from('\n%' + tag + '\n')]);
};
const S3L = (code, name, qty, price, amount, pack = '12/500G') => [code, name, qty, price, amount, 'CS', pack];
function page(no, date, lines, { pageNo, of, total = null, subtotal = null, tax = '0.00' } = {}) {
  const d = doc(no, date, lines, { tax, marks: [`Page ${pageNo} of ${of}`] });
  d.total = total; d.subtotal = subtotal;
  return d;
}
const vers = (...ds) => Object.fromEntries(ds.map(d => [d.id, d.version]));
// Three pages of one invoice number (the third carries the totals), read one after the other, then merged into one invoice.
async function threePages(X, prefix, no = 'M-66031') {
  const specs = [
    [prefix + '-P1', 100, [S3L('06263', 'SHIRO MISO 12/500G', '2', '60.00', '120.00'), S3L('X1', 'NEW THING', '1', '10.00', '10.00')], {}],
    [prefix + '-P2', 200, [S3L('06263', 'SHIRO MISO 12/500G', '1', '60.00', '60.00')], {}],
    [prefix + '-P3', 300, [S3L('X1', 'NEW THING', '3', '10.00', '30.00')], { subtotal: '220.00', tax: '11.00', total: '231.00' }],
  ];
  const ids = [];
  for (const [i, [tag, width, lines, t]] of specs.entries()) {
    X.fixtures.set(tag, { readable: true, documents: [page(no, '2026-10-11', lines, { pageNo: i + 1, of: 3, ...t })] });
    ids.push(X.drive.file(tag + '.pdf', await realPdf(tag, width), 'U6', { created: `2026-10-06T19:0${i}:00Z` }));
    await X.worker();
  }
  const ds = [];
  for (const id of ids) ds.push((await docsOf(X, id))[0]);
  const mg = await X.api('tok-office', { action: 'merge', docs: ds.map(d => d.id), versions: vers(...ds), reason: '3 枚に分けて撮った' });
  assert.equal(mg.status, 200, JSON.stringify(mg.body));
  const [m] = await docsOf(X, ids[0]);
  return { ids, m };
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

test('B-3 照合済み → QuickBooks: 事務Crew・経理・GM の照合で送信が始まる（反映のときに送れなかった invoice）・同じ invoice は 1 回', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const ids = await postedWhileOff(X, [['RC-1', '8101'], ['RC-2', '8102'], ['RC-3', '8103']]);

    for (const [i, tok] of ['tok-crew', 'tok-office', 'tok-gm'].entries()) {
      const r = await recon(X, tok, ids[i]);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true); assert.equal(r.body.qb_stopped, 0);
      assert.deepEqual(r.body.qb, { queued: 1, sending: true });
      await X.settle();
      assert.equal(X.sentFor(ids[i]), 1);
      const o = await X.row(ids[i]);
      assert.equal(o.state, 'sent'); assert.equal(o.result.trigger, 'reconcile'); assert.equal(o.result.via, 'gmail');
    }
    assert.equal(X.qbSent().length, 3);
    // 照合し直し (the same result again), the worker, a second worker: nothing is sent again.
    const again = await recon(X, 'tok-crew', ids[0]);
    assert.equal(again.status, 200); assert.deepEqual(again.body.qb, { queued: 0, sending: false });
    await X.worker(); await X.worker(); await X.settle();
    assert.equal(X.qbSent().length, 3);
    // Someone without the role: refused, nothing changed.
    const [before] = await docsOf(X, ids[1]);
    assert.equal((await recon(X, 'tok-other', ids[1])).status, 403);
    assert.equal((await docsOf(X, ids[1]))[0].version, before.version);
    assert.equal((await X.api('tok-other', { action: 'qb_doc_states', doc_ids: [before.id] })).status, 403);
    // The six words for the screen: 転送成功 for the three.
    const st = await states(X, 'tok-crew', ids);
    assert.deepEqual(st.map(s => s.state), ['sent', 'sent', 'sent']);
    assert.ok(st.every(s => s.id && s.sent_at && s.manual === false && s.combined === false));
    // A mail Gmail accepted is 送信済み; nothing here says "registered in QuickBooks".
    assert.ok(!/registered|記帳|登録済/.test(JSON.stringify(st)));
  } finally { await X.pg.close(); }
});

test('B-3 まとめて照合: 5 件のうち 1 件は保存できない（古い版）・1 件は送れない（原本が読めない）。保存できた 4 件は送られ、失敗は「もう一度送る」で 1 回', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const ids = await postedWhileOff(X, [['RB-1', '8201'], ['RB-2', '8202'], ['RB-3', '8203'], ['RB-4', '8204'], ['RB-5', '8205']]);
    const bad = ids[2];
    const real = X.drive.download.bind(X.drive);
    let failing = true;
    X.drive.download = async id => { if (id === bad && failing) throw new Error('drive 500'); return real(id); };
    // The screen saves one after the other; one was looked at in an older version.
    const res = [];
    for (const [i, id] of ids.entries()) res.push(await recon(X, 'tok-crew', id, 'reconciled', '一致', { stale: i === 4 }));
    assert.deepEqual(res.map(r => r.status), [200, 200, 200, 200, 409]);
    assert.equal(res[4].body.error, 'conflict');
    await X.settle();
    // 保存成功 4: 転送成功 3, 転送失敗 1 (the original could not be read; nothing sent); the one not saved is not reconciled.
    assert.deepEqual(ids.map(id => X.sentFor(id)), [1, 1, 0, 1, 0]);
    let st = await states(X, 'tok-office', ids.slice(0, 4));
    assert.deepEqual(st.map(s => s.state), ['sent', 'sent', 'failed', 'sent']);
    assert.equal(st[2].last_error, 'drive_download_failed'); assert.equal(st[2].stopped, false);
    // The screen shows 「もう一度送る」 only where the server says a retry is allowed now (a failed try of this system's route).
    assert.equal(st[2].can_retry, true); assert.equal(st[2].route, 'invoice-intake');
    assert.deepEqual([st[0], st[1], st[3]].map(x => x.can_retry), [false, false, false]);
    assert.equal((await docsOf(X, ids[4]))[0].recon_status ?? null, (await docsOf(X, ids[4]))[0].recon_status);
    assert.notEqual((await docsOf(X, ids[4]))[0].recon_status, 'reconciled');
    // 「もう一度送る」 (事務Crew) once the original can be read: sent once, from the retry.
    failing = false;
    const row = await X.row(bad);
    const rt = await X.api('tok-crew', { action: 'qb_retry', id: row.id });
    assert.equal(rt.status, 200, JSON.stringify(rt.body)); assert.equal(rt.body.ok, true); assert.equal(rt.body.sending, true);
    await X.settle();
    assert.equal(X.sentFor(bad), 1);
    assert.equal((await X.row(bad)).result.trigger, 'retry');
    // A sent row is never sent again; someone without the role is refused.
    assert.equal((await X.api('tok-crew', { action: 'qb_retry', id: row.id })).status, 409);
    assert.equal((await X.api('tok-other', { action: 'qb_retry', id: row.id })).status, 403);
    assert.equal(X.qbSent().length, 4);
    // The fifth (posted, its reconciliation not saved) goes with the 5-minute run as before: the reconciliation is when the send
    // starts, not a new condition of it.
    await X.worker(); await X.settle();
    assert.equal(X.qbSent().length, 5); assert.equal(X.sentFor(ids[4]), 1); assert.equal((await X.row(ids[4])).result.trigger, 'worker');
    st = await states(X, 'tok-gm', ids);
    assert.deepEqual(st.map(s => s.state), ['sent', 'sent', 'sent', 'sent', 'sent']);
  } finally { await X.pg.close(); }
});

test('B-3 複数枚の invoice: 3 枚の原本はページの順に 1 つの PDF・1 通で送られる（台帳は 1 行・ページは単独で送られない）', async () => {
  const X = await envR();
  try {
    const { ids, m } = await threePages(X, 'MP');
    const bytesBefore = ids.map(id => Buffer.from(X.drive.items.get(id).bytes));
    const po = await X.api('tok-office', { action: 'post', doc_id: m.id, version: m.version, reason: '経理の確認（業者・invoice番号・金額・店舗）' });
    assert.equal(po.status, 200, JSON.stringify(po.body));
    assert.equal(po.body.file_ids.length, 3);
    assert.deepEqual(po.body.qb, { queued: 1, sending: true });
    await X.settle();
    const sent = X.qbSent();
    assert.equal(sent.length, 1);
    const mail = sent[0];
    const names = ids.map(id => X.drive.items.get(id).name);
    assert.deepEqual(names, ['2026-10-11_VendorA_M-66031_p1.pdf', '2026-10-11_VendorA_M-66031_p2.pdf', '2026-10-11_VendorA_M-66031_p3.pdf']);
    assert.equal(mail.mime.to, TO);
    assert.equal(mail.mime.parts.length, 1);
    assert.equal(mail.mime.parts[0].type, 'application/pdf');
    assert.equal(mail.mime.parts[0].filename, joinedName(names[0]));
    assert.equal(mail.mime.parts[0].filename, '2026-10-11_VendorA_M-66031.pdf');
    const joined = await PDFDocument.load(mail.mime.parts[0].data);
    assert.deepEqual(joined.getPages().map(p => p.getWidth()), [100, 200, 300], 'the pages in page order');
    // One row of the ledger: the key of the three contents in order, the pages recorded.
    const rows = await X.q(`select * from invoice_qb_outbox`);
    assert.equal(rows.length, 1);
    const o = rows[0];
    assert.match(o.sha256, /^multi-[0-9a-f]{64}$/);
    assert.equal(o.sha256, 'multi-' + sha(ids.map(id => sha(X.drive.items.get(id).bytes)).join(',')));
    assert.deepEqual(o.parts.map(p => p.part_no), [1, 2, 3]);
    assert.equal(o.state, 'sent'); assert.equal(o.result.originals, 3); assert.equal(o.result.pdf_pages, 3);
    assert.ok(mail.mime.subject.includes('FPQB-SHA256-' + o.sha256) && mail.mime.subject.includes('FPQB-ATTEMPT-' + o.attempt_key));
    // The originals in Drive are not changed (their names only, by the posting).
    ids.forEach((id, i) => assert.ok(Buffer.from(X.drive.items.get(id).bytes).equals(bytesBefore[i])));
    // Each page and the invoice say 転送成功 (送信済み), combined, 3 pages.
    const st = await states(X, 'tok-crew', ids);
    assert.ok(st.every(s => s.state === 'sent' && s.combined === true && s.pages === 3), JSON.stringify(st));
    // A page is never queued alone, a reconciliation and the worker send nothing more.
    for (const id of ids.slice(1)) {
      const f = (await X.q('select id from invoice_files where drive_file_id=$1', [id]))[0];
      assert.equal((await X.db.rpc('invoice_qb_enqueue', { file_id: f.id })).queued, false);
    }
    assert.deepEqual((await recon(X, 'tok-crew', ids[0])).body.qb, { queued: 0, sending: false });
    // The reconciliation raised the invoice's version: every page is named again at once (not only the first), none waits.
    const waiting = await X.q(`select f.drive_file_id from public.invoice_rename_waiting_all() w join invoice_files f on f.id=w.file_id`);
    assert.deepEqual(waiting.map(w => w.drive_file_id).filter(x => ids.includes(x)), []);
    await X.worker(); await X.settle();
    assert.equal(X.qbSent().length, 1);
  } finally { await X.pg.close(); }
});

test('B-3 二重送信なし: 同じ照合を 2 回同時に押す・「もう一度送る」を 2 回同時に押す → 1 通', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const [a] = await postedWhileOff(X, [['RD-1', '8301']]);
    let gate; X.G.gate = new Promise(r => { gate = r; });
    const [d] = await docsOf(X, a);
    const body = { action: 'reconcile', doc_id: d.id, version: d.version, result: 'reconciled', note: '一致' };
    const [r1, r2] = await Promise.all([X.api('tok-crew', body), X.api('tok-office', body)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const extra = [X.worker(), X.worker()];
    setTimeout(gate, 30);
    await Promise.all(extra); await X.settle();
    assert.equal(X.sentFor(a), 1);
    // A failed send, then two presses of 「もう一度送る」 at the same time: one more try, one mail.
    X.G.gate = null;
    // The second invoice is posted only now (while the ledger is off, as before), so the runs above did not take it.
    await qbSet(X, { enabled: false });
    const rb = await X.review('RD-2', '8302'); assert.equal((await X.post(rb.doc)).status, 200); const b = rb.id;
    await X.settle(); await qbSet(X, { enabled: true });
    // 429 (a refusal that sent nothing): an error to try again (a 5xx would leave it unknown, as test 5 shows).
    X.G.sendMode = '429';
    assert.equal((await recon(X, 'tok-crew', b)).status, 200);
    await X.settle();
    const o = await X.row(b);
    assert.equal(o.state, 'error'); assert.equal(X.sentFor(b), 0);
    X.G.sendMode = 'ok';
    gate = null; X.G.gate = new Promise(r => { gate = r; });
    const [t1, t2] = await Promise.all([X.api('tok-crew', { action: 'qb_retry', id: o.id }), X.api('tok-office', { action: 'qb_retry', id: o.id })]);
    assert.equal(t1.status, 200); assert.equal(t2.status, 200);
    setTimeout(gate, 30);
    await X.settle(); await X.worker(); await X.settle();
    assert.equal(X.sentFor(b), 1);
    assert.equal(X.qbSent().length, 2);
  } finally { await X.pg.close(); }
});

test('B-3 結果確認待ち: 送信の答えが届かない → unknown。自動で送り直さず「もう一度送る」も断る。照合取消は送信中・結果確認待ちを数えるだけ', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const [a] = await postedWhileOff(X, [['RU-1', '8401']]);
    X.G.sendMode = 'timeout';
    assert.equal((await recon(X, 'tok-office', a)).status, 200);
    await X.settle();
    const o = await X.row(a);
    assert.equal(o.state, 'unknown');
    const [s] = await states(X, 'tok-crew', [a]);
    assert.equal(s.state, 'unknown');
    X.G.sendMode = 'ok';
    assert.equal((await X.api('tok-crew', { action: 'qb_retry', id: o.id })).status, 409, 'looked up first (確かめる), never sent again from here');
    await X.worker(); await X.settle();
    assert.equal(X.sentFor(a), 0);
    // 照合取消: the unknown row is not undone (counted as busy), nothing is cancelled.
    const un = await recon(X, 'tok-office', a, 'unreconciled', '');
    assert.equal(un.status, 200, JSON.stringify(un.body));
    assert.equal(un.body.qb_stopped, 0); assert.equal(un.body.qb_busy, 1);
    assert.equal((await X.row(a)).state, 'unknown');
  } finally { await X.pg.close(); }
});

test('B-3 旧経路（external）は今まで通り: 照合で台帳に載るだけ（このシステムは送らない）・複数枚の invoice は台帳の外（multi_file）', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    await qbSet(X, { route: 'external' });
    const [a] = await postedWhileOff(X, [['RE-1', '8501']]);
    const r = await recon(X, 'tok-crew', a);
    assert.equal(r.status, 200); assert.deepEqual(r.body.qb, { queued: 1, sending: false });
    await X.settle(); await X.worker(); await X.settle();
    const o = await X.row(a);
    assert.equal(o.route, 'external'); assert.equal(o.state, 'pending');
    assert.equal(X.qbSent().length, 0);
    assert.equal((await states(X, 'tok-crew', [a]))[0].state, 'queued');
    // 「もう一度送る」 never touches the old route's rows (a failed try there is the forwarder's own, synthetic state here).
    await X.q(`update invoice_qb_outbox set state='error', last_error='x' where id=$1`, [o.id]);
    assert.equal((await X.api('tok-crew', { action: 'qb_retry', id: o.id })).status, 409);
    assert.equal((await X.row(a)).state, 'error');
    await X.q(`update invoice_qb_outbox set state='pending', last_error=null where id=$1`, [o.id]);
    // An invoice of several originals: not in the old route's ledger (as before), the screen says why.
    const { ids, m } = await threePages(X, 'ME', 'M-77001');
    const po = await X.api('tok-office', { action: 'post', doc_id: m.id, version: m.version, reason: '経理の確認' });
    assert.equal(po.status, 200, JSON.stringify(po.body));
    assert.equal((await recon(X, 'tok-crew', ids[0])).status, 200);
    await X.worker(); await X.settle();
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_outbox where parts is not null`))[0].n, 0);
    const [ms] = await states(X, 'tok-crew', [ids[0]]);
    assert.equal(ms.state, 'not_sent'); assert.equal(ms.why, 'multi_file'); assert.equal(ms.pages, 3);
    assert.equal(X.qbSent().length, 0);
  } finally { await X.pg.close(); }
});

test('B-3 照合取消: まだ始まっていない送信は止まり（recon_cancelled）・初めての差異では止めない・照合し直すと 1 回送られる', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const [a, b] = await postedWhileOff(X, [['RX-1', '8601'], ['RX-2', '8602']]);
    await gmail(X, 'expired');                                                     // Gmail not usable: rows wait
    const r = await recon(X, 'tok-office', a);
    assert.equal(r.status, 200); assert.deepEqual(r.body.qb, { queued: 1, sending: false, waiting: 'gmail' });
    assert.equal((await X.row(a)).state, 'pending');
    assert.equal((await states(X, 'tok-crew', [a]))[0].state, 'queued');
    // A first-time 差異あり on an invoice never reconciled keeps the send its posting/queue asked for.
    assert.equal((await X.db.rpc('invoice_qb_enqueue', { file_id: (await X.row(a)).file_id })).queued, false);
    const bq = await X.q(`select id from invoice_files where drive_file_id=$1`, [b]);
    assert.equal((await X.db.rpc('invoice_qb_enqueue', { file_id: bq[0].id })).queued, true);
    const dis = await recon(X, 'tok-office', b, 'discrepancy', '金額が違う');
    assert.equal(dis.status, 200); assert.equal(dis.body.qb_stopped, 0);
    assert.equal((await X.row(b)).state, 'pending');
    // 照合取消 of a reconciled invoice: its waiting row is taken back.
    const un = await recon(X, 'tok-crew', a, 'unreconciled', '');
    assert.equal(un.status, 200); assert.equal(un.body.qb_stopped, 1); assert.equal(un.body.qb_busy, 0);
    let o = await X.row(a);
    assert.equal(o.state, 'cancelled'); assert.equal(o.last_error, 'recon_cancelled');
    const [s] = await states(X, 'tok-crew', [a]);
    assert.equal(s.state, 'not_sent'); assert.equal(s.why, 'recon_cancelled'); assert.equal(s.cancelled, true);
    // Not reconciled now: no 「もう一度送る」, and asking for it anyway changes nothing (reconciling again is what sends it).
    assert.equal(s.can_retry, false); assert.equal(s.cancelled_id, o.id);
    const nr = await X.api('tok-crew', { action: 'qb_retry', id: o.id });
    assert.equal(nr.status, 200); assert.equal(nr.body.ok, false); assert.equal(nr.body.why, 'not_reconciled');
    assert.equal((await X.row(a)).state, 'cancelled');
    // Gmail good again: the worker sends b (posted, not taken back), never a.
    await gmail(X, 'ok');
    await X.worker(); await X.settle();
    assert.equal(X.sentFor(a), 0); assert.equal(X.sentFor(b), 1);
    // Reconciled again: the same row goes on, sent once.
    const re = await recon(X, 'tok-gm', a);
    assert.equal(re.status, 200); assert.deepEqual(re.body.qb, { queued: 1, sending: true });
    await X.settle(); await X.worker(); await X.settle();
    o = await X.row(a);
    assert.equal(o.state, 'sent'); assert.equal(X.sentFor(a), 1);
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_outbox where file_id=$1`, [o.file_id]))[0].n, 1, 'the same row, not a second one');
    // Reconciled again while the ledger is off: nothing is queued then; once it is on, the worker brings the same row back.
    await qbSet(X, { enabled: false });
    const rc = await X.review('RX-3', '8603'); assert.equal((await X.post(rc.doc)).status, 200); const c = rc.id;
    await X.settle(); await qbSet(X, { enabled: true }); await gmail(X, 'expired');
    assert.equal((await recon(X, 'tok-office', c)).status, 200);
    assert.equal((await recon(X, 'tok-office', c, 'unreconciled', '')).body.qb_stopped, 1);
    await qbSet(X, { enabled: false });
    assert.equal((await recon(X, 'tok-office', c)).body.qb, null);
    await qbSet(X, { enabled: true }); await gmail(X, 'ok');
    await X.worker(); await X.settle();
    o = await X.row(c);
    assert.equal(o.state, 'sent'); assert.equal(X.sentFor(c), 1);
    assert.equal((await X.q(`select count(*)::int n from invoice_qb_outbox where file_id=$1`, [o.file_id]))[0].n, 1, 'the same row again');
  } finally { await X.pg.close(); }
});

test('B-3-4 照合済みだが未転送: 理由が分かるもの（confirmed）と分からないもの。一覧は何も送らない・前の転送で送ったものは送信済みで見つけて記録だけ', async () => {
  const X = await envR();
  try {
    await X.q('update invoice_stores set auto_post=false');
    const [off, early, none, waits, gone] = await postedWhileOff(X, [['RN-1', '8701'], ['RN-2', '8702'], ['RN-3', '8703'], ['RN-4', '8704'], ['RN-5', '8705']]);
    const fileOf = async id => (await X.q('select id from invoice_files where drive_file_id=$1', [id]))[0].id;
    // off: reconciled while the ledger was off
    await qbSet(X, { enabled: false });
    assert.equal((await recon(X, 'tok-office', off)).body.qb, null);
    await qbSet(X, { enabled: true });
    // early: an original from before the start (it may have gone by the forwarder before this ledger)
    await X.q(`update invoice_files set drive_created_at='2026-09-01T00:00:00Z' where drive_file_id=$1`, [early]);
    assert.equal((await recon(X, 'tok-office', early)).body.qb.queued, 0);
    // none: reconciled before this release (as the data stands now: nothing in the ledger, nothing explains it)
    await X.q(`update invoice_docs set recon_status='reconciled', recon_by=$2, recon_at=now() where file_id=$1`, [await fileOf(none), 'someone']);
    // waits: Gmail not usable, queued
    await gmail(X, 'expired');
    assert.equal((await recon(X, 'tok-office', waits)).body.qb.queued, 1);
    // gone: the forwarder sent this content before (outside this ledger)
    const gb = X.drive.items.get(gone).bytes;
    const old = X.G.addSent(`FPQB-ID-${gone} FPQB-SHA256-${sha(gb)} | scan.pdf`, { attachments: [{ filename: 'scan.pdf', size: gb.length }] });
    await X.q(`update invoice_docs set recon_status='reconciled', recon_by=$2, recon_at=now() where file_id=$1`, [await fileOf(gone), 'someone']);
    const sentBefore = X.qbSent().length;
    const u = await X.api('tok-crew', { action: 'qb_unsent', from: '2026-01-01' });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(X.qbSent().length, sentBefore, 'looking sends nothing');
    const by = Object.fromEntries(u.body.rows.map(r => [r.drive_file_id, r]));
    assert.deepEqual(Object.keys(by).sort(), [off, early, none, waits, gone].sort());
    // off is ready now (the ledger is on again): nothing in the ledger explains it → unconfirmed; the worker queues it as before.
    assert.equal(by[off].reason, 'not_in_ledger'); assert.equal(by[off].confirmed, false);
    assert.equal(by[early].reason, 'before_since'); assert.equal(by[early].confirmed, false);
    assert.equal(by[none].reason, 'not_in_ledger'); assert.equal(by[none].confirmed, false);
    assert.equal(by[waits].reason, 'queued'); assert.equal(by[waits].confirmed, true);
    assert.equal(by[gone].reason, 'not_in_ledger'); assert.equal(by[gone].confirmed, false);
    assert.ok(u.body.rows.every(r => r.original_url && r.history && r.invoice_no));
    assert.equal((await X.api('tok-other', { action: 'qb_unsent' })).status, 403);
    // With the ledger turned off, the reason is known: qb_off.
    await qbSet(X, { enabled: false });
    const u2 = (await X.api('tok-office', { action: 'qb_unsent', from: '2026-01-01' })).body;
    const by2 = Object.fromEntries(u2.rows.map(r => [r.drive_file_id, r]));
    assert.equal(by2[off].reason, 'qb_off'); assert.equal(by2[off].confirmed, true);
    await qbSet(X, { enabled: true });
    // The worker: the one the forwarder sent is found in the sent mail and recorded, never sent again; the others go once.
    await gmail(X, 'ok');
    await X.worker(); await X.settle();
    const g = await X.row(gone);
    assert.equal(g.state, 'sent'); assert.equal(g.message_id, old); assert.equal(g.result.via, 'gmail_history');
    assert.equal(X.sentFor(gone), 0);
    for (const id of [off, none, waits]) assert.equal(X.sentFor(id), 1, id);
    assert.equal(X.sentFor(early), 0, 'before the start: not sent');
    const u3 = (await X.api('tok-office', { action: 'qb_unsent', from: '2026-01-01' })).body;
    assert.deepEqual(u3.rows.map(r => r.drive_file_id), [early]);
  } finally { await X.pg.close(); }
});

test('B-3 複数枚の invoice のページが前に単独で送られていた → PDF にして送らない（人が手で記録）・送る前にページの中身が変わった → 送らない', async () => {
  const X = await envR();
  try {
    // A page that went alone before (the forwarder, outside this ledger).
    const { ids, m } = await threePages(X, 'MS', 'M-88001');
    const pb = X.drive.items.get(ids[1]).bytes;
    X.G.addSent(`FPQB-ID-${ids[1]} FPQB-SHA256-${sha(pb)} | page2.pdf`, { attachments: [{ filename: 'page2.pdf', size: pb.length }] });
    const po = await X.api('tok-office', { action: 'post', doc_id: m.id, version: m.version, reason: '経理の確認' });
    assert.equal(po.status, 200, JSON.stringify(po.body));
    await X.settle();
    assert.equal(X.qbSent().length, 0);
    const o = (await X.q(`select * from invoice_qb_outbox where parts is not null`))[0];
    assert.equal(o.state, 'cancelled'); assert.equal(o.last_error, 'part_already_sent');
    let [s] = await states(X, 'tok-crew', [ids[0]]);
    assert.equal(s.state, 'not_sent'); assert.equal(s.why, 'part_already_sent'); assert.equal(s.cancelled, true);
    assert.equal(s.can_retry, false); assert.equal(s.cancelled_id, o.id);
    // Neither the worker nor 「もう一度送る」 sends it as one PDF now.
    await X.worker(); await X.settle(); assert.equal(X.qbSent().length, 0);
    const rt = await X.api('tok-crew', { action: 'qb_retry', id: o.id });
    assert.equal(rt.status, 409);
    // Entered in QuickBooks by hand: recorded, the invoice says sent (by hand).
    const [m2] = await docsOf(X, ids[0]);
    const man = await X.api('tok-crew', { action: 'qb_manual', doc_id: m2.id, version: m2.version, note: '手で入れた' });
    assert.equal(man.status, 200, JSON.stringify(man.body));
    [s] = await states(X, 'tok-crew', [ids[0]]);
    assert.equal(s.state, 'sent'); assert.equal(s.manual, true);
    await X.worker(); await X.settle(); assert.equal(X.qbSent().length, 0);

    // Another invoice of pages whose page changes in Drive before it is sent: set aside, nothing sent.
    const Y = await envR();
    try {
      const t = await threePages(Y, 'MC', 'M-88002');
      await gmail(Y, 'expired');
      const p2 = await Y.api('tok-office', { action: 'post', doc_id: t.m.id, version: t.m.version, reason: '経理の確認' });
      assert.equal(p2.status, 200); assert.equal(p2.body.qb.waiting, 'gmail');
      Y.drive.replaceContent(t.ids[2], await realPdf('MC-P3-NEW', 333));
      await gmail(Y, 'ok');
      await Y.worker(); await Y.settle();
      assert.equal(Y.qbSent().length, 0);
      const c = (await Y.q(`select * from invoice_qb_outbox where parts is not null`))[0];
      assert.equal(c.state, 'cancelled'); assert.ok(['content_changed', 'merge_changed'].includes(c.last_error), c.last_error);
    } finally { await Y.pg.close(); }
  } finally { await X.pg.close(); }
});
