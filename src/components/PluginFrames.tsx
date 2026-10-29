// Runs the local plugins: each in a sandboxed frame with an origin of its own (no allow-same-origin),
// so it can't read the toolbox, its storage or other tools' data. The frame gets a small `toolbox`
// object; its calls come here as messages and are answered here: network requests (made by the
// toolbox, so a local forwarder that allows only the toolbox's address works), the plugin's own
// storage, copy and toast. Every plugin keeps running while the page is open; each is a tool of its
// own in the sidebar ("p:<id>"), shown here with a bar to edit, export or delete it.
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import uplotJs from 'uplot/dist/uPlot.iife.min.js?raw';
import uplotCss from 'uplot/dist/uPlot.min.css?raw';
import { useApp } from '../store';
import { useZoom } from './Zoom';
import { delData, getData, nameOf, plugins, removePlugin, setData, setPlugins, subscribe, type Plugin } from '../lib/plugins';
import { download } from './Panes';
import { proxyCommand } from '../lib/proxyCommand';

const FETCH_MS = 30000;
/** The toolbox's colours, passed to the plugins as CSS variables. */
const VARS = ['--bg', '--card', '--sub', '--sel', '--line', '--line2', '--ink', '--mut', '--faint', '--acc', '--accInk', '--accSoft',
  '--str', '--num', '--bool', '--date', '--kw', '--add', '--addBg', '--del', '--delBg', '--chg', '--chgBg', '--shadow'];
const themeVars = () => {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, css.getPropertyValue(v).trim()]));
};

const KIT_CSS = `
:root { color-scheme: light dark; }
[hidden] { display: none !important; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 'Geist Sans', 'Geist', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif; }
body { padding: 2px; }
code, .mono { font-family: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.92em; }
a { color: var(--acc); }
.muted { color: var(--mut); font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
.btn { height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
.btn:hover { border-color: var(--line2); background: var(--sub); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.primary { background: var(--inv, var(--ink)); color: var(--bg); border-color: transparent; }
.btn.on { border-color: var(--acc); color: var(--acc); }
.btn.ghost { border-color: transparent; background: transparent; color: var(--faint); }
input, select, textarea { box-sizing: border-box; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); font: inherit; font-size: 13px; }
textarea { height: auto; padding: 8px 10px; }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--acc); }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--mut); }
`;

/** Inside the frame: `window.toolbox`, and the theme kept in step. */
const BRIDGE = `(() => {
  const pending = new Map(); let n = 0;
  const call = (op, args) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); parent.postMessage({ tbPlugin: 1, id, op, args }, '*'); });
  const theme = (vars) => { for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); };
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !d || !d.tbHost) return;
    if (d.theme) { theme(d.theme); dispatchEvent(new CustomEvent('toolbox-theme')); return; }
    const p = pending.get(d.id); if (!p) return; pending.delete(d.id);
    if (d.error) p.rej(new Error(d.error)); else p.res(d.result);
  });
  window.toolbox = {
    fetch: (url, init) => call('fetch', { url: String(url), init: init || {} }).then((r) => ({ ...r, json: () => JSON.parse(r.text) })),
    storage: { get: (k) => call('get', { k }), set: (k, v) => call('set', { k, v }), remove: (k) => call('del', { k }) },
    proxyCommand: (target, port, python) => call('proxyCommand', { target: String(target), port: port === undefined ? 8787 : Number(port), python: python === 'python' ? 'python' : 'python3' }),
    copy: (text) => call('copy', { text: String(text) }),
    toast: (text) => call('toast', { text: String(text) }),
  };
})();`;

const inline = (tag: 'script' | 'style', text: string) => `<${tag}>${text.replace(/<\/(script|style)/gi, '<\\/$1')}</${tag}>`;

/** The plugin's page with the bridge and the base styles first in <head>, and the libraries the
 *  toolbox supplies (`toolbox:uplot`, `toolbox:uplot.css`) inlined. */
export function buildDoc(html: string, vars: Record<string, string>) {
  const rootVars = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}';
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><base target="_blank">'
    + inline('style', rootVars + KIT_CSS) + inline('script', BRIDGE);
  const body = html
    .replace(/<script\s+src=["']toolbox:uplot["']\s*>\s*<\/script>/gi, () => inline('script', uplotJs))
    .replace(/<link\s+rel=["']stylesheet["']\s+href=["']toolbox:uplot\.css["']\s*\/?>/gi, () => inline('style', uplotCss));
  return /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + head) : head + body;
}

function Frame({ p, shown, height }: { p: Plugin; shown: boolean; height: number }) {
  // Built once per definition; later theme changes are sent as messages (a rebuild would restart it).
  const doc = useMemo(() => buildDoc(p.html, themeVars()), [p.html]);
  return (
    <iframe className="plugin-frame" data-plugin={p.id} title={p.id} srcDoc={doc} style={{ display: shown ? 'block' : 'none', height: height || 600 }}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" />
  );
}

/** The plugin's bar: its name, and edit / export / delete. Editing replaces the frame with its code. */
function PluginBar({ p, editing, onEdit }: { p: Plugin; editing: boolean; onEdit: (v: boolean) => void }) {
  const { T, go } = useApp();
  const L = T.local;
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [p.id]);
  return (
    <div className="plugin-bar">
      <span className="plugin-name">{nameOf(p.html)}</span>
      <span className="spacer" />
      {!editing && <button className="btn sm" onClick={() => onEdit(true)}>{L.edit}</button>}
      <button className="btn sm" onClick={() => download(new TextEncoder().encode(p.html), nameOf(p.html) + '.html', 'text/html')}>{L.export}</button>
      <button className={'btn sm' + (sure ? ' danger' : '')} onClick={() => {
        if (!sure) { setSure(true); return; }
        removePlugin(p.id);
        go('local');
      }} onBlur={() => setSure(false)}>{sure ? L.removeAsk : L.remove}</button>
    </div>
  );
}

function CodeEditor({ p, onDone }: { p: Plugin; onDone: () => void }) {
  const { T } = useApp();
  const L = T.local;
  const [html, setHtml] = useState(p.html);
  return (
    <section className="card local-editor">
      <textarea className="area mono" value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} aria-label={L.codeLabel} />
      <div className="local-editor-btns">
        <button className="btn inv" disabled={!html.trim()} onClick={() => { setPlugins(plugins().map((x) => (x.id === p.id ? { ...x, html } : x))); onDone(); }}>{L.save}</button>
        <button className="btn" onClick={onDone}>{L.cancel}</button>
        <span className="local-hint">{L.isolation}</span>
      </div>
    </section>
  );
}

