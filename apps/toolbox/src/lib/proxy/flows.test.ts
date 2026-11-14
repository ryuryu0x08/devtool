import { describe, expect, it } from 'vitest';
import { EMPTY, applyEvents, compileFilter, contentType, duration, formatDuration, formatSize, headText, state } from './flows';
import { toFlow } from './mitmproxy';
import { MITMWEB_FLOWS } from './mitmweb.fixture';

const [get, post, refused] = MITMWEB_FLOWS.map(toFlow);

describe('applyEvents', () => {
  it('adds, updates in place and removes', () => {
    let s = applyEvents(EMPTY, [{ type: 'upsert', flow: get }, { type: 'upsert', flow: post }]);
    expect(s.list.map((f) => f.id)).toEqual([get.id, post.id]);
    const done = { ...get, error: 'late' };
    s = applyEvents(s, [{ type: 'upsert', flow: done }]);
    expect(s.list[0].error).toBe('late');
    expect(s.list).toHaveLength(2);
    s = applyEvents(s, [{ type: 'remove', id: get.id }, { type: 'upsert', flow: refused }]);
    expect(s.list.map((f) => f.id)).toEqual([post.id, refused.id]);
    expect(s.index.get(refused.id)).toBe(1);
  });

  it('replaces everything on reset and keeps the changes after it', () => {
    const s = applyEvents(applyEvents(EMPTY, [{ type: 'upsert', flow: get }]), [{ type: 'reset', flows: [post] }, { type: 'upsert', flow: refused }]);
    expect(s.list.map((f) => f.id)).toEqual([post.id, refused.id]);
  });

  it('leaves the previous state alone', () => {
    const a = applyEvents(EMPTY, [{ type: 'upsert', flow: get }]);
    applyEvents(a, [{ type: 'upsert', flow: post }, { type: 'remove', id: get.id }]);
    expect(a.list.map((f) => f.id)).toEqual([get.id]);
    expect(EMPTY.list).toHaveLength(0);
    expect(applyEvents(a, [{ type: 'remove', id: 'unknown' }])).toBe(a);
  });
});

describe('compileFilter', () => {
  const pick = (q: string) => [get, post, refused].filter(compileFilter(q)).map((f) => f.method + ' ' + f.url);
  it('needs every word and none of the "-" ones', () => {
    expect(pick('')).toHaveLength(3);
    expect(pick('httpbin')).toEqual(['GET https://httpbin.org/json', 'POST http://httpbin.org/post?x=1']);
    expect(pick('HTTPBIN post')).toEqual(['POST http://httpbin.org/post?x=1']);
    expect(pick('httpbin -post')).toEqual(['GET https://httpbin.org/json']);
  });
  it('matches the status, the content type and the error', () => {
    expect(pick('200 json')).toHaveLength(2);
    expect(pick('refused')).toHaveLength(0);
    expect(pick('connect')).toEqual(['GET http://127.0.0.1:1/nothing']);
  });
});

it('describes a row', () => {
  expect(contentType(get)).toBe('application/json');
  expect(state(get)).toBe('ok');
  expect(state(refused)).toBe('error');
  expect(state({ ...get, response: { ...get.response!, status: 404 } })).toBe('client-error');
  expect(state({ ...get, response: null, error: null })).toBe('pending');
  expect(duration(get)).toBe(get.response!.end! - get.request!.start!);
  expect(duration(refused)).toBeNull();
});

it('formats sizes and durations', () => {
  expect(formatSize(429)).toBe('429 B');
  expect(formatSize(1536)).toBe('1.5 KB');
  expect(formatSize(200 * 1024 * 1024)).toBe('200 MB');
  expect(formatSize(null)).toBe('');
  expect(formatDuration(12.4)).toBe('12 ms');
  expect(formatDuration(2219)).toBe('2.22 s');
  expect(formatDuration(null)).toBe('');
});

it('writes the head as on the wire', () => {
  expect(headText(post, 'request').split('\n')[0]).toBe('POST /post?x=1 HTTP/1.1');
  expect(headText(get, 'response').split('\n').slice(0, 2)).toEqual(['HTTP/2.0 200', 'access-control-allow-credentials: true']);
  expect(headText(refused, 'response')).toBe('');
});
