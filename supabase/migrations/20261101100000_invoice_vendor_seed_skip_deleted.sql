-- 業者マスター v1121（10/30 の依頼 ③）の続き：Invoice取込の「業者の候補を作る」（invoice_vendor_seed・GM・CEO）が、業者マスターで削除した業者
-- （vendors.data の vst = 'deleted'）を候補にしない。前は削除した業者も Invoice取込の業者に入り、そのあと「業者を決める」で同じ id のカードが
-- 空のまま戻ることがあった（v1121 の独立レビュー R4）。無効（inactive）の業者は今までどおり候補に入る（請求書は来ることがある）。
-- 変えるのはこの関数 1 つだけ（中身はほかは同じ・権限はそのまま）。2 回流しても同じ。
do $$ begin
 if to_regprocedure('public.invoice_vendor_seed(jsonb)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_vendor_rules' and column_name='merged_into') then
  raise exception '先に 20261022090000_invoice_vendor_merge.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

create or replace function public.invoice_vendor_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 -- A card whose name a vendor already has (its own name or one of its names, also a vendor merged into another one) is not
 -- added again (業者の統合, Moto 2026-10-15): the name would belong to two vendors and match neither.
 -- A card deleted in the vendor master (data.vst = 'deleted', v1121) is not offered either: it would come back through the intake.
 select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.id::text, 'display_name', v.name,
   'food_kind', case when v.data->>'kind' in ('food','nonfood') then v.data->>'kind' end,
   'exists', exists(select 1 from public.invoice_vendor_rules r where r.vendor_key=v.id::text
     or exists(select 1 from unnest(array[r.display_name] || r.aliases) a(n)
       where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = nullif(btrim(regexp_replace(lower(normalize(v.name, NFKC)), '\s+', ' ', 'g')), '')))) order by v.name), '[]')
 into rows from public.vendors v where coalesce(v.name,'') <> '' and coalesce(v.data->>'vst','') <> 'deleted' and v.id::text ~ '^[A-Za-z0-9_.:@-]{1,80}$';
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_vendor_rules(vendor_key, display_name, food_kind, auto_post)
  select x->>'vendor_key', x->>'display_name', x->>'food_kind', false from jsonb_array_elements(rows) x
  where not coalesce((x->>'exists')::boolean, false)
  on conflict(vendor_key) do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'vendor_seed', jsonb_build_object('added', n));
 end if;
 return jsonb_build_object('vendors', rows, 'added', n);
end $$;
