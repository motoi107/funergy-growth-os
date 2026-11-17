-- v1185 メールとパスワードのログイン（GM・CEO・経理）を止める。
-- 関数 dl_email_login・dl_email_notice・dl_email_stage を外す（表 dl_email_devices と記録 dl_events は残す・消さない）。
-- 止めたあと、名前を選んでメールとパスワードを入れると「このログインは、まだサーバーで使えるようになっていません。「PIN でログイン」をお使いください。」と出る
-- （画面の「PIN でログイン」で今までどおり入れる）。もう入っている人は、アプリを閉じるかログアウトするまでそのまま（ログインの印は最長 12 時間）。
-- また始めるときは 2_SQL.sql をもう一度流す。
begin;
drop function if exists public.dl_email_login(jsonb);
drop function if exists public.dl_email_notice(text, text, text, text);
drop function if exists public.dl_email_stage();
commit;
select to_regprocedure('public.dl_email_login(jsonb)') is null as stopped,
  (select count(*) from public.dl_email_devices) as devices_kept;
