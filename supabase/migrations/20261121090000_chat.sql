-- v1156：チャット（DM・グループ・申請の案件のチャット）（UI案69 の答え 3A〜7A・Moto さん 11/03 と 11/13「大きい作業も始めてください」）。
-- 仕様：docs/CHAT_V1156_JA.md
-- 先にワークセンターの申請（1 段目〜段階 2：20261104090000〜20261120090000）を流してから。2 回流しても同じ。
--
-- だれか：PIN のログインの印から関数 work-requests が社員 ID を確かめ、wr_actor（在籍・役割・店）で決める。店のタブレット（店舗の PIN）は使えない。
-- 3A：全スタッフ（G1 から）が DM もグループも作れる。
-- 4A：申請のチャットには申請した人・決める人・確かめる人が自動で入る（auto）。ほかの人は参加者か GM・CEO が加える。
--     自動で入った人は、その申請を見られなくなったら読めない（役割が変わった・担当の店から外れた）。加えられた人は申請を見られなくても読める。
-- 5A：本人は 24 時間まで直せる（「編集済み」）・消せる（「削除されました」・本文は消す）。GM・CEO は見えなくできる（本文はサーバーに残す・画面には出さない）。
-- 7A：知らせはアプリの中だけ（数・自分宛ての @）。LINE には送らない。
-- 「変わった」の合図：表 chat_sig（ランダムな印・回数・時刻だけ。社員 ID・本文は無い）。公開の鍵で読める（Realtime）。印は本人だけが知る。
-- 表はどれも公開の鍵で読めない・書けない（RLS・権限なし）。関数はサーバーの鍵だけ。

do $$ begin
 if to_regprocedure('public.wr_actor(jsonb)') is null or to_regprocedure('public.wr_visible(jsonb, public.wr_requests)') is null
    or to_regprocedure('public.wr_is_s2(text)') is null then
  raise exception 'STOP: 先にワークセンターの申請の SQL（段階 2：deploy/work-requests-v1155 まで）を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
create sequence if not exists public.chat_chg_seq;

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm','group','case')),
  title text,
  dm_key text unique,                         -- DM：2 人の社員 ID（小さい順に「|」でつなぐ）
  ref_kind text check (ref_kind in ('wr')),   -- 案件：今は申請（wr）だけ
  ref_id uuid unique,                         -- 申請 1 つにチャット 1 つ
  created_by text not null,
  created_name text,
  created_key text unique,                    -- グループを作った送信の鍵（同じ送信は 1 回）
  created_at timestamptz not null default now(),
  last_seq bigint not null default 0,
  last_at timestamptz,
  chg bigint not null default 0,
  rev integer not null default 1
);

create table if not exists public.chat_members (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  emp_id text not null,
  auto boolean not null default false,        -- 申請のチャットに自動で入った人
  added_by text,
  added_at timestamptz not null default now(),
  left_at timestamptz,
  history_from bigint not null default 1,     -- この番号のメッセージから読める（加えたときに「これまでの会話を見せない」なら次の番号）
  last_read bigint not null default 0,
  chg bigint not null default 0,
  primary key (thread_id, emp_id)
);
create index if not exists chat_members_emp_idx on public.chat_members(emp_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  seq bigint not null,
  author_emp text not null,
  author_name text not null,
  body text,
  mentions text[] not null default '{}'::text[],
  client_key text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  edits jsonb not null default '[]'::jsonb,   -- 直す前の本文（サーバーだけ・画面には出さない・20 件まで）
  deleted_at timestamptz,
  hidden_at timestamptz, hidden_by text, hidden_name text, hidden_reason text,
  unique (thread_id, seq),
  unique (author_emp, client_key)
);
create index if not exists chat_messages_mentions_idx on public.chat_messages using gin (mentions);

-- 「変わった」の合図（本人だけが知るランダムな印）。社員 ID・本文は持たない
create table if not exists public.chat_sig (
  token text primary key,
  n bigint not null default 0,
  at timestamptz not null default now()
);
create table if not exists public.chat_sig_owner (
  emp_id text primary key,
  token text not null unique references public.chat_sig(token) on delete cascade
);

alter table public.chat_threads enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_sig_owner enable row level security;
alter table public.chat_sig enable row level security;
revoke all on public.chat_threads, public.chat_members, public.chat_messages, public.chat_sig_owner from public, anon, authenticated;
revoke all on public.chat_sig from public, anon, authenticated;
revoke all on sequence public.chat_chg_seq from public, anon, authenticated;
grant select, insert, update, delete on public.chat_threads, public.chat_members, public.chat_messages, public.chat_sig_owner, public.chat_sig to service_role;
grant usage, select on sequence public.chat_chg_seq to service_role;
-- 合図だけは公開の鍵で読める（Realtime。印・回数・時刻だけ）
grant select on public.chat_sig to anon, authenticated;
drop policy if exists chat_sig_read on public.chat_sig;
create policy chat_sig_read on public.chat_sig for select to anon, authenticated using (true);
do $$ begin
 if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_sig') then
  execute 'alter publication supabase_realtime add table public.chat_sig';
 end if;
