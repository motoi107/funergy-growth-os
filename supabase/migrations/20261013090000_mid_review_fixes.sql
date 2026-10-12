-- Mid-review (private) fixes after the Codex review of PR #44 (v1068).
-- Run after 20261012090000_mid_review.sql. Only replaces three functions; tables, rows and settings are not touched.
-- 1) mr_auth: a CEO / GM uses the narrower of the two roles (the copy in mr_members and manager_auth).
--    A CEO changed to GM in manager_auth is a GM here at once (no CEO-only decisions), and a GM changed
--    to CEO there stays a GM here until a GM / CEO adds them again as CEO.
-- 2) mr_reply_send: sends only the drafts the screen showed, at the versions it showed. Another tab of the
--    same person that changed, added, deleted or already sent a draft makes it refuse with drafts_changed
--    (load and look again). A sent reply records the role and name at the time of sending. It also holds this
--    person's draft rows for the transaction, so none can be deleted between the check and the sending.
-- 3) mr_reply_delete: locks the review row first, in the same order as saving and sending. Without it a delete
--    from another tab could commit after mr_reply_send had checked the draft set and before it read the drafts
--    again: only part of the set the person saw was sent, and nothing said drafts_changed.

-- The signed-in person, if they may use the feature with one of these roles. p_enabled: also require the private check to be on.
-- A CEO / GM must also still be CEO / GM in manager_auth (the narrower role of the two is used). Taking someone off there takes them off here.
-- An AM must also still be an AM in the employee master (not 退職, not moved to another role such as G4).
create or replace function public.mr_auth(p_actor uuid, p_roles text[], p_enabled boolean) returns public.mr_members
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members; v_ma text;
begin
 if p_actor is null then raise exception 'actor_required'; end if;
 select * into m from public.mr_members where user_id=p_actor and enabled;
 if m.user_id is null then raise exception 'forbidden'; end if;
 if m.role in ('ceo','gm') then
  select case when bool_or(a.role = 'gm') then 'gm' when bool_or(a.role = 'ceo') then 'ceo' end into v_ma
   from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm');
  if v_ma is null then raise exception 'forbidden'; end if;
  -- The narrower of the two copies (a GM in either one is a GM here; a CEO only when both say CEO).
  if m.role = 'gm' or v_ma = 'gm' then m.role := 'gm'; end if;
 end if;
 if not (m.role = any(p_roles)) then raise exception 'forbidden'; end if;
 if m.role = 'am' and not public.mr_am_hr_ok(m.emp_id) then raise exception 'forbidden'; end if;
 if p_enabled and coalesce((public.mr_setting('flags')->>'private')::boolean, false) is not true then raise exception 'disabled'; end if;
 return m;
end $$;

create or replace function public.mr_reply_send(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); x public.mr_replies; v_bad text; n integer := 0;
begin
 select * into r from public.mr_reviews where id = r.id for update;
 if r.status not in ('submitted','followup','decision','consult') then raise exception 'locked'; end if;
 -- Sent while looking at the latest submitted version (a newer one came in: load it and look again).
 if (p->>'expect_no') is null or (p->>'expect_no') !~ '^[0-9]{1,6}$' or (p->>'expect_no')::integer <> r.submitted_no then raise exception 'new_version'; end if;
 -- Hold this person's drafts for the rest of the transaction, in the same order as mr_reply_save and
 -- mr_reply_delete take their locks (the review row first, then the reply rows). Another tab cannot then
 -- delete or change one between the check below and the two loops that read the drafts again.
 perform 1 from public.mr_replies y where y.review_id = r.id and y.author = m.user_id and y.state = 'draft' for update;
 -- Only the drafts the screen showed, at the versions it showed (another tab of the same person may have changed or added one).
 if jsonb_typeof(p->'drafts') is distinct from 'array'
    or exists(select 1 from public.mr_replies y where y.review_id = r.id and y.author = m.user_id and y.state = 'draft'
      and not exists(select 1 from jsonb_array_elements(p->'drafts') d where d->>'id' = y.id::text and d->>'version' = y.version::text))
    or exists(select 1 from jsonb_array_elements(p->'drafts') d where not exists(select 1 from public.mr_replies y where y.review_id = r.id
      and y.author = m.user_id and y.state = 'draft' and y.id::text = d->>'id' and y.version::text = d->>'version')) then raise exception 'drafts_changed'; end if;
 -- (after the check above: a tab whose drafts another tab already sent is told to load again, not "nothing to send")
 if not exists(select 1 from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft') then raise exception 'nothing'; end if;
 for x in select * from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' order by created_at loop
  v_bad := public.mr_reply_missing(m, x);
  if v_bad is not null then raise exception 'incomplete'; end if;
 end loop;
 for x in select * from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' order by created_at loop
  if x.decision in ('as_proposed','modify','no_action') then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now()), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and coalesce((data->>'resolved')::boolean, false) is not true
     and (decision = 'consult' or (decision = 'escalate' and (escalate_to = 'ceo' and m.role = 'ceo' or escalate_to = 'gm' and m.role in ('gm','ceo'))));
  end if;
  -- A new 1:1 talk on the same item replaces the one planned before (a new date, people or topics).
  if x.decision = 'consult' then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now(), 'replaced', true), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and decision = 'consult' and coalesce((data->>'resolved')::boolean, false) is not true;
  end if;
  -- A GM passing a GM item on to the CEO: the GM's part is done (it now waits for the CEO only).
  if x.decision = 'escalate' and x.escalate_to = 'ceo' and m.role = 'gm' then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now(), 'forwarded', 'ceo'), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and decision = 'escalate' and escalate_to = 'gm' and coalesce((data->>'resolved')::boolean, false) is not true;
  end if;
  -- The role and name at the time of sending (the role may have changed since the draft was first saved).
  update public.mr_replies set state = 'sent', sent_at = now(), sub_no = r.submitted_no, author_role = m.role, author_name = public.mr_actor_name(m), updated_at = now() where id = x.id;
  n := n + 1;
 end loop;
 -- At most 20 questions wait for the store manager at once (one answer each, all in one version).
 if (select count(*) from public.mr_replies q where q.review_id = r.id and q.state = 'sent' and q.decision = 'followup'
     and coalesce((q.data->>'resolved')::boolean, false) is not true) > 20 then raise exception 'too_many'; end if;
 -- The review's version is the store manager's working copy: a reply does not make their next save a conflict.
 update public.mr_reviews set updated_at = now(), updated_by = public.mr_actor_name(m) where id = r.id;
 perform public.mr_recompute(r.id);
 perform public.mr_event(r.id, r.env, m.user_id::text, 'reply', jsonb_build_object('by', public.mr_actor_name(m), 'count', n));
 select * into r from public.mr_reviews where id = r.id;
 return jsonb_build_object('sent', n, 'status', r.status, 'version', r.version);
end $$;

-- Delete one of my own drafts. Takes the review lock first, so a send that is checking this person's drafts
-- finishes before the delete is applied (it then deletes nothing, because the draft has become 'sent').
create or replace function public.mr_reply_delete(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); n integer;
begin
 select * into r from public.mr_reviews where id = r.id for update;
 delete from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' and target = p->>'target';
 get diagnostics n = row_count;
 return jsonb_build_object('deleted', n);
end $$;

do $$ declare f text; begin
 foreach f in array array['mr_auth(uuid,text[],boolean)','mr_reply_send(jsonb)','mr_reply_delete(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
