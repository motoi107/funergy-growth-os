-- 店のタブレットの列を外す（v1197・UI案96 の 6B）：関数 secure-state を v1197 より前（v1195 の 1 ファイルなど）に戻す「前に」流す。
-- 前の版の関数は、設定の中身に tab の列があると形が合わないとみなし、全員を今までの決まりで出す（画面の表示が効かなくなる）ため。
-- 中身の cols.tab だけを外す（ほかの列・人の例外・指定スタッフ限定・off は変えない）。記録（pv_log）に「SQL で外した」と 1 行残す。
-- 行がまだ無い・tab の列が無いときは何もしない。2 回流しても同じ。店のタブレットは、次に読み直したとき（ログイン・10 分ごと）から今の 4 画面に戻る。
do $$
declare d jsonb; v integer; nd jsonb;
begin
  if to_regclass('public.pv_doc') is null then raise notice '表 pv_doc がありません（何も変えていません）'; return; end if;
  select doc, ver into d, v from public.pv_doc where id = 1 for update;
  if not found then raise notice '設定がまだありません（何も変えていません）'; return; end if;
  if not (coalesce(d->'cols', '{}'::jsonb) ? 'tab') then raise notice '店のタブレットの列はありません（ver %・何も変えていません）', v; return; end if;
  nd := d #- '{cols,tab}';
  update public.pv_doc set doc = nd, ver = v + 1, updated_at = now(), by_emp = null, by_name = 'SQL', by_role = 'sql' where id = 1;
  insert into public.pv_log (ver, by_name, by_role, via, reason, summary, before, after)
    values (v + 1, 'SQL', 'sql', 'sql', 'SQL で店のタブレットの列を外した（db/page-view-tab-drop.sql）', '["店のタブレットの列を外した（関数を前の版に戻すため）"]'::jsonb, d, nd);
  raise notice '外しました（ver %）', v + 1;
end $$;
