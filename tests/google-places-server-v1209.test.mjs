// v1209 Google の評価・口コミ（Places API（新））：見られる店だけ・回数の上限・押したときだけ・必要な項目だけ・鍵を出さない。
// 本物の SQL（v1157 → v1209・PGlite）と本物の handler、偽の Google、合成データだけ。本番にはつながない。仕様：docs/GOOGLE_PLACES_V1209_JA.md
// だれか（work-requests の whoami）は代わり。見られる店（stores・am_stores）は whoami の答えと同じ形。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/google-reviews/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const SQL1209 = fs.readFileSync(new URL('../supabase/migrations/20261215090000_google_places_caps.sql', import.meta.url), 'utf8');
const KEY = 'places-key-SECRET-1234567890';
const NOW0 = Date.parse('2026-11-23T20:00:00Z');
const NOW_MASK = 'id,displayName,formattedAddress,googleMapsUri,rating,userRatingCount,reviews,attributions';
// 社員：役割と見られる店（whoami と同じ形）。E9 は GM・CEO が確かめた Head Chef、E10 は確かめがまだの Head Chef
const PEOPLE = {
  E1: { role: 'ceo', stores: [], am_stores: [] }, E2: { role: 'gm', stores: [], am_stores: [] },
  E3: { role: 'office', stores: [], am_stores: [] }, E4: { role: 'office_crew', stores: [], am_stores: [] },
  E5: { role: 'am', stores: [], am_stores: ['S1', 'S2'] }, E6: { role: 'sl', stores: ['S1'], am_stores: [] },
  E8: { role: 'crew', stores: ['S1'], am_stores: [] }, E7: { role: 'crew', stores: [], am_stores: [] },
  E9: { role: 'chef', stores: ['S1'], am_stores: [] }, E10: { role: 'chef', stores: ['S1'], am_stores: [] },
};
const meOf = id => ({ emp: id, name: 'Person ' + id, ...PEOPLE[id] });
const PID = { S1: 'ChIJ_fake_place_one_0001', S2: 'ChIJ_fake_place_two_0002', S3: 'ChIJ_fake_place_three_03' };

function fakeGoogle() {
  const g = { calls: [], heads: [], status: 200, reviewsN: 7 };
  g.fetch = async (u, init = {}) => {
    const url = String(u); g.calls.push(url);
    g.heads.push({ url, h: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body || '' });
    const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://places.googleapis.com/v1/places:searchText')) {
      if (g.status !== 200) return J({ error: { message: 'API key not valid ' + KEY } }, g.status);
      return J({ places: [
        { id: PID.S1, displayName: { text: 'Fake Ramen One' }, formattedAddress: '1 Fake St, Honolulu, HI', googleMapsUri: 'https://maps.google.com/?cid=1',
          businessStatus: 'OPERATIONAL', rating: 4.4, userRatingCount: 812, reviews: [{ rating: 5 }] },
        { id: 'bad id!', displayName: { text: 'x' } },
        { id: PID.S2, displayName: { text: 'Fake Two' }, googleMapsUri: 'javascript:alert(1)', businessStatus: 'WEIRD' }] });
    }
    const m = /^https:\/\/places\.googleapis\.com\/v1\/places\/([^?]+)\?(.*)$/.exec(url);
    if (m) {
      if (g.status !== 200) return J({ error: { message: 'API key not valid ' + KEY } }, g.status);
      const id = decodeURIComponent(m[1]);
      const reviews = [];
      for (let i = 1; i <= g.reviewsN; i++) reviews.push({ rating: (i % 5) + 1, originalText: { text: 'review ' + i, languageCode: 'ja' },
        relativePublishTimeDescription: i + ' weeks ago', publishTime: '2026-11-0' + Math.min(i, 9) + 'T01:00:00Z',
        authorAttribution: { displayName: 'Author ' + i, uri: i === 2 ? 'javascript:alert(2)' : 'https://www.google.com/maps/contrib/' + i,
          photoUri: i === 3 ? 'http://lh3.googleusercontent.com/a/p3' : 'https://lh3.googleusercontent.com/a/p' + i },
        googleMapsUri: i === 4 ? 'https://evil.example/r4' : 'https://www.google.com/maps/reviews/data=r' + i,
        flagContentUri: 'https://www.google.com/local/review/rap/report?r=' + i });
      return J({ id, displayName: { text: 'Place ' + id.slice(-4) }, formattedAddress: '1 Fake St, Honolulu, HI 96826', googleMapsUri: 'https://maps.google.com/?cid=9',
        rating: 4.36, userRatingCount: 812, reviews, attributions: [{ provider: 'Data <b>Co</b>', providerUri: 'https://data.example/' }, { provider: 'Bad', providerUri: 'javascript:x' }],
        priceLevel: 'PRICE_LEVEL_MODERATE', internationalPhoneNumber: '+1 808 000 0000' });
    }
    return J({ error: 'unknown ' + url }, 404);
  };
  return g;
}

