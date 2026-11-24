-- B-2（v1212）：Payroll 別のガソリン代・立替経費（統合実装プロンプトの B-2・Moto さん 11/23 13:59 HST・UI案100 の答え 11/24 04:15 HST）。
-- 仕様：docs/PAYROLL_EXPENSE_V1212_JA.md。関数 payroll-expense（PIN のログインの印を work-requests の whoami に確かめてもらう）だけが呼ぶ。
--
-- 決まり（Moto さん 11/24）：
--   期間は 1〜15 日（'YYYY-MM-1'）と 16 日〜末日（'YYYY-MM-2'）。日はハワイ時間。
--   支給日：1〜15 日は同じ月の 22 日・16 日〜末日は翌月 7 日（設定で変えられる）。土日なら前の金曜・平日の祝日なら前の営業日。
--     祝日は米国の銀行の休日（Federal Reserve の休日：土曜の祝日は前の金曜に移さない・日曜は翌月曜）を初めの値にし、設定で足す・外す。
--   1 B：精算確定（checked）になった日（ハワイ時間）が入る期間に、割当として保存する（使用日・申請日・承認日では決めない）。
--     その期間がもう支給済みなら次の期間。出力済み（まだ支給していない）の期間なら、その期間に足す（次に出すと次の版）。
--     割当は理由つきで変えられる・分けられる（CEO・GM・経理・事務Crew）。保存した割当を正とする（あとから自動で動かさない。
--     ただし自動の割当のまま、もう一度精算確定になった申請は、支給していない期間なら新しい精算確定の日で入れ直す）。
--   3 B：前に「支払・精算を記録」した分（精算済み・この B-2 の支給ではないもの）は、支払日（pay_date。無ければ paid_at のハワイの日）が入る
--     期間の「既払・他経路支給額」。前の画面から写した立替経費の「支払済」（legacy_info.paidAt・日本時間）はハワイの日に直す。
--     時刻が無く、日本時間とハワイ時間で期間の境目（15/16 日・末日/1 日）をまたぐものだけ「支給期間要確認」（割当を作らない）。
--     ガソリン代の「月末処理」は支払った日ではないので「支払状況要確認」（支給に入れない）。
--   4 A・7 A：支給済みにするのは期間ごとに 1 回（出力した版の写しを固定）。CEO・GM・経理・事務Crew（このサーバーで確かめる）。
--     出力しただけでは支給済みにしない。支給済みにすると、その版の「今回 Payroll」の申請を精算済み（pay_method 'Payroll'・支給日）にする。
--   二重に数えない：1 つの申請はいつも 1 つの割当の組（分けたときは額の合計＝申請の額）。精算済みの申請は「既払」として数え、今回の支給に入れない。
--   負の差額は給与から引かない（「要確認」に出す・今回の支給の合計に入れない）。金額と日付が同じだけで自動で消さない。
-- 給与・Tip・賞与は読まない・返さない。前の割当・版・支給の記録は消さない（変えたら off_at を付けて残す）。
-- 2 回流しても同じ。前提：申請の SQL（20261104090000 から・wr_actor・wr_requests・wr_events・wr_legacy_paid）。
do $$
begin
 if to_regprocedure('public.wr_actor(jsonb)') is null or to_regclass('public.wr_requests') is null or to_regclass('public.wr_events') is null
    or to_regprocedure('public.wr_legacy_paid(public.wr_requests)') is null then
  raise exception 'STOP: 先に申請の SQL（deploy/work-requests-v1131 から）を流してください。何も変えていません。';
 end if;
end $$;

-- ---------------------------------------------------------------- 表（サーバーの鍵だけ）
create table if not exists public.pe_settings (
  id integer primary key default 1 check (id = 1),
  day_first integer not null default 22 check (day_first between 1 and 28),    -- 1〜15 日の期間の支給日（同じ月）
  day_second integer not null default 7 check (day_second between 1 and 28),   -- 16 日〜末日の期間の支給日（翌月）
  holidays_add date[] not null default '{}'::date[],   -- 足す休日（ハワイの州の休日など）
  holidays_off date[] not null default '{}'::date[],   -- 外す休日（銀行が開いている日）
  rev integer not null default 1,
  updated_emp text, updated_name text, updated_at timestamptz not null default now()
);
insert into public.pe_settings (id) values (1) on conflict (id) do nothing;

-- 割当：申請（ガソリン代・立替経費）を Payroll の期間に。cents が null＝申請の額のすべて。分けたときは額。
-- 変えたら前の行に off_at を付けて残す（消さない）
create table if not exists public.pe_alloc (
  id bigserial primary key,
  request_id uuid not null references public.wr_requests(id),
  period text not null check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[12]$'),
  cents bigint check (cents is null or cents > 0),
  how text not null check (how in ('auto', 'manual')),
  basis text,
  reason text,
  by_emp text, by_name text, at timestamptz not null default now(),
  off_at timestamptz, off_emp text, off_name text, off_reason text
);
create index if not exists pe_alloc_req_idx on public.pe_alloc(request_id) where off_at is null;
create index if not exists pe_alloc_period_idx on public.pe_alloc(period) where off_at is null;

