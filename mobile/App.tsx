/**
 * AI学習プランナー（スマホアプリ）
 *
 *  画面は Web版（app.html を1ファイルにしたもの）を WebView でそのまま表示する。
 *  AIの呼び出しだけを、端末内AI（llama.rn ＋ Qwen3-VL）につなぐ。通信もアカウントも要らない。
 */
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { Linking, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useModels } from './src/ai/useModels';
import { useAiBridge } from './src/bridge/useAiBridge';
import { ModelSheet } from './src/screens/ModelSheet';
import { palette } from './src/theme';
import APP_HTML from './src/web/appHtml';

/** 画面の「場所」。localStorage（科目・計画・記録）はこの場所ごとに保存されるので変えないこと */
const BASE_URL = 'https://app.ai-study-planner.local/';

export default function App() {
  const scheme = useColorScheme();
  const c = palette(scheme);
  const webRef = useRef<WebView>(null);
  const models = useModels();
  const [sheet, setSheet] = useState(false);
  const openModels = useCallback(() => setSheet(true), []);
  const { onMessage, engine } = useAiBridge(webRef, { spec: models.spec, ready: models.ready, download: models.download, openModels });

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.paper }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <WebView
          ref={webRef}
          source={{ html: APP_HTML, baseUrl: BASE_URL }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          // 答案・目次の写真：<input type="file" capture> でカメラと写真の選択が開く
          allowFileAccess={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={false}
          bounces={false}
          overScrollMode="never"
          textZoom={100}
          style={{ flex: 1, backgroundColor: c.paper }}
          // 外のリンクはブラウザで開く（アプリの画面は替えない）
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === 'about:blank' || req.url.startsWith(BASE_URL) || req.url.startsWith('data:') || req.url.startsWith('blob:')) return true;
            void Linking.openURL(req.url);
            return false;
          }}
          // WebView が落ちたら（メモリ不足など）読み込み直す。記録は localStorage に残っている
          onContentProcessDidTerminate={() => webRef.current?.reload()}
          onRenderProcessGone={() => webRef.current?.reload()}
        />
        <ModelSheet visible={sheet} onClose={() => setSheet(false)} models={models} loadError={engine.error} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
