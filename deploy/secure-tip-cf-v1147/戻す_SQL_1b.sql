-- 20261116080000_wr_people_g2.sql を戻す（写しに入れる人を AM と G3 以上に戻す：20261107090000 と同じ）。
-- 写しに入った G2 は「承認・閲覧の権限の確かめ」で「権限が減る」と出る（確かめると写しから外れる＝関数 secure-state v1147 では自分の店も見ない）。
-- 2 回流しても同じ。表・写しの中身は変えない。
create or replace function public.wr_elevated(x jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select x is not null and jsonb_typeof(x) = 'object' and ((x->>'role') = 'am' or coalesce((x->>'grade')::int, 0) >= 3);
$$;
revoke all on function public.wr_elevated(jsonb) from public, anon, authenticated;
grant execute on function public.wr_elevated(jsonb) to service_role;
notify pgrst, 'reload schema';
