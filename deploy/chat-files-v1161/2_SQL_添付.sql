-- v1161：チャットの添付（写真・PDF・Excel・Word など）（UI案75 の答え・Moto さん 11/13 22:45 HST「1 B 2 A 3 A 4 A 5 A 6 A 7 A 8 B」）。
-- 仕様：docs/CHAT_FILES_V1161_JA.md
-- 先にチャットの SQL（20261121090000）を流してから。2 回流しても同じ。チャットの SQL をあとで流し直したら、この SQL も流し直す。
--
-- 1B：送れるのは 写真（端末で JPEG にする）・PDF・Excel（xlsx・xls・csv）・Word（docx・doc）・PowerPoint（pptx・ppt）・テキスト（txt）。
-- 2A：写真は送る前に端末で縮める（長い辺 2000px）。一覧の小さい写真（長い辺 480px）も一緒に上げる。
-- 3A：1 回に 5 つまで・1 つ 10MB まで。
-- 4A：見られる人はだれでも保存できる（開くたびに 5 分だけ使えるリンク）。
-- 5A：本人がメッセージを消したら、ファイルもサーバーから消す（申請の領収書にしたものは申請の記録として残す）。GM・CEO が見えなくしたら、ファイルも出さない（残す）。
-- 6A：メッセージがある限り残す。付けたまま送らなかったファイルは 1 日で消す。
-- 7A：「この会話のファイル」の一覧（chat_files_list）。
-- 8B：建て替え経費の申請のチャットの写真・PDF を、申請した本人が「申請に付ける」で申請の領収書にする（wr_receipt_from_chat）。
--
-- 置き場所：Storage の非公開の置き場所 chat-files（公開の鍵では読めない・書けない。名前は意味のない番号＝<会話の id>/<ファイルの id>）。
-- 中身は端末から 1 回だけ使える上げる先（関数 work-requests が出す）へ直接上げる。送るときに関数が中身の先頭の印と大きさを確かめる。
-- 表 chat_files：だれの・どの会話の・どのメッセージの・状態。公開の鍵では読めない・書けない（RLS・権限なし）。関数はサーバーの鍵だけ。

do $$ begin
 if to_regprocedure('public.chat_send(jsonb)') is null or to_regclass('public.chat_messages') is null or to_regprocedure('public.wr_find(jsonb,jsonb)') is null then
  raise exception 'STOP: 先にチャットの SQL（deploy/chat-v1156）を流してください（何も変えていません）';
 end if;
end $$;

-- Storage に「置き場所（bucket_id）を限らない」決まりがあると、公開の鍵で chat-files を読めてしまう。あれば何も変えずに止める。
do $$ declare v text; begin
 if to_regclass('storage.objects') is not null then
  select string_agg(policyname, ', ' order by policyname) into v from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and roles && array['public','anon','authenticated']::name[]
     and position('bucket_id' in coalesce(qual, '') || coalesce(with_check, '')) = 0;
  if v is not null then raise exception 'STOP: Storage（storage.objects）に置き場所を限らない決まりがあります（%）。Claude に知らせてください（何も変えていません）', v; end if;
  select string_agg(policyname, ', ' order by policyname) into v from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and roles && array['public','anon','authenticated']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%chat-files%';
  if v is not null then raise exception 'STOP: Storage に chat-files を開ける決まりがあります（%）。Claude に知らせてください（何も変えていません）', v; end if;
 end if;
end $$;

