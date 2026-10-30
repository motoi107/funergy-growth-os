-- v1118（Moto さん 2026-10-30 の依頼 ①「キャッシュチップ：未登録を自動で0にする」）
--
-- 何をするか
--   キャッシュチップ（app_state の cash_tips_<店>＝{日付: {lunch, dinner, lunchEntered, dinnerEntered, entered, by, at, …}}）で、
--   終わった営業日（ハワイ時間の今日より前）のうち、売上かクレジットチップのある日の「まだ入っていない側」に 0 を書く。
--   ・売上・クレジットチップのある日＝toast_sales の行（lunch_credit_tip・dinner_credit_tip のどちらかがある・net_sales > 0）か、
--     daily_actuals_<店> の日（actual > 0・lunchCreditTip・dinnerCreditTip のどちらかがある）。アプリの v1117 までの判定と同じ。
--     売上の取り込みに失敗した日（行が無い日）には書かない（＝取得失敗を未登録とみなさない）。
--   ・入っている側（0 も・人が入れた値）は変えない。不正な値（数でない・マイナス）も変えない（アプリがエラーに出す）。
--   ・書く印：<側>:0・<側>Entered:true・<側>Auto:true・autoBy:'system'・autoAt（ハワイ時間）。記録の時刻 at・editedAt は付けない
--     （前の版のアプリの合流は時刻の新しいほうを採るので、人が入れた値＝時刻あり がいつも勝つ）。
--   ・キャッシュチップの対象外の店（F03＝FSP・F03-G＝Waikiki Garlic Shack。アプリの NO_CASHTIP_STORES）は書かない。
--   ・締めた期間も書く（支給額・配分は変わらない：未登録は前から 0 として計算している。Tip の確定・締めの記録は触らない）。
--   ・2 回流しても同じ（入っていない側が無ければ何も書かない＝重ねて足さない）。
--   ・書いた日と書く前の記録は cash_tip_autofill_log に残す。cash_tip_autofill_undo(run_id) で、まだ自動の0 のままの側だけ戻せる。
--
-- 足すもの：表 1 つ・関数 4 つ（読むだけの見込みは cash_tip_autofill(…, false)）。ほかの表・行・権限の決まり（RLS）は変えない。
-- 毎日動かすのは deploy/cash-tip-auto-zero-v1118/ の 3（pg_cron に 2 つ）。この SQL だけでは何も書かない。
-- 戻すとき：deploy/cash-tip-auto-zero-v1118/止める.sql（予定を止める）→ 必要なら cash_tip_autofill_undo(run_id)。

