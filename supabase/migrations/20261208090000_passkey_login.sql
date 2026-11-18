-- passkey-login（v1189・ログインの段階 3）。仕様：docs/PASSKEY_LOGIN_V1189_JA.md。
-- Moto さんの答え（11/17 12:38 HST・UI案92）：1A Supabase のパスキー（ベータ）／2A ログインの方式を変えるのは GM だけ／
-- 3 送り手は GM の会社のメール（Gmail API。アドレスはこのファイルにもリポジトリにも書かない：4_送り手_SQL.sql を Moto さんが流す）／
-- 4A 招待は 7 日／5B 自分の端末は 12 時間ログインしたまま（開くたびにパスキーを聞かない）／6A GM・CEO・経理はメールとパスワードを残す（パスキーも足せる）／
-- 7A v1183 の「ログインの試し」はやめる／8A ログイン画面の一番上に「パスキーでログイン」／9A 共有の端末にはパスキーを残さない（QR・メールのコード）／
-- 10A ログインが先（このあと (b) RLS の 1 段目）。
-- ・メール＋パスキーにした人（dl_people の mode='passkey'）は、その時から PIN では入れない（招待を済ませる前でも）。PIN の値は消さない。
-- ・招待（7 日）・メールのコード（10 分・5 回まで・1 時間に 5 回まで送る）・ログインのあいだ（12 時間）の値は、ここには sha-256 だけ。
-- ・メールの確かめが済んだ人だけ Supabase Auth の利用者を作る（関数が作る・パスワードは無い）。その人のパスキーは Supabase が持つ。
-- ・失効・PIN に戻す・メールを変える（新しいメールの確かめが済んだとき）では、その人の Supabase の利用者を関数が消す（パスキーとログインがすべて消える）。
-- ・GM・CEO・経理（manager_auth の ceo・gm・office・suspended）は、この表に入れない（メールとパスワードのまま。パスキーは本人がマイページで足す）。
-- 表も関数もサーバーの鍵（service_role）だけ。公開の鍵（anon・authenticated）では読めない・呼べない。security invoker・search_path 固定。
-- 社員の表・manager_auth・auth_pins は読むだけ（書かない）。2 回流しても同じ（表は if not exists・関数は create or replace）。

do $$
begin
 if to_regprocedure('public.dl_pin_stage()') is null or to_regprocedure('public.dl_email_login(jsonb)') is null then
  raise exception 'STOP: 先に v1183・v1185・v1186（deploy/pin-off-v1186/2_SQL.sql）を流してください。何も変えていません。';
 end if;
 if public.dl_pin_stage() < 2 then
  raise exception 'STOP: 先に 20261207090000_pin_blocked_id_first.sql（deploy/pin-off-v1186/2_SQL.sql）を流してください。何も変えていません。';
 end if;
end $$;

