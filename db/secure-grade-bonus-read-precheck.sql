-- 読むだけ（v1148・2b-10）。関数 secure-state を v1148 にする前と、20261117090000_secure_grade_bonus_read.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 人の名前・グレード・賞与の設定の中身は出しません（数だけ）。表をそのまま Claude に貼ってください。
with gb as (
  select s.key::text k, s.value::jsonb v from public.app_state s where s.key::text in ('grade_hist', 'bonus_eval_ovr', 'bonus_track')
), gb_rec as (   -- 記録（オブジェクトの行だけ。JSON の文字で書かれた行は関数が読み直す）
  select g.k, e.key ek from gb g, jsonb_each(case when jsonb_typeof(g.v) = 'object' then g.v else '{}'::jsonb end) e
), gb_id as (    -- 記録の社員 ID（関数 secure-state の gbEntryId と同じ。グレード履歴＝キーそのまま／賞与の個人設定＝最後の | の前／G3 の職種＝最初の | の後）
  select k, ek, case
           when k = 'grade_hist' then nullif(ek, '')
           when k = 'bonus_eval_ovr' and strpos(reverse(ek), '|') > 0 and length(ek) - strpos(reverse(ek), '|') > 0 then left(ek, length(ek) - strpos(reverse(ek), '|'))
           when k = 'bonus_track' and strpos(ek, '|') > 0 and strpos(ek, '|') < length(ek) then substr(ek, strpos(ek, '|') + 1)
         end id
    from gb_rec
), live as (     -- 在籍の社員（退職・OS を止めた人を除く）
  select e.id::text id from public.employees e
   where coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
)
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139〜v1147 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1148 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, 'app_state の RLS（ON なら v1139 以降の SQL が入っている）', case when c.relrowsecurity then 'ON' else 'OFF' end, 'info'
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
-- 3 つの行の形と記録の数（関数は記録ごとに社員 ID を読み、見られる人の分だけ返す。形の合わない記録は CEO・GM（グレード履歴は経理・事務Crew も）にだけ見える）
select k3.o, k3.what,
       coalesce((select case jsonb_typeof(g.v) when 'object' then 'オブジェクト' when 'string' then 'JSON の文字' else jsonb_typeof(g.v) end from gb g where g.k = k3.k), '行なし')
       || '・記録 ' || (select count(*) from gb_rec r where r.k = k3.k)::text
       || '・社員 ID の読めない記録 ' || (select count(*) from gb_id i where i.k = k3.k and i.id is null)::text
       || '・社員の表に無い ID ' || (select count(*) from gb_id i where i.k = k3.k and i.id is not null and not exists (select 1 from public.employees e where e.id::text = i.id))::text
       || '・退職した人 ' || (select count(*) from gb_id i where i.k = k3.k and i.id is not null and exists (select 1 from public.employees e where e.id::text = i.id) and i.id not in (select id from live))::text,
       case when (select count(*) from gb g where g.k = k3.k and jsonb_typeof(g.v) not in ('object', 'string')) > 0 then 'NG（Claude に貼ってください。関数はこの行を読めません）'
            when (select count(*) from gb g where g.k = k3.k and jsonb_typeof(g.v) = 'string') > 0 then 'info（JSON の文字の行。関数は読み直して使います。記録の数は数えていません）'
            when (select count(*) from gb_id i where i.k = k3.k and i.id is null) > 0 then 'info（形の合わない記録は CEO・GM にだけ見えます。Claude に貼ってください）'
            else 'OK' end
  from (values (4, 'grade_hist', 'グレード履歴（grade_hist）'), (5, 'bonus_eval_ovr', '賞与の個人設定（bonus_eval_ovr）'), (6, 'bonus_track', 'G3 の職種（bonus_track）')) as k3(o, k, what)
union all
-- v1143・v1145 の SQL：この 3 つを書けるのは GM・CEO だけ（関数）。v1148 の SQL は読み書きとも止める（決まり ss_secret は書き込みも止める）ので、
-- 書く決まりがまだでもこの SQL だけで公開の鍵からは書けなくなる。ただ v1148 の SQL だけを戻すと、書く決まりが無ければまた書けるようになる。
-- （関数の中身の文字で確かめる。関数が無くても、この SQL は止まらない）
select 7, '書く決まり（v1143・v1145 の SQL：ss_guard_key に 3 つ）',
       case when to_regprocedure('public.ss_guard_key(text)') is null then 'ない'
            else (select count(*) from unnest(array['grade_hist', 'bonus_eval_ovr', 'bonus_track']) k
                   where pg_get_functiondef(to_regprocedure('public.ss_guard_key(text)')) like '%''' || k || '''%')::text || ' / 3' end,
       case when (select count(*) from unnest(array['grade_hist', 'bonus_eval_ovr', 'bonus_track']) k
                   where pg_get_functiondef(to_regprocedure('public.ss_guard_key(text)')) like '%''' || k || '''%') = 3 then 'OK（入っている）'
            else 'info（v1143・v1145 の SQL がまだ。v1148 の SQL だけでも公開の鍵からは読み書きできなくなります）' end
union all
-- 社員の表で事務Crew なのに、事務Crew のメールのアカウント（manager_auth）に結ばれていない人：
-- 関数 v1148 では、その人のグレード履歴は Career Score で見られる人と本人の分だけ（福利厚生の画面で全員のグレードが分からない）
select 8, '事務Crew のアカウント（manager_auth）に結ばれていない事務Crew（グレード履歴が全員分でなくなる）',
       (select count(*) from public.employees e
         where coalesce(e.role, e.data->>'role', '') = 'office_crew'
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew')))::text,
       'info（manager_auth の emp_id を結ぶと全員分）'
union all
-- CEO・GM・経理・事務Crew のメールのアカウントで、社員 ID が社員の表に無い人：関数はその人に何も見せない（v1142 からの決まり）
select 9, 'CEO・GM・経理・事務Crew のアカウントで、社員 ID が社員の表に無い（何も見えなくなる）', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（manager_auth の emp_id を今の社員 ID に直すか、空にする。db/invoice-signin-emp-check.sql で確かめる）' end
  from public.manager_auth m
 where m.role in ('ceo', 'gm', 'office', 'office_crew') and coalesce(m.emp_id::text, '') <> ''
   and not exists (select 1 from public.employees e where e.id::text = m.emp_id::text)
union all
-- 社員の表で AM・G2 以上・Head Chef・店長・リーダーなのに、GM・CEO の確かめがまだの人：Career Score と同じく自分の分だけ（v1147 の ① の 7 行目と同じ）
select 10, '確かめがまだの AM・G2 以上・Head Chef・店長・リーダー（グレード履歴・賞与の個人設定・G3 の職種も自分の分だけ）',
       (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef', 'sl', 'g2')
                or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef', 'Store Manager', 'Area Manager', 'Office Manager', 'Accountant', 'Customer Service Manager',
                  'Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader', 'Crew Leader', 'Office Crew Leader'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 2)))::text,
       'info（GM・CEO が「承認・閲覧の権限の確かめ」で確かめると、Career Score と同じ範囲）'
order by n;
