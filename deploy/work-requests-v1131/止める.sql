-- v1131 ワークセンターの申請を止める（アプリは前の画面に戻る・申請の記録は残る・2 回流しても同じ）。
-- 端末は次に「申請」を開いたとき・次のログインで前の画面に戻る。
update public.wr_settings set live = false, rev = rev + 1, updated_at = now() where id = 1 and live;
select live, rev, updated_at from public.wr_settings;
