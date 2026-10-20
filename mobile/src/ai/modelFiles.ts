/**
 * モデルのファイル（端末の中）：ダウンロード・確認・削除と、選んだモデルの保存
 * expo-file-system の File / Directory / Paths を使う（SDK 56 以降の新しい API）。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { loadLlamaModelInfo } from 'llama.rn';
import { hasLlamaNative, NO_NATIVE_MESSAGE } from './native';
import { DEFAULT_MODEL_ID, findModel, MODELS, totalBytes, type ModelFile, type ModelSpec } from './catalog';

const dir = new Directory(Paths.document, 'models');
const settingsFile = new File(Paths.document, 'ai-settings.json');

function ensureDir() {
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
}

export function modelPaths(spec: ModelSpec) {
  return { model: new File(dir, spec.model.name), mmproj: new File(dir, spec.mmproj.name) };
}

/** 大きさが目安の9割以上あれば、ダウンロード済みとみなす（途中で切れたファイルを使わない） */
function complete(f: File, m: ModelFile): boolean {
  return f.exists && f.size >= m.bytes * 0.9;
}

export function isDownloaded(spec: ModelSpec): boolean {
  const p = modelPaths(spec);
  return complete(p.model, spec.model) && complete(p.mmproj, spec.mmproj);
}

/** 端末に入っているモデルの合計の大きさ */
export function usedBytes(): number {
  return MODELS.reduce((n, s) => {
    const p = modelPaths(s);
    return n + (p.model.exists ? p.model.size : 0) + (p.mmproj.exists ? p.mmproj.size : 0);
  }, 0);
}

export function freeBytes(): number {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export type DownloadProgress = { file: 'model' | 'mmproj'; received: number; total: number; ratio: number };

/**
 * 2つのファイル（本体と、写真を読む部分）を順にダウンロードする。
 * いったん .part に書き、終わってから正しい名前に移す（途中で止まったファイルを本物と取り違えない）。
 */
export async function downloadModel(spec: ModelSpec, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  ensureDir();
  const need = totalBytes(spec) - usedBytesOf(spec);
  if (need * 1.05 > freeBytes()) {
    throw Object.assign(new Error('空き容量が足りません。'), { code: 'no_space' });
  }
  const parts: Array<['model' | 'mmproj', ModelFile]> = [
    ['model', spec.model],
    ['mmproj', spec.mmproj],
  ];
  const all = totalBytes(spec);
  let done = 0;
  for (const [kind, m] of parts) {
    const target = new File(dir, m.name);
    if (complete(target, m)) {
      done += target.size;
      continue;
    }
    const part = new File(dir, m.name + '.part');
    if (part.exists) part.delete();
    if (target.exists) target.delete();
    const task = File.createDownloadTask(m.url, part, {
      signal,
      onProgress: ({ bytesWritten, totalBytes: t }) => {
        const total = t > 0 ? t : m.bytes;
        onProgress({ file: kind, received: bytesWritten, total, ratio: Math.min(1, (done + bytesWritten) / all) });
      },
    });
    const file = await task.downloadAsync();
    if (!file || signal?.aborted) {
      if (part.exists) part.delete();
      throw Object.assign(new Error('ダウンロードをやめました。'), { code: 'cancelled' });
    }
    if (part.size < m.bytes * 0.9) {
      part.delete();
      throw Object.assign(new Error('ダウンロードが途中で切れました。もう一度試してください。'), { code: 'incomplete' });
    }
    await part.move(target);
    done += target.size;
  }
  // 本当に GGUF のモデルか：先頭4バイトが "GGUF" かを自分で確かめる（壊れたファイル・エラーページを弾く）
  const p = modelPaths(spec);
  for (const f of [p.model, p.mmproj]) {
    const magic = await readMagic(f);
    if (magic !== 'GGUF') {
      deleteModel(spec);
      throw Object.assign(new Error(`ダウンロードしたファイルがモデルの形ではありませんでした（${f.uri.split('/').pop()}：${magic || '読めない'}）。もう一度試してください。`), { code: 'broken' });
    }
  }
  // llama.rn でも中身を読んでみる。ここで読めなくてもファイルは消さない（使うときに改めて読み込み、理由を表示する）
  if (!hasLlamaNative()) {
    lastInfoError = NO_NATIVE_MESSAGE;
    return;
  }
  try {
    await loadLlamaModelInfo(p.model.uri);
  } catch (e) {
    lastInfoError = String((e as Error)?.message ?? e);
    console.warn('[modelFiles] loadLlamaModelInfo:', lastInfoError);
  }
}

/** 直近の「モデルの情報を読めなかった」理由（画面に出す） */
export let lastInfoError: string | null = null;

async function readMagic(f: File): Promise<string> {
  try {
    const h = f.open();
    try {
      const bytes = await Promise.resolve(h.readBytes(4));
      return String.fromCharCode(...Array.from(bytes));
    } finally {
      h.close();
    }
  } catch {
    return '';
  }
}

function usedBytesOf(spec: ModelSpec): number {
  const p = modelPaths(spec);
  return (complete(p.model, spec.model) ? p.model.size : 0) + (complete(p.mmproj, spec.mmproj) ? p.mmproj.size : 0);
}

export function deleteModel(spec: ModelSpec): void {
  const p = modelPaths(spec);
  for (const f of [p.model, p.mmproj, new File(dir, spec.model.name + '.part'), new File(dir, spec.mmproj.name + '.part')]) {
    if (f.exists) f.delete();
  }
}

/* ---------- 選んだモデルの保存 ---------- */
export type AiSettings = { modelId: ModelSpec['id'] };

export async function loadSettings(): Promise<AiSettings> {
  try {
    if (!settingsFile.exists) return { modelId: DEFAULT_MODEL_ID };
    const s = JSON.parse(await settingsFile.text());
    return { modelId: findModel(s?.modelId).id };
  } catch {
    return { modelId: DEFAULT_MODEL_ID };
  }
}

export async function saveSettings(s: AiSettings): Promise<void> {
  try {
    if (!settingsFile.exists) settingsFile.create();
    await settingsFile.write(JSON.stringify(s));
  } catch {
    /* 保存できなくても、次に起動したとき標準のモデルになるだけ */
  }
}
