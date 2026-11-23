-- v1209：Google の評価・口コミ（Places API（新））を、見られる店だけ・決めた回数まで（Moto さん 11/23 10:49 HST の依頼）。
--   仕様：docs/GOOGLE_PLACES_V1209_JA.md。v1157 の SQL（20261122090000_google_reviews.sql）のあとに流す。
-- ・Places の呼び出しは費用がかかる（店の評価と口コミ＝Place Details Enterprise + Atmosphere：月 1,000 回まで無料）。
--   関数 google-reviews が Google を呼ぶ前に、ここで回数を数え、上限を超えたら呼ばない（gr_places_take）。
--   数えるのは「呼んだ回数」（Google が断った回も数える＝少なめに見積もらない）。日と月は Google の請求と同じ太平洋時間で区切る。
-- ・上限は gr_settings の欄（SQL で変える）。はじめは：店の評価と口コミ 1 日 40 回・1 店 1 日 10 回・1 人 1 日 25 回・月 900 回／
--   店を探す 1 日 40 回・月 400 回。
-- ・取る店は Google の店を結んだ店（gr_places）だけ。結べるのは店舗マスター（public.stores）にある・使っている店だけ（gr_place_set）。
-- ・Head Chef（GM・CEO が確かめた人）は全店を見る（アプリの店の範囲と同じ）：gr_is_chef。
-- ・残すのは回数だけ（だれが・どの店を・何回）。Google から取った中身（評価・口コミ）はここにも残さない（Google の決まり）。
-- ・表・関数はどれも公開の鍵（anon・authenticated）で読めない・呼べない。2 回流しても同じ。戻すとき：deploy/google-places-v1209/戻す.md。

do $$
begin
 if to_regclass('public.gr_settings') is null or to_regclass('public.gr_places') is null
    or to_regprocedure('public.gr_place_of(jsonb)') is null then
   raise exception 'STOP: 先に v1157 の SQL（deploy/google-reviews-v1157/2_SQL_Google口コミ.sql）を流してください。何も変えていません';
 end if;
end $$;

-- ---------------------------------------------------------------- 上限（SQL で変える・0 にするとその呼び出しを止める）
alter table public.gr_settings add column if not exists places_day_max int not null default 40 check (places_day_max between 0 and 5000);
alter table public.gr_settings add column if not exists places_store_day_max int not null default 10 check (places_store_day_max between 0 and 5000);
alter table public.gr_settings add column if not exists places_person_day_max int not null default 25 check (places_person_day_max between 0 and 5000);
alter table public.gr_settings add column if not exists places_month_max int not null default 900 check (places_month_max between 0 and 100000);
alter table public.gr_settings add column if not exists search_day_max int not null default 40 check (search_day_max between 0 and 5000);
alter table public.gr_settings add column if not exists search_month_max int not null default 400 check (search_month_max between 0 and 100000);

-- 回数（日ごと・種類ごと。scope：all＝全体／s:店／p:社員 ID）。70 日より前は消す
create table if not exists public.gr_places_use (
  day date not null,
  kind text not null check (kind in ('now', 'search')),
  scope text not null check (scope = 'all' or scope ~ '^s:[A-Za-z0-9_-]{1,30}$' or (scope like 'p:%' and length(scope) between 3 and 66)),
  n int not null default 0 check (n >= 0),
  primary key (day, kind, scope)
);
alter table public.gr_places_use enable row level security;
revoke all on public.gr_places_use from public, anon, authenticated;
grant select, insert, update, delete on public.gr_places_use to service_role;