-- 出力の版（写し）。同じ中身（指紋 fp が同じ）なら新しい版を作らない
create table if not exists public.pe_exports (
  id bigserial primary key,
  period text not null check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[12]$'),
  ver integer not null check (ver >= 1),
  fp text not null,
  pay_day date not null,
  rows jsonb not null, lines jsonb not null, totals jsonb not null, review jsonb not null default '[]'::jsonb,
  by_emp text, by_name text, by_role text, at timestamptz not null default now(),
  unique (period, ver)
);

-- 支給済み（期間ごとに 1 回）。その版の写しを固定する
create table if not exists public.pe_paid (
  period text primary key check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[12]$'),
  export_id bigint not null references public.pe_exports(id),
  pay_day date not null,
  note text,
  by_emp text, by_name text, by_role text, at timestamptz not null default now()
);
-- 支給済みにした期間で Payroll から払った申請（既払・他経路と分けるため）
create table if not exists public.pe_paid_req (
  request_id uuid not null references public.wr_requests(id),
  period text not null references public.pe_paid(period),
  cents bigint not null,
  primary key (request_id, period)
);

alter table public.pe_settings enable row level security;
alter table public.pe_alloc enable row level security;
alter table public.pe_exports enable row level security;
alter table public.pe_paid enable row level security;
alter table public.pe_paid_req enable row level security;
revoke all on public.pe_settings, public.pe_alloc, public.pe_exports, public.pe_paid, public.pe_paid_req from public, anon, authenticated;
grant select, insert, update on public.pe_settings, public.pe_alloc, public.pe_exports, public.pe_paid, public.pe_paid_req to service_role;
revoke all on sequence public.pe_alloc_id_seq, public.pe_exports_id_seq from public, anon, authenticated;
grant usage, select on sequence public.pe_alloc_id_seq, public.pe_exports_id_seq to service_role;

-- ---------------------------------------------------------------- 日と期間
create or replace function public.pe_hst(ts timestamptz) returns date
language sql stable security invoker set search_path = public, pg_temp as $$
 select (ts at time zone 'Pacific/Honolulu')::date;
$$;
create or replace function public.pe_period_ok(p text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(p ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[12]$', false);
$$;
create or replace function public.pe_period_of(d date) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select to_char(d, 'YYYY-MM') || case when extract(day from d) <= 15 then '-1' else '-2' end;
$$;
create or replace function public.pe_period_from(p text) returns date
language sql immutable security invoker set search_path = public, pg_temp as $$
 select make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, case right(p, 1) when '1' then 1 else 16 end);
$$;
create or replace function public.pe_period_to(p text) returns date
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case right(p, 1) when '1' then make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, 15)
  else (make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, 1) + interval '1 month' - interval '1 day')::date end;
$$;
create or replace function public.pe_period_next(p text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case right(p, 1) when '1' then left(p, 7) || '-2'
  else to_char(make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, 1) + interval '1 month', 'YYYY-MM') || '-1' end;
$$;

-- その月の n 回目の曜日（dow：0＝日 … 6＝土）
create or replace function public.pe_nth_dow(y integer, m integer, dow integer, n integer) returns date
language sql immutable security invoker set search_path = public, pg_temp as $$
 select make_date(y, m, 1) + ((dow - extract(dow from make_date(y, m, 1))::int + 7) % 7) + (n - 1) * 7;
$$;
-- 米国の銀行の休日（Federal Reserve の休日の決まり）：元日・キング牧師の日（1 月の第 3 月曜）・大統領の日（2 月の第 3 月曜）・戦没将兵追悼記念日（5 月の最後の月曜）・
-- ジューンティーンス（6/19）・独立記念日（7/4）・レイバーデー（9 月の第 1 月曜）・コロンブスデー（10 月の第 2 月曜）・復員軍人の日（11/11）・感謝祭（11 月の第 4 木曜）・
-- クリスマス（12/25）。日付の決まった休日が日曜なら翌月曜、土曜なら移さない（銀行は前の金曜に開いている）。
create or replace function public.pe_fed_holidays(y integer) returns setof date
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case extract(dow from d)::int when 0 then d + 1 else d end
 from (values (make_date(y, 1, 1)), (make_date(y, 6, 19)), (make_date(y, 7, 4)), (make_date(y, 11, 11)), (make_date(y, 12, 25))) f(d)
 where extract(dow from d)::int <> 6
 union all select public.pe_nth_dow(y, 1, 1, 3)
 union all select public.pe_nth_dow(y, 2, 1, 3)
 union all select make_date(y, 5, 31) - ((extract(dow from make_date(y, 5, 31))::int - 1 + 7) % 7)
 union all select public.pe_nth_dow(y, 9, 1, 1)
 union all select public.pe_nth_dow(y, 10, 1, 2)
 union all select public.pe_nth_dow(y, 11, 4, 4);
$$;
create or replace function public.pe_is_holiday(d date) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce((select d = any(s.holidays_add) from public.pe_settings s where s.id = 1), false)
  or (d in (select public.pe_fed_holidays(extract(year from d)::int))
      and not coalesce((select d = any(s.holidays_off) from public.pe_settings s where s.id = 1), false));
