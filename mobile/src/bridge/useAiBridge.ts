/**
 * WebView（今の画面）と端末内AIをつなぐフック
 *
 *  Web → ここ：ai.run / ai.stop / ui.models / hello（文字列の JSON。request.ts で形を確かめる）
 *  ここ → Web：window.__nativeBridge.receive({...}) を injectJavaScript で呼ぶ
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';
import type WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ModelSpec } from '../ai/catalog';
import { LocalAI, type EngineState } from '../ai/localAI';
import { BridgeError, createThrottle, parseBridgeMessage } from '../ai/request';
import type { DownloadState } from '../ai/useModels';

type Options = {
  spec: ModelSpec | null;
  ready: boolean;
  download: DownloadState | null;
  openModels: () => void;
};

export function useAiBridge(webRef: RefObject<WebView | null>, { spec, ready, download, openModels }: Options) {
  const [engine, setEngine] = useState<EngineState>({ loaded: false, busy: false, error: null });
  const ai = useRef<LocalAI | null>(null);
  if (!ai.current) ai.current = new LocalAI(setEngine);
  const specRef = useRef(spec);
  specRef.current = spec;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const post = useCallback(
    (msg: object) => {
      webRef.current?.injectJavaScript(`window.__nativeBridge&&window.__nativeBridge.receive(${JSON.stringify(msg)});true;`);
    },
    [webRef],
  );

  // 画面に知らせる状態（設定の「端末のAI」に出す）
  const status = useMemo(
    () => ({
      ready,
      downloaded: ready,
      loaded: engine.loaded,
      busy: engine.busy,
      downloading: !!download && !download.error,
      progress: download?.progress?.ratio ?? 0,
      label: spec?.short ?? null,
      modelId: spec?.id ?? null,
      vision: true,
      platform: Platform.OS,
    }),
    [ready, engine.loaded, engine.busy, download, spec],
  );
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    post({ t: 'status', status });
  }, [post, status]);

  // アプリが裏に回ったら、モデルを外してメモリを空ける（動かしている最中は外さない）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') void ai.current?.release();
    });
    const mem = AppState.addEventListener('memoryWarning', () => {
      void ai.current?.release();
    });
    return () => {
      sub.remove();
      mem.remove();
    };
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseBridgeMessage(e.nativeEvent.data);
      if (!m) return;
      if (m.t === 'hello') {
        post({ t: 'status', status: statusRef.current });
        return;
      }
      if (m.t === 'ui.models') {
        openModels();
        return;
      }
      if (m.t === 'ai.stop') {
        void ai.current?.stop(m.id);
        return;
      }
      // ai.run
      const s = specRef.current;
      if (!s || !readyRef.current) {
        post({ t: 'ai.error', id: m.id, code: 'model_missing', message: 'AIのモデルがまだ入っていません。' });
        openModels();
        return;
      }
      const throttle = createThrottle((text) => post({ t: 'ai.text', id: m.id, text }));
      ai.current!
        .run(s, m, (text) => throttle.push(text))
        .then((r) => {
          throttle.flush();
          post({ t: 'ai.done', id: m.id, text: r.text, truncated: r.truncated, stats: r.stats });
        })
        .catch((err: BridgeError) => {
          post({ t: 'ai.error', id: m.id, code: err?.code ?? 'unavailable', message: err?.message ?? '' });
        });
    },
    [openModels, post],
  );

  // モデルを消したり替えたりしたら、読み込んでいたものは外す
  useEffect(() => {
    if (!ready) void ai.current?.release();
  }, [ready, spec?.id]);

  return { onMessage, engine };
}
