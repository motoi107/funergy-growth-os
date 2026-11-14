-- v1157：Google の口コミ（UI案73・Moto さん 11/13 18:42 HST の答え：1 はい・2 はい（Business Profile をつなぐまでは手入力）・
--        3 はい（その月の口コミをすべて会議に出す）・4 はい（設定は KPI設定の中））。仕様：docs/GOOGLE_REVIEWS_V1157_JA.md
-- ・Places API（新）：店の総合評価・件数・Google が返す口コミ（最大 5 件）は、見るときに関数が取る。Google の決まり（place ID の
--   ほかは残してはいけない）に合わせ、この SQL が残すのは店と place ID だけ。
-- ・Business Profile API（自分の店のデータ）：毎日 4:30（ハワイ）に関数が口コミを取り、ここに残す。月はハワイ時間の投稿日。
-- ・表はどれも公開の鍵（anon・authenticated）で読めない・書けない。関数 gr_* はサーバーの鍵だけ（security invoker）。
-- ・アプリ・ほかの表・共通データ（app_state）は変えない。2 回流しても同じ。戻すとき：deploy/google-reviews-v1157/戻す.md。

-- ---------------------------------------------------------------- 表
create table if not exists public.gr_settings (
  id int primary key default 1 check (id = 1),
  worker_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);
insert into public.gr_settings (id) values (1) on conflict (id) do nothing;

-- 店 → Google の店（Places の place ID。Google の決まりで残してよいのは ID だけ）
create table if not exists public.gr_places (
  store_id text primary key check (store_id ~ '^[A-Za-z0-9_-]{1,30}$'),
  place_id text not null check (length(place_id) between 10 and 300 and place_id ~ '^[A-Za-z0-9_-]+$'),
  set_emp text, set_name text, set_at timestamptz not null default now()
);

-- Business Profile のつなぎ（1 つだけ）。refresh token はサーバーだけ
create table if not exists public.gr_bp (
  id int primary key default 1 check (id = 1),
  account text,                       -- つないだ Google アカウント（メール）
  refresh_token text,
  scopes text[] not null default '{}'::text[],
  status text not null default 'none' check (status in ('none', 'ok', 'pending', 'expired', 'error')),
  error text,
  connected_emp text, connected_name text, connected_at timestamptz,
  checked_at timestamptz,
  last_ok_at timestamptz              -- 口コミを取れた最後の時刻
);
insert into public.gr_bp (id) values (1) on conflict (id) do nothing;

-- OAuth のとちゅう（state の sha256 と PKCE の verifier・10 分・1 回だけ）
create table if not exists public.gr_oauth (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  verifier text not null,
  emp text, name text,
  created_at timestamptz not null default now()
);

-- 店 → Business Profile の店（自分の店のデータ・名前と総合評価も残してよい）
create table if not exists public.gr_bp_loc (
  store_id text primary key check (store_id ~ '^[A-Za-z0-9_-]{1,30}$'),
  account text not null check (account ~ '^accounts/[0-9]{1,30}$'),
  location text not null check (location ~ '^locations/[0-9]{1,30}$'),
  title text check (title is null or length(title) <= 200),
  rating numeric(3,2), total int, rating_at timestamptz,
  synced_at timestamptz,              -- 最後に口コミを取れた時刻（次はここから 3 日さかのぼる）
  from_ym text check (from_ym is null or from_ym ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),   -- 口コミを全部取れている最初の月（初めて取り終えたときに決まる・これより前の月は手入力のまま）
  set_emp text, set_name text, set_at timestamptz not null default now()
);

-- Business Profile の口コミ（月はハワイ時間の投稿日）
create table if not exists public.gr_reviews (
  name text primary key check (length(name) <= 400),
  store_id text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 6000),
  reviewer text check (reviewer is null or length(reviewer) <= 200),
  created timestamptz not null,
  updated timestamptz,
  ym text not null check (ym ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  replied boolean not null default false,
  seen_at timestamptz not null default now(),
  gone_at timestamptz   -- #151 の再レビュー：前の回の取り込みで Google に無かった（次の回にも無ければ消す）
);
alter table public.gr_reviews add column if not exists gone_at timestamptz;
-- #151 の Codex（6880096590・P3）：口コミの中身をどの取り込みが書いたか（取り込みを始めた時刻）。返信しても Google の updateTime が変わらないとき、
--   同じ updateTime なら、前に始めた取り込みがあとから書いても、あとで始めた取り込みの返信の有無を戻さない
alter table public.gr_reviews add column if not exists put_from timestamptz;
create index if not exists gr_reviews_store_ym on public.gr_reviews (store_id, ym);
-- #155 の Codex（6876878458）の 3：総合評価・件数をどの取り込みが書いたか（取り込みを始めた時刻）。古い取り込みがあとから書いても戻さない
alter table public.gr_bp_loc add column if not exists rating_from timestamptz;
-- #151 のレビュー：1 つの Business Profile の店は 1 つの店にだけ（同時に結んでも 2 つにならない）
create unique index if not exists gr_bp_loc_location on public.gr_bp_loc (location);