create table if not exists public.dl_people (
 emp_id text primary key,
 mode text not null default 'pin' check (mode in ('pin', 'passkey')),
 email text,
 email_norm text unique,
 email_new text,                            -- 変えたいメール（新しいメールの確かめが済むまでは前のメールのまま）
 email_new_norm text unique,
 auth_uid uuid unique,                      -- Supabase Auth の利用者（メールの確かめが済んでから関数が作る）
 confirmed_at timestamptz,
 keys_at timestamptz,                       -- 本人がパスキーを保存した最後の時刻（表示だけ）
 ver integer not null default 1,            -- 失効・PIN に戻す・メールの変更で進む（前の招待・コード・ログインは使えない）
 set_by text,
 set_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.dl_pk_invites (
 id uuid primary key default gen_random_uuid(),
 emp_id text not null,
 token_hash text not null unique,           -- 招待の URL の値の sha-256。値そのものは残さない
 purpose text not null check (purpose in ('invite', 'email_change')),
 email text not null,
 email_norm text not null,
 ver integer not null,
 created_by text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 revoked_at timestamptz,
 revoke_reason text,
 send_state text not null default 'pending' check (send_state in ('pending', 'sent', 'failed')),
 sent_at timestamptz,
 send_error text
);
create index if not exists dl_pk_invites_emp on public.dl_pk_invites (emp_id, created_at desc);

create table if not exists public.dl_pk_codes (
 id uuid primary key default gen_random_uuid(),
 emp_id text not null,
 invite_id uuid,
 purpose text not null check (purpose in ('invite', 'login')),
 email_norm text not null,
 ver integer not null,
 salt text not null,
 code_hash text not null,                   -- sha-256（塩・6 桁）。コードそのものは残さない
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 tries integer not null default 0,
 used_at timestamptz,
 dead_at timestamptz
);
create index if not exists dl_pk_codes_emp on public.dl_pk_codes (emp_id, created_at desc);

create table if not exists public.dl_pk_sessions (
 id uuid primary key default gen_random_uuid(),
 emp_id text not null,
 token_hash text not null unique,           -- ログインのあいだの値の sha-256
 ver integer not null,
 via text not null check (via in ('passkey', 'code', 'invite')),
 keep boolean not null default false,       -- 本人の端末で 12 時間ログインしたまま（5B）
 device_name text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 last_used_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoke_reason text
);
create index if not exists dl_pk_sessions_emp on public.dl_pk_sessions (emp_id, created_at desc);

create table if not exists public.dl_mail (
 id integer primary key check (id = 1),
 from_addr text,                            -- 送り手（GM の会社のメール）。4_送り手_SQL.sql で入れる（リポジトリに書かない）
 account text,                              -- つないだ Google のアカウント（from_addr と同じでなければ保存しない）
 refresh_token text,
 state text not null default 'none' check (state in ('none', 'ok', 'expired')),
 oauth_state_hash text,
 oauth_verifier text,
 oauth_at timestamptz,
 oauth_by text,
 connected_at timestamptz,
 connected_by text,
 last_ok_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
insert into public.dl_mail (id) values (1) on conflict (id) do nothing;

do $$
declare t text;
begin
 foreach t in array array['dl_people', 'dl_pk_invites', 'dl_pk_codes', 'dl_pk_sessions', 'dl_mail'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update, delete on public.%I to service_role', t);
 end loop;
end $$;

-- ===== 小さな部品 =====
-- メール：前後の空白を外して小文字。形が違えば null
create or replace function public.dl_pk_norm(p_email text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case when x ~ '^[^@[:space:]<>"'',;()\[\]\\]{1,64}@[^@[:space:]<>"'',;()\[\]\\]{1,190}\.[a-z]{2,24}$' and length(x) <= 254 then x end
 from (select lower(btrim(coalesce(p_email, ''))) as x) s;
$$;

-- 本人に見せるメール（招待の画面）：最初と最後の 1 文字だけ
create or replace function public.dl_pk_mask(p_email text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case when p_email is null or position('@' in p_email) < 2 then null
  else case when length(split_part(p_email, '@', 1)) <= 2 then left(p_email, 1) || '•••'
   else left(p_email, 1) || '•••••' || right(split_part(p_email, '@', 1), 1) end || '@' || split_part(p_email, '@', 2) end;
$$;

-- GM・CEO・経理か（この表に入れない人）：社員の役割（列か中身）か、メールのアカウント（manager_auth）
create or replace function public.dl_pk_is_mgr(p_emp text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare j jsonb; d jsonb;
begin
 if exists (select 1 from public.manager_auth m where m.emp_id::text = p_emp and m.role in ('ceo', 'gm', 'office', 'suspended')) then return true; end if;
 select to_jsonb(e) into j from public.employees e where e.id::text = p_emp;
 if j is null then return false; end if;
 d := case when jsonb_typeof(j->'data') = 'object' then j->'data' else '{}'::jsonb end;
 return coalesce(nullif(j->>'role', ''), d->>'role', '') in ('ceo', 'gm', 'office') or coalesce(d->>'role', '') in ('ceo', 'gm', 'office');
end $$;

-- GM だけ（2A）：メールのログイン → manager_auth の役割 gm・在籍
create or replace function public.dl_pk_admin(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a uuid; r text; v_emp text; e jsonb;
begin
 if coalesce(p->>'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 a := (p->>'actor')::uuid;
 select m.role, m.emp_id::text into r, v_emp from public.manager_auth m where m.user_id = a;
 if r is distinct from 'gm' then raise exception 'forbidden'; end if;
 if v_emp is not null and v_emp <> '' then
  e := public.dl_emp(v_emp);
  if e is not null and (e->>'out')::boolean then raise exception 'forbidden'; end if;
 end if;
 return jsonb_build_object('uid', a, 'role', r, 'emp_id', v_emp, 'name', coalesce(nullif(e->>'name', ''), 'GM'));
end $$;

-- 1 人の状態（GM の一覧・右のパネル）
create or replace function public.dl_pk_person(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e jsonb; pp public.dl_people; i public.dl_pk_invites; v_inv text; v_act integer; v_last timestamptz; v_mgr boolean; v_need text;
begin
 e := public.dl_emp(p_emp);
 v_mgr := public.dl_pk_is_mgr(p_emp);
 select * into pp from public.dl_people x where x.emp_id = p_emp;
 select * into i from public.dl_pk_invites x where x.emp_id = p_emp order by x.created_at desc limit 1;
 v_inv := case when i.id is null then null when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
  when i.expires_at <= now() then 'expired' else 'pending' end;
 select count(*) filter (where s.revoked_at is null and s.expires_at > now()), max(s.last_used_at)
  into v_act, v_last from public.dl_pk_sessions s where s.emp_id = p_emp;
 v_need := case
  when v_mgr or pp.mode is distinct from 'passkey' then null
  when v_inv = 'pending' and i.send_state = 'failed' then 'send_failed'
  when pp.confirmed_at is null and (v_inv is null or v_inv in ('expired', 'revoked')) then 'invite_expired'
  when pp.email_new is not null and (v_inv is null or v_inv in ('expired', 'revoked')) then 'email_change_expired'
  when pp.confirmed_at is not null and pp.auth_uid is null and pp.keys_at is null and v_act = 0 then 'no_login'
  else null end;
 return jsonb_build_object('emp_id', p_emp, 'name', coalesce(e->>'name', ''), 'store', coalesce(e->>'store', ''), 'role', coalesce(e->>'role', ''),
  'missing', e is null, 'out', coalesce((e->>'out')::boolean, false),
  'method', case when v_mgr then 'email' when pp.mode = 'passkey' then 'passkey' else 'pin' end,
  'email', pp.email, 'email_new', pp.email_new, 'confirmed_at', pp.confirmed_at, 'keys_at', pp.keys_at, 'linked', pp.auth_uid is not null,
  'invite', case when i.id is null then null else jsonb_build_object('state', v_inv, 'purpose', i.purpose, 'created_at', i.created_at, 'expires_at', i.expires_at,
   'send_state', i.send_state, 'sent_at', i.sent_at, 'to', i.email, 'ver', i.ver) end,
  'sessions', v_act, 'last_login', v_last, 'need', v_need, 'set_at', pp.set_at, 'ver', coalesce(pp.ver, 0));
end $$;

-- 送り手の状態（GM に見せる：トークンは出さない）
create or replace function public.dl_pk_mail_public() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('from_set', m.from_addr is not null, 'from', m.from_addr, 'account', m.account, 'state', m.state,
   'connected_at', m.connected_at, 'last_ok_at', m.last_ok_at, 'last_error', m.last_error)
 from public.dl_mail m where m.id = 1;
$$;

-- 消すもの：コード 1 日・終わったログインのあいだ 30 日（記録は dl_prune が 180 日）
create or replace function public.dl_pk_prune() returns integer
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare n integer; m integer;
begin
 delete from public.dl_pk_codes where created_at < now() - interval '1 day';
 get diagnostics n = row_count;
 delete from public.dl_pk_sessions where coalesce(revoked_at, expires_at) < now() - interval '30 days';
 get diagnostics m = row_count;
 return n + m;
end $$;

-- ===== GM の画面「ログインの方式」 =====
create or replace function public.dl_pk_admin_list(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p);
begin
 perform public.dl_prune();
 perform public.dl_pk_prune();
 return jsonb_build_object('me', a, 'now', now(), 'mail', public.dl_pk_mail_public(), 'people',
  coalesce((select jsonb_agg(public.dl_pk_person(x.id) order by x.id)
   from (select e.j->>'id' as id
         from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
         where not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true')
         union select pp.emp_id from public.dl_people pp where pp.mode = 'passkey') x), '[]'::jsonb));
end $$;

-- 前の招待・コード・ログインを止める（ver を進めたときに使う）
create or replace function public.dl_pk_close(p_emp text, p_reason text, p_sessions boolean) returns void
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 update public.dl_pk_invites set revoked_at = now(), revoke_reason = left(p_reason, 40) where emp_id = p_emp and used_at is null and revoked_at is null;
 update public.dl_pk_codes set dead_at = now() where emp_id = p_emp and used_at is null and dead_at is null;
 if p_sessions then
  update public.dl_pk_sessions set revoked_at = now(), revoke_reason = left(p_reason, 40) where emp_id = p_emp and revoked_at is null;
 end if;
end $$;

-- 招待を作る（前の招待は取り消す・7 日）。値は関数が作って、ここには sha-256 だけ
create or replace function public.dl_pk_invite_new(p_emp text, p_hash text, p_purpose text, p_email text, p_by text) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_id uuid; v_exp timestamptz := now() + interval '7 days'; pp public.dl_people;
begin
 if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad_value'; end if;
 select * into pp from public.dl_people x where x.emp_id = p_emp for update;
 update public.dl_pk_invites set revoked_at = now(), revoke_reason = 'reissued' where emp_id = p_emp and used_at is null and revoked_at is null;
 update public.dl_pk_codes set dead_at = now() where emp_id = p_emp and purpose = 'invite' and used_at is null and dead_at is null;
 insert into public.dl_pk_invites (emp_id, token_hash, purpose, email, email_norm, ver, created_by, expires_at)
  values (p_emp, p_hash, p_purpose, p_email, public.dl_pk_norm(p_email), pp.ver, p_by, v_exp) returning id into v_id;
 return jsonb_build_object('invite_id', v_id, 'expires_at', v_exp, 'to', p_email, 'purpose', p_purpose);
end $$;

-- メール＋パスキーにする（1 人ずつ。told＝本人に伝えた・伝える）
create or replace function public.dl_pk_admin_set(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); e jsonb; v_email text := btrim(coalesce(p->>'email', ''));
 v_norm text := public.dl_pk_norm(p->>'email'); pp public.dl_people; inv jsonb; v_by text := 'admin:' || (a->>'uid');
begin
 if jsonb_typeof(p->'told') is distinct from 'boolean' or not (p->>'told')::boolean then raise exception 'bad_value'; end if;
 e := public.dl_emp(v_emp);
 if e is null then raise exception 'not_found'; end if;
 if (e->>'out')::boolean then raise exception 'inactive'; end if;
 if public.dl_pk_is_mgr(v_emp) then raise exception 'top_not_allowed'; end if;
 if v_norm is null then raise exception 'bad_email'; end if;
 perform pg_advisory_xact_lock(hashtext('dl_pk_email|' || v_norm));
 if exists (select 1 from public.dl_people x where x.emp_id <> v_emp and (x.email_norm = v_norm or x.email_new_norm = v_norm)) then raise exception 'email_taken'; end if;
 insert into public.dl_people (emp_id, mode, set_by) values (v_emp, 'pin', v_by) on conflict (emp_id) do nothing;
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 if pp.mode = 'passkey' then raise exception 'already'; end if;
 update public.dl_people set mode = 'passkey', email = left(v_email, 254), email_norm = v_norm, email_new = null, email_new_norm = null,
  auth_uid = null, confirmed_at = null, keys_at = null, ver = ver + 1, set_by = v_by, set_at = now(), updated_at = now() where emp_id = v_emp;
 perform public.dl_pk_close(v_emp, 'mode_set', true);
 inv := public.dl_pk_invite_new(v_emp, p->>'invite_hash', 'invite', left(v_email, 254), v_by);
 perform public.dl_log('pk_set', v_emp, null, v_by, 'ok', 'passkey', p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'name', e->>'name', 'invite', inv, 'person', public.dl_pk_person(v_emp));
end $$;

-- 招待を送り直す（新しい招待・前の招待は取り消す）。メールを変える途中なら新しいメールへ
create or replace function public.dl_pk_admin_invite(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); e jsonb; pp public.dl_people; inv jsonb; v_by text := 'admin:' || (a->>'uid');
begin
 e := public.dl_emp(v_emp);
 if e is null then raise exception 'not_found'; end if;
 if (e->>'out')::boolean then raise exception 'inactive'; end if;
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 if pp.mode is distinct from 'passkey' then raise exception 'not_passkey'; end if;
 if pp.email_new is not null then inv := public.dl_pk_invite_new(v_emp, p->>'invite_hash', 'email_change', pp.email_new, v_by);
 else inv := public.dl_pk_invite_new(v_emp, p->>'invite_hash', 'invite', pp.email, v_by); end if;
 perform public.dl_log('pk_invite', v_emp, null, v_by, 'ok', inv->>'purpose', p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'name', e->>'name', 'invite', inv, 'person', public.dl_pk_person(v_emp));
end $$;

-- 関数がメールを送ったあと（送れた・送れなかった）
create or replace function public.dl_pk_invite_sent(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_id uuid; v_ok boolean := coalesce((p->>'ok')::boolean, false); v_emp text;
begin
 begin v_id := (p->>'invite_id')::uuid; exception when others then raise exception 'bad_value'; end;
 update public.dl_pk_invites set send_state = case when v_ok then 'sent' else 'failed' end, sent_at = case when v_ok then now() else sent_at end,
  send_error = case when v_ok then null else left(p->>'error', 120) end where id = v_id returning emp_id into v_emp;
 perform public.dl_log('pk_invite_mail', v_emp, null, 'function', case when v_ok then 'ok' else 'fail' end, left(p->>'error', 120), null, null);
 return jsonb_build_object('ok', true, 'person', case when v_emp is null then null else public.dl_pk_person(v_emp) end);
end $$;

create or replace function public.dl_pk_admin_invite_revoke(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); n integer;
begin
 update public.dl_pk_invites set revoked_at = now(), revoke_reason = 'admin' where emp_id = v_emp and used_at is null and revoked_at is null;
 get diagnostics n = row_count;
 update public.dl_pk_codes set dead_at = now() where emp_id = v_emp and purpose = 'invite' and used_at is null and dead_at is null;
 perform public.dl_log('pk_invite_revoke', v_emp, null, 'admin:' || (a->>'uid'), case when n > 0 then 'ok' else 'none' end, null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'revoked', n, 'person', public.dl_pk_person(v_emp));
end $$;

-- メールを変える（③）：確かめが済んだ人は、新しいメールの確かめが済むまで前のメールのまま。まだの人はすぐ変えて招待し直す
create or replace function public.dl_pk_admin_email(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); e jsonb; pp public.dl_people; inv jsonb; v_by text := 'admin:' || (a->>'uid');
 v_email text := btrim(coalesce(p->>'email', '')); v_norm text := public.dl_pk_norm(p->>'email');
begin
 e := public.dl_emp(v_emp);
 if e is null then raise exception 'not_found'; end if;
 if (e->>'out')::boolean then raise exception 'inactive'; end if;
 if v_norm is null then raise exception 'bad_email'; end if;
 perform pg_advisory_xact_lock(hashtext('dl_pk_email|' || v_norm));
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 if pp.mode is distinct from 'passkey' then raise exception 'not_passkey'; end if;
 if exists (select 1 from public.dl_people x where x.emp_id <> v_emp and (x.email_norm = v_norm or x.email_new_norm = v_norm)) then raise exception 'email_taken'; end if;
 if pp.email_norm = v_norm then
  update public.dl_people set email_new = null, email_new_norm = null, updated_at = now() where emp_id = v_emp;   -- 前のメールに戻した（変えるのをやめた）
  update public.dl_pk_invites set revoked_at = now(), revoke_reason = 'email_kept' where emp_id = v_emp and purpose = 'email_change' and used_at is null and revoked_at is null;
  perform public.dl_log('pk_email', v_emp, null, v_by, 'ok', 'kept', p->>'ip', p->>'ua');
  return jsonb_build_object('ok', true, 'name', e->>'name', 'invite', null, 'person', public.dl_pk_person(v_emp));
 end if;
 if pp.confirmed_at is null then
  update public.dl_people set email = left(v_email, 254), email_norm = v_norm, email_new = null, email_new_norm = null, ver = ver + 1, updated_at = now() where emp_id = v_emp;
  perform public.dl_pk_close(v_emp, 'email_changed', true);
  inv := public.dl_pk_invite_new(v_emp, p->>'invite_hash', 'invite', left(v_email, 254), v_by);
 else
  update public.dl_people set email_new = left(v_email, 254), email_new_norm = v_norm, updated_at = now() where emp_id = v_emp;
  inv := public.dl_pk_invite_new(v_emp, p->>'invite_hash', 'email_change', left(v_email, 254), v_by);
 end if;
 perform public.dl_log('pk_email', v_emp, null, v_by, 'ok', inv->>'purpose', p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'name', e->>'name', 'invite', inv, 'person', public.dl_pk_person(v_emp));
end $$;

-- ログインとパスキーを失効（端末をなくした）：ログインのあいだ・招待・コードを止め、Supabase の利用者を外す（関数が消す）。
-- メール＋パスキーのまま（本人はメールのコードで入り直して、パスキーを保存し直す）
create or replace function public.dl_pk_admin_revoke(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); pp public.dl_people; v_by text := 'admin:' || (a->>'uid');
begin
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 if pp.mode is distinct from 'passkey' then raise exception 'not_passkey'; end if;
 update public.dl_people set ver = ver + 1, auth_uid = null, keys_at = null, updated_at = now() where emp_id = v_emp;
 perform public.dl_pk_close(v_emp, 'admin_revoke', true);
 perform public.dl_log('pk_revoke', v_emp, null, v_by, 'ok', null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'old_uid', pp.auth_uid, 'person', public.dl_pk_person(v_emp));
end $$;

-- PIN に戻す（関数は先に auth-pin で新しい PIN を入れてから呼ぶ）。メールは記録に残す
create or replace function public.dl_pk_admin_pin(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); pp public.dl_people; v_by text := 'admin:' || (a->>'uid');
begin
 if jsonb_typeof(p->'pin_set') is distinct from 'boolean' or not (p->>'pin_set')::boolean then raise exception 'pin_first'; end if;
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 if pp.mode is distinct from 'passkey' then raise exception 'not_passkey'; end if;
 update public.dl_people set mode = 'pin', ver = ver + 1, auth_uid = null, confirmed_at = null, keys_at = null, email_new = null, email_new_norm = null,
  set_by = v_by, set_at = now(), updated_at = now() where emp_id = v_emp;
 perform public.dl_pk_close(v_emp, 'back_to_pin', true);
 perform public.dl_log('pk_pin', v_emp, null, v_by, 'ok', null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'old_uid', pp.auth_uid, 'person', public.dl_pk_person(v_emp));
end $$;

-- 右のパネル：招待・ログインのあいだ・記録
create or replace function public.dl_pk_admin_detail(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); v_emp text := nullif(p->>'emp_id', ''); v_uid uuid;
begin
 select x.auth_uid into v_uid from public.dl_people x where x.emp_id = v_emp;
 return jsonb_build_object('ok', true, 'person', public.dl_pk_person(v_emp), 'auth_uid', v_uid,
  'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'via', s.via, 'keep', s.keep, 'device_name', s.device_name, 'created_at', s.created_at,
    'expires_at', s.expires_at, 'last_used_at', s.last_used_at) order by s.created_at desc)
   from public.dl_pk_sessions s where s.emp_id = v_emp and s.revoked_at is null and s.expires_at > now()), '[]'::jsonb),
  'log', coalesce((select jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'result', ev.result, 'reason', ev.reason,
    'by', case when ev.actor like 'admin:%' then 'GM' when ev.actor like 'mail:%' then 'mail' else ev.actor end) order by ev.at desc)
   from (select * from public.dl_events x where x.emp_id = v_emp and x.kind like 'pk\_%' order by x.at desc limit 30) ev), '[]'::jsonb));
end $$;

-- ===== 招待の画面・メールのコード（ログイン不要） =====
create or replace function public.dl_pk_invite_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare i public.dl_pk_invites; pp public.dl_people; e jsonb;
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'gone'); end if;
 select * into i from public.dl_pk_invites x where x.token_hash = p->>'token_hash';
 if i.id is null then return jsonb_build_object('state', 'gone'); end if;
 if i.used_at is not null then return jsonb_build_object('state', 'used'); end if;
 if i.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
 if i.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
 select * into pp from public.dl_people x where x.emp_id = i.emp_id;
 e := public.dl_emp(i.emp_id);
 if pp.mode is distinct from 'passkey' or pp.ver <> i.ver or e is null then return jsonb_build_object('state', 'revoked'); end if;
 if (e->>'out')::boolean then return jsonb_build_object('state', 'inactive'); end if;
 return jsonb_build_object('state', 'ok', 'invite_id', i.id, 'emp_id', i.emp_id, 'name', e->>'name', 'email_masked', public.dl_pk_mask(i.email),
  'expires_at', i.expires_at, 'purpose', i.purpose);
end $$;

-- コードを作る（関数が 6 桁と塩を作り、ここには sha-256 だけ）。1 分あけて・1 時間に 5 回まで。
-- メールで（ログインのコード）：そのメールの人がいなくても同じ答え（quiet）
create or replace function public.dl_pk_code_new(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare i public.dl_pk_invites; pp public.dl_people; e jsonb; v_emp text; v_purpose text; v_email text; v_norm text; v_inv uuid; v_last timestamptz; n integer; v_id uuid;
begin
 if coalesce(p->>'code_hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'salt', '') !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'bad_value'; end if;
 if p ? 'token_hash' then
  select * into i from public.dl_pk_invites x where x.token_hash = p->>'token_hash' for update;
  if i.id is null or i.used_at is not null or i.revoked_at is not null or i.expires_at <= now() then raise exception 'invite_gone'; end if;
  select * into pp from public.dl_people x where x.emp_id = i.emp_id for update;
  if pp.mode is distinct from 'passkey' or pp.ver <> i.ver then raise exception 'invite_gone'; end if;
  v_emp := i.emp_id; v_purpose := 'invite'; v_email := i.email; v_norm := i.email_norm; v_inv := i.id;
 elsif p ? 'emp_id' then
  -- 名前を選んだあと（ログイン画面）：その人の確かめたメールへ。メール＋パスキーでなければ同じ答え（quiet）
  select * into pp from public.dl_people x where x.emp_id = nullif(p->>'emp_id', '') and x.mode = 'passkey' and x.confirmed_at is not null for update;
  if pp.emp_id is null then
   perform public.dl_log('pk_code', left(p->>'emp_id', 64), null, 'device', 'quiet', 'no_person', p->>'ip', p->>'ua');
   return jsonb_build_object('state', 'quiet');
  end if;
  v_emp := pp.emp_id; v_purpose := 'login'; v_email := pp.email; v_norm := pp.email_norm;
 else
  v_norm := public.dl_pk_norm(p->>'email');
  if v_norm is null then raise exception 'bad_email'; end if;
  select * into pp from public.dl_people x where x.email_norm = v_norm and x.mode = 'passkey' and x.confirmed_at is not null for update;
  if pp.emp_id is null then
   perform public.dl_log('pk_code', null, null, 'device', 'quiet', 'no_person', p->>'ip', p->>'ua');
   return jsonb_build_object('state', 'quiet');
  end if;
  v_emp := pp.emp_id; v_purpose := 'login'; v_email := pp.email;
 end if;
 e := public.dl_emp(v_emp);
 if e is null or (e->>'out')::boolean then
  if v_purpose = 'login' then perform public.dl_log('pk_code', v_emp, null, 'device', 'quiet', 'inactive', p->>'ip', p->>'ua'); return jsonb_build_object('state', 'quiet'); end if;
  raise exception 'inactive';
 end if;
 select max(c.created_at), count(*) filter (where c.created_at > now() - interval '1 hour') into v_last, n
  from public.dl_pk_codes c where c.emp_id = v_emp and c.purpose = v_purpose;
 if v_last > now() - interval '60 seconds' then
  return jsonb_build_object('state', 'wait', 'retry_after', greatest(1, ceil(extract(epoch from (v_last + interval '60 seconds' - now())))::integer));
 end if;
 if n >= 5 then
  perform public.dl_log('pk_code', v_emp, null, 'device', 'fail', 'too_many', p->>'ip', p->>'ua');
  raise exception 'too_many';
 end if;
 update public.dl_pk_codes set dead_at = now() where emp_id = v_emp and purpose = v_purpose and used_at is null and dead_at is null;
 insert into public.dl_pk_codes (emp_id, invite_id, purpose, email_norm, ver, salt, code_hash, expires_at)
  values (v_emp, v_inv, v_purpose, v_norm, pp.ver, p->>'salt', p->>'code_hash', now() + interval '10 minutes') returning id into v_id;
 perform public.dl_log('pk_code', v_emp, null, 'device', 'ok', v_purpose, p->>'ip', p->>'ua');
 return jsonb_build_object('state', 'ok', 'code_id', v_id, 'to', v_email, 'name', e->>'name', 'purpose', v_purpose);
end $$;

-- 送れなかったコードは使えなくする
create or replace function public.dl_pk_code_sent(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_id uuid; v_emp text;
begin
 begin v_id := (p->>'code_id')::uuid; exception when others then raise exception 'bad_value'; end;
 if coalesce((p->>'ok')::boolean, false) then return jsonb_build_object('ok', true); end if;
 update public.dl_pk_codes set dead_at = now() where id = v_id returning emp_id into v_emp;
 perform public.dl_log('pk_code_mail', v_emp, null, 'function', 'fail', left(p->>'error', 120), null, null);
 return jsonb_build_object('ok', true);
end $$;

-- 確かめる前に：今使えるコードの塩（招待かメールで）
create or replace function public.dl_pk_code_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare c public.dl_pk_codes; i public.dl_pk_invites; v_norm text;
begin
 if p ? 'token_hash' then
  select * into i from public.dl_pk_invites x where x.token_hash = p->>'token_hash';
  if i.id is null then return jsonb_build_object('state', 'none'); end if;
  select * into c from public.dl_pk_codes x where x.invite_id = i.id and x.used_at is null and x.dead_at is null and x.expires_at > now() and x.tries < 5
   order by x.created_at desc limit 1;
 elsif p ? 'emp_id' then
  select * into c from public.dl_pk_codes x where x.emp_id = nullif(p->>'emp_id', '') and x.purpose = 'login' and x.used_at is null and x.dead_at is null and x.expires_at > now() and x.tries < 5
   order by x.created_at desc limit 1;
 else
  v_norm := public.dl_pk_norm(p->>'email');
  if v_norm is null then return jsonb_build_object('state', 'none'); end if;
  select * into c from public.dl_pk_codes x where x.email_norm = v_norm and x.purpose = 'login' and x.used_at is null and x.dead_at is null and x.expires_at > now() and x.tries < 5
   order by x.created_at desc limit 1;
 end if;
 if c.id is null then return jsonb_build_object('state', 'none'); end if;
 return jsonb_build_object('state', 'ok', 'code_id', c.id, 'salt', c.salt);
end $$;

-- コードを確かめる（間違い 5 回で使えなくする）。合えば 1 回だけ使い、招待なら確かめを済ませる。
-- メールの変更（email_change）が済んだら、新しいメールにして ver を進める（前のログイン・パスキーは止める：old_uid は関数が消す）
create or replace function public.dl_pk_code_check(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare c public.dl_pk_codes; pp public.dl_people; i public.dl_pk_invites; e jsonb; v_id uuid; v_old uuid; v_left integer;
begin
 begin v_id := (p->>'code_id')::uuid; exception when others then raise exception 'bad_value'; end;
 if coalesce(p->>'code_hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'bad_value'; end if;
 select * into c from public.dl_pk_codes x where x.id = v_id for update;
 if c.id is null or c.used_at is not null or c.dead_at is not null or c.expires_at <= now() or c.tries >= 5 then return jsonb_build_object('state', 'code_gone'); end if;
 if c.code_hash <> p->>'code_hash' then
  update public.dl_pk_codes set tries = tries + 1, dead_at = case when tries + 1 >= 5 then now() end where id = v_id;
  v_left := greatest(0, 4 - c.tries);
  perform public.dl_log('pk_code_check', c.emp_id, null, 'device', 'fail', 'wrong', p->>'ip', p->>'ua');
  return jsonb_build_object('state', case when v_left = 0 then 'code_gone' else 'code_wrong' end, 'left', v_left);
 end if;
 update public.dl_pk_codes set used_at = now() where id = v_id;
 select * into pp from public.dl_people x where x.emp_id = c.emp_id for update;
 e := public.dl_emp(c.emp_id);
 if pp.mode is distinct from 'passkey' or pp.ver <> c.ver or e is null then return jsonb_build_object('state', 'code_gone'); end if;
 if (e->>'out')::boolean then return jsonb_build_object('state', 'inactive'); end if;
 if c.purpose = 'invite' then
  select * into i from public.dl_pk_invites x where x.id = c.invite_id for update;
  if i.id is null or i.used_at is not null or i.revoked_at is not null or i.expires_at <= now() or i.ver <> pp.ver then return jsonb_build_object('state', 'invite_gone'); end if;
  update public.dl_pk_invites set used_at = now() where id = i.id;
  if i.purpose = 'email_change' then
   if pp.email_new_norm is distinct from i.email_norm then return jsonb_build_object('state', 'invite_gone'); end if;
   v_old := pp.auth_uid;
   update public.dl_people set email = email_new, email_norm = email_new_norm, email_new = null, email_new_norm = null, auth_uid = null, keys_at = null,
    ver = ver + 1, confirmed_at = now(), updated_at = now() where emp_id = c.emp_id;
   perform public.dl_pk_close(c.emp_id, 'email_changed', true);
  else
   update public.dl_people set confirmed_at = coalesce(confirmed_at, now()), updated_at = now() where emp_id = c.emp_id;
  end if;
 end if;
 select * into pp from public.dl_people x where x.emp_id = c.emp_id;
 perform public.dl_log('pk_code_check', c.emp_id, null, 'device', 'ok', c.purpose, p->>'ip', p->>'ua');
 return jsonb_build_object('state', 'ok', 'emp_id', c.emp_id, 'name', e->>'name', 'email', pp.email, 'ver', pp.ver, 'auth_uid', pp.auth_uid, 'old_uid', v_old,
  'via', case when c.purpose = 'invite' then 'invite' else 'code' end);
end $$;

-- メールの確かめが済んだ人を Supabase の利用者に結ぶ（関数が作った・見つけた利用者）。GM・CEO・経理の利用者・ほかの人の利用者は結ばない
create or replace function public.dl_pk_link_uid(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_uid uuid; v_emp text := nullif(p->>'emp_id', ''); n integer;
begin
 begin v_uid := (p->>'uid')::uuid; exception when others then raise exception 'bad_value'; end;
 if exists (select 1 from public.manager_auth m where m.user_id = v_uid) then raise exception 'email_taken'; end if;
 if exists (select 1 from public.dl_people x where x.auth_uid = v_uid and x.emp_id <> v_emp) then raise exception 'email_taken'; end if;
 update public.dl_people set auth_uid = v_uid, updated_at = now() where emp_id = v_emp and mode = 'passkey' and ver = (p->>'ver')::integer and confirmed_at is not null;
 get diagnostics n = row_count;
 if n = 0 then raise exception 'session_gone'; end if;
 return jsonb_build_object('ok', true);
end $$;

-- ログインのあいだを作る（12 時間・1 人 10 まで）
create or replace function public.dl_pk_session_new(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); pp public.dl_people; e jsonb; v_exp timestamptz := now() + interval '12 hours'; v_via text := p->>'via';
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' or v_via not in ('passkey', 'code', 'invite') then raise exception 'bad_value'; end if;
 select * into pp from public.dl_people x where x.emp_id = v_emp for update;
 e := public.dl_emp(v_emp);
 if pp.mode is distinct from 'passkey' or pp.ver <> (p->>'ver')::integer or e is null then raise exception 'session_gone'; end if;
 if (e->>'out')::boolean then raise exception 'inactive'; end if;
 insert into public.dl_pk_sessions (emp_id, token_hash, ver, via, keep, device_name, expires_at)
  values (v_emp, p->>'token_hash', pp.ver, v_via, coalesce((p->>'keep')::boolean, false), nullif(left(regexp_replace(coalesce(p->>'device_name', ''), '[[:cntrl:]<>]', '', 'g'), 60), ''), v_exp);
 update public.dl_pk_sessions set revoked_at = now(), revoke_reason = 'too_many' where id in (
  select s.id from public.dl_pk_sessions s where s.emp_id = v_emp and s.revoked_at is null and s.expires_at > now() order by s.created_at desc offset 10);
 perform public.dl_log('pk_login', v_emp, null, 'device', 'ok', v_via, p->>'ip', p->>'ua');
 return jsonb_build_object('state', 'ok', 'emp_id', v_emp, 'name', e->>'name', 'role', e->>'role', 'store', e->>'store', 'expires_at', v_exp);
end $$;

-- 開いた（start）・裏で確かめる（refresh）。止まっていれば session_gone・inactive
create or replace function public.dl_pk_session_check(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare s public.dl_pk_sessions; pp public.dl_people; e jsonb;
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'session_gone'); end if;
 select * into s from public.dl_pk_sessions x where x.token_hash = p->>'token_hash';
 if s.id is null or s.revoked_at is not null or s.expires_at <= now() then return jsonb_build_object('state', 'session_gone'); end if;
 select * into pp from public.dl_people x where x.emp_id = s.emp_id;
 e := public.dl_emp(s.emp_id);
 if pp.mode is distinct from 'passkey' or pp.ver <> s.ver or e is null then
  update public.dl_pk_sessions set revoked_at = now(), revoke_reason = 'changed' where id = s.id;
  return jsonb_build_object('state', 'session_gone');
 end if;
 if (e->>'out')::boolean then
  update public.dl_pk_sessions set revoked_at = now(), revoke_reason = 'inactive' where id = s.id;
  return jsonb_build_object('state', 'inactive');
 end if;
 if p->>'mode' = 'start' then
  update public.dl_pk_sessions set last_used_at = now() where id = s.id;
  perform public.dl_log('pk_resume', s.emp_id, null, 'device', 'ok', null, p->>'ip', p->>'ua');
 end if;
 return jsonb_build_object('state', 'ok', 'emp_id', s.emp_id, 'name', e->>'name', 'role', e->>'role', 'store', e->>'store', 'expires_at', s.expires_at, 'keep', s.keep,
  'auth_uid', pp.auth_uid, 'email', pp.email, 'ver', pp.ver);   -- auth_uid・email・ver は関数だけが使う（端末には返さない）
end $$;

create or replace function public.dl_pk_session_end(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_emp text;
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', true); end if;
 update public.dl_pk_sessions set revoked_at = now(), revoke_reason = 'logout' where token_hash = p->>'token_hash' and revoked_at is null returning emp_id into v_emp;
 if v_emp is not null then perform public.dl_log('pk_logout', v_emp, null, 'device', 'ok', null, p->>'ip', p->>'ua'); end if;
 return jsonb_build_object('ok', true);
end $$;

-- この端末でログインしたまま（本人の端末）か、使い終わったらログアウト（共有の端末）か
create or replace function public.dl_pk_session_keep(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p->'keep') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 update public.dl_pk_sessions set keep = (p->>'keep')::boolean where token_hash = p->>'token_hash' and revoked_at is null and expires_at > now();
 return jsonb_build_object('ok', true);
end $$;

-- パスキー（Supabase）で入った人：GM・CEO・経理なら manager（関数は dl_email_login へ）。ほかはこの表の人
create or replace function public.dl_pk_login(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a uuid; r text; v_emp text; pp public.dl_people; e jsonb;
begin
 if coalesce(p->>'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 a := (p->>'actor')::uuid;
 select m.role, m.emp_id::text into r, v_emp from public.manager_auth m where m.user_id = a;
 if r is not null then return jsonb_build_object('state', 'manager', 'emp_id', v_emp, 'role', r); end if;
 select * into pp from public.dl_people x where x.auth_uid = a;
 if pp.emp_id is null or pp.mode is distinct from 'passkey' or pp.confirmed_at is null then return jsonb_build_object('state', 'not_linked'); end if;
 e := public.dl_emp(pp.emp_id);
 if e is null then return jsonb_build_object('state', 'not_linked'); end if;
 if (e->>'out')::boolean then return jsonb_build_object('state', 'inactive'); end if;
 return jsonb_build_object('state', 'ok', 'emp_id', pp.emp_id, 'ver', pp.ver, 'name', e->>'name');
end $$;

-- 本人がこの端末にパスキーを保存した（表示だけ）
create or replace function public.dl_pk_keys_added(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_emp text;
begin
 if coalesce(p->>'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 update public.dl_people set keys_at = now(), updated_at = now() where auth_uid = (p->>'actor')::uuid returning emp_id into v_emp;
 perform public.dl_log('pk_key_added', v_emp, null, 'mail:' || (p->>'actor'), 'ok', null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true);
end $$;

-- ===== 送り手（GM の会社の Gmail） =====
create or replace function public.dl_pk_mail_creds(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('from', m.from_addr, 'account', m.account, 'refresh_token', m.refresh_token, 'state', m.state) from public.dl_mail m where m.id = 1;
$$;

create or replace function public.dl_pk_mail_start(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p); m public.dl_mail;
begin
 if coalesce(p->>'state_hash', '') !~ '^[0-9a-f]{64}$' or coalesce(p->>'verifier', '') !~ '^[A-Za-z0-9_-]{43,128}$' then raise exception 'bad_value'; end if;
 select * into m from public.dl_mail x where x.id = 1 for update;
 if m.from_addr is null then raise exception 'from_not_set'; end if;
 update public.dl_mail set oauth_state_hash = p->>'state_hash', oauth_verifier = p->>'verifier', oauth_at = now(), oauth_by = 'admin:' || (a->>'uid'), updated_at = now() where id = 1;
 return jsonb_build_object('from', m.from_addr);
end $$;

create or replace function public.dl_pk_mail_take(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare m public.dl_mail;
begin
 select * into m from public.dl_mail x where x.id = 1 for update;
 if m.oauth_state_hash is null or m.oauth_state_hash <> coalesce(p->>'state_hash', '') or m.oauth_at < now() - interval '10 minutes' then raise exception 'bad_state'; end if;
 update public.dl_mail set oauth_state_hash = null, oauth_verifier = null, updated_at = now() where id = 1;
 return jsonb_build_object('verifier', m.oauth_verifier, 'from', m.from_addr, 'by', m.oauth_by);
end $$;

create or replace function public.dl_pk_mail_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare m public.dl_mail;
begin
 select * into m from public.dl_mail x where x.id = 1 for update;
 if m.from_addr is null then raise exception 'from_not_set'; end if;
 if lower(btrim(coalesce(p->>'account', ''))) <> lower(btrim(m.from_addr)) then
  update public.dl_mail set last_error = 'wrong_account', updated_at = now() where id = 1;
  perform public.dl_log('pk_mail', null, null, coalesce(p->>'by', 'admin'), 'fail', 'wrong_account', null, null);
  raise exception 'wrong_account';
 end if;
 if coalesce(p->>'refresh_token', '') = '' then raise exception 'bad_value'; end if;
 update public.dl_mail set account = lower(btrim(p->>'account')), refresh_token = p->>'refresh_token', state = 'ok', connected_at = now(),
  connected_by = left(p->>'by', 80), last_error = null, updated_at = now() where id = 1;
 perform public.dl_log('pk_mail', null, null, coalesce(p->>'by', 'admin'), 'ok', 'connected', null, null);
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.dl_pk_mail_mark(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if coalesce((p->>'ok')::boolean, false) then
  update public.dl_mail set last_ok_at = now(), last_error = null, updated_at = now() where id = 1;
 else
  update public.dl_mail set last_error = left(p->>'error', 120), state = case when coalesce((p->>'auth')::boolean, false) then 'expired' else state end, updated_at = now() where id = 1;
 end if;
 return public.dl_pk_mail_public();
end $$;

create or replace function public.dl_pk_mail_status(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_pk_admin(p);
begin
 return public.dl_pk_mail_public();
end $$;

-- ===== ログインの画面・PIN の照合 =====
-- login_info：PIN のログインを止めたか（v1186）・パスキーのログインが入っているか・メール＋パスキーの人（社員の ID だけ）
create or replace function public.dl_top_pin_info(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('top_pin_off', public.dl_top_pin_off(), 'pk', true,
  'pk_emps', coalesce((select jsonb_agg(x.emp_id order by x.emp_id) from public.dl_people x where x.mode = 'passkey'), '[]'::jsonb));
$$;

-- その人の PIN のログインを止めるか（auth-pin・emp-private が PIN を確かめたあとに聞く）。
-- v1189：メール＋パスキーの人（社員の ID か、在籍で同じ名前の人のだれか）はいつも止める。ほかは 20261207090000 と同じ
create or replace function public.dl_pin_blocked(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
 v_emp text := nullif(btrim(coalesce(p->>'emp_id', '')), '');
 v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
 v_hit boolean; v_top boolean;
begin
 if v_emp is null and v_name is null then raise exception 'bad_value'; end if;
 -- パスキーの人（社員の ID が当たればその人だけで決める・無ければ在籍で同じ名前の人）
 if v_emp is not null and exists (select 1 from public.employees t where t.id::text = v_emp) then
  if exists (select 1 from public.dl_people x where x.emp_id = v_emp and x.mode = 'passkey') then return jsonb_build_object('blocked', true, 'why', 'passkey'); end if;
 elsif v_name is not null and exists (
   select 1 from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
   join public.dl_people x on x.emp_id = e.j->>'id' and x.mode = 'passkey'
   where btrim(coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', '')) = v_name
     and not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true')) then
  return jsonb_build_object('blocked', true, 'why', 'passkey');
 end if;
 if not public.dl_top_pin_off() then return jsonb_build_object('blocked', false); end if;
 if v_emp is not null then
  select true, (coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office'))
   into v_hit, v_top
   from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
   where e.j->>'id' = v_emp
   limit 1;
  if v_hit then return jsonb_build_object('blocked', coalesce(v_top, false)); end if;
 end if;
 if v_name is null then return jsonb_build_object('blocked', false); end if;
 select coalesce(bool_or(
   coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office')), false)
  into v_top
  from (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t) e
  where btrim(coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', '')) = v_name
    and not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true');
 return jsonb_build_object('blocked', v_top);
end $$;

-- ===== v1183 の「ログインの試し」をやめる（7A） =====
create or replace function public.dl_admin_trial(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p);
begin
 if jsonb_typeof(p->'on') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 if (p->>'on')::boolean then raise exception 'trial_off'; end if;
 delete from public.dl_trial where emp_id = nullif(p->>'emp_id', '');
 return jsonb_build_object('ok', true, 'member', public.dl_member(nullif(p->>'emp_id', '')));
end $$;

do $$
declare n integer; m integer;
begin
 update public.dl_invites set revoked_at = now(), revoke_reason = 'trial_end' where used_at is null and revoked_at is null;
 get diagnostics n = row_count;
 update public.dl_devices set revoked_at = now(), revoked_by = 'sql', revoke_reason = 'trial_end' where revoked_at is null;
 get diagnostics m = row_count;
 delete from public.dl_trial;
 insert into public.dl_flags (key, value, set_at, note) values ('trial_off', true, now(), 'v1189 の SQL') on conflict (key) do update set value = true, set_at = now(), note = 'v1189 の SQL';
 perform public.dl_log('trial_end', null, null, 'sql', 'ok', 'invites=' || n || ' devices=' || m, null, null);
end $$;

-- 入っているかの目印（確認の SQL・関数が見る）
create or replace function public.dl_pk_stage() returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$ select 1 $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;
