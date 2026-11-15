-- v1168：チャットの守り（UI案79 の答え 1〜6 A の残り・Moto さん 11/14 14:11 HST「次お願いします」）。仕様：docs/CHAT_GUARD_V1168_JA.md
-- 先にチャット（20261121090000）・添付（20261124090000）・UI案79（20261127090000）を流してから。2 回流しても同じ。
--
-- ・個人のチャット暗証番号（ログインの PIN とは別・本人が決める・初めはオフ）：決めた人は、暗証番号を入れて開いた「開けた印」（この端末のタブのメモリだけ）が無いと、
--   一覧・会話・画像・ファイル・合図（Realtime）・@ の一覧を受け取れない（数だけは出す）。値は PIN そのものでなく PBKDF2 の印（関数 work-requests が作る）。
-- ・グループのキー（グループ・申請のチャット・管理する人が決める）：キーを入れて開けた印が無いと、その会話の本文・画像・ファイル・送る・加えるなどはできない（一覧には名前と数だけ）。
--   参加者でなければ、キーを知っていても入れない（先に参加者かを確かめる）。両方あれば両方。キーを変えたら、前に開けた印は使えない（もう一度入れる）。
-- ・続けて 5 回間違えると止める（15 分・30 分・1 時間…最大 24 時間）。暗証番号を忘れたらログインの PIN で本人を確かめて外す。キーを忘れたら管理する人が決め直す。
-- ・開けた印（chat_sess）は印そのものでなく sha256 を置く。12 時間・2 時間使わなければ使えない。ロックで暗証番号の分を、ログアウトで全部を消す。
-- ・プッシュ通知：送る先（endpoint）だけを置く（中身は送らない・「新着メッセージがあります」だけ。送り元の名前・会話の名前・本文・画像は送らない）。
-- 表はどれも公開の鍵で読めない・書けない。関数はサーバーの鍵だけ。

do $$ begin
 if to_regprocedure('public.chat_case_create(jsonb)') is null or to_regprocedure('public.chat_admin(jsonb)') is null
    or to_regprocedure('public.chat_files_count(uuid)') is null then
  raise exception 'STOP: 先にチャット（deploy/chat-v1156）・添付（deploy/chat-files-v1161）・チャット改修（deploy/chat-ui79-v1167）の SQL を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
