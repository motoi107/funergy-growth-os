-- v1164 経費の申請（G2〜G6）：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。
select '1. 出せる種類の関数がある（G2 以上は 3 種・経理・事務Crew は建て替え・G1 は無し）' as check_name,
  case when to_regprocedure('public.wr_exp_kinds(jsonb)') is not null
    and public.wr_exp_kinds('{"role":"staff","grade":2}'::jsonb) = array['mileage','reimburse','expense_pre']
    and public.wr_exp_kinds('{"role":"staff","grade":1}'::jsonb) = '{}'::text[]
    and public.wr_exp_kinds('{"role":"office_crew","grade":1}'::jsonb) = array['reimburse'] then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. 出せるかの決まりが新しい（wr_can_submit が wr_exp_kinds を使う）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_can_submit(jsonb,text,text)')) like '%wr_exp_kinds%' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. whoami が出せる種類（exp_kinds）を返す',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_whoami(jsonb)')) like '%exp_kinds%' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. ブラウザの鍵では wr_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. 段階 3 のまま（SQL の段が 6）',
  case when public.wr_stage('{}'::jsonb)->>'stage' = '6' then 'OK' else 'NG（deploy/work-requests-v1159 の ② → この 2）' end;
