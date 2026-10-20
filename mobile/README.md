# AI学習プランナー（スマホアプリ・端末内AI版）

Claude などの外部AIを使わず、**スマホの中だけで動くAI**（Qwen3-VL を llama.cpp で実行）を組み込んだ Expo アプリです。利用者はアカウント不要・通信なしで、計画・学習・答案の採点・目次の読み取りまで使えます（AIのモデルだけ、初回に1回ダウンロード）。

## しくみ

```
┌──────────── Expo アプリ ────────────┐
│ WebView：今の画面（app.html を1ファイル化） │
│   └ native-bridge.js が AI の呼び出しを受ける │
│            ↕ postMessage（JSON）           │
│ useAiBridge → LocalAI → llama.rn          │
│            └ Qwen3-VL（端末の中）           │
└──────────────────────────────────┘
```

- 画面は Web版と同じ（`../app.html` を `node ../build.js` で `src/web/appHtml.ts` に書き出す。KaTeX とフォントも埋め込み済み）
- AIの指示（システムプロンプト・タスク）と返事の検証は Web版と同じ AdvisorKit / StudyKit をそのまま使う
- 単元提案・進め方の JSON は、llama.cpp の文法（grammar）で形を強制する

## はじめて動かす

Expo Go では動きません（llama.rn がネイティブのライブラリのため）。**開発ビルド**を使います。

```sh
cd mobile
npm install            # expo と llama.rn（llama.rn は端末用のライブラリを自動で取ってきます）
npm run setup          # SDK に合う版の react-native・webview などを入れる（npx expo install）
npm run web:build      # 画面（app.html）を変えたときだけ。src/web/appHtml.ts を作り直す

# どちらか
npx expo run:android   # Android Studio がある PC で、つないだ端末に入れる
npx expo run:ios       # Xcode がある Mac で
# または EAS（クラウドでビルド）
npx eas build --profile development --platform android
npx expo start --dev-client
```

アプリを開いたら **設定 → 端末のAI → AIのモデルを管理** で「標準（Qwen3-VL 2B、約1.56GB）」をダウンロードし、**AIの動作チェック** を押してください。単元提案・進め方・解説・練習問題・写真の読み取りを端末のAIで試し、合格したか・かかった秒数を表示します。

## 公開する前に

| 項目 | すること |
| --- | --- |
| アプリのID | `app.json` の `com.example.aistudyplanner` を自分のものに変える |
| iOS のメモリ | llama.rn のプラグインが「Increased Memory Limit」を付ける。Apple Developer の App ID でこの機能を有効にする |
| モデルの置き場所 | いまは Hugging Face から直接ダウンロード。安定させるなら同じファイルを Firebase Storage などに置き、`src/ai/catalog.ts` の `url` を変える |
| ライセンス表記 | モデル Qwen3-VL（Apache-2.0）、llama.cpp / llama.rn（MIT）。モデルの画面に表記済み。ストアの説明にも書く |
| 記録の保存 | 科目・計画・記録は WebView の中（localStorage）に保存。アプリを消すと消える |

## 端末内AIの制約

- 小さいモデルなので、解説・問題・採点の正確さは Claude などの大きなAIより落ちます。特に手書きの数式の読み取りは苦手です。返事はアプリ側で検証し、だめなときは「基本」の進め方にしたり、自分で ○△× を直せるようにしています。
- 速さは端末しだいです（目安：最近のスマホで 2B は1秒に10〜20トークン。解説1つに1〜2分）。
- メモリ 4GB 未満の端末では動かないことがあります。4B モデルはメモリ 8GB 以上向け。
- Android は機種差が大きいので CPU で動かしています（`src/ai/localAI.ts` の `n_gpu_layers`）。iPhone は GPU（Metal）を使います。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `App.tsx` | WebView と「端末のAI」の画面 |
| `src/ai/catalog.ts` | モデルの一覧（URL・大きさ・必要なメモリ） |
| `src/ai/modelFiles.ts` | ダウンロード（進み具合・途中でやめる）・確認・削除、選んだモデルの保存 |
| `src/ai/localAI.ts` | llama.rn でモデルを読み込み、1つずつ動かす・止める・メモリを空ける |
| `src/ai/request.ts` | WebView からの依頼を確かめ、llama.rn の引数にする（純粋な関数・テストあり） |
| `src/ai/useModels.ts` | モデルの状態のフック |
| `src/bridge/useAiBridge.ts` | WebView ↔ 端末内AI の橋渡し |
| `src/screens/ModelSheet.tsx` | モデルを選ぶ・ダウンロードする画面 |
| `src/web/appHtml.ts` | 自動生成（`node ../build.js`）。手で編集しない |
| `test/request.test.ts` | `npm test`（Node だけで動くテスト） |
