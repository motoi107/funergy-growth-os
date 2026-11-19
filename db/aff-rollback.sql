-- 戻す（v1195・UI案96 の段階 2 の ①「所属の確認」）：先に関数 secure-state を v1194 までの 1 ファイル（deploy/page-view-v1193/ の関数）に戻してから流す。
-- 関数 aff_save を外す。表 aff_people・aff_log と行は残す（記録を消さない。公開の鍵では読めないまま）。2 回流しても同じ。
-- 従業員マスターの所属（「所属の確認」で OFFICE にした人）は戻しません。戻すときは従業員マスターでその人の所属を直す（変更の記録 employee_field_log に前の値が残っています）。
drop function if exists public.aff_save(jsonb, text, text, text, text);
