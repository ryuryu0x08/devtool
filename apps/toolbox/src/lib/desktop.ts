// The desktop app's bridge (apps/toolbox/desktop/preload.cjs): which system it runs on, where to
// send the title bar's colours, and the app's updates. Absent in a browser. Also where a tool is
// offered (a tool can be offered only in the desktop app, on some systems).

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

interface Desktop { platform: string; titleBar(bg: string, fg: string): void; update?: Updates }

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
