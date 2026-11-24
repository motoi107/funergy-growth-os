// v1209 Google の評価・口コミ（Places API（新））：見られる店だけ・回数の上限・押したときだけ・必要な項目だけ・鍵を出さない。
// 本物の SQL（v1157 → v1209・PGlite）と本物の handler、偽の Google、合成データだけ。本番にはつながない。仕様：docs/GOOGLE_PLACES_V1209_JA.md
// だれか（work-requests の whoami）は代わり。見られる店（stores・am_stores）とグレード（grade）は whoami の答えと同じ形。
// 11/23 14:36 の更新（SQL 20261215100000）：住所で確かめた店だけ・AM は担当の店・G4 以下は配属の店（社員の表の store）・上限は店の数から。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/google-reviews/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const SQL1209 = fs.readFileSync(new URL('../supabase/migrations/20261215090000_google_places_caps.sql', import.meta.url), 'utf8');
const SQL1215 = fs.readFileSync(new URL('../supabase/migrations/20261215100000_google_places_scope.sql', import.meta.url), 'utf8');
const KEY = 'places-key-SECRET-1234567890';
const NOW0 = Date.parse('2026-11-23T20:00:00Z');
const NOW_MASK = 'id,displayName,formattedAddress,googleMapsUri,rating,userRatingCount,reviews,attributions';
// 社員：役割・グレード・見られる店（whoami と同じ形）と配属の店（社員の表の store）
//   E9 は GM・CEO が確かめた Corporate Chef（G5）、E10 は確かめがまだの Head Chef（G4）
//   E5 の AM は自分の店（S3）も whoami の stores にあるが、担当（管轄）の S1・S2 だけ
//   E6 の G3 は応援の店（S2）も whoami の stores にあるが、配属の S1 だけ
const PEOPLE = {
  E1: { role: 'ceo', grade: 7, stores: [], am_stores: [] }, E2: { role: 'gm', grade: 6, stores: [], am_stores: [] },
  E3: { role: 'office', grade: 4, stores: [], am_stores: [] }, E4: { role: 'office_crew', grade: 2, stores: [], am_stores: [] },
  E5: { role: 'am', grade: 5, stores: ['S3'], am_stores: ['S1', 'S2'], home: 'S3' }, E6: { role: 'sl', grade: 3, stores: ['S1', 'S2'], am_stores: [], home: 'S1' },
  E8: { role: 'crew', grade: 1, stores: ['S1'], am_stores: [], home: 'S1' }, E7: { role: 'crew', grade: 1, stores: [], am_stores: [] },
  E9: { role: 'chef', grade: 5, stores: ['S1'], am_stores: [], home: 'S1' }, E10: { role: 'chef', grade: 4, stores: ['S1'], am_stores: [], home: 'S1' },
  E11: { role: 'g4', grade: 4, stores: ['ALL'], am_stores: [], home: 'ALL' },       // 本部所属（ALL）の G4：店は見ない
  E12: { role: 'sl', grade: 5, stores: ['S2', 'S3'], am_stores: [], home: 'S2' },   // G5（Customer Service Manager など・AM でない）：whoami の店
  E13: { role: 'crew', grade: 1, stores: ['S1'], am_stores: [], home: 'S2' },       // 配属の店が whoami の店に無い：見ない
  E14: { role: 'crew', stores: ['S1'], am_stores: [], home: 'S1' },                 // グレードが分からない：G4 以下と同じ
};
const meOf = id => { const { home, ...p } = PEOPLE[id]; return { emp: id, name: 'Person ' + id, ...p }; };
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

