-- 事前の確認（読むだけ。何も書き換えません）
-- Supabase の SQL Editor に貼って Run。出てきた行の result がすべて OK で始まっていれば migration（db/invoice-intake.sql）に進んでください。
-- NG・STOP が 1 つでもあれば、migration は流さずに結果の画面を Claude に見せてください。
select '1. GM/CEO などの登録表（manager_auth）がある' as check_item,
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'manager_auth'
                    and ((column_name = 'user_id' and data_type = 'uuid') or (column_name = 'role'))) = 2
            then 'OK' else 'NG：manager_auth の形が想定と違う' end as result
union all
select '2. GM か CEO が 1 人以上登録されている',
       case when to_regclass('public.manager_auth') is null then 'NG：manager_auth が無い'
            when (select count(*) from public.manager_auth where role in ('gm', 'ceo')) > 0 then 'OK'
            else 'NG：GM・CEO の登録が無い（設定の画面を開ける人がいない）' end
union all
select '3. 取込の表・関数はまだ入っていない',
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relname like 'invoice\_%')
              or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname like 'invoice\_%')
            then 'STOP：invoice_ で始まる表か関数が既にある（1 は流さない）' else 'OK' end
union all
select '4. アプリのデータの表（app_state）がある',
       case when to_regclass('public.app_state') is not null then 'OK' else 'NG：app_state が無い' end
union all
select '5. gen_random_uuid が使える',
       case when exists (select 1 from pg_proc where proname = 'gen_random_uuid') then 'OK' else 'NG' end
union all
select '6.（参考）drive-sync の Drive 連携（drive_oauth）',
       case when to_regclass('public.drive_oauth') is not null then 'OK（フォルダを確かめるときに使います）'
            else 'OK（ただし Drive の連携がまだ無い：配備はできる。フォルダを確かめる前に連携が要る）' end;
