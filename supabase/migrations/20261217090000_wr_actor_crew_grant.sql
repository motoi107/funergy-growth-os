-- B-1（v1211）：事務Crew が、経理リーダー・経理マネージャー・GM と同じ経理レビューの申請・精算を見られるようにする（Moto さん 11/23 の依頼）。
--
-- 原因（合成データで再現・tests/acct-view-v1211.test.mjs）：
--   申請のサーバー（work-requests）は、だれかを wr_actor で決める。事務Crew（office_crew）になるのは manager_auth に
--   事務Crew のメールのアカウントがある人だけで、PIN でログインする事務Crew は、GM・CEO が「事務Crew と確かめる」
--   （wr_exp_grants.crew・経費の申請の権限の画面・v1184）を押していても staff・G1 になっていた。
--   → 共通ルールを使う前は経理レビュー › 申請が 0 件、使い始めたあとは閲覧者として見えても「確認した」「差し戻す」が出なかった。
--   承認・閲覧の共通ルール（ar_role_rows・v1190）と経費の権限（wr_exp_base・v1184）は、前から同じ確かめで事務Crew として数えている。
--
-- 直し（新しい権限は作らない。GM の役割にもしない）：
--   wr_actor は、manager_auth のアカウントが無く、GM・CEO が確かめた AM・G3 以上の写し（wr_people）も無い人のうち、
--   今も従業員マスターで事務Crew（役割 office_crew か肩書き Office Crew／Office Staff）で、GM・CEO が「事務Crew と確かめた」人を、
--   事務Crew のアカウントと同じ office_crew として返す（src = 'crew_grant'）。
--   → 申請の一覧・1 件・経理の確認（確認した・差し戻す・支払・精算）・処理済み（今月）・まとめて確認が、事務Crew のアカウントと同じになる。
--   確かめを外す（GM・CEO が「確かめを外す」）・従業員マスターで事務Crew でなくなる・退職、のどれかで次の呼び出しから元に戻る。
--   wr_exp_base は src = 'crew_grant' のとき確かめを読み直す（確かめを外した直後の変更の記録が正しくなるように）。
--
-- 変えないもの：manager_auth のアカウントの人・AM・G3 以上の写しのある人の決め方、給与・賞与・成長カルテ・セキュアページ
--   （secure-state は manager_auth だけを見る）、Invoice取込（メールのアカウントで入る）、経理出力の給与の CSV、GM・CEO だけの操作。
--   肩書きだけ（従業員マスターは公開の鍵でも書ける）では事務Crew にならない（v1184 と同じ）。
-- 2 回流しても同じ。前提：20261204090000_wr_exp_grants.sql（wr_exp_grants・wr_exp_crew）と 20261107090000_work_requests_ui68.sql。

do $$
begin
 if to_regclass('public.wr_exp_grants') is null or to_regprocedure('public.wr_exp_crew(text,text)') is null
    or to_regprocedure('public.wr_person_conf(text)') is null or to_regprocedure('public.wr_person_live(text)') is null then
  raise exception 'STOP: 先に 20261204090000_wr_exp_grants.sql（経費の申請の権限・v1184）と 20261107090000_work_requests_ui68.sql を流してください。何も変えていません。';
 end if;
end $$;

-- 呼んだ人（20261107090000 の中身に、GM・CEO が確かめた事務Crew を足した）
create or replace function public.wr_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); e public.employees; v_mgr text;
 live jsonb; conf jsonb; v_role text; v_grade integer; v_stores text[]; v_am text[]; v_nm text;
begin
 if v_emp is null or length(v_emp) > 64 then raise exception 'forbidden'; end if;
 select * into e from public.employees x where x.id::text = v_emp;
 if not found or public.wr_emp_out(e) then raise exception 'forbidden'; end if;
 v_nm := coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), btrim(coalesce(e.name, '')));
 select a.role into v_mgr from public.manager_auth a where a.emp_id::text = v_emp and a.role in ('ceo','gm','office','office_crew')
  order by case a.role when 'gm' then 1 when 'ceo' then 2 when 'office' then 3 else 4 end limit 1;
 if v_mgr is not null then
  return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_mgr, 'grade', public.wr_grade(e.title, v_mgr),
   'stores', '[]'::jsonb, 'am_stores', '[]'::jsonb, 'confirmed', true, 'pending', false);
 end if;
 live := public.wr_person_live(v_emp);
 conf := public.wr_person_conf(v_emp);
 -- v1211：GM・CEO が「事務Crew と確かめた」人（wr_exp_grants.crew）で、今も従業員マスターで事務Crew の人は、事務Crew のアカウントと同じ
 --   （GM・CEO が AM・G3 以上と確かめた写しのある人は今までどおり。G2 以下の古い写しは確かめを使う）
 if (conf is null or ((conf->>'role') is distinct from 'am' and coalesce((conf->>'grade')::int, 0) < 3))
    and public.wr_exp_crew(e.role, e.title)
    and exists (select 1 from public.wr_exp_grants g where g.emp_id = v_emp and g.crew is true) then
  return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', 'office_crew', 'grade', public.wr_grade(e.title, 'office_crew'),
   'stores', '[]'::jsonb, 'am_stores', '[]'::jsonb, 'confirmed', true, 'pending', false, 'src', 'crew_grant');
 end if;
 if conf is not null then
  v_role := case when (conf->>'role') = 'am' and (live->>'role') = 'am' then 'am' else 'staff' end;
  v_grade := least((conf->>'grade')::int, (live->>'grade')::int);
  v_am := case when v_role = 'am' then public.wr_meet(public.wr_arr(conf->'am_stores'), public.wr_arr(live->'am_stores')) else '{}'::text[] end;
  v_stores := case when v_role = 'am' or v_grade >= 3 then public.wr_meet(public.wr_arr(conf->'stores'), public.wr_arr(live->'stores')) else public.wr_arr(live->'stores') end;   -- v1135：G3 も写しの店だけ
  v_nm := conf->>'name';
 else
  v_role := 'staff'; v_grade := least((live->>'grade')::int, 3); v_stores := public.wr_arr(live->'stores'); v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_role, 'grade', v_grade, 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am),
  'confirmed', conf is not null, 'pending', public.wr_up(conf, live));
end $$;

-- この人の区分（20261204090000 の中身。確かめから来た事務Crew は、確かめを読み直す＝外した直後も正しい）
create or replace function public.wr_exp_base(a jsonb) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; v_ok boolean;
begin
 if a is null or jsonb_typeof(a) <> 'object' then return 'g1'; end if;
 if (a->>'role') in ('ceo','gm','am') or coalesce((a->>'grade')::int, 0) >= 2 then return 'full'; end if;
 if (a->>'role') = 'office_crew' and coalesce(a->>'src', '') <> 'crew_grant' then return 'office_crew'; end if;
 if (a->>'role') = 'office' then return 'office'; end if;
 select * into e from public.employees x where x.id::text = a->>'emp';
 if found and public.wr_exp_crew(e.role, e.title) then
  select g.crew into v_ok from public.wr_exp_grants g where g.emp_id = a->>'emp';
  return case when coalesce(v_ok, false) then 'office_crew' else 'crew_wait' end;
 end if;
 return 'g1';
end $$;

revoke all on function public.wr_actor(jsonb), public.wr_exp_base(jsonb) from public, anon, authenticated;
grant execute on function public.wr_actor(jsonb), public.wr_exp_base(jsonb) to service_role;
