# Google の評価・口コミ（Places API（新））— v1209

Moto さん 11/23 10:49 HST の依頼「各店舗の Google 評価・口コミを表示する機能」。ブランチ `claude/google-places-1209`（#215 の上）。入れる一式：`deploy/google-places-v1209/`（手順.md・戻す.md）。

## 1. 依頼と、もう済んでいたこと

- 依頼：各店の Google の評価・口コミの総件数・取れる口コミ（最大 5 件）を出す。口コミは「最新 5 件」ではなく Google が関連性で選んだものとして出す。帰属表示・投稿者・元の口コミへのリンクを公式の決まりどおり。鍵はサーバーだけ・今の認証と店の閲覧権限・登録済みの店だけ・決めた回数まで・要る項目だけ・保存とキャッシュは Google の許す範囲で。Application restrictions を確かめる。
- Moto さんが済ませていたこと：Places API (New) を有効・キーの API の制限を Places API (New) だけ・Supabase の Secrets に `GOOGLE_PLACES_API_KEY`・Application restrictions は None。
- 今の作り（v1157・本番にある）：関数 `google-reviews` に `places_now`（評価・件数・口コミ）と `places_search`（店を探す）があり、place ID は表 `gr_places` に残していた。ただし **会議のカードを描くたびに Google を呼んでいた**（料金）・**関数に入れる人ならどの店でも見られた**・回数は 1 人 1 分 30 回だけ・結べる店は形だけで確かめていた。

## 2. v1209 で変えたこと

| | v1157 | v1209 |
|---|---|---|
| Google を呼ぶとき | 会議のカードを描くたび | 「Google の評価と口コミを見る」を押したときだけ（会議のカード・KPI設定 › Google の口コミ の表） |
| 見られる店 | どの店でも | 自分が見られる店だけ（サーバーで確かめる）。KPI の答え（月の平均・総合評価・結んだか）と月の口コミも同じ |
| 結べる店 | 店の ID の形だけ | 店舗マスター（`public.stores`）にある・使っている店だけ（外すのはいつでも） |
| 回数 | 1 人 1 分 30 回 | それに加えて SQL の上限（下の 5）。Google を呼ぶ前に数え、上限なら呼ばない |
| 取る項目 | 評価・件数・口コミ・名前・住所・リンク | 同じ＋帰属（`attributions`）。店を探すときは評価・件数を取らない（安い料金の項目だけ） |
| 店を探す | 名前で探す | 住所の目安（公開されている住所）を初めから入れて探す・候補に「住所と名前が合う」の印・まだ選んでいない店をまとめて探す（GM・CEO） |

見られる店の決め方（サーバー・アプリの `getVisibleStores` と同じ）：CEO・GM・経理・事務Crew は全店／GM・CEO が確かめた Head Chef（`wr_person_conf` と `wr_person_live` の chef）は全店／ほかは関数 work-requests の whoami が返す自分の店（`stores`）と担当の店（`am_stores`）。店を選ぶ・外す・探すのは GM・CEO だけ（v1157 のまま）。店のタブレット（店舗の PIN）は入れない（v1157 のまま）。

## 3. 画面（今の画面の中だけ・新しいページは作っていない）

- 会議のカード（Google の口コミ）と KPI設定 › Google の口コミ の表：「Google の評価と口コミを見る」→ 店名・★と評価・「口コミ N 件」・「Google マップで見る」・住所 →「Google が関連性の高い順に選んだ口コミです（新しい順ではありません）。最大 5 件で、すべての口コミではありません。」→ 口コミ（投稿者の写真・名前（プロフィールへのリンク）・★・「3 週間前」などの時期・本文（原文が先・無ければ Google の訳）・「Google マップで見る」（その口コミ）・「報告」）→「Google Maps」の文字（Roboto・#5E5E5E・訳さない）・Google が返した帰属・取った時刻（ハワイ）。
- 押す前の文：「押したときだけ Google から取ります（1 回ごとに Google の料金の対象・10 分たつと消えます）」。
- 取ったものはこのタブのメモリだけ。10 分たつか、会議・KPI設定から離れたら捨てる（端末・サーバーに残さない）。
- GM・CEO：KPI設定の Places の欄に「今日・今月の回数 / 上限」（太平洋時間）。店を選ぶ画面に住所の目安と「住所と名前が目安と合っています／住所は合っています（同じ建物のほかの店かもしれません）／住所が目安と違います」。違う住所の店を選ぶと確かめる。「閉店（Google）」「休業中（Google）」も出す。
- エラーの文：上限（日・店・人・月ごとに「太平洋時間の 0 時（ハワイの 21〜22 時）に戻ります」など）・見られない店・店舗マスターに無い店・鍵が無い（「Places API の鍵がサーバーに入っていません」）・Google が断った（「Google が断りました（…）」）・SQL が前の版。

