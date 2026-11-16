-- v1174 の直しを戻す：pl_public の見張りと関数 5 つを外す。データ（app_settings の行）は変えない。2 回流しても同じ。
drop trigger if exists fp_pl_public_keep_final on public.app_settings;
drop function if exists public.fp_pl_public_keep_final();
drop function if exists public.fp_pl_public_join(jsonb, jsonb);
drop function if exists public.fp_pl_at(jsonb);
drop function if exists public.fp_pl_rank(jsonb);
drop function if exists public.fp_pl_pos(jsonb);
