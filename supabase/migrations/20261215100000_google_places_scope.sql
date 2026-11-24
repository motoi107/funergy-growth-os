-- v1209 の更新（Moto さん 11/23 14:36 HST の依頼）：Google の店（place ID）は住所で確かめた店だけ・回数は店の数から・管理者の一覧。
--   仕様：docs/GOOGLE_PLACES_V1209_JA.md の「11/23 14:36 の更新」。20261215090000_google_places_caps.sql のあとに流す。
-- ・Google の決まり（Maps Platform の利用規約 3.2.3(b)・Places API のサービス別の決まり）で、残してよいのは place ID だけ。
--   評価・件数・口コミ・投稿者・店の名前・住所は残さない（毎朝取って配るのは決まりに合わない＝取るのは押したときだけのまま）。
-- ・店を結ぶ（place ID を決める）のは、Google から取った住所が店の住所（gr_place_hint）とすべて合うときだけ。
--   名前も合えば「住所で確かめた」。名前が合わない・同じ建物にほかの店がある（LaLa など unsure）ときは、
--   GM・CEO が地図で見て「この店で間違いない」と押したときだけ「手で確かめた」。確かめていない店は Google を呼ばない。
-- ・回数の上限は「確かめた店の数 × 1 店 1 日の回数」（はじめ 1 回）。日は太平洋時間（Google の請求と同じ）。
--   1 日の上限＝少ないほう（places_day_max・店の数 × places_store_day_max）／月＝少ないほう（places_month_max・店の数 × 1 店 1 日 × その月の日数）。
-- ・表・関数はどれも公開の鍵（anon・authenticated）で読めない・呼べない。2 回流しても同じ（確かめた店・目安を消さない）。
-- ・戻すとき：deploy/google-places-v1209/戻す.md（このファイルの分は 2b を戻す）。

do $$
begin
 if to_regprocedure('public.gr_places_take(jsonb)') is null or to_regclass('public.gr_places_use') is null then
   raise exception 'STOP: 先に 20261215090000（deploy/google-places-v1209/2_SQL_Places上限.sql）を流してください。何も変えていません';
 end if;
end $$;

