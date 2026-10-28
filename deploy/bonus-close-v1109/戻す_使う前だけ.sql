-- v1109 ボーナスの締め：入れた表と関数を消す（まだ一度も版を保存していないときだけ）。
-- 版・下書き・調整記録が 1 つでもあれば、何も消さずに止まります（版は消しません）。
do $$ begin
 if to_regclass('public.bc_versions') is not null and (exists(select 1 from public.bc_versions) or exists(select 1 from public.bc_quarters) or exists(select 1 from public.bc_adjust)) then
  raise exception 'STOP: ボーナスの締めの記録があるため、何も消していません';
 end if;
end $$;
drop function if exists public.bc_adjust_done(jsonb), public.bc_mark_paid(jsonb), public.bc_fix_cancel(jsonb), public.bc_fix_start(jsonb), public.bc_confirm(jsonb),
  public.bc_save(jsonb), public.bc_draft_save(jsonb), public.bc_lock(text,integer), public.bc_version(jsonb), public.bc_get(jsonb), public.bc_vrow(public.bc_versions),
  public.bc_snap_check(text,jsonb), public.bc_draft_ok(jsonb), public.bc_choices_ok(jsonb,jsonb), public.bc_step_ok(jsonb), public.bc_txt_ok(jsonb,integer,boolean),
  public.bc_event(text,jsonb,text,jsonb), public.bc_rev(jsonb), public.bc_q(jsonb), public.bc_writer(jsonb), public.bc_actor(jsonb);
drop table if exists public.bc_events, public.bc_adjust, public.bc_versions, public.bc_quarters;
select 'removed' as result;
