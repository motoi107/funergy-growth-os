-- Invoice取込 の「この端末で覚える」（v1063）が使えるかの確認（読むだけ。何も書き換えません）
-- v1063 は、メールのアカウントの社員の ID（manager_auth.emp_id）が、PIN でログインした社員と同じときだけ、その端末に覚えます。
-- emp_id が空・社員の表に無い人は「覚えない」（毎回メール認証）になります。result が NG の行を直してください。
select coalesce(u.email, '（メール不明）') as email, m.role, m.emp_id, e.data->>'name' as employee_name,
       case when coalesce(m.emp_id::text, '') = '' then 'NG：emp_id が空（この人は毎回メール認証になる）'
            when e.data is null then 'NG：emp_id に当たる社員が社員の表にいない'
            when coalesce(e.data->>'status', '') = '退職' then 'NG：社員の表で退職になっている'
            else 'OK' end as result
from public.manager_auth m
left join auth.users u on u.id = m.user_id
left join public.employees e on e.data->>'id' = m.emp_id::text
where m.role in ('ceo', 'gm', 'office', 'office_crew')
order by result desc, m.role, email;
-- 直すとき（1 人ずつ。社員の ID は 従業員マスター で確かめる）：
--   update public.manager_auth set emp_id = '<社員の ID>' where user_id = (select id from auth.users where email = '<メールアドレス>');