$$;
-- 期間の支給日：決まりの日 → 土曜は前の金曜・日曜は前の金曜・平日の祝日は前の営業日（くり返す）
create or replace function public.pe_pay_day(p text) returns date
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s public.pe_settings; d date; i integer := 0;
begin
 if not public.pe_period_ok(p) then raise exception 'bad_value'; end if;
 select * into s from public.pe_settings where id = 1;
 if right(p, 1) = '1' then d := make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, coalesce(s.day_first, 22));
 else d := (make_date(substr(p, 1, 4)::int, substr(p, 6, 2)::int, 1) + interval '1 month')::date + (coalesce(s.day_second, 7) - 1);
 end if;
 loop
  i := i + 1; exit when i > 30;
  if extract(dow from d)::int = 6 then d := d - 1;
  elsif extract(dow from d)::int = 0 then d := d - 2;
  elsif public.pe_is_holiday(d) then d := d - 1;
  else exit;
  end if;
 end loop;
 return d;
end $$;

-- ---------------------------------------------------------------- だれか
-- 申請の SQL の wr_actor で決める（確かめた PIN の事務Crew も・B-1）。CEO・GM・経理・事務Crew だけ
create or replace function public.pe_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb;
begin
 a := public.wr_actor(jsonb_build_object('emp_id', p->>'emp_id', 'name', p->>'name'));
 if coalesce(a->>'role', '') not in ('ceo', 'gm', 'office', 'office_crew') then raise exception 'forbidden'; end if;
 return a;
end $$;

-- ---------------------------------------------------------------- 申請ごとの決め方
-- 対象：ガソリン代・立替経費で、精算確定（checked）か精算済み（paid）・額がある
create or replace function public.pe_in_scope(r public.wr_requests) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select r.kind in ('mileage', 'reimburse') and r.status in ('checked', 'paid') and r.amount_cents is not null;
$$;
-- st：'pay'（今回の Payroll に入れる・day＝精算確定の日）／'other'（既払・他経路・day＝支払日）／
--     'month_end'（支払状況要確認：ガソリン代の月末処理）／'unsure'（支給期間要確認）
create or replace function public.pe_basis(r public.wr_requests) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text; m text[]; d date; t timestamptz;
begin
 if r.status = 'checked' then
  if r.checked_at is not null then return jsonb_build_object('st', 'pay', 'day', public.pe_hst(r.checked_at), 'basis', 'checked:' || public.pe_hst(r.checked_at)); end if;
  return jsonb_build_object('st', 'unsure', 'why', 'checked_no_time');
 end if;
 if coalesce(r.pay_method, '') = '月末処理' then
  return jsonb_build_object('st', 'month_end', 'ym', coalesce(substring(coalesce(r.legacy_info->>'archivedMonth', '') from '^(20[0-9]{2}-[0-9]{2})'),
   to_char(coalesce(r.use_date, public.pe_hst(r.submitted_at)), 'YYYY-MM')));
 end if;
 if r.pay_date is not null then return jsonb_build_object('st', 'other', 'day', r.pay_date, 'basis', 'pay_date:' || r.pay_date); end if;
 if not r.legacy and r.paid_at is not null then return jsonb_build_object('st', 'other', 'day', public.pe_hst(r.paid_at), 'basis', 'paid_at:' || public.pe_hst(r.paid_at)); end if;
 if r.legacy then
  v := btrim(coalesce(r.legacy_info->>'paidAt', ''));
  m := regexp_match(v, '^(20[0-9]{2})[/-]([0-9]{1,2})[/-]([0-9]{1,2})(?:[ T]+([0-9]{1,2}):([0-9]{2}))?');
  if m is null then return jsonb_build_object('st', 'unsure', 'why', 'legacy_no_date'); end if;
  begin
   d := make_date(m[1]::int, m[2]::int, m[3]::int);
   if m[4] is not null then t := make_timestamp(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, 0) at time zone 'Asia/Tokyo'; end if;
  exception when others then return jsonb_build_object('st', 'unsure', 'why', 'legacy_no_date');
  end;
  -- 前の画面の「支払済」は日本時間の記録：時刻があればハワイの日に直す
  if t is not null then return jsonb_build_object('st', 'other', 'day', public.pe_hst(t), 'basis', 'legacy_jst:' || public.pe_hst(t)); end if;
  -- 日付だけ：ハワイでは同じ日か前の日。期間の境目をまたぐときだけ要確認
  if public.pe_period_of(d) <> public.pe_period_of(d - 1) then return jsonb_build_object('st', 'unsure', 'why', 'legacy_border', 'day', d); end if;
  return jsonb_build_object('st', 'other', 'day', d, 'basis', 'legacy_date:' || d);
 end if;
 return jsonb_build_object('st', 'unsure', 'why', 'paid_no_date');
end $$;

