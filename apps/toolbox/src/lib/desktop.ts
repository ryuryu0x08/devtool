// The desktop app's bridge (apps/toolbox/desktop/preload.cjs): which system it runs on, and where
// to send the title bar's colours. Absent in a browser.
interface Desktop { platform: string; titleBar(bg: string, fg: string): void }

export const desktop: Desktop | null = (window as unknown as { toolboxDesktop?: Desktop }).toolboxDesktop ?? null;

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
