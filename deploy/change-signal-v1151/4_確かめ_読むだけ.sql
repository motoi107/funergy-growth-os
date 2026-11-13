-- 読むだけ（v1151・「変わった」の合図と変更の記録）。20261118090000_change_signal.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 試しに 1 つ書いて見張りが動くかを見るが、最後に rollback するので何も残りません（合図も届きません）。
-- 全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（名前・中身は出ません）。
begin;
create temp table cs_chk(n int, what text, value text, ok text) on commit drop;
grant insert on cs_chk to anon, authenticated;   -- 下で anon として結果を書くため（この一時表だけ。rollback で消える）
insert into cs_chk
select 1, '表 sync_signal・change_log（RLS）',
       coalesce((select string_agg(c.relname || ':' || case when c.relrowsecurity then 'ON' else 'OFF' end, ' ' order by c.relname) from pg_class c join pg_namespace s on s.oid = c.relnamespace
                  where s.nspname = 'public' and c.relname in ('sync_signal', 'change_log')), 'なし'),
       case when (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname in ('sync_signal', 'change_log') and c.relrowsecurity) = 2 then 'OK' else 'NG' end;
insert into cs_chk
select 2, '合図（sync_signal）：anon・authenticated は読めるだけ',
       (case when has_table_privilege('anon', 'public.sync_signal', 'select') then '読める' else '読めない' end) || '・'
       || (case when has_table_privilege('anon', 'public.sync_signal', 'insert') or has_table_privilege('anon', 'public.sync_signal', 'update') or has_table_privilege('anon', 'public.sync_signal', 'delete')
                  or has_table_privilege('authenticated', 'public.sync_signal', 'insert') or has_table_privilege('authenticated', 'public.sync_signal', 'update') or has_table_privilege('authenticated', 'public.sync_signal', 'delete') then '書ける' else '書けない' end),
       case when has_table_privilege('anon', 'public.sync_signal', 'select') and has_table_privilege('authenticated', 'public.sync_signal', 'select')
                 and not (has_table_privilege('anon', 'public.sync_signal', 'insert') or has_table_privilege('anon', 'public.sync_signal', 'update') or has_table_privilege('anon', 'public.sync_signal', 'delete')
                          or has_table_privilege('authenticated', 'public.sync_signal', 'insert') or has_table_privilege('authenticated', 'public.sync_signal', 'update') or has_table_privilege('authenticated', 'public.sync_signal', 'delete'))
            then 'OK' else 'NG' end;
insert into cs_chk
select 3, '変更の記録（change_log）：anon・authenticated は読めない・書けない／サーバーの鍵は読める',
       (case when has_table_privilege('anon', 'public.change_log', 'select') or has_table_privilege('authenticated', 'public.change_log', 'select') then '公開の鍵で読める' else '公開の鍵で読めない' end) || '・'
       || (case when has_table_privilege('service_role', 'public.change_log', 'select') then 'サーバーの鍵で読める' else 'サーバーの鍵で読めない' end),
       case when not (has_table_privilege('anon', 'public.change_log', 'select') or has_table_privilege('authenticated', 'public.change_log', 'select')
                      or has_table_privilege('anon', 'public.change_log', 'insert') or has_table_privilege('authenticated', 'public.change_log', 'insert')
                      or has_table_privilege('anon', 'public.change_log', 'update') or has_table_privilege('anon', 'public.change_log', 'delete'))
                 and has_table_privilege('service_role', 'public.change_log', 'select') then 'OK' else 'NG' end;
