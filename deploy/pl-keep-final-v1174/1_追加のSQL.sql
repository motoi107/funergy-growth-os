-- v1174 の直し（PR #172 の Codex の P2）：会計 PL の共有の保存（app_settings の pl_public）で、「確定」の月を「暫定」で上書きしない。
-- 仕様：docs/PL_IMPORT_V1162_JA.md の 9。入れる順番：deploy/pl-keep-final-v1174/手順.md（アプリのマージの前でもあとでもよい）。
--
-- 前は、アプリが月ごとに手元の写しで丸ごと書いた（月に時刻が無いので手元が勝った）。古い暫定を持つ端末が、
-- ほかの端末が入れた確定の月・ほかの店を、あとから送るだけで消せた。アプリ（v1174 の直し）も合流を直したが、
-- 2 台がほぼ同時に送ったときと、前の版のアプリが送ったときのために、データベースでも同じ決まりで合わせる。
--
-- 決まり（アプリの mergePlPublic と同じ。違いは、同じ種類・同じ時刻のときにあとから書いたほうを採ることだけ）：
--   ・月（YYYY-MM）と店は両方のものを残す（書く値に無い月・店は、前の行から残す）。
--   ・同じ店・同じ月：「確定」（暫定の印が無く、売上が 0 より大きい）はいつも「暫定」に勝つ。
--     同じ種類なら _at（取り込んだ時刻）の新しいほう。同じ時刻ならあとから書いたほう。
--   ・いちばん上の _at は大きいほう。月でないほかの欄は _at の新しいほう（同じならあとから書いたほう）。
--   ・どちらかが形の分からない値（オブジェクトでない・包んだ形 __st）なら、何もしない（書く値のまま）。
--   ・合わせるときにエラーになっても、書き込みは止めない（書く値のまま・警告だけ）。
-- 金額・ほかのキー・ほかの表は変えない。2 回流しても同じ。戻すとき：deploy/pl-keep-final-v1174/戻す.sql。

do $$
declare t text;
begin
  if to_regclass('public.app_settings') is null then
    raise exception 'STOP: app_settings がありません（何も変えていません）';
  end if;
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value';
  if t is null or t not in ('jsonb', 'json', 'text') then
    raise exception 'STOP: app_settings.value の型が jsonb・json・text のどれでもありません（%）。何も変えていません', coalesce(t, '列なし');
  end if;
end $$;

