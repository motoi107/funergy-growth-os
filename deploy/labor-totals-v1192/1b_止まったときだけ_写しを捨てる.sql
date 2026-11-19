-- v1192（Codex 6989812896 の P2-1）：20261210090000_md_all_viewers_gm.sql が「写し md_all_viewers_gm がもうありますが、この SQL で守られていません」で
-- 止まったときだけ流す（deploy/labor-totals-v1192/ の 1b）。守られていない写し（公開の鍵で作られた・書かれたかもしれない）を捨てる。
-- ・写しがこの SQL で守られているとき（md_all_viewers_gm_trusted() が true）は、GM・CEO が決めた写しなので捨てずに STOP（何も変えない）。
-- ・捨てるのは app_state の md_all_viewers_gm の 1 行だけ。app_settings の md_all_viewers・ほかの行は変えない。2 回流しても同じ。
-- ・続けて 2_SQL_全店を見る人を守る.sql をもう一度流す（空の写しを作って守る）。関数と 1192 のあと、GM・CEO が全店を見る AM を付け直す。
-- ・前に写しを受け取った GM・CEO の端末には、前の中身が残っていることがある。付け直したあと「管轄の割り当て」で、ON の人が
--   本当に全店を見る AM だけか確かめる（違う人は OFF）。
do $$
declare t boolean := false;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  if to_regprocedure('public.md_all_viewers_gm_trusted()') is not null then
    execute 'select public.md_all_viewers_gm_trusted()' into t;
  end if;
  if coalesce(t, false) then
    raise exception 'STOP: 写し md_all_viewers_gm はこの SQL で守られています（GM・CEO が決めたもの）。捨てません（何も変えていません）';
  end if;
  delete from public.app_state where key = 'md_all_viewers_gm';
end $$;
