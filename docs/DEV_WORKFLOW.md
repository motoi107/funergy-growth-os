# Funergy+ 開発フロー（Claude 2 つで実装・Codex でレビュー・GitHub で 1 つの最新版）

この文書が開発手順の唯一の説明です。`CLAUDE.md`・`AGENTS.md` はここを参照し、同じ手順を複製しません。
最新版の根拠は GitHub（このリポジトリのコード・ブランチ・PR・記録）です。どのチャットの記憶も根拠にしません。

## 1. 役割

| 担当 | すること | しないこと |
|---|---|---|
| Claude（個人のワークスペース） | 実装・修正・テスト・コミット・push・PR 作成・引き継ぎ記録 | 他方が書いている最中のブランチへの書き込み・マージ・本番の DB や設定の変更 |
| Claude（会社の Team ワークスペース） | 同上（どちらからでも開始・途中交代できる） | 同上 |
| Codex | PR のレビュー（指摘・修正後の再レビュー） | コミット・修正 PR・マージ・リポジトリ設定の変更（このフローでは使わない） |
| Moto | 依頼・仕様の判断・マージ・本番の SQL／関数／Secrets の反映・実機確認 | 生成コードのコピー＆ペースト |

- Codex の指摘は、その時点でブランチを担当している Claude が同じ PR で直します。
- 既存の予定タスク「Growth OS：Claude自動レビュー」（2026-09-07 に作った Claude Code の予定タスク。作ったアカウントのワークスペースにだけ見える。個人か Team かは未確認）は従来どおり動きます。このフローの必須ではなく、Codex の判定の代わりにもなりません。PR の本文を直しただけでも起動して同じ head に 2 回書くことがあります（2026-11-15 に #169 で確認）。
- GitHub 上では、個人の Claude・Team の Claude・Codex のどれも **motoi107** として記録されます。どの Claude が書いたかは、コミットの末尾の `Claude-Workspace: personal` / `Claude-Workspace: team`、PR 本文、引き継ぎ記録で区別します。

## 2. どこに何があるか

| もの | 場所 | 本番への反映 |
|---|---|---|
| アプリ（Web・iPhone のホーム画面のアプリ＝同じ PWA） | このリポジトリの `index.html`・`sw.js`・`appicons/` | `main` に入ると GitHub Pages（`pages build and deployment`）が `funergy-plus.com` に公開（数分） |
| DB（SQL）・Edge Functions のソース | `supabase/migrations/`・`supabase/functions/`・`db/`・`deploy/<名前>/手順.md` | Moto が Supabase の画面で手順どおりに流す（自動では入らない） |
| PIN の確かめ入りの関数 1 ファイル・`auth-pin`・`hyper-worker` など | **GitHub に無い**（公開リポジトリのため。Moto に直接渡している） | Moto が Supabase に貼る |
| Secrets（Service Role・OAuth・VAPID など） | Supabase の Secrets だけ。名前は `.env.example` | Moto が設定 |
| UI案（Claude の Design などの成果物） | 作ったワークスペースの中だけ（もう一方からは見えない） | 決まったことはこのリポジトリの仕様書に書く |
| ChatGPT Sites 版の Growth OS | 別のプロジェクト（`AGENTS.md` の Project boundaries） | このフローでは触らない |

- 本番の Supabase は `index.html` が指すプロジェクトだけです。開発・試験は手元の合成データ（PGlite・fake-indexeddb・ヘッドレス Chrome）で行い、本番の DB・関数・従業員／給与／勤怠のデータには接続しません。
- このリポジトリは**公開**です。秘密の値・個人情報・本番の数・非公開の関数ファイルをコミットしません。

## 3. 環境

- 実装は **Claude Code のクラウドのセッション**（claude.ai/code、デスクトップアプリの Cloud、iPhone の Claude アプリ）で行います。個人・Team それぞれのワークスペースで GitHub（motoi107）を連携し、`motoi107/funergy-growth-os` を選びます。
- 通常のチャットや Project は、相談・UI案・読むためだけに使います。そこで作ったコードは、同じワークスペースの Claude Code のセッションにブランチ名と一緒に渡してコミットさせます。Project に取り込んだ GitHub の資料はその時点の写しで、自動では最新になりません。
- 試験の準備と基本の確かめ（Node 22・Python 3・Chrome）：