// sql：'v1157'＝v1157 だけ（v1209 の SQL がまだ）／true＝両方。stores：店舗マスターの表を作る（店の ID の配列）
async function setup({ sql = true, env = {}, caps = {}, stores = null, chef = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  if (stores) {
    await pg.exec(`create table public.stores (id text primary key, name text, active boolean default true, data jsonb);
      grant select on public.stores to service_role;`);
    for (const s of stores) await pg.query('insert into public.stores (id, name, active, data) values ($1, $1, true, $2)', [s, JSON.stringify({ id: s })]);
  }
  if (chef) {   // work-requests の写し（GM・CEO が確かめた人）の代わり。E9 は両方 chef、E10 は今の表だけ chef
    await pg.exec(`create function public.wr_person_conf(e text) returns jsonb language sql as $$ select jsonb_build_object('chef', e = 'E9') $$;
      create function public.wr_person_live(e text) returns jsonb language sql as $$ select jsonb_build_object('chef', e in ('E9', 'E10')) $$;
      grant execute on function public.wr_person_conf(text) to service_role; grant execute on function public.wr_person_live(text) to service_role;`);
  }
  await pg.exec(SQL);
  if (sql !== 'v1157') await pg.exec(SQL1209);
  const set = Object.entries(caps);
  if (set.length && sql !== 'v1157') await pg.exec(`update public.gr_settings set ${set.map(([k, v]) => `${k} = ${Number(v)}`).join(', ')}`);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const g = fakeGoogle();
  const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', GOOGLE_PLACES_API_KEY: KEY, ...env };
  let t = NOW0;
  const handler = createHandler({ env: k => ENV[k], db, fetch: g.fetch, now: () => t,
    whoami: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m && PEOPLE[m[1]] ? meOf(m[1]) : null; } });
  const call = async (who, body) => {
    const r = await handler(new Request('https://fn.test/google-reviews', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://funergy-plus.com' },
      body: JSON.stringify({ pin_session: who.startsWith('store') ? who : 'pin-' + who, ...body }) }));
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, text };
  };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + r.text); return r.body; };
  const sqlq = async (q, p = []) => { await pg.exec('reset role'); const r = await pg.query(q, p); await pg.exec('set role service_role'); return r.rows; };
  const used = async (kind = 'now', scope = 'all') => Number(((await sqlq('select coalesce(sum(n),0) n from public.gr_places_use where kind = $1 and scope = $2', [kind, scope]))[0] || {}).n || 0);
  const detailCalls = () => g.calls.filter(u => u.startsWith('https://places.googleapis.com/v1/places/')).length;
  return { pg, g, call, ok, sqlq, used, detailCalls, setNow: v => { t = v; } };
}
const link = async (s, stores = ['S1', 'S2', 'S3']) => { for (const id of stores) await s.ok('E2', { action: 'places_set', store: id, place_id: PID[id] }); };

