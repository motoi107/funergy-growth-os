-- pin-blocked-id-first（v1186 の直し）。仕様：docs/PIN_OFF_V1186_JA.md。
-- #184 の Claude のレビュー 6945401027・Codex 6945462615／6955376116 の P2：
--   前（20261206090000）の dl_pin_blocked は、社員の ID と名前のどちらかで当たった人（退職した人も）のだれかが
--   GM・CEO・経理なら止めていた → 退職した（または在籍の）GM・CEO・経理と同じ名前の Crew も、正しい ID を送っても止まり、
--   メールのアカウントが無いので PIN でもメールでも入れなくなった。
-- 今：社員の ID があってその行があれば、その人の役割（列か中身）だけで決める。
--   名前で探すのは ID が無い・見つからないときだけで、在籍の人だけ（退職・OS の無効は外す）。在籍で同じ名前の人のだれかが
--   GM・CEO・経理なら止める（PIN は名前ごとに 1 つなので、ID が無いと見分けられない＝安全なほう）。
--   auth-pin v1186 は社員の表で確かめた本人の ID（名前の合う行）を、emp-private v1186 は在籍で同じ名前の人が 1 人のときその人の ID を送る。
-- 先に 20261206090000 が要る（無ければ何も変えずに止まる）。表・スイッチは変えない。関数 2 つの置き換えだけ。2 回流しても同じ。
-- 公開の鍵（anon・authenticated）では呼べない（サーバーの鍵だけ）。security invoker・search_path 固定。

do $$
begin
 if to_regprocedure('public.dl_pin_blocked(jsonb)') is null or to_regclass('public.dl_flags') is null then
  raise exception 'STOP: 先に 20261206090000_top_pin_off.sql（v1186 の SQL）を流してください。何も変えていません。';
 end if;
end $$;

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

-- 入っているかの目印（確認の SQL が見る）：2＝ID を先に見る直しが入っている
create or replace function public.dl_pin_stage() returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$ select 2 $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname in ('dl_pin_blocked', 'dl_pin_stage') loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;