insert into cs_chk
select 4, '見張り（fp_sig_ins・upd・del）の数',
       coalesce((select string_agg(x.t || ':' || x.c, ' ' order by x.t) from (
         select c.relname t, count(*) c from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'public' and g.tgname in ('fp_sig_ins', 'fp_sig_upd', 'fp_sig_del') group by c.relname) x), 'なし'),
       case when (select count(*) from pg_trigger g where g.tgrelid = 'public.app_state'::regclass and g.tgname in ('fp_sig_ins', 'fp_sig_upd', 'fp_sig_del')) = 3
             and (select count(*) from pg_trigger g where g.tgrelid = 'public.app_settings'::regclass and g.tgname in ('fp_sig_ins', 'fp_sig_upd', 'fp_sig_del')) = 3
             and not exists (select 1 from (values ('stores'), ('employees'), ('ingredients'), ('recipes'), ('vendors'), ('categories')) v(t)
                              where to_regclass('public.' || v.t) is not null
                                and (select count(*) from pg_trigger g where g.tgrelid = to_regclass('public.' || v.t) and g.tgname in ('fp_sig_ins', 'fp_sig_upd', 'fp_sig_del')) <> 3)
            then 'OK' else 'NG' end;
insert into cs_chk
select 5, '関数 fp_*：公開の鍵で呼べない',
       (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'fp\_%'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) || ' 個が呼べる',
       case when exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'fp\_%'
                          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then 'NG'
            when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('fp_actor', 'fp_via', 'fp_sec_cat', 'fp_parts', 'fp_note', 'fp_sig_kv', 'fp_sig_rows')) = 7 then 'OK' else 'NG' end;
insert into cs_chk
select 6, 'Realtime に合図の表',
       case when not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'Realtime なし'
            when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signal') then '入っている' else '入っていない' end,
       case when not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'info'
            when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signal') then 'OK' else 'NG' end;
insert into cs_chk
select 7, '機密のキーの区分（成長カルテ・賞与・Career Score など）',
       (select string_agg(public.fp_sec_cat(k), ' ' order by k) from unnest(array['growth_karte', 'spl_bonus_q_2026-Q3', 'lss_emp_A', 'applicants', 'emp_pii', 'tip_cf_S1_2026', 'warnings_S1', 'grade_hist']) k),
       case when (select string_agg(public.fp_sec_cat(k), ' ' order by k) from unnest(array['growth_karte', 'spl_bonus_q_2026-Q3', 'lss_emp_A', 'applicants', 'emp_pii', 'tip_cf_S1_2026', 'warnings_S1', 'grade_hist']) k)
                 = 'hiring pii grade_hist karte career_score bonus tip_confirm warnings' then 'OK' else 'NG' end;
-- ここから公開の鍵（anon）として、ためしの 1 行を書く（最後の rollback で消える）
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.headers', json_build_object('x-fp-actor', encode(convert_to('{"e":"CHECK","n":"確かめ","r":"gm","d":"check-device","k":"pc"}', 'UTF8'), 'base64'))::text, true);
insert into public.app_state(key, value) values ('_fp_postcheck', '{"a":1}'::jsonb) on conflict (key) do update set value = excluded.value;
insert into cs_chk
select 8, 'ためしに書くと合図が進む（anon で読める・社員 ID と端末の印）', coalesce((select 'n=' || s.n || '・' || coalesce(s.by_emp, '—') || '・' || coalesce(s.by_dev, '—') from public.sync_signal s where s.key = '_fp_postcheck'), 'なし'),
       case when exists (select 1 from public.sync_signal s where s.key = '_fp_postcheck' and s.by_emp = 'CHECK' and s.by_dev = 'check-device') then 'OK' else 'NG' end;
reset role;
insert into cs_chk
select 9, 'ためしの書き込みが記録に残る（だれ・どの道・どの項目）',
       coalesce((select c.by_name || '・' || c.via || '・' || c.parts::text from public.change_log c where c.key = '_fp_postcheck' order by c.id desc limit 1), 'なし'),
       case when exists (select 1 from public.change_log c where c.key = '_fp_postcheck' and c.by_name = '確かめ' and c.via = 'app' and c.parts = '["a"]'::jsonb) then 'OK' else 'NG' end;
select * from cs_chk order by n;
rollback;
