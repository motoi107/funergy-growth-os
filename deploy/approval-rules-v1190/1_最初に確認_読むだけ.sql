-- v1190 承認・閲覧の共通ルール：入れる前の確認（読むだけ・何も変えない）。STOP が無ければ ② へ。
-- 名前・メールは出しません（数だけ）。表は Claude との会話にだけ貼ってください（GitHub には貼らない）。
select '1. 申請の SQL が v1184（経費の申請の権限）まで入っている' as check_name,
  case when to_regprocedure('public.wr_exp_grant_save(jsonb)') is not null and to_regprocedure('public.wr_act_s2(jsonb)') is not null
    and to_regprocedure('public.wr_s2_store_has_am(text,text)') is not null and to_regclass('public.wr_people') is not null
    and to_regprocedure('public.wr_person_live(text)') is not null
   then 'OK' else 'STOP（先に deploy/three-fixes-v1184 の ②）' end as result
union all select '1b. v1184 が今の版（事務Crew の確かめの列がある）',
  case when to_regclass('public.wr_exp_grants') is null then 'STOP（先に deploy/three-fixes-v1184 の ②）'
   when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_exp_grants' and column_name = 'crew')
   then 'OK' else 'STOP（v1184 が前の版のまま。deploy/three-fixes-v1184 の ② をもう一度 → その ③ の 10 が OK になってから ② へ）' end
union all select '2. もう入っているか（1＝入っている。② をもう一度流してもルール・記録は残る）',
  case when to_regclass('public.ar_rules') is not null then '1' else '0（初めて）' end
union all select '3. 申請の SQL の段（7 なら初めて・8 ならもう入っている）',
  coalesce(public.wr_stage('{}'::jsonb)->>'stage', '?')
union all select '（参考）承認待ちの申請（共通ルールに切り替えると、この数の申請にルートが付く）',
  (select count(*)::text from public.wr_requests where status = 'pending')
union all select '（参考）CEO・GM のアカウント（社員と結ばれている数 / 全部）',
  (select count(*) filter (where emp_id is not null)::text || ' / ' || count(*)::text from public.manager_auth where role in ('ceo','gm'))
union all select '（参考）経理のアカウント（社員と結ばれている数）',
  (select count(*)::text from public.manager_auth where role = 'office' and emp_id is not null)
union all select '（参考）事務Crew（アカウント / 経費の画面で確かめた）',
  (select count(*)::text from public.manager_auth where role = 'office_crew' and emp_id is not null) || ' / ' ||
  case when to_regclass('public.wr_exp_grants') is null then '—'
   when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_exp_grants' and column_name = 'crew') then '—（v1184 が前の版）' else
    (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.wr_exp_grants where crew is true', false, true, '')))[1]::text end
union all select '（参考）GM・CEO が確かめた AM / Head Chef（承認・閲覧の権限の確かめ）',
  (select count(*) filter (where role = 'am')::text || ' / ' || count(*) filter (where chef)::text from public.wr_people)
union all select '（参考）社員の表で AM・Head Chef なのに、まだ確かめていない人（確かめるまで AM・Head Chef として承認しない）',
  (select count(*)::text from public.employees e cross join lateral (select public.wr_person_live(e.id::text) as l) q
    where q.l is not null and ((q.l->>'role') = 'am' or coalesce((q.l->>'chef')::boolean, false))
      and not exists (select 1 from public.wr_people c where c.emp_id = e.id::text and (((q.l->>'role') = 'am' and c.role = 'am') or (coalesce((q.l->>'chef')::boolean, false) and c.chef))));
