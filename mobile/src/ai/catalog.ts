/**
 * 端末内AIのモデル一覧（すべて Apache-2.0 で、アプリに組み込んで配布・商用利用できる）
 *
 * Qwen3-VL は文章と写真の両方を1つのモデルで扱える。llama.cpp（llama.rn 0.12 以降）で動く。
 * ファイルは初回だけダウンロードし、端末の中（アプリの書類フォルダ）に置く。
 * 大きさは Hugging Face の表示（2026年10月）をもとにした目安。確認は実際のファイルの大きさで行う。
 */
export type ModelFile = {
  /** 端末に保存するファイル名 */
  name: string;
  url: string;
  /** 目安の大きさ（バイト） */
  bytes: number;
};

export type ModelSpec = {
  id: 'qwen3vl-2b' | 'qwen3vl-4b';
  label: string;
  short: string;
  description: string;
  license: string;
  source: string;
  /** これより少ないメモリの端末では、選べるが注意を出す（GB） */
  minRamGB: number;
  model: ModelFile;
  mmproj: ModelFile;
  /** 文脈の長さ（トークン）。指示＋返事がこれに収まるようにする */
  contextSize: number;
  /** 写真1枚を何トークンまでに縮めて読むか（多いほど細かく読めるが遅くなる） */
  imageMaxTokens: number;
};

const HF = 'https://huggingface.co';

export const MODELS: ModelSpec[] = [
  {
    id: 'qwen3vl-2b',
    label: '標準（Qwen3-VL 2B）',
    short: 'Qwen3-VL 2B',
    description: '多くのスマホで動きます。文章も写真も扱えます。',
    license: 'Apache-2.0',
    source: 'Qwen/Qwen3-VL-2B-Instruct-GGUF',
    minRamGB: 4,
    model: {
      name: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf',
      url: `${HF}/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf`,
      bytes: 1_110_000_000,
    },
    mmproj: {
      name: 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf',
      url: `${HF}/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
      bytes: 445_000_000,
    },
    contextSize: 6144,
    imageMaxTokens: 640,
  },
  {
    id: 'qwen3vl-4b',
    label: '高精度（Qwen3-VL 4B）',
    short: 'Qwen3-VL 4B',
    description: 'メモリ8GB以上の端末向け。解説や採点が少し正確になりますが、遅くなります。',
    license: 'Apache-2.0',
    source: 'Qwen/Qwen3-VL-4B-Instruct-GGUF',
    minRamGB: 8,
    model: {
      name: 'Qwen3VL-4B-Instruct-Q4_K_M.gguf',
      url: `${HF}/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf`,
      bytes: 2_500_000_000,
    },
    mmproj: {
      name: 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf',
      url: `${HF}/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf`,
      bytes: 454_000_000,
    },
    contextSize: 6144,
    imageMaxTokens: 768,
  },
];

export const DEFAULT_MODEL_ID: ModelSpec['id'] = 'qwen3vl-2b';

export function findModel(id: string | null | undefined): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

export function totalBytes(spec: ModelSpec): number {
  return spec.model.bytes + spec.mmproj.bytes;
}

/** 1.56 GB のような表示 */
export function formatBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + ' GB';
  if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
  return Math.max(0, Math.round(n / 1e3)) + ' KB';
}
