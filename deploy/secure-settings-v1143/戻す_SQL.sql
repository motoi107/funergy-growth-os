-- v1143（2b-5）の SQL だけを戻す。GM・CEO だけが変える賞与・Career Score の設定 8 つを、また公開の鍵で書けるようにする（v1141 のあとと同じ）。
-- 行・値は何も変えない。v1141 の 2 つ（ガソリン代の設定・Score管理）は書けないまま。成長カルテ・賞与・Career Score・採用（v1139・v1140・v1142）は外したまま。
-- 2 回流しても同じ。アプリ v1143 は戻さなくても動く（関数 secure-state で書く）。v1141 の 2 つも戻すときは、このあと db/secure-settings-write-rollback.sql。
do $$
begin
  if to_regprocedure('public.ss_guard_key(text)') is null then return; end if;   -- v1141 の SQL が無い（戻すものが無い）
  create or replace function public.ss_guard_key(k text) returns boolean
  language sql immutable parallel safe set search_path = public, pg_temp as $f$
    select coalesce(k in ('mileage_config', 'career_cfg'), false)
  $f$;
  comment on function public.ss_guard_key(text) is
    'v1141: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey と同じ決まり。';
end $$;
notify pgrst, 'reload schema';
