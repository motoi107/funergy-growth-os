// v1157 Google の口コミ。本物の SQL（PGlite）と本物の handler、偽の Google（Places・OAuth・Business Profile）、合成データだけ。
// だれか（work-requests の whoami）は代わり（'pin-E2' は GM・'pin-E8' は Crew・'store-S1' は店のタブレット＝断る）。仕様：docs/GOOGLE_REVIEWS_V1157_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHandler, hstYm, hstPrevMonthStart } from '../supabase/functions/google-reviews/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const NOW0 = Date.parse('2026-11-13T20:00:00Z');   // ハワイ 11/13 10:00
const PEOPLE = { E1: ['ceo', 'Cora CEO'], E2: ['gm', 'Gabe GM'], E5: ['am', 'Ami Area'], E8: ['crew', 'Cam Crew'], E6: ['sl', 'Sam Store'] };
const PID1 = 'ChIJ_fake_place_one_0001', PID2 = 'ChIJ_fake_place_two_0002';
const LOC1 = 'locations/111', LOC2 = 'locations/222', ACC = 'accounts/900';
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 偽の Google。g.* を試験の中で変える
function fakeGoogle() {
  const g = {
    calls: [], wr: 200, onReviews: null, placesStatus: 200, accountsStatus: 200, reviewsStatus: 200, tokenRefresh: 'ok',
    scope: 'https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email',
    refreshToken: 'rt-secret-ABCDEFGHIJ', challenges: new Map(), reviews: { [LOC1]: [], [LOC2]: [] }, pageSize: 50,
    place: { id: PID1, displayName: { text: 'Fake Ramen One' }, formattedAddress: '1 Fake St', rating: 4.36, userRatingCount: 812,
      googleMapsUri: 'https://maps.google.com/?cid=1', reviews: [
        { rating: 5, originalText: { text: 'great' }, publishTime: '2026-11-10T01:00:00Z', authorAttribution: { displayName: 'A B', uri: 'https://www.google.com/maps/contrib/1' } },
        { rating: 2, text: { text: 'slow \u0007service' }, publishTime: '2026-11-09T01:00:00Z', authorAttribution: { displayName: 'C D', uri: 'javascript:alert(1)' } },
      ] },
  };
  g.fetch = async (u, init = {}) => {
    const url = String(u); g.calls.push(url);
    const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://places.googleapis.com/v1/places:searchText')) {
      if (g.placesStatus !== 200) return J({ error: {} }, g.placesStatus);
      assert.ok(init.headers['X-Goog-Api-Key']); assert.match(init.headers['X-Goog-FieldMask'], /places\.id/);
      return J({ places: [{ id: PID1, displayName: { text: 'Fake Ramen One' }, formattedAddress: '1 Fake St', rating: 4.4, userRatingCount: 812 },
        { id: 'bad id!', displayName: { text: 'x' } }, { id: PID2, displayName: { text: 'Fake Two' } }] });
    }
    if (url.startsWith('https://places.googleapis.com/v1/places/')) {
      if (g.placesStatus !== 200) return J({ error: {} }, g.placesStatus);
      assert.match(init.headers['X-Goog-FieldMask'], /reviews/);
      return J(g.place);
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        const ch = b64u(crypto.createHash('sha256').update(p.get('code_verifier')).digest());
        if (g.challenges.get(p.get('code')) !== ch) return J({ error: 'invalid_grant' }, 400);
        return J({ access_token: 'at-1', refresh_token: g.refreshToken || undefined, scope: g.scope });
      }
      if (g.tokenRefresh === 'revoked') return J({ error: 'invalid_grant' }, 400);
      if (g.tokenRefresh === 'down') return J({}, 500);
      return J({ access_token: 'at-2' });
    }
    if (url === 'https://oauth2.googleapis.com/tokeninfo') return J({ email: 'owner@example.test' });
    if (url === 'https://db.test/functions/v1/work-requests') {   // だれか（代わりを使わない試験だけ）
      if (g.wr === 'throw') throw new Error('network');
      if (g.wr !== 200) return J({ error: 'x' }, g.wr);
      const tok = JSON.parse(init.body).pin_session; g.wrSeen = { tok, apikey: init.headers.apikey };
      const m2 = /^pin-(E\d+)$/.exec(tok);
      return m2 && PEOPLE[m2[1]] ? J({ me: { emp: m2[1], role: PEOPLE[m2[1]][0], name: PEOPLE[m2[1]][1] } }) : J({ error: 'unauthorized' }, 401);
    }
    if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) {
      if (g.accountsStatus !== 200) return J({ error: {} }, g.accountsStatus);
      return J({ accounts: [{ name: ACC }, { name: 'bad' }] });
    }
    if (url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/' + ACC + '/locations')) {
      if (g.accountsStatus !== 200) return J({ error: {} }, g.accountsStatus);
      return J({ locations: [{ name: LOC1, title: 'Fake Ramen One', storefrontAddress: { addressLines: ['1 Fake St'], locality: 'Honolulu' } }, { name: LOC2, title: 'Fake Two' }] });
    }
    const m = /^https:\/\/mybusiness\.googleapis\.com\/v4\/(accounts\/\d+)\/(locations\/\d+)\/reviews\?(.*)$/.exec(url);
    if (m) {
      if (g.reviewsStatus !== 200) return J({ error: {} }, g.reviewsStatus);
      if (g.onReviews) await g.onReviews(m[2]);
      const q = new URLSearchParams(m[3]);
      const all = [...(g.reviews[m[2]] || [])].sort((a, b) => Date.parse(b.updateTime) - Date.parse(a.updateTime));
      const start = Number(q.get('pageToken') || 0), page = all.slice(start, start + g.pageSize);
      const avg = all.length ? all.reduce((s, r) => s + ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].indexOf(r.starRating), 0) / all.length : undefined;
      return J({ reviews: page, averageRating: avg, totalReviewCount: all.length, nextPageToken: start + g.pageSize < all.length ? String(start + g.pageSize) : undefined });
    }
    return J({ error: 'unknown ' + url }, 404);
  };
  return g;
}
const rv = (loc, n, star, created, extra = {}) => ({ name: `${ACC}/${loc}/reviews/r${n}`, starRating: star, comment: 'comment ' + n, createTime: created,
  updateTime: extra.updated || created, reviewer: { displayName: 'Guest ' + n, isAnonymous: !!extra.anon }, ...(extra.reply ? { reviewReply: { comment: 'thanks' } } : {}) });

