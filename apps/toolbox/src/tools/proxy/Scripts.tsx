// The backend's scripts (mitmproxy addons): add one by its path (or create it from a template),
// turn it on and off, edit and save it (it reloads), see why it failed to load.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import { CopyBlock } from '../../components/Kv';
import { useOpt } from '../../components/Panes';
import type { ProxyBackend, Script } from '../../lib/proxy/backend';
import { useBackendError } from './errors';

/** Scripts change status on their own (a file edited elsewhere reloads): look again this often. */
const POLL_MS = 3000;
const UNDO_MS = 6000;

export default function Scripts({ b }: { b: ProxyBackend }) {
  const { T, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [list, setList] = useState<Script[] | null>(null);
  const [path, setPath] = useState('');
  const [create, setCreate] = useOpt<boolean>('proxy.create', true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number[]>([]);

  const refresh = useCallback(() => b.scripts().then((l) => { setList(l); setErr(''); }, (e) => setErr(f(P.scriptFailed, { d: errText(e) }))), [b, P, errText]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setErr('');
    try { return await fn(); } catch (e) { setErr(f(P.scriptFailed, { d: errText(e) })); return undefined; } finally { setBusy(false); void refresh(); }
  };
  const add = async () => {
    const s = await run(() => b.addScript(path.trim(), create));
    if (!s) return;
    setPath('');
    // A new file is the template: open it to be written.
    if (create) setOpen(s.id);
  };
  const toggle = (s: Script) => void run(() => b.setScriptEnabled(s.id, !s.enabled));
  const remove = (s: Script) => {
    setRemoving((r) => [...r, s.id]);
    if (open === s.id) setOpen(null);
    const t = setTimeout(() => {
      void run(() => b.removeScript(s.id)).finally(() => setRemoving((r) => r.filter((x) => x !== s.id)));
    }, UNDO_MS);
    toast(f(P.removed, { n: s.path.split('/').pop() ?? s.path }), UNDO_MS, () => { clearTimeout(t); setRemoving((r) => r.filter((x) => x !== s.id)); });
  };

  const shown = (list ?? []).filter((s) => !removing.includes(s.id));
  return (
    <section className="card px-pad px-scripts">
      <div className="px-title">{f(P.scripts, { n: shown.length })}</div>
      <form className="px-row" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void add(); }}>
        <input className="field mono grow" value={path} onChange={(e) => setPath(e.target.value)} placeholder={P.scriptPh} spellCheck={false} aria-label={P.scriptPh} />
        <label className="px-check"><input type="checkbox" checked={create} onChange={() => setCreate(!create)} /> {P.create}</label>
        <button className="btn inv" type="submit" disabled={busy || !path.trim()}>{P.add}</button>
      </form>
      {err && <div className="px-err" role="alert">{err}</div>}
      {list && !shown.length && <div className="px-note">{P.noScripts} <span className="px-faint">{P.docs}</span></div>}
      <div className="px-script-list">
        {shown.map((s) => (
          <div key={s.id} className="px-script">
            <div className="px-row">
              <button className={'btn sm' + (s.enabled ? ' on' : '')} onClick={() => toggle(s)} disabled={busy} aria-pressed={s.enabled} title={P.enable}>{s.enabled ? '✓' : '○'} {P.enable}</button>
              <CopyBlock value={s.path} className="px-script-path mono">{s.path}</CopyBlock>
              <span className={'px-badge ' + s.status}>{P.st[s.status]}</span>
              <button className={'btn sm' + (open === s.id ? ' on' : '')} onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? P.close : P.edit}</button>
              <button className="btn sm danger" onClick={() => remove(s)}>{P.remove}</button>
            </div>
            {s.status === 'failed' && s.error && <CopyBlock value={s.error} className="px-trace"><pre>{s.error}</pre></CopyBlock>}
            {open === s.id && <Editor b={b} s={s} onSaved={() => void refresh()} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function Editor({ b, s, onSaved }: { b: ProxyBackend; s: Script; onSaved: () => void }) {
  const { T, isMac, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let off = false;
    b.readScript(s.id).then((t) => { if (!off) { setText(t); setOrig(t); } }, (e) => { if (!off) setErr(errText(e)); });
    return () => { off = true; };
  }, [b, s.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (text === null || saving) return;
    setSaving(true);
    setErr('');
    try {
      const r = await b.writeScript(s.id, text);
      setOrig(text);
      toast(r.status === 'pending' ? P.savedPending : r.status === 'failed' ? P.st.failed : P.saved, 4000);
      onSaved();
    } catch (e) {
      setErr(f(P.scriptFailed, { d: errText(e) }));
    }
    setSaving(false);
  };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
    // Python is indented: Tab writes four spaces instead of leaving the box.
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.currentTarget.setRangeText('    ', e.currentTarget.selectionStart, e.currentTarget.selectionEnd, 'end');
      setText(e.currentTarget.value);
    }
  };

  const dirty = text !== null && text !== orig;
  return (
    <div className="px-editor">
      {text === null && !err && <div className="px-faint">{P.loading}</div>}
      {text !== null && (
        <textarea ref={area} className="area mono" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} spellCheck={false} aria-label={s.path} />
      )}
      <div className="px-row">
        <button className="btn inv sm" onClick={() => void save()} disabled={!dirty || saving}>{f(P.saveKey, { k: isMac ? '⌘S' : 'Ctrl S' })}</button>
        {dirty && <span className="px-warn">{P.unsaved}</span>}
        {err && <span className="px-err">{err}</span>}
      </div>
    </div>
  );
}
