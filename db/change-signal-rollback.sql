-- 戻す（v1151・「変わった」の合図と変更の記録）。見張り（トリガー）と関数を外し、Realtime から合図の表を外す。保存そのものは今までどおり。
-- 合図の表（sync_signal）と変更の記録（change_log）は残す（記録を消さない。サーバーの鍵でしか読めない）。消すときは最後の 2 行の -- を外す。
-- 2 回流しても同じ。アプリ v1151 は合図が来なくても今までどおり（10 分ごとの同期）動く。
do $$
declare t text;
begin
  foreach t in array array['app_state', 'app_settings', 'stores', 'employees', 'ingredients', 'recipes', 'vendors', 'categories'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists fp_sig_ins on public.%I', t);
    execute format('drop trigger if exists fp_sig_upd on public.%I', t);
    execute format('drop trigger if exists fp_sig_del on public.%I', t);
  end loop;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signal') then
    execute 'alter publication supabase_realtime drop table public.sync_signal';
  end if;
end $$;
drop function if exists public.fp_sig_kv();
drop function if exists public.fp_sig_rows();
drop function if exists public.fp_note(text, text, boolean, text, jsonb, jsonb, text);
drop function if exists public.fp_parts(jsonb, jsonb);
drop function if exists public.fp_sec_cat(text);
drop function if exists public.fp_via(jsonb);
drop function if exists public.fp_actor();
-- drop table if exists public.change_log;
-- drop table if exists public.sync_signal;