async function setup({ sql = true, env = {}, whoami, realWho = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  if (sql) await pg.exec(SQL);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const g = fakeGoogle();
  let t = NOW0;
  const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', GOOGLE_PLACES_API_KEY: 'places-key-xyz',
    GBP_OAUTH_CLIENT_ID: 'cid', GBP_OAUTH_CLIENT_SECRET: 'csecret', ...env };
  const handler = createHandler({ env: k => ENV[k], db, fetch: g.fetch, now: () => t,
    whoami: realWho ? undefined : whoami || (async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m && PEOPLE[m[1]] ? { emp: m[1], role: PEOPLE[m[1]][0], name: PEOPLE[m[1]][1] } : null; }) });
  const call = async (who, body, headers = {}) => {
    const r = await handler(new Request('https://fn.test/google-reviews', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://funergy-plus.com', ...headers },
      body: JSON.stringify(who ? { pin_session: who.startsWith('store') ? who : 'pin-' + who, ...body } : body) }));
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, text };
  };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, (who || '') + ' ' + body.action + ' ' + r.text); return r.body; };
  const get = async qs => handler(new Request('https://fn.test/google-reviews?' + qs, { method: 'GET' }));
  const key = async () => { await pg.exec('reset role'); const k = (await pg.query('select worker_key from public.gr_settings')).rows[0].worker_key; await pg.exec('set role service_role'); return k; };
  const worker = async k => call(null, { action: 'worker' }, { 'x-gr-worker-key': k, origin: '' });
  // GM が Business Profile をつなぐ（Google の画面の代わり：state と challenge を受け取り、code を返す）
  const connect = async (who = 'E2') => {
    const u = new URL((await ok(who, { action: 'bp_connect' })).url);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const code = 'code-' + crypto.randomUUID();
    g.challenges.set(code, u.searchParams.get('code_challenge'));
    const r = await get('state=' + encodeURIComponent(u.searchParams.get('state')) + '&code=' + code);
    return { r, state: u.searchParams.get('state'), url: u, back: new URL(r.headers.get('location')).searchParams.get('google_bp') };
  };
  return { pg, db, g, call, ok, get, key, worker, connect, setNow: v => { t = v; } };
}

test('the SQL runs twice; the public keys cannot read any table or run any function; functions run as the caller', async () => {
  const { pg } = await setup();
  await pg.exec('reset role'); await pg.exec(SQL);
  const tables = (await pg.query(`select tablename from pg_tables where schemaname='public' and tablename like 'gr\\_%' order by 1`)).rows.map(r => r.tablename);
  assert.deepEqual(tables, ['gr_bp', 'gr_bp_loc', 'gr_oauth', 'gr_places', 'gr_reviews', 'gr_runs', 'gr_settings']);
  for (const t of tables) assert.equal((await pg.query(`select relrowsecurity r from pg_class where relname=$1`, [t])).rows[0].r, true, t);
  const fns = (await pg.query(`select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public' and proname like 'gr\\_%'`)).rows;
  assert.equal(fns.length, 20);
  assert.ok(fns.every(f => !f.prosecdef), 'security invoker');
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`);
    for (const t of tables) await assert.rejects(pg.query(`select * from public.${t}`), /permission denied/, role + ' ' + t);
    for (const f of ['gr_kpi', 'gr_status', 'gr_worker_key', 'gr_bp_creds', 'gr_reviews_put']) await assert.rejects(pg.query(`select public.${f}('{}'::jsonb)`), /permission denied/, role + ' ' + f);
    await pg.exec('reset role');
  }
  // 20 の関数のどれも、公開の鍵では呼べない（PUBLIC も）・サーバーの鍵だけ
  const sigs = (await pg.query(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public' and proname like 'gr\\_%'`)).rows.map(r => r.sig);
  assert.equal(sigs.length, 20);
  for (const sig of sigs) {
    for (const role of ['anon', 'authenticated']) assert.equal((await pg.query(`select has_function_privilege($1, $2, 'execute') v`, [role, sig])).rows[0].v, false, role + ' ' + sig);
    assert.equal((await pg.query(`select has_function_privilege('service_role', $1, 'execute') v`, [sig])).rows[0].v, true, sig);
  }
  // Google の決まり：Places から残すのは店と place ID だけ（評価・件数・口コミの列は無い）
  const cols = (await pg.query(`select column_name from information_schema.columns where table_name='gr_places' order by ordinal_position`)).rows.map(r => r.column_name);
  assert.deepEqual(cols, ['store_id', 'place_id', 'set_emp', 'set_name', 'set_at']);
  assert.equal((await pg.query('select count(*)::int n from public.gr_settings')).rows[0].n, 1);
  assert.match((await pg.query('select worker_key from public.gr_settings')).rows[0].worker_key, /^[0-9a-f]{64}$/);
});

test('who: no mark / a store tablet → 401; work-requests down → 503; crew reads but cannot set or connect; before the SQL → gr_missing', async () => {
  const { call } = await setup();
  assert.equal((await call(null, { action: 'kpi' })).status, 401);
  assert.equal((await call('store-S1', { action: 'kpi' })).status, 401);
  assert.equal((await call('E8', { action: 'kpi' })).status, 200);
  assert.equal((await call('E8', { action: 'status' })).status, 200);
  for (const action of ['places_set', 'places_search', 'bp_connect', 'bp_locations', 'bp_link', 'bp_disconnect', 'sync_now'])
    assert.deepEqual([(await call('E8', { action, store: 'S1', place_id: PID1, q: 'ramen' })).status], [403], action);
  assert.equal((await call('E5', { action: 'places_set', store: 'S1', place_id: PID1 })).status, 403, 'AM cannot set either');
  assert.equal((await call('E8', { action: 'nope' })).status, 400);
  const down = await setup({ whoami: async () => { throw new Error('down'); } });
  assert.deepEqual([(await down.call('E8', { action: 'kpi' })).status, (await down.call('E8', { action: 'kpi' })).body.error], [503, 'auth_unavailable']);
  const before = await setup({ sql: false });
  const r = await before.call('E8', { action: 'kpi' });
  assert.deepEqual([r.status, r.body.error], [503, 'gr_missing']);
  // ほかのサイトからは断る
  const o = await call('E8', { action: 'kpi' }, { origin: 'https://evil.example' });
  assert.equal(o.status, 403);
});

