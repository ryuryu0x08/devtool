// The settings page: language, appearance and the tool area's text size. Opened from the bottom
// of the sidebar; choosing a tool leaves it.
import { useApp } from '../store';
import { Seg } from './Seg';
import { ZoomControl } from './Zoom';

export function Settings() {
  const { S, set, T, lang } = useApp();
  return (
    <section className="card settings">
      <div className="card-head"><span>{T.settings}</span></div>
      <div className="settings-rows">
        <div className="settings-row">
          <span className="settings-k">{T.setLang}</span>
          <Seg value={lang} onChange={(l) => set({ lang: l })} opts={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
        </div>
        <div className="settings-row">
          <span className="settings-k">{T.setTheme}</span>
          <Seg value={S.theme} onChange={(th) => set({ theme: th })}
            opts={[{ value: 'light', label: T.themeLong.light }, { value: 'dark', label: T.themeLong.dark }, { value: 'auto', label: T.themeLong.auto }]} />
        </div>
        <div className="settings-row">
          <span className="settings-k">{T.setZoom}</span>
          <ZoomControl />
          <span className="settings-sub">{T.setZoomSub}</span>
        </div>
      </div>
    </section>
  );
}
