-- v1157 Google の口コミ：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ ② へ。
-- まだ無い表は直接書かず、あるときだけ query_to_xml で読む（初めてでもこの SQL は止まらない）。
select '1. Google の口コミの表の数（0 なら初めて・7 ならもう入っている＝もう一度流しても同じ）' as check_name,
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('gr_settings','gr_places','gr_bp','gr_oauth','gr_bp_loc','gr_reviews','gr_runs')) as result
union all select '2. 同じ名前のほかの表が無い（gr_ で始まる、この SQL が作らないもの）',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v','m','p','f') and c.relname like 'gr\_%'
        and c.relname not in ('gr_settings','gr_places','gr_bp','gr_oauth','gr_bp_loc','gr_reviews','gr_runs')) = 0
    then 'OK' else 'STOP（gr_ で始まる別の表がある。Claude に名前を）' end
union all select '3. 同じ名前のほかの関数が無い（gr_ で始まる、この SQL が作らないもの）',
  case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'gr\_%'
        and p.proname not in ('gr_hst_ym','gr_who','gr_worker_key','gr_status','gr_place_set','gr_place_of','gr_oauth_start','gr_oauth_take',
          'gr_bp_save','gr_bp_mark','gr_bp_creds','gr_bp_disconnect','gr_loc_set','gr_locs','gr_reviews_put','gr_kpi','gr_month','gr_run_log','gr_stage')) = 0
    then 'OK' else 'STOP（gr_ で始まる別の関数がある。Claude に名前を）' end
union all select '4. 毎日の取り込み（⑤）に使う pg_cron と pg_net が入っている（⑤ のときだけ要る）',
  case when exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net')
    then 'OK' else 'あとで（⑤ の前に Database → Extensions で pg_cron と pg_net を ON）' end
union all select '（参考）もう入っている口コミの数',
  case when to_regclass('public.gr_reviews') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml('select count(*) n from public.gr_reviews', false, false, '')))[1]::text end;