test('before the v1209 SQL: the screen is told the server is older and Google is never called', async () => {
  const s = await setup({ sql: 'v1157' });
  await link(s, ['S1']);
  for (const who of ['E2', 'E5', 'E8']) {
    const r = await s.call(who, { action: 'places_now', store: 'S1' });
    assert.equal(r.status, 503, who + ' ' + r.text); assert.equal(r.body.error, 'gr_old');
  }
  const q = await s.call('E2', { action: 'places_search', q: 'Fake Ramen' });
  assert.equal(q.status, 503); assert.equal(q.body.error, 'gr_old');
  assert.equal(s.g.calls.length, 0, 'no call to Google without the counter');
  const st = await s.ok('E2', { action: 'status' });
  assert.equal(st.usage, undefined, 'no usage before the v1209 SQL');
  const k = await s.ok('E2', { action: 'kpi' });
  assert.equal(k.places, undefined, 'no linked list before the v1209 SQL');
  assert.equal((await s.ok('E2', { action: 'whoami' })).fn, 2);
});

test('who can see which store: the server decides with the same scope as the app (CEO・GM・経理・事務Crew・確かめた Head Chef＝全店)', async () => {
  const s = await setup();
  await link(s);
  // 全店の人
  for (const who of ['E1', 'E2', 'E3', 'E4', 'E9']) {
    for (const store of ['S1', 'S2', 'S3']) {
      const r = await s.ok(who, { action: 'places_now', store });
      assert.equal(r.linked, true, who + ' ' + store);
    }
  }
  // 担当の店だけ
  const seen = { E5: ['S1', 'S2'], E6: ['S1'], E8: ['S1'], E10: ['S1'], E7: [] };
  for (const [who, mine] of Object.entries(seen)) {
    for (const store of ['S1', 'S2', 'S3']) {
      const before = s.detailCalls(), usedBefore = await s.used();
      const r = await s.call(who, { action: 'places_now', store });
      if (mine.includes(store)) { assert.equal(r.status, 200, who + ' ' + store + ' ' + r.text); continue; }
      assert.equal(r.status, 403, who + ' ' + store + ' ' + r.text); assert.equal(r.body.error, 'forbidden_store');
      assert.equal(s.detailCalls(), before, 'no Google call for a store the person cannot see');
      assert.equal(await s.used(), usedBefore, 'not counted');
      const m = await s.call(who, { action: 'month', store, ym: '2026-11' });
      assert.equal(m.status, 403, 'month ' + who + ' ' + store); assert.equal(m.body.error, 'forbidden_store');
    }
  }
  // Head Chef でも GM・CEO が確かめていなければ（今の表だけ）自分の店だけ
  assert.equal((await s.call('E10', { action: 'places_now', store: 'S2' })).status, 403);
  // 店のタブレット・ログインの無い人は入れない
  assert.equal((await s.call('store-S1', { action: 'places_now', store: 'S1' })).status, 401);
  assert.equal((await s.call('E99', { action: 'places_now', store: 'S1' })).status, 401);
  // 店を探す・結ぶのは GM・CEO だけ
  for (const who of ['E5', 'E6', 'E8', 'E3', 'E9']) {
    assert.equal((await s.call(who, { action: 'places_search', q: 'Fake Ramen' })).status, 403, 'search ' + who);
    assert.equal((await s.call(who, { action: 'places_set', store: 'S1', place_id: PID.S2 })).status, 403, 'set ' + who);
  }
});

test('kpi returns only the stores the person can see (linked list, monthly averages, overall rating, from)', async () => {
  const s = await setup();
  await link(s);
  await s.sqlq(`update public.gr_bp set refresh_token = 'rt', connected_at = now(), status = 'ok' where id = 1`);
  for (const [st, loc] of [['S1', '1'], ['S2', '2'], ['S3', '3']]) {
    await s.sqlq(`insert into public.gr_bp_loc (store_id, account, location, rating, total, rating_at, from_ym) values ($1, 'accounts/9', $2, 4.5, 10, now(), '2026-10')`, [st, 'locations/' + loc]);
    await s.sqlq(`insert into public.gr_reviews (name, store_id, rating, created, ym) values ($1, $2, 4, '2026-11-02T00:00:00Z', '2026-11')`, ['r-' + st, st]);
  }
  const all = await s.ok('E2', { action: 'kpi' });
  assert.deepEqual(all.places, ['S1', 'S2', 'S3']); assert.deepEqual(all.auto, ['S1', 'S2', 'S3']);
  assert.deepEqual(Object.keys(all.overall).sort(), ['S1', 'S2', 'S3']);
  const crew = await s.ok('E8', { action: 'kpi' });
  assert.deepEqual(crew.places, ['S1']); assert.deepEqual(crew.auto, ['S1']);
  assert.deepEqual(Object.keys(crew.overall), ['S1']); assert.deepEqual(Object.keys(crew.from), ['S1']);
  assert.deepEqual(Object.keys(crew.months['2026-11']), ['S1']);
  const am = await s.ok('E5', { action: 'kpi' });
  assert.deepEqual(am.places, ['S1', 'S2']); assert.deepEqual(Object.keys(am.overall).sort(), ['S1', 'S2']);
  const none = await s.ok('E7', { action: 'kpi' });
  assert.deepEqual(none.places, []); assert.deepEqual(none.overall, {}); assert.deepEqual(none.months, {});
  const chef = await s.ok('E9', { action: 'kpi' });
  assert.deepEqual(chef.places, ['S1', 'S2', 'S3']);
});

