-- 戻す（v1144・20261113090000_secure_emp_pii.sql を入れる前に戻す）。困ったときだけ。
-- ・emp_pii の値（生年月日・カードの下 4 桁・保険の加入・保険料）を、従業員の表（employees の data）に戻す（emp_pii にある人だけ。
--   emp_pii の値が新しいので、従業員の表の同じ欄は上書きする）。ほかの欄・列・状態の版は変えない。
-- ・書くたびに外す見張り（employees_pii_strip_trg）を外す。emp_pii を公開の鍵の決まりから外す（ss_secret_key を v1142 の形に）。
--   成長カルテ・賞与・Career Score・採用・相談は外したまま。v1141・v1143 の決まり（ss_guard_*）はそのまま。
-- ・emp_pii の行は消さない（写しとして残す。このあと公開の鍵で読める＝v1143 までと同じ見え方）。
-- ・アプリも v1143 に戻すとき（関数を v1143 に戻す前に、この SQL を流す。v1144 の関数・アプリのままでも、従業員の表の値を読む）。
-- ・2 回流しても同じ。
drop trigger if exists employees_pii_strip_trg on public.employees;

do $$
declare cur jsonb; n int;
begin
  lock table public.employees in share row exclusive mode;
  select s.value::jsonb into cur from public.app_state s where s.key::text = 'emp_pii' for update;
  if cur is null or jsonb_typeof(cur) <> 'object' then
    raise notice 'v1144 を戻す：emp_pii の行が無い（またはオブジェクトでない）ので、従業員の表は変えません';
  else
    update public.employees e
       set data = e.data || (select coalesce(jsonb_object_agg(k, cur -> e.id::text -> k), '{}'::jsonb)
                               from unnest(array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt']) k where (cur -> e.id::text) ? k)
     where e.data is not null and jsonb_typeof(e.data) = 'object' and jsonb_typeof(cur -> e.id::text) = 'object'
       and exists (select 1 from unnest(array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt']) k
                    where (cur -> e.id::text) ? k and (e.data -> k) is distinct from (cur -> e.id::text -> k));
    get diagnostics n = row_count;
    raise notice 'v1144 を戻す：従業員の表の % 行に個人の欄を戻しました', n;
  end if;
end $$;

create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$'                         -- spl_bonus_q_<四半期>（v1139）
      or k in ('lss_scores', 'lss_requests', 'lss_history')                -- v1140：Career Score の前の統合行
      or (length(k) > 8 and left(k, 8) = 'lss_emp_')                      -- v1140：点（人ごと）
      or (length(k) > 17 and left(k, 17) = 'spl_lss_requests_')           -- v1140：申請（人ごと）
      or (length(k) > 16 and left(k, 16) = 'spl_lss_history_')            -- v1140：履歴（人ごと）
      or k in ('applicants', 'reject_log', 'growthhub'), false)            -- v1142：採用（応募者・不採用ログ）・お悩み相談室
$$;
comment on function public.ss_secret_key(text) is
  'v1142: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey と同じ決まり。';

notify pgrst, 'reload schema';
