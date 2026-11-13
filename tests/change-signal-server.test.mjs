// v1151（「変わった」の合図と変更の記録）の関数 secure-state：サーバーの鍵の書き込みに確かめた人（x-fp-actor・f:'1'）を付ける・
// 変更の記録（change_log）を CEO・GM・経理・事務Crew にだけ返す（Moto さん 11/12 16:32 の ① A・② B）。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, CL_ROLES } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

function setup(o = {}) {
  const W = makeWorld(o);
  let clock = Date.UTC(2026, 10, 13, 10, 0, 0);
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => clock });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j, headers: r.headers };
  };
  return { W, call, handle, now: () => clock, tick: ms => { clock += ms; } };
}
const GM = { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina 試験' };
const CREW = { emp: 'E-1', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Crew 1' };
const OFFICE = { emp: 'E-OF', role: 'office', grade: 0, stores: [], am_stores: [], name: 'Office 1' };
const AM = { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S2'], name: 'Area' };
const dec = h => (h ? JSON.parse(Buffer.from(h, 'base64').toString('utf8')) : null);
const devHdr = o => ({ 'x-fp-actor': Buffer.from(JSON.stringify(o)).toString('base64') });

test('a write by the function carries the person it checked (f:1); the device id and kind are copied only when they look right', async () => {
  const S = setup({ pins: { tGM: GM } });
  S.W.set('bonus_rules', { pool: [1] });
  assert.equal((await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [2] } }, devHdr({ e: 'FAKE', n: 'Someone else', r: 'ceo', d: 'dev-abc123', k: 'iphone' }))).status, 200);
  const [k, h] = S.W.actors.at(-1);
  assert.equal(k, 'bonus_rules');
  assert.deepEqual(dec(h), { e: 'E-GM', n: 'Gina 試験', r: 'gm', f: '1', d: 'dev-abc123', k: 'iphone' }, 'the person is the one the function checked, not the one the app said');
  // the same with an expected row (PATCH)
  const cur = (await S.call({ action: 'get', pin_session: 'tGM', key: 'bonus_rules' })).j;
  await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [3] }, expect: { exists: true, updated_at: cur.updated_at } }, devHdr({ d: '<script>', k: 'toaster' }));
  assert.deepEqual(dec(S.W.actors.at(-1)[1]), { e: 'E-GM', n: 'Gina 試験', r: 'gm', f: '1' }, 'a device id or kind of the wrong shape is left out');
  await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [4] } }, { 'x-fp-actor': '%%%not base64%%%' });
  assert.equal(dec(S.W.actors.at(-1)[1]).e, 'E-GM', 'an unreadable header is ignored');
});

