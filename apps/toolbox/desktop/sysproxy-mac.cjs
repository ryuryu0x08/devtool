// The system's proxy settings on macOS, per network service, as networksetup reads and writes them
// (an administrator's account needs no password for it). capture.cjs uses it to put back what a
// backend left pointing at itself; it changes only the setting it is given.
const { execFile } = require('node:child_process');

const NETWORKSETUP = '/usr/sbin/networksetup';
const TIMEOUT_MS = 15_000;
/** networksetup's name for each half: HTTP (web) and HTTPS (secure). */
const FLAG = { web: 'web', secure: 'secureweb' };

function networksetup(args) {
  return new Promise((resolve, reject) => {
    // SIGKILL: one that hangs may not answer SIGTERM, and its output would never close.
    execFile(NETWORKSETUP, args, { timeout: TIMEOUT_MS, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) reject(new Error(`networksetup ${args.join(' ')}: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** "Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\n…" */
function parse(out) {
  const field = (name) => new RegExp(`^${name}: *(.*)$`, 'm').exec(out)?.[1]?.trim() ?? '';
  return { enabled: field('Enabled') === 'Yes', host: field('Server'), port: Number(field('Port')) || 0 };
}

/** The network services in use (the first line says what the list is; a * marks one turned off). */
async function services() {
  const out = await networksetup(['-listallnetworkservices']);
  return out.split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('*'));
}

async function read(service) {
  const [web, secure] = await Promise.all([networksetup(['-getwebproxy', service]), networksetup(['-getsecurewebproxy', service])]);
  return { web: parse(web), secure: parse(secure) };
}

/** One half of a service set to `v`, as it was: its server and port, then off if it was off. */
async function set(service, kind, v) {
  const flag = FLAG[kind];
  if (!flag) throw new Error('no such proxy setting: ' + kind);
  if (v.host) await networksetup([`-set${flag}proxy`, service, v.host, String(v.port)]);
  if (!v.enabled) await networksetup([`-set${flag}proxystate`, service, 'off']);
}

module.exports = { services, read, set, parse };