-- 取った記録（200 件まで）
create table if not exists public.gr_runs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  ok boolean not null,
  info jsonb not null default '{}'::jsonb
);

do $$
declare t text;
begin
  foreach t in array array['gr_settings', 'gr_places', 'gr_bp', 'gr_oauth', 'gr_bp_loc', 'gr_reviews', 'gr_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 関数（サーバーの鍵だけ）
create or replace function public.gr_hst_ym(t timestamptz) returns text
language sql immutable set search_path = public, pg_temp as $$
  select to_char(t at time zone 'Pacific/Honolulu', 'YYYY-MM')
$$;

create or replace function public.gr_who(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
begin
 if jsonb_typeof(p->'emp') <> 'string' or length(p->>'emp') not between 1 and 64 then raise exception 'forbidden'; end if;
 return jsonb_build_object('emp', p->>'emp', 'name', left(coalesce(p->>'name', ''), 120));
end $$;

create or replace function public.gr_worker_key(p jsonb) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select worker_key from public.gr_settings where id = 1
$$;

-- 見せる形（GM・CEO には place ID・店の名前・アカウントも）
create or replace function public.gr_status(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare b public.gr_bp; mgr boolean := coalesce((p->>'mgr')::boolean, false); r jsonb;
begin
 select * into b from public.gr_bp where id = 1;
 select jsonb_build_object(
   'bp', jsonb_build_object('status', coalesce(b.status, 'none'), 'connected', b.refresh_token is not null,
          'connected_at', b.connected_at, 'checked_at', b.checked_at, 'last_ok_at', b.last_ok_at, 'error', b.error,
          'account', case when mgr then b.account end, 'by', case when mgr then b.connected_name end),
   'stores', coalesce((select jsonb_object_agg(s.sid, jsonb_build_object(
          'place', s.place_id is not null, 'place_id', case when mgr then s.place_id end,
          'loc', s.location is not null, 'title', case when mgr then s.title end,
          'rating', s.rating, 'total', s.total, 'rating_at', s.rating_at, 'synced_at', s.synced_at, 'from', s.from_ym))
        from (select coalesce(pl.store_id, l.store_id) sid, pl.place_id, l.location, l.title, l.rating, l.total, l.rating_at, l.synced_at, l.from_ym
                from public.gr_places pl full join public.gr_bp_loc l on l.store_id = pl.store_id) s), '{}'::jsonb),
   'run', (select jsonb_build_object('at', x.at, 'kind', x.kind, 'ok', x.ok, 'info', x.info) from public.gr_runs x order by x.id desc limit 1))
 into r;
 return r;
end $$;

create or replace function public.gr_place_set(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare w jsonb := public.gr_who(p); s text := p->>'store';
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if p->'place_id' is null or jsonb_typeof(p->'place_id') = 'null' then
   delete from public.gr_places where store_id = s;
   return jsonb_build_object('store', s, 'place', false);
 end if;
 if length(p->>'place_id') not between 10 and 300 or (p->>'place_id') !~ '^[A-Za-z0-9_-]+$' then raise exception 'bad_value'; end if;
 insert into public.gr_places (store_id, place_id, set_emp, set_name, set_at) values (s, p->>'place_id', w->>'emp', w->>'name', now())
   on conflict (store_id) do update set place_id = excluded.place_id, set_emp = excluded.set_emp, set_name = excluded.set_name, set_at = now();
 return jsonb_build_object('store', s, 'place', true);
end $$;

create or replace function public.gr_place_of(p jsonb) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select place_id from public.gr_places where store_id = p->>'store'
$$;

create or replace function public.gr_oauth_start(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare w jsonb := public.gr_who(p);
begin
 if (p->>'state_hash') !~ '^[0-9a-f]{64}$' or length(coalesce(p->>'verifier', '')) not between 43 and 128 then raise exception 'bad_value'; end if;
 delete from public.gr_oauth where created_at < now() - interval '10 minutes';
 insert into public.gr_oauth (state_hash, verifier, emp, name) values (p->>'state_hash', p->>'verifier', w->>'emp', w->>'name');
 return jsonb_build_object('ok', true);
end $$;

-- 1 回だけ（取ったら消す）・10 分まで
create or replace function public.gr_oauth_take(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare o public.gr_oauth;
begin
 delete from public.gr_oauth where state_hash = coalesce(p->>'state_hash', '') returning * into o;
 if o.state_hash is null or o.created_at < now() - interval '10 minutes' then raise exception 'bad_state'; end if;
 return jsonb_build_object('verifier', o.verifier, 'emp', o.emp, 'name', o.name);
end $$;

create or replace function public.gr_bp_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if length(coalesce(p->>'refresh_token', '')) not between 10 and 2000 then raise exception 'bad_value'; end if;
 if coalesce(p->>'status', '') not in ('ok', 'pending', 'error') then raise exception 'bad_value'; end if;
 update public.gr_bp set account = left(p->>'account', 200), refresh_token = p->>'refresh_token',
   scopes = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'scopes', '[]'::jsonb)) x), '{}'::text[]),
   status = p->>'status', error = left(p->>'error', 200),
   connected_emp = left(p->>'emp', 64), connected_name = left(p->>'name', 120), connected_at = now(), checked_at = now()
  where id = 1;
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.gr_bp_mark(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if coalesce(p->>'status', '') not in ('ok', 'pending', 'expired', 'error') then raise exception 'bad_value'; end if;
 update public.gr_bp set status = p->>'status', error = left(p->>'error', 200), checked_at = now(),
   last_ok_at = case when coalesce((p->>'synced')::boolean, false) then now() else last_ok_at end
  where id = 1 and refresh_token is not null;
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.gr_bp_creds(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('refresh_token', refresh_token, 'status', status) from public.gr_bp where id = 1 and refresh_token is not null
$$;

-- 切る：鍵を忘れる。店との結びと取った口コミは残す（つなぎ直せば続きから）
create or replace function public.gr_bp_disconnect(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 perform public.gr_who(p);
 update public.gr_bp set refresh_token = null, scopes = '{}'::text[], status = 'none', error = null, checked_at = now() where id = 1;
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.gr_loc_set(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare w jsonb := public.gr_who(p); s text := p->>'store'; pat text;
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if p->'location' is null or jsonb_typeof(p->'location') = 'null' then
   delete from public.gr_bp_loc where store_id = s;
   return jsonb_build_object('store', s, 'loc', false);
 end if;
 if (p->>'location') !~ '^locations/[0-9]{1,30}$' or (p->>'account') !~ '^accounts/[0-9]{1,30}$' then raise exception 'bad_value'; end if;
 -- 1 つの Business Profile の店を 2 つの店に結ばない（同じ口コミを 2 回数えない）
 if exists (select 1 from public.gr_bp_loc where location = p->>'location' and store_id <> s) then raise exception 'conflict'; end if;
 insert into public.gr_bp_loc (store_id, account, location, title, set_emp, set_name, set_at)
   values (s, p->>'account', p->>'location', left(p->>'title', 200), w->>'emp', w->>'name', now())
   on conflict (store_id) do update set account = excluded.account, location = excluded.location, title = excluded.title,
     set_emp = excluded.set_emp, set_name = excluded.set_name, set_at = now(),
     synced_at = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.synced_at end,
     rating = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.rating end,
     total = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.total end,
     rating_at = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.rating_at end,
     rating_from = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.rating_from end,
     from_ym = case when public.gr_bp_loc.location = excluded.location then public.gr_bp_loc.from_ym end;
 -- 口コミは Business Profile の店（location）のもの。名前は accounts/…/locations/…/reviews/…
 pat := 'accounts/%/' || (p->>'location') || '/reviews/%';
 -- 結び直したら、前の店の口コミはこの店のものではない
 delete from public.gr_reviews r where r.store_id = s and r.name not like pat;
 -- #151 のレビュー：ほかの店から外してこの店に結び直したときは、その location の口コミもこの店へ（前の店に残さない）
 update public.gr_reviews r set store_id = s where r.name like pat and r.store_id <> s;
 return jsonb_build_object('store', s, 'loc', true);
exception when unique_violation then raise exception 'conflict';   -- 同時に別の店へ結んだ
end $$;

create or replace function public.gr_locs(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  -- now：この取り込みを始めた時刻（データベースの時計）。消すときは、これより後に入った・確かめた口コミを触らない（#151 の再レビュー）
  select coalesce(jsonb_agg(jsonb_build_object('store', store_id, 'account', account, 'location', location, 'synced_at', synced_at, 'now', now()) order by store_id), '[]'::jsonb)
    from public.gr_bp_loc
$$;

-- 口コミを入れる（同じ name は直す）。ym はハワイ時間の投稿日。総合評価（Business Profile の数）も入れる
-- #155 の Codex（6876878458）の 3：重なった取り込み。古い一覧を読んだ取り込みがあとから入れても、新しい値を戻さない。
--   ・口コミの中身（星・本文・名前・返信）は、Google の更新時刻（updated）が今ある値より古くないときだけ直す。
--   ・総合評価・件数は、取り込みを始めた時刻（started＝gr_locs の now）が、今の値を書いた取り込みより前なら書かない。
--   ・取り終えた時刻（synced_at）は、取り込みを始めた時刻にする（戻さない）。started の無い前の関数は今までどおり。
-- 新しい値で直してよいか：Google の更新時刻が新しい。同じなら、取り込みを始めた時刻が前でない（どちらかが分からないときは今までどおり直す）
create or replace function public.gr_newer(o_upd timestamptz, o_from timestamptz, n_upd timestamptz, n_from timestamptz) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select o_upd is null or n_upd > o_upd or (n_upd = o_upd and (n_from is null or o_from is null or n_from >= o_from));
$$;
create or replace function public.gr_reviews_put(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare s text := p->>'store'; l public.gr_bp_loc; x jsonb; n int := 0; pre text; st timestamptz := null; v_agg boolean;
begin
 if p ? 'started' and jsonb_typeof(p->'started') <> 'null' then
   if jsonb_typeof(p->'started') <> 'string' then raise exception 'bad_value'; end if;
   begin st := (p->>'started')::timestamptz; exception when others then raise exception 'bad_value'; end;
   if st > now() or st < now() - interval '1 day' then raise exception 'bad_value'; end if;
 end if;
 select * into l from public.gr_bp_loc where store_id = s for update;   -- 結び直しと重ならない（#151 のレビュー）
 if l.store_id is null then raise exception 'not_found'; end if;
 if (p->>'location') is distinct from l.location then raise exception 'conflict'; end if;   -- 取っているあいだに結び直された
 pre := l.account || '/' || l.location || '/reviews/';
 for x in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
   if jsonb_typeof(x->'name') <> 'string' or left(x->>'name', length(pre)) <> pre or length(x->>'name') > 400 then raise exception 'bad_value'; end if;
   if jsonb_typeof(x->'rating') <> 'number' or (x->>'rating')::int not between 1 and 5 then raise exception 'bad_value'; end if;
   insert into public.gr_reviews (name, store_id, rating, comment, reviewer, created, updated, ym, replied, seen_at, put_from)
   values (x->>'name', s, (x->>'rating')::int, left(nullif(x->>'comment', ''), 6000), left(nullif(x->>'reviewer', ''), 200),
           (x->>'created')::timestamptz, (x->>'updated')::timestamptz, public.gr_hst_ym((x->>'created')::timestamptz),
           coalesce((x->>'replied')::boolean, false), now(), st)
   on conflict (name) do update set store_id = excluded.store_id, ym = excluded.ym, created = excluded.created,   -- 結び直した店へ移す（#151 のレビュー）
     rating = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then excluded.rating else public.gr_reviews.rating end,
     comment = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then excluded.comment else public.gr_reviews.comment end,
     reviewer = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then excluded.reviewer else public.gr_reviews.reviewer end,
     replied = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then excluded.replied else public.gr_reviews.replied end,
     put_from = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then st else public.gr_reviews.put_from end,
     updated = case when public.gr_newer(public.gr_reviews.updated, public.gr_reviews.put_from, excluded.updated, st) then excluded.updated else public.gr_reviews.updated end,
     seen_at = now(), gone_at = null;
   n := n + 1;
 end loop;
 -- 総合評価・件数：あとで始めた取り込みが書いた値を、前に始めた取り込みが戻さない
 v_agg := (jsonb_typeof(p->'rating') = 'number' or jsonb_typeof(p->'total') = 'number')
          and (st is null or l.rating_from is null or st >= l.rating_from);
 -- 初めて取り終えたとき、取り始めた月（ハワイ時間）を「全部取れている最初の月」にする。読めない値なら今の月（安全なほう）
 update public.gr_bp_loc set synced_at = case when coalesce((p->>'done')::boolean, false)
                                              then case when st is null then now() else greatest(coalesce(synced_at, st), st) end else synced_at end,
   from_ym = case when from_ym is null and coalesce((p->>'done')::boolean, false)
                  then case when coalesce(p->>'from_ym', '') ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' and (p->>'from_ym') <= public.gr_hst_ym(now()) then p->>'from_ym' else public.gr_hst_ym(now()) end
                  else from_ym end,
   rating = case when v_agg and jsonb_typeof(p->'rating') = 'number' then round((p->>'rating')::numeric, 2) else rating end,
   total = case when v_agg and jsonb_typeof(p->'total') = 'number' then (p->>'total')::int else total end,
   rating_at = case when v_agg and jsonb_typeof(p->'rating') = 'number' then now() else rating_at end,
   rating_from = case when v_agg then st else rating_from end
  where store_id = s;
 return jsonb_build_object('store', s, 'put', n);
end $$;

-- #151 のレビュー：Google で消された口コミを消す。関数が since から後に直された口コミを最後まで読めたときだけ呼ぶ
--   （途中で失敗・ページの上限で止まったときは呼ばない）。since より後に直された（または投稿された）口コミで、いま Google に無いもの＝消されたもの。
--   since は 100 日より前にしない（まちがって多く消さない）。この店の、結んでいる location の口コミだけ。
-- #151 の再レビュー（Codex 6875770314）：
--   ・started（この取り込みを始めた時刻＝gr_locs の now）より後に入った・確かめた口コミは触らない。
--     重なった取り込みの古い一覧が、あとから始めた取り込みの入れた口コミを消さない。
--   ・1 回で消さない。無かった口コミには印（gone_at）を付け、次の回（印より後に始めた取り込み）にも無ければ消す。
--     読んでいるあいだに並びが変わって 1 回だけ読み落としても消えない（次に読めれば印は外れる）。印のある口コミは消すまで数える。
--   ・names・since・started が無い・形が違うときは断る（NULL を通さない）。
create or replace function public.gr_reviews_prune(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare s text := p->>'store'; l public.gr_bp_loc; since timestamptz; started timestamptz; n int := 0; m int := 0;
begin
 if jsonb_typeof(p->'names') is distinct from 'array' or jsonb_typeof(p->'since') is distinct from 'string'
    or jsonb_typeof(p->'started') is distinct from 'string' then raise exception 'bad_value'; end if;
 begin since := (p->>'since')::timestamptz; started := (p->>'started')::timestamptz; exception when others then raise exception 'bad_value'; end;
 if since < now() - interval '100 days' or since > now() then raise exception 'bad_value'; end if;
 if started > now() or started < now() - interval '1 day' then raise exception 'bad_value'; end if;
 select * into l from public.gr_bp_loc where store_id = s for update;
 if l.store_id is null then raise exception 'not_found'; end if;
 if (p->>'location') is distinct from l.location then raise exception 'conflict'; end if;
 -- 前の回にも無かった（印がこの取り込みより前）口コミを消す
 delete from public.gr_reviews r
  where r.store_id = s and r.name like 'accounts/%/' || l.location || '/reviews/%'
    and coalesce(r.updated, r.created) >= since
    and r.seen_at < started and r.gone_at is not null and r.gone_at < started
    and not exists (select 1 from jsonb_array_elements_text(p->'names') x where x = r.name);
 get diagnostics n = row_count;
 -- 今回はじめて無かった口コミに印
 update public.gr_reviews r set gone_at = now()
  where r.store_id = s and r.name like 'accounts/%/' || l.location || '/reviews/%'
    and coalesce(r.updated, r.created) >= since
    and r.seen_at < started and r.gone_at is null
    and not exists (select 1 from jsonb_array_elements_text(p->'names') x where x = r.name);
 get diagnostics m = row_count;
 return jsonb_build_object('store', s, 'pruned', n, 'marked', m);
end $$;

-- 会議・KPI の実績：Business Profile に結んだ店だけ（auto）。月ごとの平均・件数（ハワイ時間の投稿日）
create or replace function public.gr_kpi(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'connected', exists (select 1 from public.gr_bp where id = 1 and refresh_token is not null and connected_at is not null),
    'status', (select coalesce(b.status, 'none') from public.gr_bp b where b.id = 1),
    'last_ok_at', (select b.last_ok_at from public.gr_bp b where b.id = 1),
    -- 自動の店：つながっていて、口コミを一度でも全部取り終えた店（審査待ちのあいだ・取り終えるまでは手入力のまま）
    'auto', coalesce((select jsonb_agg(l.store_id order by l.store_id) from public.gr_bp_loc l
                       where l.from_ym is not null and exists (select 1 from public.gr_bp where id = 1 and refresh_token is not null)), '[]'::jsonb),
    'from', coalesce((select jsonb_object_agg(l.store_id, l.from_ym) from public.gr_bp_loc l where l.from_ym is not null), '{}'::jsonb),
    'months', coalesce((select jsonb_object_agg(m.ym, m.v) from (
        select s.ym, jsonb_object_agg(s.store_id, jsonb_build_object('avg', s.avg, 'cnt', s.cnt)) v
          from (select r.ym, r.store_id, round(avg(r.rating)::numeric, 2) avg, count(*) cnt
                  from public.gr_reviews r join public.gr_bp_loc l on l.store_id = r.store_id
                 group by r.ym, r.store_id) s
         group by s.ym) m), '{}'::jsonb),
    'overall', coalesce((select jsonb_object_agg(l.store_id, jsonb_build_object('rating', l.rating, 'total', l.total, 'at', l.rating_at))
                           from public.gr_bp_loc l where l.rating is not null), '{}'::jsonb))
$$;

-- その月の口コミ（新しい順）。#151 のレビュー：200 件ずつ。続きは next（{c: 投稿時刻, h: 名前の md5}）を before に渡す
create or replace function public.gr_month(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s text := p->>'store'; m text := p->>'ym'; bc timestamptz; bh text; lim int := 200; rows jsonb; last jsonb; more boolean;
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' or m is null or m !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 if p->'before' is not null and jsonb_typeof(p->'before') <> 'null' then
   if jsonb_typeof(p->'before') <> 'object' or coalesce(p->'before'->>'h', '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_value'; end if;
   begin bc := (p->'before'->>'c')::timestamptz; exception when others then raise exception 'bad_value'; end;
   if bc is null then raise exception 'bad_value'; end if;
   bh := p->'before'->>'h';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('rating', r.rating, 'comment', r.comment, 'reviewer', r.reviewer,
        'created', r.created, 'updated', r.updated, 'replied', r.replied, 'h', r.h) order by r.created desc, r.h desc), '[]'::jsonb)
   into rows
   from (select g.*, md5(g.name) h from public.gr_reviews g where g.store_id = s and g.ym = m
            and (bc is null or (g.created, md5(g.name)) < (bc, bh))
          order by g.created desc, md5(g.name) desc limit lim + 1) r;
 more := jsonb_array_length(rows) > lim;
 if more then rows := rows - lim; end if;
 last := case when more then rows->(jsonb_array_length(rows) - 1) end;
 return jsonb_build_object('store', s, 'ym', m,
   'linked', exists (select 1 from public.gr_bp_loc where store_id = s),
   'avg', (select round(avg(rating)::numeric, 2) from public.gr_reviews where store_id = s and ym = m),
   'cnt', (select count(*) from public.gr_reviews where store_id = s and ym = m),
   'items', rows,
   'more', more,
   'next', case when more then jsonb_build_object('c', last->'created', 'h', last->'h') end);
end $$;

create or replace function public.gr_run_log(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 insert into public.gr_runs (kind, ok, info) values (left(coalesce(p->>'kind', 'run'), 20), coalesce((p->>'ok')::boolean, false), coalesce(p->'info', '{}'::jsonb));
 delete from public.gr_runs where id < (select min(id) from (select id from public.gr_runs order by id desc limit 200) k);
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.gr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('gr', 2) $$;   -- 2：#151 のレビューの直し（消された口コミ・続きを読む）

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gr\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
