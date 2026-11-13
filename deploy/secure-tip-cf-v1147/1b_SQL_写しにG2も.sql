-- v1147 の直し（Codex #141 6781928056 の P2-1）：GM・CEO が確かめた権限の写し（wr_people）に G2（リーダー）も入れる。
--
-- 【前】関数 secure-state は、確かめた写しの無い人（G2・確かめがまだの AM・G4・店長・Head Chef）の店を、社員の表（役割・店・応援）から決めていた。
--   社員の表は公開の鍵で書けるので、G1 の人が自分の行の役割を g2・店をほかの店に書き換えると、その店の Tip の期間の確定（人ごとのチップ額）・
--   注意ログを読めて、期間の確定も作れた（応募者・Career Score の店の人も同じ形）。
-- 【いま】店のある範囲は、GM・CEO が確かめた写し（G2 以上）の店と今の社員の表の重なりだけ（関数 secure-state v1147 の protStores）。
--   写しに入るのは AM と G3 以上だった（wr_elevated）。G2 も「承認・閲覧の権限の確かめ」に出るように、写しに入れる人を G2 以上にする。
--   入れた直後は、今の G2（Crew Leader・Office Crew Leader）が全員「権限が増える」と出る（写しにまだいないため）。GM・CEO が確かめるまで、
--   その人は（関数 secure-state v1147 を入れたあと）自分の店の Tip の確定・注意ログ・応募者・Career Score を見られない。
--
-- 変えるもの：関数 wr_elevated 1 つ（G3 以上 → G2 以上）。表・ほかの関数・写しの中身は変えない。
--   work-requests の権限（評価の変更の申請＝G3・店の申請を見る・承認＝G4 以上）は今までどおり（グレードで決まる。写しに入っても G2 は G2）。
--   whoami の店（wr_actor）も変えない（G2 の店の重なりは関数 secure-state が写しを読んで決める）。
-- 2 回流しても同じ。戻すとき：db/wr-people-g2-rollback.sql（G3 以上に戻す。写しに入った G2 は「権限が減る」と出て、確かめると外れる）。
-- 気をつけること：20261107090000_work_requests_ui68.sql をあとで流し直すと、G3 以上に戻る（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.wr_elevated(jsonb)') is null or to_regclass('public.wr_people') is null then
  raise exception '先に 20261104090000_work_requests.sql（ワークセンターの申請）と 20261107090000_work_requests_ui68.sql を流してください。何も変えていません。';
 end if;
end $$;

-- 写しに入れる人：AM か G2 以上（前は G3 以上）。社員の表で G2 になった・店が増えた変更は、GM・CEO が確かめるまで効かない。
create or replace function public.wr_elevated(x jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select x is not null and jsonb_typeof(x) = 'object' and ((x->>'role') = 'am' or coalesce((x->>'grade')::int, 0) >= 2);
$$;

revoke all on function public.wr_elevated(jsonb) from public, anon, authenticated;
grant execute on function public.wr_elevated(jsonb) to service_role;

notify pgrst, 'reload schema';
