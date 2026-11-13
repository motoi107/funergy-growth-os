-- v1151（全体アップデート指示の 2c の 3 つ目・Moto さん 11/12：案 C・誰が何を変えたかを記録・SQL を入れてよい・30 分ごと／11/12 16:32：
--   変更の記録を見られる人＝CEO・GM・経理・事務Crew、残す期間＝1 年、左下の知らせに名前を出す）。
-- 仕様：docs/CHANGE_SIGNAL_V1151_JA.md。入れる順番：deploy/change-signal-v1151/手順.md。
--
-- ・sync_signal（公開の鍵で読める・Realtime）：どのキー（どの表）が・いつ・何回目・だれ（社員 ID）・どの端末（ランダムの印）で変わったか。
--   中身（値）・名前は入れない。機密のキー（ss_secret_key＝成長カルテ・賞与・Career Score など）は区分ごとの 1 行（_secure:<区分>）にまとめ、社員 ID も入れない。
-- ・change_log（サーバーだけ。公開の鍵では読めない・書けない）：いつ・だれ（名前・役職・端末）・どの画面（キー・表）・どの対象（行の番号・キーの中の項目。50 まで）・何回。
--   中身（金額・時刻・コメント・前と後の値）は残さない。機密のキーは区分だけ（対象の人も出さない）。読むのは関数 secure-state（CEO・GM・経理・事務Crew）。
--   同じ人・同じ端末・同じキーを 5 分以内に続けて変えたら 1 行にまとめる（回数）。1 年より古い行は消す。
-- ・だれか：アプリ v1151 が書き込みに付ける x-fp-actor（社員 ID・名前・役職・端末の印・端末の種類。base64 の JSON）。サーバーは確かめない（アプリが送った名前）。
--   関数（secure-state）がサーバーの鍵で書くときは、関数が PIN・メールで確かめた人を付ける（via='fn'）。付いていない書き込みは
--   前の版の端末（via='old'）・サーバーの関数（via='server'）・SQL の直し（via='sql'）。
-- ・見張り（トリガー）は文ごと（FOR EACH STATEMENT・変わった行の表）。値が同じ書き込み（updated_at だけ）は合図も記録もしない。
--   合図・記録に失敗しても、保存そのものは止めない（警告だけ）。
-- ・対象：app_state・app_settings・マスターの 6 つの表（店舗・従業員・食材・レシピ・業者・カテゴリー）。
--   出さないキー：invoice_purchase_*（サーバーが書く仕入れ集計）・lunch_photo_*（写真）。
-- ・2 回流しても同じ。戻すとき：db/change-signal-rollback.sql（見張り・関数・表を外す。保存は今までどおり）。

do $$
begin
  if to_regclass('public.app_state') is null or to_regclass('public.app_settings') is null then
    raise exception 'app_state・app_settings がありません（このデータベースではありません）';
  end if;
  if to_regprocedure('public.ss_secret_key(text)') is null then
    raise exception '先に v1139 の SQL（20261108090000_secure_state_rls）を流してください（ss_secret_key がありません）';
  end if;
end $$;

-- 合図
create table if not exists public.sync_signal (
  key    text primary key,                 -- app_state のキー／set:<app_settings のキー>／m:<マスターの表>／_secure:<区分>
  at     timestamptz not null default now(),
  n      bigint not null default 1,
  by_emp text,                             -- 変えた人の社員 ID（アプリが送ったもの。機密のキー・分からないときは null）
  by_dev text                              -- 変えた端末の印（ランダム。自分の端末の変更を見分ける）
);
alter table public.sync_signal enable row level security;
drop policy if exists sync_signal_read on public.sync_signal;
create policy sync_signal_read on public.sync_signal for select to anon, authenticated using (true);
revoke all on public.sync_signal from anon, authenticated;
grant select on public.sync_signal to anon, authenticated, service_role;
comment on table public.sync_signal is 'v1151: ほかの端末で変わったことの合図（キー・時刻・回数・社員 ID・端末の印だけ）。見張り fp_sig_* だけが書く。';

