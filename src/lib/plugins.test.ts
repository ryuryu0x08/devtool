import { describe, expect, it } from 'vitest';
import { TEMPLATE, at, numPaths, parseDef, read, type DashDef } from './plugins';

const REPLY = {
  code: 0, message: 'OK', ttl: 1,
  data: {
    valid: true, client_id: 83, nick_name: 'mingzi', name: 'mingzipinyin', message: 'Token is valid', balance: 925.000445, version: '',
    daily_usage: 121.12999405, daily_limit: 200, daily_percent: 60.564997025, overflow_limit: 100, overflow_usage: 0, overflow_percent: 0, overflow_available: 0,
    pool_limit: 6000, pool_usage: 6016.158957199999, pool_percent: 100, user_monthly_limit: 0, user_monthly_usage: 0, user_monthly_percent: 0,
    user_weekly_limit: 0, user_weekly_usage: 0, user_weekly_percent: 0,
  },
};
const def = (): DashDef => { const r = parseDef(TEMPLATE); if (!('def' in r)) throw new Error(r.errors.join('; ')); return r.def; };

describe('local plugins', () => {
  it('the template is a valid dashboard', () => {
    const d = def();
    expect(d.interval).toBe(60);
    expect(d.ok).toHaveLength(2);
    expect(numPaths(d)).toContain('data.pool_usage');
  });
  it('lists every problem with where it is', () => {
    const r = parseDef('{"type":"dash","url":"ftp://x","interval":3,"bars":[{"label":"a","used":"x"}, 5],"ok":{"path":"code"}}');
    expect('errors' in r && r.errors).toEqual([
      'type: expected "dashboard"', 'name: expected a non-empty string', 'url: expected http:// or https://',
      'interval: expected a number of seconds, at least 10', 'ok[0]: expected { "path": …, "equals": … }',
      'bars[0].limit: expected a non-empty string', 'bars[1]: expected an object',
    ]);
    expect(parseDef('{oops')).toMatchObject({ errors: [expect.stringMatching(/^JSON: /)] });
    expect(parseDef('{"type":"dashboard","name":"n","url":"http://x"}')).toEqual({ errors: ['values / bars / trends: show at least one'] });
  });
  it('reads a reply: numbers by path, the title, success by the checks', () => {
    const r = read(def(), 200, REPLY, 5);
    expect(r).toMatchObject({ at: 5, ok: true, title: 'mingzi' });
    expect(r.values['data.daily_usage']).toBe(121.12999405);
    expect(r.values['data.user_weekly_limit']).toBe(0);
    expect(at(REPLY, 'data.missing.x')).toBeUndefined();
  });
  it('a failed check or HTTP status is an error, with the reply’s own message', () => {
    expect(read(def(), 200, { code: 401, message: 'invalid token', data: null }, 0)).toMatchObject({ ok: false, error: 'invalid token' });
    expect(read(def(), 200, { ...REPLY, data: { ...REPLY.data, valid: false }, message: '' }, 0)).toMatchObject({ ok: false, error: 'data.valid = false' });
    expect(read(def(), 500, { message: 'boom' }, 0)).toMatchObject({ ok: false, error: 'HTTP 500: boom' });
    // A value that isn't a number is "no value", not 0.
    expect(read(def(), 200, { ...REPLY, data: { ...REPLY.data, balance: '925' } }, 0).values['data.balance']).toBeNull();
  });
});
