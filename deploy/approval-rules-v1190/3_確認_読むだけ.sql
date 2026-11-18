-- v1190 承認・閲覧の共通ルール：② を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。
-- （参考）は数だけです。表は Claude との会話にだけ貼ってください（GitHub には貼らない）。
select '1. SQL の段が 8' as check_name,
  case when public.wr_stage('{}'::jsonb)->>'stage' = '8' then 'OK' else 'NG（② をもう一度流す）' end as result
union all select '2. ルール・代理・一括承認・使い始めの表が 4 つある（行の守りあり）',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('ar_settings','ar_rules','ar_delegates','ar_bulk') and c.relrowsecurity) = 4 then 'OK' else 'NG（② をもう一度流す）' end
union all select '3. 申請の関数が新しい形（共通ルールを見る）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname in ('wr_visible','wr_actions','wr_next','wr_row','wr_act','wr_get','wr_whoami') and (p.prosrc like '%public.ar\_%' or p.prosrc like '%\_v0(%')) = 7
   then 'OK' else 'NG（申請の前の SQL を流し直した → ② をもう一度）' end
union all select '4. 申請ごとにルートを付けるトリガーがある',
  case when exists (select 1 from pg_trigger where tgname = 'ar_route_trg' and not tgisinternal) then 'OK' else 'NG（② をもう一度流す）' end
union all select '5. 16 種類すべてにルール（下書きか有効）がある',
  case when (select count(distinct kind) from public.ar_rules where status in ('draft','active')) = 16 then 'OK' else 'NG（Claude に）' end
union all select '6. ブラウザの鍵では ar_ と wr_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
     and (p.proname like 'ar\_%' or p.proname like 'wr\_%')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（② をもう一度流す）' end
union all select '7. ブラウザの鍵では ar_ の表を読めない・書けない',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('ar_settings','ar_rules','ar_delegates','ar_bulk')
       and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) = 0
   then 'OK' else 'NG（② をもう一度流す）' end
union all select '8. PR #191 のレビューの直しが入っている（ルールの版・差し戻し中のルート・役割の一覧の写し）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
       and ((p.proname in ('ar_rule_activate','ar_rule_discard','ar_rule_save') and p.prosrc like '%expect_ver%')
         or (p.proname = 'ar_apply' and p.prosrc like '%(p->>''ver'')::int <> g.ver%')
         or (p.proname = 'ar_go_off' and p.prosrc like '%returned%')
         or (p.proname = 'ar_holders' and p.prosrc like '%ar_role_cache%'))) = 6
     and (select count(*) from pg_trigger where tgname = 'ar_role_cache_reset' and not tgisinternal)
       = (select count(*) from unnest(array['manager_auth','wr_people','employees','stores','wr_exp_grants']) t where to_regclass('public.' || t) is not null)
   then 'OK' else 'NG（② の今の版をもう一度流す）' end
union all select '9. PR #192 のレビューの直しが入っている（捨てた下書きを残す・兼任の確かめ・「全員」の段の表示）',
  case when exists (select 1 from pg_constraint c where c.conrelid = 'public.ar_rules'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%discarded%')
     and (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
       and (p.proname in ('ar_sdr_ok','ar_open_ok')
         or (p.proname = 'ar_rule_discard' and p.prosrc like '%discarded%' and p.prosrc not like '%delete from%')
         or (p.proname = 'ar_rule_check' and p.prosrc like '%ar\_sdr\_ok%')
         or (p.proname in ('ar_stuck','ar_can_approve') and p.prosrc like '%ar\_open\_ok%')
         or (p.proname = 'ar_route_view' and p.prosrc like '%v\_after%')
         or (p.proname = 'ar_bulk_counts' and p.prosrc like '%''stage''%'))) = 8
   then 'OK' else 'NG（② の今の版をもう一度流す）' end
union all select '（参考）共通ルールで動いているか（入れたばかりは false＝今までの決まりのまま）',
  (select live::text from public.ar_settings where id = 1)
union all select '（参考）ルール：有効 / 下書き',
  (select count(*) filter (where status = 'active')::text || ' / ' || count(*) filter (where status = 'draft')::text from public.ar_rules)
union all select '（参考）承認上の役割の人数（CEO・GM・AM・Head Chef・経理マネージャー・経理リーダー・事務Crew）',
  (select string_agg(r || ' ' || n, '・' order by o) from (
    select g.role as r, count(distinct g.emp_id) as n,
      array_position(array['ceo','gm','am','chef','acct_mgr','acct_lead','office_crew'], g.role) as o
    from public.ar_role_rows() g where public.ar_emp_ok(g.emp_id) group by g.role) x)
union all select '（参考）ルートが付いている承認待ち / 止まっている（承認できる人がいない）',
  (select count(*) filter (where route is not null)::text || ' / ' || count(*) filter (where route is not null and public.ar_stuck(r))::text
    from public.wr_requests r where status = 'pending');
