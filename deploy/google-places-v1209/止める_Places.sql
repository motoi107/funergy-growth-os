-- v1209：Google（Places API）を今すぐ呼ばないようにする（ダッシュボード・会議のカード・KPI設定の「見る」・店を探す・確かめる の全部）。何も消しません。
-- 1 日の天井を 0 にするので、1 店 1 日の上限（places_store_day_max）や確かめた店の数によらず止まります。
-- 再開するときは、下の「再開」の行を流す（はじめの上限に戻す）。
update public.gr_settings set places_day_max = 0, search_day_max = 0 where id = 1;
select places_day_max, search_day_max from public.gr_settings where id = 1;

-- 再開（はじめの上限）：
-- update public.gr_settings set places_day_max = 40, search_day_max = 40 where id = 1;
