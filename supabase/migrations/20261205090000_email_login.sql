-- email-login（v1185・ログインの段階 2）。仕様：docs/EMAIL_LOGIN_V1185_JA.md。
-- GM・CEO・経理（manager_auth の役割 ceo・gm・office）は、名前を選んだあと、管理者セキュアページと同じメールとパスワードで入る。
-- 関数 device-login の email_login が、メールのログイン（Supabase Auth）の利用者 ID を確かめてからここを呼ぶ。
-- ・manager_auth の行がその人の社員（選んだ名前）と結ばれていて、役割が ceo・gm・office で、社員が在籍のときだけ入れる
-- ・アプリが送る名前・役割は使わない（manager_auth と社員の表で決める）
-- ・端末を覚えない（Moto さん 11/16：開くたびにメールとパスワード）。ここに残すのは「この人がこの端末で入ったことがあるか」の印だけ
--   （端末の番号の sha-256。番号そのもの・パスワード・トークン・ログインの印は残さない）
-- ・新しい端末で入ったら、本人とほかの GM・CEO にアプリの知らせ（通知・app_state の notifications）を足す（Moto さん 11/16：5A）
-- ・記録は dl_events（v1183 と同じ表・180 日）
-- 表も関数もサーバーの鍵（service_role）だけ。公開の鍵（anon・authenticated）では読めない・呼べない。security invoker・search_path 固定。
-- 社員の表・manager_auth は読むだけ。app_state は notifications の行に知らせを足すだけ（ほかの行・ほかの知らせは変えない）。
-- 先に 20261203090000_device_login.sql（v1183）が要る。2 回流しても同じ（表は if not exists・関数は create or replace）。

do $$
begin
 if to_regprocedure('public.dl_emp(text)') is null or to_regprocedure('public.dl_log(text,text,uuid,text,text,text,text,text)') is null then
  raise exception 'STOP: 先に 20261203090000_device_login.sql（v1183 の SQL）を流してください。何も変えていません。';
 end if;
end $$;

create table if not exists public.dl_email_devices (
 emp_id text not null,
 dev_hash text not null,                   -- 端末の番号の sha-256（関数が作る）。番号そのものは残さない
 first_at timestamptz not null default now(),
 last_at timestamptz not null default now(),
 name text,                                -- 端末の名前（iPhone · Safari など・アプリが送る・60 字まで）
 primary key (emp_id, dev_hash)
);
alter table public.dl_email_devices enable row level security;
revoke all on public.dl_email_devices from public, anon, authenticated;
grant select, insert, update, delete on public.dl_email_devices to service_role;

-- 新しい端末の知らせを app_state の notifications に足す（アプリの通知と同じ形）。行をロックして足す（ほかの書き込みと重ならない）。
-- 読めない形（配列でない）なら足さない（ほかの知らせを消さない）。返す：足したか
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
 n := jsonb_array_length(v);
 if n > 500 then
  v := (select jsonb_agg(x.e order by x.o) from jsonb_array_elements(v) with ordinality x(e, o) where x.o > n - 500);
 end if;
 update public.app_state set value = v, updated_at = greatest(v_now, ts + interval '1 millisecond') where key = 'notifications';
 return true;
end $$;

-- メールのログイン。p：actor（Supabase Auth の利用者 ID・関数が確かめた）、emp_id（選んだ名前の社員）、dev_hash（端末の番号の sha-256）、
--   mode（start＝人が入った／refresh＝裏でログインの印を取り替える）、device_name、ip、ua
-- 返す：{ state:'ok', emp_id, name, role, new_device, notice } か { state: forbidden | not_linked | wrong_person | inactive }
create or replace function public.dl_email_login(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a uuid; r text; v_emp text; e jsonb; v_pick text; v_hash text; v_mode text; v_name text; v_new boolean := false; v_notice boolean := false;
 v_state text; v_actor text; n integer;
begin
 if coalesce(p->>'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 a := (p->>'actor')::uuid;
 v_actor := 'mail:' || a::text;
 v_pick := p->>'emp_id';
 v_hash := p->>'dev_hash';
 v_mode := case when p->>'mode' = 'refresh' then 'refresh' else 'start' end;
 if v_pick is null or v_pick !~ '^[A-Za-z0-9_.:@-]{1,64}$' or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_value'; end if;
 v_name := nullif(left(regexp_replace(coalesce(p->>'device_name', ''), '[[:cntrl:]<>]', '', 'g'), 60), '');
 select m.role, m.emp_id::text into r, v_emp from public.manager_auth m where m.user_id = a;
 if r is null then v_state := 'forbidden';
 elsif r = 'suspended' then v_state := 'inactive';
 elsif r not in ('ceo', 'gm', 'office') then v_state := 'forbidden';
 elsif v_emp is null or v_emp = '' then v_state := 'not_linked';
 elsif v_emp <> v_pick then v_state := 'wrong_person';
 else
  e := public.dl_emp(v_emp);
  if e is null then v_state := 'not_linked';
  elsif (e->>'out')::boolean then v_state := 'inactive';
  else v_state := 'ok';
  end if;
 end if;
 if v_state <> 'ok' then
  perform public.dl_log('email_' || v_mode, v_pick, null, v_actor, 'fail', v_state, p->>'ip', p->>'ua');
  return jsonb_build_object('state', v_state);
 end if;
 if v_mode = 'start' then
  insert into public.dl_email_devices (emp_id, dev_hash, name) values (v_emp, v_hash, v_name) on conflict (emp_id, dev_hash) do nothing;
  get diagnostics n = row_count;
  v_new := n > 0;
  if not v_new then update public.dl_email_devices set last_at = now(), name = coalesce(v_name, name) where emp_id = v_emp and dev_hash = v_hash; end if;
  if v_new then
   begin v_notice := public.dl_email_notice(v_emp, e->>'name', r, v_name);
   exception when others then v_notice := false; end;   -- 知らせを足せなくてもログインは止めない（記録に残す）
  end if;
 end if;
 perform public.dl_log('email_' || v_mode, v_emp, null, v_actor, 'ok', case when v_new then case when v_notice then 'new_device' else 'new_device_notice_failed' end end, p->>'ip', p->>'ua');
 return jsonb_build_object('state', 'ok', 'emp_id', v_emp, 'name', e->>'name', 'role', r, 'new_device', v_new, 'notice', v_notice);
end $$;

-- 入っているかの目印（確認の SQL・関数が見る）
create or replace function public.dl_email_stage() returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$ select 1 $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;
