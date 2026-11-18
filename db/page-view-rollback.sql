-- 戻す（v1193・UI案95「画面の表示」）：先に関数 secure-state を v1192 の 1 ファイル（deploy/labor-totals-v1192/4_関数_secure-state_index.ts）に戻してから流す。
-- 関数 pv_save を外す。表 pv_doc・pv_log と行は残す（記録を消さない。公開の鍵では読めないまま）。2 回流しても同じ。
-- v1192 の関数は pv_get を知らないので、1193 の端末は今までの決まりで画面を出す（何も壊れない）。
drop function if exists public.pv_save(jsonb, integer, text, jsonb, text, text, text);
