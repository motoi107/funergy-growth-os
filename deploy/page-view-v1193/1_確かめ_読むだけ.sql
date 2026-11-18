-- 読むだけ（v1193・UI案95「画面の表示」）。20261211090000_pv_doc.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。STOP が無ければ SQL に進めます。表をそのまま Claude に貼ってください（名前・中身は出ません）。
-- 3・4 行目：今の「Grade別の非表示ページ」「役職別の非表示」の設定があるか。あれば、1193 の画面で初めの値を作るときに引き継ぎます（info）。
begin;
create temp table pv_pre(n int, what text, value text, ok text) on commit drop;
-- 1・2：表がまだ無くても止まらないように、行を数えるのは表があるときだけ（文字から呼ぶ）
do $$
declare n bigint; shape_ok boolean;
begin
  if to_regclass('public.pv_doc') is null then
    insert into pv_pre values (1, '表 pv_doc（画面の表示の設定）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pv_doc' and column_name = 'doc' and data_type = 'jsonb');
    if shape_ok then execute 'select count(*) from public.pv_doc' into n; end if;
    insert into pv_pre values (1, '表 pv_doc（画面の表示の設定）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end,
                               case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.pv_log') is null then
    insert into pv_pre values (2, '表 pv_log（変更の記録）', 'まだ無い', 'OK');
  else
    begin execute 'select count(*) from public.pv_log' into n; exception when others then n := null; end;
    insert into pv_pre values (2, '表 pv_log（変更の記録）', 'もうある（行 ' || coalesce(n::text, '?') || '）', 'OK');
  end if;
end $$;
insert into pv_pre
select 3, '今の「Grade別の非表示ページ」（app_settings の grade_hide）',
       case when to_regclass('public.app_settings') is null then '表が無い'
            when exists (select 1 from public.app_settings where key = 'grade_hide') then 'ある（' || (select jsonb_typeof(value::text::jsonb) from public.app_settings where key = 'grade_hide' limit 1) || '）'
            else '無い' end, 'info';
insert into pv_pre
select 4, '今の「役職別の非表示」（role_hide_g2・role_hide_g4）',
       case when to_regclass('public.app_settings') is null then '表が無い'
            else (select count(*) from public.app_settings where key in ('role_hide_g2', 'role_hide_g4'))::text || ' 個' end, 'info';
insert into pv_pre
select 5, '関数 pv_save', case when to_regprocedure('public.pv_save(jsonb,integer,text,jsonb,text,text,text)') is null then 'まだ無い' else 'もうある' end, 'OK';
select n, what, value, ok from pv_pre order by n;
rollback;
