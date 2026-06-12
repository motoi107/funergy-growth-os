# Funergy Growth OS — アプリアイコン（FG+）設置ガイド

このフォルダには、アプリ用アイコン一式とPWA（ホーム画面に追加できるWebアプリ）設定が入っています。

---

## 1. ファイルをアップロード

GitHubリポジトリ（`funergy-growth-os`）の `index.html` と同じ場所に、
この `appicons` フォルダごとアップロードしてください。

```
funergy-growth-os/
├─ index.html
└─ appicons/
   ├─ manifest.json
   ├─ icon.svg
   ├─ favicon.ico
   ├─ icon-16.png … icon-1024.png
   └─ icon-maskable-192.png / icon-maskable-512.png
```

---

## 2. index.html の <head> にこの数行を追加

`index.html` の `<head> … </head>` の中（`<title>` の下あたり）に貼り付けます。

```html
<!-- PWA / アプリアイコン -->
<link rel="manifest" href="appicons/manifest.json">
<meta name="theme-color" content="#f0661f">
<link rel="icon" type="image/png" sizes="32x32" href="appicons/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="appicons/icon-16.png">
<link rel="shortcut icon" href="appicons/favicon.ico">
<!-- iOS（iPhone / iPad）用 -->
<link rel="apple-touch-icon" href="appicons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Funergy">
```

---

## 3. ホーム画面に追加して確認

- **iPhone（Safari）**: サイトを開く → 共有ボタン → 「ホーム画面に追加」
- **Android（Chrome）**: サイトを開く → メニュー → 「ホーム画面に追加」／「アプリをインストール」

ホーム画面に「FG+」アイコンのアプリが追加され、タップするとフルスクリーンで開きます。

---

## ファイル一覧

| ファイル | 用途 |
|---|---|
| `manifest.json` | PWA設定（アプリ名・色・アイコン） |
| `icon.svg` | 元データ（無限に拡大できるベクター） |
| `favicon.ico` | ブラウザのタブ用 |
| `icon-180.png` | iOSホーム画面用 |
| `icon-192.png` / `icon-512.png` | Android／PWA標準 |
| `icon-maskable-*.png` | Androidの丸型／角丸型に自動対応する版 |
| その他 `icon-NN.png` | 各種サイズ |

---

## 補足

- アイコンを変えたくなったら、`icon.svg` を編集して各PNGを再書き出しすれば差し替えられます。
- これは「ホーム画面に追加」して使うPWA方式です。App Store / Google Play への正式申請（ネイティブアプリ化）は別途必要で、その際もこのアイコンを流用できます。