end $$;

-- ---------------------------------------------------------------- 決まり
create or replace function public.chat_limits() returns jsonb
language sql immutable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('body', 2000, 'title', 60, 'group_max', 50, 'edit_hours', 24, 'page', 100, 'reason', 200);
$$;

-- 呼んだ人（在籍の社員だけ・店のタブレットは社員 ID が無いので wr_actor が断る）
create or replace function public.chat_actor(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select public.wr_actor(p); $$;

-- ほかの人の役割（申請のチャットの自動の参加者を決める・見られるかを確かめる）。在籍でなければ null
create or replace function public.chat_actor_of(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 return public.wr_actor(jsonb_build_object('emp_id', p_emp));
exception when others then return null;
end $$;

create or replace function public.chat_is_gm(a jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$ select coalesce(a->>'role', '') in ('ceo','gm'); $$;

-- 申請の決める人・確かめる人（4A）：GM・CEO、お金の種類と経理の確認がある種類は経理・事務Crew、AM の段・ガソリン代の承認の AM、前に動いた人
create or replace function public.chat_case_auto(r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; c record; a jsonb; v_am jsonb; v_acct boolean;
 v_amstep boolean := r.steps is not null and 'am' = any(r.steps);
begin
 v_acct := r.kind in ('mileage','reimburse','expense_pre') or (public.wr_is_s2(r.kind) and public.wr_s2_acct(r.kind));
 if r.requester_emp is not null then o := o || r.requester_emp; end if;
 for c in select distinct x.emp_id::text as emp from public.manager_auth x
           where x.emp_id is not null and x.role in ('ceo','gm','office','office_crew') loop
  a := public.chat_actor_of(c.emp);
  if a is null then continue; end if;
  if (public.chat_is_gm(a) or (v_acct and (a->>'role') in ('office','office_crew'))) and public.wr_visible(a, r) then o := o || c.emp; end if;
 end loop;
 if r.kind = 'mileage' then
  begin v_am := public.wr_approver_am(r); exception when others then v_am := null; end;
  if v_am is not null and coalesce(v_am->>'emp', '') <> '' then
   a := public.chat_actor_of(v_am->>'emp');
   if a is not null and public.wr_visible(a, r) then o := o || (v_am->>'emp'); end if;
  end if;
 end if;
 if v_amstep then
  for c in select p.emp_id::text as emp from public.wr_people p where r.store_id = any(public.wr_arr(p.data->'am_stores')) loop
   a := public.chat_actor_of(c.emp);
   if a is not null and (a->>'role') = 'am' and public.wr_visible(a, r) then o := o || c.emp; end if;
  end loop;
 end if;
 -- 前にこの申請で動いた人（承認・確かめ・支払・反映）
 for c in select distinct e.by_emp as emp from public.wr_events e where e.request_id = r.id and e.by_emp is not null loop
  a := public.chat_actor_of(c.emp);
  if a is not null and public.wr_visible(a, r) then o := o || c.emp; end if;
 end loop;
 return (select coalesce(array_agg(distinct x), '{}'::text[]) from unnest(o) x where x is not null and x <> '');
end $$;

-- その人がこのチャットの参加者か（読める・書ける）。自動で入った人は、いまも申請を見られるときだけ
create or replace function public.chat_member_of(a jsonb, t public.chat_threads) returns public.chat_members
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare m public.chat_members; r public.wr_requests;
begin
 select * into m from public.chat_members x where x.thread_id = t.id and x.emp_id = a->>'emp' and x.left_at is null;
 if not found then return null; end if;
 if t.kind = 'case' and m.auto then
  select * into r from public.wr_requests x where x.id = t.ref_id;
  if not found or not public.wr_visible(a, r) then return null; end if;
 end if;
 return m;
end $$;

create or replace function public.chat_find(a jsonb, p_id text) returns public.chat_threads
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare t public.chat_threads;
begin
 if p_id is null or p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = p_id::uuid;
 if not found or public.chat_member_of(a, t) is null then raise exception 'not_found'; end if;
 return t;
end $$;

-- 本人の合図の印（無ければ作る）
create or replace function public.chat_token(p_emp text) returns text
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v text;
begin
 select o.token into v from public.chat_sig_owner o where o.emp_id = p_emp;
 if v is not null then return v; end if;
 v := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
 insert into public.chat_sig(token) values (v) on conflict do nothing;
 insert into public.chat_sig_owner(emp_id, token) values (p_emp, v) on conflict (emp_id) do nothing;
 select o.token into v from public.chat_sig_owner o where o.emp_id = p_emp;
 return v;
end $$;

-- 変わった：会話の番号を進め、参加者の合図を鳴らす（失敗しても保存は止めない）
create or replace function public.chat_bump(p_thread uuid) returns bigint
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v bigint := nextval('public.chat_chg_seq'); c record; v_tok text;
begin
 update public.chat_threads set chg = v where id = p_thread;
 begin
  for c in select m.emp_id from public.chat_members m where m.thread_id = p_thread and m.left_at is null loop
   v_tok := public.chat_token(c.emp_id);
   update public.chat_sig s set n = s.n + 1, at = now() where s.token = v_tok;
  end loop;
 exception when others then null;
 end;
 return v;
end $$;

-- 自分の分だけ変わった（既読・抜けた）：自分の行の番号を進め、自分の合図だけ鳴らす（ほかの端末の自分）
create or replace function public.chat_bump_me(p_thread uuid, p_emp text) returns void
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_tok text;
begin
 update public.chat_members set chg = nextval('public.chat_chg_seq') where thread_id = p_thread and emp_id = p_emp;
 begin
  v_tok := public.chat_token(p_emp);
  update public.chat_sig s set n = s.n + 1, at = now() where s.token = v_tok;
 exception when others then null;
 end;
end $$;

-- 会話の番号だけ進める（合図は鳴らさない）：既読の数のように、ほかの人は次に読むときに分かればよいもの
create or replace function public.chat_touch(p_thread uuid) returns void
language sql volatile security invoker set search_path = public, pg_temp as $$
 update public.chat_threads set chg = nextval('public.chat_chg_seq') where id = p_thread;
$$;

-- 在籍の社員か（加える・DM の相手）
create or replace function public.chat_emp_ok(p_emp text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select p_emp is not null and length(p_emp) <= 64 and public.chat_actor_of(p_emp) is not null;
$$;

create or replace function public.chat_emp_name(p_emp text) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce((select btrim(coalesce(e.name, '')) from public.employees e where e.id::text = p_emp), '');
$$;

-- 本文の確かめ（空・長すぎ・制御文字は断る）
create or replace function public.chat_body(p_body text) returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare v text := btrim(regexp_replace(coalesce(p_body, ''), '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]', '', 'g'));
begin
 if v = '' or length(v) > 2000 then raise exception 'bad_value'; end if;
 return v;
end $$;

-- メンション（参加者だけ。いない人は not_member：画面が「参加者に加えますか」と聞く）
create or replace function public.chat_mentions(t public.chat_threads, p jsonb) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v text;
begin
 if p is null or jsonb_typeof(p) = 'null' then return o; end if;
 if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 50 then raise exception 'bad_value'; end if;
 for v in select jsonb_array_elements_text(p) loop
  if v is null or length(v) > 64 then raise exception 'bad_value'; end if;
  if not exists (select 1 from public.chat_members m where m.thread_id = t.id and m.emp_id = v and m.left_at is null) then raise exception 'not_member'; end if;
  if not (v = any(o)) then o := o || v; end if;
 end loop;
 return o;
end $$;

-- 会話の見出し（DM＝相手の名前・案件＝番号と見出し）
create or replace function public.chat_title(a jsonb, t public.chat_threads) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text;
begin
 if t.kind = 'dm' then
  select public.chat_emp_name(m.emp_id) into v from public.chat_members m where m.thread_id = t.id and m.emp_id <> a->>'emp' limit 1;
  return coalesce(nullif(v, ''), '（名前なし）');
 end if;
 return coalesce(t.title, '');
end $$;

-- 一覧の 1 行
create or replace function public.chat_row(a jsonb, t public.chat_threads, m public.chat_members) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare lm public.chat_messages; v_unread integer; v_ment integer; v_n integer; v_prev text; r public.wr_requests; v_ref jsonb := null; v_other text;
begin
 select * into lm from public.chat_messages x where x.thread_id = t.id and x.seq >= m.history_from order by x.seq desc limit 1;
 select count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null),
        count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null and x.mentions @> array[a->>'emp'])
   into v_unread, v_ment
   from public.chat_messages x where x.thread_id = t.id and x.seq > greatest(m.last_read, m.history_from - 1);
 select count(*) into v_n from public.chat_members x where x.thread_id = t.id and x.left_at is null;
 if lm.id is not null then
  v_prev := case when lm.deleted_at is not null then '（削除されました）' when lm.hidden_at is not null then '（見えなくなりました）'
                 else left(regexp_replace(lm.body, '\s+', ' ', 'g'), 80) end;
 end if;
 if t.kind = 'case' then
  select * into r from public.wr_requests x where x.id = t.ref_id;
  if found then v_ref := jsonb_build_object('kind', 'wr', 'id', r.id, 'code', r.code, 'wr_kind', r.kind, 'status', r.status, 'store_id', r.store_id); end if;
 end if;
 if t.kind = 'dm' then select x.emp_id into v_other from public.chat_members x where x.thread_id = t.id and x.emp_id <> a->>'emp' limit 1; end if;
 return jsonb_build_object('id', t.id, 'kind', t.kind, 'title', public.chat_title(a, t), 'other', v_other, 'ref', v_ref, 'members', v_n,
  'created_by', t.created_by, 'created_name', t.created_name, 'rev', t.rev,
  'last_seq', t.last_seq, 'last_at', t.last_at, 'last_read', m.last_read, 'history_from', m.history_from,
  'preview', case when lm.id is null then null else jsonb_build_object('seq', lm.seq, 'name', lm.author_name, 'emp', lm.author_emp, 'text', v_prev, 'at', lm.created_at) end,
  'unread', v_unread, 'mention', v_ment, 'chg', greatest(t.chg, m.chg));
end $$;

-- メッセージ 1 つ（消した・見えなくしたものは本文を出さない。自分のメッセージは何人が読んだか）
create or replace function public.chat_msg(a jsonb, t public.chat_threads, x public.chat_messages) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_read integer := null; v_mine boolean := x.author_emp = a->>'emp';
begin
 if v_mine then
  select count(*) into v_read from public.chat_members m
   where m.thread_id = t.id and m.left_at is null and m.emp_id <> x.author_emp and m.last_read >= x.seq;
 end if;
 return jsonb_build_object('id', x.id, 'seq', x.seq, 'emp', x.author_emp, 'name', x.author_name, 'at', x.created_at,
  'body', case when x.deleted_at is not null or x.hidden_at is not null then null else x.body end,
  'mentions', case when x.deleted_at is not null or x.hidden_at is not null then '[]'::jsonb else to_jsonb(x.mentions) end,
  'edited', x.edited_at is not null and x.deleted_at is null and x.hidden_at is null,
  'deleted', x.deleted_at is not null, 'hidden', x.hidden_at is not null,
  'hidden_name', case when x.hidden_at is not null then x.hidden_name end,
  'mine', v_mine, 'read', v_read,
  'can_edit', v_mine and x.deleted_at is null and x.hidden_at is null and x.created_at > now() - interval '24 hours',
  'can_delete', v_mine and x.deleted_at is null and x.hidden_at is null,
  'can_hide', public.chat_is_gm(a) and x.deleted_at is null and not v_mine,
  'key', case when v_mine then x.client_key end);
end $$;

-- ---------------------------------------------------------------- 読む
-- 変わった会話（since より後）と、全体の未読・自分宛ての @ の数・自分の合図の印
create or replace function public.chat_sync(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_since bigint := 0; v_lim integer := 200; o jsonb := '[]'::jsonb; c record; v_max bigint := 0;
 v_unread integer := 0; v_ment integer := 0; v_more boolean := false; v_n integer := 0; v_row jsonb; v_gone jsonb := '[]'::jsonb;
begin
 if jsonb_typeof(p->'since') = 'number' then v_since := greatest(0, (p->>'since')::bigint); end if;
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(500, greatest(1, (p->>'limit')::int)); end if;
 for c in select t.*, m.emp_id as m_emp, m.left_at as m_left, m.chg as m_chg
            from public.chat_members m join public.chat_threads t on t.id = m.thread_id
           where m.emp_id = a->>'emp' and greatest(t.chg, m.chg) > v_since
           order by greatest(t.chg, m.chg) asc loop
  if v_n >= v_lim then v_more := true; exit; end if;
  v_n := v_n + 1;
  v_max := greatest(v_max, c.chg, c.m_chg);
  declare t public.chat_threads; m public.chat_members;
  begin
   select * into t from public.chat_threads x where x.id = c.id;
   m := public.chat_member_of(a, t);
   if m.thread_id is null then v_gone := v_gone || to_jsonb(c.id::text);
   else o := o || public.chat_row(a, t, m); end if;
  end;
 end loop;
 -- 全体の数（読める会話だけ・未読のある会話だけ数える）
 for c in select t.id from public.chat_members m join public.chat_threads t on t.id = m.thread_id
           where m.emp_id = a->>'emp' and m.left_at is null and t.last_seq > m.last_read loop
  declare t2 public.chat_threads; m2 public.chat_members; k1 integer; k2 integer;
  begin
   select * into t2 from public.chat_threads x where x.id = c.id;
   m2 := public.chat_member_of(a, t2);
   if m2.thread_id is not null then
    select count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null),
           count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null and x.mentions @> array[a->>'emp'])
      into k1, k2
      from public.chat_messages x where x.thread_id = t2.id and x.seq > greatest(m2.last_read, m2.history_from - 1);
    v_unread := v_unread + k1; v_ment := v_ment + k2;
   end if;
  end;
 end loop;
 return jsonb_build_object('threads', o, 'gone', v_gone, 'cursor', greatest(v_since, v_max),
  'more', v_more, 'unread', v_unread, 'mention', v_ment, 'token', public.chat_token(a->>'emp'), 'me', a->>'emp', 'role', a->>'role', 'limits', public.chat_limits());
end $$;

-- 会話のメッセージ（after＝この番号より後・before＝この番号より前）と参加者
create or replace function public.chat_messages_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); m public.chat_members := public.chat_member_of(a, t);
 v_after bigint := null; v_before bigint := null; v_lim integer := 100; o jsonb; mem jsonb; v_older boolean;
begin
 if jsonb_typeof(p->'after') = 'number' then v_after := (p->>'after')::bigint; end if;
 if jsonb_typeof(p->'before') = 'number' then v_before := (p->>'before')::bigint; end if;
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(100, greatest(1, (p->>'limit')::int)); end if;
 select coalesce(jsonb_agg(public.chat_msg(a, t, x) order by x.seq), '[]'::jsonb) into o from (
  select * from public.chat_messages y
   where y.thread_id = t.id and y.seq >= m.history_from
     and (v_after is null or y.seq > v_after) and (v_before is null or y.seq < v_before)
   order by case when v_after is not null then y.seq end asc, case when v_after is null then y.seq end desc
   limit v_lim) x;
 select exists (select 1 from public.chat_messages y where y.thread_id = t.id and y.seq >= m.history_from
   and y.seq < coalesce((select min((e->>'seq')::bigint) from jsonb_array_elements(o) e), 0)) into v_older;
 select coalesce(jsonb_agg(jsonb_build_object('emp', x.emp_id, 'name', public.chat_emp_name(x.emp_id), 'auto', x.auto, 'last_read', x.last_read)
   order by public.chat_emp_name(x.emp_id)), '[]'::jsonb) into mem
   from public.chat_members x where x.thread_id = t.id and x.left_at is null;
 return jsonb_build_object('thread', public.chat_row(a, t, m), 'messages', o, 'older', coalesce(v_older, false), 'members', mem,
  'can_add', t.kind <> 'dm', 'can_rename', t.kind = 'group', 'can_leave', t.kind = 'group',
  'can_remove', t.kind <> 'dm' and (t.created_by = a->>'emp' or public.chat_is_gm(a)));
end $$;

-- 自分宛ての @ の一覧（読める会話だけ・新しい順）
create or replace function public.chat_my_mentions(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_lim integer := 50; o jsonb := '[]'::jsonb; c public.chat_messages; t public.chat_threads; m public.chat_members;
begin
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(100, greatest(1, (p->>'limit')::int)); end if;
 for c in select x.* from public.chat_messages x
           where x.mentions @> array[a->>'emp'] and x.deleted_at is null and x.hidden_at is null
           order by x.created_at desc limit v_lim * 2 loop
  select * into t from public.chat_threads y where y.id = c.thread_id;
  m := public.chat_member_of(a, t);
  if m.thread_id is null or c.seq < m.history_from then continue; end if;
  o := o || (public.chat_msg(a, t, c) || jsonb_build_object('thread', t.id, 'thread_title', public.chat_title(a, t), 'thread_kind', t.kind, 'unread', c.seq > m.last_read));
  exit when jsonb_array_length(o) >= v_lim;
 end loop;
 return jsonb_build_object('items', o);
end $$;

-- 相手を選ぶ一覧（在籍の社員：名前・店・グレード）。3A：だれとでも DM・グループ
create or replace function public.chat_people(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); o jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('emp', e.id::text, 'name', btrim(coalesce(e.name, '')), 'store', e.store, 'title', e.title) order by btrim(coalesce(e.name, ''))), '[]'::jsonb)
   into o from public.employees e where not public.wr_emp_out(e) and btrim(coalesce(e.name, '')) <> '';
 return jsonb_build_object('people', o, 'me', a->>'emp');
