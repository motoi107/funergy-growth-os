-- v1167：チャット改修（UI案79・Moto さん 11/14 09:29 HST の答え 1〜6 A・12:43 HST「次お願いします」）。仕様：docs/CHAT_UI79_V1167_JA.md
-- 先にチャット（20261121090000）と添付（20261124090000）を流してから。2 回流しても同じ。
--
-- 変わること（読める人は「参加者だけ」）
-- ・申請のチャット：前は申請した人・決める人・確かめる人が自動で入った（4A）。これからは、最初に開いた人が参加者を選んで作る
--   （関係する人を最初から選んだ状態で出し、外せる＝答え 2A）。同じ申請のチャットは 1 つ（同時に作っても 1 つ）。
--   申請を見られることで読めるようにはならない。加えられても申請そのものを見られるようにはならない（ref は申請を見られる人にだけ返す）。
-- ・GM・CEO：参加していない会話は見えない・加えられない（答え 3A：見えなくするのは参加している会話だけ）。
-- ・管理する人（admin）：グループ・申請のチャットで、人を加える・外す・名前を変える・管理する人を決める。作った人が最初の管理する人。
--   管理する人がいなくなったら、いちばん前から入っている人が管理する人になる。
-- ・前からある会話：自動で入っていた人（auto）は、いま申請を見られて読めている人だけ参加者に残す（読めなかった人は外す）＝だれも今より多くは読めない。
--   それでも auto のまま残った行（前の SQL を流し直したなど）は、確かめるまで読めない。
-- 表はどれも公開の鍵で読めない・書けない（前のまま）。関数はサーバーの鍵だけ。

-- v1169：この SQL より新しいチャットの SQL（段 3 より上）がもう入っていれば止める。流し直すと、あとの版で直した関数が前の形に戻り、
-- 暗証番号・キーの守りなどが外れるため（Codex #164 の P2）。何も変えずに止まる。この SQL を 2 回流すのは今までどおり大丈夫。
do $$ declare v integer := 0; begin
 if to_regprocedure('public.chat_stage(jsonb)') is not null then
  execute $q$select coalesce((public.chat_stage('{}'::jsonb)->>'chat')::int, 0)$q$ into v;
  if v > 3 then
   raise exception 'STOP: これより新しいチャットの SQL（段 %）が入っています。流し直すと守りが外れるので止めました（何も変えていません）。この SQL は流さなくて大丈夫です', v;
  end if;
 end if;
end $$;

do $$ begin
 if to_regprocedure('public.chat_stage(jsonb)') is null or to_regprocedure('public.chat_file_start(jsonb)') is null
    or to_regprocedure('public.chat_files_count(uuid)') is null then
  raise exception 'STOP: 先にチャット（deploy/chat-v1156）と添付（deploy/chat-files-v1161）の SQL を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
alter table public.chat_members add column if not exists admin boolean not null default false;

-- ---------------------------------------------------------------- 参加者か（参加者だけ。申請を見られるかでは決めない）
create or replace function public.chat_member_of(a jsonb, t public.chat_threads) returns public.chat_members
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare m public.chat_members;
begin
 select * into m from public.chat_members x where x.thread_id = t.id and x.emp_id = a->>'emp' and x.left_at is null;
 if not found then return null; end if;
 if m.auto then return null; end if;   -- 前の版の自動の参加者（確かめていない）は読めない
 return m;
end $$;

-- 前の版の「申請の担当を自動で入れる」は、もう何もしない（前の SQL を流し直しても自動では入らない）
create or replace function public.chat_case_sync(r public.wr_requests, t public.chat_threads) returns integer
language sql stable security invoker set search_path = public, pg_temp as $$ select 0 $$;

-- 管理する人がいなければ、いちばん前から入っている人を管理する人に（グループ・申請のチャット）
create or replace function public.chat_admin_fix(p_thread uuid) returns void
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v text;
begin
 if exists (select 1 from public.chat_members x where x.thread_id = p_thread and x.left_at is null and not x.auto and x.admin) then return; end if;
 if not exists (select 1 from public.chat_threads t where t.id = p_thread and t.kind in ('group','case')) then return; end if;
 select x.emp_id into v from public.chat_members x where x.thread_id = p_thread and x.left_at is null and not x.auto
  order by (x.emp_id = (select t.created_by from public.chat_threads t where t.id = p_thread)) desc, x.added_at, x.emp_id limit 1;
 if v is not null then update public.chat_members set admin = true where thread_id = p_thread and emp_id = v; end if;
