-- 読むだけ（v1192・Codex 6986713362 の P2-1・6989812896 の P2-1）。20261210090000_md_all_viewers_gm.sql を流す「前」に、Supabase の SQL Editor で流す。何も変えません。
-- STOP が無ければ流してよい。2 行目が STOP なら、deploy の 1b（db/md-all-viewers-gm-discard.sql）で写しを捨ててから、もう一度この確かめを流す。
-- 8 行目以降は、今 app_settings の md_all_viewers で「ダッシュボードで全店を見る」が ON の人です。md_all_viewers は公開の鍵で書けるので、2 の SQL は
-- これを写しません（写しは空で作る）。関数と 1192 のあと、この表を見て、本当に全店を見る AM だけを GM・CEO が 1192 の端末で ON にしてください。
-- 表には名前が出ます。Claude との会話にだけ貼ってください（公開の PR・Issue には貼らない）。
-- 1 行目：関数 ss_guard_key が v1146 の形（prep_certs を含む）か。v1141〜v1145 の形だけなら SQL は止まる（呼ばずに中身の文字で見る＝無くても止まらない）
-- 2 行目：写し md_all_viewers_gm。無い＝OK（空で作る）・この SQL で守られている＝OK（そのまま）・守られていない＝STOP（SQL も止まる）
with g as (select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                           where ns.nspname = 'public' and p.proname = 'ss_guard_key' and p.prosrc like '%''prep_certs''%') as has_fn),
     t as (select case when to_regprocedure('public.md_all_viewers_gm_trusted()') is not null
                       then coalesce((xpath('/row/t/text()', query_to_xml('select public.md_all_viewers_gm_trusted() as t', false, true, '')))[1]::text = 'true', false)
                       else false end as ok),
     cp as (select case when jsonb_typeof(a.value::text::jsonb) = 'object' then a.value::text::jsonb else '{}'::jsonb end as j
              from public.app_state a where a.key = 'md_all_viewers_gm'),
     s as (select (select value::text from public.app_settings where key = 'md_all_viewers') as v),
     m as (select case when s.v is not null and jsonb_typeof(s.v::jsonb) = 'object' then s.v::jsonb else '{}'::jsonb end as j from s),
     on_rows as (select e.key as emp_id, e.value as rec from m, jsonb_each(m.j) e
                 where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true')
select 1 as n, 'v1146 の SQL（ss_guard_key）' as what,
       case when (select has_fn from g) then '入っている' else '無い' end as value,
       case when (select has_fn from g) then 'OK' else 'STOP（先に 20261115090000）' end as ok
union all
select 2, 'app_state の写し md_all_viewers_gm',
       case when not exists (select 1 from cp) then 'まだ無い（2 の SQL が空の写しを作る）'
            when (select ok from t) then 'もうある・この SQL で守られている（ON ' || (select count(*) from cp, jsonb_each(cp.j) e
                 where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true') || ' 人・そのまま）'
            else 'もうあるが、守られていない（公開の鍵で作られた・書かれたかもしれない）' end,
       case when not exists (select 1 from cp) or (select ok from t) then 'OK' else 'STOP（1b で写しを捨ててから）' end
union all
select 3, 'app_settings の md_all_viewers の形',
       case when (select v from s) is null then '無い（空の地図を作る）' when jsonb_typeof((select v from s)::jsonb) = 'object' then 'オブジェクト' else 'オブジェクトでない（空の地図を作る）' end,
       'info'
union all
select 4, 'md_all_viewers で ON の人の数（2 の SQL は写さない。関数と 1192 のあと GM・CEO が付け直す人の目安）', (select count(*) from on_rows)::text, 'info'
union all
select 5, 'ON の人のうち、社員の表に無い・退職・AM でない人', (select count(*) from on_rows o
         where not exists (select 1 from public.employees e where e.id::text = o.emp_id and coalesce(e.data->>'status', e.status, '') not in ('退職', 'resigned')
                           and coalesce(e.data->>'role', e.role, '') = 'am'))::text,
       case when (select count(*) from on_rows o
         where not exists (select 1 from public.employees e where e.id::text = o.emp_id and coalesce(e.data->>'status', e.status, '') not in ('退職', 'resigned')
                           and coalesce(e.data->>'role', e.role, '') = 'am')) = 0 then 'OK' else 'CHECK（下の表で確かめる）' end
union all
select 6, 'ここから下：md_all_viewers で ON の人（社員 ID・記録の名前・社員の表の名前・役割・状態・付けた人・日時）。本当に全店を見る AM だけを付け直す', '', 'info'
union all
select 7 + row_number() over (order by o.emp_id)::int, o.emp_id,
       coalesce(o.rec->>'name', '') || ' ／ ' || coalesce((select coalesce(e.data->>'name', e.name) from public.employees e where e.id::text = o.emp_id), '（社員の表に無い）')
         || ' ／ ' || coalesce((select coalesce(e.data->>'role', e.role) from public.employees e where e.id::text = o.emp_id), '')
         || ' ／ ' || coalesce((select coalesce(e.data->>'status', e.status) from public.employees e where e.id::text = o.emp_id), ''),
       '付けた人 ' || coalesce(o.rec->>'by', '?') || '・' || coalesce(o.rec->>'at', '?')
  from on_rows o
order by n;
