-- Route each report independently. No production identifiers or configuration are embedded.
create or replace function public.bot_reserve_morning_report(p_day date,p_group text,p_request uuid,p_messages jsonb,p_category text,p_variant text default 'daily',p_snapshot_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events;cfg jsonb;route jsonb;today date:=(now() at time zone 'Pacific/Honolulu')::date;k text;bundle jsonb;batches jsonb:='[]';i integer;n integer;
begin
 if p_day is null or p_day<>today or p_request is null then raise exception 'daily_date_changed';end if;
 if p_category is null or p_category not in ('labor','finance','cash_tip') then raise exception 'invalid_report_category';end if;
 if p_variant is null or p_variant not in ('daily','resend-details-v1','resend-report-v1') then raise exception 'invalid_summary_variant';end if;
 if p_snapshot_at is not null and (p_snapshot_at>now() or (p_snapshot_at at time zone 'Pacific/Honolulu')::date<>today) then raise exception 'daily_date_changed';end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 route:=cfg->'routes'->(case when p_category='cash_tip' then 'finance' else p_category end);
 if cfg is null or cfg->>'enabled' is distinct from 'true' or route is null or route->>'group_id' is distinct from p_group or coalesce(route->>'label','')='' then raise exception 'morning_summary_not_configured';end if;
 if cfg->'routes'->'labor'->>'group_id'=cfg->'routes'->'finance'->>'group_id' then raise exception 'report_routes_must_differ';end if;
 if p_category='cash_tip' and cfg->'cash_tip'->>'enabled' is distinct from 'true' then raise exception 'cash_tip_disabled';end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and all_stores and label=route->>'label') then raise exception 'group_not_enabled';end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' then raise exception 'invalid_message';end if;
 if jsonb_array_length(p_messages)<1 or exists(select 1 from jsonb_array_elements(p_messages)m where jsonb_typeof(m) is distinct from 'object' or m->>'type' is distinct from 'text' or jsonb_typeof(m->'text') is distinct from 'string' or length(m->>'text') not between 1 and 4900) then raise exception 'invalid_message';end if;
 if exists(select 1 from jsonb_array_elements(p_messages)m where m->>'text' not like case p_category when 'labor' then '【勤怠管理｜%' when 'finance' then '【会計管理｜%' else '【キャッシュチップ｜%' end) then raise exception 'report_category_mismatch';end if;
 k:='morning-report:'||p_category||':'||p_day||case when p_variant='daily' then '' else ':'||p_variant end;
 n:=jsonb_array_length(p_messages);
 for i in 0..(n-1)/5 loop
  select jsonb_agg(m order by ord) into bundle from jsonb_array_elements(p_messages) with ordinality x(m,ord) where ord between i*5+1 and i*5+5;
  batches:=batches||jsonb_build_array(jsonb_build_object('state','pending','request_id',case when i=0 then p_request else gen_random_uuid() end,'messages',bundle));
 end loop;
 insert into public.bot_events(event_key,kind,data)values(k,'morning_summary',jsonb_build_object('state','pending','day',p_day,'variant',p_variant,'category',p_category,'group_id',p_group,'request_id',p_request,'snapshot_at',coalesce(p_snapshot_at,now()),'messages',p_messages,'batches',batches))on conflict(event_key)do nothing returning * into e;
 if e.id is null then select * into e from public.bot_events where event_key=k for update;end if;
 if e.id is null or e.kind<>'morning_summary' or e.data->>'group_id' is distinct from p_group then raise exception 'conflict';end if;
 return to_jsonb(e);
end $$;

revoke all on function public.bot_reserve_morning_report(date,text,uuid,jsonb,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.bot_reserve_morning_report(date,text,uuid,jsonb,text,text,timestamptz) to service_role;

create or replace function public.bot_queue_case_notice() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target text;cfg jsonb;route jsonb;
begin
 if new.status=old.status or new.kind='purchase' or not (new.status in ('hq_review','done') or (new.status='correction' and old.status in ('hq_review','verify'))) then return new;end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 if cfg?'routes' then
  route:=cfg->'routes'->(case when new.kind='labor' then 'labor' else 'finance' end);
  if cfg->>'enabled' is distinct from 'true' or not exists(select 1 from public.bot_groups where group_id=route->>'group_id' and enabled and all_stores and label=route->>'label') then return new;end if;
  target:=route->>'group_id';
 else
  target:=case when new.status='hq_review' then cfg->>'group_id' else coalesce(new.payload->'response'->>'group_id',cfg->>'group_id') end;
 end if;
 if target is null or not exists(select 1 from public.bot_groups where group_id=target and enabled and (all_stores or store_id=new.store_id)) then return new;end if;
 insert into public.bot_events(case_id,event_key,kind,data) values(new.id,'lifecycle:'||new.id||':'||new.version,'lifecycle_notice',jsonb_build_object('state','pending','group_id',target,'request_id',gen_random_uuid(),'case',jsonb_build_object('code',new.code,'kind',new.kind,'status',new.status,'status_version',new.status_version,'store_id',new.store_id,'subject',new.subject,'payload',jsonb_build_object('store_name',new.payload->>'store_name','response',new.payload->'response','returned',new.payload->'returned','closure',new.payload->'closure')))) on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function public.bot_queue_case_notice() from public,anon,authenticated;
grant execute on function public.bot_queue_case_notice() to service_role;
