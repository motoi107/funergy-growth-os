-- v1159 段階 3：入れる前の確認（読むだけ・何も変えない）。STOP が無ければ 2 へ。（参考）は数を見るだけ（名前・中身は出さない）。
select '1. 段階 2 の SQL が入っている' as check_name,
  case when to_regprocedure('public.wr_s2_steps(text,text,text)') is not null and to_regprocedure('public.wr_submit_s2(jsonb)') is not null
    then 'OK' else 'STOP（先に deploy/work-requests-v1155 の ②）' end as result
union all select '2. 段階 3 がもう入っている（入っていれば 6）',
  case when to_regprocedure('public.wr_stage(jsonb)') is null then '—' else public.wr_stage('{}'::jsonb)->>'stage' end
union all select '3. 段階 2 を使っている（いいえなら、使い始めるまで写さない・前の承認タブも閉じない）',
  case when exists (select 1 from public.wr_settings w where w.id = 1 and coalesce((to_jsonb(w)->>'live')::boolean, false) and coalesce((to_jsonb(w)->>'s2_live')::boolean, false)) then 'はい' else 'いいえ' end
union all select '（参考）前の承認タブの承認待ち（段階 2 の印なし）',
  (select count(*)::text from (select distinct w.x->>'id' from public.app_state s,
    lateral (select case when jsonb_typeof(s.value::jsonb) = 'object' and s.value::jsonb->>'__st' = '1' then s.value::jsonb->'v' else s.value::jsonb end as v) v,
    lateral jsonb_array_elements(case when jsonb_typeof(v.v) = 'array' then v.v else '[]'::jsonb end) w(x)
    where (s.key = 'approvals' or s.key like 'spl\_approvals\_%') and w.x->>'status' = 'pending' and coalesce(w.x->>'wrq', '') not in ('1','true')) q)
union all select '（参考）前の承認タブの記録の数（全部）',
  (select count(*)::text from (select distinct w.x->>'id' from public.app_state s,
    lateral (select case when jsonb_typeof(s.value::jsonb) = 'object' and s.value::jsonb->>'__st' = '1' then s.value::jsonb->'v' else s.value::jsonb end as v) v,
    lateral jsonb_array_elements(case when jsonb_typeof(v.v) = 'array' then v.v else '[]'::jsonb end) w(x)
    where s.key = 'approvals' or s.key like 'spl\_approvals\_%') q);
