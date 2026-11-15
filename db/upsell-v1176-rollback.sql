-- v1176 の戻し：アラカルトの品の表と、明細・印に足した欄を外す（v1171 の行・印・toast_sales は残る）。
-- 先に hyper-worker を v1171 の 1 ファイルに戻してから流す（v1176 の hyper-worker は欄が無いと v1171 の形で書くので、順番が逆でも壊れない）。
drop table if exists public.toast_upgrade_extra;
alter table if exists public.toast_upgrade_lines drop column if exists mod_guid;
alter table if exists public.toast_upgrade_lines drop column if exists check_key;
alter table if exists public.toast_upgrade_days  drop column if exists by_mod;
alter table if exists public.toast_upgrade_days  drop column if exists extra;
select 'rolled back' as result;
