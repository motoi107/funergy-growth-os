-- v1171（Moto さん 11/14 20:14 HST：アップグレード率「SQL ください・hyper-worker のソースを添付・UI案81 はい・昨日まで」）。
-- 仕様：docs/UPGRADE_RATE_DRILL_JA.md。入れる順番：deploy/upgrade-drill-v1171/手順.md。
--
-- Totoya のアップグレード率（Crab・Today's・Udon・CHAZUKE ÷ Aosa＋それら）の内訳を、注文ごとに見られるようにする。
-- 今まで hyper-worker は 1 日の合計（toast_sales の miso_total_count・miso_upgrade_count）だけを保存していた。
--
-- ・toast_upgrade_lines：丼に付いた味噌汁・茶漬けのモディファイヤー 1 つにつき 1 行（hyper-worker v1171 が書く）。
--     数えた行（counted＝true）の qty の合計が、その日の toast_sales の miso_total_count（分母）、
--     そのうち kind が aosa 以外の合計が miso_upgrade_count（分子）と同じになる（hyper-worker が同じ数え方で同時に作る）。
--     取消の注文・会計・品の行も「対象外」として残す（counted＝false・reason）。数には入らない。
--     お客さんの名前・電話・カード・メールなどは入れない（注文番号・時刻・丼・モディファイヤー・数だけ）。
-- ・toast_upgrade_days：その日の行を書いた印（種類ごとの数・合計・hyper-worker の版）。
--     印が無い日＝v1171 より前に取り込んだ日（明細は無い・取り込み直すと入る）。
-- ・アプリは公開の鍵で読むだけ（toast_sales・toast_item_sales と同じ）。書くのはサーバーの鍵（hyper-worker）だけ。
-- ・toast_sales・日次実績・ほかの表は変えない。2 回流しても同じ。戻すとき：db/toast-upgrade-lines-rollback.sql。

do $$
begin
  if to_regclass('public.toast_sales') is null then
    raise exception 'toast_sales がありません（このデータベースではありません）';
  end if;
end $$;

create table if not exists public.toast_upgrade_lines (
  restaurant_guid text not null,
  business_date   date not null,
  line_key        text not null,                        -- 品（selection）の guid ＋ ':' ＋ モディファイヤーの順番
  order_guid      text,
  check_guid      text,
  selection_guid  text,
  order_no        text,                                 -- Toast の注文番号（displayNumber）
  check_no        text,                                 -- 会計の番号（displayNumber）
  opened_at       timestamptz,                          -- 注文を開いた時刻
  meal            text check (meal in ('L', 'D')),       -- ランチ・ディナー（hyper-worker の切り替えの時刻と同じ）
  takeout         boolean not null default false,       -- テイクアウトの丼
  bowl_guid       text,
  bowl_name       text,
  mod_name        text,
  kind            text not null check (kind in ('aosa', 'crab', 'today', 'udon', 'chazuke')),
  qty             numeric not null,
  counted         boolean not null default true,        -- 数に入れた
  reason          text check (reason is null or reason in ('void_order', 'void_check', 'void_selection')),
  synced_at       timestamptz not null default now(),
  primary key (restaurant_guid, business_date, line_key)
);
comment on table public.toast_upgrade_lines is 'v1171: Totoya の味噌汁・茶漬けのモディファイヤー 1 つ 1 行（hyper-worker が書く・アプリは読むだけ）。お客さんの情報は入れない。';

create table if not exists public.toast_upgrade_days (
  restaurant_guid text not null,
  business_date   date not null,
  lines           integer not null default 0,           -- 行の数（対象外も）
  aosa            numeric not null default 0,
  crab            numeric not null default 0,
  today           numeric not null default 0,
  udon            numeric not null default 0,
  chazuke         numeric not null default 0,
  total           integer not null default 0,           -- 分母（toast_sales.miso_total_count と同じ数）
  upgrade         integer not null default 0,           -- 分子（toast_sales.miso_upgrade_count と同じ数）
  voided          integer not null default 0,           -- 対象外の行の数
  hw_version      text,
  synced_at       timestamptz not null default now(),
  primary key (restaurant_guid, business_date)
);
comment on table public.toast_upgrade_days is 'v1171: その日のアップグレードの行を書いた印と種類ごとの数（hyper-worker が書く）。';

alter table public.toast_upgrade_lines enable row level security;
alter table public.toast_upgrade_days  enable row level security;
drop policy if exists toast_upgrade_lines_read on public.toast_upgrade_lines;
create policy toast_upgrade_lines_read on public.toast_upgrade_lines for select to anon, authenticated using (true);
drop policy if exists toast_upgrade_days_read on public.toast_upgrade_days;
create policy toast_upgrade_days_read on public.toast_upgrade_days for select to anon, authenticated using (true);
revoke all on public.toast_upgrade_lines from anon, authenticated;
revoke all on public.toast_upgrade_days  from anon, authenticated;
grant select on public.toast_upgrade_lines to anon, authenticated;
grant select on public.toast_upgrade_days  to anon, authenticated;
grant select, insert, update, delete on public.toast_upgrade_lines to service_role;
grant select, insert, update, delete on public.toast_upgrade_days  to service_role;
