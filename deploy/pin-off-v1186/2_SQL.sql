-- top-pin-off（v1186）。仕様：docs/PIN_OFF_V1186_JA.md。
-- Moto さん 11/16 23:24 HST「PINでのログインやめます」：GM・CEO・経理（社員の役割か manager_auth の役割が ceo・gm・office）は、
-- PIN でログインしない（名前を選んだあと、メールとパスワードだけ）。PIN が要るところ（割引・チャットの「続ける」など）は今までどおり。
-- ・この SQL を流したときから止まる（スイッチ dl_flags の top_pin_off）。戻すときは deploy/pin-off-v1186/PIN_を戻す.sql。
-- ・メールのログイン（v1185 の dl_email_login）が無ければ、スイッチが入っていても止めない（だれも入れなくなるのを防ぐ）。
-- ・GM・CEO・経理のうち、メールのアカウント（manager_auth の ceo・gm・office）と結ばれていない人が 1 人でもいれば、何も変えずに止まる。
-- ・auth-pin・emp-private（v1186 の非公開の 1 ファイル）は dl_pin_blocked で決める：その人にはログインの印を出さない・給与を PIN で渡さない。
-- ・経理は「ログインの試し（端末＋PIN）」にも入れない（dl_emp の top に足す。今の経理の試しの端末は止まる）。
-- ・新しい端末の知らせ（v1185）：足したあと、アプリ・secure-state と同じく時刻の順に並べてから 500 件にする。
-- 表も関数もサーバーの鍵（service_role）だけ。公開の鍵（anon・authenticated）では読めない・呼べない。security invoker・search_path 固定。
-- 社員の表・manager_auth は読むだけ。2 回流しても同じ（表は if not exists・関数は create or replace・スイッチは入れ直すだけ）。

do $$
declare n integer; names text;
begin
 if to_regprocedure('public.dl_email_login(jsonb)') is null or to_regprocedure('public.dl_emp(text)') is null then
  raise exception 'STOP: 先に 20261205090000_email_login.sql（v1185 の SQL）を流してください。何も変えていません。';
 end if;
 -- PIN を止めると入れなくなる人（在籍の GM・CEO・経理で、メールのアカウントと結ばれていない）
 select count(*), string_agg(x.nm, '、' order by x.nm) into n, names from (
  select coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', e.j->>'id') as nm
  from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
  where (coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office'))
    and not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true')
    and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.j->>'id' and m.role in ('ceo','gm','office'))) x;
 if n > 0 then
  raise exception 'STOP: GM・CEO・経理のうち % 人が、メールのアカウントと結ばれていません（%）。PIN を止めると入れなくなるので、何も変えていません。先にその人のメールのアカウントを作って社員と結んでください（Claude に）。', n, names;
 end if;
end $$;

create table if not exists public.dl_flags (
 key text primary key,
 value boolean not null,
 set_at timestamptz not null default now(),
 note text
);
alter table public.dl_flags enable row level security;
revoke all on public.dl_flags from public, anon, authenticated;
grant select, insert, update, delete on public.dl_flags to service_role;

-- PIN でのログインを止めているか。メールのログイン（dl_email_login）が無ければ false（止めない）
create or replace function public.dl_top_pin_off() returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select to_regprocedure('public.dl_email_login(jsonb)') is not null
  and coalesce((select f.value from public.dl_flags f where f.key = 'top_pin_off'), false);
$$;

