-- 止める（v1193・UI案95「画面の表示」）：設定の中身の off を true にする。全部の端末が、次に読み直したとき（ログイン・10 分ごと）から
-- 今までの決まり（1192 までと同じ見え方）に戻る。設定・記録は消さない。もう一度使うときは db/page-view-resume.sql。
-- 記録（pv_log）に「SQL で止めた」と 1 行残す。行がまだ無い（初めの値を保存する前）なら何もしない。
do $$
declare d jsonb; v integer; nd jsonb;
begin
  if to_regclass('public.pv_doc') is null then raise notice '表 pv_doc がありません（何も変えていません）'; return; end if;
  select doc, ver into d, v from public.pv_doc where id = 1 for update;
  if not found then raise notice '設定がまだありません（何も変えていません）'; return; end if;
  if d->>'off' = 'true' then raise notice 'もう止めています（ver %）', v; return; end if;
  nd := jsonb_set(d, '{off}', 'true'::jsonb, true);
  update public.pv_doc set doc = nd, ver = v + 1, updated_at = now(), by_emp = null, by_name = 'SQL', by_role = 'sql' where id = 1;
  insert into public.pv_log (ver, by_name, by_role, via, reason, summary, before, after)
    values (v + 1, 'SQL', 'sql', 'sql', 'SQL で止めた（db/page-view-stop.sql）', '["止めた（今までの決まりに戻す）"]'::jsonb, d, nd);
  raise notice '止めました（ver %）', v + 1;
end $$;