test('who through work-requests itself (no stand-in): down / cannot check → 503; refused → 401; a person → 200 with the PIN mark and the public key', async () => {
  const s = await setup({ realWho: true });
  s.g.wr = 503;
  assert.deepEqual(await s.call('E8', { action: 'kpi' }).then(r => [r.status, r.body.error]), [503, 'auth_unavailable']);
  s.g.wr = 'throw';
  assert.deepEqual(await s.call('E8', { action: 'kpi' }).then(r => [r.status, r.body.error]), [503, 'auth_unavailable']);
  s.g.wr = 401;
  assert.equal((await s.call('E2', { action: 'kpi' })).status, 401);
  s.g.wr = 200;
  assert.equal((await s.call('E8', { action: 'kpi' })).status, 200, 'the failure is not remembered');
  assert.deepEqual(s.g.wrSeen, { tok: 'pin-E8', apikey: 'anon' });
  assert.equal((await s.call('E1', { action: 'bp_connect' })).status, 200, 'CEO');
  assert.equal((await s.call('E8', { action: 'bp_connect' })).status, 403, 'crew');
  assert.equal((await s.call('store-S1', { action: 'kpi' })).status, 401, 'the store tablet');
});

test('places: GM sets the place; anyone reads it live; nothing but the place ID is kept; keys and limits', async () => {
  const { pg, g, call, ok } = await setup();
  const s = await ok('E2', { action: 'places_search', q: 'fake ramen' });
  assert.deepEqual(s.items.map(x => x.place_id), [PID1, PID2], 'bad ids dropped');
  assert.equal((await call('E2', { action: 'places_set', store: 'S1', place_id: 'short' })).status, 400);
  assert.equal((await call('E2', { action: 'places_set', store: 'S 1', place_id: PID1 })).status, 400);
  await ok('E2', { action: 'places_set', store: 'S1', place_id: PID1 });
  assert.deepEqual(await ok('E8', { action: 'places_now', store: 'S2' }), { store: 'S2', linked: false });
  const n = await ok('E8', { action: 'places_now', store: 'S1' });
  assert.equal(n.rating, 4.4); assert.equal(n.count, 812); assert.equal(n.reviews.length, 2);
  assert.equal(n.reviews[1].text, 'slow service', 'control characters removed');
  assert.equal(n.reviews[1].author_uri, '', 'only https links');
  assert.equal(n.reviews[0].author_uri, 'https://www.google.com/maps/contrib/1');
  assert.ok(!JSON.stringify(n).includes('places-key-xyz'), 'the key never goes out');
  // Google が多く返しても 5 件まで
  const keep = g.place.reviews;
  g.place.reviews = Array.from({ length: 7 }, (_, i) => ({ rating: 4, text: { text: 'r' + i }, publishTime: `2026-11-0${i + 1}T01:00:00Z`, authorAttribution: { displayName: 'P' + i } }));
  assert.equal((await ok('E1', { action: 'places_now', store: 'S1' })).reviews.length, 5);
  g.place.reviews = keep;
  // 残っているのは place ID だけ
  await pg.exec('reset role');
  const kept = (await pg.query('select * from public.gr_places')).rows;
  assert.deepEqual(kept.map(r => [r.store_id, r.place_id, r.set_emp, r.set_name]), [['S1', PID1, 'E2', 'Gabe GM']]);
  for (const t of ['gr_reviews', 'gr_bp_loc']) assert.equal((await pg.query(`select count(*)::int n from public.${t}`)).rows[0].n, 0, t);
  await pg.exec('set role service_role');
  const st = await ok('E8', { action: 'status' });
  assert.equal(st.stores.S1.place, true); assert.equal(st.stores.S1.place_id, null, 'crew does not see the ID');
  assert.equal((await ok('E2', { action: 'status' })).stores.S1.place_id, PID1);
  // Google が断る
  g.placesStatus = 403; assert.deepEqual([(await call('E8', { action: 'places_now', store: 'S1' })).body.error], ['places_denied']);
  g.placesStatus = 404; assert.deepEqual([(await call('E8', { action: 'places_now', store: 'S1' })).body.error], ['place_not_found']);
  g.placesStatus = 200;
  // 1 人 1 分に 30 回まで
  let last;
  for (let i = 0; i < 30; i++) last = await call('E6', { action: 'places_now', store: 'S1' });
  assert.equal(last.status, 200);
  assert.deepEqual([(await call('E6', { action: 'places_now', store: 'S1' })).status], [429]);
  assert.equal((await call('E8', { action: 'places_now', store: 'S1' })).status, 200, 'another person is not limited');
  // 外す
  await ok('E2', { action: 'places_set', store: 'S1', place_id: null });
  assert.deepEqual(await ok('E8', { action: 'places_now', store: 'S1' }), { store: 'S1', linked: false });
  // 鍵が無い
  const nokey = await setup({ env: { GOOGLE_PLACES_API_KEY: '' } });
  assert.deepEqual([(await nokey.call('E8', { action: 'places_now', store: 'S1' })).status, (await nokey.call('E8', { action: 'places_now', store: 'S1' })).body.error], [503, 'places_not_configured']);
});

