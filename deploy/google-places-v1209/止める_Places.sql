-- v1209：Google（Places API）を今すぐ呼ばないようにする（会議のカードの「見る」・店を探す の両方）。何も消しません。
-- 再開するときは、下の「再開」の行を流す（はじめの上限に戻す）。
update public.gr_settings set places_day_max = 0, search_day_max = 0 where id = 1;
select places_day_max, search_day_max from public.gr_settings where id = 1;

-- 再開（はじめの上限）：
-- update public.gr_settings set places_day_max = 40, search_day_max = 40 where id = 1;
