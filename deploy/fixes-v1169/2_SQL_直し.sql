-- v1169：Codex の blocked の P2（#161〜#164）のうち SQL の直し。仕様：docs/FIXES_V1169_JA.md
-- 先にチャットの守り（20261128090000）と申請/承認（20261126090000）を流してから。無ければ何も変えずに止める。2 回流しても同じ。
--
-- 1.（#164）キー付きのグループは、作るのとキーを付けるのを 1 つの取引で（chat_create_group_k）。
--    前は作ったあと別に chat_key_save を呼んだので、キーの保存が失敗すると守りの無い会話が残り、送り直し（replay）でもキーを付け直さなかった。
--    送り直しで、まだ一度もキーを付けていない会話（key_rev 0）ならここで付ける（前の版で作りかけたものも）。
-- 2.（#163）申請のチャット：
--    ・最後の参加者（読める参加者がほかにいない）は抜けられない（last_member）。ほかの人を加えてから抜ける。
--    ・だれも読めない会話（いまの参加者がいない・退職した人だけ・確かめていない前の自動の参加者だけ）は、次に開いた人が新しく作れる。
--      前の会話は申請から外して ref_old に残す（中身はだれにも見せない＝参加者だけが読めるのは前のまま）。
--    ・管理する人：退職した人は選ばない（いまの参加者から）。管理する人が退職した人だけの会話も直す（1 回）。
--    ・v1170 の直し（Codex #166 の P2）：SQL のあとに唯一の管理する人が退職・無効になっても、加える・外す・管理する人・名前・キーの操作は、
--      会話をロックしてから管理する人を直し（chat_admin_lock）、そのあとで権限と最後の参加者を確かめる。参加者でない人には見せない（前のまま）。
--    ・v1170 の直し（Codex #166 6891496601）：会話を開いたときの「できること」も、次に管理する人になる人を管理する人として返す
--      （chat_admin_eff・読むだけ）。残った参加者がふつうの画面で「人を加える」などを押せる（前は API を直接呼ばないと直せなかった）。
-- 3.（#161）経理レビュー › 申請の「処理済み（今月）」：精算・確認した時刻（ハワイの月）でサーバーから読む（wr_acct_done・ページごと）。
--    前は申請した日で 2 か月前まで・1,000 件で読んでいたので、古い申請を今月処理したものが出なかった。
-- 4. 段：chat_stage 5（前の版のチャットの SQL はこの上では止まる）。申請の段（wr_stage）は変えない（v1165 の ③ が段 7 ちょうどを見るため）。
-- 気をつけること：前の版のチャットの SQL（20261121090000・20261124090000・20261127090000・20261128090000）は、この SQL のあとに流すと止まる（v1169 から）。

do $$ begin
 if to_regclass('public.chat_guard') is null or to_regprocedure('public.chat_key_save(jsonb)') is null
    or to_regprocedure('public.chat_case_create(jsonb)') is null or to_regprocedure('public.chat_admin_fix(uuid)') is null
    or to_regprocedure('public.wr_stage(jsonb)') is null or to_regprocedure('public.wr_row(jsonb,public.wr_requests)') is null
    or to_regprocedure('public.wr_visible(jsonb,public.wr_requests)') is null then
  raise exception 'STOP: 先にチャットの守り（deploy/chat-guard-v1168）とワークセンターの申請（段階 2 まで）の SQL を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
alter table public.chat_threads add column if not exists ref_old uuid;   -- 申請から外した（だれも読めなくなった）申請のチャットの、もとの申請

-- 読める参加者の数（いまの参加者・確かめた人・在籍している人）
create or replace function public.chat_live_n(p_thread uuid) returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
 select count(*)::int from public.chat_members x
  where x.thread_id = p_thread and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id);
$$;

