-- v1193（UI案95・Moto さん 11/18「すべて A」）：UI・データ閲覧権限の設定（画面の表示）を、GM・CEO だけが変えられる 1 つの記録にする。
-- 仕様：docs/PAGE_VIEW_V1193_JA.md。入れる順番：deploy/page-view-v1193/手順.md（確かめ → この SQL → 確かめ → 関数 secure-state → マージ →
-- 全部の端末を 1193 に → GM・CEO が「承認・閲覧設定 › 画面の表示」で初めの値を確かめて保存）。
--
-- ・表 pv_doc（1 行だけ・id = 1）：今の設定（列＝G1〜G6・AM・Head Chef・経理・事務共通 ごとの 表示／非表示、人ごとの例外、指定スタッフ限定）。
--   公開の鍵（anon・authenticated）では読めない・書けない。読み書きは関数 secure-state だけ（サーバーの鍵）。
--   関数は、ログインした人には「自分の列と自分の例外と、指定スタッフ限定で自分が入っているか」だけを返す（ほかの人の例外は返さない）。
-- ・表 pv_log：保存のたびの記録（いつ・だれ・理由・変わったところの要約・前と後の中身）。消さない。
-- ・関数 pv_save（サーバーの鍵だけ）：読んだときの版（p_expect）と今の版が同じときだけ書く（違えば conflict を返す・何も書かない）。
--   中身が同じなら書かない（same）。書いたら版を 1 つ進め、記録を 1 行足す。中身の形は関数 secure-state が確かめてから渡す。
-- ・行が無いあいだ（初めて保存するまで）、アプリは今までの決まりで画面を出す（何も変わらない）。
-- ・止めるとき：db/page-view-stop.sql（中身の off を true にする・記録に残す）。アプリは今までの決まりに戻る。
-- ・2 回流しても同じ（行・記録は消さない）。戻すとき：先に関数 secure-state を v1192 に戻してから db/page-view-rollback.sql。

do $$
begin
  if to_regclass('public.pv_doc') is not null and exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'pv_doc' and column_name = 'doc' and data_type <> 'jsonb') then
    raise exception 'STOP: public.pv_doc がありますが形が違います（何も変えていません）';
  end if;
end $$;

create table if not exists public.pv_doc (
  id smallint primary key check (id = 1),
  doc jsonb not null check (jsonb_typeof(doc) = 'object'),
  ver integer not null default 1 check (ver >= 1),
  updated_at timestamptz not null default now(),
  by_emp text,
  by_name text,
  by_role text
);
comment on table public.pv_doc is 'v1193: 画面の表示の設定（1 行）。読み書きは関数 secure-state だけ（pv_get・pv_full・pv_save）。docs/PAGE_VIEW_V1193_JA.md';

create table if not exists public.pv_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  ver integer not null,
  by_emp text,
  by_name text,
  by_role text,
  via text not null default 'fn' check (via in ('fn', 'sql')),
  reason text not null check (char_length(reason) between 1 and 500),
  summary jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  before jsonb,
  after jsonb not null
);
comment on table public.pv_log is 'v1193: 画面の表示の設定を変えた記録（消さない）。docs/PAGE_VIEW_V1193_JA.md';
create index if not exists pv_log_at on public.pv_log (at desc);

alter table public.pv_doc enable row level security;
alter table public.pv_log enable row level security;
revoke all on table public.pv_doc from public, anon, authenticated;
revoke all on table public.pv_log from public, anon, authenticated;
revoke all on sequence public.pv_log_id_seq from public, anon, authenticated;
grant select, insert, update on table public.pv_doc to service_role;
grant select, insert on table public.pv_log to service_role;
grant usage, select on sequence public.pv_log_id_seq to service_role;

create or replace function public.pv_save(p_doc jsonb, p_expect integer, p_reason text, p_summary jsonb,
                                          p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cur public.pv_doc%rowtype;
  nv integer;
  t timestamptz := now();
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'pv_bad_doc' using errcode = '22023'; end if;
  if p_expect is null or p_expect < 0 then raise exception 'pv_bad_expect' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(p_reason) > 500 then raise exception 'pv_bad_reason' using errcode = '22023'; end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'array' then raise exception 'pv_bad_summary' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.pv_doc'));
  select * into cur from public.pv_doc where id = 1 for update;
  if not found then
    if p_expect <> 0 then return jsonb_build_object('ok', false, 'conflict', true, 'ver', 0); end if;
    insert into public.pv_doc (id, doc, ver, updated_at, by_emp, by_name, by_role) values (1, p_doc, 1, t, p_by_emp, p_by_name, p_by_role);
    insert into public.pv_log (at, ver, by_emp, by_name, by_role, via, reason, summary, before, after)
      values (t, 1, p_by_emp, p_by_name, p_by_role, 'fn', p_reason, p_summary, null, p_doc);
    return jsonb_build_object('ok', true, 'ver', 1, 'at', t);
  end if;
  if cur.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', cur.ver); end if;
  if cur.doc = p_doc then return jsonb_build_object('ok', true, 'same', true, 'ver', cur.ver, 'at', cur.updated_at); end if;
  nv := cur.ver + 1;
  update public.pv_doc set doc = p_doc, ver = nv, updated_at = t, by_emp = p_by_emp, by_name = p_by_name, by_role = p_by_role where id = 1;
  insert into public.pv_log (at, ver, by_emp, by_name, by_role, via, reason, summary, before, after)
    values (t, nv, p_by_emp, p_by_name, p_by_role, 'fn', p_reason, p_summary, cur.doc, p_doc);
  return jsonb_build_object('ok', true, 'ver', nv, 'at', t);
end $$;
comment on function public.pv_save(jsonb, integer, text, jsonb, text, text, text) is
  'v1193: 画面の表示の設定を、読んだときの版のときだけ書く（違えば conflict）。記録を 1 行足す。サーバーの鍵だけ。';
revoke all on function public.pv_save(jsonb, integer, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.pv_save(jsonb, integer, text, jsonb, text, text, text) to service_role;
