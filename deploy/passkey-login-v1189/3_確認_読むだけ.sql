-- v1189 パスキーとメールのコードのログイン：入れたあとに確かめる（読むだけ・何も変えない）。result に NG が 1 つも無ければ OK。
with
 tb as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('dl_people','dl_pk_invites','dl_pk_codes','dl_pk_sessions','dl_mail')),
 fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'dl\_pk\_%' or p.proname in ('dl_top_pin_info','dl_pin_blocked','dl_admin_trial'))),
 stg as (select case when to_regprocedure('public.dl_pk_stage()') is not null
   then (xpath('/row/c/text()', query_to_xml('select public.dl_pk_stage()::text as c', false, true, '')))[1]::text::int end as st),
 tr as (select case when to_regclass('public.dl_flags') is not null and to_regclass('public.dl_devices') is not null
   then (xpath('/row/c/text()', query_to_xml('select (coalesce((select value from public.dl_flags where key = ''trial_off''), false) and not exists (select 1 from public.dl_devices where revoked_at is null) and not exists (select 1 from public.dl_trial))::text as c', false, true, '')))[1]::text end as off),
 ml as (select case when (select count(*) from tb where relname = 'dl_mail') = 1
   then (xpath('/row/c/text()', query_to_xml('select case when coalesce(from_addr, '''') = '''' then ''まだ'' when state = ''ok'' then ''つながっている'' when state = ''expired'' then ''切れている'' else ''まだつないでいない'' end as c from public.dl_mail where id = 1', false, true, '')))[1]::text end as st)
select 1 as no, '表が 5 つ（dl_people・dl_pk_invites・dl_pk_codes・dl_pk_sessions・dl_mail）' as check_item, case when (select count(*) from tb) = 5 then 'OK' else 'NG' end as result, (select count(*) from tb)::text as detail
union all select 2, '表は RLS ON', case when (select count(*) from tb) = 5 and (select bool_and(relrowsecurity) from tb) then 'OK' else 'NG' end, ''
union all select 3, '公開の鍵（anon・authenticated）で表を読めない・書けない',
  case when (select count(*) from tb) = 0 then 'NG'
       when exists (select 1 from tb, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr where has_table_privilege(r, 'public.' || tb.relname, pr)) then 'NG' else 'OK' end, ''
union all select 4, '関数が 40（dl_pk_ が 37・置き換えた dl_top_pin_info・dl_pin_blocked・dl_admin_trial）',
  case when (select count(*) from fn) = 40 and (select st from stg) = 1 then 'OK' else 'NG' end, (select count(*) from fn)::text
union all select 5, '公開の鍵で dl_ の関数をどれも呼べない',
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon','authenticated']) r
                    where n.nspname = 'public' and p.proname like 'dl\_%' and has_function_privilege(r, p.oid, 'EXECUTE')) then 'NG'
       when (select count(*) from fn) = 0 then 'NG' else 'OK' end, ''
union all select 6, 'サーバーの鍵（service_role）で関数を呼べる', case when coalesce((select bool_and(has_function_privilege('service_role', fn.oid, 'EXECUTE')) from fn), false) then 'OK' else 'NG' end, ''
union all select 7, '関数は security invoker・search_path 固定', case when coalesce((select bool_and(not prosecdef and array_to_string(proconfig, ',') like '%search_path%') from fn), false) then 'OK' else 'NG' end, ''
union all select 8, 'ログインの画面に「パスキーでログイン」を出す（login_info が pk を返す）',
  case when coalesce((select prosrc like '%''pk'', true%' from fn where proname = 'dl_top_pin_info'), false) then 'OK' else 'NG' end, ''
union all select 9, 'メール＋パスキーの人は PIN で入れない（dl_pin_blocked）',
  case when coalesce((select prosrc like '%''why'', ''passkey''%' from fn where proname = 'dl_pin_blocked'), false) then 'OK' else 'NG' end,
  case when coalesce((select prosrc like '%''why'', ''passkey''%' from fn where proname = 'dl_pin_blocked'), false) then '' else '前の SQL（pin-off-v1186 の ②）をあとで流し直した。2 をもう一度' end
union all select 10, 'ログインの試し（v1183）をやめた（端末・試す人 0・スイッチ trial_off）',
  case when (select off from tr) = 'true' then 'OK' else 'NG' end, ''
union all select 11, '送り手のメール（info）', coalesce((select st from ml), '—'),
  case (select st from ml) when 'まだ' then '4_送り手_SQL.sql を流す' when 'まだつないでいない' then 'GM が PIN の一覧 →「ログインの方式」→「Google でつなぐ」' when '切れている' then 'GM が「Google でつなぐ」をもう一度' else '' end
order by 1;
