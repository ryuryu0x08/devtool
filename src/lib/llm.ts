// Chat with an OpenAI-compatible or Anthropic endpoint, straight from the browser (the user's key
// goes only to the endpoint they entered). Streams the reply and reports timing and token usage.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type Provider = 'anthropic' | 'openai';

export const DEFAULT_BASE: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

export interface LlmConfig {
  provider: Provider;
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  /** Required by Anthropic; for OpenAI-compatible endpoints 0 sends none. */
  maxTokens: number;
}

export interface Stats {
  /** Time to the first streamed text or thinking, and to the end (ms). */
  firstMs?: number;
  totalMs: number;
  inTokens?: number;
  outTokens?: number;
  /** Why the reply ended, as the endpoint said it (end_turn, stop, max_tokens, length, refusal…). */
  stop?: string;
  /** The model that answered, when the endpoint says. */
  model?: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  /** Anthropic: the reply's content blocks, sent back as they are on the next turn (thinking blocks
   *  must be, unchanged). Absent when the reply was stopped or failed. */
  blocks?: unknown[];
  stats?: Stats;
  /** The reply ended early: stopped by the user, refused, or failed. */
  stopped?: boolean;
  refused?: boolean;
  error?: LlmError;
}

export type LlmError =
  | { kind: 'connect'; detail: string }
  | { kind: 'http'; status: number; detail: string }
  | { kind: 'other'; detail: string };

export interface Delta { text?: string; thinking?: string }

/** The turns to send: a failed reply is left out (the question before it stays). */
const sendable = (turns: Turn[]) => turns.filter((t) => t.role === 'user' || (!t.error && (t.text || t.blocks?.length)));

export function toError(e: unknown): LlmError {
  const conn = e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError;
  if (conn) return { kind: 'connect', detail: String((e as Error).message ?? '') };
  if ((e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) && typeof e.status === 'number') {
    const body = (e as { error?: unknown }).error;
    const msg = (body as { error?: { message?: string }; message?: string } | undefined)?.error?.message
      ?? (body as { message?: string } | undefined)?.message ?? e.message;
    return { kind: 'http', status: e.status, detail: String(msg ?? '') };
  }
  return { kind: 'other', detail: String((e as Error)?.message ?? e) };
}

export const isAbort = (e: unknown) => e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError
  || (e instanceof Error && e.name === 'AbortError');

/** The SDK sends the key as "Authorization: Bearer"; a relay or gateway in front of another base URL
 *  may read only "x-api-key", so it gets that too. No retries: a tester shows each failure. */
function anthropic(cfg: LlmConfig) {
  const baseURL = cfg.baseURL || DEFAULT_BASE.anthropic;
  const official = baseURL.replace(/\/+$/, '') === DEFAULT_BASE.anthropic;
  return new Anthropic({ apiKey: cfg.apiKey, baseURL, dangerouslyAllowBrowser: true, maxRetries: 0, ...(official ? {} : { defaultHeaders: { 'x-api-key': cfg.apiKey } }) });
}

/** Streams the assistant's reply to `turns` (which end with the user's message). `onDelta` gets
 *  text as it arrives. Resolves with the finished turn; a stop or an error comes back on the turn. */
export async function reply(cfg: LlmConfig, turns: Turn[], onDelta: (d: Delta) => void, signal: AbortSignal): Promise<Turn> {
  const t0 = performance.now();
  let first: number | undefined;
  let text = '', thinking = '';
  const got = (d: Delta) => {
    if (first === undefined) first = performance.now() - t0;
    if (d.text) text += d.text;
    if (d.thinking) thinking += d.thinking;
    onDelta(d);
  };
  const done = (more: Omit<Partial<Turn>, 'stats'> & { stats?: Partial<Stats> }): Turn => ({
    role: 'assistant', text, ...(thinking ? { thinking } : {}), ...more,
    stats: { firstMs: first, totalMs: performance.now() - t0, ...more.stats },
  });
  try {
    if (cfg.provider === 'anthropic') {
      const client = anthropic(cfg);
      const stream = client.messages.stream({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        ...(cfg.system.trim() ? { system: cfg.system } : {}),
        messages: sendable(turns).map((t) => (t.role === 'user'
          ? { role: 'user' as const, content: t.text }
          : { role: 'assistant' as const, content: (t.blocks as Anthropic.ContentBlockParam[] | undefined) ?? t.text })),
      }, { signal });
      for await (const ev of stream) {
        if (ev.type !== 'content_block_delta') continue;
        if (ev.delta.type === 'text_delta') got({ text: ev.delta.text });
        else if (ev.delta.type === 'thinking_delta') got({ thinking: ev.delta.thinking });
      }
      const m = await stream.finalMessage();
      return done({
        blocks: m.content as unknown[],
        refused: m.stop_reason === 'refusal',
        stats: { inTokens: m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0), outTokens: m.usage.output_tokens, stop: m.stop_reason ?? undefined, model: m.model },
      });
    }
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || DEFAULT_BASE.openai, dangerouslyAllowBrowser: true, maxRetries: 0 });
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(cfg.system.trim() ? [{ role: 'system' as const, content: cfg.system }] : []),
      ...sendable(turns).map((t) => ({ role: t.role, content: t.text })),
    ];
    const stream = await client.chat.completions.create({
      model: cfg.model, messages, stream: true, stream_options: { include_usage: true },
      ...(cfg.maxTokens > 0 ? { max_tokens: cfg.maxTokens } : {}),
    }, { signal });
    let stop: string | undefined, model: string | undefined, usage: OpenAI.CompletionUsage | undefined, refusal = '';
    for await (const chunk of stream) {
      model ??= chunk.model || undefined;
      if (chunk.usage) usage = chunk.usage;
      const ch = chunk.choices?.[0];
      if (!ch) continue;
      // Some compatible endpoints (DeepSeek and others) stream reasoning as `reasoning_content`.
      const d = ch.delta as { content?: string | null; refusal?: string | null; reasoning_content?: string | null };
      if (d.reasoning_content) got({ thinking: d.reasoning_content });
      if (d.content) got({ text: d.content });
      if (d.refusal) { refusal += d.refusal; got({ text: d.refusal }); }
      if (ch.finish_reason) stop = ch.finish_reason;
    }
    return done({
      refused: !!refusal || stop === 'content_filter',
      stats: { inTokens: usage?.prompt_tokens, outTokens: usage?.completion_tokens, stop, model },
    });
  } catch (e) {
    if (isAbort(e)) return done({ stopped: true });
    return done({ stopped: true, error: toError(e) });
  }
}

/** The models the endpoint lists (at most 500). */
export async function listModels(cfg: LlmConfig): Promise<string[]> {
  const out: string[] = [];
  if (cfg.provider === 'anthropic') {
    const client = anthropic(cfg);
    for await (const m of client.models.list()) { out.push(m.id); if (out.length >= 500) break; }
  } else {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || DEFAULT_BASE.openai, dangerouslyAllowBrowser: true, maxRetries: 0 });
    for await (const m of client.models.list()) { out.push(m.id); if (out.length >= 500) break; }
  }
  return out;
}
