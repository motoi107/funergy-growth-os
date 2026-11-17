-- v1186 で止めた GM・CEO・経理の PIN のログインを戻す（また PIN で入れる）。スイッチを外すだけ（表・関数・記録は残す・消さない）。
-- 戻したあとも、メールとパスワードのログインはそのまま使えます。経理のログインの試し（端末＋PIN）も v1185 までと同じに戻ります。
-- アプリの「PIN でログイン」は、次にログインの画面を開いたときから出ます（もう開いている画面は、閉じて開き直す）。
-- もう一度止めるときは 2_SQL.sql をもう一度流す。
do $$
begin
 if to_regclass('public.dl_flags') is null then
  raise exception 'STOP: v1186 の SQL（2_SQL.sql）がまだ入っていません。PIN は止まっていません。何も変えていません。';
 end if;
end $$;
insert into public.dl_flags (key, value, set_at, note) values ('top_pin_off', false, now(), 'PIN_を戻す.sql')
 on conflict (key) do update set value = false, set_at = now(), note = 'PIN_を戻す.sql';
select public.dl_log('pin_on', null, null, 'sql', 'ok', 'top_pin_off=false', null, null);
select public.dl_top_pin_off() as pin_off_now;