test('only on request, only linked stores, only the needed fields; Google’s order is relevance, at most 5 reviews; links are Google’s only', async () => {
  const s = await setup();
  await link(s, ['S1']);
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
  try {
    // 結んでいない店：Google を呼ばない・数えない
    const nl = await s.ok('E2', { action: 'places_now', store: 'S2' });
    assert.deepEqual(nl, { store: 'S2', linked: false });
    assert.equal(s.g.calls.length, 0); assert.equal(await s.used(), 0);
    const r = await s.call('E8', { action: 'places_now', store: 'S1', lang: 'en' });
    assert.equal(r.status, 200, r.text);
    const p = r.body;
    assert.equal(s.detailCalls(), 1);
    const h = s.g.heads.at(-1);
    assert.equal(h.h['x-goog-fieldmask'], NOW_MASK, 'only the needed fields');
    assert.equal(h.h['x-goog-api-key'], KEY);
    assert.match(h.url, /languageCode=en/);
    assert.ok(!r.text.includes(KEY), 'the key never goes back to the screen');
    assert.equal(p.order, 'relevance'); assert.equal(p.lang, 'en');
    assert.equal(p.rating, 4.4); assert.equal(p.count, 812);
    assert.equal(p.reviews.length, 5, 'Google returned 7; we pass at most 5');
    assert.deepEqual(p.reviews.map(x => x.text), ['review 1', 'review 2', 'review 3', 'review 4', 'review 5'], 'kept in Google’s order');
    assert.equal(p.reviews[0].author, 'Author 1');
    assert.equal(p.reviews[0].author_uri, 'https://www.google.com/maps/contrib/1');
    assert.equal(p.reviews[1].author_uri, '', 'javascript: dropped');
    assert.equal(p.reviews[2].author_photo, '', 'http photo dropped');
    assert.equal(p.reviews[3].uri, '', 'non-Google review link dropped');
    assert.match(p.reviews[0].flag, /^https:\/\/www\.google\.com\//);
    assert.deepEqual(p.attributions, [{ provider: 'Data <b>Co</b>', uri: 'https://data.example/' }, { provider: 'Bad', uri: '' }]);
    for (const k of ['priceLevel', 'internationalPhoneNumber', 'place_id', 'id']) assert.equal(p[k], undefined, k + ' not passed');
    assert.ok(!JSON.stringify(p).includes(PID.S1), 'the place ID is not sent to the screen');
    assert.equal(await s.used(), 1); assert.equal(await s.used('now', 's:S1'), 1); assert.equal(await s.used('now', 'p:E8'), 1);
    // 店を探す：GM・CEO・見つけたものの名前・住所だけ（評価・口コミは取らない）
    const q = await s.ok('E2', { action: 'places_search', q: 'Fake Ramen Honolulu' });
    const sh = s.g.heads.at(-1);
    assert.ok(!/rating|reviews|userRatingCount/.test(sh.h['x-goog-fieldmask']), 'search does not ask for rating or reviews: ' + sh.h['x-goog-fieldmask']);
    assert.match(sh.h['x-goog-fieldmask'], /places\.id/);
    assert.deepEqual(q.items.map(x => x.place_id), [PID.S1, PID.S2], 'odd IDs dropped');
    assert.equal(q.items[0].rating, undefined); assert.equal(q.items[1].uri, ''); assert.equal(q.items[1].status, '');
    assert.equal(await s.used('search'), 1);
    // Google が断った（鍵の制限など）：502・回数は数える（呼んだ回数）・鍵は出さない
    s.g.status = 403;
    const d = await s.call('E2', { action: 'places_now', store: 'S1' });
    assert.equal(d.status, 502); assert.equal(d.body.error, 'places_denied');
    assert.ok(!d.text.includes(KEY));
    assert.equal(await s.used(), 2, 'a refused call is still counted');
    s.g.status = 429;
    assert.equal((await s.call('E2', { action: 'places_now', store: 'S1' })).body.error, 'places_busy');
    s.g.status = 500;
    assert.equal((await s.call('E2', { action: 'places_search', q: 'Fake' })).body.error, 'places_failed');
    // Google には鍵、ほかには出さない
    for (const x of s.g.heads) assert.ok(x.url.startsWith('https://places.googleapis.com/'), 'only Google gets a request: ' + x.url);
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(KEY), 'the key never goes to the logs');
});

test('no key on the server: 503 and nothing counted', async () => {
  const s = await setup({ env: { GOOGLE_PLACES_API_KEY: '' } });
  await link(s, ['S1']);
  const r = await s.call('E2', { action: 'places_now', store: 'S1' });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'places_not_configured');
  assert.equal((await s.call('E2', { action: 'places_search', q: 'Fake' })).body.error, 'places_not_configured');
  assert.equal((await s.ok('E2', { action: 'whoami' })).places, false);
  assert.equal(s.g.calls.length, 0); assert.equal(await s.used(), 0);
});

