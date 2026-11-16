-- 読むだけ（v1174 の直し）。会計 PL の共有の保存（pl_public）の見張りが入ったかと、月・店ごとの「確定・暫定」の数。
-- 金額は出さない。結果は Claude との会話にだけ貼る。1（追加の SQL）の前に流しても止まらない（setup の行が「無い」「関数なし」と NG になるだけ）。
with t as (
  select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value'
), j as (
  -- 関数はまだ無いことがある（1 の前）。名前を直接書くと文全体がエラーになるので、あるときだけ文字の問い合わせで呼ぶ（Codex #173 6903935612 の 4）
  select case when to_regprocedure('public.fp_pl_public_join(jsonb,jsonb)') is null then null
    else (xpath('/row/v/text()', query_to_xml(
      'select public.fp_pl_public_join('
      || quote_literal('{"_at":1,"2026-10":{"F01":{"sales":100,"_at":1},"F02":{"sales":5,"prov":1,"_at":1}}}') || '::jsonb, '
      || quote_literal('{"_at":2,"2026-10":{"F01":{"sales":90,"prov":1,"_at":2},"F03":{"sales":7,"prov":1,"_at":2}}}') || '::jsonb)::text as v',
      false, true, '')))[1]::text::jsonb end as v
), s as (
  select a.value::text::jsonb as v from public.app_settings a where a.key = 'pl_public'
), m as (
  select mo.key as ym, mo.value as mv from s, jsonb_each(case when jsonb_typeof(s.v) = 'object' then s.v else '{}'::jsonb end) mo
   where mo.key ~ '^[0-9]{4}-[0-9]{2}$' and jsonb_typeof(mo.value) = 'object'
)
select 'setup' as part, 'value column type' as item, coalesce((select data_type from t), '列なし') as result,
       case when (select data_type from t) in ('jsonb', 'json', 'text') then 'OK' else 'NG' end as ok
union all
select 'setup', 'trigger fp_pl_public_keep_final',
       coalesce((select tgenabled::text from pg_trigger where tgname = 'fp_pl_public_keep_final' and tgrelid = 'public.app_settings'::regclass), '無い'),
       case when exists (select 1 from pg_trigger where tgname = 'fp_pl_public_keep_final' and tgrelid = 'public.app_settings'::regclass and tgenabled <> 'D') then 'OK' else 'NG' end
union all
select 'setup', 'trigger function is security definer',
       coalesce((select prosecdef::text from pg_proc where oid = to_regprocedure('public.fp_pl_public_keep_final()')), '無い'),
       case when (select prosecdef from pg_proc where oid = to_regprocedure('public.fp_pl_public_keep_final()')) then 'OK' else 'NG' end
union all
select 'setup', 'join keeps the final and both new stores', coalesce((select v::text from j), '関数なし'),
       case when (select v->'2026-10'->'F01'->>'sales' from j) = '100' and (select v->'2026-10' ? 'F02' and v->'2026-10' ? 'F03' from j) then 'OK' else 'NG' end
union all
select 'setup', 'anon cannot call the join',
       case when to_regprocedure('public.fp_pl_public_join(jsonb,jsonb)') is null or not exists (select 1 from pg_roles where rolname = 'anon') then '-'
            else has_function_privilege('anon', 'public.fp_pl_public_join(jsonb,jsonb)', 'execute')::text end,
       case when to_regprocedure('public.fp_pl_public_join(jsonb,jsonb)') is not null and exists (select 1 from pg_roles where rolname = 'anon')
             and not has_function_privilege('anon', 'public.fp_pl_public_join(jsonb,jsonb)', 'execute') then 'OK' else 'NG' end
union all
select * from (
  select 'data', m.ym,
         (select count(*) from jsonb_each(m.mv) st where jsonb_typeof(st.value) = 'object'
            and coalesce(st.value->>'prov', '') in ('', 'false', '0') and jsonb_typeof(st.value->'sales') = 'number' and (st.value->>'sales')::numeric > 0)::text || ' 確定 / '
         || (select count(*) from jsonb_each(m.mv) st where jsonb_typeof(st.value) = 'object')::text || ' 店',
         ''
    from m where m.ym >= '2026-01' order by m.ym
) d;
