// LLM chat tester, against stand-in endpoints (no real API is called): streaming, multi-turn
// history, Markdown, usage, errors, stop, and where the key goes and stays.
import type { Page, Request, Route } from '@playwright/test';
import { expect, open, test } from './helpers';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sse = (events: [string | null, unknown][]) => events.map(([ev, d]) => (ev ? `event: ${ev}\n` : '') + `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`).join('');

const anthropicReply = (text: string, thinking = '') => sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
  ...(thinking ? [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ] as [string, unknown][] : []),
  ['content_block_start', { type: 'content_block_start', index: thinking ? 1 : 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: thinking ? 1 : 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: thinking ? 1 : 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const openaiReply = (text: string) => sse([
  [null, { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }],
  [null, { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }],
  [null, { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }],
  [null, { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }],
  [null, '[DONE]'],
]);

/** Answers each POST to `path` with the next body; records the requests. */
async function endpoint(page: Page, path: string, bodies: (string | ((r: Route) => Promise<void>))[]) {
  const seen: Request[] = [];
  await page.route('https://api.test.example/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!req.url().endsWith(path)) return route.fulfill({ status: 404, headers: CORS, body: '' });
    seen.push(req);
    const b = bodies.shift() ?? '';
    if (typeof b === 'function') return b(route);
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: b });
  });
  return seen;
}

async function setup(page: Page, provider: 'Anthropic' | 'OpenAI 兼容', base: string) {
  await open(page, '大模型对话测试');
  await page.locator('.seg button', { hasText: provider }).click();
  await page.getByLabel('接口地址').fill(base);
  await page.getByLabel('API Key').fill('sk-test-123');
  await page.getByLabel('模型').fill(provider === 'Anthropic' ? 'claude-opus-5-5' : 'gpt-test');
}
const box = (page: Page) => page.getByLabel('输入消息，Enter 发送，Shift+Enter 换行');
const say = async (page: Page, text: string) => { await box(page).fill(text); await box(page).press('Enter'); };

test('Anthropic: streams Markdown, shows usage and timing; the next turn sends the history back, thinking included', async ({ page }) => {
  const seen = await endpoint(page, '/v1/messages', [anthropicReply('Hello **world**\n\n```json\n{"a": 1}\n```', 'let me think'), anthropicReply('Second')]);
  await setup(page, 'Anthropic', 'https://api.test.example');
  await say(page, 'hi');
  const reply = page.locator('.llm-msg.assistant').first();
  await expect(reply.locator('strong')).toHaveText('world');
  await expect(reply.locator('pre .hl-key')).toHaveText('"a"');
  await expect(reply.locator('.llm-think summary')).toHaveText('思考过程');
  await expect(reply.locator('.llm-meta')).toContainText('输入 12 · 输出 5 tokens');
  await expect(reply.locator('.llm-meta')).toContainText('结束原因：end_turn');
  await expect(reply.locator('.llm-meta')).toContainText('首字');
  const h = await seen[0].allHeaders();
  // Not the official host: the key goes as both headers (a relay may read only x-api-key).
  expect(h['authorization']).toBe('Bearer sk-test-123');
  expect(h['x-api-key']).toBe('sk-test-123');
  expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(seen[0].postDataJSON()).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 8192, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  await say(page, 'again');
  await expect(page.locator('.llm-msg.assistant').nth(1)).toContainText('Second');
  const second = seen[1].postDataJSON();
  expect(second.messages).toHaveLength(3);
  expect(second.messages[1].role).toBe('assistant');
  expect(second.messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: 'let me think', signature: 'sig' });
  expect(second.messages[2]).toEqual({ role: 'user', content: 'again' });
  // The reply itself copies its text.
  await reply.locator('.md').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Hello **world**');
});