test('connect: PKCE and state; the state works once and for 10 minutes; the refresh token never goes out; pending until Google approves', async () => {
  const s = await setup();
  s.g.accountsStatus = 403;   // 審査待ち
  const c = await s.connect();
  assert.equal(c.r.status, 302);
  assert.equal(c.back, 'pending');
  assert.match(c.r.headers.get('location'), /^https:\/\/funergy-plus\.com\/\?google_bp=pending$/);
  assert.match(c.url.searchParams.get('scope'), /business\.manage/);
  assert.equal(c.url.searchParams.get('access_type'), 'offline');
  // 同じ state はもう使えない
  const again = await s.get('state=' + encodeURIComponent(c.state) + '&code=x');
  assert.equal(new URL(again.headers.get('location')).searchParams.get('google_bp'), 'bad_state');
  const st = await s.ok('E2', { action: 'status' });
  assert.equal(st.bp.status, 'pending'); assert.equal(st.bp.connected, true); assert.equal(st.bp.account, 'owner@example.test');
  const crew = await s.ok('E8', { action: 'status' });
  assert.equal(crew.bp.account, null, 'crew does not see the account');
  for (const who of ['E2', 'E8']) for (const action of ['status', 'kpi', 'whoami']) {
    const t = (await s.call(who, { action })).text;
    assert.ok(!t.includes('rt-secret') && !t.includes('csecret'), who + ' ' + action);
  }
  // 10 分を過ぎた state
  const u = new URL((await s.ok('E2', { action: 'bp_connect' })).url);
  await s.pg.exec('reset role'); await s.pg.query(`update public.gr_oauth set created_at = now() - interval '11 minutes'`); await s.pg.exec('set role service_role');
  const old = await s.get('state=' + encodeURIComponent(u.searchParams.get('state')) + '&code=x');
  assert.equal(new URL(old.headers.get('location')).searchParams.get('google_bp'), 'bad_state');
  // 知らない state・断られた・refresh token が来ない・許可が足りない
  assert.equal(new URL((await s.get('state=nope&code=x')).headers.get('location')).searchParams.get('google_bp'), 'bad_state');
  const u2 = new URL((await s.ok('E2', { action: 'bp_connect' })).url);
  assert.equal(new URL((await s.get('state=' + encodeURIComponent(u2.searchParams.get('state')) + '&error=access_denied')).headers.get('location')).searchParams.get('google_bp'), 'denied');
  s.g.refreshToken = ''; assert.equal((await s.connect()).back, 'no_refresh_token');
  s.g.refreshToken = 'rt-secret-ABCDEFGHIJ'; s.g.scope = 'https://www.googleapis.com/auth/userinfo.email'; assert.equal((await s.connect()).back, 'scope_missing');
  // 鍵の設定が無ければつなげない
  const nocfg = await setup({ env: { GBP_OAUTH_CLIENT_ID: '', GBP_OAUTH_CLIENT_SECRET: '' } });
  assert.deepEqual([(await nocfg.call('E2', { action: 'bp_connect' })).status], [503]);
  // Gmail の取込と同じクライアントでもよい
  const gm = await setup({ env: { GBP_OAUTH_CLIENT_ID: '', GBP_OAUTH_CLIENT_SECRET: '', GMAIL_OAUTH_CLIENT_ID: 'gcid', GMAIL_OAUTH_CLIENT_SECRET: 'gsec' } });
  assert.match((await gm.ok('E2', { action: 'bp_connect' })).url, /client_id=gcid/);
  // GET は state が無ければ 405
  assert.equal((await s.get('x=1')).status, 405);
});

