/**
 * WebView から届いた「AIを動かして」のメッセージを確かめ、llama.rn の completion() に渡す形にする。
 * 画面にも端末にも依存しない純粋な関数だけを置く（Node でテストできるよう、相対 import もしない）。
 */

export type Role = 'user' | 'assistant';
export type ChatTurn = { role: Role; content: string };

export type TaskName =
  | 'suggest_units'
  | 'session_advice'
  | 'explain'
  | 'problems'
  | 'grade_batch'
  | 'grade'
  | 'chat'
  | 'toc'
  | 'other';

export type RunRequest = {
  t: 'ai.run';
  id: string;
  mode: 'text' | 'json';
  task: TaskName;
  system: string;
  messages: ChatTurn[];
  /** data:image/...;base64,... */
  images: string[];
  schema: object | null;
};

export type BridgeIn =
  | { t: 'hello' }
  | RunRequest
  | { t: 'ai.stop'; id: string }
  | { t: 'ui.models' };

export const LIMITS = {
  maxImages: 2,
  maxImageChars: 8_000_000, // data URL（base64）で約6MBまで
  maxPromptChars: 60_000,
  maxTurns: 24,
  maxIdLength: 64,
};

const TASKS: TaskName[] = ['suggest_units', 'session_advice', 'explain', 'problems', 'grade_batch', 'grade', 'chat', 'toc', 'other'];

export class BridgeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** WebView から届いた文字列を確かめて、決まった形のメッセージにする（形が違えば null） */
export function parseBridgeMessage(raw: string): BridgeIn | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  if (m.t === 'hello' || m.t === 'ui.models') return { t: m.t };
  const id = typeof m.id === 'string' ? m.id.slice(0, LIMITS.maxIdLength) : '';
  if (m.t === 'ai.stop') return id ? { t: 'ai.stop', id } : null;
  if (m.t !== 'ai.run' || !id) return null;

  const messages: ChatTurn[] = (Array.isArray(m.messages) ? m.messages : [])
    .filter((x: any) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    .slice(-LIMITS.maxTurns)
    .map((x: any) => ({ role: x.role as Role, content: String(x.content) }));
  const images: string[] = (Array.isArray(m.images) ? m.images : [])
    .filter((u: any) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length <= LIMITS.maxImageChars)
    .slice(0, LIMITS.maxImages);
  return {
    t: 'ai.run',
    id,
    mode: m.mode === 'json' ? 'json' : 'text',
    task: TASKS.includes(m.task) ? m.task : 'other',
    system: typeof m.system === 'string' ? m.system : '',
    messages,
    images,
    schema: m.schema && typeof m.schema === 'object' && !Array.isArray(m.schema) ? m.schema : null,
  };
}

/** 指示の長さを確かめる（長すぎると端末のメモリに入らない） */
export function checkRequest(req: RunRequest): void {
  if (!req.messages.length || req.messages[req.messages.length - 1].role !== 'user') {
    throw new BridgeError('bad_request', '最後は利用者の発言にしてください。');
  }
  const chars = req.system.length + req.messages.reduce((n, x) => n + x.content.length, 0);
  if (chars > LIMITS.maxPromptChars) throw new BridgeError('too_long', '指示が長すぎます。');
}

type TaskParams = { n_predict: number; temperature: number };
/**
 * タスクごとの返事の長さ（トークン）と温度。小さいモデルは長く書かせるほど脱線しやすく遅いので、必要な長さに絞る。
 * 日本語はおおむね1トークン＝1〜1.5文字。
 */
const TASK_PARAMS: Record<TaskName, TaskParams> = {
  suggest_units: { n_predict: 700, temperature: 0.2 },
  session_advice: { n_predict: 260, temperature: 0.3 }, // コマ1つあたり（あとで掛ける）
  explain: { n_predict: 1000, temperature: 0.5 },
  problems: { n_predict: 1500, temperature: 0.6 },
  grade_batch: { n_predict: 900, temperature: 0.2 },
  grade: { n_predict: 500, temperature: 0.2 },
  chat: { n_predict: 600, temperature: 0.5 },
  toc: { n_predict: 1600, temperature: 0.1 },
  other: { n_predict: 800, temperature: 0.4 },
};

/** 進め方のタスクで、いくつのコマを聞いているか（<input> の JSON の "phase" の数） */
export function countSessions(text: string): number {
  return Math.max(1, (String(text).match(/"phase"\s*:/g) || []).length);
}

export type CompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

export type CompletionInput = {
  messages: CompletionMessage[];
  n_predict: number;
  temperature: number;
  top_k: number;
  top_p: number;
  min_p: number;
  penalty_repeat: number;
  penalty_present: number;
  enable_thinking: boolean;
  jinja: boolean;
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: { strict: boolean; schema: object } };
};

/** llama.rn の completion() に渡す引数を作る */
export function buildCompletion(req: RunRequest): CompletionInput {
  const messages: CompletionMessage[] = [];
  if (req.system.trim()) messages.push({ role: 'system', content: req.system });
  const last = req.messages.length - 1;
  req.messages.forEach((m, i) => {
    if (i === last && m.role === 'user' && req.images.length) {
      // 写真は文より前に置く（Qwen3-VL・Gemma のおすすめの並び）
      messages.push({
        role: 'user',
        content: [
          ...req.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          { type: 'text' as const, text: m.content },
        ],
      });
    } else messages.push({ role: m.role, content: m.content });
  });
  const p = TASK_PARAMS[req.task] ?? TASK_PARAMS.other;
  const lastText = req.messages[last]?.content ?? '';
  const nPredict = req.task === 'session_advice' ? Math.min(2400, 120 + p.n_predict * countSessions(lastText)) : p.n_predict;
  const json = req.mode === 'json';
  const out: CompletionInput = {
    messages,
    n_predict: nPredict,
    temperature: json ? Math.min(p.temperature, 0.3) : p.temperature,
    top_k: 20,
    top_p: 0.8,
    min_p: 0.05,
    penalty_repeat: json ? 1.0 : 1.05,
    penalty_present: json ? 0 : 0.5,
    enable_thinking: false,
    jinja: true,
  };
  // JSON の形は文法（grammar）で強制する。形が決まっているタスクはスキーマ、ほかは「JSONであること」だけ
  if (json) {
    out.response_format = req.schema
      ? { type: 'json_schema', json_schema: { strict: true, schema: req.schema } }
      : { type: 'json_object' };
  }
  return out;
}

/** 返事が途中で切れたか（長さの上限・文脈の上限） */
export function wasTruncated(r: { stopped_limit?: number | boolean; context_full?: boolean; stopped_eos?: boolean; stopped_word?: string }): boolean {
  return !!(r.context_full || (r.stopped_limit && !r.stopped_eos && !r.stopped_word));
}

/**
 * 書きながらの文字を、WebView へまとめて送るための間引き。
 * 1文字ずつ送ると WebView への橋渡しが詰まるので、一定の間隔ごとに最新の全文だけを送る。
 */
export function createThrottle(send: (text: string) => void, intervalMs = 120, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY; // 最初の1回はすぐ送る
  let pending: string | null = null;
  return {
    push(text: string) {
      pending = text;
      const t = now();
      if (t - last >= intervalMs) {
        last = t;
        send(text);
        pending = null;
      }
    },
    flush() {
      if (pending !== null) {
        send(pending);
        pending = null;
      }
    },
  };
}
