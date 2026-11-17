-- device-login（v1183・ログインの試し・段階 1）。仕様：docs/DEVICE_LOGIN_V1183_JA.md。
-- GM・CEO が名前で選んだ社員（試す人）だけ。招待の URL（48 時間・1 回だけ）とその人の PIN（サーバーの auth-pin が確かめる）で
-- 端末を登録し、そのあとは端末の鍵（取り出せない ECDSA P-256・公開鍵だけをここに置く）で PIN なしで入る。
-- ・1 人 5 台まで（6 台目は本人の確かめのあと外す端末を選ぶ）・登録から 90 日まで・30 日開かなければ PIN（裏の通信は「開いた」に数えない）
-- ・この端末だけ／すべての端末からログアウト・外す・試しから外すと端末も止まる
-- ・記録（dl_events）は 180 日。PIN・招待の URL・ログインの印・鍵の中身は残さない
-- 表も関数もサーバーの鍵（service_role）だけ。公開の鍵（anon・authenticated）では読めない・呼べない。security invoker・search_path 固定。
-- 社員の表・manager_auth は読むだけ（書かない）。2 回流しても同じ（表は if not exists・関数は create or replace）。

create table if not exists public.dl_trial (
 emp_id text primary key,
 added_by text not null,
 added_at timestamptz not null default now()
);

create table if not exists public.dl_invites (
 id bigint generated always as identity primary key,
 emp_id text not null,
 token_hash text not null unique,          -- 招待の URL の値の sha-256（16 進）。値そのものは残さない
 created_by text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 revoked_at timestamptz,
 revoke_reason text,
 fails integer not null default 0,         -- PIN の間違い（5 回で取り消す）
 device_id uuid
);
create index if not exists dl_invites_emp on public.dl_invites (emp_id, created_at desc);

create table if not exists public.dl_devices (
 id uuid primary key default gen_random_uuid(),
 emp_id text not null,
 pubkey jsonb not null,                    -- 公開鍵（JWK・EC P-256 の kty・crv・x・y だけ）
 name text not null,
 created_at timestamptz not null default now(),
 last_used_at timestamptz not null default now(),   -- 人が開いたとき（start・PIN）だけ進める
 expires_at timestamptz not null,
 reauth boolean not null default false,    -- ログアウトした・すべての端末からログアウトした → 次は PIN
 ask_pin boolean not null default false,   -- 本人の設定：開くたびに PIN
 revoked_at timestamptz,
 revoked_by text,
 revoke_reason text
);
create index if not exists dl_devices_emp on public.dl_devices (emp_id);

create table if not exists public.dl_challenges (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null,
 nonce text not null,
 created_at timestamptz not null default now(),
 used_at timestamptz
);
create index if not exists dl_challenges_dev on public.dl_challenges (device_id, created_at desc);

create table if not exists public.dl_events (
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 kind text not null,
 emp_id text,
 device_id uuid,
 actor text not null,                      -- 'admin:<uid>' ・'device'（端末の鍵で確かめた）・'invite'（招待の URL）・'unknown'
 result text not null,
 reason text,
 ip text,
 ua text
);
create index if not exists dl_events_at on public.dl_events (at);
create index if not exists dl_events_emp on public.dl_events (emp_id, at desc);

alter table public.dl_trial enable row level security;
alter table public.dl_invites enable row level security;
alter table public.dl_devices enable row level security;
alter table public.dl_challenges enable row level security;
alter table public.dl_events enable row level security;
revoke all on public.dl_trial, public.dl_invites, public.dl_devices, public.dl_challenges, public.dl_events from public, anon, authenticated;
grant select, insert, update, delete on public.dl_trial, public.dl_invites, public.dl_devices, public.dl_challenges, public.dl_events to service_role;

