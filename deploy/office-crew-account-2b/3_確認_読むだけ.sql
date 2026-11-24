-- 2b：事務Crew のメールのアカウントの確かめ（読むだけ・表は何も変えない。このセッションだけの一時の関数を 1 つ作る）。
-- result が NG の行があれば、その行の note のとおりに。メールの欄は Claude との会話に貼らないでください（no の番号と result・note だけでよい）。
create or replace function pg_temp.oc_wr_role(p_emp text) returns text language plpgsql as $$
begin
 return public.wr_actor(jsonb_build_object('emp_id', p_emp))->>'role';
exception when others then return 'エラー（' || sqlerrm || '）';
end $$;
select row_number() over (order by u.email) as no, u.email,
  e.id::text as emp_id,
  coalesce(public.invoice_actor_role(a.user_id), '—') as invoice_role,       -- Invoice取込・照合・QuickBooks の状態（メールのログイン）
  case when e.id is null then '—' else pg_temp.oc_wr_role(e.id::text) end as pin_role,   -- 申請・セキュアな記録（PIN のログイン）
  case when coalesce(a.emp_id::text, '') = '' then 'NG'
       when e.id is null then 'NG'
       when public.wr_emp_out(e) then 'NG'
       when not public.wr_exp_crew(e.role, e.title) then 'NG'
       when public.invoice_actor_role(a.user_id) is distinct from 'office_crew' then 'NG'
       when pg_temp.oc_wr_role(e.id::text) is distinct from 'office_crew' then 'NG'
       else 'OK' end as result,
  case when coalesce(a.emp_id::text, '') = '' then '社員の ID が空：2 でメールと社員を入れ直す（PIN の「この端末で覚える」が使えない）'
       when e.id is null then '社員の表にいない社員の ID：2 でメールと社員を入れ直す'
       when public.wr_emp_out(e) then '退職・OS を止めた人：止める_ひな形.sql でこのアカウントを止める'
       when not public.wr_exp_crew(e.role, e.title) then '従業員マスターで事務Crew でない：役割を直すか、止める_ひな形.sql'
       when public.invoice_actor_role(a.user_id) is distinct from 'office_crew' then 'Invoice取込の役割が office_crew でない：Claude に'
       when pg_temp.oc_wr_role(e.id::text) is distinct from 'office_crew' then 'PIN の役割が office_crew でない：Claude に'
       else 'メールでも PIN でも事務Crew' end as note
from public.manager_auth a
left join auth.users u on u.id = a.user_id
left join public.employees e on e.id::text = a.emp_id::text
where a.role = 'office_crew'
order by u.email;
