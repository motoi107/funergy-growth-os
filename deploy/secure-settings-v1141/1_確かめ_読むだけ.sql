-- 読むだけ（v1141・2b-3）。関数 secure-state を v1141 にする前と、20261110090000_secure_settings_write.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない。地図の鍵・Score管理の中身は出しません（あるか・数・大きさだけ）。表をそのまま Claude に貼ってください。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'info（OFF。v1141 の SQL が ON にして今までどおり読み書きできる決まりを足します）' end
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
select 3, 'v1139・v1140 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 4, 'v1141 の決まり（ss_guard_ins・ss_guard_upd・ss_guard_del）', count(*)::text, case when count(*) = 0 then 'info（まだ）' else 'info（もう ' || count(*) || ' つ。流し直しても同じ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')
union all
-- ガソリン代の単価：work-requests の wr_mileage_rate と同じ読み方（包んだ形 __st も）。0 より大きく 5 以下でないと、ガソリン代の申請が「単価なし」で止まる
select 5, 'ガソリン代の設定（mileage_config）の単価',
       case when v is null then '行なし' when r is null then '数でない・ない' else r::text end,
       case when r is not null and r > 0 and r <= 5 then 'OK' else 'NG（ガソリン代の申請が止まる単価。v1141 の画面で CEO・GM・経理が入れ直してください）' end
  from (select (select case when a.value::jsonb->>'__st' = '1' then a.value::jsonb->'v' else a.value::jsonb end from public.app_state a where a.key = 'mileage_config') v) x
  left join lateral (select case when jsonb_typeof(x.v->'ratePerMile') = 'number' then (x.v->>'ratePerMile')::numeric end r) y on true
union all
select 6, 'ガソリン代の設定の地図の鍵（gmapsKey。中身は出しません）',
       case when coalesce((select case when a.value::jsonb->>'__st' = '1' then a.value::jsonb->'v' else a.value::jsonb end from public.app_state a where a.key = 'mileage_config')->>'gmapsKey', '') = '' then '空' else '入っている' end,
       'info（入っているときは、Google Cloud でその鍵を funergy-plus.com だけから使えるように（HTTP リファラーの制限）してください。画面で使う鍵なので、公開の鍵と同じく見えます）'
union all
select 7, 'Score管理（career_cfg）', coalesce((select (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件・'
                                              || round(octet_length(a.value::text) / 1024.0)::text || ' KB' from public.app_state a where a.key = 'career_cfg'), '行なし'), 'info'
union all
-- PIN のログインで「経理」「GM」「CEO」と分かるのは、メールのアカウント（manager_auth）が社員と結ばれている人だけ（work-requests の whoami）。
-- 結ばれていない人は、PIN でログインしてもスタッフとして扱われ、v1141 からガソリン代の単価・Score管理を変えられない（メールのログインならできる）
select 8, 'CEO・GM・経理のメールのアカウントのうち、社員と結ばれていないもの', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（その人は PIN では変えられません。メールのログインで変えるか、社員を結んでください）' end
  from public.manager_auth m where m.role in ('ceo', 'gm', 'office') and (m.emp_id is null or m.emp_id::text = '')
union all
select 9, 'CEO・GM・経理のメールのアカウント（v1141 から単価を変えられる人）', count(*)::text, case when count(*) > 0 then 'OK' else 'STOP（だれも変えられなくなります）' end
  from public.manager_auth m where m.role in ('ceo', 'gm', 'office')
order by 1;
