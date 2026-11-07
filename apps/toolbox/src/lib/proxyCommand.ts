// The local forwarder (scripts/local-proxy.py) as one line to paste into a terminal: the script,
// zlib-compressed and base64-encoded, run with python -c. Works in bash, zsh, cmd and PowerShell.
import script from '../../scripts/local-proxy.py?raw';

export const DEFAULT_PORT = 8787;

async function zlibB64(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class ProxyTargetError extends Error {}

/** `target` is the API's address (any path is dropped: the forwarder forwards every path). The
 *  command forwards http://127.0.0.1:<port> to it, for pages from `origin`; `local` is `target`
 *  with its origin swapped for the forwarder's, to call instead. */
export async function proxyCommand(target: string, port: number, origin: string, python = 'python3') {
  let u: URL;
  try { u = new URL(target); } catch { throw new ProxyTargetError('not a URL: ' + target); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ProxyTargetError('expected http:// or https://');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProxyTargetError('port: 1–65535');
  // Arguments in double quotes: the same in every shell; these characters can't appear in them.
  for (const s of [u.origin, origin]) if (/["`$%!^\\]/.test(s)) throw new ProxyTargetError('unexpected character in ' + s);
  const code = `import zlib,base64;exec(zlib.decompress(base64.b64decode('${await zlibB64(script)}')))`;
  const local = `http://127.0.0.1:${port}${u.pathname}${u.search}`;
  return { command: `${python} -c "${code}" "${u.origin}" --port ${port} --origin "${origin}"`, local };
}
