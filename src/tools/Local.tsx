// Local plugins: the user's own pages (HTML + JS), kept in this browser only. This is the toolbar
// and the code editor; the plugins themselves run in PluginFrames, which App keeps mounted so they
// keep running whichever tool is shown.
import { useEffect, useReducer, useRef, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { download, useOpt } from '../components/Panes';
import { TEMPLATES, nameOf, newId, plugins, removePlugin, setEditing, setPlugins, subscribe } from '../lib/plugins';

export default function Local() {
  const { T, toast } = useApp();
  const L = T.local;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(bump), []);
  const list = plugins();
  const [sel, setSel] = useOpt<string>('local.sel', '');
  const cur = list.find((p) => p.id === sel) ?? list[0];
  /** The code being edited: of a new plugin (id null) or of the current one. */
  const [draft, setDraft] = useState<{ id: string | null; html: string } | null>(null);
  const [sure, setSure] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setEditing(draft !== null); }, [draft]);
  useEffect(() => () => setEditing(false), []);

  const add = (html: string) => {
    const p = { id: newId(), html };
    setPlugins([...plugins(), p]);
    setSel(p.id);
    setDraft(null);
    toast(f(L.added, { n: nameOf(html) }));
  };
  const save = () => {
    if (!draft) return;
    if (draft.id === null) add(draft.html);
    else { setPlugins(plugins().map((p) => (p.id === draft.id ? { ...p, html: draft.html } : p))); setDraft(null); }
  };
  const importFile = async (fl: File | undefined) => {
    if (!fl) return;
    const html = await fl.text();
    setDraft({ id: null, html });
  };

  return (
    <div className="tool-stack local">
      <div className="toolbar">
        {list.length > 0 && <Seg value={cur?.id ?? ''} onChange={(v) => { setSel(v); setDraft(null); setSure(false); }} opts={list.map((p) => ({ value: p.id, label: nameOf(p.html) }))} />}
        <span className="sep" />
        <button className="btn" onClick={() => setDraft({ id: null, html: TEMPLATES.blank })}>＋ {L.create}</button>
        <button className="btn" onClick={() => setDraft({ id: null, html: TEMPLATES.quota })}>{L.template}</button>
        <button className="btn" onClick={() => file.current?.click()}>{L.import}</button>
        <input ref={file} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="spacer" />
        {cur && !draft && <>
          <button className="btn" onClick={() => setDraft({ id: cur.id, html: cur.html })}>{L.edit}</button>
          <button className="btn" onClick={() => download(new TextEncoder().encode(cur.html), nameOf(cur.html) + '.html', 'text/html')}>{L.export}</button>
        </>}
      </div>
      {!list.length && !draft && <section className="card local-intro"><p>{L.intro}</p><p>{L.isolation}</p><p className="local-proxy">{L.proxy} <code>{L.proxyCmd}</code> {L.proxyThen}</p></section>}
      {draft && (
        <section className="card local-editor">
          <div className="card-head"><span style={{ fontWeight: 600 }}>{draft.id === null ? L.newCode : f(L.code, { n: nameOf(draft.html) })}</span><span className="local-hint">{L.isolation}</span></div>
          <textarea className="area mono" value={draft.html} onChange={(e) => setDraft({ ...draft, html: e.target.value })} spellCheck={false} aria-label={L.codeLabel} />
          <div className="local-editor-btns">
            <button className="btn inv" disabled={!draft.html.trim()} onClick={save}>{draft.id === null ? L.install : L.save}</button>
            <button className="btn" onClick={() => { setDraft(null); setSure(false); }}>{L.cancel}</button>
            <span className="spacer" />
            {draft.id !== null && <button className="btn danger" onClick={() => {
              if (!sure) { setSure(true); return; }
              removePlugin(draft.id!);
              setDraft(null);
              setSure(false);
            }}>{sure ? L.removeAsk : L.remove}</button>}
          </div>
        </section>
      )}
    </div>
  );
}