test('daily sync: reviews by Hawaii month, all of them kept, again is the same; pending / revoked / wrong key', async () => {
  const s = await setup();
  const c = await s.connect();
  assert.equal(c.back, 'ok');
  const locs = await s.ok('E2', { action: 'bp_locations' });
  assert.deepEqual(locs.items.map(x => [x.account, x.location, x.title]), [[ACC, LOC1, 'Fake Ramen One'], [ACC, LOC2, 'Fake Two']]);
  assert.equal(locs.items[0].address, '1 Fake St, Honolulu');
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1, title: 'Fake Ramen One' });
  assert.deepEqual([(await s.call('E2', { action: 'bp_link', store: 'S2', account: ACC, location: LOC1 })).status], [409], 'one location, one store');
  await s.ok('E2', { action: 'bp_link', store: 'S2', account: ACC, location: LOC2 });
  // ハワイの 10/31 23:00 は 10 月（UTC では 11/1）。前の月の初めより古いものは取らない
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'FIVE', '2026-11-05T02:00:00Z'), rv(LOC1, 2, 'ONE', '2026-11-01T09:00:00Z', { reply: true }), rv(LOC1, 3, 'THREE', '2026-10-20T00:00:00Z', { anon: true }),
    rv(LOC1, 4, 'FOUR', '2026-09-20T00:00:00Z'), rv(LOC1, 5, 'TWO', '2026-08-01T12:00:00Z', { updated: '2026-11-02T00:00:00Z' })];
  s.g.reviews[LOC2] = Array.from({ length: 120 }, (_, i) => rv(LOC2, 100 + i, 'FOUR', new Date(Date.parse('2026-11-12T00:00:00Z') - i * 3600000).toISOString()));
  assert.equal(hstYm(Date.parse('2026-11-01T09:00:00Z')), '2026-10');
  assert.equal(new Date(hstPrevMonthStart(NOW0)).toISOString(), '2026-10-01T10:00:00.000Z');
  assert.equal((await s.worker('wrong')).status, 401);
  assert.equal((await s.worker('')).status, 401);
  const k = await s.key();
  const r1 = await s.worker(k);
  assert.equal(r1.status, 200, r1.text);
  assert.deepEqual(r1.body.stores.map(x => [x.store, x.ok, x.put]), [['S1', true, 4], ['S2', true, 120]]);
  const kpi = await s.ok('E8', { action: 'kpi' });
  assert.equal(kpi.connected, true); assert.deepEqual(kpi.auto, ['S1', 'S2']);
  assert.deepEqual(kpi.months['2026-11'].S1, { avg: 5, cnt: 1 });
  assert.deepEqual(kpi.months['2026-10'].S1, { avg: 2, cnt: 2 }, 'the 11/1 UTC review is October in Hawaii');
  assert.deepEqual(kpi.months['2026-08'].S1, { avg: 2, cnt: 1 }, 'an old review updated recently is kept in its own month');
  assert.equal(kpi.months['2026-09'], undefined, 'older than last month, not updated → not fetched');
  assert.equal(kpi.months['2026-11'].S2.cnt, 120, 'all pages');
  assert.deepEqual(kpi.overall.S1, { rating: 3, total: 5, at: kpi.overall.S1.at });
  // その月の口コミはすべて（★の多少によらない）・新しい順
  const m = await s.ok('E8', { action: 'month', store: 'S1', ym: '2026-10' });
  assert.equal(m.linked, true); assert.equal(m.cnt, 2); assert.equal(Number(m.avg), 2);
  assert.deepEqual(m.items.map(x => [x.rating, x.replied, x.reviewer]), [[1, true, 'Guest 2'], [3, false, null]], 'anonymous has no name');
  const m11 = await s.ok('E8', { action: 'month', store: 'S2', ym: '2026-11' });
  assert.equal(m11.items.length, 120);
  assert.equal((await s.call('E8', { action: 'month', store: 'S1', ym: '2026-13' })).status, 400);
  // もう一度：同じ（増えない）。直された★は直る
  s.g.reviews[LOC1][0] = rv(LOC1, 1, 'TWO', '2026-11-05T02:00:00Z', { updated: '2026-11-13T00:00:00Z' });
  s.setNow(NOW0 + 3600000);
  const r2 = await s.worker(k);
  assert.equal(r2.body.ok, true);
  const kpi2 = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(kpi2.months['2026-11'].S1, { avg: 2, cnt: 1 });
  assert.equal(kpi2.months['2026-11'].S2.cnt, 120);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query('select count(*)::int n from public.gr_reviews')).rows[0].n, 124);
  assert.ok((await s.pg.query('select count(*)::int n from public.gr_runs')).rows[0].n >= 2);
  await s.pg.exec('set role service_role');
  // 2 回目からも、消された口コミに気づくために前の月の初め（ハワイ）までは読む（#151 のレビュー）。それより古いページは読まない
  const callsBefore = s.g.calls.length; await s.worker(k);
  const pages = s.g.calls.slice(callsBefore).filter(u => u.includes(LOC2 + '/reviews')).length;
  assert.equal(pages, 3, 'the 120 November reviews are all after the start of October: 3 pages');
  const p1 = s.g.calls.slice(callsBefore).filter(u => u.includes(LOC1 + '/reviews')).length;
  assert.equal(p1, 1, 'one page is enough for S1');
  // 審査待ち（403）：口コミは取れない・状態は pending・前の口コミは残る
  s.g.reviewsStatus = 403;
  const r3 = await s.worker(k);
  assert.equal(r3.body.ok, false);
  assert.equal((await s.ok('E2', { action: 'status' })).bp.status, 'pending');
  assert.equal((await s.ok('E8', { action: 'kpi' })).months['2026-11'].S1.cnt, 1);
  s.g.reviewsStatus = 200;
  // GM・CEO の「今すぐ取る」
  assert.equal((await s.ok('E1', { action: 'sync_now' })).ok, true);
  assert.equal((await s.ok('E2', { action: 'status' })).bp.status, 'ok');
  // Google で許可を取り消された
  s.g.tokenRefresh = 'revoked';
  const r4 = await s.worker(k);
  assert.equal(r4.body.ok, false); assert.equal(r4.body.error, 'bp_auth_revoked');
  assert.equal((await s.ok('E2', { action: 'status' })).bp.status, 'expired');
  assert.ok(!r4.text.includes('rt-secret'));
});

test('auto only for stores linked to Business Profile while connected; relink drops the old reviews; disconnect keeps reviews but goes back to manual', async () => {
  const s = await setup();
  assert.deepEqual(await s.ok('E8', { action: 'kpi' }), { connected: false, status: 'none', last_ok_at: null, auto: [], from: {}, months: {}, overall: {} });
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  // 結んだだけ・審査待ちのあいだは手入力のまま（2：API をつなぐまでは手入力）
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).auto, [], 'linked but not read yet: still manual');
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'FIVE', '2026-11-05T02:00:00Z')];
  s.g.reviewsStatus = 403;
  await s.worker(await s.key());
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).auto, [], 'waiting for Google approval: still manual');
  s.g.reviewsStatus = 200;
  await s.worker(await s.key());
  const k0 = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(k0.auto, ['S1']);
  assert.deepEqual(k0.from, { S1: '2026-10' }, 'the first full read starts at the previous Hawaii month');
  assert.equal((await s.ok('E2', { action: 'status' })).stores.S1.from, '2026-10');
  // 2 回目からは取り始めの月を変えない・読めない値や先の月は今の月にする
  await s.worker(await s.key());
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).from, { S1: '2026-10' });
  // 前の店の口コミを残さない
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC2 });
  const k1 = await s.ok('E8', { action: 'kpi' });
  assert.equal(k1.months['2026-11'], undefined);
  assert.deepEqual(k1.auto, [], 'a new location is manual again until it is read');
  assert.equal(k1.overall.S1, undefined, 'the old overall rating is not kept for another location');
  // 取っているあいだに結び直された：書かない
  await assert.rejects(s.db.rpc('gr_reviews_put', { store: 'S1', location: LOC1, items: [] }), /conflict/);
  await assert.rejects(s.db.rpc('gr_reviews_put', { store: 'S1', location: LOC2, items: [{ name: `${ACC}/${LOC1}/reviews/x`, rating: 5, created: '2026-11-01T00:00:00Z' }] }), /bad_value/, 'name must be under the location');
  await assert.rejects(s.db.rpc('gr_reviews_put', { store: 'S1', location: LOC2, items: [{ name: `${ACC}/${LOC2}/reviews/x`, rating: 6, created: '2026-11-01T00:00:00Z' }] }), /bad_value/);
  s.g.reviews[LOC2] = [rv(LOC2, 9, 'THREE', '2026-11-06T02:00:00Z')];
  await s.worker(await s.key());
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 3, cnt: 1 } });
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).auto, ['S1']);
  // 取り始めの月：読めない値・先の月は使わない（今の月＝安全なほう）
  await s.ok('E2', { action: 'bp_link', store: 'S2', account: ACC, location: 'locations/333' });
  await s.db.rpc('gr_reviews_put', { store: 'S2', location: 'locations/333', items: [], done: true, from_ym: '2999-01' });
  const nowYm = (await s.pg.query("select public.gr_hst_ym(now()) v")).rows[0].v;
  assert.equal((await s.ok('E8', { action: 'kpi' })).from.S2, nowYm);
  // 2099 年のような先の月も今の月
  await s.ok('E2', { action: 'bp_link', store: 'S2', account: ACC, location: 'locations/444' });
  // 途中まで（done: false）では取り始めの月を決めない・自動にしない
  await s.db.rpc('gr_reviews_put', { store: 'S2', location: 'locations/444', items: [], done: false, from_ym: '2026-10' });
  const kp = await s.ok('E8', { action: 'kpi' });
  assert.equal(kp.from.S2, undefined); assert.ok(!kp.auto.includes('S2'), 'not auto until the read ends');
  await s.db.rpc('gr_reviews_put', { store: 'S2', location: 'locations/444', items: [], done: true, from_ym: '2099-01' });
  assert.equal((await s.ok('E8', { action: 'kpi' })).from.S2, nowYm);
  // ちゃんとした前の月はそのまま
  await s.ok('E2', { action: 'bp_link', store: 'S2', account: ACC, location: 'locations/555' });
  await s.db.rpc('gr_reviews_put', { store: 'S2', location: 'locations/555', items: [], done: true, from_ym: '2026-09' });
  assert.equal((await s.ok('E8', { action: 'kpi' })).from.S2, '2026-09');
  await s.ok('E2', { action: 'bp_link', store: 'S2', location: null });
  // 切る：手入力に戻る（auto が空）。取った口コミは残る
  await s.ok('E2', { action: 'bp_disconnect' });
  const k2 = await s.ok('E8', { action: 'kpi' });
  assert.equal(k2.connected, false); assert.deepEqual(k2.auto, []);
  assert.equal((await s.ok('E2', { action: 'status' })).bp.connected, false);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query('select refresh_token from public.gr_bp')).rows[0].refresh_token, null);
  assert.equal((await s.pg.query('select count(*)::int n from public.gr_reviews')).rows[0].n, 1);
  await s.pg.exec('set role service_role');
  // 切ったあとの毎日の取り込みは何もしない
  const r = await s.worker(await s.key());
  assert.equal(r.status, 200); assert.equal(r.body.error, 'bp_not_connected');
  // 外す
  await s.ok('E2', { action: 'bp_link', store: 'S1', location: null });
  assert.equal((await s.ok('E2', { action: 'status' })).stores.S1, undefined);
});

