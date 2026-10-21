-- v1098 の関数を外す（アプリは今までどおり app_state を全部取る形に戻る。データは何も変わらない）。2 回流しても同じ。
drop function if exists public.app_state_index(text[]);
notify pgrst, 'reload schema';
