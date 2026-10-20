/* app.html に engine.js・toc.js・study.js・advisor.js・native-bridge.js を埋め込んで公開用の1ファイルを作り、
 * 数式用の KaTeX（vendor/katex）を出力先の katex/ にコピーする。 node build.js [出力先]
 * mobile/ があれば、スマホアプリ用の1ファイル版（KaTeX とフォントも埋め込み）を mobile/src/web/appHtml.ts に書き出す。 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = process.argv[2] || path.join(__dirname, 'dist', 'ai-study-planner.html');
const tpl = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');
const parts = {
  '/*@@ENGINE@@*/': fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'),
  '/*@@TOC@@*/': fs.readFileSync(path.join(__dirname, 'toc.js'), 'utf8'),
  '/*@@STUDY@@*/': fs.readFileSync(path.join(__dirname, 'study.js'), 'utf8'),
  '/*@@ADVISOR@@*/': fs.readFileSync(path.join(__dirname, 'advisor', 'advisor.js'), 'utf8'),
  '/*@@NATIVE@@*/': fs.readFileSync(path.join(__dirname, 'native-bridge.js'), 'utf8'),
};

let html = tpl;
for (const [mark, src] of Object.entries(parts)) {
  if (src.includes('</script')) throw new Error(mark + ' のファイルに </script が含まれています');
  if (!html.includes(mark)) throw new Error('app.html に埋め込み位置 ' + mark + ' がありません');
  html = html.replace(mark, () => src.trim());
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
// 確認用：公開時と同じく doctype と head で包んだページ（標準モードで表示を確かめるため）
const skeleton = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
fs.writeFileSync(path.join(path.dirname(out), 'preview.html'), skeleton + html + '</body></html>');

// KaTeX（同梱ファイル）
const vendor = path.join(__dirname, 'vendor', 'katex');
const dest = path.join(path.dirname(out), 'katex');
const copied = [];
(function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      copied.push(path.relative(path.dirname(out), d));
    }
  }
})(vendor, dest);
fs.writeFileSync(path.join(path.dirname(out), 'katex-files.json'), JSON.stringify(copied.sort(), null, 1));

// 埋め込んだ <script> の構文チェック
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
scripts.forEach((src, i) => {
  try {
    new Function(src); // 構文エラーがあればここで投げる
  } catch (e) {
    console.error(`script #${i + 1} の構文エラー: ${e.message}`);
    process.exit(1);
  }
});
console.log(`${out} を書き出しました（${(html.length / 1024).toFixed(1)} KB、script ${scripts.length} 個 構文OK、KaTeX ${copied.length} ファイル）`);

// スマホアプリ（Expo）用：KaTeX の CSS（フォントは data URI）と JS も埋め込んだ1ファイル
const mobile = path.join(__dirname, 'mobile');
if (fs.existsSync(mobile)) {
  const css = fs.readFileSync(path.join(vendor, 'katex.min.css'), 'utf8').replace(/url\((fonts\/[^)]+\.woff2)\)/g, (m, f) =>
    'url(data:font/woff2;base64,' + fs.readFileSync(path.join(vendor, f)).toString('base64') + ')');
  if (/url\(fonts\//.test(css)) throw new Error('KaTeX のフォントを埋め込めませんでした');
  const kjs = fs.readFileSync(path.join(vendor, 'katex.min.js'), 'utf8');
  if (kjs.includes('</script')) throw new Error('katex.min.js に </script が含まれています');
  const head = '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark">' +
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;-webkit-text-size-adjust:100%}img{max-width:100%}[hidden]{display:none!important}</style>' +
    '<style>' + css + '</style><script>' + kjs + '</script></head><body>';
  const nativeHtml = head + html + '</body></html>';
  const digest = require('crypto').createHash('sha256').update(nativeHtml).digest('hex').slice(0, 12);
  const outTs = path.join(mobile, 'src', 'web', 'appHtml.ts');
  fs.mkdirSync(path.dirname(outTs), { recursive: true });
  fs.writeFileSync(outTs, '// 自動生成：node build.js（app.html などを変えたら作り直す）。手で編集しない\n' +
    'export const APP_HTML_VERSION = ' + JSON.stringify(digest) + ';\n' +
    'const APP_HTML: string = ' + JSON.stringify(nativeHtml) + ';\nexport default APP_HTML;\n');
  console.log(`${outTs} を書き出しました（${(nativeHtml.length / 1024).toFixed(1)} KB、版 ${digest}）`);
}
