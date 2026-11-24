-- 2b：事務Crew のメールのアカウントを止める（退職・事務Crew でなくなった・メールを変えるとき。1 人ずつ）。
-- 下のメールを書き換えて Run。消すのは manager_auth のそのメールの事務Crew（office_crew）の行だけ。CEO・GM・経理の行・社員の表・申請・記録は変えない。
-- このファイルはひな形です。書き換えたものを GitHub・共有の場所に置かないでください。
-- 止めたあと：Invoice取込・照合・QuickBooks の状態は次の操作から開けない（端末が覚えたログインでも）。メールのログイン自体も止めるなら
--   Authentication → Users でその人を Ban（または Delete）。PIN の申請・セキュアな記録は、従業員マスターの退職か、GM・CEO の「確かめを外す」で止まる。
-- もう一度使うときは 2_事務Crewのアカウントを足す_ひな形.sql。
do $$
declare v_email text := 'name@example.com'; v_user uuid; n int;
begin
 if btrim(v_email) = 'name@example.com' then raise exception 'STOP: メールを書き換えてから Run してください（何も変えていません）'; end if;
 select count(*) into n from auth.users u where lower(u.email) = lower(btrim(v_email));
 if n <> 1 then raise exception 'STOP: メール % のアカウントが % 件です（何も変えていません）', v_email, n; end if;
 select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(v_email));
 delete from public.manager_auth a where a.user_id = v_user and a.role = 'office_crew';
 get diagnostics n = row_count;
 if n = 0 then raise exception 'STOP: このメールは事務Crew のアカウントではありません（CEO・GM・経理の行は止めません。何も変えていません）'; end if;
 raise notice '事務Crew のアカウントを止めました（%）', n;
end $$;