test('caps: per store, per person, per day, per month, and search; Google is not called past a cap and nothing more is counted', async () => {
  {
    const s = await setup({ caps: { places_store_day_max: 2 } });
    await link(s);
    await s.ok('E2', { action: 'places_now', store: 'S1' }); await s.ok('E1', { action: 'places_now', store: 'S1' });
    const r = await s.call('E5', { action: 'places_now', store: 'S1' });
    assert.equal(r.status, 429); assert.deepEqual(r.body, { error: 'places_cap', cap: 'store', max: 2 });
    assert.equal(s.detailCalls(), 2); assert.equal(await s.used(), 2);
    await s.ok('E5', { action: 'places_now', store: 'S2' });   // ほかの店はまだ取れる
  }
  {
    const s = await setup({ caps: { places_person_day_max: 2 } });
    await link(s);
    await s.ok('E5', { action: 'places_now', store: 'S1' }); await s.ok('E5', { action: 'places_now', store: 'S2' });
    const r = await s.call('E5', { action: 'places_now', store: 'S1' });
    assert.deepEqual(r.body, { error: 'places_cap', cap: 'person', max: 2 });
    await s.ok('E2', { action: 'places_now', store: 'S1' });   // ほかの人はまだ取れる
    assert.equal(s.detailCalls(), 3);
  }
  {
    const s = await setup({ caps: { places_day_max: 3 } });
    await link(s);
    for (const st of ['S1', 'S2', 'S3']) await s.ok('E2', { action: 'places_now', store: st });
    const r = await s.call('E1', { action: 'places_now', store: 'S1' });
    assert.deepEqual(r.body, { error: 'places_cap', cap: 'day', max: 3 });
    assert.equal(s.detailCalls(), 3); assert.equal(await s.used(), 3);
    const st = await s.ok('E2', { action: 'status' });
    assert.equal(st.usage.now.day, 3); assert.equal(st.usage.now.day_max, 3); assert.equal(st.usage.tz, 'America/Los_Angeles');
    assert.equal((await s.ok('E8', { action: 'status' })).usage, undefined, 'only GM・CEO see the counts');
  }
  {
    const s = await setup({ caps: { places_month_max: 5 } });
    await link(s);
    // 同じ月の前の日に 4 回（太平洋時間の今日の 1 日前。今日が 1 日なら今日に入れる）
    await s.sqlq(`insert into public.gr_places_use (day, kind, scope, n) values (greatest(date_trunc('month', (now() at time zone 'America/Los_Angeles'))::date,
      (now() at time zone 'America/Los_Angeles')::date - 1), 'now', 'all', 4)`);
    await s.ok('E2', { action: 'places_now', store: 'S1' });
    const r = await s.call('E2', { action: 'places_now', store: 'S2' });
    assert.deepEqual(r.body, { error: 'places_cap', cap: 'month', max: 5 });
    assert.equal(s.detailCalls(), 1);
    // 前の月の回数は数えない
    await s.sqlq(`update public.gr_settings set places_month_max = 10`);
    await s.sqlq(`insert into public.gr_places_use (day, kind, scope, n) values ((date_trunc('month', (now() at time zone 'America/Los_Angeles')) - interval '3 days')::date, 'now', 'all', 50)`);
    await s.ok('E2', { action: 'places_now', store: 'S2' });
  }
  {
    const s = await setup({ caps: { places_day_max: 0 } });   // 0 にするとその呼び出しを止める
    await link(s);
    assert.deepEqual((await s.call('E2', { action: 'places_now', store: 'S1' })).body, { error: 'places_cap', cap: 'day', max: 0 });
    assert.equal(s.g.calls.length, 0);
  }
  {
    const s = await setup({ caps: { search_day_max: 1 } });
    await s.ok('E2', { action: 'places_search', q: 'Fake one' });
    assert.deepEqual((await s.call('E1', { action: 'places_search', q: 'Fake two' })).body, { error: 'places_cap', cap: 'day', max: 1 });
    assert.equal(s.g.calls.length, 1);
    await s.sqlq(`update public.gr_settings set search_day_max = 40, search_month_max = 1`);
    assert.deepEqual((await s.call('E2', { action: 'places_search', q: 'Fake three' })).body, { error: 'places_cap', cap: 'month', max: 1 });
    assert.equal(s.g.calls.length, 1);
    await link(s, ['S1']);   // 店を探す回数と店の評価の回数は別
    await s.ok('E2', { action: 'places_now', store: 'S1' });
  }
});

