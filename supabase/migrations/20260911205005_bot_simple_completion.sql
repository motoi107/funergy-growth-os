-- Explicit user-requested LINE completion without individual enrollment.
-- Only the signed webhook's service role calls this; group/store scope remains enforced.
create function public.bot_complete_reports(p_event text,p_group text,p_user text,p_text text,p_codes text[]) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases;e bigint;report_code text;results jsonb='[]';decision jsonb;
begin
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled) then return '{"ignored":true}';end if;
 if p_user is null or p_user !~ '^U[a-fA-F0-9]{32}$' then return '{"ignored":true}';end if;
 if coalesce(length(p_event),0) not between 1 and 200 or coalesce(length(trim(p_text)),0) not between 1 and 4000 or coalesce(cardinality(p_codes),0) not between 1 and 20 then raise exception 'invalid_report';end if;
 insert into public.bot_events(event_key,kind,data) values(p_event,'line_completion_received',jsonb_build_object('group',p_group,'sender',p_user,'text',p_text)) on conflict(event_key) do nothing returning id into e;
 if e is null then return '{"duplicate":true}';end if;
 -- Stable locking order also handles aliases for the same case without duplicate updates.
 perform c0.id from public.bot_cases c0 join public.bot_groups g on g.group_id=p_group
 where (c0.code=any(p_codes) or c0.legacy_code=any(p_codes)) and (g.all_stores or g.store_id=c0.store_id) order by c0.id for update of c0;
 foreach report_code in array p_codes loop
  select c0.* into c from public.bot_cases c0 join public.bot_groups g on g.group_id=p_group
  where (c0.code=report_code or c0.legacy_code=report_code) and (g.all_stores or g.store_id=c0.store_id);
  if c.id is null then results=results||jsonb_build_array(jsonb_build_object('code',report_code,'error','not_found'));continue;end if;
  if c.kind not in ('labor','void','unpaid') then results=results||jsonb_build_array(jsonb_build_object('code',report_code,'error','invalid_kind'));continue;end if;
  if c.status='done' then results=results||jsonb_build_array(jsonb_build_object('code',c.code,'subject',c.subject,'status','done','already_closed',true));continue;end if;
  decision=jsonb_build_object('type','line_reported','action','completed','note',trim(p_text),'actor','LINEからの報告 / LINE report','line_user',p_user,'group_id',p_group,'at',now());
  update public.bot_cases set status='done',closed_at=now(),due_date=null,updated_at=now(),version=version+1,
   payload=(payload-'returned'-'verification')||jsonb_build_object('response',decision,'closure',decision)
   where id=c.id returning * into c;
  insert into public.bot_events(case_id,kind,data) values(c.id,'case_completed',decision||jsonb_build_object('event',p_event,'status','done'));
  results=results||jsonb_build_array(jsonb_build_object('code',c.code,'subject',c.subject,'status','done'));
 end loop;
 update public.bot_events set data=data||jsonb_build_object('results',results) where id=e;
 return jsonb_build_object('results',results);
end $$;
revoke all on function public.bot_complete_reports(text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.bot_complete_reports(text,text,text,text,text[]) to service_role;
