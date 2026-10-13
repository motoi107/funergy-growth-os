-- 中間レビュー：止める（だれも開けなくなります。記録・設定・利用者は消しません。何度流しても同じ）
-- 画面から止められないとき（画面が開かない・メールの GM・CEO がいないとき）だけ使います。
-- ふだんは GM・CEO がメールでログインして、中間レビューの設定で「非公開確認」を OFF にしてください。
-- もう一度使うときは、GM・CEO がメールでログインして画面で ON にします（この SQL では ON にしません）。
update public.mr_settings
   set value = value || jsonb_build_object('private', false, 'store_publish', false, 'notify', false),
       updated_at = now(), updated_by = 'sql:mid-review-stop'
 where key = 'flags';
select key, value->>'private' as private, value->>'store_publish' as store_publish, value->>'notify' as notify, value->>'live_input' as live_input
  from public.mr_settings where key = 'flags';
