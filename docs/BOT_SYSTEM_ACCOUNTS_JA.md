# 勤怠検知のシステムアカウント除外

勤怠検知だけを対象に、予約された端末・注文専用名（Kiosk、Kiosk Mode、Order Only、Order）を除外する。大文字小文字、全角英字、空白・ハイフン・アンダースコア・ドットの表記差、店舗接頭辞/接尾辞を扱う。人名不明・GUIDのみ・管理者・Trainingなどは自動除外しない。部分的に似た人名は対象に残す。

画面のceScanDayとサーバーlaborFindingsで同じ判定を使用。bot/clock-detector.mjsはindex.htmlから生成する。Tip・給与・売上・Void/Unpaidの判定は変更しない。

既存の勤怠案件は再確認時にnonhuman_account_excludedの証跡を保存して完了とする。人の打刻が修正されたという意味ではない。既存の楽観ロックと送信結果未確定時の保護を維持する。

検証: Nodeのbot-center、bot-server、bot-system-accountsテスト。システム名の表記差、類似人名、欠落名、既存案件の除外証跡、財務検知の維持を合成データで検証する。

配備時の注意: 調査時のops-bot version 12には、mainへ未反映の朝の店舗別レポート整形がある。今回のサーバー変更はその配備済みソースに限定差分で適用し、レポート整形を巻き戻さない。配備対象でもbot-system-accountsテストを実行する。最終ソースSHA、レビュー、配備と公開結果は変更PRに記録する。
