-- 2026-11-25 (Moto): new mid-reviews take the submission deadline from mr_settings.schedule.
-- Production schedule is submit 20, reply 21, decide 21, consult 21–23.
-- The historical seed in 20261012090000 stays 15/17/19/20/22 because that file is the frozen v1069 bundle.
-- This migration updates the row. It does not rewrite reviews that already exist.
-- v2 stores submit and reply only. Only submit is filled in for a new row. GM/CEO still replace both
-- with mr_deadline_save, including clearing them. Submission after the date stays allowed.
-- flags.notify is not written here and stays false.

update public.mr_settings
 set value = jsonb_build_object('submit_day', 20, 'reply_day', 21, 'decide_day', 21, 'consult_from', 21, 'consult_to', 23),
     updated_at = now(),
     updated_by = '2026-11-25-schedule'
 where key = 'schedule';

create or replace function public.mr_default_deadlines(p_ym text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare sch jsonb := public.mr_setting('schedule'); v_day integer; v_last integer;
begin
 if p_ym is null or p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return '{}'::jsonb; end if;
 if coalesce(sch->>'submit_day', '') !~ '^[0-9]{1,2}$' then return '{}'::jsonb; end if;
 v_day := (sch->>'submit_day')::integer;
 v_last := extract(day from (make_date(split_part(p_ym, '-', 1)::integer, split_part(p_ym, '-', 2)::integer, 1) + interval '1 month - 1 day'))::integer;
 if v_day < 1 or v_day > v_last then return '{}'::jsonb; end if;
 return jsonb_build_object('submit', to_char(make_date(split_part(p_ym, '-', 1)::integer, split_part(p_ym, '-', 2)::integer, v_day), 'YYYY-MM-DD'));
end $$;

revoke all on function public.mr_default_deadlines(text) from public, anon, authenticated;
grant execute on function public.mr_default_deadlines(text) to service_role;

-- A store-month's row before anything is written. A new row gets the schedule's submit day.
-- An existing row, including one with an empty deadline or a GM/CEO override, is left as it is.
create or replace function public.mr_review_row(p_env text, p_store text, p_ym text) returns public.mr_reviews
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.mr_reviews;
begin
 insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, version, updated_by)
  values(p_env, p_store, p_ym, 'draft', '{"v":2}'::jsonb, public.mr_default_deadlines(p_ym), 0, null)
  on conflict (env, store_id, ym) do nothing;
 select * into r from public.mr_reviews x where x.env = p_env and x.store_id = p_store and x.ym = p_ym for update;
 return r;
end $$;

create or replace function public.mr_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_body jsonb; v_exp integer; v_can jsonb; r public.mr_reviews; v_name text := public.mr_actor_name(m);
begin
 if (p->'expect_version') is not null and jsonb_typeof(p->'expect_version') not in ('number','null') then raise exception 'bad_value'; end if;
 v_exp := case when jsonb_typeof(p->'expect_version') = 'number' and (p->>'expect_version') ~ '^[0-9]{1,6}$' then (p->>'expect_version')::integer else 0 end;
 v_body := public.mr_body_check_v2(p->'body');
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if v_st.env = 'live' and coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is not true then raise exception 'not_available'; end if;
 if not (v_can->>'input')::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym for update;
 if r.id is null then
  if v_exp <> 0 then raise exception 'conflict'; end if;
  begin
   insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, version, updated_by)
    values(v_st.env, v_st.store_id, v_ym, 'draft', v_body, public.mr_default_deadlines(v_ym), 1, v_name) returning * into r;
  exception when unique_violation then raise exception 'conflict';
  end;
  perform public.mr_event(r.id, r.env, m.user_id::text, 'create', jsonb_build_object('by', v_name));
  return jsonb_build_object('id', r.id, 'version', r.version, 'status', 'draft', 'updated_at', r.updated_at, 'deadlines', r.deadlines, 'overdue', public.mr_overdue(r));
 end if;
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if v_exp <> r.version then raise exception 'conflict'; end if;
 if r.status = 'confirmed' then raise exception 'locked'; end if;
 if r.status not in ('draft','submitted') then raise exception 'legacy'; end if;
 update public.mr_reviews set body = v_body, version = version + 1, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 if r.version = 1 then perform public.mr_event(r.id, r.env, m.user_id::text, 'create', jsonb_build_object('by', v_name)); end if;
 return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'updated_at', r.updated_at, 'deadlines', r.deadlines, 'overdue', public.mr_overdue(r));
end $$;