-- ---------------------------------------------------------------- 関数
-- 店舗マスター（public.stores）にある・使っている店か。表が無い環境（試験など）では店の形だけを見る
create or replace function public.gr_store_known(p jsonb) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s text := p->>'store'; ok boolean; q text;
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then return false; end if;
 if to_regclass('public.stores') is null then return true; end if;
 q := 'select exists (select 1 from public.stores st where st.id::text = $1';
 if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name = 'active') then
   q := q || ' and coalesce(st.active, true)';
 end if;
 if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name = 'data') then
   q := q || ' and coalesce(st.data->>''_deleted'', '''') not in (''true'', ''1'')';
 end if;
 execute q || ')' into ok using s;
 return coalesce(ok, false);
end $$;

-- Google の店を結ぶ（v1157 と同じ。結ぶときだけ、店舗マスターにある店か確かめる。外すのはいつでも）
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
 if not public.gr_store_known(jsonb_build_object('store', s)) then raise exception 'unknown_store'; end if;
 insert into public.gr_places (store_id, place_id, set_emp, set_name, set_at) values (s, p->>'place_id', w->>'emp', w->>'name', now())
   on conflict (store_id) do update set place_id = excluded.place_id, set_emp = excluded.set_emp, set_name = excluded.set_name, set_at = now();
 return jsonb_build_object('store', s, 'place', true);
end $$;

-- Google を呼ぶ前に 1 回分を取る。上限なら { ok:false, cap:'month'|'day'|'store'|'person', max } で何も数えない
--   kind 'now'：店の評価と口コミ（store が要る・結んだ店だけ）／'search'：店を探す（GM・CEO）
create or replace function public.gr_places_take(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare k text := p->>'kind'; e text := p->>'emp'; s text := p->>'store'; c public.gr_settings;
 d date := (now() at time zone 'America/Los_Angeles')::date; m0 date; dn int; mn int; sn int; pn int; dmax int; mmax int;
begin
 if k is null or k not in ('now', 'search') then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'emp') is distinct from 'string' or length(e) not between 1 and 64 then raise exception 'forbidden'; end if;
 if k = 'now' then
   if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
   if not exists (select 1 from public.gr_places where store_id = s) then return jsonb_build_object('ok', false, 'cap', 'not_linked'); end if;
   if not public.gr_store_known(jsonb_build_object('store', s)) then return jsonb_build_object('ok', false, 'cap', 'unknown_store'); end if;
 end if;
 perform pg_advisory_xact_lock(hashtext('gr_places_take'));
 select * into c from public.gr_settings where id = 1;
 m0 := date_trunc('month', d)::date;
 dmax := case k when 'now' then c.places_day_max else c.search_day_max end;
 mmax := case k when 'now' then c.places_month_max else c.search_month_max end;
 select coalesce(sum(u.n), 0) into mn from public.gr_places_use u where u.kind = k and u.scope = 'all' and u.day between m0 and d;
 if mn >= mmax then return jsonb_build_object('ok', false, 'cap', 'month', 'max', mmax); end if;
 select coalesce(sum(u.n), 0) into dn from public.gr_places_use u where u.kind = k and u.scope = 'all' and u.day = d;
 if dn >= dmax then return jsonb_build_object('ok', false, 'cap', 'day', 'max', dmax); end if;
 if k = 'now' then
   select coalesce(sum(u.n), 0) into sn from public.gr_places_use u where u.kind = k and u.scope = 's:' || s and u.day = d;
   if sn >= c.places_store_day_max then return jsonb_build_object('ok', false, 'cap', 'store', 'max', c.places_store_day_max); end if;
   select coalesce(sum(u.n), 0) into pn from public.gr_places_use u where u.kind = k and u.scope = 'p:' || e and u.day = d;
   if pn >= c.places_person_day_max then return jsonb_build_object('ok', false, 'cap', 'person', 'max', c.places_person_day_max); end if;
   insert into public.gr_places_use (day, kind, scope, n) values (d, k, 's:' || s, 1), (d, k, 'p:' || e, 1)
     on conflict (day, kind, scope) do update set n = public.gr_places_use.n + 1;
 end if;
 insert into public.gr_places_use (day, kind, scope, n) values (d, k, 'all', 1)
   on conflict (day, kind, scope) do update set n = public.gr_places_use.n + 1;
 delete from public.gr_places_use where day < d - 70;
 return jsonb_build_object('ok', true, 'day', dn + 1, 'day_max', dmax, 'month', mn + 1, 'month_max', mmax);
end $$;

-- 今日と今月の回数（GM・CEO の画面に出す）。日と月は太平洋時間
create or replace function public.gr_places_usage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with d as (select (now() at time zone 'America/Los_Angeles')::date d),
  c as (select * from public.gr_settings where id = 1)
  select jsonb_build_object('tz', 'America/Los_Angeles', 'day', (select d from d),
    'now', jsonb_build_object(
      'day', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'now' and u.scope = 'all' and u.day = d.d),
      'month', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'now' and u.scope = 'all' and u.day between date_trunc('month', d.d)::date and d.d),
      'day_max', (select places_day_max from c), 'month_max', (select places_month_max from c),
      'store_day_max', (select places_store_day_max from c), 'person_day_max', (select places_person_day_max from c)),
    'search', jsonb_build_object(
      'day', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'search' and u.scope = 'all' and u.day = d.d),
      'month', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'search' and u.scope = 'all' and u.day between date_trunc('month', d.d)::date and d.d),
      'day_max', (select search_day_max from c), 'month_max', (select search_month_max from c)))
$$;

-- Google の店を結んだ店（会議のカードに「評価と口コミを見る」を出すため。place ID そのものは出さない）
create or replace function public.gr_places_linked(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(store_id order by store_id), '[]'::jsonb) from public.gr_places
$$;

-- GM・CEO が確かめた Head Chef か（確かめた写しと今の社員の表の両方で Head Chef のときだけ・アプリの店の範囲と同じ＝全店）
create or replace function public.gr_is_chef(p jsonb) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e text := p->>'emp'; c jsonb; l jsonb;
begin
 if e is null or length(e) not between 1 and 64 then return false; end if;
 if to_regprocedure('public.wr_person_conf(text)') is null or to_regprocedure('public.wr_person_live(text)') is null then return false; end if;
 begin
   execute 'select public.wr_person_conf($1), public.wr_person_live($1)' into c, l using e;
 exception when others then return false; end;
 return coalesce(c->>'chef', '') = 'true' and coalesce(l->>'chef', '') = 'true';
end $$;

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