test('a store relinked while its reviews are being read: nothing is written for it (conflict) and it stays manual; the next read takes the new place', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'FIVE', '2026-11-05T02:00:00Z')];
  s.g.reviews[LOC2] = [rv(LOC2, 2, 'THREE', '2026-11-06T02:00:00Z')];
  let relinked = false;
  s.g.onReviews = async loc => { if (loc === LOC1 && !relinked) { relinked = true; await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC2 }); } };
  const k = await s.key();
  const r = await s.worker(k);
  assert.ok(relinked);
  assert.deepEqual(r.body.stores.map(x => [x.store, x.ok, x.put, x.error]), [['S1', false, 0, 'conflict']]);
  const kp = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual([kp.auto, kp.from, kp.overall.S1, kp.months['2026-11']], [[], {}, undefined, undefined]);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query('select count(*)::int n from public.gr_reviews')).rows[0].n, 0, 'the old place\u2019s reviews are not kept for the store');
  await s.pg.exec('set role service_role');
  s.g.onReviews = null;
  await s.worker(k);
  const k2 = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(k2.auto, ['S1']); assert.deepEqual(k2.months['2026-11'], { S1: { avg: 3, cnt: 1 } });
});

// ---------------------------------------------------------------- #151 のレビュー（Claude・Codex）の直し
test('#151 relink: a location moved from one store to another takes its reviews with it (they do not stay with the old store)', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'FIVE', '2026-11-05T02:00:00Z'), rv(LOC1, 2, 'THREE', '2026-11-06T02:00:00Z')];
  const k = await s.key();
  await s.worker(k);
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 4, cnt: 2 } });
  // まちがえて S1 に結んだ：外して S2 へ
  await s.ok('E2', { action: 'bp_link', store: 'S1', location: null });
  await s.ok('E2', { action: 'bp_link', store: 'S2', account: ACC, location: LOC1 });
  await s.pg.exec('reset role');
  assert.deepEqual((await s.pg.query('select store_id, count(*)::int n from public.gr_reviews group by 1')).rows, [{ store_id: 'S2', n: 2 }], 'moved when linked');
  await s.pg.exec('set role service_role');
  await s.worker(k);
  const kp = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(kp.auto, ['S2']); assert.deepEqual(kp.months['2026-11'], { S2: { avg: 4, cnt: 2 } });
  const m2 = await s.ok('E8', { action: 'month', store: 'S2', ym: '2026-11' });
  assert.deepEqual([m2.linked, m2.cnt, m2.items.length], [true, 2, 2]);
  const m1 = await s.ok('E8', { action: 'month', store: 'S1', ym: '2026-11' });
  assert.deepEqual([m1.linked, m1.cnt, m1.items.length], [false, 0, 0], 'nothing left with the old store');
  // 取り込みの put も店を入れ替える（結ぶ前に入った行が前の店のままでも）
  await s.pg.exec("reset role; update public.gr_reviews set store_id = 'S1'; set role service_role");
  await s.worker(k);
  await s.pg.exec('reset role');
  assert.deepEqual((await s.pg.query('select distinct store_id from public.gr_reviews')).rows, [{ store_id: 'S2' }], 'put moves it too');
  // 1 つの location を 2 つの店に：索引でも止まる（同時に結んだとき）
  await assert.rejects(s.pg.query("insert into public.gr_bp_loc (store_id, account, location) values ('S9', 'accounts/900', 'locations/111')"), /duplicate key|unique/);
  await s.pg.exec('set role service_role');
  assert.equal((await s.call('E2', { action: 'bp_link', store: 'S3', account: ACC, location: LOC1 })).status, 409);
});

