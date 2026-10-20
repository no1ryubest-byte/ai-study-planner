/**
 * 端末内AI（llama.rn）を動かす係
 *
 *  ・最初に頼まれたときにモデルを読み込み、そのまま持っておく（読み込みは数秒〜十数秒）
 *  ・一度に動かすのは1つだけ。ほかの依頼は順番を待つ
 *  ・止める（stop）、アプリが裏に回ったらメモリを空ける（release）
 */
import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import type { ModelSpec } from './catalog';
import { modelPaths } from './modelFiles';
import { hasLlamaNative, NO_NATIVE_MESSAGE } from './native';
import { BridgeError, buildCompletion, checkRequest, wasTruncated, type RunRequest } from './request';

export type EngineState = { loaded: boolean; busy: boolean; error: string | null };
export type RunResult = { text: string; truncated: boolean; stats: { tokens: number; ms: number; tps: number } };
type Job = {
  req: RunRequest;
  onText: (text: string) => void;
  resolve: (r: RunResult) => void;
  reject: (e: BridgeError) => void;
};

/** 読み込みの設定。メモリを抑える順に試す（量子化した KV キャッシュは、端末によって使えないことがある） */
function contextAttempts(spec: ModelSpec) {
  const gpu = Platform.OS === 'ios' ? 99 : 0; // Android は機種差が大きいので CPU で動かす
  return [
    { n_ctx: spec.contextSize, n_gpu_layers: gpu, cache_type_k: 'q8_0' as const, cache_type_v: 'q8_0' as const, flash_attn_type: 'auto' as const },
    { n_ctx: 4096, n_gpu_layers: gpu, cache_type_k: 'q8_0' as const, flash_attn_type: 'off' as const },
    { n_ctx: 4096, n_gpu_layers: 0, flash_attn_type: 'off' as const },
  ];
}

export class LocalAI {
  private ctx: LlamaContext | null = null;
  private loadedId: string | null = null;
  private loading: Promise<LlamaContext> | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private onState: (s: EngineState) => void;
  /** 直近の読み込みエラー（画面に出す） */
  lastError: string | null = null;

  constructor(onState: (s: EngineState) => void = () => {}) {
    this.onState = onState;
  }

  get isLoaded() {
    return !!this.ctx;
  }
  get isBusy() {
    return !!this.current || this.queue.length > 0;
  }

  private emit() {
    this.onState({ loaded: !!this.ctx, busy: this.isBusy, error: this.lastError });
  }

  /** モデルを読み込む（同じモデルなら何もしない） */
  async load(spec: ModelSpec): Promise<LlamaContext> {
    if (this.ctx && this.loadedId === spec.id) return this.ctx;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await this.unload();
      if (!hasLlamaNative()) {
        this.lastError = NO_NATIVE_MESSAGE;
        throw new BridgeError('model_load_failed', NO_NATIVE_MESSAGE);
      }
      const files = modelPaths(spec);
      let lastError: unknown = null;
      for (const attempt of contextAttempts(spec)) {
        try {
          const ctx = await initLlama({ model: files.model.uri, use_mlock: false, ctx_shift: false, n_batch: 512, ...attempt });
          const vision = await ctx
            .initMultimodal({ path: files.mmproj.uri, use_gpu: Platform.OS === 'ios', image_max_tokens: spec.imageMaxTokens })
            .catch(() => false);
          if (!vision) console.warn('[LocalAI] 写真を読む部分（mmproj）を読み込めませんでした。文章だけで動きます。');
          this.ctx = ctx;
          this.loadedId = spec.id;
          this.lastError = null;
          return ctx;
        } catch (e) {
          lastError = e;
        }
      }
      this.lastError = String((lastError as Error)?.message ?? lastError ?? 'load failed');
      throw new BridgeError('model_load_failed', this.lastError);
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
      this.emit();
    }
  }

  /** メモリを空ける（動かしている最中は空けない） */
  async release(): Promise<void> {
    if (this.current || this.loading) return;
    await this.unload();
  }

  private async unload(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.loadedId = null;
    if (ctx) {
      try {
        await ctx.release();
      } catch {
        /* すでに解放済み */
      }
    }
    this.emit();
  }

  /** 依頼を順番に並べる */
  run(spec: ModelSpec, req: RunRequest, onText: (text: string) => void): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      try {
        checkRequest(req);
      } catch (e) {
        reject(e as BridgeError);
        return;
      }
      this.queue.push({ req, onText, resolve, reject });
      this.emit();
      void this.pump(spec);
    });
  }

  /** 止める：動かしている依頼なら途中で止め、待っている依頼なら外す */
  async stop(id: string): Promise<void> {
    const i = this.queue.findIndex((j) => j.req.id === id);
    if (i >= 0) {
      const [job] = this.queue.splice(i, 1);
      job.reject(new BridgeError('cancelled', '止めました。'));
      this.emit();
      return;
    }
    if (this.current?.req.id === id && this.ctx) await this.ctx.stopCompletion();
  }

  private async pump(spec: ModelSpec): Promise<void> {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.emit();
    const started = Date.now();
    try {
      const ctx = await this.load(spec);
      const params = buildCompletion(job.req);
      let text = '';
      const result = await ctx.completion(params, (data) => {
        // 書きながらの全文（accumulated_text がない版では token をつなぐ）
        text = typeof data.accumulated_text === 'string' ? data.accumulated_text : text + (data.token ?? '');
        job.onText(text);
      });
      const stopped = !!result.interrupted;
      const final = typeof result.content === 'string' && result.content.length ? result.content : result.text;
      const ms = Date.now() - started;
      const tokens = result.tokens_predicted ?? 0;
      if (stopped) job.reject(new BridgeError('cancelled', '止めました。'));
      else job.resolve({ text: final, truncated: wasTruncated(result), stats: { tokens, ms, tps: ms > 0 ? Math.round((tokens / ms) * 10000) / 10 : 0 } });
    } catch (e) {
      job.reject(e instanceof BridgeError ? e : new BridgeError('unavailable', String((e as Error)?.message ?? e)));
    } finally {
      this.current = null;
      this.emit();
      if (this.queue.length) void this.pump(spec);
    }
  }
}