```bash
npm ci --prefix tests/runtime --ignore-scripts --no-audit --no-fund
python3 scripts/check-static-release.py          # アプリか sw.js を変えたとき
node --test tests/<変更に関係する試験>.test.mjs   # CI と同じ一覧は .github/workflows/growth-checks.yml
```

## 4. 作業 ID・ブランチ・版の番号

- 作業 ID ＝ ブランチ名の `claude/` より後ろ（例：`claude/menu-fix` → `menu-fix`）。1 作業 ＝ 1 ブランチ ＝ 1 PR ＝ 1 引き継ぎ記録 `docs/handoff/<作業ID>.md`。
- PR の base は必ず `main`。前の PR の上に積むときもマージ先は `main` にし、本文の先頭に「#N の上」と書きます（Codex の判定は main 向けの PR が対象）。
- 個人用・Team 用の長く続くブランチは作りません。
- `APP_VERSION`（`index.html`）と `SW_BUILD`（`sw.js`）は同じ番号にします。番号はマージの順で決まり、先に別の PR が `main` に入ったら `main` を取り込んで次の番号に上げます。

## 5. 作業開始

1. `git fetch origin` で最新を取り、`main` の最新コミットを確かめる。
2. 開いている PR とそのブランチを確かめる（API が使えないときは `git ls-remote origin 'refs/pull/*/merge'` に出る番号が開いている PR、`git ls-remote origin 'refs/pull/*/head'` がその head）。`main` だけを読んで途中の作業を見落とさない。
3. 関係する PR の Codex の最新の判定（コメントの `growth-ai-decision` の印）と、その `head_sha` が今の head と同じかを確かめる。
4. 新しい作業：最新の `main` から `claude/<作業ID>` を作る。引き継ぎ：その作業ブランチを取得して続ける（6 の 4）。
5. `docs/handoff/<作業ID>.md` を `docs/HANDOFF.md` の形で作り（または更新し）、担当の Claude と範囲を書いてコミットする。

## 6. 交代（個人 ⇄ Team）

1. **元の Claude**：変更をコミットして push する。未完成なら題に `WIP` と書く。
2. **元の Claude**：`docs/handoff/<作業ID>.md` を更新し、**それをブランチの最後のコミットにして** push する。PR があれば同じ要点をコメントする。
3. **元の Claude**：そのブランチへの書き込みを終える（同じセッションで続けない）。報告はブランチ名と最後のコミット SHA だけ。
4. **引き継ぐ Claude**：ブランチを取得し、次の 2 つが同じ SHA であることを確かめる。違えば記録のあとに変更があるので、差分を読んでから進める。

```bash
git fetch origin claude/<作業ID>
git log -1 --format=%H origin/claude/<作業ID>
git log -1 --format=%H origin/claude/<作業ID> -- docs/handoff/<作業ID>.md
```

   そのうえで引き継ぎ記録・PR・`main` との差分・Codex の未解決の指摘を読み、済んだことと残りを報告してから再開する。
5. push できなかったときは、基準のコミット SHA を書いた差分（`git format-patch` か `git diff`）を Moto に渡して「未保存」と明記する。「同期した」とは報告しない。

## 7. 同時に開発するとき

- 作業を分け、別のブランチ・別のセッション（クラウドのセッションはそれぞれ別の環境）で進める。同じブランチを 2 つのセッションから同時に書かない。
- 同じファイル（とくに `index.html` の同じ所・同じ SQL）や共有の設定に重なる作業は順番に進める。
- 他方の変更を取り込んだら、まとめた結果で試験を流し直し、その head で Codex の判定を受ける。
- ブラウザのタブを分けただけでは、ワークスペースや GitHub の認証は分かれない。切り替えたら画面左下のワークスペース名を確かめる。

## 8. PR の本文

Codex が会話を読まずに判断できるように、次を書きます（引き継ぎ記録と重なる所はリンクでよい）。

- 目的／利用者から見た変更／対象範囲（画面・ロール・店舗・SQL・関数）
- 検証結果（実行したコマンドと結果。実行していないものは未実行と書く）／未確認事項
- 関連 Issue・前の PR／実装した Claude（個人・Team）／引き継ぎ記録 `docs/handoff/<作業ID>.md`
- 本番に必要な手順（`deploy/<名前>/手順.md`）と、非公開ファイルが要るか

## 9. Codex のレビュー

