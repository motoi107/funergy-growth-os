-- QuickBooks からすぐ（v1094・UI案56）：送り元の Gmail を決める（ひな形）。
-- 下の v_from の name@example.com を送り元のメール（QuickBooks に転送元として登録してあるメール）に変えて、Supabase の SQL Editor で 1 回 Run。
-- 本物のメールはこの公開のリポジトリに書かない（Claude が入れたものを Moto さんに直接渡す）。
--
-- ・先に 20261026090000_invoice_qb_gmail.sql を流しておく（無ければ止まる・何も変えない）。
-- ・画面からは変えられない（qb.from）。Invoice取込 → 設定 →「Gmail をつなぐ」は、ここで決めたメールでログインしたときだけつながる。
-- ・このシステムから送っているあいだ（送る担当が「このシステム」）は変えられない（止まる）。先に送る担当を戻す。
-- ・2 回流しても同じ。変えたことは Invoice取込の記録（settings_qb_from）に残る。
do $$
declare v_from text := lower(trim('name@example.com'));
begin
 if to_regprocedure('public.invoice_gmail_public(jsonb)') is null then
  raise exception '先に 20261026090000_invoice_qb_gmail.sql（QuickBooks からすぐ）を流してください。何も変えていません。';
 end if;
 if v_from !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_from like '%@example.com' then
  raise exception '送り元のメールを入れてください（name@example.com のままです）。何も変えていません。';
 end if;
 if coalesce(public.invoice_setting('qb')->>'route', '') = 'invoice-intake' and lower(coalesce(public.invoice_setting('qb')->>'from', '')) <> v_from then
  raise exception 'このシステムから送っているあいだは送り元を変えられません。先に Invoice取込 → 設定 で送る担当を戻してください。何も変えていません。';
 end if;
 update public.invoice_settings set value = value || jsonb_build_object('from', v_from), updated_at = now(), updated_by = 'sql'
  where key = 'qb' and coalesce(value->>'from', '') is distinct from v_from;
 if found then perform public.invoice_event(null, null, 'sql', 'settings_qb_from', jsonb_build_object('from', v_from)); end if;
end $$;

-- 結果：送り元・送る担当・Gmail の接続（つながっているアカウントが送り元と同じなら from_ok＝true）
select public.invoice_setting('qb')->>'from' as "送り元",
       coalesce(public.invoice_setting('qb')->>'route', '（まだ）') as "送る担当",
       public.invoice_gmail_public('{}'::jsonb)->>'status' as "Gmail",
       public.invoice_gmail_public('{}'::jsonb)->>'from_ok' as from_ok;