end $$;

-- ---------------------------------------------------------------- 作る
-- DM（同じ 2 人なら同じ会話）。前からある DM は相手が退職していても開ける（前の会話を読む）。新しく作るのは在籍の人とだけ
create or replace function public.chat_open_dm(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_to text := p->>'to'; v_key text; t public.chat_threads; m public.chat_members;
begin
 if v_to is null or v_to = '' or length(v_to) > 64 or v_to = a->>'emp' then raise exception 'bad_value'; end if;
 v_key := least(a->>'emp', v_to) || '|' || greatest(a->>'emp', v_to);
 perform pg_advisory_xact_lock(hashtext('chat_dm:' || v_key));
 select * into t from public.chat_threads x where x.dm_key = v_key;
 if not found then
  if not public.chat_emp_ok(v_to) then raise exception 'bad_value'; end if;
  insert into public.chat_threads(kind, dm_key, created_by, created_name) values ('dm', v_key, a->>'emp', a->>'name') returning * into t;
  insert into public.chat_members(thread_id, emp_id, added_by) values (t.id, a->>'emp', a->>'emp'), (t.id, v_to, a->>'emp');
  perform public.chat_bump(t.id);
  select * into t from public.chat_threads x where x.id = t.id;
 end if;
 m := public.chat_member_of(a, t);
 return public.chat_row(a, t, m);
end $$;

-- グループ（作った人＋選んだ人・2〜50 人）
create or replace function public.chat_create_group(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_title text := btrim(regexp_replace(coalesce(p->>'title', ''), '[\u0001-\u001f\u007f]', '', 'g'));
 v_key text := p->>'client_key'; t public.chat_threads; v text; v_set text[] := '{}';
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_title = '' or length(v_title) > 60 then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'members') <> 'array' or jsonb_array_length(p->'members') < 1 or jsonb_array_length(p->'members') > 49 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('chat_group:' || v_key));
 select * into t from public.chat_threads x where x.created_key = v_key;
 if found then
  if t.created_by is distinct from a->>'emp' then raise exception 'conflict'; end if;
  return public.chat_row(a, t, public.chat_member_of(a, t)) || jsonb_build_object('replay', true);
 end if;
 for v in select jsonb_array_elements_text(p->'members') loop
  if v = a->>'emp' then continue; end if;
  if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
  if not (v = any(v_set)) then v_set := v_set || v; end if;
 end loop;
 if cardinality(v_set) < 1 then raise exception 'bad_value'; end if;
 insert into public.chat_threads(kind, title, created_by, created_name, created_key) values ('group', v_title, a->>'emp', a->>'name', v_key) returning * into t;
 insert into public.chat_members(thread_id, emp_id, added_by) values (t.id, a->>'emp', a->>'emp');
 insert into public.chat_members(thread_id, emp_id, added_by) select t.id, x, a->>'emp' from unnest(v_set) x;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- 申請のチャットを開く（4A：決める人・確かめる人が自動で入る）。参加者でなければ thread は null
