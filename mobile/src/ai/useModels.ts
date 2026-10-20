/**
 * どのモデルを使うか・どれが入っているか・ダウンロードの進み具合を持つフック
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { findModel, MODELS, type ModelSpec } from './catalog';
import { deleteModel, downloadModel, isDownloaded, loadSettings, saveSettings, type DownloadProgress } from './modelFiles';

export type DownloadState = { id: ModelSpec['id']; progress: DownloadProgress | null; error: string | null };

export function useModels() {
  const [modelId, setModelId] = useState<ModelSpec['id'] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [download, setDownload] = useState<DownloadState | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    const m: Record<string, boolean> = {};
    for (const s of MODELS) m[s.id] = isDownloaded(s);
    setInstalled(m);
  }, []);

  useEffect(() => {
    loadSettings().then((s) => setModelId(s.modelId));
    refresh();
  }, [refresh]);

  const select = useCallback(async (id: ModelSpec['id']) => {
    setModelId(id);
    await saveSettings({ modelId: id });
  }, []);

  const start = useCallback(
    async (id: ModelSpec['id']) => {
      if (abort.current) return;
      const spec = findModel(id);
      const ctl = new AbortController();
      abort.current = ctl;
      setDownload({ id, progress: null, error: null });
      let shown = -1;
      try {
        await downloadModel(
          spec,
          (p) => {
            // 画面の更新は0.5%ごと（細かく更新すると重くなる）
            const step = Math.floor(p.ratio * 200);
            if (step === shown) return;
            shown = step;
            setDownload({ id, progress: p, error: null });
          },
          ctl.signal,
        );
        setDownload(null);
        await select(id);
      } catch (e: any) {
        setDownload(e?.code === 'cancelled' ? null : { id, progress: null, error: e?.message ?? 'ダウンロードできませんでした。' });
      } finally {
        abort.current = null;
        refresh();
      }
    },
    [refresh, select],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  const remove = useCallback(
    (id: ModelSpec['id']) => {
      deleteModel(findModel(id));
      refresh();
    },
    [refresh],
  );

  const spec = modelId ? findModel(modelId) : null;
  return {
    spec,
    modelId,
    installed,
    ready: !!spec && !!installed[spec.id],
    download,
    start,
    cancel,
    remove,
    select,
    refresh,
  };
}