-- 関数 device-login の login_info（ログインの画面が「PIN でログイン」を出すか）。人によらない（だれが GM かは名前の一覧の印で分かる）
create or replace function public.dl_top_pin_info(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('top_pin_off', public.dl_top_pin_off());
$$;

-- その人の PIN のログインを止めるか（auth-pin・emp-private が PIN を確かめたあとに聞く）。p：emp_id と name（どちらか一方でもよい）
-- 止める：スイッチが入っていて、その人（同じ名前の人が何人かいれば、そのだれか）の社員の役割（列か中身）が ceo・gm・office
-- （アプリがメールとパスワードの段に回す人と同じ決め方。manager_auth の役割では決めない：アプリが回さない人を止めると、だれも入れなくなる）
create or replace function public.dl_pin_blocked(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(btrim(coalesce(p->>'emp_id', '')), ''); v_name text := nullif(btrim(coalesce(p->>'name', '')), ''); v_top boolean := false;
begin
 if not public.dl_top_pin_off() then return jsonb_build_object('blocked', false); end if;
 if v_emp is null and v_name is null then raise exception 'bad_value'; end if;
 select coalesce(bool_or(
   coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office')), false)
  into v_top
  from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
  -- 社員の ID と名前の両方で探す（どちらかが GM・CEO・経理なら止める：送られた ID と名前が別の人でも安全なほう）
  where (v_emp is not null and e.j->>'id' = v_emp)
   or (v_name is not null and btrim(coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', '')) = v_name);
 return jsonb_build_object('blocked', v_top);
end $$;

-- 社員の行（v1183 と同じ。v1186：PIN を止めているあいだは、経理も「試せない人」（top）に入れる）
create or replace function public.dl_emp(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare j jsonb; d jsonb; v_role text; v_top boolean;
begin
 if p_emp is null or length(p_emp) > 64 then return null; end if;
 select to_jsonb(e) into j from public.employees e where e.id::text = p_emp;
 if j is null then return null; end if;
 d := case when jsonb_typeof(j->'data') = 'object' then j->'data' else '{}'::jsonb end;
 v_role := coalesce(nullif(j->>'role', ''), d->>'role', '');
 -- 列と中身のどちらかが GM・CEO なら試せない（安全なほう）
 v_top := v_role in ('ceo','gm') or coalesce(d->>'role', '') in ('ceo','gm') or exists (select 1 from public.manager_auth m where m.emp_id::text = p_emp and m.role in ('ceo','gm'));
 -- v1186：PIN を止めているあいだは経理も（メールとパスワードで入る）
 if not v_top and public.dl_top_pin_off() then
  v_top := v_role = 'office' or coalesce(d->>'role', '') = 'office' or exists (select 1 from public.manager_auth m where m.emp_id::text = p_emp and m.role = 'office');
 end if;
 return jsonb_build_object(
  'emp', p_emp,
  'name', left(btrim(coalesce(nullif(btrim(j->>'name'), ''), d->>'name', '')), 80),
  'store', left(coalesce(nullif(j->>'store', ''), d->>'store', ''), 40),
  'role', left(v_role, 20),
  'top', v_top,
  'out', coalesce(j->>'status', '') = '退職' or coalesce(d->>'status', '') = '退職' or coalesce(d->>'osDisabled', '') = 'true');
end $$;

-- 新しい端末の知らせ（v1185 と同じ。v1186：足したあと時刻の順に並べてから 500 件にする＝アプリの mergeNotifs・secure-state と同じ）
create or replace function public.dl_email_notice(p_emp text, p_name text, p_role text, p_dev text) returns boolean
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v jsonb; ts timestamptz; v_items jsonb; v_id text; v_now timestamptz := now(); v_lab text; n integer;
begin
 v_lab := case p_role when 'ceo' then 'CEO' when 'gm' then 'GM' when 'office' then '経理' else upper(coalesce(p_role, '')) end;
 v_id := 'dlm-' || substr(md5(p_emp || '|' || p_dev || '|' || v_now::text || '|' || random()::text), 1, 20);
 v_items := jsonb_build_array(
  -- 本人に（toUser・出した人はシステム）
  jsonb_build_object('id', v_id || '-u', 'type', 'login', 'title', '新しい端末でログインしました',
   'text', coalesce(p_dev, 'この端末') || ' でメールとパスワードのログインをしました。心あたりがなければ、すぐにパスワードを変えてください（管理者に頼む）。',
   'toUser', p_name, 'page', 'mypage', 'by', 'システム', 'at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'readBy', '[]'::jsonb, 'ackBy', '[]'::jsonb),
  -- ほかの GM・CEO に（出した人＝本人：アプリは自分が出した知らせを自分に出さない）
  jsonb_build_object('id', v_id || '-g', 'type', 'login', 'title', p_name || ' さん（' || v_lab || '）が新しい端末でログインしました',
   'text', coalesce(p_dev, '端末') || '。心あたりを ' || p_name || ' さんに確かめてください。',
   'toRoles', jsonb_build_array('ceo', 'gm'), 'by', p_name, 'at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'readBy', '[]'::jsonb, 'ackBy', '[]'::jsonb));
 select a.value::jsonb, a.updated_at into v, ts from public.app_state a where a.key = 'notifications' for update;
 if not found then
  insert into public.app_state(key, value, updated_at) values ('notifications', v_items, v_now) on conflict (key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
 end if;
 if jsonb_typeof(v) = 'string' then   -- 前の版が JSON の文字で書いた行
  begin v := (v #>> '{}')::jsonb; exception when others then return false; end;
 end if;
 if v is null or jsonb_typeof(v) <> 'array' then return false; end if;
 v := v || v_items;
 -- 時刻（at）の順（同じ時刻は今の並び）。アプリ（mergeNotifs）と secure-state も時刻の順に並べて新しい 500 件を残す
 v := (select jsonb_agg(x.e order by coalesce(x.e->>'at', '') collate "C", x.o) from jsonb_array_elements(v) with ordinality x(e, o));
 n := jsonb_array_length(v);
 if n > 500 then
  v := (select jsonb_agg(x.e order by x.o) from jsonb_array_elements(v) with ordinality x(e, o) where x.o > n - 500);
 end if;
 update public.app_state set value = v, updated_at = greatest(v_now, ts + interval '1 millisecond') where key = 'notifications';
 return true;
end $$;

-- 入っているかの目印（確認の SQL が見る）
create or replace function public.dl_pin_stage() returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$ select 1 $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

-- スイッチを入れる（ここから PIN のログインが止まる）
insert into public.dl_flags (key, value, set_at, note) values ('top_pin_off', true, now(), 'v1186 の SQL')
 on conflict (key) do update set value = true, set_at = now(), note = 'v1186 の SQL';
select public.dl_log('pin_off', null, null, 'sql', 'ok', 'top_pin_off=true', null, null);