-- ---------------------------------------------------------------- 割当を保存する（読む・出す・支給の前にいつも）
-- 割当の無い対象の申請：'pay' は精算確定の日の期間（支給済みなら次の期間）、'other' は支払日の期間に自動で入れる。
-- 自動の割当のまま、もう一度精算確定になった申請（精算確定の日が変わった）は、支給していない期間なら入れ直す。
create or replace function public.pe_sync() returns integer
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare r public.wr_requests; b jsonb; per text; n integer := 0; i integer;
begin
 perform pg_advisory_xact_lock(hashtext('pe_alloc'));
 -- 入れ直し（自動・精算確定の日が変わった・その期間が支給済みでない・その申請をまだ Payroll で払っていない）
 update public.pe_alloc a set off_at = now(), off_name = 'auto', off_reason = 'checked_again'
 from public.wr_requests q
 where q.id = a.request_id and a.off_at is null and a.how = 'auto' and q.status = 'checked' and q.checked_at is not null
   and coalesce(a.basis, '') like 'checked:%' and a.basis <> 'checked:' || public.pe_hst(q.checked_at)
   and not exists (select 1 from public.pe_paid pp where pp.period = a.period)
   and not exists (select 1 from public.pe_paid_req x where x.request_id = q.id);
 for r in
  select q.* from public.wr_requests q
  where public.pe_in_scope(q) and not exists (select 1 from public.pe_alloc a where a.request_id = q.id and a.off_at is null)
 loop
  b := public.pe_basis(r);
  if b->>'st' not in ('pay', 'other') then continue; end if;
  per := public.pe_period_of((b->>'day')::date);
  if b->>'st' = 'pay' then
   i := 0;
   while exists (select 1 from public.pe_paid pp where pp.period = per) and i < 240 loop per := public.pe_period_next(per); i := i + 1; end loop;
  end if;
  insert into public.pe_alloc (request_id, period, cents, how, basis, by_name) values (r.id, per, null, 'auto', b->>'basis', 'auto');
  n := n + 1;
 end loop;
 return n;
end $$;

-- ---------------------------------------------------------------- 期間の中身
-- 行（申請ごと）：state＝'pay'（今回 Payroll）・'other'（既払・他経路）・'payroll'（この期間の支給で払った）
create or replace function public.pe_lines(p text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', q.id, 'code', q.code, 'kind', q.kind,
   'emp', coalesce(q.requester_emp, 'name:' || q.requester_name), 'has_emp', q.requester_emp is not null,
   'name', coalesce(nullif(btrim(coalesce(e.name, '')), ''), q.requester_name),
   'cents', coalesce(a.cents, q.amount_cents), 'amount', q.amount_cents, 'split', a.cents is not null,
   'state', case when exists (select 1 from public.pe_paid_req x where x.request_id = q.id and x.period = p) then 'payroll'
                 when q.status = 'paid' and not exists (select 1 from public.pe_paid_req x where x.request_id = q.id) then 'other'
                 else 'pay' end,
   'alloc', a.id, 'how', a.how, 'reason', a.reason, 'basis', a.basis,
   'use_date', q.use_date, 'checked_at', q.checked_at, 'pay_date', q.pay_date, 'pay_method', q.pay_method, 'legacy', q.legacy, 'status', q.status)
   order by coalesce(nullif(btrim(coalesce(e.name, '')), ''), q.requester_name), q.kind, q.use_date nulls last, q.code), '[]'::jsonb)
 from public.pe_alloc a join public.wr_requests q on q.id = a.request_id
 left join public.employees e on e.id::text = q.requester_emp
 where a.off_at is null and a.period = p and public.pe_in_scope(q);
$$;

-- 期間のまとめ（1 人 1 行・セント）と指紋
create or replace function public.pe_build(p text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare ls jsonb := public.pe_lines(p); rs jsonb; tot jsonb; pd date := public.pe_pay_day(p);
begin
 select coalesce(jsonb_agg(x order by x->>'name', x->>'emp'), '[]'::jsonb) into rs from (
  select jsonb_build_object('emp', l->>'emp', 'has_emp', bool_and((l->>'has_emp')::boolean), 'name', min(l->>'name'),
   'gas', coalesce(sum((l->>'cents')::bigint) filter (where l->>'kind' = 'mileage'), 0),
   'reimb', coalesce(sum((l->>'cents')::bigint) filter (where l->>'kind' = 'reimburse'), 0),
   'total', coalesce(sum((l->>'cents')::bigint), 0),
   'other', coalesce(sum((l->>'cents')::bigint) filter (where l->>'state' = 'other'), 0),
   'payroll', coalesce(sum((l->>'cents')::bigint) filter (where l->>'state' <> 'other'), 0),
   'n', count(*)) x
  from jsonb_array_elements(ls) l group by l->>'emp') z;
 select jsonb_build_object('people', jsonb_array_length(rs), 'lines', jsonb_array_length(ls),
   'gas', coalesce(sum((x->>'gas')::bigint), 0), 'reimb', coalesce(sum((x->>'reimb')::bigint), 0), 'total', coalesce(sum((x->>'total')::bigint), 0),
   'other', coalesce(sum((x->>'other')::bigint), 0),
   -- 負の差額は給与から引かない：今回の支給の合計にはプラスの人だけ（マイナスの人は要確認）
   'payroll', coalesce(sum(greatest((x->>'payroll')::bigint, 0)), 0),
   'negative', count(*) filter (where (x->>'payroll')::bigint < 0))
  into tot from jsonb_array_elements(rs) x;
 return jsonb_build_object('period', p, 'from', public.pe_period_from(p), 'to', public.pe_period_to(p), 'pay_day', pd,
  'rows', rs, 'lines', ls, 'totals', tot,
  'fp', md5(jsonb_build_object('pay_day', pd, 'rows', rs, 'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l->'id', 'cents', l->'cents', 'state', l->'state',
    'alloc', l->'alloc', 'emp', l->'emp', 'kind', l->'kind')), '[]'::jsonb) from jsonb_array_elements(ls) l))::text));
