-- 読むだけ（v1139・2b-1）。20261108090000_secure_state_rls.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 中身（成長カルテ・賞与の値）は出しません。数と大きさ・決まりの名前だけです。表をそのまま Claude に貼ってください。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の RLS（行ごとの決まり）', case when c.relrowsecurity then 'ON' else 'OFF（SQL が ON にして、今までと同じ決まり ss_open を足します）' end, 'info'
  from pg_class c where c.oid = to_regclass('public.app_state')
union all
select 3, '今の決まり（policy）', coalesce(string_agg(p.policyname || '（' || p.permissive || '・' || p.cmd || '・' || array_to_string(p.roles, ',') || '）', ' / ' order by p.policyname), 'なし'), 'info'
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state'
union all
select 4, 'anon が読める・書ける（表の権限）',
       concat_ws(' ', case when has_table_privilege('anon', 'public.app_state', 'select') then 'select' end, case when has_table_privilege('anon', 'public.app_state', 'insert') then 'insert' end,
                 case when has_table_privilege('anon', 'public.app_state', 'update') then 'update' end, case when has_table_privilege('anon', 'public.app_state', 'delete') then 'delete' end), 'info'
union all
select 5, '対象のキーの行（数・大きさ）', count(*)::text || ' 行・' || coalesce(round(sum(octet_length(s.value::text)) / 1024.0)::text, '0') || ' KB', 'info'
  from public.app_state s
 where s.key::text in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
    or (left(s.key::text, 12) = 'spl_bonus_q_' and length(s.key::text) > 12)
union all
select 6, '関数 app_state_index（v1098。あると関数 secure-state が変わった行だけ返す）', count(*)::text,
       case when count(*) = 1 then 'OK' else 'info（無くても動く。毎回全部返す）' end
  from pg_proc p where p.proname = 'app_state_index' and p.pronamespace = 'public'::regnamespace
union all
select 7, 'GM・CEO のメールのアカウントで、社員と結ばれていない（PIN のログインでは成長カルテ・賞与を読めない）', count(*)::text,
       case when count(*) = 0 then 'OK' else 'NG（manager_auth の emp_id を入れる。入れるまで、その人は管理者ページ（メール）だけで使える）' end
  from public.manager_auth m left join public.employees e on e.id::text = m.emp_id::text
 where m.role in ('gm', 'ceo') and (m.emp_id is null or e.id is null)
union all
select 8, 'すでに入っている（決まり ss_secret）', count(*)::text, case when count(*) = 0 then 'OK（まだ）' else 'info（入っている。2 回流しても同じ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 9, 'Realtime で配っている（publication）', coalesce(string_agg(pt.pubname, ','), 'なし'), 'info'
  from pg_publication_tables pt where pt.schemaname = 'public' and pt.tablename = 'app_state'
order by n;