-- ---------------------------------------------------------------- 店の住所の目安（確かめに使う・SQL で直す）
--   addr：Google の住所にすべて入っている語（番地・通り・郵便番号）。names：Google の店の名前にどれか 1 つ入っている語。
--   unsure：同じ建物にほかの店がある・Google マップに出ているか分からない店（名前が合っても手で確かめる）。
create table if not exists public.gr_place_hint (
  store_id text primary key check (store_id ~ '^[A-Za-z0-9_-]{1,30}$'),
  addr text[] not null check (cardinality(addr) between 1 and 8),
  names text[] not null check (cardinality(names) between 1 and 8),
  unsure boolean not null default false,
  note text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.gr_place_hint enable row level security;
revoke all on public.gr_place_hint from public, anon, authenticated;
grant select, insert, update, delete on public.gr_place_hint to service_role;

-- はじめの目安（もうある店は変えない。店が移ったら SQL で直す：手順.md の「新しい店・店が移ったとき」）
insert into public.gr_place_hint (store_id, addr, names, unsure, note) values
  ('F01',   array['2334', 'king', '96826'],        array['toriton'], false, '同じ建物に Tenkichi'),
  ('F02',   array['2334', 'king', '96826'],        array['tenkichi'], false, '同じ建物に ToriTon'),
  ('F04-K', array['1127', '12th', '96816'],        array['totoya'], false, null),
  ('F04-P', array['436', 'piikoi', '96814'],       array['totoya'], false, '同じ建物に LaLa'),
  ('F04-A', array['99 115', 'aiea', '96701'],      array['totoya'], false, null),
  ('F05',   array['1145', '12th', '96816'],        array['marujuu'], false, null),
  ('F06',   array['436', 'piikoi', '96814'],       array['lala'], true, '同じ建物に Totoya Piikoi・Google マップに出ているか未確認')
on conflict (store_id) do nothing;

-- ---------------------------------------------------------------- 結んだ店に「確かめた」の印
alter table public.gr_places add column if not exists confirmed_place text;
alter table public.gr_places add column if not exists confirm_how text;
alter table public.gr_places add column if not exists confirmed_emp text;
alter table public.gr_places add column if not exists confirmed_name text;
alter table public.gr_places add column if not exists confirmed_at timestamptz;
do $$
begin
 if not exists (select 1 from pg_constraint where conname = 'gr_places_confirm_how_chk' and conrelid = 'public.gr_places'::regclass) then
   alter table public.gr_places add constraint gr_places_confirm_how_chk check (confirm_how is null or confirm_how in ('address', 'manual'));
 end if;
end $$;
-- 同じ Google の店を 2 つの店に確かめない（ToriTon と Tenkichi・Totoya Piikoi と LaLa は同じ建物）
create unique index if not exists gr_places_confirmed_uq on public.gr_places (confirmed_place) where confirmed_place is not null and confirmed_place = place_id;

-- はじめの回数：1 店 1 日 1 回（依頼の「1 日 1 回・店舗ごと」）。20261215090000 のはじめの値（10）のままの所だけ変える
alter table public.gr_settings alter column places_store_day_max set default 1;
update public.gr_settings set places_store_day_max = 1 where id = 1 and places_store_day_max = 10;

-- ---------------------------------------------------------------- 関数
-- 文字を比べる形に（小文字・英数字とかな・漢字だけ）。住所は語の区切りを残す
--   ハワイ語の ʻokina（ʻ ‘ ’ ' ` ʼ）は消し、カハコー（ā ē ī ō ū）は a e i o u に（Google は「Piʻikoi」と返すことがある）
create or replace function public.gr_fold(t text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
  select translate(lower(coalesce(t, '')), 'āēīōūĀĒĪŌŪʻʼ‘’''`', 'aeiouaeiou')
$$;
create or replace function public.gr_norm_addr(t text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
  select ' ' || btrim(regexp_replace(public.gr_fold(t), '[^a-z0-9぀-ヿ一-鿿]+', ' ', 'g')) || ' '
$$;
create or replace function public.gr_norm_name(t text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
  select regexp_replace(public.gr_fold(t), '[^a-z0-9぀-ヿ一-鿿]+', '', 'g')
$$;

-- 確かめた店か（place ID と確かめた place ID が同じ）
create or replace function public.gr_place_ok(pl public.gr_places) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
  select pl.confirmed_place is not null and pl.confirmed_place = pl.place_id and pl.confirm_how in ('address', 'manual')
$$;

-- 確かめた店の place ID だけ返す（v1157 の関数がこれを使っても、確かめていない店は Google を呼ばない）
create or replace function public.gr_place_of(p jsonb) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
  select pl.place_id from public.gr_places pl where pl.store_id = p->>'store' and public.gr_place_ok(pl)
$$;

-- 結んだか・確かめたか・住所の目安があるか・店舗マスターの店か（関数が Google を呼ぶ前に見る）
create or replace function public.gr_place_state(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('linked', pl.store_id is not null, 'confirmed', coalesce(public.gr_place_ok(pl), false),
    'hint', exists (select 1 from public.gr_place_hint h where h.store_id = p->>'store'),
    'known', public.gr_store_known(jsonb_build_object('store', p->>'store')))
  from (select 1) one left join public.gr_places pl on pl.store_id = p->>'store'
$$;

-- 店舗マスター（public.stores）の使っている店。表が無い環境（試験など）では null
create or replace function public.gr_store_ids(p jsonb) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare q text; r text[];
begin
 if to_regclass('public.stores') is null then return null; end if;
 q := 'select coalesce(array_agg(st.id::text order by st.id::text), ''{}''::text[]) from public.stores st where st.id::text ~ ''^[A-Za-z0-9_-]{1,30}$''';
 if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name = 'active') then
   q := q || ' and coalesce(st.active, true)';
 end if;
 if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name = 'data') then
   q := q || ' and coalesce(st.data->>''_deleted'', '''') not in (''true'', ''1'')';
 end if;
 execute q into r;
 return r;
end $$;

-- 配属の店（社員の表の store・応援の店は入れない）。店舗マスターにある店だけ。分からなければ null
create or replace function public.gr_home_store(p jsonb) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e text := p->>'emp'; s text;
begin
 if e is null or length(e) not between 1 and 64 then return null; end if;
 if to_regclass('public.employees') is null then return null; end if;
 begin
   execute 'select nullif(btrim(x.store::text), '''') from public.employees x where x.id::text = $1' into s using e;
 exception when others then return null; end;
 if s is null or not public.gr_store_known(jsonb_build_object('store', s)) then return null; end if;
 return s;
end $$;

-- 結ぶのは住所で確かめてから（gr_place_confirm）。ここは外すだけ
create or replace function public.gr_place_set(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare w jsonb := public.gr_who(p); s text := p->>'store';
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if p->'place_id' is null or jsonb_typeof(p->'place_id') = 'null' then
   delete from public.gr_places where store_id = s;
   return jsonb_build_object('store', s, 'place', false);
 end if;
 raise exception 'use_confirm';
end $$;

-- Google の店を確かめて結ぶ。g_name・g_addr は関数 google-reviews が Google から取った名前と住所（ここには残さない）
--   住所の語がすべて合わない → address_mismatch（結ばない）
--   住所が合い、名前も合い、unsure でなく、同じ住所のほかの店の名前を含まない → 住所で確かめた
--   住所が合い、名前が合わない・unsure・同じ住所のほかの店の名前も含む（「ToriTon & Tenkichi」など）
--     → manual が true のときだけ手で確かめた。そうでなければ { ok:false, need:'manual' }
create or replace function public.gr_place_confirm(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare w jsonb := public.gr_who(p); s text := p->>'store'; pid text := p->>'place_id'; h public.gr_place_hint;
 a text := public.gr_norm_addr(p->>'g_addr'); n text := public.gr_norm_name(p->>'g_name'); addr_ok boolean; name_ok boolean; sib boolean; how text;
begin
 if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if pid is null or length(pid) not between 10 and 300 or pid !~ '^[A-Za-z0-9_-]+$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'g_addr') is distinct from 'string' or length(p->>'g_addr') not between 1 and 300 then raise exception 'bad_value'; end if;
 if p->'g_name' is not null and jsonb_typeof(p->'g_name') <> 'string' then raise exception 'bad_value'; end if;
 if not public.gr_store_known(jsonb_build_object('store', s)) then raise exception 'unknown_store'; end if;
 select * into h from public.gr_place_hint where store_id = s;
 if not found then raise exception 'no_hint'; end if;
 select bool_and(position(public.gr_norm_addr(t) in a) > 0) into addr_ok from unnest(h.addr) t;
 if not coalesce(addr_ok, false) then raise exception 'address_mismatch'; end if;
 select bool_or(length(public.gr_norm_name(t)) > 0 and position(public.gr_norm_name(t) in n) > 0) into name_ok from unnest(h.names) t;
 -- 同じ住所のほかの店（ToriTon と Tenkichi・Totoya Piikoi と LaLa）の名前も含む Google の店は、自動で決めない
 select bool_or(length(public.gr_norm_name(t)) > 0 and position(public.gr_norm_name(t) in n) > 0) into sib
   from public.gr_place_hint o, unnest(o.names) t where o.store_id <> s and o.addr = h.addr;
 if coalesce(name_ok, false) and not h.unsure and not coalesce(sib, false) then how := 'address';
 elsif coalesce((p->>'manual')::boolean, false) then how := 'manual';
 else return jsonb_build_object('ok', false, 'need', 'manual', 'reason',
        case when h.unsure then 'unsure' when coalesce(name_ok, false) and coalesce(sib, false) then 'shared' else 'name' end);
 end if;
 perform pg_advisory_xact_lock(hashtext('gr_place_confirm'));
 if exists (select 1 from public.gr_places x where x.store_id <> s and x.place_id = pid and public.gr_place_ok(x)) then raise exception 'place_taken'; end if;
 insert into public.gr_places (store_id, place_id, set_emp, set_name, set_at, confirmed_place, confirm_how, confirmed_emp, confirmed_name, confirmed_at)
   values (s, pid, w->>'emp', w->>'name', now(), pid, how, w->>'emp', w->>'name', now())
   on conflict (store_id) do update set place_id = excluded.place_id, set_emp = excluded.set_emp, set_name = excluded.set_name, set_at = now(),
     confirmed_place = excluded.confirmed_place, confirm_how = excluded.confirm_how, confirmed_emp = excluded.confirmed_emp,
     confirmed_name = excluded.confirmed_name, confirmed_at = now();
 return jsonb_build_object('ok', true, 'store', s, 'place', true, 'confirmed', true, 'how', how);
end $$;

-- 確かめた店（店舗マスターにある店だけ）
create or replace function public.gr_confirmed_stores(p jsonb) returns text[]
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(array_agg(pl.store_id order by pl.store_id), '{}'::text[]) from public.gr_places pl
   where public.gr_place_ok(pl) and public.gr_store_known(jsonb_build_object('store', pl.store_id))
$$;

-- 今日（太平洋時間）の上限。店の数から決める
create or replace function public.gr_places_caps(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare c public.gr_settings; d date := (now() at time zone 'America/Los_Angeles')::date; n int;
 days int := extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int;
begin
 select * into c from public.gr_settings where id = 1;
 n := cardinality(public.gr_confirmed_stores('{}'::jsonb));
 return jsonb_build_object('stores', n, 'days', days,
   'day_max', least(c.places_day_max, n * c.places_store_day_max),
   'month_max', least(c.places_month_max, n * c.places_store_day_max * days),
   'store_day_max', c.places_store_day_max, 'person_day_max', c.places_person_day_max,
   'day_ceiling', c.places_day_max, 'month_ceiling', c.places_month_max);
end $$;

-- Google を呼ぶ前に 1 回分を取る。上限なら { ok:false, cap, max } で何も数えない
--   kind 'now'：店の評価と口コミ（確かめた店だけ）／'search'：店を探す・確かめるときの住所（GM・CEO）
create or replace function public.gr_places_take(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare k text := p->>'kind'; e text := p->>'emp'; s text := p->>'store'; c public.gr_settings; pl public.gr_places; cap jsonb;
 d date := (now() at time zone 'America/Los_Angeles')::date; m0 date; dn int; mn int; sn int; pn int; dmax int; mmax int;
begin
 if k is null or k not in ('now', 'search') then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'emp') is distinct from 'string' or length(e) not between 1 and 64 then raise exception 'forbidden'; end if;
 if k = 'now' then
   if s is null or s !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
   select * into pl from public.gr_places where store_id = s;
   if not found then return jsonb_build_object('ok', false, 'cap', 'not_linked'); end if;
   if not public.gr_place_ok(pl) then return jsonb_build_object('ok', false, 'cap', 'not_confirmed'); end if;
   if not public.gr_store_known(jsonb_build_object('store', s)) then return jsonb_build_object('ok', false, 'cap', 'unknown_store'); end if;
 end if;
 perform pg_advisory_xact_lock(hashtext('gr_places_take'));
 select * into c from public.gr_settings where id = 1;
 m0 := date_trunc('month', d)::date;
 if k = 'now' then
   cap := public.gr_places_caps('{}'::jsonb);
   dmax := (cap->>'day_max')::int; mmax := (cap->>'month_max')::int;
 else
   dmax := c.search_day_max; mmax := c.search_month_max;
 end if;
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
 return jsonb_build_object('ok', true, 'day', dn + 1, 'day_max', dmax, 'month', mn + 1, 'month_max', mmax,
   'store_left', case when k = 'now' then greatest(c.places_store_day_max - sn - 1, 0) end);
end $$;

-- 今日と今月の回数と上限（GM・CEO の画面）。上限は店の数から決めた値
create or replace function public.gr_places_usage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with d as (select (now() at time zone 'America/Los_Angeles')::date d),
  c as (select * from public.gr_settings where id = 1),
  k as (select public.gr_places_caps('{}'::jsonb) k)
  select jsonb_build_object('tz', 'America/Los_Angeles', 'day', (select d from d),
    'now', jsonb_build_object(
      'day', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'now' and u.scope = 'all' and u.day = d.d),
      'month', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'now' and u.scope = 'all' and u.day between date_trunc('month', d.d)::date and d.d),
      'day_max', (select (k->>'day_max')::int from k), 'month_max', (select (k->>'month_max')::int from k),
      'stores', (select (k->>'stores')::int from k), 'days', (select (k->>'days')::int from k),
      'day_ceiling', (select places_day_max from c), 'month_ceiling', (select places_month_max from c),
      'store_day_max', (select places_store_day_max from c), 'person_day_max', (select places_person_day_max from c),
      'by_store', (select coalesce(jsonb_object_agg(substr(u.scope, 3), u.n), '{}'::jsonb) from public.gr_places_use u, d
                    where u.kind = 'now' and u.scope like 's:%' and u.day = d.d)),
    'search', jsonb_build_object(
      'day', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'search' and u.scope = 'all' and u.day = d.d),
      'month', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'search' and u.scope = 'all' and u.day between date_trunc('month', d.d)::date and d.d),
      'day_max', (select search_day_max from c), 'month_max', (select search_month_max from c)))
$$;

-- 確かめた店（画面で「評価と口コミを見る」を出す店。place ID そのものは出さない）
create or replace function public.gr_places_linked(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select to_jsonb(public.gr_confirmed_stores('{}'::jsonb))
$$;

-- GM・CEO の一覧：店舗マスターの店・結んだ店・目安のある店のすべて。未設定・確かめ待ち・確かめた・目安なしが分かる
create or replace function public.gr_places_admin(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with d as (select (now() at time zone 'America/Los_Angeles')::date d),
  m as (select public.gr_store_ids('{}'::jsonb) ids),
  s as (
    select x from unnest(coalesce((select ids from m), '{}'::text[])) x
    union select store_id from public.gr_places
    union select store_id from public.gr_place_hint
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'store', s.x,
      'master', case when m.ids is null then null else s.x = any(m.ids) end,
      'hint', h.store_id is not null, 'unsure', coalesce(h.unsure, false), 'note', h.note,
      'linked', pl.store_id is not null, 'place_id', pl.place_id,
      'confirmed', coalesce(public.gr_place_ok(pl), false),
      'how', case when public.gr_place_ok(pl) then pl.confirm_how end,
      'by', case when public.gr_place_ok(pl) then pl.confirmed_name end,
      'at', case when public.gr_place_ok(pl) then pl.confirmed_at end,
      'today', (select coalesce(sum(u.n), 0) from public.gr_places_use u, d where u.kind = 'now' and u.scope = 's:' || s.x and u.day = d.d)))
    order by s.x), '[]'::jsonb)
  from s cross join m left join public.gr_places pl on pl.store_id = s.x left join public.gr_place_hint h on h.store_id = s.x
$$;

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