-- 記録
create table if not exists public.change_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),   -- 最初
  last_at  timestamptz not null default now(),   -- 最後（まとめた行）
  src      text not null,                         -- app_state・app_settings・マスターの表の名前
  key      text not null,                         -- キー（機密のキーは _secure）
  cat      text,                                  -- 機密のキーの区分（karte・bonus・career_score・hiring・growthhub・pii・tip_confirm・warnings・grade_hist・secure）
  by_emp   text,
  by_name  text,
  by_role  text,
  by_dev   text,
  by_kind  text,                                  -- 端末の種類（pc・iphone・ipad・android）
  via      text not null,                         -- app・fn・old・server・sql
  parts    jsonb not null default '[]'::jsonb,    -- 対象（行の番号・キーの中の項目。50 まで）
  more     boolean not null default false,        -- 対象が 50 より多い・大きすぎて出していない
  n        integer not null default 1
);
create index if not exists change_log_last_at on public.change_log (last_at desc);
create index if not exists change_log_merge on public.change_log (src, key, last_at desc);
alter table public.change_log enable row level security;   -- 決まりは作らない＝公開の鍵では読めない・書けない（サーバーの鍵だけ）
revoke all on public.change_log from anon, authenticated;
revoke all on sequence public.change_log_id_seq from anon, authenticated;
grant select on public.change_log to service_role;   -- 読むのは関数 secure-state（サーバーの鍵）だけ
comment on table public.change_log is 'v1151: だれが何を変えたかの記録（中身は残さない）。読むのは関数 secure-state（CEO・GM・経理・事務Crew）。1 年で消す。';

-- だれか（x-fp-actor：base64 の JSON）。読めなければ null
create or replace function public.fp_actor() returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare h text; j jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-fp-actor';
  exception when others then return null;
  end;
  if h is null or length(h) > 3000 then return null; end if;
  begin
    j := convert_from(decode(h, 'base64'), 'UTF8')::jsonb;
  exception when others then return null;
  end;
  if jsonb_typeof(j) is distinct from 'object' then return null; end if;
  return j;
end $$;

-- どの道で書いたか：fn（関数が確かめた人）・app（アプリが送った名前）・old（前の版の端末）・server（サーバーの関数）・sql（SQL の直し）
create or replace function public.fp_via(a jsonb) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare r text;
begin
  begin
    r := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', nullif(current_setting('request.jwt.claim.role', true), ''));
  exception when others then r := null;
  end;
  if r is null then return 'sql'; end if;
  if r = 'service_role' then return case when a is not null and a ->> 'f' = '1' then 'fn' else 'server' end; end if;
  return case when a is not null then 'app' else 'old' end;
end $$;