create table if not exists public.cash_tip_autofill_log(
  id bigserial primary key,
  run_id uuid not null,
  store_id text not null,
  business_date date not null,
  sides text[] not null,
  before jsonb,                                   -- 書く前のその日の記録（null＝無かった）
  at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists cash_tip_autofill_log_run on public.cash_tip_autofill_log(run_id);
alter table public.cash_tip_autofill_log enable row level security;
revoke all on public.cash_tip_autofill_log from public, anon, authenticated;
grant select, insert, update on public.cash_tip_autofill_log to service_role;
revoke all on sequence public.cash_tip_autofill_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.cash_tip_autofill_log_id_seq to service_role;

-- その側が「入っている」か（アプリの cashTipSideEntered と同じ：<側>Entered が true。欄が無いときは entered が true）
create or replace function public.cash_tip_side_entered(r jsonb, s text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case
    when r is null or jsonb_typeof(r) <> 'object' then false
    when r ? (s || 'Entered') then (r -> (s || 'Entered')) = 'true'::jsonb
    else (r -> 'entered') = 'true'::jsonb
  end
$$;

-- その側が「自動の0」か（アプリの cashTipSideAuto と同じ：<側>Auto が true・入っている・値が 0）
create or replace function public.cash_tip_side_auto(r jsonb, s text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
    public.cash_tip_side_entered(r, s)
    and (r -> (s || 'Auto')) = 'true'::jsonb
    and jsonb_typeof(r -> s) = 'number' and (r ->> s)::numeric = 0, false)
$$;

create or replace function public.cash_tip_autofill(p_from date default null, p_to date default null, p_apply boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Pacific/Honolulu')::date;
  v_to date := least(coalesce(p_to, v_today - 1), v_today - 1);
  v_from date := coalesce(p_from, date '2000-01-01');
  v_run uuid := gen_random_uuid();
  v_excl text[] := array['F03', 'F03-G'];
  v_stamp text := to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI');
  st record;
  v_key text; v_has boolean; v_val jsonb; v_cur jsonb; v_new jsonb; v_rec jsonb; v_nrec jsonb; v_da jsonb;
  v_days date[]; d date; v_sides text[]; v_side text;
  v_n_days int := 0; v_n_sides int := 0; v_s_days int; v_s_sides int;
  v_first date; v_last date; v_by jsonb := '{}'::jsonb; v_skip jsonb := '[]'::jsonb;
begin
  if v_from > v_to then
    return jsonb_build_object('run_id', null, 'apply', p_apply, 'from', v_from, 'to', v_to, 'today_hst', v_today,
      'filled_days', 0, 'filled_sides', 0, 'stores', '{}'::jsonb, 'first', null, 'last', null, 'skipped', '[]'::jsonb);
  end if;

  for st in
    select x.store_id, max(x.guid) as guid
      from (
        select c.store_id::text as store_id, c.restaurant_guid::text as guid from public.store_config c
        union all
        select substr(a.key, 15), null from public.app_state a
         where a.key like 'daily\_actuals\_%' escape '\' and position('_' in substr(a.key, 15)) = 0
      ) x
     where coalesce(x.store_id, '') <> '' and not (x.store_id = any(v_excl))
     group by x.store_id
     order by x.store_id
  loop
    v_key := 'cash_tips_' || st.store_id;

    -- 売上・クレジットチップのある日
    select a.value::jsonb into v_da from public.app_state a where a.key = 'daily_actuals_' || st.store_id;
    if v_da is not null and jsonb_typeof(v_da) = 'object' and v_da ->> '__st' = '1' then v_da := v_da -> 'v'; end if;
    if v_da is null or jsonb_typeof(v_da) <> 'object' then v_da := '{}'::jsonb; end if;
    v_days := array(
      select distinct q.dd from (
        select t.business_date::date as dd from public.toast_sales t
         where st.guid is not null and t.restaurant_guid = st.guid
           and (t.lunch_credit_tip is not null or t.dinner_credit_tip is not null or coalesce(t.net_sales, 0) > 0)
        union all
        select e.key::date from jsonb_each(v_da) e
         where e.key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(e.value) = 'object'
           and ((jsonb_typeof(e.value -> 'actual') = 'number' and (e.value ->> 'actual')::numeric > 0)
             or coalesce(jsonb_typeof(e.value -> 'lunchCreditTip'), 'null') <> 'null'
             or coalesce(jsonb_typeof(e.value -> 'dinnerCreditTip'), 'null') <> 'null')
      ) q
      where q.dd between v_from and v_to
      order by 1);
    if coalesce(array_length(v_days, 1), 0) = 0 then continue; end if;

    -- 今のキャッシュチップ（書くときは行を押さえる：その間にアプリが書いた値を消さない）
    if p_apply then
      select a.value::jsonb into v_val from public.app_state a where a.key = v_key for update;
    else
      select a.value::jsonb into v_val from public.app_state a where a.key = v_key;
    end if;
    v_has := found;
    if v_has and (v_val is null or jsonb_typeof(v_val) <> 'object' or v_val ->> '__st' = '1') then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('store', st.store_id, 'why', 'unexpected_shape'));
      continue;
    end if;
    v_cur := coalesce(v_val, '{}'::jsonb);
    v_new := v_cur; v_s_days := 0; v_s_sides := 0;

    foreach d in array v_days loop
      v_rec := v_cur -> d::text;
      if v_rec is not null and jsonb_typeof(v_rec) not in ('object', 'null') then
        v_skip := v_skip || jsonb_build_array(jsonb_build_object('store', st.store_id, 'date', d, 'why', 'unexpected_record'));
        continue;
      end if;
      if v_rec is not null and jsonb_typeof(v_rec) = 'null' then v_rec := null; end if;
      v_sides := array(select s from unnest(array['lunch', 'dinner']) s where not public.cash_tip_side_entered(v_rec, s));
      if coalesce(array_length(v_sides, 1), 0) = 0 then continue; end if;
      v_nrec := coalesce(v_rec, '{}'::jsonb);
      foreach v_side in array v_sides loop
        v_nrec := v_nrec || jsonb_build_object(v_side, 0, v_side || 'Entered', true, v_side || 'Auto', true);
      end loop;
      v_nrec := v_nrec || jsonb_build_object(
        'entered', public.cash_tip_side_entered(v_nrec, 'lunch') and public.cash_tip_side_entered(v_nrec, 'dinner'),
        'autoBy', 'system', 'autoAt', v_stamp);
      v_new := jsonb_set(v_new, array[d::text], v_nrec, true);
      v_s_days := v_s_days + 1; v_s_sides := v_s_sides + array_length(v_sides, 1);
      v_first := least(v_first, d); v_last := greatest(v_last, d);
      if p_apply then
        insert into public.cash_tip_autofill_log(run_id, store_id, business_date, sides, before)
        values (v_run, st.store_id, d, v_sides, v_rec);
      end if;
    end loop;

    if v_s_days > 0 then
      v_n_days := v_n_days + v_s_days; v_n_sides := v_n_sides + v_s_sides;
      v_by := v_by || jsonb_build_object(st.store_id, jsonb_build_object('days', v_s_days, 'sides', v_s_sides));
      if p_apply then
        if v_has then
          update public.app_state set value = v_new, updated_at = now() where key = v_key;
        else
          insert into public.app_state(key, value, updated_at) values (v_key, v_new, now()) on conflict (key) do nothing;
          if not found then
            -- 同じときにアプリが行を作った：今回は書かない（次に流したときに書く）。記録も消す
            delete from public.cash_tip_autofill_log where run_id = v_run and store_id = st.store_id;
            v_skip := v_skip || jsonb_build_array(jsonb_build_object('store', st.store_id, 'why', 'row_created_meanwhile'));
          end if;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('run_id', case when p_apply and v_n_days > 0 then v_run end, 'apply', p_apply,
    'from', v_from, 'to', v_to, 'today_hst', v_today, 'filled_days', v_n_days, 'filled_sides', v_n_sides,
    'stores', v_by, 'first', v_first, 'last', v_last, 'skipped', v_skip);
end
$$;

-- 戻す：その回で書いた側のうち、まだ自動の0 のままの側だけを書く前に戻す（人があとで入れた値は変えない）
create or replace function public.cash_tip_autofill_undo(p_run uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  l record; v_val jsonb; v_rec jsonb; v_before jsonb; v_side text; v_n int := 0; v_kept int := 0;
begin
  for l in select * from public.cash_tip_autofill_log where run_id = p_run and undone_at is null order by store_id, business_date for update loop
    select a.value::jsonb into v_val from public.app_state a where a.key = 'cash_tips_' || l.store_id for update;
    if not found or v_val is null or jsonb_typeof(v_val) <> 'object' then continue; end if;
    v_rec := v_val -> l.business_date::text;
    if v_rec is null or jsonb_typeof(v_rec) <> 'object' then continue; end if;
    v_before := coalesce(l.before, '{}'::jsonb);
    foreach v_side in array l.sides loop
      if public.cash_tip_side_auto(v_rec, v_side) then
        v_rec := v_rec - v_side - (v_side || 'Entered') - (v_side || 'Auto');
        if v_before ? v_side then v_rec := v_rec || jsonb_build_object(v_side, v_before -> v_side); end if;
        if v_before ? (v_side || 'Entered') then v_rec := v_rec || jsonb_build_object(v_side || 'Entered', v_before -> (v_side || 'Entered')); end if;
        v_n := v_n + 1;
      else
        v_kept := v_kept + 1;
      end if;
    end loop;
    if not (public.cash_tip_side_auto(v_rec, 'lunch') or public.cash_tip_side_auto(v_rec, 'dinner')) then
      v_rec := v_rec - 'autoBy' - 'autoAt';
    end if;
    -- entered：書く前の値に戻す（無かったら消す）。その後に人が両側を入れていれば true
    v_rec := v_rec - 'entered';
    if v_before ? 'entered' then v_rec := v_rec || jsonb_build_object('entered', v_before -> 'entered'); end if;
    if (v_rec -> 'lunchEntered') = 'true'::jsonb and (v_rec -> 'dinnerEntered') = 'true'::jsonb then
      v_rec := v_rec || jsonb_build_object('entered', true);
    end if;
    if l.before is null and (v_rec = '{}'::jsonb) then
      v_val := v_val - l.business_date::text;
    else
      v_val := jsonb_set(v_val, array[l.business_date::text], v_rec, true);
    end if;
    update public.app_state set value = v_val, updated_at = now() where key = 'cash_tips_' || l.store_id;
    update public.cash_tip_autofill_log set undone_at = now() where id = l.id;
  end loop;
  return jsonb_build_object('run_id', p_run, 'undone_sides', v_n, 'kept_sides_changed_by_people', v_kept);
end
$$;

-- Supabase は public に新しく作った関数を anon・authenticated にも実行できるようにする（既定の権限）。ここで外す
revoke all on function public.cash_tip_side_entered(jsonb, text) from public, anon, authenticated;
revoke all on function public.cash_tip_side_auto(jsonb, text) from public, anon, authenticated;
revoke all on function public.cash_tip_autofill(date, date, boolean) from public, anon, authenticated;
revoke all on function public.cash_tip_autofill_undo(uuid) from public, anon, authenticated;
grant execute on function public.cash_tip_side_entered(jsonb, text) to service_role;
grant execute on function public.cash_tip_side_auto(jsonb, text) to service_role;
grant execute on function public.cash_tip_autofill(date, date, boolean) to service_role;
grant execute on function public.cash_tip_autofill_undo(uuid) to service_role;

comment on function public.cash_tip_autofill(date, date, boolean) is
  'v1118: 終わった営業日（売上・クレジットチップのある日）のキャッシュチップの未登録の側に自動の0 を書く。p_apply=false は見込みだけ（何も書かない）。2 回流しても同じ。';