test('OpenAI-compatible: bearer key, system prompt first, usage from the last chunk', async ({ page }) => {
  const seen = await endpoint(page, '/v1/chat/completions', [openaiReply('Hi there')]);
  await setup(page, 'OpenAI 兼容', 'https://api.test.example/v1');
  await page.locator('.llm-sys summary').click();
  await page.getByLabel('系统提示词').fill('Be brief.');
  await say(page, 'hello');
  const reply = page.locator('.llm-msg.assistant').first();
  await expect(reply).toContainText('Hi there');
  await expect(reply.locator('.llm-meta')).toContainText('输入 7 · 输出 3 tokens');
  await expect(reply.locator('.llm-meta')).toContainText('结束原因：stop');
  expect((await seen[0].allHeaders())['authorization']).toBe('Bearer sk-test-123');
  const body = seen[0].postDataJSON();
  expect(body.messages).toEqual([{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hello' }]);
  expect(body.stream_options).toEqual({ include_usage: true });
  expect(body.max_tokens).toBeUndefined();
});

test('errors say what happened: HTTP status with the endpoint’s message; an unreachable endpoint (or CORS) is named; retry sends again', async ({ page }) => {
  const seen = await endpoint(page, '/v1/messages', [
    async (r) => r.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) }),
    async (r) => r.abort('failed'),
    anthropicReply('ok now'),
  ]);
  await setup(page, 'Anthropic', 'https://api.test.example');
  await say(page, 'hi');
  await expect(page.locator('.llm-err')).toHaveText('HTTP 401：invalid x-api-key');
  // A new message after a failure: the failed reply is not sent, the question before it is.
  await say(page, 'second');
  await expect(page.locator('.llm-err').last()).toContainText('CORS');
  expect(seen[1].postDataJSON().messages).toEqual([{ role: 'user', content: 'hi' }, { role: 'user', content: 'second' }]);
  // Regenerate replaces the failed reply.
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect(page.locator('.llm-msg.assistant')).toHaveCount(2);
  await expect(page.locator('.llm-msg.assistant').last()).toContainText('ok now');
  await expect(page.locator('.llm-msg.user')).toHaveCount(2);
});

test('stop ends a reply that is still coming', async ({ page }) => {
  await endpoint(page, '/v1/messages', [async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.fulfill({ status: 200, headers: CORS, body: '' }).catch(() => {}); }]);
  await setup(page, 'Anthropic', 'https://api.test.example');
  await say(page, 'hi');
  await page.getByRole('button', { name: '停止' }).click();
  await expect(page.locator('.llm-msg.assistant .llm-warn')).toHaveText('已停止');
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
});

test('the key is not stored unless asked; settings are; nothing is sent without a key and a model', async ({ page }) => {
  await open(page, '大模型对话测试');
  await expect(box(page)).toHaveAttribute('placeholder', '先填写 API Key');
  await page.getByLabel('API Key').fill('sk-keep');
  await expect(box(page)).toHaveAttribute('placeholder', '先填写模型名');
  await page.getByLabel('模型').fill('claude-opus-5-5');
  await page.reload();
  await expect(page.getByLabel('模型')).toHaveValue('claude-opus-5-5');
  await expect(page.getByLabel('API Key')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-keep');
  await page.getByLabel('API Key').fill('sk-keep');
  await page.getByText('记住 key（存在本机浏览器）').click();
  await page.reload();
  await expect(page.getByLabel('API Key')).toHaveValue('sk-keep');
  // Turning it off forgets the stored key.
  await page.getByText('记住 key（存在本机浏览器）').click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-keep');
});

test('the official Anthropic host (the default) gets the key as Authorization only', async ({ page }) => {
  let headers: Record<string, string> = {};
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    headers = await route.request().allHeaders();
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicReply('ok') });
  });
  await open(page, '大模型对话测试');
  await page.getByLabel('API Key').fill('sk-official');
  await page.getByLabel('模型').fill('claude-opus-5-5');
  await say(page, 'hi');
  await expect(page.locator('.llm-msg.assistant')).toContainText('ok');
  expect(headers['authorization']).toBe('Bearer sk-official');
  expect(headers['x-api-key']).toBeUndefined();
});
