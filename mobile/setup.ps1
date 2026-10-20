# ============================================================
#  AI学習プランナー（スマホアプリ）の環境構築：Windows 用
#  setup.cmd をダブルクリックすると、このスクリプトが動きます。
#
#  1. Node.js（20 以上）があるか確かめる。なければ winget で入れる
#  2. 画面（app.html）をアプリ用の1ファイルに書き出す
#  3. npm install と、Expo SDK に合う版のライブラリを入れる
#  4. テストと型チェック
#  5. 次にやること（スマホ用の開発ビルド）を表示
# ============================================================
$ErrorActionPreference = 'Continue'  # 成否は各コマンドの終了コードで判断する
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot

function Step($n, $text) { Write-Host ""; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

# --- 1. Node.js -------------------------------------------------------
Step 1 'Node.js を確かめます'
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int]((node -v).TrimStart('v').Split('.')[0]) }
if ($major -lt 20) {
  Warn "Node.js 20 以上が見つかりません（今：$(if ($node) { node -v } else { 'なし' })）。winget で Node.js LTS を入れます。"
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  # 入れたばかりの Node を、この画面でも使えるようにする
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js を入れられませんでした。https://nodejs.org から LTS を入れて、もう一度 setup.cmd を実行してください。' }
}
Ok "Node.js $(node -v) / npm $(npm -v)"

# --- 2. 画面をアプリ用に書き出す --------------------------------------
Step 2 '画面（app.html）をアプリ用の1ファイルに書き出します'
node ..\build.js ..\dist\ai-study-planner.html
if ($LASTEXITCODE -ne 0) { throw '画面の書き出しに失敗しました。' }
Ok 'src\web\appHtml.ts を作りました'

# --- 3. ライブラリ ------------------------------------------------------
Step 3 'ライブラリを入れます（数分かかります）'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
$pkgs = 'react react-native react-native-webview react-native-safe-area-context expo-dev-client expo-file-system expo-device expo-status-bar expo-build-properties'.Split(' ')
npx --yes expo install @pkgs
if ($LASTEXITCODE -ne 0) {
  # npm が途中で Expo の CLI の場所を移すと失敗することがある。入れ直してもう一度
  Warn 'もう一度試します'
  npm install
  npx --yes expo install @pkgs
  if ($LASTEXITCODE -ne 0) { throw 'Expo のライブラリを入れられませんでした。' }
}
npm install
npx --yes expo install typescript @types/react -- --save-dev
if ($LASTEXITCODE -ne 0) { throw 'TypeScript を入れられませんでした。' }
npx --yes expo install --check
Ok 'ライブラリを入れました'

# --- 4. テストと型チェック ---------------------------------------------
Step 4 'テストと型チェック'
node --experimental-strip-types test/request.test.ts
if ($LASTEXITCODE -ne 0) { throw 'テストが失敗しました。' }
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Warn '型チェックでエラーがありました（上の表示を Claude に見せてください）。' } else { Ok '型チェック OK' }

# --- 5. 次にやること ----------------------------------------------------
Step 5 '環境構築が終わりました'
Write-Host @'

  スマホで動かすには「開発ビルド」が必要です（Expo Go では動きません）。

  ■ Android（おすすめ・PCに Android Studio は不要）
     build-android.cmd をダブルクリック
       → Expo のクラウド（EAS）でアプリを作り、QRコードからスマホに入れられます
       → 初回だけ Expo のアカウントでログインします（無料プランで作れます）

  ■ アプリを入れたら、この PC で
     start.cmd をダブルクリック → スマホのアプリで同じ Wi-Fi の PC を選ぶ

  ■ アプリの中で
     設定 → 端末のAI → AIのモデルを管理 → ダウンロード（約1.56GB、Wi-Fi で）
     → 「AIの動作チェック」

'@
