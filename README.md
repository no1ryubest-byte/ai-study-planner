# AI学習プランナー

試験日から逆算して学習計画を立て、AIアドバイザーが採点・解説・練習問題・Q&Aを手伝う学習アプリです。

- **Web版**：`app.html`（1ファイルで動く）
- **スマホアプリ版**：`mobile/`（Expo。AIは端末の中で動く Qwen3-VL ＋ llama.rn。通信・アカウント不要）

## ファイル構成

| 場所 | 中身 |
|---|---|
| `app.html` | 画面とアプリ本体 |
| `engine.js` / `toc.js` / `study.js` | 計画づくり・目次の読み取り・学習機能 |
| `advisor/advisor.js` | AIアドバイザーのプロンプトと返事の検証（AdvisorKit） |
| `native-bridge.js` | スマホアプリで AI の呼び出しを端末内AIへつなぐ部分 |
| `build.js` | 1ファイル版と、スマホ用の `mobile/src/web/appHtml.ts` を作る |
| `vendor/katex` | 数式表示（KaTeX, MIT License） |
| `test-*.js` | テスト（`node test-engine.js` など） |
| `mobile/` | Expo アプリ（使い方は `mobile/README.md`） |

## スマホアプリを動かす

```sh
cd mobile
npm install
npm run setup
npx eas-cli build --profile development --platform android   # 初回だけ（クラウドでビルド）
npx expo start --dev-client
```

Windows なら `mobile/setup.cmd` → `mobile/build-android.cmd` → `mobile/start.cmd` をダブルクリックでも同じです。
Expo Go では端末内AIが動かないので、開発ビルドを使ってください。

## ライセンス

- AIモデル：Qwen3-VL（Alibaba Cloud Qwen チーム、Apache License 2.0）※リポジトリには含みません。アプリが初回にダウンロードします
- 推論：llama.cpp / llama.rn（MIT License）
- 数式：KaTeX（MIT License）
