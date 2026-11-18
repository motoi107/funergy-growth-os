-- もう一度使う（v1193・UI案95「画面の表示」）：db/page-view-stop.sql で止めた設定の off を false に戻す。中身はそのまま。記録に 1 行残す。
do $$
declare d jsonb; v integer; nd jsonb;
begin
  if to_regclass('public.pv_doc') is null then raise notice '表 pv_doc がありません（何も変えていません）'; return; end if;
  select doc, ver into d, v from public.pv_doc where id = 1 for update;
  if not found then raise notice '設定がまだありません（何も変えていません）'; return; end if;
  if coalesce(d->>'off', 'false') <> 'true' then raise notice '止めていません（ver %）', v; return; end if;
  nd := jsonb_set(d, '{off}', 'false'::jsonb, true);
  update public.pv_doc set doc = nd, ver = v + 1, updated_at = now(), by_emp = null, by_name = 'SQL', by_role = 'sql' where id = 1;
  insert into public.pv_log (ver, by_name, by_role, via, reason, summary, before, after)
    values (v + 1, 'SQL', 'sql', 'sql', 'SQL でもう一度使う（db/page-view-resume.sql）', '["もう一度使う"]'::jsonb, d, nd);
  raise notice 'もう一度使います（ver %）', v + 1;
end $$;
