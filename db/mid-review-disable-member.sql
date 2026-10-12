-- 中間レビュー：利用者を止める（SQL Editor で、< > の 1 か所を書き換えて実行）
-- 止めた人は、次の操作から中間レビューを開けない（一覧・読み書きのすべてでサーバーが断る）。記録・返信は消さない。
-- AM が退職・異動したとき、ほかの人に担当を移したときに使う。担当の店は、アプリの設定で GM が選び直して保存する。
do $$
declare v_email text := '<メールアドレス>';
        v_user uuid; v_n integer;
begin
 select id into v_user from auth.users where lower(email) = lower(v_email);
 if v_user is null then raise exception 'このメールのアカウントがありません'; end if;
 update public.mr_members set enabled = false, updated_at = now(), updated_by = 'sql' where user_id = v_user;
 get diagnostics v_n = row_count;
 if v_n = 0 then raise exception 'この人は中間レビューの利用者にいません'; end if;
end $$;
-- 確認（読むだけ）
select m.role, m.name, m.emp_id, m.enabled from public.mr_members m order by m.role, m.name;