## 4. Google の決まりに合わせたこと（Policies and attributions for Places API）

- 口コミを出すときは投稿者の名前をすぐ近くに・写真とプロフィールへのリンクがあればそれも → 出している。
- 口コミの並び方を見せることを Google がすすめている → 「関連性の高い順（新しい順ではない）」と書いている。
- 地図なしで出すときは Google の帰属（「Google Maps」の文字かロゴ）と、Google が返す第三者の帰属 → 出している（`attributions`。Google が返さなければ「Google Maps」だけ）。
- 保存とキャッシュ：place ID は残してよい（キャッシュの制限の例外）。評価・件数・口コミ・名前・住所はサーバーにも端末にも残さない（このタブのメモリだけ・最長 10 分）。サーバーが残すのは place ID と回数（日・種類・店／人ごとの数）だけ。
- 口コミの中のリンクは https の Google のアドレスだけ（サーバーとアプリの両方で確かめる）。帰属のリンクは https だけ。
- **まだのこと**：Places API を使うアプリは、だれでも読める利用規約とプライバシーポリシー（Google の利用規約とプライバシーポリシーを取り込んだもの）を用意することになっている。Funergy+ には今これが無い（下の 9）。

## 5. 費用の守り（回数の上限・SQL `20261215090000`）

| | はじめの上限 | 区切り |
|---|---|---|
| 店の評価と口コミ（Place Details） | 1 日 40 回・1 店 1 日 10 回・1 人 1 日 25 回・月 900 回 | 太平洋時間の日・月（Google の請求と同じ） |
| 店を探す（Text Search） | 1 日 40 回・月 400 回 | 同じ |

- 関数が Google を呼ぶ**前**に `gr_places_take` で 1 回分を取る（同じ時刻の呼び出しは advisory lock で順番に）。上限なら呼ばずに 429 `places_cap`。Google が断った回も数える（少なめに見積もらない）。
- 0 にするとその呼び出しを止める（`deploy/google-places-v1209/止める_Places.sql`）。上限は `gr_settings` の欄を SQL で変える。
- 月 900 回は Place Details Enterprise + Atmosphere の無料の 1,000 回より下、月 400 回は Text Search Pro の無料の 5,000 回より下。

## 6. 料金（Google Maps Platform の料金表・2026-11-23 に確かめた）

| 呼び出し | 料金の区分（SKU） | 無料 | 超えたら（1,000 回あたり） |
|---|---|---|---|
| 店の評価と口コミ（評価・件数は Enterprise、口コミは Atmosphere の項目） | Place Details Enterprise + Atmosphere | 月 1,000 回 | 25 ドル |
| 店を探す（id・名前・住所・リンク・営業の状態） | Text Search Pro | 月 5,000 回 | 32 ドル |

- 無料の回数は**請求先アカウント（billing account）ごと・区分ごと・月ごと**。同じ請求先アカウントにつながったほかのプロジェクトで同じ区分を使うと、その分も合わせて数える。
- 料金がかかる条件：同じ請求先アカウントで、月に Place Details Enterprise + Atmosphere が 1,000 回、Text Search Pro が 5,000 回を超えたとき。Funergy+ の上限（月 900・400）だけなら超えない。
- 上限を上げる・ほかのアプリで同じ区分を使う・v1157 の関数のままにする（会議のカードを描くたびに呼ぶ・上限なし）と、超えることがある。
- Business Profile API（v1157 の口コミの毎日の取り込み）は別で、料金はかからない（v1157 のまま）。

## 7. Application restrictions（キーの使える場所の制限）

- 選べるのは なし／ウェブサイト（HTTP リファラー）／IP アドレス／Android／iOS。
- Supabase の Edge Functions は出ていく通信の IP が決まっていない（Supabase の説明：静的な egress IP は出せない・IP で許すなら固定 IP の中継（proxy）を使う）。→ **IP アドレスの制限はそのままでは使えない**（入れると呼べなくなる）。固定 IP の中継（有料のサービス）を足せば使えるが、今は入れていない。
- HTTP リファラー・Android・iOS はブラウザーやアプリから直接呼ぶときのもので、サーバーからの呼び出しには合わない（リファラーは偽れる）。
- → **Application restrictions は「なし」のまま**にして、①「API の制限」を Places API (New) だけ（済）②キーはサーバーの Secrets だけ（画面・GitHub・ログに出さない）③ Google Cloud の 割り当て（1 日あたりの上限）と予算のアラート、で守る（手順.md の B）。
- キーが漏れたと思ったら：Google Cloud でキーを作り直し → Secrets を入れ替え（関数は変えない）。