-- ---------------------------------------------------------------- 1. キー付きのグループを 1 つの取引で作る
-- 印（hash・salt・iter）は関数 work-requests が PBKDF2 で作って渡す。作るのは chat_create_group（同じ鍵の送り直しは同じ会話）
create or replace function public.chat_create_group_k(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); r jsonb; t public.chat_threads; me public.chat_members; s jsonb := null;
begin
 if coalesce(p->>'hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'salt', '') !~ '^[0-9a-f]{32}$'
    or coalesce(jsonb_typeof(p->'iter'), '') <> 'number'
    or (case when coalesce(p->>'iter', '') ~ '^[0-9]{6,7}$' then (p->>'iter')::int not between 100000 and 2000000 else true end) then raise exception 'bad_value'; end if;
 r := public.chat_create_group(p);
 select * into t from public.chat_threads x where x.id = (r->>'id')::uuid for update;
 if not found then raise exception 'not_found'; end if;
 me := public.chat_member_of(a, t);
 -- 一度もキーを付けていない会話（作ったばかり・前の版で付けそこねた）にだけ付ける。管理する人が外した・変えた会話には触らない
 if t.key_hash is null and t.key_rev = 0 and coalesce(me.admin, false) then
  update public.chat_threads set key_hash = p->>'hash', key_salt = p->>'salt', key_iter = (p->>'iter')::int, key_rev = key_rev + 1, key_at = now(), key_by = a->>'emp'
   where id = t.id returning * into t;
  delete from public.chat_sess_keys k where k.thread_id = t.id;
  delete from public.chat_key_fails k where k.thread_id = t.id;
  s := public.chat_sess_open(p, a->>'emp');
  insert into public.chat_sess_keys(sess_id, thread_id, key_rev) values ((s->>'id')::uuid, t.id, t.key_rev)
   on conflict (sess_id, thread_id) do update set key_rev = excluded.key_rev, at = now();
  perform public.chat_bump(t.id);
  select * into t from public.chat_threads x where x.id = t.id;
  a := a || jsonb_build_object('sess', s->>'id');
 end if;
 return public.chat_row(a, t, me) || case when r ? 'replay' then jsonb_build_object('replay', true) else '{}'::jsonb end
  || case when s ? 'token' then jsonb_build_object('unlock', s->>'token') else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------- 2. 申請のチャット・管理する人
-- 管理する人がいなければ（いても退職した人だけなら）、いちばん前から入っている読める参加者を管理する人に（作った人が先）
-- v1170 の直し（Codex #166 6891496601）：だれを管理する人にするかを 1 つの関数（chat_admin_next・読むだけ）に。
-- 直す（chat_admin_fix）のと、画面に見せる権限（chat_admin_eff）が同じ人を選ぶ
create or replace function public.chat_admin_next(p_thread uuid) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
 select x.emp_id from public.chat_members x
  where x.thread_id = p_thread and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id)
    and exists (select 1 from public.chat_threads t where t.id = p_thread and t.kind in ('group','case'))
    and not exists (select 1 from public.chat_members y where y.thread_id = p_thread and y.left_at is null and not y.auto and y.admin
                     and public.chat_emp_ok(y.emp_id))
  order by (x.emp_id = (select t.created_by from public.chat_threads t where t.id = p_thread)) desc, x.added_at, x.emp_id limit 1
$$;

create or replace function public.chat_admin_fix(p_thread uuid) returns void
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v text := public.chat_admin_next(p_thread);
begin
 if v is not null then update public.chat_members set admin = true where thread_id = p_thread and emp_id = v; end if;
end $$;

-- v1170 の直し（Codex #166 6891496601）：画面に見せる「管理する人か」。管理する人がいなければ（退職・無効だけなら）、
-- 次の操作で管理する人になる人（chat_admin_next）も管理する人として見せる（読むだけ・何も書かない）。
-- その人が加える・名前・管理・キーを押すと、chat_admin_lock がロックの下で本当に管理する人にしてから確かめる
create or replace function public.chat_admin_eff(m public.chat_members, t public.chat_threads) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select t.kind <> 'dm' and m.emp_id is not null and m.left_at is null and not coalesce(m.auto, false)
  and (coalesce(m.admin, false) or coalesce(public.chat_admin_next(t.id) = m.emp_id, false))