-- ===== 社員 =====
-- 社員の行（列の有無によらず to_jsonb で読む）。無ければ null。
create or replace function public.dl_emp(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare j jsonb; d jsonb; v_role text; v_top boolean;
begin
 if p_emp is null or length(p_emp) > 64 then return null; end if;
 select to_jsonb(e) into j from public.employees e where e.id::text = p_emp;
 if j is null then return null; end if;
 d := case when jsonb_typeof(j->'data') = 'object' then j->'data' else '{}'::jsonb end;
 v_role := coalesce(nullif(j->>'role', ''), d->>'role', '');
 -- 列と中身のどちらかが GM・CEO なら試せない（安全なほう）
 v_top := v_role in ('ceo','gm') or coalesce(d->>'role', '') in ('ceo','gm') or exists (select 1 from public.manager_auth m where m.emp_id::text = p_emp and m.role in ('ceo','gm'));
 return jsonb_build_object(
  'emp', p_emp,
  'name', left(btrim(coalesce(nullif(btrim(j->>'name'), ''), d->>'name', '')), 80),
  'store', left(coalesce(nullif(j->>'store', ''), d->>'store', ''), 40),
  'role', left(v_role, 20),
  'top', v_top,
  'out', coalesce(j->>'status', '') = '退職' or coalesce(d->>'status', '') = '退職' or coalesce(d->>'osDisabled', '') = 'true');
end $$;

-- ===== 記録 =====
create or replace function public.dl_log(p_kind text, p_emp text, p_dev uuid, p_actor text, p_result text, p_reason text, p_ip text, p_ua text) returns void
language sql volatile security invoker set search_path = public, pg_temp as $$
 insert into public.dl_events (kind, emp_id, device_id, actor, result, reason, ip, ua)
 values (left(coalesce(p_kind, ''), 40), left(p_emp, 64), p_dev, left(coalesce(p_actor, 'unknown'), 80), left(coalesce(p_result, ''), 40), left(p_reason, 200), left(p_ip, 64), left(p_ua, 200));
$$;

-- 関数（device-login）が自分で残す記録（署名が合わない・PIN の間違いなど）
create or replace function public.dl_event(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid;
begin
 begin v_dev := nullif(p->>'device_id', '')::uuid; exception when others then v_dev := null; end;
 perform public.dl_log(p->>'kind', nullif(p->>'emp_id', ''), v_dev, p->>'actor', p->>'result', p->>'reason', p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true);
end $$;

-- 180 日より前の記録・1 日より前の確かめの値を消す
create or replace function public.dl_prune() returns integer
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare n integer; m integer;
begin
 delete from public.dl_events where at < now() - interval '180 days';
 get diagnostics n = row_count;
 delete from public.dl_challenges where created_at < now() - interval '1 day';
 get diagnostics m = row_count;
 return n + m;
end $$;

-- ===== GM・CEO（メールのログイン → manager_auth の役割）=====
create or replace function public.dl_admin(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a uuid; r text; v_emp text; e jsonb;
begin
 if coalesce(p->>'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 a := (p->>'actor')::uuid;
 select m.role, m.emp_id::text into r, v_emp from public.manager_auth m where m.user_id = a;
 if r is null or r not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if v_emp is not null then
  e := public.dl_emp(v_emp);
  if e is not null and (e->>'out')::boolean then raise exception 'forbidden'; end if;
 end if;
 return jsonb_build_object('uid', a, 'role', r, 'name', coalesce(nullif(e->>'name', ''), upper(r)));
end $$;

-- 1 人の状態：利用停止・登録完了・招待中・期限切れ・取り消し・未招待
create or replace function public.dl_member(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e jsonb; i public.dl_invites; v_act integer; v_tot integer; v_last timestamptz; v_inv text; v_state text;
begin
 e := public.dl_emp(p_emp);
 select * into i from public.dl_invites x where x.emp_id = p_emp order by x.created_at desc, x.id desc limit 1;
 select count(*) filter (where d.revoked_at is null and d.expires_at > now()), count(*), max(d.last_used_at) filter (where d.revoked_at is null)
  into v_act, v_tot, v_last from public.dl_devices d where d.emp_id = p_emp;
 v_inv := case when i.id is null then null when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
  when i.expires_at <= now() then 'expired' else 'pending' end;
 v_state := case when e is null or (e->>'out')::boolean then 'stopped' when v_act > 0 then 'registered' when v_inv = 'pending' then 'invited'
  when v_inv = 'expired' then 'expired' when v_inv = 'revoked' then 'revoked' else 'none' end;
 return jsonb_build_object('emp_id', p_emp, 'name', coalesce(e->>'name', ''), 'store', coalesce(e->>'store', ''), 'missing', e is null,
  'state', v_state, 'invite', case when i.id is null then null else jsonb_build_object('state', v_inv, 'created_at', i.created_at, 'expires_at', i.expires_at) end,
  'devices', v_act, 'devices_all', v_tot, 'last_used_at', v_last,
  'added_at', (select t.added_at from public.dl_trial t where t.emp_id = p_emp));
end $$;

create or replace function public.dl_admin_list(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p);
begin
 perform public.dl_prune();
 return jsonb_build_object('me', a, 'now', now(), 'members',
  coalesce((select jsonb_agg(public.dl_member(t.emp_id) order by t.added_at, t.emp_id) from public.dl_trial t), '[]'::jsonb));
end $$;

-- 試す人に足す・外す（外すと招待と端末も止める）
create or replace function public.dl_admin_trial(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p); v_emp text := nullif(p->>'emp_id', ''); e jsonb; v_on boolean;
begin
 if jsonb_typeof(p->'on') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 v_on := (p->>'on')::boolean;
 e := public.dl_emp(v_emp);
 if v_on then
  if e is null then raise exception 'not_found'; end if;
  if (e->>'top')::boolean then raise exception 'top_not_allowed'; end if;   -- GM・CEO は段階 2（メールとパスワード）
  if (e->>'out')::boolean then raise exception 'inactive'; end if;
  insert into public.dl_trial (emp_id, added_by) values (v_emp, 'admin:' || (a->>'uid')) on conflict (emp_id) do nothing;
  perform public.dl_log('trial_on', v_emp, null, 'admin:' || (a->>'uid'), 'ok', null, p->>'ip', p->>'ua');
 else
  delete from public.dl_trial where emp_id = v_emp;
  update public.dl_invites set revoked_at = now(), revoke_reason = 'trial_off' where emp_id = v_emp and used_at is null and revoked_at is null;
  update public.dl_devices set revoked_at = now(), revoked_by = 'admin:' || (a->>'uid'), revoke_reason = 'trial_off' where emp_id = v_emp and revoked_at is null;
  perform public.dl_log('trial_off', v_emp, null, 'admin:' || (a->>'uid'), 'ok', null, p->>'ip', p->>'ua');
 end if;
 return jsonb_build_object('ok', true, 'member', public.dl_member(v_emp));
end $$;

-- 招待（前の招待は取り消す・48 時間）。値は関数が作って、ここには sha-256 だけ
create or replace function public.dl_admin_invite(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p); v_emp text := nullif(p->>'emp_id', ''); e jsonb; v_hash text := p->>'token_hash'; v_exp timestamptz;
begin
 if coalesce(v_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad_value'; end if;
 if not exists (select 1 from public.dl_trial t where t.emp_id = v_emp) then raise exception 'not_trial'; end if;
 e := public.dl_emp(v_emp);
 if e is null then raise exception 'not_found'; end if;
 if (e->>'top')::boolean then raise exception 'top_not_allowed'; end if;
 if (e->>'out')::boolean then raise exception 'inactive'; end if;
 perform 1 from public.dl_trial t where t.emp_id = v_emp for update;   -- 同じ人の招待を同時に作らない
 update public.dl_invites set revoked_at = now(), revoke_reason = 'reissued' where emp_id = v_emp and used_at is null and revoked_at is null;
 v_exp := now() + interval '48 hours';
 insert into public.dl_invites (emp_id, token_hash, created_by, expires_at) values (v_emp, v_hash, 'admin:' || (a->>'uid'), v_exp);
 perform public.dl_log('invite', v_emp, null, 'admin:' || (a->>'uid'), 'ok', null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'expires_at', v_exp, 'member', public.dl_member(v_emp));
end $$;

create or replace function public.dl_admin_invite_revoke(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p); v_emp text := nullif(p->>'emp_id', ''); n integer;
begin
 update public.dl_invites set revoked_at = now(), revoke_reason = 'admin' where emp_id = v_emp and used_at is null and revoked_at is null;
 get diagnostics n = row_count;
 perform public.dl_log('invite_revoke', v_emp, null, 'admin:' || (a->>'uid'), case when n > 0 then 'ok' else 'none' end, null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'revoked', n, 'member', public.dl_member(v_emp));
end $$;

create or replace function public.dl_devices_of(p_emp text, p_this uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'created_at', d.created_at, 'last_used_at', d.last_used_at,
   'expires_at', d.expires_at, 'this', d.id = p_this, 'ask_pin', d.ask_pin,
   'state', case when d.revoked_at is not null then 'revoked' when d.expires_at <= now() then 'expired' when d.reauth then 'logged_out' else 'active' end,
   'revoked_at', d.revoked_at, 'revoke_reason', d.revoke_reason)
   order by (d.revoked_at is null and d.expires_at > now()) desc, d.last_used_at desc), '[]'::jsonb)
 from public.dl_devices d where d.emp_id = p_emp and (d.revoked_at is null or d.revoked_at > now() - interval '30 days');
$$;

create or replace function public.dl_admin_devices(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p); v_emp text := nullif(p->>'emp_id', '');
begin
 return jsonb_build_object('ok', true, 'devices', public.dl_devices_of(v_emp, null), 'member', public.dl_member(v_emp));
end $$;

-- GM・CEO が外す（1 台・device_id が無ければその人のすべて）
create or replace function public.dl_admin_device_revoke(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.dl_admin(p); v_emp text := nullif(p->>'emp_id', ''); v_dev uuid; n integer;
begin
 begin v_dev := nullif(p->>'device_id', '')::uuid; exception when others then raise exception 'bad_value'; end;
 update public.dl_devices set revoked_at = now(), revoked_by = 'admin:' || (a->>'uid'), revoke_reason = 'admin'
  where emp_id = v_emp and revoked_at is null and (v_dev is null or id = v_dev);
 get diagnostics n = row_count;
 if v_dev is not null and n = 0 then raise exception 'not_found'; end if;
 perform public.dl_log('device_revoke', v_emp, v_dev, 'admin:' || (a->>'uid'), 'ok', case when v_dev is null then 'all' end, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'revoked', n, 'devices', public.dl_devices_of(v_emp, null), 'member', public.dl_member(v_emp));
end $$;

-- ===== 招待の URL を開いた人 =====
-- 招待の状態（使わない）。ok のときだけ名前（本人の確かめの前に名前を出す＝UI案80 の 2）
create or replace function public.dl_invite_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare i public.dl_invites; e jsonb; v_state text;
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'unknown'); end if;
 select * into i from public.dl_invites x where x.token_hash = p->>'token_hash';
 if i.id is null then return jsonb_build_object('state', 'unknown'); end if;
 e := public.dl_emp(i.emp_id);
 v_state := case when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked' when i.expires_at <= now() then 'expired'
  when e is null or (e->>'out')::boolean or (e->>'top')::boolean or not exists (select 1 from public.dl_trial t where t.emp_id = i.emp_id) then 'revoked'
  else 'ok' end;
 if v_state <> 'ok' then return jsonb_build_object('state', v_state); end if;
 return jsonb_build_object('state', 'ok', 'emp_id', i.emp_id, 'name', e->>'name', 'expires_at', i.expires_at);
end $$;

-- PIN の間違い（招待ごとに 5 回で取り消す）
create or replace function public.dl_invite_fail(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare i public.dl_invites;
begin
 update public.dl_invites set fails = fails + 1,
   revoked_at = case when fails + 1 >= 5 then now() else revoked_at end,
   revoke_reason = case when fails + 1 >= 5 then 'pin_fails' else revoke_reason end
  where token_hash = p->>'token_hash' and used_at is null and revoked_at is null returning * into i;
 if i.id is null then return jsonb_build_object('left', 0); end if;
 perform public.dl_log('invite_pin', i.emp_id, null, 'invite', 'fail', case when i.revoked_at is not null then 'revoked_5' end, p->>'ip', p->>'ua');
 return jsonb_build_object('left', greatest(0, 5 - i.fails));
end $$;

-- 登録（1 回だけ）。5 台あれば外す端末を選ぶまで何もしない（招待も使わない）
create or replace function public.dl_invite_use(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare i public.dl_invites; e jsonb; v_rep uuid[] := '{}'; v_act integer; v_rm integer; v_id uuid; x text;
begin
 if coalesce(p->>'token_hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'invite_gone'; end if;
 if jsonb_typeof(p->'pubkey') is distinct from 'object' or coalesce(length(p->>'name'), 0) not between 1 and 60 then raise exception 'bad_value'; end if;
 if p ? 'replace' then
  if jsonb_typeof(p->'replace') <> 'array' or jsonb_array_length(p->'replace') > 5 then raise exception 'bad_value'; end if;
  for x in select jsonb_array_elements_text(p->'replace') loop
   begin v_rep := v_rep || x::uuid; exception when others then raise exception 'bad_value'; end;
  end loop;
 end if;
 select * into i from public.dl_invites where token_hash = p->>'token_hash' for update;
 if i.id is null or i.used_at is not null or i.revoked_at is not null or i.expires_at <= now() then raise exception 'invite_gone'; end if;
 e := public.dl_emp(i.emp_id);
 if e is null or (e->>'out')::boolean or (e->>'top')::boolean or not exists (select 1 from public.dl_trial t where t.emp_id = i.emp_id) then raise exception 'invite_gone'; end if;
 perform 1 from public.dl_devices d where d.emp_id = i.emp_id and d.revoked_at is null for update;
 if exists (select 1 from unnest(v_rep) r where not exists (select 1 from public.dl_devices d where d.id = r and d.emp_id = i.emp_id and d.revoked_at is null)) then
  raise exception 'bad_value';
 end if;
 select count(*) into v_act from public.dl_devices d where d.emp_id = i.emp_id and d.revoked_at is null and d.expires_at > now();
 select count(*) into v_rm from public.dl_devices d where d.id = any(v_rep) and d.expires_at > now();
 if v_act - v_rm >= 5 then
  return jsonb_build_object('need_replace', true, 'devices', public.dl_devices_of(i.emp_id, null));
 end if;
 update public.dl_devices set revoked_at = now(), revoked_by = 'self', revoke_reason = 'replaced' where id = any(v_rep);
 insert into public.dl_devices (emp_id, pubkey, name, expires_at) values (i.emp_id, p->'pubkey', p->>'name', now() + interval '90 days') returning id into v_id;
 update public.dl_invites set used_at = now(), device_id = v_id where id = i.id;
 perform public.dl_log('register', i.emp_id, v_id, 'invite', 'ok', case when cardinality(v_rep) > 0 then 'replaced ' || cardinality(v_rep) end, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'device_id', v_id, 'emp_id', i.emp_id, 'name', e->>'name', 'expires_at', now() + interval '90 days');
end $$;

-- ===== 登録した端末 =====
-- 確かめの値（2 分・1 回）。端末が無ければ device_gone。10 分に 30 回まで
create or replace function public.dl_challenge_new(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid; v_id uuid;
begin
 begin v_dev := (p->>'device_id')::uuid; exception when others then raise exception 'device_gone'; end;
 if coalesce(p->>'nonce', '') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'bad_value'; end if;
 if not exists (select 1 from public.dl_devices d where d.id = v_dev) then raise exception 'device_gone'; end if;
 if (select count(*) from public.dl_challenges c where c.device_id = v_dev and c.created_at > now() - interval '10 minutes') >= 30 then raise exception 'too_many'; end if;
 insert into public.dl_challenges (device_id, nonce) values (v_dev, p->>'nonce') returning id into v_id;
 return jsonb_build_object('chal_id', v_id);
end $$;

-- 使う（1 回だけ・2 分まで）。公開鍵を返す（署名は関数が確かめる）
create or replace function public.dl_challenge_take(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_chal uuid; v_dev uuid; v_nonce text; v_key jsonb; v_emp text;
begin
 begin v_chal := (p->>'chal_id')::uuid; exception when others then raise exception 'challenge_gone'; end;
 update public.dl_challenges set used_at = now() where id = v_chal and used_at is null and created_at > now() - interval '2 minutes'
  returning device_id, nonce into v_dev, v_nonce;
 if v_dev is null then raise exception 'challenge_gone'; end if;
 select d.pubkey, d.emp_id into v_key, v_emp from public.dl_devices d where d.id = v_dev;
 if v_key is null then raise exception 'device_gone'; end if;
 return jsonb_build_object('device_id', v_dev, 'nonce', v_nonce, 'pubkey', v_key, 'emp_id', v_emp);
end $$;

-- 入れるか（署名は確かめたあと）。mode：start（人が開いた）・refresh（裏で印を取り替える）・peek（端末の一覧・ログアウトなど）
create or replace function public.dl_device_auth(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; v_mode text := p->>'mode'; d public.dl_devices; e jsonb; v_state text;
begin
 if v_mode not in ('start','refresh','peek','reauth') then raise exception 'bad_value'; end if;
 select * into d from public.dl_devices where id = v_dev for update;
 if d.id is null then raise exception 'device_gone'; end if;
 e := public.dl_emp(d.emp_id);
 v_state := case when d.revoked_at is not null then 'device_revoked' when d.expires_at <= now() then 'device_expired'
  when e is null or (e->>'out')::boolean then 'inactive'
  when (e->>'top')::boolean or not exists (select 1 from public.dl_trial t where t.emp_id = d.emp_id) then 'not_trial'
  -- 経理（office）は開くたびに PIN（給与など PIN が要る関数があるため。PIN なしで入ると給与が空に見える）
  when v_mode in ('start','refresh') and (d.reauth or d.last_used_at < now() - interval '30 days' or (v_mode = 'start' and (d.ask_pin or coalesce(e->>'role', '') = 'office'))) then 'reauth'
  else 'ok' end;
 if v_state = 'ok' and v_mode = 'start' then update public.dl_devices set last_used_at = now() where id = v_dev; end if;
 if v_mode in ('start','reauth') or v_state not in ('ok','reauth') then
  perform public.dl_log(v_mode, d.emp_id, v_dev, 'device', v_state, null, p->>'ip', p->>'ua');
 end if;
 return jsonb_build_object('state', v_state, 'emp_id', d.emp_id, 'name', coalesce(e->>'name', ''), 'device_name', d.name, 'expires_at', d.expires_at, 'ask_pin', d.ask_pin,
  'pin_always', coalesce(e->>'role', '') = 'office');
end $$;

-- PIN で確かめたあと：次からは PIN なし（ask_pin の人は次も PIN）
create or replace function public.dl_device_reauth_ok(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; n integer;
begin
 update public.dl_devices set reauth = false, last_used_at = now() where id = v_dev and revoked_at is null and expires_at > now();
 get diagnostics n = row_count;
 if n = 0 then raise exception 'device_gone'; end if;
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.dl_device_logout(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; v_scope text := p->>'scope'; v_emp text; n integer;
begin
 if v_scope not in ('this','all') then raise exception 'bad_value'; end if;
 select emp_id into v_emp from public.dl_devices where id = v_dev;
 if v_emp is null then raise exception 'device_gone'; end if;
 update public.dl_devices set reauth = true where revoked_at is null and (id = v_dev or (v_scope = 'all' and emp_id = v_emp));
 get diagnostics n = row_count;
 perform public.dl_log('logout_' || v_scope, v_emp, v_dev, 'device', 'ok', null, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'devices', n);
end $$;

create or replace function public.dl_device_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; v_emp text;
begin
 select emp_id into v_emp from public.dl_devices where id = v_dev;
 if v_emp is null then raise exception 'device_gone'; end if;
 return jsonb_build_object('ok', true, 'devices', public.dl_devices_of(v_emp, v_dev));
end $$;

-- 本人が外す（同じ人の端末だけ。この端末も外せる）
create or replace function public.dl_device_revoke_own(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; v_tgt uuid; v_emp text; n integer;
begin
 begin v_tgt := (p->>'target')::uuid; exception when others then raise exception 'bad_value'; end;
 select emp_id into v_emp from public.dl_devices where id = v_dev;
 if v_emp is null then raise exception 'device_gone'; end if;
 update public.dl_devices set revoked_at = now(), revoked_by = 'self', revoke_reason = 'self' where id = v_tgt and emp_id = v_emp and revoked_at is null;
 get diagnostics n = row_count;
 if n = 0 then raise exception 'not_found'; end if;
 perform public.dl_log('device_revoke', v_emp, v_tgt, 'device', 'ok', case when v_tgt = v_dev then 'this' end, p->>'ip', p->>'ua');
 return jsonb_build_object('ok', true, 'devices', public.dl_devices_of(v_emp, v_dev));
end $$;

-- 本人の設定（開くたびに PIN）
create or replace function public.dl_device_setting(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_dev uuid := (p->>'device_id')::uuid; n integer;
begin
 if jsonb_typeof(p->'ask_pin') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 update public.dl_devices set ask_pin = (p->>'ask_pin')::boolean where id = v_dev and revoked_at is null;
 get diagnostics n = row_count;
 if n = 0 then raise exception 'device_gone'; end if;
 return jsonb_build_object('ok', true, 'ask_pin', (p->>'ask_pin')::boolean);
end $$;

-- 入っているかの目印（確認の SQL・関数が見る）
create or replace function public.dl_stage() returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$ select 1 $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;
