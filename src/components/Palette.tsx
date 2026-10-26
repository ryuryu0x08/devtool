import { CATS, TOOLS, f } from '../i18n';
import { useApp } from '../store';

interface Item { icon: string; name: string; crumb: string; run: () => void }

/** ⌘K command palette: search tools, or paste content to route it to the matching tool. */
export function Palette() {
  const { S, set, T, lang, go, detect, routeText, toolName } = useApp();
  const raw = S.pq;
  const q = raw.trim().toLowerCase();
  const items: Item[] = TOOLS
    .filter((t) => !q || (t.zh.join(' ') + ' ' + t.en.join(' ') + ' ' + t.kw + ' ' + CATS[t.cat].zh + ' ' + CATS[t.cat].en).toLowerCase().includes(q))
    .map((t) => ({ icon: t.icon, name: t[lang][0], crumb: CATS[t.cat][lang] + ' · ' + t[lang][2], run: () => go(t.id) }));
  if (q) {
    const d = detect(raw);
    if (d) {
      const tid = d === 'tm' ? 'ts' : d;
      items.unshift({ icon: '↵', name: f(T.palDetect, { t: toolName(tid) }), crumb: raw.trim().slice(0, 60), run: () => routeText(raw, true) });
    }
  }
  const pi = Math.min(S.pi, Math.max(0, items.length - 1));
  const close = () => set({ palette: false });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); set((s) => ({ pi: Math.min(items.length - 1, s.pi + 1) })); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); set((s) => ({ pi: Math.max(0, s.pi - 1) })); }
    else if (e.key === 'Enter') { e.preventDefault(); items[pi]?.run(); }
    else if (e.key === 'Escape') close();
  };

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 14px 14px' }}>
      <div onClick={(e) => e.stopPropagation()} className="pop" style={{ width: '100%', maxWidth: 580, borderRadius: 14, boxShadow: '0 24px 64px var(--shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 18px', borderBottom: '1px solid var(--line)' }}>
          <input autoFocus value={S.pq} onChange={(e) => set({ pq: e.target.value, pi: 0 })} onKeyDown={onKey} placeholder={T.pal}
            style={{ flex: 1, minWidth: 0, height: 56, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }} />
          <span className="kbd" style={{ padding: '3px 7px' }}>esc</span>
        </div>
        <div style={{ maxHeight: 'min(420px, 60vh)', overflow: 'auto', padding: 6 }}>
          {items.map((it, i) => {
            const on = i === pi;
            return (
              <button key={i} onClick={it.run} onMouseEnter={() => { if (S.pi !== i) set({ pi: i }); }} className="list-item"
                style={{ gap: 12, padding: '9px 12px', borderRadius: 10, background: on ? 'var(--sub)' : 'transparent' }}>
                <span className={'ticon' + (on ? ' on' : '')} style={{ width: 30, height: 30, borderRadius: 8, fontSize: 11.5 }}>{it.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{it.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.crumb}</span>
                </span>
                <span style={{ fontSize: 13, color: 'var(--mut)' }}>{on ? '↵' : ''}</span>
              </button>
            );
          })}
          {!items.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>{T.palNone}</div>}
        </div>
        <div style={{ padding: '9px 16px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--faint)' }}>{T.palFoot}</div>
      </div>
    </div>
  );
}