end $$;

-- 月の要確認（支払状況要確認・支給期間要確認・額が合わない・割当のある申請が精算確定でなくなった・社員 ID が無い）
create or replace function public.pe_review(ym text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 with q as (
  select r.*, public.pe_basis(r) b from public.wr_requests r
  where public.pe_in_scope(r) and not exists (select 1 from public.pe_alloc a where a.request_id = r.id and a.off_at is null)),
 items as (
  select jsonb_build_object('type', case b->>'st' when 'month_end' then 'month_end' else 'unsure' end, 'why', coalesce(b->>'why', b->>'st'),
    'id', id, 'code', code, 'kind', kind, 'name', requester_name, 'emp', requester_emp, 'cents', amount_cents, 'use_date', use_date,
    'paid_at_text', legacy_info->>'paidAt', 'pay_method', pay_method, 'legacy', legacy, 'status', status) j
  from q where b->>'st' in ('month_end', 'unsure')
   and case when b->>'st' = 'month_end' then b->>'ym' = ym
            when b ? 'day' then to_char((b->>'day')::date, 'YYYY-MM') = ym or to_char((b->>'day')::date - 1, 'YYYY-MM') = ym
            else to_char(coalesce(use_date, public.pe_hst(submitted_at)), 'YYYY-MM') = ym end
  union all
  select jsonb_build_object('type', 'sum', 'id', r.id, 'code', r.code, 'kind', r.kind, 'name', r.requester_name, 'emp', r.requester_emp, 'cents', r.amount_cents,
    'parts', (select jsonb_agg(jsonb_build_object('period', a.period, 'cents', coalesce(a.cents, r.amount_cents)) order by a.period) from public.pe_alloc a where a.request_id = r.id and a.off_at is null))
  from public.wr_requests r
  where public.pe_in_scope(r)
   and exists (select 1 from public.pe_alloc a where a.request_id = r.id and a.off_at is null and left(a.period, 7) = ym)
   and (select sum(coalesce(a.cents, r.amount_cents)) from public.pe_alloc a where a.request_id = r.id and a.off_at is null) <> r.amount_cents
  union all
  select jsonb_build_object('type', 'out', 'id', r.id, 'code', r.code, 'kind', r.kind, 'name', r.requester_name, 'emp', r.requester_emp, 'cents', r.amount_cents,
    'status', r.status, 'period', a.period)
  from public.pe_alloc a join public.wr_requests r on r.id = a.request_id
  where a.off_at is null and left(a.period, 7) = ym and not public.pe_in_scope(r)
  union all
  select jsonb_build_object('type', 'no_emp', 'id', r.id, 'code', r.code, 'kind', r.kind, 'name', r.requester_name, 'cents', r.amount_cents, 'period', a.period)
  from public.pe_alloc a join public.wr_requests r on r.id = a.request_id
  where a.off_at is null and left(a.period, 7) = ym and public.pe_in_scope(r) and r.requester_emp is null)
 select coalesce(jsonb_agg(j order by j->>'type', j->>'name', j->>'code'), '[]'::jsonb) from items;
$$;

-- 1 つの期間の今の形：支給済みなら固定した写し（と、そのあとに入った行）、まだなら今の中身と出力の版との違い
create or replace function public.pe_period_view(p text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare pd public.pe_paid; x public.pe_exports; cur jsonb := public.pe_build(p); late jsonb;
begin
 select * into pd from public.pe_paid where period = p;
 if found then
  select * into x from public.pe_exports where id = pd.export_id;
  select coalesce(jsonb_agg(l), '[]'::jsonb) into late from jsonb_array_elements(cur->'lines') l
   where not exists (select 1 from jsonb_array_elements(x.lines) o where o->>'id' = l->>'id' and o->>'cents' = l->>'cents'
     and (o->>'state' = l->>'state' or (o->>'state' = 'pay' and l->>'state' = 'payroll')));
  return jsonb_build_object('period', p, 'state', 'paid', 'from', public.pe_period_from(p), 'to', public.pe_period_to(p), 'pay_day', pd.pay_day,
   'ver', x.ver, 'ver_at', x.at, 'ver_by', x.by_name, 'fp', x.fp, 'rows', x.rows, 'lines', x.lines, 'totals', x.totals,
   'paid', jsonb_build_object('at', pd.at, 'by', pd.by_name, 'role', pd.by_role, 'note', pd.note), 'late', late);
 end if;
 select * into x from public.pe_exports where period = p order by ver desc limit 1;
 return cur || jsonb_build_object('state', case when x.id is null then 'open' when x.fp = cur->>'fp' then 'exported' else 'changed' end,
  'ver', x.ver, 'ver_at', x.at, 'ver_by', x.by_name, 'ver_fp', x.fp, 'late', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 関数 payroll-expense から呼ぶもの（p：emp_id・name と各値）
-- 月を読む（2 つの期間・要確認・版の一覧・設定）
create or replace function public.pe_get(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); ym text := p->>'ym'; s public.pe_settings;
begin
 if ym is null or ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 perform public.pe_sync();
 select * into s from public.pe_settings where id = 1;
 return jsonb_build_object('ym', ym, 'me', jsonb_build_object('role', a->>'role', 'name', a->>'name'),
  'can', jsonb_build_object('view', true, 'export', true, 'paid', true, 'assign', true, 'settings', (a->>'role') in ('ceo', 'gm', 'office')),
  'periods', jsonb_build_array(public.pe_period_view(ym || '-1'), public.pe_period_view(ym || '-2')),
  'review', public.pe_review(ym),
  'versions', (select coalesce(jsonb_agg(jsonb_build_object('period', x.period, 'ver', x.ver, 'at', x.at, 'by', x.by_name, 'fp', x.fp, 'totals', x.totals,
     'paid', exists (select 1 from public.pe_paid pp where pp.export_id = x.id)) order by x.period, x.ver desc), '[]'::jsonb)
    from public.pe_exports x where left(x.period, 7) = ym),
  'settings', jsonb_build_object('day_first', s.day_first, 'day_second', s.day_second, 'holidays_add', to_jsonb(s.holidays_add), 'holidays_off', to_jsonb(s.holidays_off),
   'rev', s.rev, 'updated_by', s.updated_name, 'updated_at', s.updated_at,
   'holidays', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (
      select d from public.pe_fed_holidays(substr(ym, 1, 4)::int) d where not d = any(s.holidays_off)
      union select d from public.pe_fed_holidays(substr(ym, 1, 4)::int + 1) d where not d = any(s.holidays_off)
      union select unnest(s.holidays_add)) h)));
end $$;

-- 1 つの申請の割当と記録（元の申請へたどる・割当の変わり）
create or replace function public.pe_req(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); r public.wr_requests;
begin
 perform public.pe_sync();
 select * into r from public.wr_requests where id::text = p->>'id';
 if not found or r.kind not in ('mileage', 'reimburse') then raise exception 'not_found'; end if;
 return jsonb_build_object('id', r.id, 'code', r.code, 'kind', r.kind, 'status', r.status, 'name', r.requester_name, 'emp', r.requester_emp,
  'cents', r.amount_cents, 'use_date', r.use_date, 'checked_at', r.checked_at, 'paid_at', r.paid_at, 'pay_date', r.pay_date, 'pay_method', r.pay_method,
  'legacy', r.legacy, 'paid_at_text', r.legacy_info->>'paidAt', 'basis', public.pe_basis(r),
  'alloc', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'period', x.period, 'cents', x.cents, 'how', x.how, 'basis', x.basis, 'reason', x.reason,
     'by', x.by_name, 'at', x.at, 'off_at', x.off_at, 'off_by', x.off_name, 'off_reason', x.off_reason,
     'paid', exists (select 1 from public.pe_paid pp where pp.period = x.period)) order by x.id), '[]'::jsonb)
    from public.pe_alloc x where x.request_id = r.id));