$$;

-- v1170 の直し：会話をロックし、管理する人がいなければ（退職・無効だけなら）直してから、自分の参加の行を読み直す。
-- 管理する人の権限を確かめる操作は、どれもこれを通してから確かめる（唯一の管理する人の退職のあとも、残った参加者が加える・抜ける・直すことができる）
create or replace function public.chat_admin_lock(a jsonb, p_thread uuid) returns public.chat_members
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare t public.chat_threads;
begin
 select * into t from public.chat_threads x where x.id = p_thread for update;
 if not found then raise exception 'not_found'; end if;
 perform public.chat_admin_fix(t.id);
 return public.chat_member_of(a, t);
end $$;

-- v1170 の直し（Codex #166 6891496601）：会話を開いたとき（一覧・メッセージ）の「管理する人か」と「できること」を chat_admin_eff で。
-- 唯一の管理する人が退職したあと、残った参加者がふつうの画面で「人を加える」「名前」「管理」「キー」を押せる（前は API を直接呼ばないと直せなかった）。
-- 中身は v1168（守り）の chat_row と v1167（UI案79）の chat_messages_get のまま、管理する人の印だけを変えた
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
  'created_by', t.created_by, 'created_name', t.created_name, 'rev', t.rev, 'admin', public.chat_admin_eff(m, t),
  'keyed', t.key_hash is not null, 'key_ok', v_kok, 'key_rev', t.key_rev,
  'last_seq', t.last_seq, 'last_at', t.last_at, 'last_read', m.last_read, 'history_from', m.history_from,
  'preview', case when lm.id is null then null when not v_kok then jsonb_build_object('seq', lm.seq, 'at', lm.created_at, 'locked', true)
    else jsonb_strip_nulls(jsonb_build_object('seq', lm.seq, 'name', lm.author_name, 'emp', lm.author_emp, 'text', v_prev, 'at', lm.created_at,
    'state', case when lm.deleted_at is not null then 'deleted' when lm.hidden_at is not null then 'hidden' end,
    'files', case when lm.deleted_at is null and lm.hidden_at is null and coalesce(lm.body, '') = '' then public.chat_files_count(lm.id) end)) end,
  'unread', v_unread, 'mention', v_ment, 'chg', greatest(t.chg, m.chg));
end $$;

create or replace function public.chat_messages_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); m public.chat_members := public.chat_member_of(a, t);
 v_after bigint := null; v_before bigint := null; v_lim integer := 100; o jsonb; mem jsonb; v_older boolean; v_adm boolean := public.chat_admin_eff(m, t); v_next text := public.chat_admin_next(t.id);
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
 select coalesce(jsonb_agg(jsonb_build_object('emp', x.emp_id, 'name', public.chat_emp_name(x.emp_id), 'auto', false, 'admin', x.admin or x.emp_id = v_next, 'last_read', x.last_read)
   order by (x.admin or x.emp_id = v_next) desc, public.chat_emp_name(x.emp_id)), '[]'::jsonb) into mem
   from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto;
 return jsonb_build_object('thread', public.chat_row(a, t, m), 'messages', o, 'older', coalesce(v_older, false), 'members', mem,
  'can_add', v_adm, 'can_rename', v_adm, 'can_leave', t.kind <> 'dm', 'can_remove', v_adm, 'can_admin', v_adm);
end $$;

