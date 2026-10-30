-- v1121 の見張りを外す（データは変えない）。外すと、v1120 以前のアプリが送る古い写しで削除・無効・区分が戻ることがある。
drop trigger if exists vendors_keep_state on public.vendors;
drop function if exists public.vendors_keep_state();
