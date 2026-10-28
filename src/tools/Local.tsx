// "Add a plugin": paste a plugin's code (or import an .html file, or start from the blank one);
// once installed it is a tool of its own in the sidebar. The plugins run in PluginFrames.
import { useRef, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { BLANK, PLUGIN_PREFIX, nameOf, newId, plugins, setPlugins } from '../lib/plugins';
import type { ToolId } from '../i18n';

export default function Local() {
  const { T, toast, go } = useApp();
  const L = T.local;
  const [html, setHtml] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const install = () => {
    const p = { id: newId(), html };
    setPlugins([...plugins(), p]);
    toast(f(L.added, { n: nameOf(html) }));
    setHtml('');
    go(`${PLUGIN_PREFIX}${p.id}` as ToolId);
  };

  return (
    <div className="tool-stack local">
      <section className="card local-editor">
        <div className="card-head">
          <span style={{ fontWeight: 600 }}>{L.paste}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={() => file.current?.click()}>{L.import}</button>
            <button className="btn sm" onClick={() => setHtml(BLANK)}>{L.blank}</button>
          </span>
          <input ref={file} type="file" accept=".html,.htm,text/html" hidden
            onChange={async (e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) setHtml(await fl.text()); }} />
        </div>
        <textarea className="area mono" value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} aria-label={L.codeLabel} placeholder={L.pastePh} />
        <div className="local-editor-btns">
          <button className="btn inv" disabled={!html.trim()} onClick={install}>{html.trim() ? f(L.installAs, { n: nameOf(html) }) : L.install}</button>
        </div>
      </section>
      <section className="card local-intro">
        <p>{L.intro}</p>
        <p>{L.isolation}</p>
        <p className="local-proxy">{L.proxy} <code>{L.proxyCmd}</code> {L.proxyThen}</p>
      </section>
    </div>
  );
}
