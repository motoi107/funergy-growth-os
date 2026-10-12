-- 中間レビュー：取り消し（中間レビューの表と関数だけを消します。ほかの表・データには触れません）
-- ふだんは消さずに、アプリの設定で「非公開確認」を OFF にすれば、だれも使えなくなります。
-- 本番（live）のレビューが 1 件でもあるときは何も消さずに止まります（デモだけなら消せます）。
-- 確かめと削除を 1 つのブロックにしているので、どの実行方法でも「止まったのに消えた」にはなりません。
do $$ begin
 if to_regclass('public.mr_reviews') is not null and exists(select 1 from public.mr_reviews where env = 'live') then
  raise exception '本番（live）のレビューがあるので止めました。消す前に Moto さんに確認してください。';
 end if;
 drop function if exists public.mr_result_save(jsonb), public.mr_deadline_save(jsonb), public.mr_complete(jsonb), public.mr_reply_send(jsonb),
  public.mr_reply_delete(jsonb), public.mr_reply_save(jsonb), public.mr_recompute(uuid), public.mr_target_final(uuid,text), public.mr_open_waits(uuid,text),
  public.mr_submit(jsonb), public.mr_save(jsonb), public.mr_get(jsonb), public.mr_missing(jsonb,jsonb),
  public.mr_demo_reset(jsonb), public.mr_stores_save(jsonb), public.mr_members_list(jsonb), public.mr_settings_save(jsonb),
  public.mr_list(jsonb), public.mr_whoami(jsonb), public.mr_arr(jsonb), public.mr_reserved_level(uuid,text), public.mr_blank(text), public.mr_date_ok(text), public.mr_written(jsonb), public.mr_targets_at(uuid,integer), public.mr_decided(uuid,text), public.mr_reply_outdated(uuid,integer,text), public.mr_item_at(uuid,integer,text), public.mr_event(uuid,text,text,text,jsonb),
  public.mr_sees(text,uuid,text,uuid,text), public.mr_am_master_ok(uuid,text), public.mr_am_hr_ok(text), public.mr_setting(text);
 if to_regclass('public.mr_reviews') is not null then
  drop function if exists public.mr_summary(public.mr_reviews), public.mr_required_targets(public.mr_reviews), public.mr_view_body(public.mr_reviews);
 end if;
 if to_regclass('public.mr_members') is not null then
  if to_regclass('public.mr_replies') is not null then
   drop function if exists public.mr_reply_missing(public.mr_members,public.mr_replies);
  end if;
  drop function if exists public.mr_reply_review(public.mr_members,jsonb), public.mr_auth(uuid,text[],boolean), public.mr_actor_name(public.mr_members);
 end if;
 drop table if exists public.mr_events, public.mr_replies, public.mr_submissions, public.mr_reviews, public.mr_stores, public.mr_members, public.mr_settings;
end $$;
