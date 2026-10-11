// The production adapters (Google Drive, Anthropic, PostgREST) and the HTTP edge of the
// Edge Function, checked against recorded requests. No network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, googleAccessToken } from '../invoice/drive.mjs';
import { callModel } from '../invoice/extract.mjs';
import { createHandler, postgrestDb } from '../supabase/functions/invoice-intake/handler.mjs';

function recorder(responder) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return responder(String(url), init, calls.length); };
  return { calls, fetch };
}

test('Google token refresh and Drive requests: scoped queries, shared-drive flags, one retry on 401, no delete', async () => {
  let tokens = 0;
  const { calls, fetch } = recorder((url, init, n) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) { tokens++; return Response.json({ access_token: 'tok' + tokens }); }
    if (n === 2) return new Response('{}', { status: 401 });            // first Drive call: expired token
    if (init.method === 'PATCH') return Response.json({ id: 'F1', name: 'new.pdf' });
    return Response.json({ files: [{ id: 'F1', name: "O'Brien.pdf" }], nextPageToken: null });
  });
  const getToken = () => googleAccessToken({ fetch, clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rt' });
  const d = createDrive({ fetch, getToken });
  const r = await d.listFolder("U6'x", null);
  assert.equal(r.files.length, 1); assert.equal(tokens, 2);
  const li = calls.findIndex(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?'));
  const list = new URL(calls[li].url);
  assert.equal(list.searchParams.get('q'), "'U6\\'x' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'");
  assert.equal(list.searchParams.get('supportsAllDrives'), 'true'); assert.equal(list.searchParams.get('includeItemsFromAllDrives'), 'true');
  assert.equal(list.searchParams.get('corpora'), null);                 // My Drive folder: default corpus
  assert.equal(calls[li].init.headers.authorization, 'Bearer tok2');
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'rt');
  // The store folder itself is listed only from the start (Moto 2026-10-08); the time is written by the adapter, never passed through.
  await d.listFolder('R6', null, { createdAfter: '2026-10-07T19:40:00Z' });
  assert.equal(new URL(calls.at(-1).url).searchParams.get('q'),
    "'R6' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and createdTime >= '2026-10-07T19:40:00.000Z'");
  await assert.rejects(d.listFolder('R6', null, { createdAfter: "x' or '1'='1" }), /bad_value/);
  await d.findFolders('R6', "Kaimuki's");
  assert.match(new URL(calls.at(-1).url).searchParams.get('q'), /name='Kaimuki\\'s'/);
  await d.update('F1', { name: 'new.pdf', addParents: 'T', removeParents: 'U6' });
  const up = new URL(calls.at(-1).url);
  assert.equal(calls.at(-1).init.method, 'PATCH'); assert.equal(up.searchParams.get('addParents'), 'T'); assert.equal(up.searchParams.get('removeParents'), 'U6');
  assert.equal(JSON.parse(calls.at(-1).init.body).name, 'new.pdf');
  assert.equal(typeof d.delete, 'undefined'); assert.equal(typeof d.trash, 'undefined');
  assert.ok(calls.every(c => !/method":"DELETE"/.test(JSON.stringify(c.init)) && c.init.method !== 'DELETE'));
  assert.deepEqual(await googleAccessToken({ fetch, clientId: '', clientSecret: '', refreshToken: '' }), { ok: false, error: 'drive_not_configured' });
});

test('Folders in a shared drive are listed with corpora=drive and the drive id (looked up once per folder)', async () => {
  const { calls, fetch } = recorder(url => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 't' });
    if (/\/files\/U7\?/.test(url) || /\/files\/R7\?/.test(url)) return Response.json({ id: 'x', driveId: 'SD-1' });
    return Response.json({ files: [], nextPageToken: null });
  });
  const d = createDrive({ fetch, getToken: () => googleAccessToken({ fetch, clientId: 'c', clientSecret: 's', refreshToken: 'r' }) });
  await d.listFolder('U7', null); await d.listFolder('U7', null);
  await d.findFolders('R7', '2026'); await d.listNames('R7');
  const lists = calls.filter(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?')).map(c => new URL(c.url));
  assert.equal(lists.length, 4);
  assert.ok(lists.every(u => u.searchParams.get('corpora') === 'drive' && u.searchParams.get('driveId') === 'SD-1' && u.searchParams.get('supportsAllDrives') === 'true'));
  assert.equal(calls.filter(c => /\/files\/(U7|R7)\?fields=id%2CdriveId|\/files\/(U7|R7)\?fields=id,driveId/.test(c.url)).length, 2);   // one lookup per folder
});

test('Anthropic call: key only in the header, temperature 0, PDF as a document, failures classified, key never echoed', async () => {
  const { calls, fetch } = recorder(() => Response.json({ content: [{ type: 'text', text: '{"readable":true,"documents":[{"doc_type":"invoice","total":"1.00","lines":[]}]}' }], stop_reason: 'end_turn' }));
  const r = await callModel({ fetch, apiKey: 'sk-secret', model: 'claude-sonnet-4-6', parts: [{ mime: 'application/pdf', base64: 'JVBERi0=' }] });
  assert.equal(r.ok, true); assert.equal(r.documents[0].total, '1.00');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-secret');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.temperature, 0); assert.equal(sent.messages[0].content[0].type, 'document');
  assert.ok(!calls[0].init.body.includes('sk-secret'));
  const busy = await callModel({ fetch: async () => new Response('{"error":"overloaded"}', { status: 529 }), apiKey: 'sk-secret', model: 'm', parts: [{ mime: 'image/png', base64: 'iVBO' }] });
  assert.deepEqual([busy.ok, busy.retryable], [false, true]); assert.ok(!JSON.stringify(busy).includes('sk-secret'));
  const bad = await callModel({ fetch: async () => new Response('{}', { status: 400 }), apiKey: 'k', model: 'm', parts: [{ mime: 'image/png', base64: 'iVBO' }] });
  assert.deepEqual([bad.ok, bad.retryable], [false, false]);
  assert.equal((await callModel({ fetch, apiKey: '', model: 'm', parts: [{ mime: 'image/png', base64: 'x' }] })).error, 'ai_not_configured');
});

test('database calls go to named invoice RPCs with one JSON argument', async () => {
  const { calls, fetch } = recorder(() => Response.json({ ok: true }));
  const db = postgrestDb({ fetch, url: 'https://db.test', key: 'service' });
  assert.deepEqual(await db.rpc('invoice_health', { a: 1 }), { ok: true });
  assert.equal(calls[0].url, 'https://db.test/rest/v1/rpc/invoice_health');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p: { a: 1 } });
  await assert.rejects(() => db.rpc('bot_case_write', {}), /bad_rpc/);
  await assert.rejects(() => db.rpc('invoice_x;drop', {}), /bad_rpc/);
  const failing = postgrestDb({ fetch: async () => new Response('{"message":"forbidden","code":"P0001"}', { status: 400 }), url: 'https://db.test', key: 'k' });
  await assert.rejects(() => failing.rpc('invoice_list', {}), /^Error: forbidden$/);
});

