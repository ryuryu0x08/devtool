import { CATS, CAT_ORDER, TOOLS, f } from '../i18n';
import { useApp, type Theme } from '../store';
import { Seg } from './Seg';

const NEXT_THEME: Record<Theme, Theme> = { light: 'dark', dark: 'auto', auto: 'light' };

export function useChrome() {
  const { S, set, T, lang } = useApp();
  return {
    toggleSide: () => set((s) => ({ side: !s.side })),
    openPalette: () => set({ palette: true, pq: '', pi: 0 }),
    toggleLang: () => set({ lang: lang === 'zh' ? 'en' : 'zh' }),
    cycleTheme: () => set((s) => ({ theme: NEXT_THEME[s.theme] })),
    langBtn: lang === 'zh' ? 'EN' : '中',
    themeShort: T.theme[S.theme],
    themeTitle: T.themeLong[S.theme],
  };
}

export function Sidebar() {
  const { S, set, T, lang, isMac, go } = useApp();
  const c = useChrome();
  const nav = CAT_ORDER.map((cat) => ({ cat, name: CATS[cat][lang], items: TOOLS.filter((x) => x.cat === cat) }));

  return (
    <aside className="side" style={{ width: S.side ? 232 : 64 }}>
      {S.side ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 211 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 2px 14px 8px' }}>
            <span className="logo" style={{ width: 26, height: 26, borderRadius: 7 }}>TB</span>
            <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{T.brand}</span>
            <button className="ghost" onClick={c.toggleSide} title={T.collapse}
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
                  <button key={it.id} className={'nav-item' + (it.id === S.tool ? ' on' : '')} onClick={() => go(it.id)}>
                    <span className="ticon" style={{ width: 24, height: 24 }}>{it.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it[lang][0]}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12 }}>
            <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, lineHeight: 1.55, color: 'var(--mut)' }}>
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{T.smartTitle}</div>
              {f(T.smartBody, { k: isMac ? '⌘V' : 'Ctrl+V' })}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Seg size="sm" value={lang} onChange={(l) => set({ lang: l })} opts={[{ value: 'zh', label: '中' }, { value: 'en', label: 'EN' }]} />
              <Seg size="sm" value={S.theme} onChange={(th) => set({ theme: th })}
                opts={[{ value: 'light', label: T.theme.light }, { value: 'dark', label: T.theme.dark }, { value: 'auto', label: T.theme.auto }]} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', gap: 6, width: 43 }}>
          <button className="logo" onClick={c.toggleSide} title={T.expand}
            style={{ width: 32, height: 32, border: 0, borderRadius: 8, cursor: 'pointer', margin: '0 0 8px' }}>TB</button>
          <button className="search-btn mono" onClick={c.openPalette} title={T.search}
            style={{ width: 40, height: 34, padding: 0, justifyContent: 'center', color: 'var(--mut)', fontSize: 10.5, fontWeight: 500 }}>
            {isMac ? '⌘K' : '^K'}
          </button>
          {nav.map((g) => (
            <div key={g.cat} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 40, paddingTop: 8, marginTop: 4, borderTop: '1px solid var(--line)' }}>
              {g.items.map((it) => (
                <button key={it.id} className={'rail-item' + (it.id === S.tool ? ' on' : '')} onClick={() => go(it.id)} title={it[lang][0]}>
                  <span className="ticon" style={{ width: 26, height: 26, borderRadius: 7 }}>{it.icon}</span>
                </button>
              ))}
            </div>
          ))}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <button className="rail-btn" onClick={c.toggleLang} title="中 / EN">{c.langBtn}</button>
            <button className="rail-btn" onClick={c.cycleTheme} title={c.themeTitle}>{c.themeShort}</button>
            <button className="ghost" onClick={c.toggleSide} title={T.expand}
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
  const tool = TOOLS.find((x) => x.id === S.tool) || TOOLS[0];
  return (
    <div className="mbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 14px' }}>
        <span className="logo" style={{ width: 28, height: 28, borderRadius: 8 }}>TB</span>
        <span style={{ fontWeight: 600, fontSize: 16, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool[lang][0]}</span>
        <button className="mbtn" onClick={c.toggleLang}>{c.langBtn}</button>
        <button className="mbtn" onClick={c.cycleTheme}>{c.themeShort}</button>
        <button className="btn" onClick={c.openPalette} style={{ height: 44, padding: '0 14px', borderRadius: 10 }}>{T.searchShort}</button>
      </div>
      <div className="chips">
        {TOOLS.map((x) => (
          <button key={x.id} className={'chip' + (x.id === S.tool ? ' on' : '')} onClick={() => go(x.id)}>{x[lang][1]}</button>
        ))}
      </div>
    </div>
  );
}
