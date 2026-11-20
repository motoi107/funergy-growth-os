# v1202：紛失届（lost）をサーバーの申請に足す SQL を、前の版の SQL の関数（いま入っている形）から作る。
# 手で書かない：各関数の最後の定義を取り出し、lost を足す所だけを置き換える（置き換える場所が 1 つでなければ止まる）。
# 使い方：python3 scripts/gen-wr-lost.py（作る）／python3 scripts/gen-wr-lost.py --check（今のファイルと同じか確かめる・試験が使う）
import re,glob,os,json,sys
import pathlib
R=str(pathlib.Path(__file__).resolve().parent.parent)+'/'
def fn_bodies(path):
    s=open(path,encoding='utf-8').read(); out={}
    ms=list(re.finditer(r'create or replace function\s+public\.(\w+)\s*\(', s, re.I))
    for i,m in enumerate(ms):
        end=ms[i+1].start() if i+1<len(ms) else len(s)
        body=s[m.start():end]
        # the function body is between its first $$ and the next $$ (then ';')
        o=body.index('$$'); c=body.index('$$', o+2); e=body.index(';', c)
        assert body[c+2:e].strip()=='', (m.group(1), body[c:e+1])
        out.setdefault(m.group(1),[]).append(body[:e+1])
    return out
def last(path,name):
    return fn_bodies(R+'supabase/migrations/'+path)[name][-1]
BASE='20261104090000_work_requests.sql'; S2='20261120090000_work_requests_stage2.sql'; AR='20261209090000_approval_rules.sql'; EG='20261204090000_wr_exp_grants.sql'
def sub(body,a,b,cnt=1):
    n=body.count(a)
    if n!=cnt: raise SystemExit(f'count {n} != {cnt}: {a[:80]}')
    return body.replace(a,b)
K3="('mileage','reimburse','expense_pre')"; K4="('mileage','reimburse','expense_pre','lost')"
new={}; old={}
# expense path (renamed in 20261105)
b=last(BASE,'wr_submit'); old['wr_submit_exp']=b.replace('function public.wr_submit(','function public.wr_submit_exp(',1)
new['wr_submit_exp']=sub(old['wr_submit_exp'],"if v_kind not in "+K3+" then raise exception 'bad_value'; end if;","if v_kind not in "+K4+" then raise exception 'bad_value'; end if;   -- v1202：紛失届（lost）")
b=last(BASE,'wr_act'); old['wr_act_exp']=b.replace('function public.wr_act(','function public.wr_act_exp(',1)
new['wr_act_exp']=sub(old['wr_act_exp'],"v_to := case when r.kind = 'expense_pre' then 'done' else 'checked' end;","v_to := case when r.kind in ('expense_pre','lost') then 'done' else 'checked' end;   -- v1202：紛失届は経理の確認で完了（精算は無い）")
b=last(BASE,'wr_actions'); old['wr_actions_exp']=b.replace('function public.wr_actions(','function public.wr_actions_exp(',1)
x=sub(old['wr_actions_exp'],"if r.kind not in "+K3+" then return o; end if;","if r.kind not in "+K4+" then return o; end if;   -- v1202：紛失届（lost）")
x=sub(x,"or (r.status in ('checked','done') and r.kind in "+K3+" and public.wr_is_acct(a))","or (r.status in ('checked','done') and r.kind in "+K4+" and public.wr_is_acct(a))")
new['wr_actions_exp']=x
# norm
old['wr_norm']=last(BASE,'wr_norm')
new['wr_norm']=sub(old['wr_norm'],""" else raise exception 'bad_value';
 end if;
 if v_cents is null""",""" elsif p_kind = 'lost' then   -- v1202：紛失届。店（業者）・カードを使った人は必ず。金額はセント
  if jsonb_typeof(o->'amount_cents') <> 'number' then raise exception 'bad_value'; end if;
  v_cents := (o->>'amount_cents')::bigint;
  if btrim(coalesce(o->>'vendor', '')) = '' or btrim(coalesce(o->>'cardholder', '')) = '' then raise exception 'bad_value'; end if;
 else raise exception 'bad_value';
 end if;
 if v_cents is null""")
