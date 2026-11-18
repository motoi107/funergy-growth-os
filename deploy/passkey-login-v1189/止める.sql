-- v1189 パスキーとメールのコードのログインを止める（もとに戻す）。Supabase の SQL Editor に貼って Run。
-- ・ログインの画面の「パスキーでログイン」とメールのコードを出さない（login_info が pk を返さない）。
-- ・メール＋パスキーにした人も、前の PIN でまた入れる（PIN の値は消していない。忘れた人は GM が PIN の一覧で新しくする）。
-- ・いまログインしている人（12 時間）・送った招待・コードは使えなくする。
-- ・表（dl_people・dl_pk_*・dl_mail）と記録（dl_events）は残す・消さない。Supabase の利用者とパスキーもそのまま（使われない）。
-- ・v1183 の「ログインの試し」はやめたまま（戻さない）。GM・CEO・経理のメールとパスワードは今までどおり。
-- また始めるときは 2_SQL.sql をもう一度流す（メール＋パスキーにした人は、その時からまた PIN では入れない）。
begin;
do $$
begin
 if to_regprocedure('public.dl_pk_stage()') is null then
  raise exception 'STOP: パスキーのログイン（2_SQL.sql）は入っていません。何も変えていません。';
 end if;
end $$;
update public.dl_pk_sessions set revoked_at = now(), revoke_reason = 'stopped' where revoked_at is null;
update public.dl_pk_invites set revoked_at = now(), revoke_reason = 'stopped' where used_at is null and revoked_at is null;
update public.dl_pk_codes set dead_at = now() where used_at is null and dead_at is null;

-- 20261206090000（v1186）と同じ：login_info は PIN のスイッチだけ
create or replace function public.dl_top_pin_info(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('top_pin_off', public.dl_top_pin_off());
$$;

-- 20261207090000（v1186 の直し）と同じ：メール＋パスキーの人も止めない
create or replace function public.dl_pin_blocked(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
-- id_first：社員の ID を先に（その行があればその人だけで決める）。名前で探すのは ID が無い・見つからないときだけ・在籍の人だけ
declare
 v_emp text := nullif(btrim(coalesce(p->>'emp_id', '')), '');
 v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
 v_hit boolean; v_top boolean;
begin
 if not public.dl_top_pin_off() then return jsonb_build_object('blocked', false); end if;
 if v_emp is null and v_name is null then raise exception 'bad_value'; end if;
 if v_emp is not null then
  select true, (coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office'))
   into v_hit, v_top
   from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
   where e.j->>'id' = v_emp
   limit 1;
  if v_hit then return jsonb_build_object('blocked', coalesce(v_top, false)); end if;
 end if;
 if v_name is null then return jsonb_build_object('blocked', false); end if;
 select coalesce(bool_or(
   coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office')), false)
  into v_top
  from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
  where btrim(coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', '')) = v_name
    and not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true');
 return jsonb_build_object('blocked', v_top);
end $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\_pk\_%' loop
  execute format('drop function %s', f.sig);
 end loop;
 revoke all on function public.dl_top_pin_info(jsonb) from public, anon, authenticated;
 grant execute on function public.dl_top_pin_info(jsonb) to service_role;
 revoke all on function public.dl_pin_blocked(jsonb) from public, anon, authenticated;
 grant execute on function public.dl_pin_blocked(jsonb) to service_role;
 perform public.dl_log('pk_stopped', null, null, 'sql', 'ok', null, null, null);
end $$;
commit;
select to_regprocedure('public.dl_pk_stage()') is null as stopped,
  (select count(*) from public.dl_people where mode = 'passkey') as passkey_people_kept,
  (select count(*) from public.dl_pk_sessions where revoked_at is null) as live_logins;
