-- v1176（Moto さん 11/15 12:22 HST：UI案84 の答え 5A「アラカルトは同じ会計のまだ成立していない機会に 1 つずつ」・6「11月から」）。
-- 仕様：docs/KPI_HOURS_UPSELL_V1176_JA.md。入れる順番：deploy/upsell-v1176/手順.md。
--
-- アップセル対象（モディファイヤーとアラカルト）を Toast の ID で選び、アップグレード率に入れるために、
-- hyper-worker v1176 が書く 2 つの欄と 1 つの表を足す。前提：v1171 の SQL（20261130090000_toast_upgrade_lines.sql）。
--
-- ・toast_upgrade_lines に mod_guid（モディファイヤーの Toast ID。無いときは 'n:' ＋名前）と check_key（会計の鍵）。
-- ・toast_upgrade_days に by_mod（その日に数えたモディファイヤーの ID ごとの名前・種類・数）と extra（丼でない品の行の数）。
--     by_mod が入っている日＝v1176 で取り込んだ日（アプリはこれでアラカルトの行があるかを見分ける）。
-- ・toast_upgrade_extra：丼のある店（Totoya）の、丼でない品 1 つ 1 行（取り消していないもの・ギフトカードと来店区分の品を除く）。
--     注文番号・会計の番号・時刻・ランチ／ディナー・品の ID と名前・数だけ。お客さんの名前・電話・カード・メールは入れない。
-- ・アプリは公開の鍵で読むだけ（v1171 の 2 つの表と同じ）。書くのはサーバーの鍵（hyper-worker）だけ。
-- ・前の行・toast_sales・日次実績は変えない。2 回流しても同じ。戻すとき：db/upsell-v1176-rollback.sql。

do $$
begin
  if to_regclass('public.toast_upgrade_lines') is null or to_regclass('public.toast_upgrade_days') is null then
    raise exception 'toast_upgrade_lines・toast_upgrade_days がありません（先に 20261130090000_toast_upgrade_lines.sql を流す）';
  end if;
end $$;

alter table public.toast_upgrade_lines add column if not exists mod_guid  text;
alter table public.toast_upgrade_lines add column if not exists check_key text;
alter table public.toast_upgrade_days  add column if not exists by_mod jsonb;
alter table public.toast_upgrade_days  add column if not exists extra  integer;

create table if not exists public.toast_upgrade_extra (
  restaurant_guid text not null,
  business_date   date not null,
  line_key        text not null,                        -- 品（selection）の guid（無いときは注文・会計・順番）
  order_guid      text,
  check_guid      text,
  check_key       text,                                 -- 会計の鍵（toast_upgrade_lines.check_key と同じ作り方）
  selection_guid  text,
  order_no        text,
  check_no        text,
  opened_at       timestamptz,
  meal            text check (meal in ('L', 'D')),
  takeout         boolean not null default false,       -- テイクアウトの注文
  item_guid       text not null,                        -- 品の Toast ID（アプリはこれでアラカルトを選ぶ）
  item_name       text,
  qty             numeric not null,
  synced_at       timestamptz not null default now(),
  primary key (restaurant_guid, business_date, line_key)
);
comment on table public.toast_upgrade_extra is 'v1176: 丼のある店の丼でない品 1 つ 1 行（アップセルのアラカルトを会計ごとに機会に当てるため。hyper-worker が書く・アプリは読むだけ）。お客さんの情報は入れない。';

alter table public.toast_upgrade_extra enable row level security;
drop policy if exists toast_upgrade_extra_read on public.toast_upgrade_extra;
create policy toast_upgrade_extra_read on public.toast_upgrade_extra for select to anon, authenticated using (true);
revoke all on public.toast_upgrade_extra from anon, authenticated;
grant select on public.toast_upgrade_extra to anon, authenticated;
grant select, insert, update, delete on public.toast_upgrade_extra to service_role;