-- まだいない人だけ足す（GM・CEO が外した人・自分で抜けた人は戻さない）
create or replace function public.chat_case_sync(r public.wr_requests, t public.chat_threads) returns integer
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v text; n integer := 0; k integer;
begin
 foreach v in array public.chat_case_auto(r) loop
  insert into public.chat_members(thread_id, emp_id, auto, added_by) values (t.id, v, true, 'auto')
   on conflict (thread_id, emp_id) do nothing;
  get diagnostics k = row_count; n := n + k;
 end loop;
 return n;
end $$;

create or replace function public.chat_case(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); r public.wr_requests; t public.chat_threads; m public.chat_members; v_title text;
begin
 r := public.wr_find(a, p);   -- 見られない申請は not_found
 if not public.wr_visible(a, r) then raise exception 'not_found'; end if;
 perform pg_advisory_xact_lock(hashtext('chat_case:' || r.id::text));
 select * into t from public.chat_threads x where x.ref_kind = 'wr' and x.ref_id = r.id;
 if not found then
  if not (a->>'emp' = any(public.chat_case_auto(r))) then
   return jsonb_build_object('thread', null, 'can_open', false);   -- まだチャットが無く、この人は自動の参加者でもない
  end if;
  v_title := left(btrim(coalesce(r.payload->>'title', r.payload->>'purpose', r.payload->>'vendor', '')), 60);
  insert into public.chat_threads(kind, title, ref_kind, ref_id, created_by, created_name)
   values ('case', nullif(v_title, ''), 'wr', r.id, a->>'emp', a->>'name') returning * into t;
  perform public.chat_case_sync(r, t);
  perform public.chat_bump(t.id);
  select * into t from public.chat_threads x where x.id = t.id;
 else
  perform public.chat_case_sync(r, t);
 end if;
 m := public.chat_member_of(a, t);
 if m.thread_id is null then return jsonb_build_object('thread', null, 'can_open', false); end if;
 return jsonb_build_object('thread', public.chat_row(a, t, m), 'can_open', true);
