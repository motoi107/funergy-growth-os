-- 中間レビュー：取り消し（中間レビューの表と関数だけを消します。ほかの表・データには触れません）
-- ふだんは消さずに、アプリの設定で「非公開確認」を OFF にすれば、だれも使えなくなります。
-- 本番（live）のレビューが 1 件でもあるときは止まります（デモだけなら消せます）。
do $$ begin
 if exists(select 1 from public.mr_reviews where env = 'live') then
  raise exception '本番（live）のレビューがあるので止めました。消す前に Moto さんに確認してください。';
 end if;
end $$;
drop function if exists public.mr_demo_reset(jsonb), public.mr_stores_save(jsonb), public.mr_members_list(jsonb), public.mr_settings_save(jsonb),
 public.mr_list(jsonb), public.mr_whoami(jsonb), public.mr_summary(public.mr_reviews), public.mr_arr(jsonb), public.mr_event(uuid,text,text,text,jsonb),
 public.mr_sees(text,uuid,text,uuid), public.mr_auth(uuid,text[],boolean), public.mr_setting(text);
drop table if exists public.mr_events, public.mr_replies, public.mr_submissions, public.mr_reviews, public.mr_stores, public.mr_members, public.mr_settings;