-- 外す（管理する人）／抜ける（本人）。抜けるのはキーを開けていなくてもできる。申請のチャットの最後の参加者は抜けられない（last_member）
create or replace function public.chat_remove(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; me public.chat_members; v text := p->>'emp'; n integer;
begin
 if v is null or v = '' or length(v) > 64 then raise exception 'bad_value'; end if;
 if v = a->>'emp' then t := public.chat_find_nokey(a, p->>'thread'); else t := public.chat_find(a, p->>'thread'); end if;
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 me := public.chat_admin_lock(a, t.id);   -- v1170 の直し：ロックして管理する人を直してから確かめる
 select * into t from public.chat_threads x where x.id = t.id;
 if v <> a->>'emp' and not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 if t.kind = 'case' and exists (select 1 from public.chat_members x where x.thread_id = t.id and x.emp_id = v and x.left_at is null)
    and not exists (select 1 from public.chat_members x where x.thread_id = t.id and x.emp_id <> v and x.left_at is null and not x.auto
                     and public.chat_emp_ok(x.emp_id)) then
  raise exception 'last_member';   -- 抜けると、だれも読めない・加えられない会話になる（ほかの人を加えてから抜ける）
 end if;
 update public.chat_members set left_at = now(), auto = false, admin = false where thread_id = t.id and emp_id = v and left_at is null;
 get diagnostics n = row_count;
 if n > 0 then
  delete from public.chat_key_fails k where k.emp_id = v and k.thread_id = t.id;
  delete from public.chat_sess_keys k where k.thread_id = t.id and k.sess_id in (select s.id from public.chat_sess s where s.emp_id = v);
  perform public.chat_admin_fix(t.id); perform public.chat_bump(t.id); perform public.chat_bump_me(t.id, v);
 end if;
 return jsonb_build_object('removed', n);
end $$;

-- v1170 の直し：加える（その会話の管理する人だけ。v1167 のまま、確かめる前にロックして管理する人を直す）
create or replace function public.chat_add(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members; v text; v_hist boolean; n integer := 0; v_cnt integer;
 mm public.chat_members; v_from bigint;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'history') <> 'boolean' then raise exception 'bad_value'; end if;
 v_hist := (p->>'history')::boolean;
 if jsonb_typeof(p->'members') <> 'array' or jsonb_array_length(p->'members') < 1 or jsonb_array_length(p->'members') > 49 then raise exception 'bad_value'; end if;
 me := public.chat_admin_lock(a, t.id);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id;
 for v in select jsonb_array_elements_text(p->'members') loop
  if not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
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

-- v1170 の直し：管理する人を決める（v1167 のまま、確かめる前にロックして管理する人を直す）。最後の 1 人は外せない。退職・無効の人は数えない
create or replace function public.chat_admin(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members; mm public.chat_members; v text := p->>'emp'; v_on boolean; n integer;
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if v is null or v = '' or length(v) > 64 then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'admin') <> 'boolean' then raise exception 'bad_value'; end if;
 v_on := (p->>'admin')::boolean;
 me := public.chat_admin_lock(a, t.id);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into mm from public.chat_members x where x.thread_id = t.id and x.emp_id = v and x.left_at is null and not x.auto for update;
 if not found then raise exception 'not_member'; end if;
 if mm.admin = v_on then return jsonb_build_object('emp', v, 'admin', v_on); end if;
 if not v_on then
  select count(*) into n from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and x.admin and public.chat_emp_ok(x.emp_id);
  if n <= 1 then raise exception 'last_admin'; end if;
 end if;
 if v_on and not public.chat_emp_ok(v) then raise exception 'bad_value'; end if;
 update public.chat_members set admin = v_on where thread_id = t.id and emp_id = v;
 perform public.chat_bump(t.id);
 return jsonb_build_object('emp', v, 'admin', v_on);
end $$;

-- v1170 の直し：名前（v1167 のまま、確かめる前にロックして管理する人を直す・版を確かめる）
create or replace function public.chat_rename(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); me public.chat_members;
 v_title text := btrim(regexp_replace(coalesce(p->>'title', ''), '[\u0001-\u001f\u007f]', '', 'g'));
begin
 if t.kind = 'dm' then raise exception 'forbidden'; end if;
 if v_title = '' or length(v_title) > 60 then raise exception 'bad_value'; end if;
 me := public.chat_admin_lock(a, t.id);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = t.rev) then raise exception 'conflict'; end if;
 update public.chat_threads set title = v_title, rev = rev + 1 where id = t.id returning * into t;
 perform public.chat_bump(t.id);
 select * into t from public.chat_threads x where x.id = t.id;
 return public.chat_row(a, t, public.chat_member_of(a, t));