test('HTTP edge: origin allow-list, preflight, method, size, unknown action and worker key', async () => {
  const db = { rpc: async (name) => (name === 'invoice_worker_key' ? { key: 'k'.repeat(32), enabled: true } : null) };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'anon' })[k];
  const h = createHandler({ env, db, fetch: async () => new Response('{}', { status: 401 }), drive: {}, ai: async () => ({}) });
  const req = (init) => h(new Request('https://fn.test', init));
  assert.equal((await req({ method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}' })).status, 403);
  const pre = await req({ method: 'OPTIONS', headers: { origin: 'https://funergy-plus.com' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://funergy-plus.com');
  assert.equal((await req({ method: 'GET' })).status, 405);
  assert.equal((await req({ method: 'POST', body: 'x'.repeat(200001) })).status, 413);
  assert.equal((await req({ method: 'POST', body: '{"action":"nope"}' })).status, 400);
  assert.equal((await req({ method: 'POST', body: '{"action":"list"}' })).status, 401);
  assert.equal((await req({ method: 'POST', headers: { authorization: 'Bearer anon' }, body: '{"action":"list"}' })).status, 401);   // the public key is not a person
  assert.equal((await req({ method: 'POST', headers: { 'x-invoice-worker-key': 'k'.repeat(31) + 'x' }, body: '{"action":"worker"}' })).status, 401);
  const off = createHandler({ env, db: { rpc: async () => ({ key: 'k'.repeat(32), enabled: false }) }, fetch: async () => new Response('{}'), drive: {}, ai: async () => ({}) });
  assert.equal((await off(new Request('https://fn.test', { method: 'POST', headers: { 'x-invoice-worker-key': 'k'.repeat(32) }, body: '{"action":"worker"}' }))).status, 401);
});
