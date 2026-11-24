-- v1212 Payroll 別のガソリン代・立替経費（B-2）を止める：関数（pe_）だけを外す。表（割当・版・支給の記録・支給日の決まり）は残す（消さない）。
-- 支給済みにした申請は精算済み（Payroll）のまま（事実の記録）。アプリの区画は「サーバー（SQL）がまだ」と出るだけ。もう一度使うときは ② を流す。
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'pe\_%' loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
notify pgrst, 'reload schema';