end $$;

-- 割当を変える・分ける（理由は必ず）。支給済みの期間からも、支給済みの期間へも動かさない
--   ids＋period：申請（いくつでも・200 件まで）をまるごとその期間へ／id＋parts（[{period, cents}]・2〜4 つ）：分ける
create or replace function public.pe_assign(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); v_reason text := btrim(coalesce(p->>'reason', '')); ids uuid[]; r public.wr_requests; parts jsonb; x jsonb;
 v_sum bigint; n integer := 0; per text;
begin
 if length(v_reason) < 1 or length(v_reason) > 200 then raise exception 'reason_required'; end if;
 perform public.pe_sync();   -- 同じ鍵（pe_alloc）で順に
 if jsonb_typeof(p->'parts') = 'array' then
  parts := p->'parts';
  if jsonb_array_length(parts) < 2 or jsonb_array_length(parts) > 4 then raise exception 'bad_value'; end if;
  begin ids := array[(p->>'id')::uuid]; exception when others then raise exception 'bad_value'; end;
 else
  if jsonb_typeof(p->'ids') <> 'array' or jsonb_array_length(p->'ids') < 1 or jsonb_array_length(p->'ids') > 200 then raise exception 'bad_value'; end if;
  begin select array_agg(distinct v::uuid) into ids from jsonb_array_elements_text(p->'ids') v; exception when others then raise exception 'bad_value'; end;
  per := p->>'period';
  if not public.pe_period_ok(per) then raise exception 'bad_value'; end if;
  parts := jsonb_build_array(jsonb_build_object('period', per, 'cents', null));
 end if;
 for x in select * from jsonb_array_elements(parts) loop
  if not public.pe_period_ok(x->>'period') then raise exception 'bad_value'; end if;
  if exists (select 1 from public.pe_paid pp where pp.period = x->>'period') then raise exception 'paid_period'; end if;
 end loop;
 if (select count(distinct v->>'period') from jsonb_array_elements(parts) v) <> jsonb_array_length(parts) then raise exception 'bad_value'; end if;
 for r in select q.* from public.wr_requests q where q.id = any(ids) order by q.code loop
  if not public.pe_in_scope(r) then raise exception 'not_found'; end if;
  if exists (select 1 from public.pe_paid_req z where z.request_id = r.id) then raise exception 'paid_period'; end if;
  if exists (select 1 from public.pe_alloc z join public.pe_paid pp on pp.period = z.period where z.request_id = r.id and z.off_at is null) then raise exception 'paid_period'; end if;
  if jsonb_array_length(parts) > 1 then
   v_sum := 0;
   for x in select * from jsonb_array_elements(parts) loop
    if jsonb_typeof(x->'cents') <> 'number' or (x->>'cents')::numeric <> trunc((x->>'cents')::numeric) or (x->>'cents')::bigint <= 0 then raise exception 'bad_value'; end if;
    v_sum := v_sum + (x->>'cents')::bigint;
   end loop;
   if v_sum <> r.amount_cents then raise exception 'sum_mismatch'; end if;
  end if;
  update public.pe_alloc set off_at = now(), off_emp = a->>'emp', off_name = a->>'name', off_reason = v_reason where request_id = r.id and off_at is null;
  for x in select * from jsonb_array_elements(parts) loop
   insert into public.pe_alloc (request_id, period, cents, how, basis, reason, by_emp, by_name)
   values (r.id, x->>'period', case when jsonb_array_length(parts) > 1 then (x->>'cents')::bigint end, 'manual', 'manual', v_reason, a->>'emp', a->>'name');
  end loop;
  n := n + 1;
 end loop;
 if n <> coalesce(array_length(ids, 1), 0) then raise exception 'not_found'; end if;
 return jsonb_build_object('ok', true, 'n', n);
