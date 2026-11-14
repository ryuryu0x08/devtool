import { describe, expect, it } from 'vitest';
import { parseConnection } from './connection';

const TOKEN = 'Tk0_example-token-for-tests-only-0123456789';

describe('parseConnection', () => {
  it('reads the link bmitmproxy serve prints', () => {
    expect(parseConnection(`http://localhost:5173/#proxy?api=http%3A%2F%2F127.0.0.1%3A18081&token=${TOKEN}`))
      .toEqual({ api: 'http://127.0.0.1:18081', token: TOKEN });
    expect(parseConnection(`  https://public-pages.ryuryu.fun/#proxy?token=${TOKEN}\n`)).toEqual({ token: TOKEN });
  });
  it('takes the token alone', () => {
    expect(parseConnection(` ${TOKEN} `)).toEqual({ token: TOKEN });
  });
  it('leaves other text alone', () => {
    for (const t of ['hello', '{"a":1}', 'abc123', `#proxy?token=bad token`, `http://x/#proxy?api=javascript:alert(1)&token=${TOKEN}`, `http://x/#proxy?api=http://a.b/path&token=${TOKEN}`]) {
      expect(parseConnection(t), t).toBeNull();
    }
  });
});
