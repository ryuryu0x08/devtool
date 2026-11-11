// The settings page: language, appearance and the tool area's text size; in the desktop app, its
// updates too. Opened from the bottom of the sidebar; choosing a tool leaves it.
import { useEffect, useState } from 'react';
import { desktop, type UpdateState } from '../lib/desktop';
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
        {desktop?.update && <UpdateRows />}
      </div>
    </section>
  );
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/** The desktop app's update: what's running, the state, the one action that fits it; automatic or not. */
function UpdateRows() {
  const { T } = useApp();
  const U = T.up;
  const api = desktop!.update!;
  const [u, setU] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    api.get().then((s) => live && setU(s));
    const off = api.onState(setU);
    return () => {
      live = false;
      off();
    };
  }, [api]);
  if (!u) return null;
  if (u.state === 'unsupported') {
    return (
      <div className="settings-row" data-update="unsupported">
        <span className="settings-k">{U.k}</span>
        <span className="settings-sub">{u.reason === 'platform' ? U.platform : U.notBuiltHere}</span>
      </div>
    );
  }
  const status = {
    idle: U.idle, checking: U.checking, none: U.none, building: U.building, ready: U.ready,
    available: fill(U.available, { n: u.count, s: u.subject ?? '' }),
    failed: fill(U.failed, { e: u.error ?? '' }),
  }[u.state];
  const busy = u.state === 'checking' || u.state === 'building';
  const action =
    u.state === 'available' ? <button className="btn sm" onClick={() => api.install()}>{U.install}</button>
    : u.state === 'ready' ? <button className="btn sm" onClick={() => api.restart()}>{U.restart}</button>
    : <button className="btn sm" disabled={busy} onClick={() => api.check()}>{u.state === 'failed' ? U.retry : U.check}</button>;
  return (
    <>
      <div className="settings-row" data-update={u.state}>
        <span className="settings-k">{U.k}</span>
        <div className="settings-update">
          <span className="settings-update-status">{status}</span>
          {u.commit && <span className="settings-sub">{fill(U.version, { c: u.commit.slice(0, 7), d: u.built ? new Date(u.built).toLocaleString() : '?' })}</span>}
        </div>
        {action}
      </div>
      <div className="settings-row">
        <span className="settings-k">{U.autoK}</span>
        <Seg value={u.auto ? 'on' : 'off'} onChange={(v) => api.setAuto(v === 'on')} opts={[{ value: 'off', label: U.off }, { value: 'on', label: U.on }]} />
        <span className="settings-sub">{U.autoSub}</span>
      </div>
    </>
  );
}