end $$;

-- 出力：今の中身で版を作る（前の版と同じ中身なら作らずにその版）。支給済みの期間は出し直さない（その版の写しを pe_ver で）
create or replace function public.pe_export(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); per text := p->>'period'; cur jsonb; x public.pe_exports; rv jsonb;
begin
 if not public.pe_period_ok(per) then raise exception 'bad_value'; end if;
 perform public.pe_sync();
 if exists (select 1 from public.pe_paid pp where pp.period = per) then raise exception 'paid_period'; end if;
 cur := public.pe_build(per);
 select * into x from public.pe_exports where period = per order by ver desc limit 1;
 if x.id is not null and x.fp = cur->>'fp' then
  return jsonb_build_object('period', per, 'ver', x.ver, 'at', x.at, 'by', x.by_name, 'fp', x.fp, 'pay_day', x.pay_day, 'rows', x.rows, 'lines', x.lines,
   'totals', x.totals, 'review', x.review, 'same', true);
 end if;
 select coalesce(jsonb_agg(i), '[]'::jsonb) into rv from jsonb_array_elements(public.pe_review(left(per, 7))) i;
 insert into public.pe_exports (period, ver, fp, pay_day, rows, lines, totals, review, by_emp, by_name, by_role)
 values (per, coalesce(x.ver, 0) + 1, cur->>'fp', (cur->>'pay_day')::date, cur->'rows', cur->'lines', cur->'totals', rv, a->>'emp', a->>'name', a->>'role')
 returning * into x;
 return jsonb_build_object('period', per, 'ver', x.ver, 'at', x.at, 'by', x.by_name, 'fp', x.fp, 'pay_day', x.pay_day, 'rows', x.rows, 'lines', x.lines,
  'totals', x.totals, 'review', x.review, 'same', false);
end $$;

-- 版の写しを読む（出し直し・前の版）
create or replace function public.pe_ver(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); x public.pe_exports;
begin
 if not public.pe_period_ok(p->>'period') or jsonb_typeof(p->'ver') <> 'number' then raise exception 'bad_value'; end if;
 select * into x from public.pe_exports where period = p->>'period' and ver = (p->>'ver')::int;
 if not found then raise exception 'not_found'; end if;
 return jsonb_build_object('period', x.period, 'ver', x.ver, 'at', x.at, 'by', x.by_name, 'fp', x.fp, 'pay_day', x.pay_day, 'rows', x.rows, 'lines', x.lines,
  'totals', x.totals, 'review', x.review, 'paid', exists (select 1 from public.pe_paid pp where pp.export_id = x.id));
end $$;

