# ============================================================
#  Android 用の開発ビルドを Expo のクラウド（EAS Build）で作る
#  build-android.cmd をダブルクリックすると動きます。PC に Android Studio は要りません。
# ============================================================
$ErrorActionPreference = 'Continue'  # 成否は各コマンドの終了コードで判断する
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot
# git がなくてもビルドできるようにする（送るファイルは .easignore で決める）
$env:EAS_NO_VCS = '1'

Write-Host '[1] Expo のアカウントを確かめます' -ForegroundColor Cyan
npx --yes eas-cli@latest whoami 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host '    Expo にログインしてください（アカウントがなければ https://expo.dev/signup で無料で作れます）' -ForegroundColor Yellow
  npx --yes eas-cli@latest login
  if ($LASTEXITCODE -ne 0) { throw 'ログインできませんでした。' }
}

Write-Host '[2] このアプリを Expo のプロジェクトとしてつなぎます（初回だけ）' -ForegroundColor Cyan
npx --yes eas-cli@latest init --non-interactive --force 2>$null
if ($LASTEXITCODE -ne 0) { npx --yes eas-cli@latest init }

Write-Host '[3] 開発ビルドを作ります（クラウドで15〜30分ほど）' -ForegroundColor Cyan
Write-Host '    最後に「Install and run the Android build on an emulator?」と聞かれたら n を押してください（スマホに入れるので不要です）' -ForegroundColor Yellow
npx --yes eas-cli@latest build --profile development --platform android
if ($LASTEXITCODE -ne 0) { throw 'ビルドに失敗しました。上の表示（またはリンク先のログ）を Claude に見せてください。' }

Write-Host ''
Write-Host '終わったら、表示された QR コードをスマホで読み取ってアプリを入れ、start.cmd を実行してください。' -ForegroundColor Green
