-- Preserve the exact approved LINE payload across retries and assignment changes.
alter table public.bot_outbox add column if not exists line_message jsonb;
create function public.bot_reserve_send_v2(p_actor uuid,p_id uuid,p_version integer,p_request uuid,p_group text,p_body text,p_message jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.bot_outbox; result jsonb; existed boolean;
begin
 perform 1 from public.bot_cases where id=p_id for update;
 select exists(select 1 from public.bot_outbox where id=p_request) into existed;
 result:=public.bot_reserve_send(p_actor,p_id,p_version,p_request,p_group,p_body);
 if existed then return result; end if;
 if p_message is null or p_message->>'type' not in ('text','textV2') or coalesce(length(p_message->>'text'),0) not between 1 and 5000 then raise exception 'invalid_message'; end if;
 update public.bot_outbox set line_message=p_message where id=p_request returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.bot_reserve_send_v2(uuid,uuid,integer,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bot_reserve_send_v2(uuid,uuid,integer,uuid,text,text,jsonb) to service_role;
