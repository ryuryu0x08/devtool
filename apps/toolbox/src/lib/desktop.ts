// The desktop app's bridge (apps/toolbox/desktop/preload.cjs): which system it runs on, where to
// send the title bar's colours, the app's updates, and Proxy & Capture's backend. Absent in a
// browser. Also where a tool is offered (some only in the desktop app, on some systems).

/** The desktop app's update (see apps/toolbox/desktop/main.cjs). */
export interface UpdateState {
  state: 'unsupported' | 'idle' | 'checking' | 'none' | 'available' | 'building' | 'ready' | 'failed';
  /** Why it can't update itself: not macOS, or not built by build.sh from a git clone. */
  reason: 'platform' | 'not-built-here' | null;
  commit: string | null;
  built: string | null;
  auto: boolean;
  /** New commits that change the app; the newest one's subject. */
  count: number;
  subject: string | null;
  error: string | null;
}

interface Updates {
  get(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  restart(): Promise<UpdateState>;
  setAuto(on: boolean): Promise<UpdateState>;
  /** Called on each change; returns the unsubscribe. */
  onState(fn: (s: UpdateState) => void): () => void;
}

/** Proxy & Capture's backend as the desktop app runs it (apps/toolbox/desktop/capture.cjs). */
export interface CaptureState {
  state: 'off' | 'starting' | 'on' | 'stopping';
  backend: string | null;
  entry: string | null;
  pid: number | null;
  /** Started by this app (rather than found running). */
  owned: boolean;
  api: string | null;
  token: string | null;
  proxyPort: number | null;
  version: string | null;
  /** How the last one ended. */
  exit: CaptureExit | null;
}

export interface CaptureExit {
  reason: 'stopped' | 'exited' | 'gone' | 'timeout' | 'failed';
  pid: number | null;
  code?: number | null;
  signal?: string | null;
  error?: string;
  /** The last lines it printed. */
  tail?: string;
}

/** A fix the app can make to an entry before starting it (the driver's fix). */
export type EntryFix = 'reinstall' | 'setuptools';

/** An entry, checked without running it. */
export interface EntryCheck {
  status: 'ok' | 'missing' | 'not-executable' | 'unknown' | 'outdated' | 'needs-fix';
  version?: string | null;
  reason?: 'not-python' | 'probe-failed' | 'not-bmitmproxy' | 'no-distutils';
  tail?: string;
  /** Where pipx installed it from. */
  source?: string | null;
  /** needs-fix: what the app will do, in turn. */
  fixes?: EntryFix[];
}

/** One half (web: HTTP, secure: HTTPS) of a network service's proxy, put back as it was. */
export interface Repaired { service: string; kind: 'web' | 'secure' }
export interface RepairResult { repaired: Repaired[]; failed?: (Repaired & { error: string })[] }

export interface CaptureBackend { id: string; name: string; download: boolean }

/** What went wrong, by the app's code (the page words it), with its details. */
export interface CaptureFailure { code: string; [detail: string]: unknown }

export type CaptureReply<T> = { ok: true; value: T } | { ok: false; error: CaptureFailure };

export type CaptureEvent =
  | { type: 'state'; state: CaptureState }
  | { type: 'system-proxy' }
  | { type: 'log'; line: string }
  /** A fix beginning. */
  | { type: 'progress'; what: EntryFix }
  /** What a backend left pointing at itself, put back. */
  | { type: 'repaired'; items: Repaired[]; failed?: RepairResult['failed'] };

export interface StartResult { outcome: 'started' | 'attached' | 'already'; state: CaptureState; warnings: CaptureFailure[] }

export interface CaptureBridge {
  backends(): Promise<CaptureReply<CaptureBackend[]>>;
  get(): Promise<CaptureReply<CaptureState>>;
  defaultEntry(backend: string): Promise<CaptureReply<string | null>>;
  inspect(backend: string, entry: string): Promise<CaptureReply<EntryCheck>>;
  fix(backend: string, entry: string): Promise<CaptureReply<EntryCheck>>;
  find(backend: string, entry: string): Promise<CaptureReply<CaptureState>>;
  start(backend: string, entry: string): Promise<CaptureReply<StartResult>>;
  stop(): Promise<CaptureReply<{ outcome: 'stopped' | 'not-running'; pid?: number } & Partial<RepairResult>>>;
  /** The system proxy looked at again: what the backend left behind once it put things back. */
  checkProxy(): Promise<CaptureReply<RepairResult>>;
  /** Called on each change as it happens; returns the unsubscribe. */
  onEvent(fn: (e: CaptureEvent) => void): () => void;
}

interface Desktop { platform: string; titleBar(bg: string, fg: string): void; update?: Updates; capture?: CaptureBridge }

export const desktop: Desktop | null = (window as unknown as { toolboxDesktop?: Desktop }).toolboxDesktop ?? null;

/** Where a tool is offered: everywhere (no `only`), or only in the desktop app on these systems. */
export interface Only { desktop: ('darwin' | 'win32' | 'linux')[] }

export const offered = (t: { only?: Only }) => !t.only || (!!desktop && (t.only.desktop as string[]).includes(desktop.platform));

/** In the desktop app, html gets "desktop" and "desktop-<system>": the styles draw a title bar strip. */
export function markDesktop() {
  if (desktop) document.documentElement.classList.add('desktop', 'desktop-' + desktop.platform);
}

/** The title bar takes the theme's background and text colours. */
export function tintTitleBar() {
  if (!desktop) return;
  const css = getComputedStyle(document.documentElement);
  desktop.titleBar(css.getPropertyValue('--bg').trim(), css.getPropertyValue('--ink').trim());
}