// sql：'v1157'＝v1157 だけ／'v1209'＝v1209 の上限まで（11/23 の SQL がまだ）／true＝ぜんぶ。stores：店舗マスターの表を作る（店の ID の配列）
// caps：gr_settings を変える（初めの 1 店 1 日 1 回のままだと多くの試験が止まるので、ここでは store を 50 にしておく）
async function setup({ sql = true, env = {}, caps = {}, stores = null, chef = true, hints = true } = {}) {
  caps = { places_store_day_max: 50, ...caps };
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
  // 社員の表（配属の店だけ）
  await pg.exec(`create table public.employees (id text primary key, name text, store text); grant select on public.employees to service_role;`);
  for (const [id, p] of Object.entries(PEOPLE)) await pg.query('insert into public.employees (id, name, store) values ($1, $2, $3)', [id, 'Person ' + id, p.home || null]);
  await pg.exec(SQL);
  if (sql !== 'v1157') await pg.exec(SQL1209);
  if (sql === true) await pg.exec(SQL1215);
  // 合成の店の住所の目安（偽の Google の住所 1 Fake St … 96826・名前 Place ____）
  if (sql === true && hints) for (const id of ['S1', 'S2', 'S3']) {
    await pg.query(`insert into public.gr_place_hint (store_id, addr, names) values ($1, '{1,fake,96826}', '{place}')`, [id]);
  }
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
// 結ぶ（GM が画面から。Google の住所で確かめる）。そのあと、確かめのための呼び出しと回数は消す（ほかの試験の数を分かりやすく）
const link = async (s, stores = ['S1', 'S2', 'S3']) => {
  for (const id of stores) {
    const r = await s.ok('E2', { action: 'places_set', store: id, place_id: PID[id] });
    assert.equal(r.confirmed, true, 'linked by address ' + id); assert.equal(r.how, 'address');
  }
  await s.sqlq('delete from public.gr_places_use');
  s.g.calls.length = 0; s.g.heads.length = 0;
};
// SQL で直接結ぶ（前の版の SQL の試験だけ）
const linkSql = async (s, stores) => { for (const id of stores) await s.sqlq(`insert into public.gr_places (store_id, place_id, set_emp, set_name, set_at) values ($1, $2, 'E2', 'GM', now())`, [id, PID[id]]); };

test('before the v1209 SQL: the screen is told the server is older and Google is never called', async () => {
  const s = await setup({ sql: 'v1157' });
  await linkSql(s, ['S1']);
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
  assert.equal((await s.ok('E2', { action: 'whoami' })).fn, 3);
});

test('before the 11/23 SQL (v1209 only): nothing is fetched or linked, and Google is never called', async () => {
  const s = await setup({ sql: 'v1209' });
  await linkSql(s, ['S1']);
  for (const who of ['E2', 'E5', 'E8']) {
    const r = await s.call(who, { action: 'places_now', store: 'S1' });
    assert.equal(r.status, 503, who + ' ' + r.text); assert.equal(r.body.error, 'gr_old');
  }
  const set = await s.call('E2', { action: 'places_set', store: 'S2', place_id: PID.S2 });
  assert.equal(set.status, 503); assert.equal(set.body.error, 'gr_old');
  assert.equal(s.g.calls.length, 0, 'no call to Google before the address check exists');
  assert.equal(await s.used(), 0); assert.equal(await s.used('search'), 0);
});

test('who can see which store: CEO・GM・経理・事務Crew＝全店／AM＝担当の店だけ／G4 以下＝配属の店だけ（応援の店は入れない）／G5＝確かめた Corporate Chef は全店', async () => {
  const s = await setup();
  await link(s);
  // 全店の人
  for (const who of ['E1', 'E2', 'E3', 'E4', 'E9']) {
    for (const store of ['S1', 'S2', 'S3']) {
      const r = await s.ok(who, { action: 'places_now', store });
      assert.equal(r.linked, true, who + ' ' + store);
    }
  }
  // 担当の店だけ（E5 の AM は自分の S3 を見ない・E6 の G3 は応援の S2 を見ない・E11 の本部所属・E13 の配属が whoami に無い人は見ない）
  const seen = { E5: ['S1', 'S2'], E6: ['S1'], E8: ['S1'], E10: ['S1'], E7: [], E11: [], E12: ['S2', 'S3'], E13: [], E14: ['S1'] };
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
  // Head Chef（G4）は配属の店だけ（v1209 の前の版は全店だった）
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
  const g3 = await s.ok('E6', { action: 'kpi' });
  assert.deepEqual(g3.places, ['S1'], 'G3: the support store is not included'); assert.deepEqual(Object.keys(g3.overall), ['S1']);
  const hq = await s.ok('E11', { action: 'kpi' });
  assert.deepEqual(hq.places, []); assert.deepEqual(hq.overall, {});
  // 店舗の Business Profile の評価（status）も見られる店の分だけ
  const stCrew = await s.ok('E8', { action: 'status' });
  assert.deepEqual(Object.keys(stCrew.stores), ['S1']); assert.equal(stCrew.places_admin, undefined);
  const stAm = await s.ok('E5', { action: 'status' });
  assert.deepEqual(Object.keys(stAm.stores).sort(), ['S1', 'S2']);
  assert.deepEqual(Object.keys((await s.ok('E7', { action: 'status' })).stores), []);
  const stGm = await s.ok('E2', { action: 'status' });
  assert.deepEqual(Object.keys(stGm.stores).sort(), ['S1', 'S2', 'S3']);
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
  // 鍵が無いと画面から結べない（確かめに Google を使う）ので、確かめた店を SQL で作る
  const nk = await s.call('E2', { action: 'places_set', store: 'S1', place_id: PID.S1 });
  assert.equal(nk.status, 503); assert.equal(nk.body.error, 'places_not_configured');
  await s.sqlq(`insert into public.gr_places (store_id, place_id, set_emp, set_name, set_at, confirmed_place, confirm_how, confirmed_emp, confirmed_name, confirmed_at)
    values ('S1', $1, 'E2', 'GM', now(), $1, 'address', 'E2', 'GM', now())`, [PID.S1]);
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
    await link(s, ['S1']);   // 結んで、確かめの回数は消す
    await s.ok('E2', { action: 'places_search', q: 'Fake one' });
    assert.deepEqual((await s.call('E1', { action: 'places_search', q: 'Fake two' })).body, { error: 'places_cap', cap: 'day', max: 1 });
    // 店を確かめる（Place Details の名前と住所）も「店を探す」と同じ上限
    assert.deepEqual((await s.call('E2', { action: 'places_set', store: 'S2', place_id: PID.S2 })).body, { error: 'places_cap', cap: 'day', max: 1 });
    assert.equal(s.g.calls.length, 1);
    await s.sqlq(`update public.gr_settings set search_day_max = 40, search_month_max = 1`);
    assert.deepEqual((await s.call('E2', { action: 'places_search', q: 'Fake three' })).body, { error: 'places_cap', cap: 'month', max: 1 });
    assert.equal(s.g.calls.length, 1);
    await s.ok('E2', { action: 'places_now', store: 'S1' });   // 店を探す回数と店の評価の回数は別
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

// ---- 11/23 14:36 の更新：住所で確かめて結ぶ・確かめていない店は呼ばない・上限は店の数から
const PIDX = { S1: PID.S1, S2: PID.S2, S3: PID.S3, S4: 'ChIJ_fake_place_four_004' };

test('linking checks Google’s address against the store’s address hint (no hint → Google is not called; wrong address → not linked)', async () => {
  const s = await setup();
  // 目安の無い店：Google を呼ばずに止める（店舗マスターが無い環境では S4 も「知っている店」）
  const nh = await s.call('E2', { action: 'places_set', store: 'S4', place_id: PIDX.S4 });
  assert.equal(nh.status, 409); assert.equal(nh.body.error, 'no_hint');
  assert.equal(s.g.calls.length, 0); assert.equal(await s.used('search'), 0);
  // 住所が合う・名前も合う → 住所で確かめた。Google の名前と住所は答えに出すが残さない
  const ok1 = await s.ok('E2', { action: 'places_set', store: 'S1', place_id: PID.S1 });
  assert.deepEqual({ ...ok1, name: undefined, address: undefined }, { store: 'S1', place: true, confirmed: true, how: 'address', name: undefined, address: undefined });
  assert.equal(ok1.address, '1 Fake St, Honolulu, HI 96826');
  const h = s.g.heads.at(-1);
  assert.equal(h.h['x-goog-fieldmask'], 'id,displayName,formattedAddress', 'only the name and address to check (no rating or reviews)');
  assert.equal(await s.used('search'), 1, 'the check is counted like a search'); assert.equal(await s.used(), 0, 'not counted as a store view');
  const row = (await s.sqlq('select * from public.gr_places where store_id = $1', ['S1']))[0];
  assert.equal(row.confirm_how, 'address'); assert.equal(row.confirmed_place, PID.S1); assert.equal(row.confirmed_emp, 'E2');
  for (const k of Object.keys(row)) assert.ok(!/addr|name_g|rating|review/.test(k), 'no Google content kept: ' + k);
  // 住所が合わない：結ばない（手で確かめるでも通さない）
  await s.sqlq(`update public.gr_place_hint set addr = '{2334,king,96826}' where store_id = 'S2'`);
  for (const confirm of [false, true]) {
    const bad = await s.call('E2', { action: 'places_set', store: 'S2', place_id: PID.S2, confirm });
    assert.equal(bad.status, 409, bad.text); assert.equal(bad.body.error, 'address_mismatch');
    assert.equal(bad.body.address, '1 Fake St, Honolulu, HI 96826', 'the screen can show what Google said');
  }
  assert.equal((await s.sqlq('select count(*)::int n from public.gr_places where store_id = $1', ['S2']))[0].n, 0);
  // 同じ Google の店を 2 つの店に確かめない（同じ建物の 2 店など）
  const taken = await s.call('E2', { action: 'places_set', store: 'S3', place_id: PID.S1 });
  assert.equal(taken.status, 409); assert.equal(taken.body.error, 'place_taken');
  // 外す
  assert.deepEqual(await s.ok('E2', { action: 'places_set', store: 'S1', place_id: null }), { store: 'S1', place: false });
  assert.equal(s.g.heads.filter(x => !x.url.startsWith('https://places.googleapis.com/')).length, 0);
});

test('when the name does not match or the store is marked unsure (same building / maybe not on Google Maps), GM・CEO must confirm by hand', async () => {
  const s = await setup();
  await s.sqlq(`update public.gr_place_hint set names = '{lala}', unsure = true where store_id = 'S2'`);
  await s.sqlq(`update public.gr_place_hint set names = '{toriton}' where store_id = 'S3'`);
  for (const [store, reason] of [['S2', 'unsure'], ['S3', 'name']]) {
    const r = await s.call('E2', { action: 'places_set', store, place_id: PIDX[store] });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.error, 'need_confirm'); assert.equal(r.body.reason, reason);
    assert.match(r.body.name, /^Place /);
    assert.equal((await s.sqlq('select count(*)::int n from public.gr_places where store_id = $1', [store]))[0].n, 0, 'not linked until confirmed');
    const ok = await s.ok('E1', { action: 'places_set', store, place_id: PIDX[store], confirm: true });
    assert.equal(ok.how, 'manual');
  }
  const admin = (await s.ok('E2', { action: 'status' })).places_admin;
  const by = Object.fromEntries(admin.map(x => [x.store, x]));
  assert.equal(by.S2.how, 'manual'); assert.equal(by.S2.unsure, true); assert.equal(by.S2.by, 'Person E1');
  assert.equal(by.S1.linked, false); assert.equal(by.S1.hint, true);
});

test('a store linked before the address check (v1157 / v1209) is not fetched until GM・CEO confirm it', async () => {
  const s = await setup();
  await linkSql(s, ['S1']);   // 前の版で結んだ店（確かめの印なし）
  const r = await s.ok('E2', { action: 'places_now', store: 'S1' });
  assert.deepEqual(r, { store: 'S1', linked: false, unconfirmed: true });
  const crew = await s.ok('E8', { action: 'places_now', store: 'S1' });
  assert.deepEqual(crew, { store: 'S1', linked: false, unconfirmed: true });
  assert.equal(s.g.calls.length, 0); assert.equal(await s.used(), 0);
  assert.deepEqual((await s.ok('E2', { action: 'kpi' })).places, [], 'not in the list of stores with the button');
  const by = Object.fromEntries((await s.ok('E2', { action: 'status' })).places_admin.map(x => [x.store, x]));
  assert.equal(by.S1.linked, true); assert.equal(by.S1.confirmed, false); assert.equal(by.S1.place_id, PID.S1);
  // 確かめれば見られる
  await s.ok('E2', { action: 'places_set', store: 'S1', place_id: PID.S1 });
  assert.equal((await s.ok('E8', { action: 'places_now', store: 'S1' })).linked, true);
  // 外して SQL で別の place ID を入れた（確かめた ID と違う）店も取らない
  await s.sqlq(`update public.gr_places set place_id = $1 where store_id = 'S1'`, [PID.S3]);
  assert.equal((await s.ok('E2', { action: 'places_now', store: 'S1' })).unconfirmed, true);
});

test('default caps come from the number of confirmed stores: 1 call per store per day; month = stores × days', async () => {
  const s = await setup({ caps: { places_store_day_max: 1 } });
  await link(s, ['S1', 'S2']);
  await linkSql(s, []);
  const u0 = (await s.ok('E2', { action: 'status' })).usage.now;
  const days = new Date(Date.UTC(2026, 11, 0)).getUTCDate();   // 11 月（試験の日の太平洋時間の月）
  assert.equal(u0.stores, 2); assert.equal(u0.day_max, 2); assert.equal(u0.store_day_max, 1);
  assert.equal(u0.day_ceiling, 40); assert.equal(u0.month_ceiling, 900);
  assert.ok(u0.month_max === Math.min(900, 2 * u0.days) && u0.days >= 28 && u0.days <= 31, JSON.stringify(u0));
  void days;
  const first = await s.ok('E8', { action: 'places_now', store: 'S1' });
  assert.equal(first.store_left, 0);
  const again = await s.call('E2', { action: 'places_now', store: 'S1' });
  assert.deepEqual(again.body, { error: 'places_cap', cap: 'store', max: 1 }, 'the second view of the same store on the same day is not fetched');
  await s.ok('E2', { action: 'places_now', store: 'S2' });
  // 確かめていない店（S3）は数に入らない・呼ばない
  await linkSql(s, ['S3']);
  assert.equal((await s.ok('E2', { action: 'places_now', store: 'S3' })).unconfirmed, true);
  const u1 = (await s.ok('E2', { action: 'status' })).usage.now;
  assert.equal(u1.stores, 2); assert.equal(u1.day, 2); assert.deepEqual(u1.by_store, { S1: 1, S2: 1 });
  assert.equal(s.detailCalls(), 2);
});

test('the SQL sets the default to 1 per store per day only where it was the v1209 default (10); a value someone chose is kept', async () => {
  for (const [before, after] of [[10, 1], [5, 5]]) {
    const s = await setup({ sql: 'v1209', caps: { places_store_day_max: before } });
    await s.pg.exec('reset role'); await s.pg.exec(SQL1215); await s.pg.exec(SQL1215);   // 2 回流しても同じ
    const r = await s.pg.query('select places_store_day_max n from public.gr_settings where id = 1');
    assert.equal(r.rows[0].n, after);
    const h = await s.pg.query('select store_id, unsure from public.gr_place_hint order by store_id');
    assert.deepEqual(h.rows.map(x => x.store_id), ['F01', 'F02', 'F04-A', 'F04-K', 'F04-P', 'F05', 'F06']);
    assert.equal(h.rows.find(x => x.store_id === 'F06').unsure, true, 'LaLa needs a hand check');
    // サーバーの鍵だけ（公開の鍵では読めない・呼べない）
    for (const role of ['anon', 'authenticated']) {
      await s.pg.exec('set role ' + role);
      await assert.rejects(s.pg.query('select * from public.gr_place_hint'));
      await assert.rejects(s.pg.query(`select public.gr_place_confirm('{}'::jsonb)`));
      await assert.rejects(s.pg.query(`select public.gr_home_store('{"emp":"E8"}'::jsonb)`));
      await s.pg.exec('reset role');
    }
  }
});

test('G4 and below see only the home store; without the employee table nothing is shown (fail closed)', async () => {
  const s = await setup();
  await link(s);
  await s.sqlq('drop table public.employees');
  // 覚えが切れるように時間を進める（だれかの覚えは 60 秒）
  s.setNow(NOW0 + 120000);
  const r = await s.call('E8', { action: 'places_now', store: 'S1' });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'forbidden_store');
  assert.deepEqual((await s.ok('E8', { action: 'kpi' })).places, []);
  // 全店の人・AM は社員の表を使わない
  assert.equal((await s.ok('E5', { action: 'places_now', store: 'S2' })).linked, true);
  assert.equal(s.detailCalls(), 1);
});

test('the address hint check: real-store hints match a Google-style address and reject the neighbour', async () => {
  const s = await setup({ stores: ['F01', 'F02', 'F04-A', 'F04-P', 'F06'] });
  const conf = async (store, name, addr, manual = false) => {
    try { return await s.sqlq(`select public.gr_place_confirm($1::jsonb) v`, [JSON.stringify({ emp: 'E2', name: 'GM', store, place_id: 'ChIJ_test_' + store.replace('-', '_') + '_xx', g_name: name, g_addr: addr, manual })]).then(r => r[0].v); }
    catch (e) { return { error: String(e.message).split(/[\s:]/)[0] }; }
  };
  // 合成の住所（Google の住所の形をまねたもの・本物の照合ではない）
  assert.equal((await conf('F01', 'ToriTon', '2334 S King St, Honolulu, HI 96826, USA')).how, 'address');
  assert.equal((await conf('F02', 'ToriTon', '2334 S King St, Honolulu, HI 96826, USA')).need, 'manual', 'same building, other store’s name');
  assert.equal((await conf('F04-A', 'Totoya Aiea', '99-115 Aiea Heights Dr, Aiea, HI 96701, USA')).how, 'address');
  assert.equal((await conf('F04-P', 'Totoya Piikoi', '9436 Piikoi St, Honolulu, HI 96814, USA')).error, 'address_mismatch', 'a number must match as a whole word');
  assert.equal((await conf('F06', 'LaLa', '436 Piikoi St, Honolulu, HI 96814, USA')).reason, 'unsure', 'LaLa is checked by hand');
});