-- 機密のキーの区分（対象の人を出さない）
create or replace function public.fp_sec_cat(k text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when k in ('growth_karte', 'karte_pin', 'karte_bonus_config') then 'karte'
    when k in ('bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra', 'bonus_eval_ovr', 'bonus_track') or k like 'spl\_bonus\_q\_%' then 'bonus'
    when k in ('lss_scores', 'lss_requests', 'lss_history') or k like 'lss\_emp\_%' or k like 'spl\_lss\_%' then 'career_score'
    when k in ('applicants', 'reject_log') then 'hiring'
    when k = 'growthhub' then 'growthhub'
    when k = 'emp_pii' then 'pii'
    when k like 'tip\_cf\_%' then 'tip_confirm'
    when k like 'warnings\_%' then 'warnings'
    when k = 'grade_hist' then 'grade_hist'
    else 'secure' end
$$;

-- どの対象が変わったか（中身は返さない）。入れ物（オブジェクト）は変わった項目の名前、並び（配列）は id・code・key・aid が変わった要素。
-- 包んだ形（{__st:1, v:…}）は中身で比べる。大きすぎる（合わせて 1MB より大きい）ときは null（出さない）
create or replace function public.fp_parts(ov jsonb, nv jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare o jsonb := ov; n jsonb := nv; r jsonb;
begin
  if jsonb_typeof(o) = 'object' and o ->> '__st' = '1' and o ? 'v' then o := o -> 'v'; end if;
  if jsonb_typeof(n) = 'object' and n ->> '__st' = '1' and n ? 'v' then n := n -> 'v'; end if;
  if coalesce(pg_column_size(o), 0) + coalesce(pg_column_size(n), 0) > 1000000 then return null; end if;
  if (o is null or jsonb_typeof(o) = 'object') and (n is null or jsonb_typeof(n) = 'object') then
    select coalesce(jsonb_agg(x.k order by x.k), '[]'::jsonb) into r from (
      select u.k from (
        select e.key as k from jsonb_each(coalesce(o, '{}'::jsonb)) e
        union select e.key from jsonb_each(coalesce(n, '{}'::jsonb)) e
      ) u
      where (o -> u.k) is distinct from (n -> u.k)
      order by u.k limit 51
    ) x;
    return r;
  end if;
  if (o is null or jsonb_typeof(o) = 'array') and (n is null or jsonb_typeof(n) = 'array') then
    select coalesce(jsonb_agg(x.id order by x.id), '[]'::jsonb) into r from (
      select coalesce(a.id, b.id) as id
      from (select coalesce(e ->> 'id', e ->> 'code', e ->> 'key', e ->> 'aid') as id, e from jsonb_array_elements(coalesce(o, '[]'::jsonb)) e) a
      full join (select coalesce(e ->> 'id', e ->> 'code', e ->> 'key', e ->> 'aid') as id, e from jsonb_array_elements(coalesce(n, '[]'::jsonb)) e) b on a.id = b.id
      where coalesce(a.id, b.id) is not null and a.e is distinct from b.e
      group by 1 order by 1 limit 51
    ) x;
    return r;
  end if;
  return '[]'::jsonb;
end $$;

-- 合図を進め、記録を書く（同じ人・端末・キーを 5 分以内に続けて変えたら 1 行にまとめる）
create or replace function public.fp_note(p_src text, p_key text, p_sec boolean, p_cat text, p_parts jsonb, a jsonb, w text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sk text; e text; nm text; rl text; dv text; kd text; id0 bigint; pp jsonb; mr boolean;
begin
  e  := nullif(left(coalesce(a ->> 'e', ''), 64), '');
  nm := nullif(left(coalesce(a ->> 'n', ''), 120), '');
  rl := nullif(left(coalesce(a ->> 'r', ''), 40), '');
  dv := nullif(left(coalesce(a ->> 'd', ''), 64), '');
  kd := nullif(left(coalesce(a ->> 'k', ''), 20), '');
  sk := case when p_sec then '_secure:' || coalesce(p_cat, 'secure') when p_src = 'app_state' then p_key when p_src = 'app_settings' then 'set:' || p_key else 'm:' || p_src end;
  insert into public.sync_signal as s (key, at, n, by_emp, by_dev)
    values (sk, now(), 1, case when p_sec then null else e end, dv)
  on conflict (key) do update set at = now(), n = s.n + 1, by_emp = excluded.by_emp, by_dev = excluded.by_dev;

  mr := p_parts is null or jsonb_array_length(p_parts) > 50;
  pp := case when p_sec or p_parts is null then '[]'::jsonb
             else (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select v from jsonb_array_elements(p_parts) v limit 50) t) end;
  select c.id into id0 from public.change_log c
   where c.src = p_src and c.key = (case when p_sec then '_secure' else p_key end)
     and c.cat is not distinct from (case when p_sec then p_cat else null end)
     and c.via = w and c.by_emp is not distinct from e and c.by_dev is not distinct from dv
     and c.last_at > now() - interval '5 minutes'
   order by c.last_at desc limit 1
   for update;
  if id0 is not null then
    update public.change_log c set last_at = now(), n = c.n + 1,
      more = c.more or (case when p_sec then false else mr end),
      parts = (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
                 select v from (select v, min(o) o from (
                   select v, 0 o from jsonb_array_elements(c.parts) v
                   union all select v, 1 from jsonb_array_elements(pp) v) u group by v) d
                 order by o, v limit 50) t)
     where c.id = id0;
  else
    insert into public.change_log (src, key, cat, by_emp, by_name, by_role, by_dev, by_kind, via, parts, more)
    values (p_src, case when p_sec then '_secure' else p_key end, case when p_sec then p_cat else null end,
            e, nm, rl, dv, kd, w, pp, case when p_sec then false else mr end)
    returning id into id0;
    -- 1 年より古い行を少しずつ消す（新しい行が 200 できるごとに、古いほうから 500 行まで）
    if id0 % 200 = 0 then
      delete from public.change_log where id in (select id from public.change_log where last_at < now() - interval '1 year' order by id limit 500);
    end if;
  end if;
end $$;

-- 見張り（app_state・app_settings：キーと値）。1 つの文で変わったキーが 100 より多い（同期センターの「この端末からアップロード」など）ときは
-- キーごとにせず 1 つにまとめる（合図は「*」・set:*＝端末は全部を取り直す。記録の対象は機密でないキーの 50 まで）
create or replace function public.fp_sig_kv() returns trigger
language plpgsql security definer set search_path = public, pg_temp set enable_nestloop = off as $$   -- 変わった行の表どうしを結ぶとき、総当たりにしない
declare r record; a jsonb; w text; sec boolean; cnt integer; ks jsonb;
begin
  a := public.fp_actor(); w := public.fp_via(a);
  if tg_op = 'INSERT' then
    select count(*), coalesce(jsonb_agg(x.k order by x.k) filter (where x.rn <= 51 and not x.sec), '[]'::jsonb) into cnt, ks
      from (select n.key::text k, row_number() over (order by n.key::text) rn,
                   tg_table_name = 'app_state' and coalesce(public.ss_secret_key(n.key::text), false) sec
              from fp_new n where not (n.key::text like 'invoice\_purchase\_%' or n.key::text like 'lunch\_photo\_%')) x;
  elsif tg_op = 'UPDATE' then
    select count(*), coalesce(jsonb_agg(x.k order by x.k) filter (where x.rn <= 51 and not x.sec), '[]'::jsonb) into cnt, ks
      from (select n.key::text k, row_number() over (order by n.key::text) rn,
                   tg_table_name = 'app_state' and coalesce(public.ss_secret_key(n.key::text), false) sec
              from fp_new n join fp_old o on o.key = n.key
             where o.value::jsonb is distinct from n.value::jsonb
               and not (n.key::text like 'invoice\_purchase\_%' or n.key::text like 'lunch\_photo\_%')) x;
  else
    select count(*), coalesce(jsonb_agg(x.k order by x.k) filter (where x.rn <= 51 and not x.sec), '[]'::jsonb) into cnt, ks
      from (select o.key::text k, row_number() over (order by o.key::text) rn,
                   tg_table_name = 'app_state' and coalesce(public.ss_secret_key(o.key::text), false) sec
              from fp_old o where not (o.key::text like 'invoice\_purchase\_%' or o.key::text like 'lunch\_photo\_%')) x;
  end if;
  if coalesce(cnt, 0) = 0 then return null; end if;
  if cnt > 100 then
    perform public.fp_note(tg_table_name, '*', false, null, ks, a, w);
    return null;
  end if;
  if tg_op = 'INSERT' then
    for r in select n.key::text as k, null::jsonb as ov, n.value::jsonb as nv from fp_new n loop
      if r.k like 'invoice\_purchase\_%' or r.k like 'lunch\_photo\_%' then continue; end if;
      sec := tg_table_name = 'app_state' and coalesce(public.ss_secret_key(r.k), false);
      perform public.fp_note(tg_table_name, r.k, sec, case when sec then public.fp_sec_cat(r.k) end, case when sec then '[]'::jsonb else public.fp_parts(r.ov, r.nv) end, a, w);
    end loop;
  elsif tg_op = 'UPDATE' then
    for r in select n.key::text as k, o.value::jsonb as ov, n.value::jsonb as nv
               from fp_new n join fp_old o on o.key = n.key
              where o.value::jsonb is distinct from n.value::jsonb loop
      if r.k like 'invoice\_purchase\_%' or r.k like 'lunch\_photo\_%' then continue; end if;
      sec := tg_table_name = 'app_state' and coalesce(public.ss_secret_key(r.k), false);
      perform public.fp_note(tg_table_name, r.k, sec, case when sec then public.fp_sec_cat(r.k) end, case when sec then '[]'::jsonb else public.fp_parts(r.ov, r.nv) end, a, w);
    end loop;
  else
    for r in select o.key::text as k, o.value::jsonb as ov from fp_old o loop
      if r.k like 'invoice\_purchase\_%' or r.k like 'lunch\_photo\_%' then continue; end if;
      sec := tg_table_name = 'app_state' and coalesce(public.ss_secret_key(r.k), false);
      perform public.fp_note(tg_table_name, r.k, sec, case when sec then public.fp_sec_cat(r.k) end, case when sec then '[]'::jsonb else public.fp_parts(r.ov, null) end, a, w);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'fp_sig_kv (%): %', tg_table_name, sqlerrm;   -- 合図・記録に失敗しても保存は止めない
  return null;
end $$;

-- 見張り（マスターの表：主キーと data）。1 つの文で 1 回（変わった行の番号を対象に）
create or replace function public.fp_sig_rows() returns trigger
language plpgsql security definer set search_path = public, pg_temp set enable_nestloop = off as $$
declare pk text := tg_argv[0]; a jsonb; w text; parts jsonb; cnt integer;
begin
  a := public.fp_actor(); w := public.fp_via(a);
  if tg_op = 'INSERT' then
    select count(*), coalesce(jsonb_agg(x.id order by x.id) filter (where x.rn <= 51), '[]'::jsonb) into cnt, parts
      from (select to_jsonb(n) ->> pk as id, row_number() over (order by to_jsonb(n) ->> pk) rn from fp_new n) x;
  elsif tg_op = 'UPDATE' then
    select count(*), coalesce(jsonb_agg(x.id order by x.id) filter (where x.rn <= 51), '[]'::jsonb) into cnt, parts
      from (select to_jsonb(n) ->> pk as id, row_number() over (order by to_jsonb(n) ->> pk) rn
              from fp_new n join fp_old o on (to_jsonb(o) ->> pk) = (to_jsonb(n) ->> pk)
             where (to_jsonb(o) - 'updated_at') is distinct from (to_jsonb(n) - 'updated_at')) x;
  else
    select count(*), coalesce(jsonb_agg(x.id order by x.id) filter (where x.rn <= 51), '[]'::jsonb) into cnt, parts
      from (select to_jsonb(o) ->> pk as id, row_number() over (order by to_jsonb(o) ->> pk) rn from fp_old o) x;
  end if;
  if coalesce(cnt, 0) = 0 then return null; end if;
  perform public.fp_note(tg_table_name, tg_table_name, false, null, parts, a, w);
  return null;
exception when others then
  raise warning 'fp_sig_rows (%): %', tg_table_name, sqlerrm;
  return null;
end $$;

revoke all on function public.fp_actor() from public, anon, authenticated;
revoke all on function public.fp_via(jsonb) from public, anon, authenticated;
revoke all on function public.fp_sec_cat(text) from public, anon, authenticated;
revoke all on function public.fp_parts(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fp_note(text, text, boolean, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.fp_sig_kv() from public, anon, authenticated;
revoke all on function public.fp_sig_rows() from public, anon, authenticated;

do $$
declare t text; pk text; m record;
begin
  foreach t in array array['app_state', 'app_settings'] loop
    execute format('drop trigger if exists fp_sig_ins on public.%I', t);
    execute format('drop trigger if exists fp_sig_upd on public.%I', t);
    execute format('drop trigger if exists fp_sig_del on public.%I', t);
    execute format('create trigger fp_sig_ins after insert on public.%I referencing new table as fp_new for each statement execute function public.fp_sig_kv()', t);
    execute format('create trigger fp_sig_upd after update on public.%I referencing old table as fp_old new table as fp_new for each statement execute function public.fp_sig_kv()', t);
    execute format('create trigger fp_sig_del after delete on public.%I referencing old table as fp_old for each statement execute function public.fp_sig_kv()', t);
  end loop;
  for m in select * from (values ('stores', 'id'), ('employees', 'id'), ('ingredients', 'code'), ('recipes', 'id'), ('vendors', 'id'), ('categories', 'code')) v(t, pk) loop
    if to_regclass('public.' || m.t) is null then continue; end if;
    execute format('drop trigger if exists fp_sig_ins on public.%I', m.t);
    execute format('drop trigger if exists fp_sig_upd on public.%I', m.t);
    execute format('drop trigger if exists fp_sig_del on public.%I', m.t);
    execute format('create trigger fp_sig_ins after insert on public.%I referencing new table as fp_new for each statement execute function public.fp_sig_rows(%L)', m.t, m.pk);
    execute format('create trigger fp_sig_upd after update on public.%I referencing old table as fp_old new table as fp_new for each statement execute function public.fp_sig_rows(%L)', m.t, m.pk);
    execute format('create trigger fp_sig_del after delete on public.%I referencing old table as fp_old for each statement execute function public.fp_sig_rows(%L)', m.t, m.pk);
  end loop;
  -- Realtime（あれば）：合図の表だけを足す
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signal') then
    execute 'alter publication supabase_realtime add table public.sync_signal';
  end if;
end $$;