test('#151 deleted on Google: a review removed from Google leaves the month once a read ends; a read that fails or stops on the page limit deletes nothing', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'ONE', '2026-11-12T02:00:00Z'), rv(LOC1, 2, 'FIVE', '2026-11-11T02:00:00Z'), rv(LOC1, 3, 'FOUR', '2026-10-03T02:00:00Z'),
    rv(LOC1, 4, 'TWO', '2026-11-02T00:00:00Z')];
  const k = await s.key();
  await s.worker(k);
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 2.67, cnt: 3 } });
  // 前の月の初めより前に直された口コミ（前に取ったもの）は、読む範囲の外なので消さない（Google にはまだある）
  s.g.reviews[LOC1].push(rv(LOC1, 9, 'FIVE', '2026-09-10T02:00:00Z'));
  await s.pg.exec("reset role; insert into public.gr_reviews (name, store_id, rating, created, updated, ym) values ('" + ACC + "/" + LOC1 + "/reviews/r9', 'S1', 5, '2026-09-10T02:00:00Z', '2026-09-10T02:00:00Z', '2026-09'); set role service_role");
  // ★1 が Google で消された。3 日の範囲の外の 10 月の口コミ（★4）も消された
  s.g.reviews[LOC1] = s.g.reviews[LOC1].filter(x => !/\/r1$|\/r3$/.test(x.name));
  s.setNow(NOW0 + 86400000);
  // #151 の再レビュー：1 回目は印だけ（まだ数える）。次の回にも無ければ消す
  const r0 = await s.worker(k);
  assert.deepEqual(r0.body.stores.map(x => [x.store, x.ok, x.pruned, x.marked]), [['S1', true, 0, 2]]);
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 2.67, cnt: 3 } }, 'still counted until the next read');
  const r = await s.worker(k);
  assert.deepEqual(r.body.stores.map(x => [x.store, x.ok, x.pruned, x.marked]), [['S1', true, 2, 0]]);
  const kp = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(kp.months['2026-11'], { S1: { avg: 3.5, cnt: 2 } }, 'the deleted ★1 is gone');
  assert.equal(kp.months['2026-10'], undefined, 'the deleted October review is gone too (after the start of last month)');
  assert.deepEqual(kp.months['2026-09'], { S1: { avg: 5, cnt: 1 } }, 'an older review outside the window is kept');
  assert.deepEqual(kp.overall.S1, { rating: 4, total: 3, at: kp.overall.S1.at }, 'the overall comes from Google (r2, r4 and the old r9)');
  // 途中で失敗した読み込みは何も消さない
  s.g.pageSize = 1;
  s.g.reviews[LOC1] = [rv(LOC1, 2, 'FIVE', '2026-11-11T02:00:00Z')];   // ★2 が消えたように見える
  s.g.onReviews = async () => { s.g.reviewsStatus = 500; };   // 1 ページ目は取れて、2 ページ目で失敗
  s.g.reviews[LOC1].push(rv(LOC1, 5, 'THREE', '2026-11-10T02:00:00Z'));
  const r2 = await s.worker(k);
  s.g.reviewsStatus = 200; s.g.onReviews = null;
  assert.deepEqual(r2.body.stores.map(x => [x.ok, x.pruned, x.error]), [[false, undefined, 'reviews_500']]);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query("select count(*)::int n from public.gr_reviews where name like '%/r4'")).rows[0].n, 1, 'not deleted after a failed read');
  await s.pg.exec('set role service_role');
  // ページの上限（20 ページ）で前の月の初めまで届かない：取り終えたことにはするが、消さない
  //   1 件ずつ・6 時間おき：3 日前（取り終えたとみなす所）は 20 ページの中で過ぎるが、10/1 までは届かない
  s.g.reviews[LOC1] = Array.from({ length: 25 }, (_, i) => rv(LOC1, 200 + i, 'FIVE', new Date(Date.parse('2026-11-13T00:00:00Z') - i * 6 * 3600000).toISOString()));
  const r3 = await s.worker(k);
  assert.deepEqual(r3.body.stores.map(x => [x.ok, x.pruned, x.note]), [[true, undefined, 'prune_skipped']]);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query("select count(*)::int n from public.gr_reviews where name like '%/r4'")).rows[0].n, 1, 'not deleted when the read stopped at the page limit');
  await s.pg.exec('set role service_role');
  // gr_reviews_prune の守り：100 日より前・先の時刻・ほかの location は断る
  const st = new Date().toISOString();
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: '2026-01-01T00:00:00Z', started: st, names: [] }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: '2099-01-01T00:00:00Z', started: st, names: [] }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC2, since: st, started: st, names: [] }), /conflict/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: 'x', started: st, names: [] }), /bad_value/);
  // #151 の再レビュー（Claude の P3）：names・started が無い・形が違う・先の時刻・古すぎる、は断る（NULL を通さない）
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, started: st }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, started: st, names: null }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, names: [] }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, started: '2099-01-01T00:00:00Z', names: [] }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, started: '2026-01-01T00:00:00Z', names: [] }), /bad_value/);
  await assert.rejects(s.db.rpc('gr_reviews_prune', { store: 'S1', location: LOC1, since: st, started: 5, names: [] }), /bad_value/);
});

