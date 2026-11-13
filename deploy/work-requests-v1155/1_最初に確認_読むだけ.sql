-- v1155 ワークセンターの申請 段階 2：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- まだ無い表・関数は直接書かず、あるときだけ query_to_xml で読む（v1131〜v1135 が入っていなくてもこの SQL は止まらない）。
select '1. これまでの段（v1131〜v1135）が入っている' as check_name,
  case when to_regprocedure('public.wr_apply_fresh(public.wr_requests)') is not null and to_regprocedure('public.wr_act_eval(jsonb)') is not null
    and to_regclass('public.wr_store_views') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1135 を入れる）' end as result
union all select '2. 今の SQL の段（4 なら初めて・5 ならもう入っている＝もう一度流しても同じ）',
  coalesce((select substring(prosrc from '''stage'', *([0-9]+)') from pg_proc where oid = to_regprocedure('public.wr_stage(jsonb)')), '—')
union all select '3. G2 も権限の確かめに入る（v1147 の直し・この SQL では変えない）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_elevated(jsonb)')) like '%>= 2%' then 'OK'
    else 'NG（参考：20261116080000_wr_people_g2.sql がまだ。段階 2 には関わらない）' end
union all select '4. GM・CEO のアカウントが社員と結ばれている',
  (select case when count(*) > 0 then 'OK（' || count(*) || '）' else 'STOP（GM・CEO の emp_id が無いと使い始められない）' end from public.manager_auth where role in ('gm','ceo') and coalesce(emp_id::text, '') <> '')
union all select '5. 経理・事務Crew のアカウントが社員と結ばれている',
  (select case when count(*) > 0 then 'OK（' || count(*) || '）' else 'NG（経理の確認ができない）' end from public.manager_auth where role in ('office','office_crew') and coalesce(emp_id::text, '') <> '')
union all select '6. ワークセンターの申請を使い始めているか（true なら OK）',
  case when to_regclass('public.wr_settings') is null then 'STOP（wr_settings が無い）'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select live::text v from public.wr_settings where id = 1', false, false, '')))[1]::text, 'false') end
union all select '（参考）今の申請の数',
  case when to_regclass('public.wr_requests') is null then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select count(*)::text v from public.wr_requests', false, false, '')))[1]::text end
union all select '（参考）段階 2 の種類の申請（初めてなら 0）',
  case when to_regclass('public.wr_requests') is null then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select count(*)::text v from public.wr_requests where kind in (''budget'',''leave'',''shift'',''hire'',''resign'',''promo'',''tip_self'',''skill_self'',''prep'',''plan'')', false, false, '')))[1]::text end;