-- 2＝確定・1＝暫定（ほかの記録も）・0＝オブジェクトでない。アプリの _plRecRank と同じ
create or replace function public.fp_pl_pos(x jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case
    when x is null then false
    when jsonb_typeof(x) = 'number' then (x::text)::numeric > 0
    when jsonb_typeof(x) = 'string' and (x #>> '{}') ~ '^\s*[0-9]*\.?[0-9]+\s*$' then btrim(x #>> '{}')::numeric > 0
    else false end
$$;

create or replace function public.fp_pl_rank(r jsonb) returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case
    when r is null or jsonb_typeof(r) <> 'object' then 0
    when (r->'prov' is null or r->'prov' in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb))
         and public.fp_pl_pos(r->'sales') then 2
    else 1 end
$$;

-- 取り込んだ時刻（_at）。数か数字だけの文字。ほかは 0。アプリの _plAt と同じ
create or replace function public.fp_pl_at(r jsonb) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case
    when r is null or jsonb_typeof(r) <> 'object' or r->'_at' is null then 0
    when jsonb_typeof(r->'_at') = 'number' then ((r->'_at')::text)::numeric
    when jsonb_typeof(r->'_at') = 'string' and (r->>'_at') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then btrim(r->>'_at')::numeric
    else 0 end
$$;

-- 前の行（o）と書く値（n）を合わせる。形の分からない値は書く値のまま
create or replace function public.fp_pl_public_join(o jsonb, n jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  out jsonb := '{}'::jsonb;
  k text; ov jsonb; nv jsonb;
  s text; os jsonb; ns jsonb; mo jsonb;
  oa numeric; na numeric;
begin
  if o is null or n is null or jsonb_typeof(o) <> 'object' or jsonb_typeof(n) <> 'object' then return n; end if;
  if (o ? '__st') or (n ? '__st') then return n; end if;
  for k in select x from (select jsonb_object_keys(o) as x union select jsonb_object_keys(n)) ks loop
    ov := o->k; nv := n->k;
    if ov is null or ov = 'null'::jsonb then
      if nv is not null then out := out || jsonb_build_object(k, nv); end if;
      continue;
    end if;
    if nv is null or nv = 'null'::jsonb then out := out || jsonb_build_object(k, ov); continue; end if;
    if k = '_at' then
      oa := public.fp_pl_at(jsonb_build_object('_at', ov)); na := public.fp_pl_at(jsonb_build_object('_at', nv));
      out := out || jsonb_build_object(k, case when oa > na then ov else nv end);
      continue;
    end if;
    if k ~ '^[0-9]{4}-[0-9]{2}$' and jsonb_typeof(ov) = 'object' and jsonb_typeof(nv) = 'object' then
      mo := '{}'::jsonb;
      for s in select x from (select jsonb_object_keys(ov) as x union select jsonb_object_keys(nv)) ss loop
        os := ov->s; ns := nv->s;
        if os is null or os = 'null'::jsonb then
          if ns is not null then mo := mo || jsonb_build_object(s, ns); end if;
        elsif ns is null or ns = 'null'::jsonb then mo := mo || jsonb_build_object(s, os);
        elsif jsonb_typeof(os) = 'object' and jsonb_typeof(ns) = 'object' then
          if public.fp_pl_rank(os) > public.fp_pl_rank(ns) then mo := mo || jsonb_build_object(s, os);
          elsif public.fp_pl_rank(os) < public.fp_pl_rank(ns) then mo := mo || jsonb_build_object(s, ns);
          elsif public.fp_pl_at(os) > public.fp_pl_at(ns) then mo := mo || jsonb_build_object(s, os);
          else mo := mo || jsonb_build_object(s, ns);
          end if;
        else mo := mo || jsonb_build_object(s, ns);
        end if;
      end loop;
      out := out || jsonb_build_object(k, mo);
      continue;
    end if;
    -- 月でない欄・形の違う月：_at の新しいほう（アプリの _mapPick と同じ。同じならあとから書いたほう）
    oa := case when jsonb_typeof(ov) = 'object' then public.fp_pl_at(ov) else 0 end;
    na := case when jsonb_typeof(nv) = 'object' then public.fp_pl_at(nv) else 0 end;
    out := out || jsonb_build_object(k, case when oa > na then ov else nv end);
  end loop;
  return out;
end $$;

-- 見張り：pl_public の行を書き換えるとき、前の行と合わせる（列の型に合わせて作る）
-- security definer にする理由：中で呼ぶ合わせる関数（fp_pl_public_join など）はアプリの鍵（anon・authenticated）から外す（下の revoke）。
-- invoker だと、アプリの鍵の書き込みで見張りが合わせる関数を呼べず、合わせられないまま書いた値を通す（警告だけ）。表は読まない・search_path は固定
do $$
declare t text; conv text;
begin
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value';
  conv := case t when 'jsonb' then 'j' when 'json' then 'j::json' else 'j::text' end;
  execute format($f$
    create or replace function public.fp_pl_public_keep_final() returns trigger
    language plpgsql security definer set search_path = public, pg_temp as $b$
    declare oj jsonb; nj jsonb; j jsonb;
    begin
      if new.key is distinct from 'pl_public' or old.value is null or new.value is null then return new; end if;
      begin
        oj := old.value::text::jsonb;
        nj := new.value::text::jsonb;
        j := public.fp_pl_public_join(oj, nj);
        if j is distinct from nj then new.value := %s; end if;
      exception when others then
        raise warning 'fp_pl_public_keep_final: %%', sqlerrm;
      end;
      return new;
    end $b$;
  $f$, conv);
end $$;

drop trigger if exists fp_pl_public_keep_final on public.app_settings;
create trigger fp_pl_public_keep_final
  before update on public.app_settings
  for each row when (new.key = 'pl_public')
  execute function public.fp_pl_public_keep_final();

-- アプリの鍵からは呼べない（見張りの中だけで使う）
revoke all on function public.fp_pl_pos(jsonb) from public;
revoke all on function public.fp_pl_rank(jsonb) from public;
revoke all on function public.fp_pl_at(jsonb) from public;
revoke all on function public.fp_pl_public_join(jsonb, jsonb) from public;
revoke all on function public.fp_pl_public_keep_final() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.fp_pl_pos(jsonb) from %I', r);
      execute format('revoke all on function public.fp_pl_rank(jsonb) from %I', r);
      execute format('revoke all on function public.fp_pl_at(jsonb) from %I', r);
      execute format('revoke all on function public.fp_pl_public_join(jsonb, jsonb) from %I', r);
      execute format('revoke all on function public.fp_pl_public_keep_final() from %I', r);
    end if;
  end loop;
end $$;

comment on function public.fp_pl_public_join(jsonb, jsonb) is 'v1174: pl_public の前の行と書く値を合わせる（確定は暫定に勝つ・月と店は残す）。見張り fp_pl_public_keep_final が使う。';