end $$;

-- ---------------------------------------------------------------- 書く
create or replace function public.chat_send(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; v_key text := p->>'client_key'; x public.chat_messages; v_body text; v_m text[];
 r public.wr_requests; v_seq bigint;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 select * into x from public.chat_messages y where y.author_emp = a->>'emp' and y.client_key = v_key;
 if found then
  if x.thread_id::text is distinct from lower(coalesce(p->>'thread', '')) then raise exception 'conflict'; end if;
  t := public.chat_find(a, p->>'thread');
  return public.chat_msg(a, t, x) || jsonb_build_object('replay', true);
 end if;
 t := public.chat_find(a, p->>'thread');
 v_body := public.chat_body(p->>'body');
 if t.kind = 'case' then   -- 案件は、送るたびに決める人・確かめる人を合わせる（段が進んだとき）
  select * into r from public.wr_requests y where y.id = t.ref_id;
  if found then perform public.chat_case_sync(r, t); end if;
 end if;
 v_m := public.chat_mentions(t, p->'mentions');
 update public.chat_threads set last_seq = last_seq + 1, last_at = now() where id = t.id returning last_seq into v_seq;
 insert into public.chat_messages(thread_id, seq, author_emp, author_name, body, mentions, client_key)
  values (t.id, v_seq, a->>'emp', coalesce(nullif(a->>'name', ''), public.chat_emp_name(a->>'emp')), v_body, v_m, v_key) returning * into x;
 update public.chat_members set last_read = greatest(last_read, v_seq) where thread_id = t.id and emp_id = a->>'emp';
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads y where y.id = t.id;
 return public.chat_msg(a, t, x);
end $$;

create or replace function public.chat_msg_find(a jsonb, p jsonb) returns public.chat_messages
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare x public.chat_messages; t public.chat_threads; m public.chat_members;
begin
 if coalesce(p->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 select * into x from public.chat_messages y where y.id = (p->>'id')::uuid;
 if not found then raise exception 'not_found'; end if;
 select * into t from public.chat_threads y where y.id = x.thread_id;
 m := public.chat_member_of(a, t);
 if m.thread_id is null or x.seq < m.history_from then raise exception 'not_found'; end if;
 return x;
end $$;

-- 直す（本人・24 時間まで）
create or replace function public.chat_edit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); x public.chat_messages := public.chat_msg_find(a, p); t public.chat_threads; v_body text; v_m text[];
begin
 select * into x from public.chat_messages y where y.id = x.id for update;
 if x.author_emp <> a->>'emp' then raise exception 'forbidden'; end if;
 if x.deleted_at is not null or x.hidden_at is not null then raise exception 'conflict'; end if;
 if x.created_at <= now() - interval '24 hours' then raise exception 'too_late'; end if;
 select * into t from public.chat_threads y where y.id = x.thread_id;
 v_body := public.chat_body(p->>'body');
 v_m := public.chat_mentions(t, p->'mentions');
 if v_body = x.body and v_m = x.mentions then return public.chat_msg(a, t, x); end if;
 update public.chat_messages set body = v_body, mentions = v_m, edited_at = now(),
   edits = (case when jsonb_array_length(edits) >= 20 then edits - 0 else edits end) || jsonb_build_object('at', now(), 'body', x.body)
  where id = x.id returning * into x;
 perform public.chat_bump(t.id);
 return public.chat_msg(a, t, x);
end $$;

-- 消す（本人・いつでも）：本文と直す前の本文を消し、「削除されました」だけ残す
create or replace function public.chat_delete(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); x public.chat_messages := public.chat_msg_find(a, p); t public.chat_threads;
begin
 select * into x from public.chat_messages y where y.id = x.id for update;
 if x.author_emp <> a->>'emp' then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads y where y.id = x.thread_id;
 if x.deleted_at is not null then return public.chat_msg(a, t, x); end if;
 if x.hidden_at is not null then raise exception 'conflict'; end if;   -- 見えなくしたものは記録のため残す
 update public.chat_messages set body = null, edits = '[]'::jsonb, mentions = '{}'::text[], deleted_at = now() where id = x.id returning * into x;
 perform public.chat_bump(t.id);
 return public.chat_msg(a, t, x);
end $$;

-- 見えなくする／戻す（GM・CEO・その会話の参加者のとき。本文はサーバーに残す）
create or replace function public.chat_hide(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); x public.chat_messages; t public.chat_threads;
 v_hide boolean := true; v_reason text := btrim(coalesce(p->>'reason', ''));
begin
 if not public.chat_is_gm(a) then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'hide') is not null and jsonb_typeof(p->'hide') <> 'boolean' then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'hide') = 'boolean' then v_hide := (p->>'hide')::boolean; end if;
 x := public.chat_msg_find(a, p);
 select * into x from public.chat_messages y where y.id = x.id for update;
 select * into t from public.chat_threads y where y.id = x.thread_id;
 if x.deleted_at is not null then raise exception 'conflict'; end if;
 if v_hide then
  if v_reason = '' or length(v_reason) > 200 then raise exception 'reason_required'; end if;
  if x.author_emp = a->>'emp' then raise exception 'forbidden'; end if;
  if x.hidden_at is not null then return public.chat_msg(a, t, x); end if;
  update public.chat_messages set hidden_at = now(), hidden_by = a->>'emp', hidden_name = a->>'name', hidden_reason = v_reason where id = x.id returning * into x;
 else
  if x.hidden_at is null then return public.chat_msg(a, t, x); end if;
  update public.chat_messages set hidden_at = null, hidden_by = null, hidden_name = null, hidden_reason = null where id = x.id returning * into x;
 end if;
 perform public.chat_bump(t.id);
 return public.chat_msg(a, t, x);