end $$;

-- ---------------------------------------------------------------- 前からある会話を移す（何回流しても同じ）
do $$ declare c record; a jsonb; r public.wr_requests; v_ok boolean;
begin
 for c in select m.thread_id, m.emp_id, t.ref_id from public.chat_members m join public.chat_threads t on t.id = m.thread_id
           where m.auto and m.left_at is null loop
  v_ok := false;
  a := public.chat_actor_of(c.emp_id);
  r := null;
  if c.ref_id is not null then select * into r from public.wr_requests x where x.id = c.ref_id; end if;
  begin
   v_ok := a is not null and r.id is not null and public.wr_visible(a, r);
  exception when others then v_ok := false;
  end;
  if v_ok then
   update public.chat_members set auto = false where thread_id = c.thread_id and emp_id = c.emp_id;
  else
   update public.chat_members set auto = false, admin = false, left_at = now() where thread_id = c.thread_id and emp_id = c.emp_id;
   perform public.chat_bump_me(c.thread_id, c.emp_id);
  end if;
 end loop;
 update public.chat_members set auto = false where auto and left_at is not null;
 for c in select t.id from public.chat_threads t where t.kind in ('group','case') loop
  perform public.chat_admin_fix(c.id);
 end loop;
end $$;

-- ---------------------------------------------------------------- 一覧の 1 行（申請の中身＝ref は、その申請を見られる人にだけ）
create or replace function public.chat_row(a jsonb, t public.chat_threads, m public.chat_members) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare lm public.chat_messages; v_unread integer; v_ment integer; v_n integer; v_prev text; r public.wr_requests; v_ref jsonb := null; v_other text; v_vis boolean := false;
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
  'last_seq', t.last_seq, 'last_at', t.last_at, 'last_read', m.last_read, 'history_from', m.history_from,
  'preview', case when lm.id is null then null else jsonb_strip_nulls(jsonb_build_object('seq', lm.seq, 'name', lm.author_name, 'emp', lm.author_emp, 'text', v_prev, 'at', lm.created_at,
    'state', case when lm.deleted_at is not null then 'deleted' when lm.hidden_at is not null then 'hidden' end,
    'files', case when lm.deleted_at is null and lm.hidden_at is null and coalesce(lm.body, '') = '' then public.chat_files_count(lm.id) end)) end,
  'unread', v_unread, 'mention', v_ment, 'chg', greatest(t.chg, m.chg));
end $$;

-- ---------------------------------------------------------------- 会話のメッセージと参加者（管理する人の印・できること）
create or replace function public.chat_messages_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); m public.chat_members := public.chat_member_of(a, t);
 v_after bigint := null; v_before bigint := null; v_lim integer := 100; o jsonb; mem jsonb; v_older boolean; v_adm boolean := coalesce(m.admin, false) and t.kind <> 'dm';
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
 select coalesce(jsonb_agg(jsonb_build_object('emp', x.emp_id, 'name', public.chat_emp_name(x.emp_id), 'auto', false, 'admin', x.admin, 'last_read', x.last_read)
   order by x.admin desc, public.chat_emp_name(x.emp_id)), '[]'::jsonb) into mem
   from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto;
 return jsonb_build_object('thread', public.chat_row(a, t, m), 'messages', o, 'older', coalesce(v_older, false), 'members', mem,
  'can_add', v_adm, 'can_rename', v_adm, 'can_leave', t.kind <> 'dm', 'can_remove', v_adm, 'can_admin', v_adm);
end $$;

