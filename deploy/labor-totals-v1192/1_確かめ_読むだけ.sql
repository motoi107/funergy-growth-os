-- 読むだけ（v1192・Codex 6986713362 の P2-1）。20261210090000_md_all_viewers_gm.sql を流す「前」に、Supabase の SQL Editor で流す。何も変えません。
-- STOP が無ければ流してよい。7 行目以降は、今「ダッシュボードで全店を見る」が ON の人です（SQL はこの ON をそのまま写します）。
-- 知らない人・AM でない人・退職した人が ON になっていたら、SQL の前に GM・CEO が「管轄の割り当て」で外してください（表は Claude との会話にだけ貼る）。
-- 1 行目：関数 ss_guard_key が v1146 の形（prep_certs を含む）か。v1141〜v1145 の形だけなら SQL は止まる（呼ばずに中身の文字で見る＝無くても止まらない）
with g as (select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                           where ns.nspname = 'public' and p.proname = 'ss_guard_key' and p.prosrc like '%''prep_certs''%') as has_fn),
     s as (select (select value::text from public.app_settings where key = 'md_all_viewers') as v),
     m as (select case when s.v is not null and jsonb_typeof(s.v::jsonb) = 'object' then s.v::jsonb else '{}'::jsonb end as j from s),
     on_rows as (select e.key as emp_id, e.value as rec from m, jsonb_each(m.j) e
                 where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true')
select 1 as n, 'v1146 の SQL（ss_guard_key）' as what,
       case when (select has_fn from g) then '入っている' else '無い' end as value,
       case when (select has_fn from g) then 'OK' else 'STOP（先に 20261115090000）' end as ok
union all
select 2, 'app_state の写し md_all_viewers_gm',
       case when exists (select 1 from public.app_state where key = 'md_all_viewers_gm') then 'もうある（SQL は写さない）' else 'まだ無い（SQL が今の md_all_viewers を写す）' end, 'info'
union all
select 3, 'app_settings の md_all_viewers の形',
       case when (select v from s) is null then '無い（空の地図を作る）' when jsonb_typeof((select v from s)::jsonb) = 'object' then 'オブジェクト' else 'オブジェクトでない（空の地図を作る）' end,
       'info'
union all
select 4, 'ON の人の数', (select count(*) from on_rows)::text, 'info'
union all
select 5, 'ON の人のうち、社員の表に無い・退職・AM でない人', (select count(*) from on_rows o
         where not exists (select 1 from public.employees e where e.id::text = o.emp_id and coalesce(e.data->>'status', e.status, '') not in ('退職', 'resigned')
                           and coalesce(e.data->>'role', e.role, '') = 'am'))::text,
       case when (select count(*) from on_rows o
         where not exists (select 1 from public.employees e where e.id::text = o.emp_id and coalesce(e.data->>'status', e.status, '') not in ('退職', 'resigned')
                           and coalesce(e.data->>'role', e.role, '') = 'am')) = 0 then 'OK' else 'CHECK（下の表で確かめる）' end
union all
select 6, 'ここから下：ON の人（社員 ID・記録の名前・社員の表の名前・役割・状態・付けた人・日時）', '', 'info'
union all
select 7 + row_number() over (order by o.emp_id)::int, o.emp_id,
       coalesce(o.rec->>'name', '') || ' ／ ' || coalesce((select coalesce(e.data->>'name', e.name) from public.employees e where e.id::text = o.emp_id), '（社員の表に無い）')
         || ' ／ ' || coalesce((select coalesce(e.data->>'role', e.role) from public.employees e where e.id::text = o.emp_id), '')
         || ' ／ ' || coalesce((select coalesce(e.data->>'status', e.status) from public.employees e where e.id::text = o.emp_id), ''),
       '付けた人 ' || coalesce(o.rec->>'by', '?') || '・' || coalesce(o.rec->>'at', '?')
  from on_rows o
order by n;
