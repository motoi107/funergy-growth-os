-- v1189 送り手のメール（招待とコードを送るメール）を決める。Supabase の SQL Editor に貼って Run。
-- 3 の答え：GM の会社のメール（Gmail API）。アドレスはリポジトリに書かない（このファイルは書き換えずにコピーして、コピーのほうを直す）。
-- 下の 'ここに送り手のメールアドレス' を、送り手のメール（例：name@yourcompany.com の形）に書き換えてから流す。
-- 決めたあと、GM が PIN の一覧 →「ログインの方式」→「Google でつなぐ」で、そのメールの Google アカウントで入って許可する
-- （ほかの Google アカウントで入ると保存しない）。送り手を変えるときも、このファイルで変えて、つなぎ直す（前のつなぎは外れる）。
do $$
declare v text := lower(btrim('ここに送り手のメールアドレス'));
begin
 if to_regclass('public.dl_mail') is null then raise exception 'STOP: 先に 2_SQL.sql を流してください。何も変えていません。'; end if;
 if v !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'STOP: 送り手のメールアドレスに書き換えてから流してください。何も変えていません。'; end if;
 update public.dl_mail set
   from_addr = v,
   refresh_token = case when from_addr is distinct from v then null else refresh_token end,
   account = case when from_addr is distinct from v then null else account end,
   state = case when from_addr is distinct from v then 'none' else state end,
   updated_at = now()
  where id = 1;
end $$;
select from_addr is not null as sender_set, state from public.dl_mail where id = 1;