-- ---------------------------------------------------------------- グループを作る（作った人が管理する人）
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
  if t.created_by is distinct from a->>'emp' or t.kind <> 'group' then raise exception 'conflict'; end if;
  if public.chat_member_of(a, t) is null then raise exception 'not_found'; end if;
  return public.chat_row(a, t, public.chat_member_of(a, t)) || jsonb_build_object('replay', true);
 end if;
 for v in select jsonb_array_elements_text(p->'members') loop
  if v = a->>'emp' then continue; end if;
  if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
  if not (v = any(v_set)) then v_set := v_set || v; end if;
 end loop;
 if cardinality(v_set) < 1 then raise exception 'bad_value'; end if;
 insert into public.chat_threads(kind, title, created_by, created_name, created_key) values ('group', v_title, a->>'emp', a->>'name', v_key) returning * into t;
 insert into public.chat_members(thread_id, emp_id, added_by, admin) values (t.id, a->>'emp', a->>'emp', true);
 insert into public.chat_members(thread_id, emp_id, added_by) select t.id, x, a->>'emp' from unnest(v_set) x;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- ---------------------------------------------------------------- 申請のチャット
-- 開く：参加者なら会話。参加者でなく、もうあるなら「ある」とだけ（題名・人数・中身は出さない）。まだ無ければ、作るときに出す関係する人
create or replace function public.chat_case(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); r public.wr_requests; t public.chat_threads; m public.chat_members; v_title text; o jsonb := '[]'::jsonb; v text;
begin
 r := public.wr_find(a, p);   -- 見られない申請は not_found
 if not public.wr_visible(a, r) then raise exception 'not_found'; end if;
 select * into t from public.chat_threads x where x.ref_kind = 'wr' and x.ref_id = r.id;
 if found then
  m := public.chat_member_of(a, t);
  if m.thread_id is null then return jsonb_build_object('thread', null, 'can_open', false, 'exists', true); end if;
  return jsonb_build_object('thread', public.chat_row(a, t, m), 'can_open', true, 'exists', true);
 end if;
 foreach v in array public.chat_case_auto(r) loop
  if v = a->>'emp' or not public.chat_emp_ok(v) then continue; end if;
  o := o || coalesce((select jsonb_build_array(jsonb_build_object('emp', e.id::text, 'name', btrim(coalesce(e.name, '')), 'store', e.store, 'title', e.title, 'pre', true))
              from public.employees e where e.id::text = v limit 1), '[]'::jsonb);
 end loop;
 v_title := left(btrim(coalesce(r.payload->>'title', r.payload->>'purpose', r.payload->>'vendor', '')), 60);
 return jsonb_build_object('thread', null, 'can_open', false, 'exists', false, 'can_create', true,
  'code', r.code, 'wr_kind', r.kind, 'title', v_title, 'candidates', o, 'max', 49);
end $$;

-- 作る：選んだ人（0〜49 人）と自分。同じ申請は 1 つ（同時に押しても）。同じ鍵の押し直しは同じ会話
create or replace function public.chat_case_create(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); r public.wr_requests; t public.chat_threads; m public.chat_members; v_key text := p->>'client_key';
 v_title text := btrim(regexp_replace(coalesce(p->>'title', ''), '[\u0001-\u001f\u007f]', '', 'g')); v text; v_set text[] := '{}';
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if length(v_title) > 60 then raise exception 'bad_value'; end if;
 if p ? 'members' and jsonb_typeof(p->'members') <> 'null' then
  if jsonb_typeof(p->'members') <> 'array' or jsonb_array_length(p->'members') > 49 then raise exception 'bad_value'; end if;
 end if;
 r := public.wr_find(a, p);
 if not public.wr_visible(a, r) then raise exception 'not_found'; end if;
 perform pg_advisory_xact_lock(hashtext('chat_case:' || r.id::text));
 select * into t from public.chat_threads x where x.created_key = v_key;
 if found then
  if t.created_by is distinct from a->>'emp' or t.kind <> 'case' or t.ref_id is distinct from r.id then raise exception 'conflict'; end if;
  m := public.chat_member_of(a, t);
  if m.thread_id is null then raise exception 'not_found'; end if;
  return public.chat_row(a, t, m) || jsonb_build_object('replay', true);
 end if;
 select * into t from public.chat_threads x where x.ref_kind = 'wr' and x.ref_id = r.id;
 if found then
  m := public.chat_member_of(a, t);
  if m.thread_id is not null then return public.chat_row(a, t, m) || jsonb_build_object('existing', true); end if;
  raise exception 'case_exists';   -- ほかの人が先に作った（この人は参加者でない）
 end if;
 if jsonb_typeof(p->'members') = 'array' then
  for v in select jsonb_array_elements_text(p->'members') loop
   if v = a->>'emp' then continue; end if;
   if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
   if not (v = any(v_set)) then v_set := v_set || v; end if;
  end loop;
 end if;
 if v_title = '' then v_title := left(btrim(coalesce(r.payload->>'title', r.payload->>'purpose', r.payload->>'vendor', '')), 60); end if;
 insert into public.chat_threads(kind, title, ref_kind, ref_id, created_by, created_name, created_key)
  values ('case', nullif(v_title, ''), 'wr', r.id, a->>'emp', a->>'name', v_key) returning * into t;
 insert into public.chat_members(thread_id, emp_id, added_by, admin) values (t.id, a->>'emp', a->>'emp', true);
 insert into public.chat_members(thread_id, emp_id, added_by) select t.id, x, a->>'emp' from unnest(v_set) x;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- ---------------------------------------------------------------- 送る（案件の担当を合わせるのはやめた。ほかは添付の版のまま）