export default function PluginFrames({ active }: { active: string | null }) {
  const { copy, toast, S } = useApp();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(bump), []);
  const list = plugins();
  const cur = list.find((p) => p.id === active);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [active]);
  const box = useRef<HTMLDivElement>(null);
  const z = useZoom()[0] / 100;
  const [height, setHeight] = useState(0);

  // Answers the frames' calls; a message is trusted as coming from a plugin only by its frame.
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.tbPlugin !== 1 || typeof d.op !== 'string') return;
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe.plugin-frame')].find((f) => f.contentWindow === e.source);
      const id = frame?.dataset.plugin;
      if (!frame || !id) return;
      const reply = (r: { result?: unknown; error?: string }) => frame.contentWindow?.postMessage({ tbHost: 1, id: d.id, ...r }, '*');
      const a = d.args ?? {};
      try {
        if (d.op === 'fetch') {
          const init = a.init ?? {};
          let res: Response;
          try {
            res = await fetch(a.url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: AbortSignal.timeout(FETCH_MS) });
          } catch (err) {
            return reply({ error: (err as Error)?.name === 'TimeoutError' ? 'timeout: no answer within 30 s' : 'connect: ' + String((err as Error)?.message ?? err) });
          }
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          return reply({ result: { ok: res.ok, status: res.status, headers, text: await res.text() } });
        }
        if (d.op === 'get') return reply({ result: await getData(id, String(a.k)) });
        if (d.op === 'set') { await setData(id, String(a.k), a.v); return reply({ result: true }); }
        if (d.op === 'del') { await delData(id, String(a.k)); return reply({ result: true }); }
        if (d.op === 'proxyCommand') return reply({ result: await proxyCommand(String(a.target), Number(a.port), location.origin, a.python === 'python' ? 'python' : 'python3') });
        if (d.op === 'copy') { copy(String(a.text)); return reply({ result: true }); }
        if (d.op === 'toast') { toast(String(a.text)); return reply({ result: true }); }
        reply({ error: 'unknown call: ' + d.op });
      } catch (err) {
        reply({ error: String((err as Error)?.message ?? err) });
      }
    };
    addEventListener('message', onMsg);
    return () => removeEventListener('message', onMsg);
  }, [copy, toast]);

  // The toolbox's theme follows into every frame.
  useEffect(() => {
    // After the page has taken the new theme.
    const r = requestAnimationFrame(() => {
      const vars = themeVars();
      document.querySelectorAll<HTMLIFrameElement>('iframe.plugin-frame').forEach((f) => f.contentWindow?.postMessage({ tbHost: 1, theme: vars }, '*'));
    });
    return () => cancelAnimationFrame(r);
  }, [S.theme]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const send = () => { const vars = themeVars(); document.querySelectorAll<HTMLIFrameElement>('iframe.plugin-frame').forEach((f) => f.contentWindow?.postMessage({ tbHost: 1, theme: vars }, '*')); };
    mq.addEventListener('change', send);
    return () => mq.removeEventListener('change', send);
  }, []);

  // The shown frame fills the window below its top, down to the page's bottom margin.
  const shownNow = !!cur && !editing;
  useLayoutEffect(() => {
    const el = box.current, area = el?.closest<HTMLElement>('.content');
    if (!el || !shownNow) return;
    const measure = () => {
      const pad = area ? parseFloat(getComputedStyle(area).paddingBottom) || 0 : 0;
      const h = Math.floor(Math.max(360, (innerHeight - (el.getBoundingClientRect().top + scrollY)) / z - pad));
      setHeight((o) => (Math.abs(o - h) < 2 ? o : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area ?? el);
    addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, [z, shownNow]);

  return (
    <>
      {cur && <PluginBar p={cur} editing={editing} onEdit={setEditing} />}
      {cur && editing && <CodeEditor key={cur.id} p={cur} onDone={() => setEditing(false)} />}
      <div ref={box} className="plugin-frames" style={{ display: shownNow ? 'block' : 'none' }}>
        {list.map((p) => <Frame key={p.id} p={p} shown={p.id === active} height={height} />)}
      </div>
    </>
  );
}
