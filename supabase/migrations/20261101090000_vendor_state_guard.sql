-- v1121（10/30 の依頼 ③）：業者マスター（public.vendors）の状態と区分を、古い写しの書き込みで戻さない見張り。
-- アプリの業者のカードは data（jsonb）に、状態 vst（'' / inactive / deleted）・vstAt（ISO の時刻）・vstBy・vstWhy・vstLog と、
-- 区分 vcat（purchase / construction / none）・vcatAt・vcatBy を持つ。
-- v1120 以前のアプリは業者の全部を丸ごと送る（merge-duplicates の upsert）。古い写しを持つ端末が送ると、
-- 削除した印・無効・区分が消えて戻る。この見張りは、書き込みの時刻（vstAt・vcatAt）が今の値より古い（無い）とき、
-- その組の欄を今の値のまま残す。ほかの欄（名前・連絡先など）は今までどおり書かれる。行を消す・作る動きは変えない。
-- 何度流しても同じ。止めるのは deploy/vendor-master-v1121/止める.sql（見張りを外すだけ・データは変えない）。
do $guard$
begin
  if to_regclass('public.vendors') is null then raise exception 'public.vendors がありません（業者マスターの表）'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendors' and column_name = 'data' and data_type = 'jsonb') then
    raise exception 'public.vendors.data（jsonb）がありません';
  end if;
end
$guard$;

create or replace function public.vendors_keep_state() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  o jsonb := coalesce(old.data, '{}'::jsonb);
  n jsonb := coalesce(new.data, '{}'::jsonb);
  grp text[];
  stamp text;
  k text;
begin
  foreach grp slice 1 in array array[array['vstAt', 'vst', 'vstBy', 'vstWhy', 'vstLog'], array['vcatAt', 'vcat', 'vcatBy', '', '']] loop
    stamp := grp[1];
    if (coalesce(n ->> stamp, '') collate "C") < (coalesce(o ->> stamp, '') collate "C") then   -- ISO の時刻は文字の順で比べる（並び方の決まりに左右されない）
      foreach k in array grp loop
        continue when k = '';
        if o ? k then n := jsonb_set(n, array[k], o -> k, true); else n := n - k; end if;
      end loop;
    end if;
  end loop;
  new.data := n;
  return new;
end
$fn$;

revoke all on function public.vendors_keep_state() from public, anon, authenticated;

drop trigger if exists vendors_keep_state on public.vendors;
create trigger vendors_keep_state before update on public.vendors
  for each row execute function public.vendors_keep_state();
