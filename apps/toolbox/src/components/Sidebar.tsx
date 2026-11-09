import { CATS, CAT_ORDER } from '../i18n';
import { useTools } from './useTools';
import { useApp, type Theme } from '../store';
import { LogoGlyph } from './Logo';

/** A gear: the settings page. */
function Gear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { light: 'dark', dark: 'auto', auto: 'light' };

export function useChrome() {
  const { S, set, T, lang } = useApp();
  return {
    toggleSide: () => set((s) => ({ side: !s.side })),
    toggleSettings: () => set((s) => ({ settings: !s.settings, palette: false })),
    openPalette: () => set({ palette: true, pq: '', pi: 0 }),
    toggleLang: () => set({ lang: lang === 'zh' ? 'en' : 'zh' }),
    cycleTheme: () => set((s) => ({ theme: NEXT_THEME[s.theme] })),
    langBtn: lang === 'zh' ? 'EN' : '中',
    themeShort: T.theme[S.theme],
    themeTitle: T.themeLong[S.theme],
  };
}

export function Sidebar() {
  const { S, T, lang, isMac, go } = useApp();
  const c = useChrome();
  const tools = useTools();
  const nav = CAT_ORDER.map((cat) => ({ cat, name: CATS[cat][lang], items: tools.filter((x) => x.cat === cat) }));

  return (
    <aside className="side" style={{ width: S.side ? 232 : 64 }}>
      {S.side ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 211 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 2px 14px 8px' }}>
            <span className="logo" style={{ width: 26, height: 26, borderRadius: 7 }}><LogoGlyph /></span>
            <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{T.brand}</span>
            <button className="ghost" onClick={c.toggleSide} aria-label={T.collapse} title={T.collapse + (isMac ? '  ⌘B' : '  Ctrl+B')}
              style={{ width: 30, height: 30, borderRadius: 7, color: 'var(--faint)', fontSize: 16, lineHeight: 1 }}>«</button>
          </div>
          <button className="search-btn" onClick={c.openPalette}>
            <span>{T.search}</span><span className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
          </button>
          <nav style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto', margin: '0 -4px', padding: '0 4px' }}>
            {nav.map((g) => (
              <div key={g.cat} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ padding: '16px 10px 6px', fontSize: 11, fontWeight: 500, color: 'var(--faint)', letterSpacing: '.04em' }}>{g.name}</div>
                {g.items.map((it) => (
                  <button key={it.id} className={'nav-item' + (it.id === S.tool && !S.settings ? ' on' : '')} onClick={() => go(it.id)}>
                    <span className="ticon" style={{ width: 24, height: 24 }}>{it.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it[lang][0]}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <button className={'side-link' + (S.settings ? ' on' : '')} onClick={c.toggleSettings} aria-pressed={S.settings}>
              <span className="ticon" style={{ width: 24, height: 24 }}><Gear /></span>
              <span>{T.settings}</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', gap: 6, width: 43 }}>
          <button className="logo" onClick={c.toggleSide} aria-label={T.expand} title={T.expand + (isMac ? '  ⌘B' : '  Ctrl+B')}
            style={{ width: 32, height: 32, border: 0, borderRadius: 8, cursor: 'pointer', margin: '0 0 8px', padding: 0 }}><LogoGlyph /></button>
          <button className="search-btn mono" onClick={c.openPalette} title={T.search}
            style={{ width: 40, height: 34, padding: 0, justifyContent: 'center', color: 'var(--mut)', fontSize: 10.5, fontWeight: 500 }}>
            {isMac ? '⌘K' : '^K'}
          </button>
          {nav.map((g) => (
            <div key={g.cat} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 40, paddingTop: 8, marginTop: 4, borderTop: '1px solid var(--line)' }}>
              {g.items.map((it) => (
                <button key={it.id} className={'rail-item' + (it.id === S.tool && !S.settings ? ' on' : '')} onClick={() => go(it.id)} title={it[lang][0]}>
                  <span className="ticon" style={{ width: 26, height: 26, borderRadius: 7 }}>{it.icon}</span>
                </button>
              ))}
            </div>
          ))}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <button className={'rail-item side-link' + (S.settings ? ' on' : '')} onClick={c.toggleSettings} aria-pressed={S.settings} aria-label={T.settings} title={T.settings}>
              <span className="ticon" style={{ width: 26, height: 26, borderRadius: 7 }}><Gear /></span>
            </button>
            <button className="ghost" onClick={c.toggleSide} aria-label={T.expand} title={T.expand + (isMac ? '  ⌘B' : '  Ctrl+B')}
              style={{ width: 44, height: 30, borderRadius: 8, color: 'var(--faint)', fontSize: 16 }}>»</button>
          </div>
        </div>
      )}
    </aside>
  );
}

export function MobileBar() {
  const { S, T, lang, go } = useApp();
  const c = useChrome();
  const tools = useTools();
  const tool = tools.find((x) => x.id === S.tool) || tools[0];
  return (
    <div className="mbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 14px' }}>
        <span className="logo" style={{ width: 28, height: 28, borderRadius: 8 }}><LogoGlyph /></span>
        <span style={{ fontWeight: 600, fontSize: 16, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool[lang][0]}</span>
        <button className="mbtn" onClick={c.toggleLang}>{c.langBtn}</button>
        <button className="mbtn" onClick={c.cycleTheme}>{c.themeShort}</button>
        <button className="btn" onClick={c.openPalette} style={{ height: 44, padding: '0 14px', borderRadius: 10 }}>{T.searchShort}</button>
      </div>
      <div className="chips">
        {tools.map((x) => (
          <button key={x.id} className={'chip' + (x.id === S.tool ? ' on' : '')} onClick={() => go(x.id)}>{x[lang][1]}</button>
        ))}
      </div>
    </div>
  );
}