test('only stores in the store master can be linked or fetched (a removed store stops)', async () => {
  const s = await setup({ stores: ['S1', 'S2'] });
  const bad = await s.call('E2', { action: 'places_set', store: 'S9', place_id: PID.S3 });
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'unknown_store');
  await link(s, ['S1', 'S2']);
  await s.ok('E2', { action: 'places_now', store: 'S2' });
  // 店舗マスターで消した店・使っていない店は取らない
  await s.sqlq(`update public.stores set data = jsonb_set(data, '{_deleted}', 'true') where id = 'S2'`);
  await s.sqlq(`update public.stores set active = false where id = 'S1'`);
  for (const st of ['S1', 'S2']) {
    const before = s.detailCalls(), u = await s.used();
    const r = await s.call('E2', { action: 'places_now', store: st });
    assert.equal(r.status, 400, st + ' ' + r.text); assert.equal(r.body.error, 'unknown_store');
    assert.equal(s.detailCalls(), before); assert.equal(await s.used(), u);
  }
  // 外すのはいつでも
  assert.deepEqual(await s.ok('E2', { action: 'places_set', store: 'S2', place_id: null }), { store: 'S2', place: false });
  assert.deepEqual((await s.ok('E2', { action: 'places_now', store: 'S2' })), { store: 'S2', linked: false });
});

test('a person who cannot see a store cannot learn whether it is linked, and the screen never gets a place ID', async () => {
  const s = await setup();
  await link(s, ['S2']);
  const a = await s.call('E8', { action: 'places_now', store: 'S2' });
  const b = await s.call('E8', { action: 'places_now', store: 'S3' });   // 結んでいない店
  assert.equal(a.status, 403); assert.equal(b.status, 403);
  assert.equal(a.text, b.text, 'same answer for a linked and an unlinked store');
  const st = await s.ok('E8', { action: 'status' });
  assert.ok(!JSON.stringify(st).includes('ChIJ'), 'status does not send place IDs to staff');
});
