-- 読むだけ（v1151・「変わった」の合図と変更の記録）。20261118090000_change_signal.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も変えません。STOP が 1 つでもあれば入れずに、表をそのまま Claude に貼ってください（名前・中身は出ません）。
with
t(n, what, value, ok) as (
  select 1, 'app_state・app_settings がある',
         (case when to_regclass('public.app_state') is not null then 'app_state ' else '' end) || (case when to_regclass('public.app_settings') is not null then 'app_settings' else '' end),
         case when to_regclass('public.app_state') is not null and to_regclass('public.app_settings') is not null then 'OK' else 'STOP' end
  union all
  select 2, 'v1139 の SQL（ss_secret_key）が入っている', case when to_regprocedure('public.ss_secret_key(text)') is not null then 'ある' else 'ない' end,
         case when to_regprocedure('public.ss_secret_key(text)') is not null then 'OK' else 'STOP' end
  union all
  select 3, 'app_state・app_settings の key・value の列',
         (select string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type, ' ' order by c.table_name, c.column_name) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name in ('app_state', 'app_settings') and c.column_name in ('key', 'value')),
         case when (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('app_state', 'app_settings') and c.column_name in ('key', 'value')) = 4 then 'OK' else 'STOP' end
  union all
  select 4, 'マスターの表と主キー（無い表は見張らない）',
         (select string_agg(v.t || (case when to_regclass('public.' || v.t) is null then '（なし）'
                                        when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v.t and c.column_name = v.pk) then '.' || v.pk
                                        else '（' || v.pk || ' の列なし）' end), ' ' order by v.t)
            from (values ('stores', 'id'), ('employees', 'id'), ('ingredients', 'code'), ('recipes', 'id'), ('vendors', 'id'), ('categories', 'code')) v(t, pk)),
         case when exists (select 1 from (values ('stores', 'id'), ('employees', 'id'), ('ingredients', 'code'), ('recipes', 'id'), ('vendors', 'id'), ('categories', 'code')) v(t, pk)
                            where to_regclass('public.' || v.t) is not null
                              and not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v.t and c.column_name = v.pk)) then 'STOP' else 'OK' end
  union all
  select 5, 'Realtime（supabase_realtime）', case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'ある' else 'ない' end,
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'OK' else 'info（合図は 60 秒ごとに読む。動きは同じ）' end
  union all
  select 6, 'すでに入っている（sync_signal・change_log）',
         (case when to_regclass('public.sync_signal') is not null then 'sync_signal ' else '' end) || (case when to_regclass('public.change_log') is not null then 'change_log' else '' end),
         case when to_regclass('public.sync_signal') is null and to_regclass('public.change_log') is null then 'OK（まだ）' else 'info（2 回流しても同じ）' end
  union all
  select 7, '同じ名前の表・関数がほかに無い（fp_*）',
         coalesce((select string_agg(p.proname, ' ' order by p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                    where s.nspname = 'public' and p.proname in ('fp_actor', 'fp_via', 'fp_sec_cat', 'fp_parts', 'fp_note', 'fp_sig_kv', 'fp_sig_rows')), 'なし'),
         case when to_regclass('public.change_log') is null
                   and exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('fp_actor', 'fp_via', 'fp_sec_cat', 'fp_parts', 'fp_note', 'fp_sig_kv', 'fp_sig_rows'))
              then 'STOP（ほかの関数と名前がぶつかる）' else 'OK' end
  union all
  select 8, '見張りの数（app_state・app_settings・マスター。名前は出さない）',
         (select string_agg(x.t || ':' || x.c, ' ' order by x.t) from (
            select c.relname t, count(*) c from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
             where s.nspname = 'public' and not g.tgisinternal and c.relname in ('app_state', 'app_settings', 'stores', 'employees', 'ingredients', 'recipes', 'vendors', 'categories')
             group by c.relname) x),
         'info'
  union all
  select 9, '公開の鍵（anon）の時間の上限', coalesce((select array_to_string(r.rolconfig, ' ') from pg_roles r where r.rolname = 'anon'), '（設定なし）'), 'info（見張りはふだんの保存で数ミリ秒）'
  union all
  select 11, '行の一覧（app_state_index・v1098）', case when to_regprocedure('public.app_state_index(text[])') is not null then 'ある' else 'ない' end,
         case when to_regprocedure('public.app_state_index(text[])') is not null then 'OK' else 'info（無いと、機密の区分・まとめての合図のたびに app_state を全部読む。deploy/perf-v1098 で入れられる）' end
  union all
  select 10, 'app_state の行の数・いちばん大きい値（KB）',
         (select count(*)::text || ' 行・' || coalesce(round(max(pg_column_size(value)) / 1024.0)::text, '0') || ' KB' from public.app_state),
         'info'
)
select n, what, value, ok from t order by n;