// #151 の再レビュー（Codex 6875770314）：重なった 2 つの取り込み。古い一覧の取り込みが、あとの取り込みの入れた口コミを消さない
test('#151 overlapping reads: an older read that finishes last does not delete a review the newer read put (both orders, repeated)', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'ONE', '2026-11-05T02:00:00Z')];
  const k = await s.key();
  await s.worker(k);
  const orig = s.db.rpc;
  let hold = null, held = null, holdOn = 'gr_reviews_prune';
  s.db.rpc = async function (n, p) { if (n === holdOn && hold) { const h = hold; hold = null; held(); await h; } return orig.call(this, n, p); };
  const kpi = async () => (await s.ok('E8', { action: 'kpi' })).months['2026-11'];
  for (let round = 0; round < 3; round++) {
    // A：★1 だけの一覧を読み、消す直前（round 1 は入れる直前）で止まる
    holdOn = round === 1 ? 'gr_reviews_put' : 'gr_reviews_prune';
    let release; hold = new Promise(r => { release = r; }); const atPrune = new Promise(r => { held = r; });
    const a = s.worker(k);
    await atPrune;
    // Google に★5 が増え、B が最後まで取る
    s.g.reviews[LOC1] = s.g.reviews[LOC1].concat([rv(LOC1, 50 + round, 'FIVE', '2026-11-06T02:00:00Z')]);
    const b = await s.worker(k);
    assert.equal(b.body.stores[0].ok, true);
    // A を続ける：B の★5 を消さない・印も付けない
    release();
    const ra = await a;
    assert.equal(ra.body.stores[0].ok, true);
    assert.deepEqual([ra.body.stores[0].pruned, ra.body.stores[0].marked], [0, 0], 'round ' + round);
    await s.pg.exec('reset role');
    assert.equal((await s.pg.query("select count(*)::int n from public.gr_reviews where name like '%/r" + (50 + round) + "' and gone_at is null")).rows[0].n, 1, 'kept round ' + round);
    await s.pg.exec('set role service_role');
    // そのまま次の取り込みが来ても★5 は消えない（Google にある）
    await s.worker(k);
    const m = await kpi();
    assert.equal(m.S1.cnt, 2 + round, 'round ' + round);
  }
  // 逆の順：B が先に始め、あとで始めた取り込みが★7 を入れたあとで B が消そうとしても消さない
  holdOn = 'gr_reviews_put';
  let release; hold = new Promise(r => { release = r; }); const atPrune = new Promise(r => { held = r; });
  s.g.reviews[LOC1] = s.g.reviews[LOC1].slice();
  const b = s.worker(k);   // 今の一覧（★7 なし）を読んで止まる
  await atPrune;
  s.g.reviews[LOC1].push(rv(LOC1, 70, 'FIVE', '2026-11-07T02:00:00Z'));
  await s.worker(k);       // あとで始めた取り込みが★7 を入れる
  release();
  const rb = await b;
  assert.deepEqual([rb.body.stores[0].ok, rb.body.stores[0].pruned, rb.body.stores[0].marked], [true, 0, 0]);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query("select count(*)::int n from public.gr_reviews where name like '%/r70' and gone_at is null")).rows[0].n, 1, 'the newer review is kept');
  await s.pg.exec('set role service_role');
  s.db.rpc = orig;
});

// #151 の再レビュー（Claude の P3）：読んでいるあいだに並びが変わって 1 回だけ読み落としても、口コミは消えない
test('#151 a review missed once (the order changed while paging) is only marked, and the mark goes away on the next read', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  s.g.reviews[LOC1] = [rv(LOC1, 1, 'ONE', '2026-11-05T02:00:00Z'), rv(LOC1, 2, 'FIVE', '2026-11-06T02:00:00Z'), rv(LOC1, 3, 'THREE', '2026-11-07T02:00:00Z')];
  const k = await s.key();
  await s.worker(k);
  // 1 回だけ★5（r2）が一覧に出ない
  const all = s.g.reviews[LOC1];
  s.g.reviews[LOC1] = all.filter(x => !/\/r2$/.test(x.name));
  const r1 = await s.worker(k);
  assert.deepEqual([r1.body.stores[0].pruned, r1.body.stores[0].marked], [0, 1]);
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 3, cnt: 3 } }, 'still counted');
  // 次の回は読めた：印は外れ、消えない
  s.g.reviews[LOC1] = all;
  const r2 = await s.worker(k);
  assert.deepEqual([r2.body.stores[0].pruned, r2.body.stores[0].marked], [0, 0]);
  await s.pg.exec('reset role');
  assert.equal((await s.pg.query("select count(*)::int n from public.gr_reviews where gone_at is not null")).rows[0].n, 0);
  await s.pg.exec('set role service_role');
  const r3 = await s.worker(k);
  assert.deepEqual([r3.body.stores[0].pruned, r3.body.stores[0].marked], [0, 0]);
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).months['2026-11'], { S1: { avg: 3, cnt: 3 } });
  // 長くつながっていなかった（最後に取れたのが 120 日前）あとでも、消す所で止まらない（Claude の P3）
  await s.pg.exec("reset role; update public.gr_bp_loc set synced_at = now() - interval '120 days'; set role service_role");
  const r4 = await s.worker(k);
  assert.deepEqual([r4.body.stores[0].ok, r4.body.stores[0].error], [true, undefined]);
});

test('#151 a month with more than 200 reviews: 200 at a time, every review is reachable once, a bad cursor is refused', async () => {
  const s = await setup();
  await s.connect();
  await s.ok('E2', { action: 'bp_link', store: 'S1', account: ACC, location: LOC1 });
  // 同じ時刻の口コミも混ぜる（並びの決まりで抜け・重なりが無いか）
  s.g.reviews[LOC1] = Array.from({ length: 501 }, (_, i) => rv(LOC1, 1000 + i, 'FOUR', new Date(Date.parse('2026-11-12T00:00:00Z') - Math.floor(i / 3) * 60000).toISOString()));
  s.g.pageSize = 50;
  const k = await s.key();
  // 501 件は 11 ページ（20 ページの上限の中）
  const r = await s.worker(k);
  assert.equal(r.body.ok, true, r.text);
  let m = await s.ok('E8', { action: 'month', store: 'S1', ym: '2026-11' });
  assert.equal(m.cnt, 501); assert.equal(m.items.length, 200); assert.equal(m.more, true); assert.match(m.next.h, /^[0-9a-f]{32}$/);
  const seen = new Set(m.items.map(x => x.h));
  let pages = 1;
  while (m.more && pages < 10) { m = await s.ok('E8', { action: 'month', store: 'S1', ym: '2026-11', before: m.next }); m.items.forEach(x => seen.add(x.h)); pages++; }
  assert.equal(pages, 3); assert.equal(seen.size, 501, 'each review once');
  assert.equal(m.next, null);
  for (const before of [{ c: 'x', h: 'a'.repeat(32) }, { c: '2026-11-01T00:00:00Z', h: 'zz' }, 'abc'])
    assert.equal((await s.call('E8', { action: 'month', store: 'S1', ym: '2026-11', before })).status, 400, JSON.stringify(before));
});