create table if not exists public.chat_guard (
  emp_id text primary key,
  pin_hash text check (pin_hash is null or pin_hash ~ '^[0-9a-f]{64}$'),
  pin_salt text check (pin_salt is null or pin_salt ~ '^[0-9a-f]{32}$'),
  pin_iter integer check (pin_iter is null or pin_iter between 100000 and 2000000),
  pin_set_at timestamptz,
  fails integer not null default 0,
  locked_until timestamptz,
  rev integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_sess (
  id uuid primary key default gen_random_uuid(),
  tok_hash text not null unique check (tok_hash ~ '^[0-9a-f]{64}$'),
  emp_id text not null,
  pin_at timestamptz,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index if not exists chat_sess_emp_idx on public.chat_sess(emp_id);

create table if not exists public.chat_sess_keys (
  sess_id uuid not null references public.chat_sess(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  key_rev integer not null,
  at timestamptz not null default now(),
  primary key (sess_id, thread_id)
);

create table if not exists public.chat_key_fails (
  emp_id text not null,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  fails integer not null default 0,
  locked_until timestamptz,
  primary key (emp_id, thread_id)
);

alter table public.chat_threads add column if not exists key_hash text;
alter table public.chat_threads add column if not exists key_salt text;
alter table public.chat_threads add column if not exists key_iter integer;
alter table public.chat_threads add column if not exists key_rev integer not null default 0;
alter table public.chat_threads add column if not exists key_at timestamptz;
alter table public.chat_threads add column if not exists key_by text;

create table if not exists public.chat_push_subs (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  emp_id text not null,
  created_at timestamptz not null default now(),
  last_push_at timestamptz,
  last_ok_at timestamptz,
  fails integer not null default 0
);
create index if not exists chat_push_subs_emp_idx on public.chat_push_subs(emp_id);

alter table public.chat_guard enable row level security;
alter table public.chat_sess enable row level security;
alter table public.chat_sess_keys enable row level security;
alter table public.chat_key_fails enable row level security;
alter table public.chat_push_subs enable row level security;
revoke all on public.chat_guard, public.chat_sess, public.chat_sess_keys, public.chat_key_fails, public.chat_push_subs from public, anon, authenticated;
grant select, insert, update, delete on public.chat_guard, public.chat_sess, public.chat_sess_keys, public.chat_key_fails, public.chat_push_subs to service_role;

-- ---------------------------------------------------------------- 開けた印
create or replace function public.chat_tok_hash(p_tok text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$ select encode(sha256(convert_to(p_tok, 'UTF8')), 'hex') $$;

-- この頼みの開けた印（12 時間・2 時間使わなければ使えない）。無い・違う人の・形が違えば null
create or replace function public.chat_sess_find(p jsonb, p_emp text) returns public.chat_sess
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text := p->>'unlock'; s public.chat_sess;
begin
 if v is null or v !~ '^[0-9a-f]{64}$' or p_emp is null then return null; end if;
 select * into s from public.chat_sess x where x.tok_hash = public.chat_tok_hash(v) and x.emp_id = p_emp
   and x.expires_at > now() and x.seen_at > now() - interval '2 hours';
 if not found then return null; end if;
 return s;
end $$;

-- 開けた印を使う（あれば今の時刻に・無ければ作って印そのものを 1 回だけ返す）。古いもの・多すぎるもの（1 人 20）は片づける
create or replace function public.chat_sess_open(p jsonb, p_emp text) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare s public.chat_sess := public.chat_sess_find(p, p_emp); v text;
begin
 if s.id is not null then
  update public.chat_sess set seen_at = now() where id = s.id;
  return jsonb_build_object('id', s.id);
 end if;
 v := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
 insert into public.chat_sess(tok_hash, emp_id) values (public.chat_tok_hash(v), p_emp) returning * into s;
 delete from public.chat_sess x where x.emp_id = p_emp and (x.expires_at <= now() or x.seen_at <= now() - interval '2 hours');
 delete from public.chat_sess x where x.emp_id = p_emp and x.id in (
   select y.id from public.chat_sess y where y.emp_id = p_emp order by y.seen_at desc offset 20);
 return jsonb_build_object('id', s.id, 'token', v);
end $$;

-- 続けて間違えたときに止める長さ（5 回ごと：15 分・30 分・1 時間… 24 時間まで）
create or replace function public.chat_backoff(n integer) returns interval
language sql immutable security invoker set search_path = public, pg_temp as $$
 select least(interval '24 hours', interval '15 minutes' * power(2, greatest(0, n / 5 - 1))::int);
$$;

-- 呼んだ人と守りの様子（止めない）：sess＝開けた印・pin＝暗証番号を決めている・pin_ok＝開けている（決めていなければ true）
create or replace function public.chat_gate_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); g public.chat_guard; s public.chat_sess; v_pin boolean := false; v_ok boolean;
begin
 select * into g from public.chat_guard x where x.emp_id = a->>'emp';
 v_pin := found and g.pin_hash is not null;
 s := public.chat_sess_find(p, a->>'emp');
 v_ok := (not v_pin) or (s.id is not null and s.pin_at is not null and s.pin_at >= g.pin_set_at);
 return a || jsonb_build_object('sess', s.id, 'pin', v_pin, 'pin_ok', v_ok);
end $$;

-- チャットの呼んだ人：暗証番号を決めていて開けていなければ止める（chat_pin_required）。チャットの関数はどれもここを通る
create or replace function public.chat_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_gate_actor(p);
begin
 if not coalesce((a->>'pin_ok')::boolean, false) then raise exception 'chat_pin_required'; end if;
 return a;
end $$;

-- この会話のキーを開けているか（キーが無ければ true）
create or replace function public.chat_key_ok(a jsonb, t public.chat_threads) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select t.key_hash is null or (nullif(a->>'sess', '') is not null and exists (select 1 from public.chat_sess_keys k
   where k.sess_id = (a->>'sess')::uuid and k.thread_id = t.id and k.key_rev = t.key_rev));
$$;

-- 参加者か（キーは見ない）。前の chat_find と同じ
create or replace function public.chat_find_nokey(a jsonb, p_id text) returns public.chat_threads
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare t public.chat_threads;
begin
 if p_id is null or p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = p_id::uuid;
 if not found or public.chat_member_of(a, t) is null then raise exception 'not_found'; end if;
 return t;
end $$;

-- 参加者で、キーがあれば開けている（開けていなければ chat_key_required）。会話の中身・送る・加えるなどはどれもここを通る
create or replace function public.chat_find(a jsonb, p_id text) returns public.chat_threads
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare t public.chat_threads := public.chat_find_nokey(a, p_id);
begin
 if not public.chat_key_ok(a, t) then raise exception 'chat_key_required'; end if;
 return t;
end $$;

-- メッセージから会話を見つける（直す・消す・見えなくする）：参加者・読める範囲・キー
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
 if not public.chat_key_ok(a, t) then raise exception 'chat_key_required'; end if;
 return x;
end $$;

-- ---------------------------------------------------------------- 一覧の 1 行（キーを開けていなければ、名前と数だけ。最後のメッセージの中身・送った人は出さない）
create or replace function public.chat_row(a jsonb, t public.chat_threads, m public.chat_members) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare lm public.chat_messages; v_unread integer; v_ment integer; v_n integer; v_prev text; r public.wr_requests; v_ref jsonb := null; v_other text; v_vis boolean := false;
 v_kok boolean := public.chat_key_ok(a, t);
begin
 select * into lm from public.chat_messages x where x.thread_id = t.id and x.seq >= m.history_from order by x.seq desc limit 1;
 select count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null),
        count(*) filter (where x.author_emp <> a->>'emp' and x.deleted_at is null and x.hidden_at is null and x.mentions @> array[a->>'emp'])
   into v_unread, v_ment
   from public.chat_messages x where x.thread_id = t.id and x.seq > greatest(m.last_read, m.history_from - 1);
 select count(*) into v_n from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto;
 if lm.id is not null then
  v_prev := case when lm.deleted_at is not null then '（削除されました）' when lm.hidden_at is not null then '（見えなくなりました）'
                 when coalesce(lm.body, '') = '' then public.chat_files_label(lm.id)
                 else left(regexp_replace(lm.body, '\s+', ' ', 'g'), 80) end;
 end if;
 if t.kind = 'case' then
  select * into r from public.wr_requests x where x.id = t.ref_id;
  if found then
   begin v_vis := public.wr_visible(a, r); exception when others then v_vis := false; end;
   if v_vis then v_ref := jsonb_build_object('kind', 'wr', 'id', r.id, 'code', r.code, 'wr_kind', r.kind, 'status', r.status, 'store_id', r.store_id,
     'rev', r.rev, 'mine', r.requester_emp is not distinct from a->>'emp'); end if;
  end if;
 end if;
 if t.kind = 'dm' then select x.emp_id into v_other from public.chat_members x where x.thread_id = t.id and x.emp_id <> a->>'emp' limit 1; end if;
 return jsonb_build_object('id', t.id, 'kind', t.kind, 'title', public.chat_title(a, t), 'other', v_other, 'ref', v_ref, 'members', v_n,
  'created_by', t.created_by, 'created_name', t.created_name, 'rev', t.rev, 'admin', coalesce(m.admin, false),
  'keyed', t.key_hash is not null, 'key_ok', v_kok, 'key_rev', t.key_rev,
  'last_seq', t.last_seq, 'last_at', t.last_at, 'last_read', m.last_read, 'history_from', m.history_from,
  'preview', case when lm.id is null then null when not v_kok then jsonb_build_object('seq', lm.seq, 'at', lm.created_at, 'locked', true)
    else jsonb_strip_nulls(jsonb_build_object('seq', lm.seq, 'name', lm.author_name, 'emp', lm.author_emp, 'text', v_prev, 'at', lm.created_at,
    'state', case when lm.deleted_at is not null then 'deleted' when lm.hidden_at is not null then 'hidden' end,
    'files', case when lm.deleted_at is null and lm.hidden_at is null and coalesce(lm.body, '') = '' then public.chat_files_count(lm.id) end)) end,
  'unread', v_unread, 'mention', v_ment, 'chg', greatest(t.chg, m.chg));
end $$;

-- ---------------------------------------------------------------- 読む：暗証番号を開けていなければ、数だけ（一覧・合図の印は出さない）
create or replace function public.chat_sync(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_gate_actor(p); v_since bigint := 0; v_lim integer := 200; o jsonb := '[]'::jsonb; c record; v_max bigint := 0;
 v_unread integer := 0; v_ment integer := 0; v_more boolean := false; v_n integer := 0; v_gone jsonb := '[]'::jsonb; v_pin_ok boolean := (a->>'pin_ok')::boolean;
begin
 if jsonb_typeof(p->'since') = 'number' then v_since := greatest(0, (p->>'since')::bigint); end if;
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(500, greatest(1, (p->>'limit')::int)); end if;
 if nullif(a->>'sess', '') is not null then update public.chat_sess set seen_at = now() where id = (a->>'sess')::uuid and seen_at < now() - interval '1 minute'; end if;
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
 if not v_pin_ok then
  return jsonb_build_object('guard', jsonb_build_object('pin', true, 'unlocked', false), 'threads', '[]'::jsonb, 'gone', '[]'::jsonb, 'cursor', v_since,
   'more', false, 'unread', v_unread, 'mention', v_ment, 'me', a->>'emp', 'role', a->>'role', 'limits', public.chat_limits());
 end if;
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
 return jsonb_build_object('guard', jsonb_build_object('pin', (a->>'pin')::boolean, 'unlocked', true), 'threads', o, 'gone', v_gone, 'cursor', greatest(v_since, v_max),
  'more', v_more, 'unread', v_unread, 'mention', v_ment, 'token', public.chat_token(a->>'emp'), 'me', a->>'emp', 'role', a->>'role', 'limits', public.chat_limits());
end $$;

-- 自分宛ての @ の一覧（読める会話・キーを開けている会話だけ）
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
  if m.thread_id is null or c.seq < m.history_from or not public.chat_key_ok(a, t) then continue; end if;
  o := o || (public.chat_msg(a, t, c) || jsonb_build_object('thread', t.id, 'thread_title', public.chat_title(a, t), 'thread_kind', t.kind, 'unread', c.seq > m.last_read));
  exit when jsonb_array_length(o) >= v_lim;
 end loop;
 return jsonb_build_object('items', o);
end $$;

-- 開く（ファイル）：キーを開けていない会話のファイルは答えに入れない
create or replace function public.chat_files_access(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_thumb boolean := coalesce(p->'thumb' = 'true'::jsonb, false); o jsonb := '[]'::jsonb; v text;
 f public.chat_files; x public.chat_messages; t public.chat_threads; m public.chat_members; v_kok boolean := false;
begin
 if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') < 1 or jsonb_array_length(p->'ids') > 30 then raise exception 'bad_value'; end if;
 for v in select jsonb_array_elements_text(p->'ids') loop
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  select * into f from public.chat_files y where y.id = v::uuid and y.status = 'sent' and y.message_id is not null;
  continue when not found;
  select * into x from public.chat_messages y where y.id = f.message_id;
  continue when not found or x.deleted_at is not null or x.hidden_at is not null;
  if t.id is distinct from x.thread_id then
   select * into t from public.chat_threads y where y.id = x.thread_id;
   m := public.chat_member_of(a, t);
   v_kok := m.thread_id is not null and public.chat_key_ok(a, t);
  end if;
  continue when m.thread_id is null or x.seq < m.history_from or not v_kok;
  o := o || jsonb_build_object('id', f.id, 'path', case when v_thumb and f.thumb then f.path || '.t' else f.path end, 'name', f.name, 'mime', f.mime, 'kind', f.kind);
 end loop;
 return jsonb_build_object('files', o);
end $$;

-- 外す（管理する人）／抜ける（本人）。抜けるのはキーを開けていなくてもできる（キーを忘れても抜けられる）
create or replace function public.chat_remove(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; me public.chat_members; v text := p->>'emp'; n integer;
begin
 if v is null or v = '' or length(v) > 64 then raise exception 'bad_value'; end if;
 if v = a->>'emp' then t := public.chat_find_nokey(a, p->>'thread'); else t := public.chat_find(a, p->>'thread'); end if;
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 me := public.chat_member_of(a, t);
 if v <> a->>'emp' and not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 update public.chat_members set left_at = now(), auto = false, admin = false where thread_id = t.id and emp_id = v and left_at is null;
 get diagnostics n = row_count;
 if n > 0 then
  delete from public.chat_key_fails k where k.emp_id = v and k.thread_id = t.id;
  delete from public.chat_sess_keys k where k.thread_id = t.id and k.sess_id in (select s.id from public.chat_sess s where s.emp_id = v);
  perform public.chat_admin_fix(t.id); perform public.chat_bump(t.id); perform public.chat_bump_me(t.id, v);
 end if;
 return jsonb_build_object('removed', n);
end $$;

-- 8B（申請のチャットのファイルを領収書に）：暗証番号とキーも確かめる（前はチャットの参加者だけを見ていた）
create or replace function public.wr_receipt_from_chat(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); r public.wr_requests; f public.chat_files; x public.chat_messages; t public.chat_threads; m public.chat_members;
 v_key text := p->>'client_key'; v_rid uuid; v_ract text; v_now timestamptz := now(); v_ver integer; v_pl jsonb; v_note text; ag jsonb;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests y where y.id = v_rid;
  if not public.wr_visible(a, r) or v_ract is distinct from 'receipt_chat'
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 ag := public.chat_actor(p);   -- 暗証番号を決めていれば開けていること
 r := public.wr_find(a, p);
 select * into r from public.wr_requests y where y.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 if r.kind <> 'reimburse' or r.legacy or r.status not in ('pending','returned') or r.requester_emp is distinct from a->>'emp' then raise exception 'forbidden'; end if;
 if not public.wr_live() then raise exception 'not_live'; end if;
 if coalesce(p->>'file', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 select * into f from public.chat_files y where y.id = (p->>'file')::uuid for update;
 if not found or f.status <> 'sent' or f.message_id is null then raise exception 'not_found'; end if;
 if f.kind not in ('photo','pdf') then raise exception 'file_type'; end if;
 select * into x from public.chat_messages y where y.id = f.message_id;
 if not found or x.deleted_at is not null or x.hidden_at is not null then raise exception 'not_found'; end if;
 select * into t from public.chat_threads y where y.id = f.thread_id;
 if t.kind <> 'case' or t.ref_id is distinct from r.id then raise exception 'not_found'; end if;
 m := public.chat_member_of(a, t);
 if m.thread_id is null or x.seq < m.history_from then raise exception 'not_found'; end if;
 if not public.chat_key_ok(ag, t) then raise exception 'chat_key_required'; end if;
 if f.wr_id is not null and f.wr_id <> r.id then raise exception 'conflict'; end if;
 update public.chat_files set wr_id = r.id where id = f.id;
 v_pl := r.payload || jsonb_build_object('receipt', jsonb_build_object('chat_file', f.id::text, 'name', f.name, 'kind', f.kind));
 v_ver := r.version + 1;
 v_note := 'チャットの' || case when f.kind = 'photo' then '写真' else 'PDF' end || 'を領収書にした（' || coalesce(f.name, '') || '）';
 update public.wr_requests set payload = v_pl, version = v_ver, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at, note)
  values (r.id, v_ver, v_pl, r.amount_cents, r.use_date, a->>'emp', a->>'name', v_now, v_note);
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, 'receipt_chat', r.status, r.status, v_ver, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 perform public.chat_bump(t.id);
 return public.wr_row(a, r);
end $$;

-- ---------------------------------------------------------------- 個人のチャット暗証番号（関数 work-requests だけが使う。印は関数が PBKDF2 で作る）
-- 様子：決めているか・開けているか・止まっている秒
create or replace function public.chat_guard_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_gate_actor(p); g public.chat_guard;
begin
 select * into g from public.chat_guard x where x.emp_id = a->>'emp';
 return jsonb_build_object('pin', (a->>'pin')::boolean, 'unlocked', (a->>'pin_ok')::boolean, 'sess', nullif(a->>'sess', '') is not null,
  'locked', case when g.locked_until > now() then ceil(extract(epoch from g.locked_until - now()))::int else 0 end,
  'left', case when g.pin_hash is null then 5 else 5 - (g.fails % 5) end);
end $$;

-- 確かめ始め：回数を先に数える（同時に何回送っても 5 回で止まる）。決めていなければ none・止まっていれば locked（秒）
create or replace function public.chat_pin_begin(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); g public.chat_guard;
begin
 select * into g from public.chat_guard x where x.emp_id = a->>'emp' for update;
 if not found or g.pin_hash is null then return jsonb_build_object('none', true); end if;
 if g.locked_until is not null and g.locked_until > now() then
  return jsonb_build_object('locked', ceil(extract(epoch from g.locked_until - now()))::int);
 end if;
 update public.chat_guard set fails = fails + 1,
   locked_until = case when (fails + 1) % 5 = 0 then now() + public.chat_backoff(fails + 1) else locked_until end
  where emp_id = g.emp_id returning * into g;
 return jsonb_build_object('hash', g.pin_hash, 'salt', g.pin_salt, 'iter', g.pin_iter, 'rev', g.rev, 'fails', g.fails);
end $$;

-- 確かめた結果：合えば回数を戻し、開けた印に暗証番号の分を付ける（印が無ければ作って返す）。違えば残りの回数か止まった秒
create or replace function public.chat_pin_end(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); g public.chat_guard; s jsonb;
begin
 if coalesce(jsonb_typeof(p->'ok'), '') <> 'boolean' or coalesce(jsonb_typeof(p->'rev'), '') <> 'number' then raise exception 'bad_value'; end if;
 select * into g from public.chat_guard x where x.emp_id = a->>'emp' for update;
 if not found or g.pin_hash is null then return jsonb_build_object('ok', false, 'none', true); end if;
 if (p->>'ok')::boolean and g.rev = (p->>'rev')::int then
  update public.chat_guard set fails = 0, locked_until = null where emp_id = g.emp_id;
  s := public.chat_sess_open(p, a->>'emp');
  update public.chat_sess set pin_at = now(), seen_at = now() where id = (s->>'id')::uuid;
  return jsonb_build_object('ok', true) || case when s ? 'token' then jsonb_build_object('unlock', s->>'token') else '{}'::jsonb end;
 end if;
 return jsonb_build_object('ok', false, 'conflict', g.rev <> (p->>'rev')::int,
  'left', case when g.locked_until > now() then 0 else 5 - (g.fails % 5) end,
  'locked', case when g.locked_until > now() then ceil(extract(epoch from g.locked_until - now()))::int else 0 end);
end $$;

-- 決める・変える・外す。mode：set（まだ決めていないときだけ）・change／clear（関数が今の暗証番号を確かめた rev のときだけ）・reset（関数がログインの PIN で本人を確かめた）
-- 決めた・変えたら、ほかの端末の開けた印は暗証番号の分が使えなくなる（この頼みの印は開けたまま）
create or replace function public.chat_pin_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); g public.chat_guard; v_mode text := p->>'mode'; s jsonb; v_now timestamptz := now();
begin
 if coalesce(v_mode, '') not in ('set','change','clear','reset') then raise exception 'bad_value'; end if;
 if v_mode in ('set','change') then
  if coalesce(p->>'hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'salt', '') !~ '^[0-9a-f]{32}$'
     or coalesce(jsonb_typeof(p->'iter'), '') <> 'number' or (p->>'iter')::int not between 100000 and 2000000 then raise exception 'bad_value'; end if;
 end if;
 insert into public.chat_guard(emp_id) values (a->>'emp') on conflict (emp_id) do nothing;
 select * into g from public.chat_guard x where x.emp_id = a->>'emp' for update;
 if v_mode = 'set' and g.pin_hash is not null then raise exception 'conflict'; end if;
 if v_mode in ('change','clear') and (g.pin_hash is null or coalesce(jsonb_typeof(p->'rev'), '') <> 'number' or g.rev <> (p->>'rev')::int) then raise exception 'conflict'; end if;
 if v_mode in ('set','change') then
  update public.chat_guard set pin_hash = p->>'hash', pin_salt = p->>'salt', pin_iter = (p->>'iter')::int, pin_set_at = v_now,
    fails = 0, locked_until = null, rev = rev + 1, updated_at = v_now where emp_id = g.emp_id returning * into g;
  update public.chat_sess set pin_at = null where emp_id = g.emp_id;
  s := public.chat_sess_open(p, a->>'emp');
  update public.chat_sess set pin_at = v_now where id = (s->>'id')::uuid;
  return jsonb_build_object('pin', true, 'rev', g.rev) || case when s ? 'token' then jsonb_build_object('unlock', s->>'token') else '{}'::jsonb end;
 end if;
 update public.chat_guard set pin_hash = null, pin_salt = null, pin_iter = null, pin_set_at = null,
   fails = 0, locked_until = null, rev = rev + 1, updated_at = v_now where emp_id = g.emp_id returning * into g;
 return jsonb_build_object('pin', false, 'rev', g.rev);
end $$;

-- ロック（mode pin：この端末の印の暗証番号の分だけ消す）・ログアウト（all：この端末の印を消す＝キーの分も）
create or replace function public.chat_relock(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v text := p->>'unlock'; n integer := 0;
begin
 if coalesce(p->>'mode', '') not in ('pin','all') then raise exception 'bad_value'; end if;
 if v is null or v !~ '^[0-9a-f]{64}$' then return jsonb_build_object('done', 0); end if;
 if p->>'mode' = 'all' then
  delete from public.chat_sess x where x.tok_hash = public.chat_tok_hash(v) and x.emp_id = a->>'emp';
 else
  update public.chat_sess x set pin_at = null where x.tok_hash = public.chat_tok_hash(v) and x.emp_id = a->>'emp';
 end if;
 get diagnostics n = row_count;
 return jsonb_build_object('done', n);
end $$;

-- ---------------------------------------------------------------- グループのキー（グループ・申請のチャット）
-- 確かめ始め：参加者でなければ not_found（キーを知っていても入れない）。暗証番号を決めていれば、先に開けていること（chat_actor）。回数は先に数える
create or replace function public.chat_key_begin(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find_nokey(a, p->>'thread'); k public.chat_key_fails;
begin
 if t.key_hash is null then return jsonb_build_object('none', true); end if;
 insert into public.chat_key_fails(emp_id, thread_id) values (a->>'emp', t.id) on conflict do nothing;
 select * into k from public.chat_key_fails x where x.emp_id = a->>'emp' and x.thread_id = t.id for update;
 if k.locked_until is not null and k.locked_until > now() then
  return jsonb_build_object('locked', ceil(extract(epoch from k.locked_until - now()))::int);
 end if;
 update public.chat_key_fails set fails = fails + 1,
   locked_until = case when (fails + 1) % 5 = 0 then now() + public.chat_backoff(fails + 1) else locked_until end
  where emp_id = k.emp_id and thread_id = k.thread_id returning * into k;
 return jsonb_build_object('hash', t.key_hash, 'salt', t.key_salt, 'iter', t.key_iter, 'rev', t.key_rev, 'fails', k.fails);
end $$;

create or replace function public.chat_key_end(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find_nokey(a, p->>'thread'); k public.chat_key_fails; s jsonb;
begin
 if coalesce(jsonb_typeof(p->'ok'), '') <> 'boolean' or coalesce(jsonb_typeof(p->'rev'), '') <> 'number' then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 select * into k from public.chat_key_fails x where x.emp_id = a->>'emp' and x.thread_id = t.id for update;
 if t.key_hash is null then return jsonb_build_object('ok', false, 'none', true); end if;
 if (p->>'ok')::boolean and t.key_rev = (p->>'rev')::int then
  update public.chat_key_fails set fails = 0, locked_until = null where emp_id = a->>'emp' and thread_id = t.id;
  s := public.chat_sess_open(p, a->>'emp');
  insert into public.chat_sess_keys(sess_id, thread_id, key_rev) values ((s->>'id')::uuid, t.id, t.key_rev)
   on conflict (sess_id, thread_id) do update set key_rev = excluded.key_rev, at = now();
  return jsonb_build_object('ok', true, 'thread', t.id, 'key_rev', t.key_rev) || case when s ? 'token' then jsonb_build_object('unlock', s->>'token') else '{}'::jsonb end;
 end if;
 return jsonb_build_object('ok', false, 'conflict', t.key_rev <> (p->>'rev')::int,
  'left', case when k.locked_until > now() then 0 else 5 - (coalesce(k.fails, 0) % 5) end,
  'locked', case when k.locked_until > now() then ceil(extract(epoch from k.locked_until - now()))::int else 0 end);
end $$;

-- 決める・変える・外す（その会話の管理する人。キーを忘れても決め直せる）。前に開けた印は使えなくなる（番号 key_rev を進める）。決めた人の印はそのまま開けておく
create or replace function public.chat_key_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find_nokey(a, p->>'thread'); me public.chat_members; s jsonb; v_clear boolean;
begin
 if t.kind not in ('group','case') then raise exception 'forbidden'; end if;
 me := public.chat_member_of(a, t);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 if coalesce(jsonb_typeof(p->'clear'), '') <> 'boolean' then raise exception 'bad_value'; end if;
 v_clear := (p->>'clear')::boolean;
 if not v_clear and (coalesce(p->>'hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'salt', '') !~ '^[0-9a-f]{32}$'
     or coalesce(jsonb_typeof(p->'iter'), '') <> 'number' or (p->>'iter')::int not between 100000 and 2000000) then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 if jsonb_typeof(p->'expect') = 'number' and (p->>'expect')::int <> t.key_rev then raise exception 'conflict'; end if;
 if v_clear and t.key_hash is null then return jsonb_build_object('keyed', false, 'key_rev', t.key_rev); end if;
 update public.chat_threads set key_hash = case when v_clear then null else p->>'hash' end, key_salt = case when v_clear then null else p->>'salt' end,
   key_iter = case when v_clear then null else (p->>'iter')::int end, key_rev = key_rev + 1, key_at = now(), key_by = a->>'emp'
  where id = t.id returning * into t;
 delete from public.chat_sess_keys k where k.thread_id = t.id;
 delete from public.chat_key_fails k where k.thread_id = t.id;
 if not v_clear then
  s := public.chat_sess_open(p, a->>'emp');
  insert into public.chat_sess_keys(sess_id, thread_id, key_rev) values ((s->>'id')::uuid, t.id, t.key_rev);
 end if;
 perform public.chat_bump(t.id);
 return jsonb_build_object('keyed', not v_clear, 'key_rev', t.key_rev) || case when s ? 'token' then jsonb_build_object('unlock', s->>'token') else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------- プッシュ通知（送る先だけ。中身は送らない）
-- 送る先の形（関数 work-requests も同じ決まりで確かめる）：ブラウザの送り先のサーバーだけ
create or replace function public.chat_push_host_ok(p_endpoint text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_endpoint, '') ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/\S+$' and length(p_endpoint) <= 1000;
$$;

-- 受け取る（この端末）：同じ送る先は最後に決めた人のもの（ほかの人のものなら付け替える）。1 人 10 まで
create or replace function public.chat_push_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v text := p->>'endpoint';
begin
 if not public.chat_push_host_ok(v) then raise exception 'bad_value'; end if;
 insert into public.chat_push_subs(endpoint, emp_id) values (v, a->>'emp')
  on conflict (endpoint) do update set emp_id = excluded.emp_id, created_at = now(), fails = 0, last_push_at = null;
 delete from public.chat_push_subs x where x.emp_id = a->>'emp' and x.id in (
   select y.id from public.chat_push_subs y where y.emp_id = a->>'emp' order by y.created_at desc offset 10);
 return jsonb_build_object('on', true);
end $$;

-- やめる（この端末・ログアウト）：自分の送る先だけ消す。ロック中でもできる
create or replace function public.chat_push_drop(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); n integer;
begin
 if coalesce(p->>'endpoint', '') = '' or length(p->>'endpoint') > 1000 then raise exception 'bad_value'; end if;
 delete from public.chat_push_subs x where x.endpoint = p->>'endpoint' and x.emp_id = a->>'emp';
 get diagnostics n = row_count;
 return jsonb_build_object('on', false, 'removed', n);
end $$;

-- この端末の送る先がだれのものか：自分のもの＝on。ほかの人のもの（前の人がログアウトし損ねた）は消す（この人の分にはしない）
create or replace function public.chat_push_check(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.chat_push_subs;
begin
 if coalesce(p->>'endpoint', '') = '' or length(p->>'endpoint') > 1000 then raise exception 'bad_value'; end if;
 select * into s from public.chat_push_subs x where x.endpoint = p->>'endpoint';
 if not found then return jsonb_build_object('on', false); end if;
 if s.emp_id <> a->>'emp' then delete from public.chat_push_subs x where x.id = s.id; return jsonb_build_object('on', false, 'cleared', true); end if;
 return jsonb_build_object('on', true);
end $$;

-- 送る先（関数 work-requests だけ：送ったあと裏で）。その会話の今の参加者（送った人を除く）の送る先。同じ送る先へは 30 秒に 1 回まで
create or replace function public.chat_push_targets(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare o jsonb;
begin
 if coalesce(p->>'thread', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 with c as (
  select s.id from public.chat_push_subs s
   where s.emp_id in (select m.emp_id from public.chat_members m where m.thread_id = (p->>'thread')::uuid and m.left_at is null and not m.auto
                        and m.emp_id is distinct from p->>'emp_id')
     and (s.last_push_at is null or s.last_push_at < now() - interval '30 seconds')
   order by s.id limit 200 for update skip locked),
 u as (update public.chat_push_subs s set last_push_at = now() from c where s.id = c.id returning s.endpoint)
 select coalesce(jsonb_agg(u.endpoint), '[]'::jsonb) into o from u;
 return jsonb_build_object('endpoints', o);
end $$;

-- 送った結果（関数 work-requests だけ）：gone（もう無い）は消す・fail は 5 回で消す・ok は戻す
create or replace function public.chat_push_result(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if jsonb_typeof(p->'ok') = 'array' then
  update public.chat_push_subs s set fails = 0, last_ok_at = now() where s.endpoint in (select jsonb_array_elements_text(p->'ok'));
 end if;
 if jsonb_typeof(p->'gone') = 'array' then
  delete from public.chat_push_subs s where s.endpoint in (select jsonb_array_elements_text(p->'gone'));
 end if;
 if jsonb_typeof(p->'fail') = 'array' then
  update public.chat_push_subs s set fails = fails + 1 where s.endpoint in (select jsonb_array_elements_text(p->'fail'));
  delete from public.chat_push_subs s where s.fails >= 5;
 end if;
 return jsonb_build_object('done', true);
end $$;

-- SQL の段（アプリ・関数が見分ける）：4＝守り（暗証番号・キー・プッシュ通知）
create or replace function public.chat_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('chat', 4) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file')) loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
