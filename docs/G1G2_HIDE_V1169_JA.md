# v1169：G1・G2 の画面から「Tip Rate の変更履歴」と「現場の重点 KPI」を外す（急ぎ）

- 依頼：Moto さん 2026-11-14 19:38 HST「G1とG2の画面からTip Rateの変更履歴と現場のKPIを至急非表示にしてください」。
- 範囲：アプリだけ（index.html・sw.js）。SQL・Edge Function・保存・計算・権限は変えない。

## 変えたこと

| 画面 | 前 | v1169 |
|---|---|---|
| チップ率（Tip Rate）の「Tip Rate 変更履歴」 | G1・G2 にも全員の変更（名前・前後の率・決めた人）が出ていた | G1・G2 には出さない。「あなたのTip Rate」「Tip Rate Policy」はそのまま |
| マイページの「〇〇 の現場の重点 KPI」（v1153） | G1〜G3 に出ていた | G3 だけ |
| ダッシュボード（店長の画面 `renderSlFunergyNow`）の同じカード | G2（sl に読み替え）と店のタブレットにも出ていた | G3 だけ |

G3・AM・GM・CEO・経理・Head Chef の画面は変わらない。G4 の「〇〇 の KPI」（管理のカード）もそのまま。

## G1・G2 の見分け方（`isFloorG1G2`）

G2 は `curRole` が `sl` に読み替わり、`myGradeNum()` が 3 になるので、それでは見分けられない。次の順で決める。

1. 店のタブレット（店舗の PIN・`curStoreLogin`）→ 隠す（G1・G2 が使う画面なので。Claude が決めた）
2. 本当の役割が `g2`、または役割が `crew`・`office_crew` → 隠す
3. 役割が `sl` 以外（CEO・GM・経理・AM・G4・Head Chef）→ 隠さない
4. 役割が `sl` → 従業員マスターの肩書きのグレードが G1・G2 なら隠す（G3 なら出す。名簿に無い人は出す）
5. 読めないとき → 隠す

## 限界

- 画面に出さないだけ。Tip Rate の記録（`spl_tip_requests_*`）は今も公開の鍵で読める（v1146 で止めたのは書き込みだけ）。読めなくするには、v1147 の Tip の確定と同じ形でサーバーの関数から「見られる人の分だけ」を返す作業が要る。
- G2 は役割が `sl` 相当なので、予実・KPI設定などほかの画面は今までどおり開ける（今回の依頼の外）。
- 実機（iPhone・店のタブレット）では見ていない。

## 試験（合成データ）

- `tests/g1g2-hide-v1169.test.mjs`：本物の `renderTipRate`・`isFloorG1G2` を VM で。G1・G2（役割 g2・肩書き Crew Leader・名簿に無い g2）・店のタブレット・事務Crew では変更履歴とほかの人の率が出ない。G3・AM・GM では出る。自分の Tip Rate は残る。
- `tests/kpi-settings-v1153.test.mjs`：現場の重点 KPI のカードを G1・G2・店のタブレット・事務Crew に出さない／G3・GM は出す／G4 の管理のカードはそのまま。
- わざと壊す 10 通りすべてで落ちる。
- `tests/tip-start-date.test.mjs`・`tests/chat-guard-app-v1168.test.mjs` の土台を v1169 に合わせた（版の確かめを「1168 以上」に）。