end $$;

-- v1170 の直し：グループのキーを決める・変える・外す（v1168 のまま、確かめる前にロックして管理する人を直す）
create or replace function public.chat_key_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find_nokey(a, p->>'thread'); me public.chat_members; s jsonb; v_clear boolean;
begin
 if t.kind not in ('group','case') then raise exception 'forbidden'; end if;
 if coalesce(jsonb_typeof(p->'clear'), '') <> 'boolean' then raise exception 'bad_value'; end if;
 v_clear := (p->>'clear')::boolean;
 if not v_clear and (coalesce(p->>'hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'salt', '') !~ '^[0-9a-f]{32}$'
     or coalesce(jsonb_typeof(p->'iter'), '') <> 'number' or (p->>'iter')::int not between 100000 and 2000000) then raise exception 'bad_value'; end if;
 me := public.chat_admin_lock(a, t.id);
 if not coalesce(me.admin, false) then raise exception 'forbidden'; end if;
 select * into t from public.chat_threads x where x.id = t.id;
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

-- 開く：参加者なら会話。参加者でなく、読める参加者がいる会話なら「ある」とだけ。だれも読めない会話なら、新しく作れる（restart）
create or replace function public.chat_case(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); r public.wr_requests; t public.chat_threads; m public.chat_members; v_title text; o jsonb := '[]'::jsonb; v text;
 v_restart boolean := false;
begin
 r := public.wr_find(a, p);   -- 見られない申請は not_found
 if not public.wr_visible(a, r) then raise exception 'not_found'; end if;
 select * into t from public.chat_threads x where x.ref_kind = 'wr' and x.ref_id = r.id;
 if found then
  m := public.chat_member_of(a, t);
  if m.thread_id is not null then return jsonb_build_object('thread', public.chat_row(a, t, m), 'can_open', true, 'exists', true); end if;
  if public.chat_live_n(t.id) > 0 then return jsonb_build_object('thread', null, 'can_open', false, 'exists', true); end if;
  v_restart := true;
 end if;
 foreach v in array public.chat_case_auto(r) loop
  if v = a->>'emp' or not public.chat_emp_ok(v) then continue; end if;
  o := o || coalesce((select jsonb_build_array(jsonb_build_object('emp', e.id::text, 'name', btrim(coalesce(e.name, '')), 'store', e.store, 'title', e.title, 'pre', true))
              from public.employees e where e.id::text = v limit 1), '[]'::jsonb);
 end loop;
 v_title := left(btrim(coalesce(r.payload->>'title', r.payload->>'purpose', r.payload->>'vendor', '')), 60);
 return jsonb_build_object('thread', null, 'can_open', false, 'exists', false, 'can_create', true, 'restart', v_restart,
  'code', r.code, 'wr_kind', r.kind, 'title', v_title, 'candidates', o, 'max', 49);
end $$;

-- 作る：選んだ人（0〜49 人）と自分。同じ申請は 1 つ（同時に押しても）。同じ鍵の押し直しは同じ会話。
-- だれも読めない前の会話は申請から外して（ref_old）新しく作る
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
  if t.created_by is distinct from a->>'emp' or t.kind <> 'case' or coalesce(t.ref_id, t.ref_old) is distinct from r.id then raise exception 'conflict'; end if;
  m := public.chat_member_of(a, t);
  if m.thread_id is null then raise exception 'not_found'; end if;
  return public.chat_row(a, t, m) || jsonb_build_object('replay', true);
 end if;
 select * into t from public.chat_threads x where x.ref_kind = 'wr' and x.ref_id = r.id for update;
 if found then
  m := public.chat_member_of(a, t);
  if m.thread_id is not null then return public.chat_row(a, t, m) || jsonb_build_object('existing', true); end if;
  if public.chat_live_n(t.id) > 0 then raise exception 'case_exists'; end if;   -- ほかの人が先に作った（この人は参加者でない）
  update public.chat_threads set ref_old = ref_id, ref_id = null where id = t.id;   -- だれも読めない：申請から外す（中身は見せない）
  perform public.chat_bump(t.id);
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

-- 管理する人が退職した人だけ（か、いない）の会話を直す（1 回。何回流しても同じ）
do $$ declare c record; begin
 for c in select t.id from public.chat_threads t where t.kind in ('group','case')
   and not exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and x.admin and public.chat_emp_ok(x.emp_id))
   and exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id)) loop
  perform public.chat_admin_fix(c.id);
  perform public.chat_bump(c.id);
 end loop;