-- 支給済みにする（期間ごとに 1 回）：いちばん新しい版で、その版のあとに中身が変わっていないときだけ。
-- その版の「今回 Payroll」の申請を記録し、どの割当も支給済みの期間になった申請は精算済み（Payroll・支給日）にする
create or replace function public.pe_mark_paid(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); per text := p->>'period'; x public.pe_exports; cur jsonb; v_line jsonb; r public.wr_requests; n integer := 0; m integer := 0;
begin
 if not public.pe_period_ok(per) or jsonb_typeof(p->'ver') <> 'number' then raise exception 'bad_value'; end if;
 perform public.pe_sync();
 if exists (select 1 from public.pe_paid pp where pp.period = per) then raise exception 'paid_period'; end if;
 select * into x from public.pe_exports where period = per order by ver desc limit 1;
 if x.id is null then raise exception 'not_exported'; end if;
 if x.ver <> (p->>'ver')::int or x.fp is distinct from p->>'fp' then raise exception 'conflict'; end if;
 cur := public.pe_build(per);
 if cur->>'fp' <> x.fp then raise exception 'changed'; end if;
 for v_line in select * from jsonb_array_elements(x.lines) loop
  if v_line->>'state' = 'pay' then
   select * into r from public.wr_requests where id = (v_line->>'id')::uuid for update;
   if r.status <> 'checked' then raise exception 'changed'; end if;
   if r.legacy and public.wr_legacy_paid(r) then raise exception 'legacy_paid'; end if;
  end if;
 end loop;
 insert into public.pe_paid (period, export_id, pay_day, note, by_emp, by_name, by_role)
 values (per, x.id, x.pay_day, nullif(left(btrim(coalesce(p->>'note', '')), 200), ''), a->>'emp', a->>'name', a->>'role');
 insert into public.pe_paid_req (request_id, period, cents)
 select (l->>'id')::uuid, per, sum((l->>'cents')::bigint) from jsonb_array_elements(x.lines) l where l->>'state' = 'pay' group by l->>'id';
 get diagnostics n = row_count;
 -- どの割当も支給済みの期間になった申請だけ精算済みに（分けて次の期間に残りがあれば、精算確定のまま）
 for r in
  select q.* from public.wr_requests q
  where q.id in (select request_id from public.pe_paid_req where period = per) and q.status = 'checked'
    and not exists (select 1 from public.pe_alloc z where z.request_id = q.id and z.off_at is null and not exists (select 1 from public.pe_paid pp where pp.period = z.period))
 loop
  update public.wr_requests set status = 'paid', paid_by = a->>'name', paid_emp = a->>'emp', paid_at = now(), pay_date = x.pay_day, pay_method = 'Payroll',
   rev = rev + 1, updated_at = now() where id = r.id;
  insert into public.wr_events (request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note)
  values (r.id, now(), 'pay', 'checked', 'paid', r.version, r.rev + 1, a->>'emp', a->>'name', a->>'role',
   'Payroll の期間 ' || per || '（支給日 ' || x.pay_day || '・版 ' || x.ver || '）を支給済みにした');
  m := m + 1;
 end loop;
 return jsonb_build_object('ok', true, 'period', per, 'ver', x.ver, 'pay_day', x.pay_day, 'requests', n, 'paid_requests', m);
end $$;

-- 支給日の決まり・休日（CEO・GM・経理）。支給済みの期間の支給日は変わらない（写しに残っている）
create or replace function public.pe_cfg_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.pe_actor(p); s public.pe_settings; v_add date[]; v_off date[];
begin
 if (a->>'role') not in ('ceo', 'gm', 'office') then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'day_first') <> 'number' or jsonb_typeof(p->'day_second') <> 'number' or jsonb_typeof(p->'expect_rev') <> 'number'
    or (p->>'day_first')::numeric not between 1 and 28 or (p->>'day_second')::numeric not between 1 and 28
    or (p->>'day_first')::numeric <> trunc((p->>'day_first')::numeric) or (p->>'day_second')::numeric <> trunc((p->>'day_second')::numeric) then raise exception 'bad_value'; end if;
 if jsonb_typeof(coalesce(p->'add', '[]')) <> 'array' or jsonb_typeof(coalesce(p->'off', '[]')) <> 'array'
    or jsonb_array_length(coalesce(p->'add', '[]')) > 100 or jsonb_array_length(coalesce(p->'off', '[]')) > 100 then raise exception 'bad_value'; end if;
 begin
  select coalesce(array_agg(distinct v::date order by v::date), '{}') into v_add from jsonb_array_elements_text(coalesce(p->'add', '[]')) v;
  select coalesce(array_agg(distinct v::date order by v::date), '{}') into v_off from jsonb_array_elements_text(coalesce(p->'off', '[]')) v;
 exception when others then raise exception 'bad_value';
 end;
 perform pg_advisory_xact_lock(hashtext('pe_alloc'));
 select * into s from public.pe_settings where id = 1 for update;
 if s.rev <> (p->>'expect_rev')::int then raise exception 'conflict'; end if;
 update public.pe_settings set day_first = (p->>'day_first')::int, day_second = (p->>'day_second')::int, holidays_add = v_add, holidays_off = v_off,
  rev = rev + 1, updated_emp = a->>'emp', updated_name = a->>'name', updated_at = now() where id = 1 returning * into s;
 return jsonb_build_object('ok', true, 'rev', s.rev);
end $$;

-- 関数の版の確かめ（入っているか）
create or replace function public.pe_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('pe', 1);
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'pe\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