-- ---------------------------------------------------------------- 種類（拡張子 → 種類・中身の形）
create or replace function public.chat_file_type(p_ext text) returns jsonb
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case lower(coalesce(p_ext, ''))
  when 'jpg'  then jsonb_build_object('kind', 'photo', 'mime', 'image/jpeg')
  when 'pdf'  then jsonb_build_object('kind', 'pdf',   'mime', 'application/pdf')
  when 'xlsx' then jsonb_build_object('kind', 'sheet', 'mime', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  when 'xls'  then jsonb_build_object('kind', 'sheet', 'mime', 'application/vnd.ms-excel')
  when 'csv'  then jsonb_build_object('kind', 'sheet', 'mime', 'text/csv')
  when 'docx' then jsonb_build_object('kind', 'doc',   'mime', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  when 'doc'  then jsonb_build_object('kind', 'doc',   'mime', 'application/msword')
  when 'pptx' then jsonb_build_object('kind', 'slide', 'mime', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  when 'ppt'  then jsonb_build_object('kind', 'slide', 'mime', 'application/vnd.ms-powerpoint')
  when 'txt'  then jsonb_build_object('kind', 'text',  'mime', 'text/plain')
  else null end;
$$;
create or replace function public.chat_file_mimes() returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select array(select distinct public.chat_file_type(x)->>'mime' from unnest(array['jpg','pdf','xlsx','xls','csv','docx','doc','pptx','ppt','txt']) x order by 1);
$$;

-- 置き場所（非公開・1 つ 10MB まで・決まった形だけ）
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
   values ('chat-files', 'chat-files', false, 10485760, public.chat_file_mimes())
   on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
 end if;
end $$;

-- ---------------------------------------------------------------- 表
create table if not exists public.chat_files (
  id uuid primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  owner_emp text not null,
  client_key text not null,
  name text,                                   -- 元の名前（保存するときの名前。消したら消す）
  ext text not null,
  kind text not null check (kind in ('photo','pdf','sheet','doc','slide','text')),
  mime text not null,
  path text not null unique,                   -- 置き場所の中の名前（<会話>/<ファイル>）。小さい写真は path || '.t'
  thumb boolean not null default false,
  w integer, h integer,
  size bigint,
  status text not null check (status in ('up','ok','bad','sent','del','purging','gone')),
  bad_reason text,
  message_id uuid references public.chat_messages(id) on delete set null,
  seq bigint,
  pos smallint,
  wr_id uuid references public.wr_requests(id) on delete set null,   -- 申請の領収書にした（8B）。消しても残す
  created_at timestamptz not null default now(),
  verified_at timestamptz, sent_at timestamptz, deleted_at timestamptz, purge_at timestamptz,
  unique (owner_emp, client_key)
);
create index if not exists chat_files_message_idx on public.chat_files(message_id);
create index if not exists chat_files_thread_idx on public.chat_files(thread_id, seq desc);
create index if not exists chat_files_status_idx on public.chat_files(status, created_at);
alter table public.chat_files enable row level security;
revoke all on public.chat_files from public, anon, authenticated;
grant select, insert, update, delete on public.chat_files to service_role;

-- ---------------------------------------------------------------- 決まり（アプリに渡す）
create or replace function public.chat_limits() returns jsonb
language sql immutable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('body', 2000, 'title', 60, 'group_max', 50, 'edit_hours', 24, 'page', 100, 'reason', 200,
  'files', jsonb_build_object('max', 5, 'size', 10485760, 'thumb', 1048576, 'edge', 2000, 'thumb_edge', 480,
    'exts', jsonb_build_array('jpg','pdf','xlsx','xls','csv','docx','doc','pptx','ppt','txt')));
$$;

-- 元の名前を整える（制御文字・区切りの文字を外す・長さ・拡張子）
create or replace function public.chat_file_name(p_name text, p_ext text) returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare v text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\u0001-\u001f\u007f]', '', 'g'), '[\\/:*?"<>|]', '_', 'g'));
begin
 if lower(right(v, length(p_ext) + 1)) = '.' || lower(p_ext) then v := left(v, length(v) - length(p_ext) - 1); end if;
 v := btrim(v, ' .');
 if v = '' then v := case when p_ext = 'jpg' then 'photo' else 'file' end; end if;
 return left(v, 100) || '.' || lower(p_ext);
end $$;

-- 画面に出す形（置き場所の名前は出さない）
create or replace function public.chat_file_pub(f public.chat_files) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('id', f.id, 'name', f.name, 'ext', f.ext, 'kind', f.kind, 'size', f.size, 'w', f.w, 'h', f.h, 'thumb', f.thumb, 'req', f.wr_id is not null);
$$;

-- 一覧の 1 行の文（本文が空のメッセージ）
create or replace function public.chat_files_label(p_msg uuid) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_ph integer; v_ot integer; v_name text;
begin
 select count(*) filter (where f.kind = 'photo'), count(*) filter (where f.kind <> 'photo'), min(f.name) filter (where f.kind <> 'photo')
   into v_ph, v_ot, v_name from public.chat_files f where f.message_id = p_msg and f.status = 'sent';
 if v_ph > 0 and v_ot = 0 then return '写真 ' || v_ph || ' 枚'; end if;
 if v_ph = 0 and v_ot = 1 then return 'ファイル「' || coalesce(v_name, '') || '」'; end if;
 if v_ph = 0 and v_ot > 1 then return 'ファイル ' || v_ot || ' 個'; end if;
 if v_ph > 0 then return '写真 ' || v_ph || ' 枚・ファイル ' || v_ot || ' 個'; end if;
 return '';
end $$;

-- ---------------------------------------------------------------- 本文（ファイルのあるメッセージは空でもよい）
create or replace function public.chat_body_opt(p_body text) returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare v text := btrim(regexp_replace(coalesce(p_body, ''), '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]', '', 'g'));
begin
 if length(v) > 2000 then raise exception 'bad_value'; end if;
 return v;
end $$;

-- ---------------------------------------------------------------- 置き換え：一覧の 1 行（本文の空いたメッセージは「写真 2 枚」・申請の版と本人か）
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
                 when coalesce(lm.body, '') = '' then public.chat_files_label(lm.id)
                 else left(regexp_replace(lm.body, '\s+', ' ', 'g'), 80) end;
 end if;
 if t.kind = 'case' then
  select * into r from public.wr_requests x where x.id = t.ref_id;
  if found then v_ref := jsonb_build_object('kind', 'wr', 'id', r.id, 'code', r.code, 'wr_kind', r.kind, 'status', r.status, 'store_id', r.store_id,
    'rev', r.rev, 'mine', r.requester_emp is not distinct from a->>'emp'); end if;
 end if;
 if t.kind = 'dm' then select x.emp_id into v_other from public.chat_members x where x.thread_id = t.id and x.emp_id <> a->>'emp' limit 1; end if;
 return jsonb_build_object('id', t.id, 'kind', t.kind, 'title', public.chat_title(a, t), 'other', v_other, 'ref', v_ref, 'members', v_n,
  'created_by', t.created_by, 'created_name', t.created_name, 'rev', t.rev,
  'last_seq', t.last_seq, 'last_at', t.last_at, 'last_read', m.last_read, 'history_from', m.history_from,
  'preview', case when lm.id is null then null else jsonb_build_object('seq', lm.seq, 'name', lm.author_name, 'emp', lm.author_emp, 'text', v_prev, 'at', lm.created_at) end,
  'unread', v_unread, 'mention', v_ment, 'chg', greatest(t.chg, m.chg));
end $$;

-- ---------------------------------------------------------------- 置き換え：メッセージ 1 つ（ファイルも。消した・見えなくしたものは出さない）
create or replace function public.chat_msg(a jsonb, t public.chat_threads, x public.chat_messages) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_read integer := null; v_mine boolean := x.author_emp = a->>'emp'; v_gone boolean := x.deleted_at is not null or x.hidden_at is not null; v_files jsonb := '[]'::jsonb;
begin
 if v_mine then
  select count(*) into v_read from public.chat_members m
   where m.thread_id = t.id and m.left_at is null and m.emp_id <> x.author_emp and m.last_read >= x.seq;
 end if;
 if not v_gone then
  select coalesce(jsonb_agg(public.chat_file_pub(f) order by f.pos, f.id), '[]'::jsonb) into v_files
    from public.chat_files f where f.message_id = x.id and f.status = 'sent';
 end if;
 return jsonb_build_object('id', x.id, 'seq', x.seq, 'emp', x.author_emp, 'name', x.author_name, 'at', x.created_at,
  'body', case when v_gone then null else x.body end,
  'mentions', case when v_gone then '[]'::jsonb else to_jsonb(x.mentions) end,
  'files', v_files,
  'edited', x.edited_at is not null and not v_gone,
  'deleted', x.deleted_at is not null, 'hidden', x.hidden_at is not null,
  'hidden_name', case when x.hidden_at is not null then x.hidden_name end,
  'mine', v_mine, 'read', v_read,
  'can_edit', v_mine and not v_gone and x.created_at > now() - interval '24 hours',
  'can_delete', v_mine and not v_gone,
  'can_hide', public.chat_is_gm(a) and x.deleted_at is null and not v_mine,
  'key', case when v_mine then x.client_key end);
end $$;

-- ---------------------------------------------------------------- ファイルを上げる準備（同じ鍵は同じ 1 つ）
create or replace function public.chat_file_row(f public.chat_files) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select public.chat_file_pub(f) || jsonb_build_object('status', f.status, 'path', f.path, 'thumb_path', case when f.thumb then f.path || '.t' end, 'mime', f.mime);
$$;

create or replace function public.chat_file_start(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; f public.chat_files; v_key text := p->>'client_key';
 v_ext text := lower(coalesce(p->>'ext', '')); v_ty jsonb; v_size bigint; v_w integer := null; v_h integer := null; v_n integer; v_id uuid;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 select * into f from public.chat_files x where x.owner_emp = a->>'emp' and x.client_key = v_key;
 if found then
  if f.thread_id::text is distinct from lower(coalesce(p->>'thread', '')) then raise exception 'conflict'; end if;
  t := public.chat_find(a, p->>'thread');
  return public.chat_file_row(f) || jsonb_build_object('replay', true);
 end if;
 t := public.chat_find(a, p->>'thread');
 v_ty := public.chat_file_type(v_ext);
 if v_ty is null then raise exception 'file_type'; end if;
 if jsonb_typeof(p->'size') <> 'number' then raise exception 'bad_value'; end if;
 v_size := (p->>'size')::bigint;
 if v_size < 1 then raise exception 'bad_value'; end if;
 if v_size > 10485760 then raise exception 'file_big'; end if;
 if v_ty->>'kind' = 'photo' then
  if jsonb_typeof(p->'w') <> 'number' or jsonb_typeof(p->'h') <> 'number' then raise exception 'bad_value'; end if;
  v_w := (p->>'w')::int; v_h := (p->>'h')::int;
  if v_w < 1 or v_h < 1 or v_w > 4000 or v_h > 4000 then raise exception 'bad_value'; end if;
 end if;
 select count(*) into v_n from public.chat_files x where x.owner_emp = a->>'emp' and x.status in ('up','ok','bad') and x.created_at > now() - interval '1 day';
 if v_n >= 30 then raise exception 'file_many'; end if;
 v_id := gen_random_uuid();
 insert into public.chat_files(id, thread_id, owner_emp, client_key, name, ext, kind, mime, path, thumb, w, h, size, status)
  values (v_id, t.id, a->>'emp', v_key, public.chat_file_name(p->>'name', v_ext), v_ext, v_ty->>'kind', v_ty->>'mime',
          t.id::text || '/' || v_id::text, (v_ty->>'kind') = 'photo', v_w, v_h, v_size, 'up')
  returning * into f;
 return public.chat_file_row(f);
end $$;

-- 送る前に確かめるファイル（関数 work-requests だけが使う。本人の・この会話の・まだ送っていないもの）
create or replace function public.chat_file_pending(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); o jsonb := '[]'::jsonb; v text; f public.chat_files;
begin
 if jsonb_typeof(p->'ids') <> 'array' or jsonb_array_length(p->'ids') < 1 or jsonb_array_length(p->'ids') > 5 then raise exception 'bad_value'; end if;
 for v in select jsonb_array_elements_text(p->'ids') loop
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  select * into f from public.chat_files x where x.id = v::uuid and x.owner_emp = a->>'emp' and x.thread_id = t.id;
  if not found then raise exception 'file_bad'; end if;
  o := o || public.chat_file_row(f) || jsonb_build_object('message_id', f.message_id);
 end loop;
 return jsonb_build_object('files', o);
end $$;

-- 確かめた結果（関数 work-requests だけが使う。上げたものの先頭の印と大きさ）
create or replace function public.chat_file_mark(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); f public.chat_files; v_ok boolean;
begin
 if coalesce(p->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'ok') <> 'boolean' then raise exception 'bad_value'; end if;
 v_ok := (p->>'ok')::boolean;
 select * into f from public.chat_files x where x.id = (p->>'id')::uuid and x.owner_emp = a->>'emp' for update;
 if not found then raise exception 'file_bad'; end if;
 if f.status not in ('up','ok','bad') then return public.chat_file_pub(f) || jsonb_build_object('status', f.status); end if;
 update public.chat_files set status = case when v_ok then 'ok' else 'bad' end,
   size = case when v_ok and jsonb_typeof(p->'size') = 'number' then (p->>'size')::bigint else size end,
   bad_reason = case when v_ok then null else left(coalesce(p->>'reason', ''), 60) end, verified_at = now()
  where id = f.id returning * into f;
 return public.chat_file_pub(f) || jsonb_build_object('status', f.status);
end $$;

-- ---------------------------------------------------------------- 置き換え：送る（ファイルは 5 つまで・確かめたものだけ）
create or replace function public.chat_send(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads; v_key text := p->>'client_key'; x public.chat_messages; v_body text; v_m text[];
 r public.wr_requests; v_seq bigint; v_ids uuid[] := '{}'::uuid[]; v text; v_n integer;
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
  -- 本人の・この会話の・確かめた（ok）・まだ送っていないものだけ
  select count(*) into v_n from (select 1 from public.chat_files f where f.id = any(v_ids) and f.owner_emp = a->>'emp' and f.thread_id = t.id
     and f.status = 'ok' and f.message_id is null for update) q;
  if v_n <> cardinality(v_ids) then raise exception 'file_bad'; end if;
 end if;
 if t.kind = 'case' then   -- 案件は、送るたびに決める人・確かめる人を合わせる（段が進んだとき）
  select * into r from public.wr_requests y where y.id = t.ref_id;
  if found then perform public.chat_case_sync(r, t); end if;
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

-- ---------------------------------------------------------------- 置き換え：直す（ファイルのあるメッセージは本文を空にできる）
create or replace function public.chat_edit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); x public.chat_messages := public.chat_msg_find(a, p); t public.chat_threads; v_body text; v_m text[];
begin
 select * into x from public.chat_messages y where y.id = x.id for update;
 if x.author_emp <> a->>'emp' then raise exception 'forbidden'; end if;
 if x.deleted_at is not null or x.hidden_at is not null then raise exception 'conflict'; end if;
 if x.created_at <= now() - interval '24 hours' then raise exception 'too_late'; end if;
 select * into t from public.chat_threads y where y.id = x.thread_id;
 -- IF で分ける（CASE だと、本文が空のとき使わないほうの chat_body も先に計算されて断る＝PostgreSQL の定数の畳み込み）
 if exists (select 1 from public.chat_files f where f.message_id = x.id and f.status = 'sent') then v_body := public.chat_body_opt(p->>'body');
 else v_body := public.chat_body(p->>'body'); end if;
 v_m := public.chat_mentions(t, p->'mentions');
 if v_body = x.body and v_m = x.mentions then return public.chat_msg(a, t, x); end if;
 update public.chat_messages set body = v_body, mentions = v_m, edited_at = now(),
   edits = (case when jsonb_array_length(edits) >= 20 then edits - 0 else edits end) || jsonb_build_object('at', now(), 'body', x.body)
  where id = x.id returning * into x;
 perform public.chat_bump(t.id);
 return public.chat_msg(a, t, x);
end $$;

-- ---------------------------------------------------------------- 置き換え：消す（5A：ファイルも消す。申請の領収書にしたものは残す）
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
 update public.chat_files set status = 'del', deleted_at = now() where message_id = x.id and status = 'sent' and wr_id is null;
 perform public.chat_bump(t.id);
 return public.chat_msg(a, t, x);
end $$;

-- ---------------------------------------------------------------- 開く（参加者・読める範囲・消した／見えなくしたものは開けない）
-- ids は 30 まで（一覧の小さい写真をまとめて）。開けないものは答えに入れない（関数 work-requests が 1 つのときは not_found にする）
create or replace function public.chat_files_access(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); v_thumb boolean := coalesce(p->'thumb' = 'true'::jsonb, false); o jsonb := '[]'::jsonb; v text;
 f public.chat_files; x public.chat_messages; t public.chat_threads; m public.chat_members;
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
  end if;
  continue when m.thread_id is null or x.seq < m.history_from;
  o := o || jsonb_build_object('id', f.id, 'path', case when v_thumb and f.thumb then f.path || '.t' else f.path end, 'name', f.name, 'mime', f.mime, 'kind', f.kind);
 end loop;
 return jsonb_build_object('files', o);
end $$;

-- ---------------------------------------------------------------- 7A：この会話のファイル（新しい順・メッセージ 30 件ずつ）
create or replace function public.chat_files_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.chat_actor(p); t public.chat_threads := public.chat_find(a, p->>'thread'); m public.chat_members := public.chat_member_of(a, t);
 v_before bigint := null; v_lim integer := 30; o jsonb; v_min bigint; v_more boolean;
begin
 if jsonb_typeof(p->'before') = 'number' then v_before := (p->>'before')::bigint; end if;
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(60, greatest(1, (p->>'limit')::int)); end if;
 with msgs as (
  select x.id, x.seq, x.author_emp, x.author_name, x.created_at from public.chat_messages x
   where x.thread_id = t.id and x.seq >= m.history_from and x.deleted_at is null and x.hidden_at is null
     and (v_before is null or x.seq < v_before)
     and exists (select 1 from public.chat_files f where f.message_id = x.id and f.status = 'sent')
   order by x.seq desc limit v_lim)
 select coalesce(jsonb_agg(public.chat_file_pub(f) || jsonb_build_object('seq', g.seq, 'emp', g.author_emp, 'by', g.author_name, 'at', g.created_at)
          order by g.seq desc, f.pos, f.id), '[]'::jsonb), min(g.seq)
   into o, v_min
   from msgs g join public.chat_files f on f.message_id = g.id and f.status = 'sent';
 select exists (select 1 from public.chat_messages x where x.thread_id = t.id and x.seq >= m.history_from and x.seq < coalesce(v_min, 0)
   and x.deleted_at is null and x.hidden_at is null and exists (select 1 from public.chat_files f where f.message_id = x.id and f.status = 'sent')) into v_more;
 return jsonb_build_object('items', o, 'before', v_min, 'more', coalesce(v_more, false));
end $$;

-- ---------------------------------------------------------------- 消す分（関数 work-requests だけが使う。置き場所から消してから gone にする）
-- 消したメッセージのファイル・送らなかったファイル（1 日）・消しかけのまま 10 分たったもの。申請の領収書にしたものは消さない
create or replace function public.chat_file_purge_list(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare o jsonb; v_lim integer := 50;
begin
 if jsonb_typeof(p->'limit') = 'number' then v_lim := least(100, greatest(1, (p->>'limit')::int)); end if;
 with c as (
  select f.id from public.chat_files f
   where f.wr_id is null and (f.status = 'del'
      or (f.status in ('up','ok','bad') and f.message_id is null and f.created_at < now() - interval '1 day')
      or (f.status = 'purging' and f.purge_at < now() - interval '10 minutes'))
   order by f.created_at limit v_lim for update skip locked),
 u as (update public.chat_files f set status = 'purging', purge_at = now() from c where f.id = c.id returning f.id, f.path, f.thumb)
 select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'path', u.path, 'thumb', u.thumb)), '[]'::jsonb) into o from u;
 return jsonb_build_object('files', o);
end $$;
create or replace function public.chat_file_purged(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_n integer;
begin
 if jsonb_typeof(p->'ids') <> 'array' or jsonb_array_length(p->'ids') > 100 then raise exception 'bad_value'; end if;
 update public.chat_files f set status = 'gone', name = null, deleted_at = coalesce(f.deleted_at, now())
  where f.status = 'purging' and f.wr_id is null
    and f.id in (select x::uuid from jsonb_array_elements_text(p->'ids') x where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
 get diagnostics v_n = row_count;
 return jsonb_build_object('gone', v_n);
end $$;

-- ---------------------------------------------------------------- 8B：申請のチャットの写真・PDF を建て替え経費の領収書にする（申請した本人・承認待ちか差し戻し）
create or replace function public.wr_receipt_from_chat(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); r public.wr_requests; f public.chat_files; x public.chat_messages; t public.chat_threads; m public.chat_members;
 v_key text := p->>'client_key'; v_rid uuid; v_ract text; v_now timestamptz := now(); v_ver integer; v_pl jsonb; v_note text;
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

-- 申請の領収書（チャットのファイル）を開く：その申請を見られる人（申請の決まり）。申請に結んだファイルだけ
create or replace function public.wr_receipt_file(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); r public.wr_requests := public.wr_find(a, p); f public.chat_files; v text := r.payload->'receipt'->>'chat_file';
begin
 if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'not_found'; end if;
 select * into f from public.chat_files y where y.id = v::uuid and y.wr_id = r.id and y.status in ('sent','del');
 if not found then raise exception 'not_found'; end if;
 return jsonb_build_object('path', f.path, 'name', f.name, 'mime', f.mime, 'kind', f.kind);
end $$;

-- SQL の段（アプリ・関数が見分ける）：2＝添付
create or replace function public.chat_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('chat', 2) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file')) loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