old['wr_prefix']=last(S2,'wr_prefix')
new['wr_prefix']=sub(old['wr_prefix'],"when 'plan' then 'MP' end;","when 'plan' then 'MP' when 'lost' then 'LR' end;")
old['wr_can_submit']=last(EG,'wr_can_submit')
new['wr_can_submit']=sub(old['wr_can_submit']," select coalesce(p_kind = any(public.wr_exp_kinds(a)), false)"," select (p_kind = 'lost' or coalesce(p_kind = any(public.wr_exp_kinds(a)), false))   -- v1202：紛失届はだれでも（今の画面と同じ）。店の決まりは経費と同じ")
old['wr_next_v0']=last(AR,'wr_next_v0')
new['wr_next_v0']=sub(old['wr_next_v0'],"when r.status = 'approved' and r.kind in "+K3+" then","when r.status = 'approved' and r.kind in "+K4+" then")
old['ar_visible']=last(AR,'ar_visible')
new['ar_visible']=sub(old['ar_visible'],"(r.kind in "+K3+" or public.wr_s2_acct(r.kind))","(r.kind in "+K4+" or public.wr_s2_acct(r.kind))")
old['ar_kinds']=last(AR,'ar_kinds')
new['ar_kinds']=sub(old['ar_kinds'],"select array['mileage','reimburse','expense_pre','skill','cs','tiprate']::text[]","select array['mileage','reimburse','expense_pre','lost','skill','cs','tiprate']::text[]")
old['wr_actions']=last(AR,'wr_actions')
new['wr_actions']=sub(old['wr_actions'],"and not v_mine and r.kind in "+K3+"\n","and not v_mine and r.kind in "+K4+"\n")
old['wr_stage']=last(AR,'wr_stage')
new['wr_stage']=sub(old['wr_stage'],"select jsonb_build_object('stage', 8)","select jsonb_build_object('stage', 9)")
# Codex #207/#209（P1）：共通ルールで動かしているとき、紛失届の有効なルールが無いと申請は no_route で送れない。
# アプリが「新しい紛失届を出せるか」を決められるように、whoami の ar に lost_rule（紛失届の有効なルールがあるか）を足す
old['wr_whoami']=last(AR,'wr_whoami')
new['wr_whoami']=sub(old['wr_whoami'],"'live', coalesce(s.live, false), 'rev', coalesce(s.rev, 1), 'live_at', s.live_at,","'live', coalesce(s.live, false), 'rev', coalesce(s.rev, 1), 'live_at', s.live_at,\n  'lost_rule', exists (select 1 from public.ar_rules x where x.kind = 'lost' and x.status = 'active'),   -- v1202（Codex #207）")
ORDER=['wr_prefix','wr_norm','wr_can_submit','wr_submit_exp','wr_act_exp','wr_actions_exp','wr_actions','wr_next_v0','ar_visible','ar_kinds','wr_stage','wr_whoami']
KS="'mileage','reimburse','expense_pre','skill','cs','tiprate',\n  'budget','leave','shift','hire','resign','promo','tip_self','skill_self','prep','plan'"
head='''-- v1202（段階 3 の残り・決めてほしいこと 8 の A「8B と一緒に経理レビューへ」・Moto さん 11/18）：紛失届をサーバーの申請へ。
-- 仕様：docs/UNIFIED_UI_V1191_JA.md の 25。
--
-- 【前】紛失届は端末の共通データ（lost_receipts）で、GM・CEO が今の画面で承認していた。経理は一覧を見るだけ。
-- 【いま】申請の種類 lost（番号 LR-…）。中身は今と同じ（買った日・店（業者）・金額・カードを使った人・品目・メモ。カードの番号は持たない）。
--   出せる人：ログインしたすべての人（今の画面と同じ・経費の申請の権限 wr_exp_kinds にはかけない）。店の決まりは経費と同じ。
--   承認：GM（承認・閲覧の共通ルールがあればそのルート＝ar_kinds に lost）→ 経理の確認で完了（事前経費と同じ・精算は無い）。重複の確かめは経費と同じ。
--   前の紛失届（lost_receipts）はサーバーに写さない（前の画面で、前からの申請中のものの承認・差し戻しだけ）。
--   SQL の段は 9（wr_stage）。アプリは段 9・関数 fn 14 のときだけ新しい紛失届を出す。
-- 中身は前の版の関数の写しに、lost を足しただけ（どの関数も 1 か所〜2 か所。生成：scripts/gen-wr-lost.py と同じ手順）。
-- 先に 20261209090000_approval_rules.sql（承認・閲覧の共通ルール）までを流してから。2 回流しても同じ。
-- 気をつけること：20261104090000・20261120090000・20261204090000・20261209090000 をあとで流し直すと lost が消える（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.ar_kinds()') is null or to_regprocedure('public.wr_submit_exp(jsonb)') is null or to_regprocedure('public.wr_act_exp(jsonb)') is null
    or to_regprocedure('public.wr_actions_exp(jsonb,public.wr_requests)') is null or to_regprocedure('public.wr_next_v0(public.wr_requests)') is null
    or to_regprocedure('public.wr_can_submit(jsonb,text,text)') is null or to_regprocedure('public.wr_stage(jsonb)') is null then
  raise exception 'STOP: 先に承認・閲覧の共通ルールの SQL（20261209090000_approval_rules.sql）までを流してください（何も変えていません）';
 end if;
end $$;

alter table public.wr_requests drop constraint if exists wr_requests_kind_check;
alter table public.wr_requests add constraint wr_requests_kind_check check (kind in ('''+KS+''',\n  'lost'));

'''
SEED='''-- Codex #207/#209（P1）：紛失届の承認ルールは「下書き」だけを用意する（20261209090000 の初めの下書きと同じ形＝GM・CEO の 1 段・閲覧者は担当 AM と経理の 3 役・本人は GM）。
-- 有効にはしない（承認の経路は CEO・GM が 設定 › 承認・閲覧設定 で確かめて有効にする）。共通ルールで動かしているあいだ、有効にするまでアプリは新しい紛失届を出さない（今の紛失届の画面）。
-- もう lost の行があれば何もしない（2 回流しても同じ）。回数は今の作り方（ar_rule_rev_next）で。
do $$
declare
 v_gmo jsonb := jsonb_build_object('t', 'role', 'role', 'gm', 'scope', 'all');
 v_ceo jsonb := jsonb_build_object('t', 'role', 'role', 'ceo', 'scope', 'all');
 v_amo jsonb := jsonb_build_object('t', 'role', 'role', 'am', 'scope', 'mine');
 v_view jsonb; d jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('ar_rule:lost'));
 if exists (select 1 from public.ar_rules x where x.kind = 'lost') then return; end if;
 v_view := jsonb_build_array(jsonb_build_object('who', v_amo, 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_mgr', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_lead', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'office_crew', 'scope', 'all'), 'from', 'submit'));
 d := jsonb_build_object('default', jsonb_build_object('label', 'GM・CEO', 'stages', jsonb_build_array(jsonb_build_object('mode', 'any', 'slots', jsonb_build_array(v_gmo, v_ceo)))))
  || jsonb_build_object('viewers', v_view, 'self', 'gm');
 insert into public.ar_rules(kind, ver, status, def, note, rev, created_by, updated_by)
  values ('lost', 1, 'draft', d, '初めの下書き（v1202・紛失届）', public.ar_rule_rev_next('lost'), 'sql', 'sql');
end $$;
'''
mig=head+'\n\n'.join(new[k] for k in ORDER)+'\n\n'+SEED
CHECK = '--check' in sys.argv
def put(path, text):
    if CHECK:
        cur = open(R+path, encoding='utf-8').read()
        if cur != text: raise SystemExit('DIFF: ' + path + ' is not what the generator makes (run python3 scripts/gen-wr-lost.py)')
    else: open(R+path,'w',encoding='utf-8').write(text)
put('supabase/migrations/20261213090000_wr_lost.sql', mig)
rb='''-- v1202 を戻す（紛失届をサーバーの申請へ を外す）。前の版の関数に戻し、種類 lost を外す。
-- 紛失届（lost）の申請がもう 1 件でもあれば止める（消さない）。そのときは申請を取り下げ・却下にしてから、Claude に相談してください。
do $$ begin
 if exists (select 1 from public.wr_requests where kind = 'lost') then
  raise exception 'STOP: 紛失届（lost）の申請があります。何も変えていません';
 end if;
end $$;

alter table public.wr_requests drop constraint if exists wr_requests_kind_check;
alter table public.wr_requests add constraint wr_requests_kind_check check (kind in ('''+KS+'''));

-- 紛失届の承認ルール（下書き・有効・前の版）も外す（申請が 0 件のときだけここまで来る）
delete from public.ar_rules where kind = 'lost';

'''+'\n\n'.join(old[k] for k in ORDER)+'\n'
put('db/wr-lost-drop.sql', rb)
print('ok' if not CHECK else 'same', len(mig.splitlines()), len(rb.splitlines()))
