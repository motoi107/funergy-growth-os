-- v1098（速さ）：app_state の行の一覧と、中身の印（md5）を返す読むだけの関数。
-- アプリはログインのたびに app_state を全部（本番 786 行・約 22.7MB：2026-10-20 の db/perf-data-size-check.sql）取っていた。
-- v1098 のアプリは先にこの一覧を取り、前に取り込んだときと印が同じで端末に値がある行は取らない（変わった行だけ取る）。
--   ・印は md5(value::text)。中身が 1 文字でも変われば変わる（書いた人・端末の時計・updated_at によらない）。
--   ・この関数が無いあいだ（この SQL を入れる前）も、アプリは今までどおり全部取る（壊れない）。
-- 足すのは関数 1 つだけ。表・行・列・権限の決まり（RLS）・見張り（trigger）は何も変えない。2 回流しても同じ。
-- security invoker：呼んだ人（アプリの鍵＝anon）の権限で読む。anon が読めない行は印も返らない（今の取り方と同じ）。
-- 戻すとき：drop function if exists public.app_state_index(text[]);（アプリは今までどおり全部取る形に戻る）

create or replace function public.app_state_index(p_skip_prefix text[] default '{}'::text[])
returns table(key text, updated_at timestamptz, h text, n integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.key::text,
         s.updated_at::timestamptz,
         md5(s.value::text),
         octet_length(s.value::text)
    from public.app_state s
   where not exists (
           select 1
             from unnest(coalesce(p_skip_prefix, '{}'::text[])) as p(x)
            where length(p.x) > 0 and left(s.key::text, length(p.x)) = p.x
         )
$$;

comment on function public.app_state_index(text[]) is
  'v1098: app_state の key・updated_at・md5(value::text)・バイト数（読むだけ）。アプリが変わった行だけを取るために使う。p_skip_prefix の接頭辞の行は返さない。';

revoke all on function public.app_state_index(text[]) from public;
grant execute on function public.app_state_index(text[]) to anon, authenticated, service_role;

-- PostgREST に新しい関数を知らせる
notify pgrst, 'reload schema';
