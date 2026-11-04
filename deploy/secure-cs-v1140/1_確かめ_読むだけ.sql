-- 読むだけ（v1140・2b-2）。関数 secure-state を v1140 にする前と、20261109090000_secure_cs_rls.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- Career Score の点・申請の中身は出しません（数・大きさと、確かめが要る人の名前だけ）。表をそのまま Claude に貼ってください。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1140 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, 'work-requests の SQL（GM・CEO が確かめた写し wr_people）', case when to_regclass('public.wr_people') is null then 'ない' else 'ある' end,
       case when to_regclass('public.wr_people') is null then 'STOP（関数 secure-state は PIN のログインの確かめに work-requests を使います）' else 'OK' end
union all
select 4, 'Career Score の点（lss_emp_）', count(*)::text || ' 行・' || coalesce(round(sum(octet_length(s.value::text)) / 1024.0)::text, '0') || ' KB', 'info'
  from public.app_state s where left(s.key::text, 8) = 'lss_emp_' and length(s.key::text) > 8
union all
select 5, 'Career Score の申請（spl_lss_requests_）', count(*)::text || ' 行・' || coalesce(round(sum(octet_length(s.value::text)) / 1024.0)::text, '0') || ' KB', 'info'
  from public.app_state s where left(s.key::text, 17) = 'spl_lss_requests_' and length(s.key::text) > 17
union all
select 6, 'Career Score の履歴（spl_lss_history_）', count(*)::text || ' 行・' || coalesce(round(sum(octet_length(s.value::text)) / 1024.0)::text, '0') || ' KB', 'info'
  from public.app_state s where left(s.key::text, 16) = 'spl_lss_history_' and length(s.key::text) > 16
union all
select 7, '前の統合行（lss_scores・lss_requests・lss_history）', coalesce(string_agg(s.key::text || '（' || round(octet_length(s.value::text) / 1024.0)::text || ' KB）', '・' order by s.key), 'なし'), 'info'
  from public.app_state s where s.key::text in ('lss_scores', 'lss_requests', 'lss_history')
union all
select 8, 'キーが長すぎる Career Score の行（400 文字超。関数で読めない）', count(*)::text, case when count(*) = 0 then 'OK' else 'NG（Claude に貼ってください）' end
  from public.app_state s
 where length(s.key::text) > 400 and (left(s.key::text, 8) = 'lss_emp_' or left(s.key::text, 17) = 'spl_lss_requests_' or left(s.key::text, 16) = 'spl_lss_history_')
union all
-- 同じ名前の在籍の人（Career Score は名前で分けているので、同じ名前の人の点は 1 つの行になる・前から）
select 9, '同じ名前の在籍の人', coalesce(string_agg(q.name || '（' || q.c || ' 人）', '・' order by q.name), 'なし'),
       case when count(*) = 0 then 'OK' else 'info（前から 1 つの行。見られる範囲は、どちらかが見られれば見える）' end
  from (select btrim(e.name) as name, count(*) as c from public.employees e where not public.wr_emp_out(e) and coalesce(btrim(e.name), '') <> '' group by btrim(e.name) having count(*) > 1) q
union all
-- AM・G3 以上・Head Chef で、GM・CEO の確かめがまだ（または社員の表のほうが広い）人。確かめるまで、見られる範囲が狭い（G3 まで・自分の店）
select 10, '確かめがまだの AM・G3 以上・Head Chef（ワークセンター › 承認・閲覧の権限の確かめ）',
       count(*)::text || coalesce('：' || string_agg(btrim(e.name), '・' order by btrim(e.name)), ''),
       case when count(*) = 0 then 'OK' else 'NG（GM・CEO が確かめるまで、その人の Career Score の範囲は G3 まで・自分の店）' end
  from public.employees e
 where not public.wr_emp_out(e)
   and (public.wr_grade(e.title, e.role) >= 3 or e.role in ('am', 'chef'))
   and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
   and (public.wr_person_conf(e.id::text) is null or public.wr_up(public.wr_person_conf(e.id::text), public.wr_person_live(e.id::text)))
union all
select 11, 'Score管理の権限（career_cfg）の行', case when exists (select 1 from public.app_state where key = 'career_cfg') then 'ある' else 'ない' end,
       'info（ある：決めた役職にも、その専門職 × グレードの人の Career Score が届きます）'
union all
select 12, '在籍の人に当たらない Career Score の行（退職・名前を変えた人。GM・CEO だけに届く）',
       count(*)::text, 'info'
  from public.app_state s
 where (left(s.key::text, 8) = 'lss_emp_' or left(s.key::text, 17) = 'spl_lss_requests_')
   and not exists (select 1 from public.employees e where not public.wr_emp_out(e)
                    and e.name = case when left(s.key::text, 8) = 'lss_emp_' then substr(s.key::text, 9) else substr(s.key::text, 18) end)
order by n;