- 既存の Codex の判定（PR コメントの `growth-ai-decision` の印：`head_sha`・`verdict` など）をそのまま使います。新しい自動レビュー（Codex の Automatic review・GitHub Actions）は足しません。
- 有効な判定は、印の `head_sha` が今の PR の head と同じものだけです。古いコミットの判定を新しいコミットに流用しません。push のあと 2〜5 分で、同じ head に 2 つ判定が付くことがよくあります（どちらも見る）。Codex をどこで動かしているか（ChatGPT 側の設定）はこのリポジトリからは見えません。
- 公式の `@codex review`（bot が返す）は、Moto が求めたときだけ使います。同じコミットに重ねて依頼しません。
- 次のどれかがあれば完了扱いにしません：P1・P2 の未解決／CI の失敗／Codex の判定が未実行・失敗・結果不明・古い head のもの。
- 「指摘なし」は全機能の実動作確認や全試験の成功と同じではありません。判定（`blocked`・`manual` など）と未確認事項をそのまま記録します。
- Codex の判定は GitHub の Approve でもマージの許可でもありません。PR の作成者も Codex のコメントも motoi107 なので、GitHub の正式な Approve は使えません（自分の PR は承認できない）。マージの判断は Moto が PR 上の判定と CI を見て行います。

## 10. マージ・本番・戻し方

- マージは Moto が GitHub の画面で行います（`main` にブランチ保護・必須チェックは無い）。マージすると Pages が公開します。
- SQL・関数・Secrets は `deploy/<名前>/手順.md` の順に Moto が反映します。マージと順番が決まっている場合は手順に従います。
- 本番のアプリの版は `https://funergy-plus.com/sw.js` の `SW_BUILD` で確かめ、`main` の `APP_VERSION` と比べます。
- 戻すときは `main` で revert の PR を作ってマージします（Pages は前の版に戻る）。DB と関数は戻らないので、各手順.md の戻し方に従います。

## 11. 記録

- 進行中の作業：`docs/handoff/<作業ID>.md`（短く・作業ごとに 1 つなので並行作業でもぶつからない）。
- これまでの詳しい記録：`docs/AI_SHARED_MEMORY_JA.md`・`docs/AI_BACKLOG_JA.md`。とても大きいので全体を読み込まず、先頭の新しい節と、作業に関係する語で探した所だけ読みます。マージのときに要点を先頭に足すのは従来どおり。
- 非公開ファイル（PIN の確かめ入りの関数など）は、交代するたびに Moto が最新を添付し、記録の sha256 の先頭と照合します。

## 12. 試し方（S1〜S4・本番には何も入れない）

試しの PR はマージせずに閉じ、ブランチを消します。アプリ（`index.html`・`sw.js`）・SQL・関数には触れません。試しの PR でも予定タスク「Growth OS：Claude自動レビュー」が書き込むことがあります（そのままにする）。

| 段 | だれが | すること | 合格の条件 |
|---|---|---|---|
| S1 | 個人の Claude | `main` から `claude/flow-test-a` を作り、`docs/handoff/flow-test-a.md` と試しの小さな変更（`tests/` の中だけ）をコミットして push、PR（base `main`）を作る | ブランチと PR が GitHub にある・最後のコミットが引き継ぎ記録・末尾が `Claude-Workspace: personal` |
| S2 | Team の Claude | 6 の 4 の 2 つの SHA が同じことを確かめて引き継ぎ、1 つ変更を足して記録を更新し push、PR を「Ready for review」に | 力ずくの push が無い・新しいコミットの末尾が `Claude-Workspace: team`・記録の担当が Team |
| S3 | Codex → Team の Claude | Codex の判定を待つ。指摘があれば Team の Claude が同じ PR で直す。指摘が無くても 1 つコミットを足して push する | 判定の `head_sha` が直す前の head と同じ・直したあとの新しい head に新しい判定が付く・Codex のコミットが無い |
| S4 | 逆の順 | `claude/flow-test-b` で Team が始め、個人が引き継ぎ、Codex → 個人が直す → 再レビュー | S1〜S3 と同じ（個人と Team を入れ替えて） |

終わったら：両方の PR を閉じ（マージしない）、ブランチを消し、`main` の最新コミット・`https://funergy-plus.com/sw.js` の `SW_BUILD` が試しの前と同じことを確かめて、結果を `docs/handoff/two-claude-workflow.md` に書きます。