end $$;

-- 読んだ（番号は前へだけ進む）
create or replace function public.chat_read(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); v_seq bigint; v_old bigint;
begin
 if jsonb_typeof(p->'seq') <> 'number' then raise exception 'bad_value'; end if;
 v_seq := least((p->>'seq')::bigint, t.last_seq);
 select last_read into v_old from public.chat_members where thread_id = t.id and emp_id = a->>'emp' for update;
 if v_seq > v_old then
  update public.chat_members set last_read = v_seq where thread_id = t.id and emp_id = a->>'emp';
  perform public.chat_bump_me(t.id, a->>'emp');
  -- 読んだ人の数（自分のメッセージの「既読」）が変わる：ほかの参加者には合図を鳴らさず、次に読むときに分かるように番号だけ進める
  perform public.chat_touch(t.id);
 end if;
 return jsonb_build_object('thread', t.id, 'last_read', greatest(v_seq, v_old));
end $$;

-- 加える（グループ・案件。参加者か GM・CEO。history：これまでの会話を見せるか）
create or replace function public.chat_add(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; v text; v_hist boolean; n integer := 0; v_cnt integer; r public.wr_requests;
 mm public.chat_members; v_from bigint; a2 jsonb;
begin
 select * into t from public.chat_threads x where x.id::text = lower(coalesce(p->>'thread', ''));
 if not found then raise exception 'not_found'; end if;
 -- 案件のチャットは、申請を見られる GM・CEO なら参加者でなくても加えられる（4A）
 if public.chat_member_of(a, t) is null then
  if t.kind = 'case' and public.chat_is_gm(a) then
   select * into r from public.wr_requests x where x.id = t.ref_id;
   if not found or not public.wr_visible(a, r) then raise exception 'not_found'; end if;
  else raise exception 'not_found'; end if;
 end if;
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'history') <> 'boolean' then raise exception 'bad_value'; end if;
 v_hist := (p->>'history')::boolean;
 if jsonb_typeof(p->'members') <> 'array' or jsonb_array_length(p->'members') < 1 or jsonb_array_length(p->'members') > 49 then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 for v in select jsonb_array_elements_text(p->'members') loop
  if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
  -- 読める範囲（v1156 の直し・Codex #150 P2-1）：新しく加える人・外された／抜けた人を加え直すときは、いま選んだ範囲（見せない＝次の番号から）。
  -- 前の範囲と小さいほうを取らない（抜けていたあいだの会話を読ませない）。いま読めている人（自動で入っていて申請を見られる）は今のまま
  v_from := case when v_hist then 1 else t.last_seq + 1 end;
  select * into mm from public.chat_members x where x.thread_id = t.id and x.emp_id = v for update;
  if not found then
   insert into public.chat_members(thread_id, emp_id, added_by, history_from) values (t.id, v, a->>'emp', v_from);
   n := n + 1;
  elsif mm.left_at is not null then
   update public.chat_members set left_at = null, auto = false, added_by = a->>'emp', added_at = now(), history_from = v_from
    where thread_id = t.id and emp_id = v;
   n := n + 1;
  elsif mm.auto then
   -- 自動で入っている人を、加えた人にする（申請を見られなくなっても残る）。申請を見られなくなっていた（読めていなかった）なら、いま選んだ範囲
   a2 := public.chat_actor_of(v);
   if t.kind = 'case' then select * into r from public.wr_requests x where x.id = t.ref_id; end if;
   if not (t.kind = 'case' and a2 is not null and r.id is not null and public.wr_visible(a2, r)) then mm.history_from := v_from; end if;
   update public.chat_members set auto = false, added_by = a->>'emp', added_at = now(), history_from = mm.history_from
    where thread_id = t.id and emp_id = v;
   n := n + 1;
  end if;
 end loop;
 select count(*) into v_cnt from public.chat_members x where x.thread_id = t.id and x.left_at is null;
 if v_cnt > 50 then raise exception 'too_many'; end if;
 if n > 0 then perform public.chat_bump(t.id); end if;
 return jsonb_build_object('added', n, 'members', v_cnt);
