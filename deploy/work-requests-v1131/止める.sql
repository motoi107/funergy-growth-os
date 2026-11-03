-- v1131 ワークセンターの申請を止める（アプリは前の画面に戻る・申請の記録は残る・2 回流しても同じ）。
-- 非常のときだけ：前の画面は、ここで決めた承認・支払を知らない（手順.md の「困ったとき」）。
-- 共通データの印 wr_live も止める（端末はログイン・同期のたびに読む）。
update public.wr_settings set live = false, rev = rev + 1, updated_at = now() where id = 1 and live;
insert into public.app_state(key, value, updated_at)
 select 'wr_live', jsonb_build_object('live', false, 'at', s.updated_at), now() from public.wr_settings s where s.id = 1
 on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
 where public.app_state.value is distinct from excluded.value;
select live, rev, updated_at from public.wr_settings;