## 8. 店の紐づけ（GM・CEO が画面で選ぶ・確認事項）

place ID はリポジトリに書かない（画面で選んで `gr_places` に入る）。Claude はこの環境から Google マップを開けないので、place ID と住所の照合は**まだしていない**。画面の住所の目安（公開されている住所）：

| 店 | 住所の目安 | 気をつけること |
|---|---|---|
| ToriTon（F01） | 2334 S King St, Honolulu | Tenkichi と同じ建物（名前で分ける） |
| Tenkichi（F02） | 2334 S King St（2 階）, Honolulu | ToriTon と同じ建物 |
| Totoya Kaimuki（F04-K） | 1127 12th Ave, Honolulu | Marujuu と同じ通り |
| Totoya Piikoi（F04-P） | 436 Piikoi St, Honolulu | LaLa と同じ住所 |
| Totoya Aiea（F04-A） | 99-115 Aiea Heights Dr, Aiea | |
| Marujuu（F05） | 1145 12th Ave, Honolulu | |
| LaLa（F06） | 436 Piikoi St（2 階）, Honolulu | **確認事項**：看板が無く Google マップに店が無いかもしれない（無ければ結ばない） |

- Kapolei・FSP（F03）・Garlic Shack（F03-G）は今は動いていない店として目安を入れていない（店舗マスターで使っていれば選べる）。
- 住所が合っても名前が違う候補（同じ建物のほかの店）は「住所は合っています（…名前を確かめてください）」と出る。
- 目安の住所自体が今と違うかもしれない（Claude が知っている公開の住所）。違っていたら Claude に（`GR_HINT` を直す）。

## 9. Moto さんに確かめること・残る設定

1. 店を選ぶ（GM・CEO・KPI設定 › Google の口コミ）。LaLa が Google マップにあるか。
2. Google Cloud：Places API (New) の割り当て（Place Details・Text Search の 1 日あたり）を 60 回くらいに・予算のアラート（知らせだけで止まらない）。
3. 利用規約とプライバシーポリシー：Google の決まりではだれでも読めるものが要る。社内だけのアプリでも要るかは Google の規約の読み方なので、Moto さんの判断（Claude は弁護士ではない）。作るなら別の作業。
4. 上限の数（はじめの値でよいか）。
5. Head Chef・経理・事務Crew にも全店を見せる（アプリの今の範囲と同じにした）でよいか。

## 10. 試験（合成データ・本番にはつながない）

- `tests/google-places-server-v1209.test.mjs` 8：本物の SQL（PGlite・v1157 の SQL のあと）と本物の handler・偽の Google。見られる店だけ（場面ごと）・KPI と月の口コミの範囲・店舗マスター・上限（日・店・人・月・Google が断った回も数える・同時の呼び出し）・項目（field mask）・口コミ 5 件と順・リンクの確かめ・鍵が答えにもログにも出ない・SQL が v1157 のままの答え。わざと壊す 15 通りすべてで落ちる。
- `tests/google-places-deploy-v1209.test.mjs` 5：入れる一式（② は migration と同じ・④ は handler と同じ）・① と ③ の確かめ（v1157 が無いと STOP・2 回流しても同じ・上限の値を残す・NG の場面）・鍵や place ID の文字が無いこと。
- v1157 の試験（server 15・app 13・deploy 5）を v1209 の動きに合わせた（押したときだけ・見られる店・帰属）。
- `tests/career-score-q4-ui.test.mjs` の版の確かめを「1208 以上・ページと SW が同じ」に。
- 版を見る試験 61 ファイル：落ちる 6 件は d4cd923（#215）でも同じ（cs-card-icons・cs-grade-view・cs-strengths・perf-v1098・toast-alias・cs-grade-rollback＝前から）。承認の forced tie は重いときだけ（単独で 40/40）。
- `python3 scripts/check-static-release.py` pass/1209。CI に v1209 の 2 ファイルを足した。
- 実機（iPhone）・本物の Google・本番のデータでは確かめていない。

## 11. 限界

- 口コミは Google が返す最大 5 件だけ（Places API の決まり）。すべての口コミや新しい順は Business Profile API（v1157 の毎日の取り込み）で。
- 回数の上限は Funergy+ の関数を通る呼び出しだけ。キーを別の場所で使えば数えない（Google Cloud の割り当てで守る）。
- whoami の店の範囲（`stores`・`am_stores`）は work-requests の関数が決める（v1131 から・GM・CEO の確かめた写しと社員の表の狭いほう）。
- 前の版のアプリ（v1157〜v1208）は、関数が v1209 になってもカードを描くたびに「見る」を頼む。サーバーの上限で止まるので費用は超えないが、上限を早く使う → 端末を 1209 に。
