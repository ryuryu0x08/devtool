// The desktop app's runner of capture backends (apps/toolbox/desktop/capture.cjs) as the proxy tool
// uses it: each ask answers, or throws a LaunchError carrying the app's code for what went wrong
// (the page puts it in the user's words). And, for a backend that runs, the page's side of it.
import { desktop, type CaptureBridge, type CaptureFailure, type CaptureReply, type CaptureState } from '../desktop';
import type { ProxyBackend } from './backend';
import { MitmproxyBackend } from './mitmproxy';

export class LaunchError extends Error {
  constructor(readonly failure: CaptureFailure) {
    super(failure.code);
    this.name = 'LaunchError';
  }
}

async function unwrap<T>(p: Promise<CaptureReply<T>>): Promise<T> {
  const r = await p;
  if (r.ok) return r.value;
  throw new LaunchError(r.error);
}

export function makeLauncher(c: CaptureBridge) {
  return {
    backends: () => unwrap(c.backends()),
    get: () => unwrap(c.get()),
    defaultEntry: (backend: string) => unwrap(c.defaultEntry(backend)),
    inspect: (backend: string, entry: string) => unwrap(c.inspect(backend, entry)),
    fix: (backend: string, entry: string) => unwrap(c.fix(backend, entry)),
    find: (backend: string, entry: string) => unwrap(c.find(backend, entry)),
    start: (backend: string, entry: string) => unwrap(c.start(backend, entry)),
    stop: () => unwrap(c.stop()),
    checkProxy: () => unwrap(c.checkProxy()),
    onEvent: c.onEvent,
  };
}

export type Launcher = ReturnType<typeof makeLauncher>;

/** Null outside the desktop app (where the tool isn't offered). */
export const launcher: Launcher | null = desktop?.capture ? makeLauncher(desktop.capture) : null;

/** The page's side of each backend the app can run, by the backend's id. */
const SIDES: Record<string, (api: string, token: string) => ProxyBackend> = {
  bmitmproxy: (api, token) => new MitmproxyBackend(api, token),
};

/** The backend that runs now, to talk to; null while none is on. */
export function backendFor(s: CaptureState): ProxyBackend | null {
  if (s.state !== 'on' || !s.backend || !s.api || !s.token) return null;
  return Object.hasOwn(SIDES, s.backend) ? SIDES[s.backend](s.api, s.token) : null;
}
