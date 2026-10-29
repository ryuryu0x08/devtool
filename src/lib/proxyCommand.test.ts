import { execFileSync, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ProxyTargetError, proxyCommand } from './proxyCommand';

describe('local forwarder command', () => {
  it('runs as pasted: python3 -c with the whole script, the target and the origin', async () => {
    const { command, local } = await proxyCommand('http://10.0.0.5:8080/api/v1/billing/usage?x=1', 8799, 'http://public-pages.ryuryu.fun:8081');
    expect(local).toBe('http://127.0.0.1:8799/api/v1/billing/usage?x=1');
    expect(command).toMatch(/^python3 -c "import zlib,base64;exec\(zlib\.decompress\(base64\.b64decode\('[A-Za-z0-9+/=]+'\)\)\)" "http:\/\/10\.0\.0\.5:8080" --port 8799 --origin "http:\/\/public-pages\.ryuryu\.fun:8081"$/);
    expect(command.length).toBeLessThan(4000);
    // Pasted into a shell: --help comes from the real script.
    const help = execFileSync('bash', ['-c', command.replace(/ "http:\/\/10.*$/, ' --help')]).toString();
    expect(help).toContain("Forward the toolbox's requests to an API that has no CORS.");
  });

  it('the pasted command serves: answers the preflight for the toolbox and refuses other sites', async () => {
    const { command } = await proxyCommand('http://127.0.0.1:9', 8798, 'http://toolbox.test');
    const p = spawn('bash', ['-c', command]);
    try {
      await new Promise<void>((res, rej) => { p.stdout.on('data', (d) => { if (String(d).includes('Forwarding')) res(); }); p.on('exit', () => rej(new Error('exited'))); });
      const pre = await fetch('http://127.0.0.1:8798/x', { method: 'OPTIONS', headers: { Origin: 'http://toolbox.test', 'Access-Control-Request-Method': 'GET' } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('http://toolbox.test');
      const other = await fetch('http://127.0.0.1:8798/x', { headers: { Origin: 'http://elsewhere.test' } });
      expect(other.status).toBe(403);
      // The target is down: 502 with the reason.
      const down = await fetch('http://127.0.0.1:8798/x', { headers: { Origin: 'http://toolbox.test' } });
      expect(down.status).toBe(502);
      expect((await down.json()).proxy_error).toMatch(/^cannot reach http:\/\/127\.0\.0\.1:9/);
    } finally { p.kill(); }
  });

  it('refuses what it can’t put in a command safely', async () => {
    await expect(proxyCommand('ftp://x', 8787, 'http://a')).rejects.toBeInstanceOf(ProxyTargetError);
    await expect(proxyCommand('nope', 8787, 'http://a')).rejects.toBeInstanceOf(ProxyTargetError);
    await expect(proxyCommand('http://x', 70000, 'http://a')).rejects.toBeInstanceOf(ProxyTargetError);
  });
});
