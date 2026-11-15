-- v1164：経費の申請（ガソリン代・建て替え経費・事前経費）を G2〜G6 が出せる（Moto さんの依頼書 11/14「申請/承認の統合と経理レビューへの引き継ぎ」の最優先）。
-- 仕様：docs/EXPENSE_SUBMIT_V1164_JA.md
--
-- 【前】出せる人：ガソリン代＝G3 以上・AM・GM・CEO／事前経費＝G4 以上・AM・GM・CEO／建て替え＝G2 以上・AM・GM・CEO・経理・事務Crew。
--   アプリは G2（社員の表の役割 g2）を役職の上で sl（G3 相当）として扱うので、G2 にもマイページの「ガソリン代」が出て、送るとサーバーが断った（forbidden）。
-- 【いま】3 種とも G2 以上（AM・GM・CEO・経理も）。経理・事務Crew の建て替えは今までどおり。G1 は 3 種とも出せない（承認・経理の権限は変えない）。
--   グレードは今までと同じ wr_actor（GM・CEO が確かめた写しと社員の表の狭いほう・写しの無い人は G3 まで）。店の範囲も今までどおり。
--   whoami に exp_kinds（この人が出せる種類）を返す。アプリはこれで入口を出す（画面とサーバーで同じ決まり）。
-- 先に 20261120090000_work_requests_stage2.sql（wr_whoami の今の形）を流してから。2 回流しても同じ。
-- 気をつけること：20261104090000・20261120090000 をあとで流し直すと前の決まりに戻る（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.wr_can_submit(jsonb,text,text)') is null or to_regprocedure('public.wr_s2_live()') is null or to_regprocedure('public.wr_people_items()') is null then
  raise exception 'STOP: 先にワークセンターの申請の SQL（段階 2 まで：deploy/work-requests-v1155）を流してください（何も変えていません）';
 end if;
end $$;

-- この人が出せる経費の種類（店に関係なく）
create or replace function public.wr_exp_kinds(a jsonb) returns text[]
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
   when (a->>'role') in ('ceo','gm','am') or coalesce((a->>'grade')::int, 0) >= 2 then array['mileage','reimburse','expense_pre']::text[]
   when (a->>'role') in ('office','office_crew') then array['reimburse']::text[]
   else '{}'::text[] end;
$$;

-- 出せるか：種類（wr_exp_kinds）と店（今までどおり：自分の店（所属・応援）。AM は担当の店も。CEO・GM・経理・事務Crew はどの店・本部（---）も）
create or replace function public.wr_can_submit(a jsonb, p_kind text, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_kind = any(public.wr_exp_kinds(a)), false)
  and coalesce(p_store, '') <> '' and length(p_store) <= 30
  and ((a->>'role') in ('ceo','gm','office','office_crew') or p_store = any(public.wr_arr(a->'stores'))
       or ((a->>'role') = 'am' and p_store = any(public.wr_arr(a->'am_stores'))));
$$;

-- whoami（20261120090000 の形に exp_kinds を足す）
create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings;
begin
 select * into s from public.wr_settings where id = 1;
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'settings_rev', coalesce(s.rev, 1), 'live_at', s.live_at, 'settings_at', s.updated_at,
  'rate', public.wr_mileage_rate(),
  's2', coalesce(s.live, false) and coalesce(s.s2_live, false), 's2_at', s.s2_at, 's2_by', s.s2_by,
  'exp_kinds', to_jsonb(public.wr_exp_kinds(a)),
  'people', case when (a->>'role') in ('ceo','gm') then (select jsonb_build_object('up', count(*) filter (where x->'up' = 'true'::jsonb), 'changes', count(*),
     'confirmed', (select count(*) from public.wr_people)) from jsonb_array_elements(public.wr_people_items()) x) end);
end $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('wr_exp_kinds','wr_can_submit','wr_whoami') loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