test('the karte PIN, Career Score, the hiring and the personal fields are written with the person too (every app_state write of the function)', async () => {
  const S = setup({ pins: { tGM: GM } });
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '1234' })).status, 200);
  assert.deepEqual(S.W.actors.map(([k, h]) => [k, dec(h).e, dec(h).f]), [['karte_pin', 'E-GM', '1']]);
  // every rest() call that writes app_state in the handler sends the actor header (writeRow's pref / ah, pinStore's fpHdr(a))
  const src = fs.readFileSync(new URL('../supabase/functions/secure-state/handler.mjs', import.meta.url), 'utf8');
  const writes = src.split('\n').filter(l => /rest\('app_state/.test(l) && /method: '(POST|PATCH|DELETE)'/.test(l));
  assert.ok(writes.length >= 5, String(writes.length));
  for (const l of writes) assert.match(l, /headers: (pref|\{ prefer: '[^']+', \.\.\.(ah|fpHdr\(a\)) \})/, l.trim());
  // every caller passes the actor
  assert.ok(!/writeRow\([^)]*\{ exists: false \}\)/.test(src), 'no writeRow without the actor');
  assert.equal((src.match(/await hrRmw\('/g) || []).length, (src.match(/^\s*\}, a\);$/gm) || []).length, 'every hrRmw gets the actor');
});

test('the change log: only CEO・GM・経理・事務Crew; filters and paging; nothing older than a year', async () => {
  assert.deepEqual(CL_ROLES, ['ceo', 'gm', 'office', 'office_crew']);
  const now = Date.UTC(2026, 10, 13, 10, 0, 0), iso = d => new Date(now - d * 86400000).toISOString();
  const changeLog = [
    { id: 1, at: iso(400), last_at: iso(400), src: 'app_state', key: 'meetings', cat: null, by_emp: 'E-1', by_name: 'Crew 1', via: 'app', parts: [], more: false, n: 1 },
    { id: 2, at: iso(3), last_at: iso(3), src: 'app_state', key: 'daily_actuals_F01', cat: null, by_emp: 'E-1', by_name: 'Crew 1', via: 'app', parts: ['2026-11-10'], more: false, n: 2 },
    { id: 3, at: iso(2), last_at: iso(2), src: 'stores', key: 'stores', cat: null, by_emp: 'E-GM', by_name: 'Gina 試験', via: 'app', parts: ['F01'], more: false, n: 1 },
    { id: 4, at: iso(1), last_at: iso(1), src: 'app_state', key: '_secure', cat: 'bonus', by_emp: 'E-GM', by_name: 'Gina 試験', via: 'fn', parts: [], more: false, n: 1 },
    { id: 5, at: iso(0.1), last_at: iso(0.1), src: 'app_state', key: 'daily_actuals_F02', cat: null, by_emp: null, by_name: null, via: 'old', parts: [], more: false, n: 1 },
  ];
  const S = setup({ pins: { tGM: GM, t1: CREW, tOf: OFFICE, tAM: AM }, changeLog, users: { jo: 'aaaaaaaa-0000-0000-0000-000000000001' }, mgr: { 'aaaaaaaa-0000-0000-0000-000000000001': { role: 'office_crew', emp_id: null } } });
  for (const t of ['t1', 'tAM']) assert.equal((await S.call({ action: 'change_log', pin_session: t })).status, 403, t);
  assert.equal(S.W.clReads.length, 0, 'a refused person does not make the server read the log');
  const g = await S.call({ action: 'change_log', pin_session: 'tGM' });
  assert.equal(g.status, 200); assert.equal(g.j.clfn, 1);
  assert.deepEqual(g.j.rows.map(r => r.id), [5, 4, 3, 2], 'the last 7 days, newest first');
  assert.equal((await S.call({ action: 'change_log', pin_session: 'tOf', from: iso(500) })).j.rows.length, 4, 'a year back at most (the 400-day-old row is not returned)');
  assert.equal((await S.call({ action: 'change_log' }, { authorization: 'Bearer ' + JWT('jo') })).status, 200, '事務Crew by email');
  assert.deepEqual((await S.call({ action: 'change_log', pin_session: 'tGM', emp: 'E-1', from: iso(30) })).j.rows.map(r => r.id), [2]);
  assert.deepEqual((await S.call({ action: 'change_log', pin_session: 'tGM', src: 'stores' })).j.rows.map(r => r.id), [3]);
  assert.deepEqual((await S.call({ action: 'change_log', pin_session: 'tGM', q: 'F02' })).j.rows.map(r => r.id), [5]);
  assert.deepEqual((await S.call({ action: 'change_log', pin_session: 'tGM', via: 'old' })).j.rows.map(r => r.id), [5]);
  const p1 = await S.call({ action: 'change_log', pin_session: 'tGM', limit: 2 });
  assert.deepEqual([p1.j.rows.map(r => r.id), p1.j.more], [[5, 4], true]);
  const p2 = await S.call({ action: 'change_log', pin_session: 'tGM', limit: 2, before: 4 });
  assert.deepEqual(p2.j.rows.map(r => r.id), [3, 2]);
  for (const bad of [{ from: 'yesterday' }, { to: 12 }, { src: 'manager_auth' }, { via: 'x' }, { q: "a'b" }, { q: 'x'.repeat(41) }, { emp: 'x'.repeat(65) }, { before: -1 }, { before: 1.5 }, { from: iso(1), to: iso(3) }]) {
    assert.equal((await S.call({ action: 'change_log', pin_session: 'tGM', ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.ok(S.W.clReads.every(q => !/value|amount/.test(q)), 'the function reads the log columns only');
});

test('CORS lets the app send x-fp-actor; every answer has clfn:1', async () => {
  const S = setup({ pins: { tGM: GM } });
  const r = await S.handle(new Request('https://fn.test/secure-state', { method: 'OPTIONS', headers: { origin: 'https://funergy-plus.com' } }));
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-headers'), /x-fp-actor/);
  assert.equal((await S.call({ action: 'pull', pin_session: 'nope' })).j.clfn, 1);
});