end $$;

-- ---------------------------------------------------------------- 3. 経理レビュー › 申請の「処理済み（今月）」
-- 処理した時刻＝精算した時刻（無ければ確認した時刻）。month＝ハワイの年月（無ければ今月）。新しい順に limit 件（200・500 まで）。
-- 続きは next（before_at・before_id）を渡す。見られる申請だけ（wr_visible）
create index if not exists wr_requests_done_at_idx on public.wr_requests ((coalesce(paid_at, checked_at)))
 where paid_at is not null or checked_at is not null;

create or replace function public.wr_acct_done(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_ym text := coalesce(nullif(p->>'month', ''), to_char(timezone('Pacific/Honolulu', now()), 'YYYY-MM'));
 v_from timestamptz; v_to timestamptz; v_lim integer := 200; v_bat timestamptz := null; v_bid uuid := null;
 x record; v_rows jsonb := '[]'::jsonb; v_n integer := 0; v_more boolean := false; v_lat timestamptz; v_lid uuid;
begin
 if v_ym !~ '^20\d{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 if p ? 'limit' and jsonb_typeof(p->'limit') <> 'null' then
  if jsonb_typeof(p->'limit') <> 'number' or coalesce(p->>'limit', '') !~ '^[0-9]{1,4}$' then raise exception 'bad_value'; end if;
  v_lim := least(greatest((p->>'limit')::int, 1), 500);
 end if;
 if nullif(p->>'before_at', '') is not null or nullif(p->>'before_id', '') is not null then
  begin v_bat := (p->>'before_at')::timestamptz; v_bid := (p->>'before_id')::uuid; exception when others then raise exception 'bad_value'; end;
  if v_bat is null or v_bid is null then raise exception 'bad_value'; end if;
 end if;
 v_from := ((v_ym || '-01')::date)::timestamp at time zone 'Pacific/Honolulu';
 v_to := (((v_ym || '-01')::date + interval '1 month')::date)::timestamp at time zone 'Pacific/Honolulu';
 for x in select r, coalesce(r.paid_at, r.checked_at) as done_at from public.wr_requests r
           where coalesce(r.paid_at, r.checked_at) >= v_from and coalesce(r.paid_at, r.checked_at) < v_to
             and r.status in ('paid','done','applied')
             and (v_bat is null or (coalesce(r.paid_at, r.checked_at), r.id) < (v_bat, v_bid))
             and public.wr_visible(a, r)
           order by coalesce(r.paid_at, r.checked_at) desc, r.id desc
           limit v_lim + 1 loop
  v_n := v_n + 1;
  if v_n > v_lim then v_more := true; exit; end if;
  v_rows := v_rows || jsonb_build_array(public.wr_row(a, x.r));
  v_lat := x.done_at; v_lid := (x.r).id;
 end loop;
 return jsonb_build_object('rows', v_rows, 'month', v_ym,
  'next', case when v_more then jsonb_build_object('before_at', v_lat, 'before_id', v_lid) end);
end $$;

-- ---------------------------------------------------------------- 4. 段
create or replace function public.chat_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('chat', 5) $$;
-- 申請の段（wr_stage）は変えない：申請/承認（v1165）の ③ は段 7 ちょうどを見る。処理済み（今月）は、関数が wr_acct_done の無いことで見分ける（done_old）

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file','wr_acct_done')) loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
