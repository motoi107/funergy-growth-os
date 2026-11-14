-- toast_sales に、ランチ・ディナー別の来店区分（初回・リピート・常連）の列を足す（任意・2 回流しても同じ）。
-- 期間一括取り込みの「L/D列が未作成のため、売上のみ保存しました」の注意が消え、L/D 別のリピート率が使えるようになる。
-- 列を足すだけ。今ある行・売上・アップセルの数は変えない。足したあと、使いたい期間を取り込み直すと数が入る。
alter table public.toast_sales
  add column if not exists lunch_first_time_count      integer default 0,
  add column if not exists dinner_first_time_count     integer default 0,
  add column if not exists lunch_repeat_count          integer default 0,
  add column if not exists dinner_repeat_count         integer default 0,
  add column if not exists lunch_super_regular_count   integer default 0,
  add column if not exists dinner_super_regular_count  integer default 0;
-- 確かめ（6 と出れば OK）
select count(*) as ld_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'toast_sales'
   and column_name in ('lunch_first_time_count','dinner_first_time_count','lunch_repeat_count','dinner_repeat_count','lunch_super_regular_count','dinner_super_regular_count');