create or replace function public.chat_send(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; v_key text := p->>'client_key'; x public.chat_messages; v_body text; v_m text[];
 v_seq bigint; v_ids uuid[] := '{}'::uuid[]; v text; v_n integer;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if p ? 'files' and jsonb_typeof(p->'files') <> 'null' then
  if jsonb_typeof(p->'files') <> 'array' or jsonb_array_length(p->'files') > 5 then raise exception 'bad_value'; end if;
  for v in select jsonb_array_elements_text(p->'files') loop
   if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v::uuid = any(v_ids) then raise exception 'bad_value'; end if;
   v_ids := v_ids || v::uuid;
  end loop;
 end if;
 select * into x from public.chat_messages y where y.author_emp = a->>'emp' and y.client_key = v_key;
 if found then
  if x.thread_id::text is distinct from lower(coalesce(p->>'thread', '')) then raise exception 'conflict'; end if;
  t := public.chat_find(a, p->>'thread');
  return public.chat_msg(a, t, x) || jsonb_build_object('replay', true);
 end if;
 t := public.chat_find(a, p->>'thread');
 if cardinality(v_ids) > 0 then v_body := public.chat_body_opt(p->>'body'); else v_body := public.chat_body(p->>'body'); end if;
 if cardinality(v_ids) > 0 then
  select count(*) into v_n from (select 1 from public.chat_files f where f.id = any(v_ids) and f.owner_emp = a->>'emp' and f.thread_id = t.id
     and f.status = 'ok' and f.message_id is null for update) q;
  if v_n <> cardinality(v_ids) then raise exception 'file_bad'; end if;
 end if;
 v_m := public.chat_mentions(t, p->'mentions');
 update public.chat_threads set last_seq = last_seq + 1, last_at = now() where id = t.id returning last_seq into v_seq;
 insert into public.chat_messages(thread_id, seq, author_emp, author_name, body, mentions, client_key)
  values (t.id, v_seq, a->>'emp', coalesce(nullif(a->>'name', ''), public.chat_emp_name(a->>'emp')), v_body, v_m, v_key) returning * into x;
 if cardinality(v_ids) > 0 then
  update public.chat_files f set status = 'sent', message_id = x.id, seq = x.seq, sent_at = now(), pos = o.ord
    from (select u.id, u.ord::smallint as ord from unnest(v_ids) with ordinality as u(id, ord)) o where f.id = o.id;
 end if;
 update public.chat_members set last_read = greatest(last_read, v_seq) where thread_id = t.id and emp_id = a->>'emp';
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads y where y.id = t.id;
 return public.chat_msg(a, t, x);
end $$;

-- メンションできるのは参加者だけ（前の版の自動の参加者は数えない）
create or replace function public.chat_mentions(t public.chat_threads, p jsonb) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v text;
begin
 if p is null or jsonb_typeof(p) = 'null' then return o; end if;
 if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 50 then raise exception 'bad_value'; end if;
 for v in select jsonb_array_elements_text(p) loop
  if v is null or length(v) > 64 then raise exception 'bad_value'; end if;
  if not exists (select 1 from public.chat_members m where m.thread_id = t.id and m.emp_id = v and m.left_at is null and not m.auto) then raise exception 'not_member'; end if;
  if not (v = any(o)) then o := o || v; end if;
 end loop;
 return o;
end $$;

-- ---------------------------------------------------------------- 加える（グループ・申請のチャット：その会話の管理する人だけ）
create or replace function public.chat_add(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members; v text; v_hist boolean; n integer := 0; v_cnt integer;
 mm public.chat_members; v_from bigint;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 me := public.chat_member_of(a, t);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'history') <> 'boolean' then raise exception 'bad_value'; end if;
 v_hist := (p->>'history')::boolean;
 if jsonb_typeof(p->'members') <> 'array' or jsonb_array_length(p->'members') < 1 or jsonb_array_length(p->'members') > 49 then raise exception 'bad_value'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 for v in select jsonb_array_elements_text(p->'members') loop
  if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
  -- 新しく加える人・外された／抜けた人・確かめていない前の自動の参加者は、いま選んだ範囲（見せない＝次の番号から）
  v_from := case when v_hist then 1 else t.last_seq + 1 end;
  select * into mm from public.chat_members x where x.thread_id = t.id and x.emp_id = v for update;
  if not found then
   insert into public.chat_members(thread_id, emp_id, added_by, history_from) values (t.id, v, a->>'emp', v_from);
   n := n + 1;
  elsif mm.left_at is not null or mm.auto then
   update public.chat_members set left_at = null, auto = false, admin = false, added_by = a->>'emp', added_at = now(), history_from = v_from
    where thread_id = t.id and emp_id = v;
   n := n + 1;
  end if;
 end loop;
 select count(*) into v_cnt from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto;
 if v_cnt > 50 then raise exception 'too_many'; end if;
 if n > 0 then perform public.chat_bump(t.id); end if;
 return jsonb_build_object('added', n, 'members', v_cnt);
end $$;

-- 外す（管理する人）／抜ける（本人・グループと申請のチャット）。管理する人がいなくなれば、いちばん前から入っている人に
create or replace function public.chat_remove(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members; v text := p->>'emp'; n integer;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if v is null or v = '' or length(v) > 64 then raise exception 'bad_value'; end if;
 me := public.chat_member_of(a, t);
 if v <> a->>'emp' and not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 update public.chat_members set left_at = now(), auto = false, admin = false where thread_id = t.id and emp_id = v and left_at is null;
 get diagnostics n = row_count;
 if n > 0 then perform public.chat_admin_fix(t.id); perform public.chat_bump(t.id); perform public.chat_bump_me(t.id, v); end if;
 return jsonb_build_object('removed', n);
end $$;

-- 管理する人を決める（管理する人だけ）。最後の 1 人は外せない
create or replace function public.chat_admin(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members; mm public.chat_members; v text := p->>'emp'; v_on boolean; n integer;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if v is null or v = '' or length(v) > 64 then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'admin') <> 'boolean' then raise exception 'bad_value'; end if;
 v_on := (p->>'admin')::boolean;
 me := public.chat_member_of(a, t);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id for update;
 select * into mm from public.chat_members x where x.thread_id = t.id and x.emp_id = v and x.left_at is null and not x.auto for update;
 if not found then raise exception 'not_member'; end if;
 if mm.admin = v_on then return jsonb_build_object('emp', v, 'admin', v_on); end if;
 if not v_on then
  select count(*) into n from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and x.admin;
  if n <= 1 then raise exception 'last_admin'; end if;
 end if;
 update public.chat_members set admin = v_on where thread_id = t.id and emp_id = v;
 perform public.chat_bump(t.id);
 return jsonb_build_object('emp', v, 'admin', v_on);
end $$;

-- 名前（グループ・申請のチャット：管理する人・版を確かめる）
create or replace function public.chat_rename(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members;
 v_title text := btrim(regexp_replace(coalesce(p->>'title', ''), '[\u0001-\u001f\u007f]', '', 'g'));
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 me := public.chat_member_of(a, t);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 if v_title = '' or length(v_title) > 60 then raise exception 'bad_value'; end if;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = t.rev) then raise exception 'conflict'; end if;
 update public.chat_threads set title = v_title, rev = rev + 1 where id = t.id returning * into t;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- SQL の段（アプリ・関数が見分ける）：3＝UI案79（参加者だけ・管理する人）
create or replace function public.chat_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('chat', 3) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file')) loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