end $$;

-- 外す（グループ・案件：作った人か GM・CEO）／抜ける（グループ：本人）
create or replace function public.chat_remove(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); v text := p->>'emp'; n integer;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if v is null or v = '' then raise exception 'bad_value'; end if;
 if v = a->>'emp' then
  if t.kind <> 'group' then raise exception 'forbidden'; end if;   -- 案件から自分で抜けることはしない（決める人が知らずに外れないように）
 elsif not (t.created_by = a->>'emp' or public.chat_is_gm(a)) then raise exception 'forbidden';
 end if;
 update public.chat_members set left_at = now(), auto = false where thread_id = t.id and emp_id = v and left_at is null;
 get diagnostics n = row_count;
 if n > 0 then perform public.chat_bump(t.id); perform public.chat_bump_me(t.id, v); end if;
 return jsonb_build_object('removed', n);
end $$;

-- グループの名前（参加者・版を確かめる）
create or replace function public.chat_rename(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread');
 v_title text := btrim(regexp_replace(coalesce(p->>'title', ''), '[\u0001-\u001f\u007f]', '', 'g'));
begin
 if t.kind <> 'group' then raise exception 'forbidden'; end if;
 if v_title = '' or length(v_title) > 60 then raise exception 'bad_value'; end if;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = t.rev) then raise exception 'conflict'; end if;
 update public.chat_threads set title = v_title, rev = rev + 1 where id = t.id returning * into t;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- SQL の段（アプリ・関数が見分ける）
create or replace function public.chat_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('chat', 1) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'chat\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;
