// LLM chat tester: an OpenAI-compatible or Anthropic endpoint, the user's own key, multi-turn
// chat with streamed replies, timing and token usage. Loaded only when opened (the SDKs are large).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { CopyBlock } from '../components/Kv';
import { Hl } from '../components/Hl';
import { useOpt } from '../components/Panes';
import { useZoom } from '../components/Zoom';
import type { HlLang } from '../lib/highlight';
import { DEFAULT_BASE, listModels, reply, toError, type LlmConfig, type LlmError, type Provider, type Turn } from '../lib/llm';

/** Kept while the page is open, so switching tools doesn't lose the chat or an unsaved key. */
const mem: { turns: Turn[]; key: Record<Provider, string>; models: Record<Provider, string[]> } = {
  turns: [], key: { anthropic: '', openai: '' }, models: { anthropic: [], openai: [] },
};
const KEY_STORE = (p: Provider) => 'tb.llmKey.' + p;
const readKey = (p: Provider) => { try { return localStorage.getItem(KEY_STORE(p)) ?? ''; } catch { return ''; } };
const writeKey = (p: Provider, v: string | null) => {
  try { if (v === null) localStorage.removeItem(KEY_STORE(p)); else localStorage.setItem(KEY_STORE(p), v); } catch { /* storage off: kept for this page only */ }
};

/** Code-fence languages that get syntax colours. */
const HL: Record<string, HlLang> = { json: 'json', jsonc: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml', xml: 'xml', html: 'xml', svg: 'xml', sql: 'sql' };
const MD: Components = {
  a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" />,
  code: ({ node: _n, className, children, ...p }) => {
    const lang = HL[/language-([\w-]+)/.exec(className ?? '')?.[1]?.toLowerCase() ?? ''];
    return <code className={className} {...p}>{lang ? <Hl lang={lang} text={String(children).replace(/\n$/, '')} /> : children}</code>;
  },
};

const secs = (ms?: number) => (ms === undefined ? '' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1));

export default function Llm() {
  const { T } = useApp();
  const L = T.llm;
  const z = useZoom()[0] / 100;
  const [provider, setProvider] = useOpt<Provider>('llm.provider', 'anthropic', ['anthropic', 'openai']);
  const [base, setBase] = useOpt<string>('llm.' + provider + '.base', '');
  const [model, setModel] = useOpt<string>('llm.' + provider + '.model', '');
  const [maxTokens, setMaxTokens] = useOpt<number>('llm.' + provider + '.max', provider === 'anthropic' ? 8192 : 0);
  const [system, setSystem] = useOpt<string>('llm.system', '');
  const [remember, setRemember] = useOpt<boolean>('llm.remember', false);
  const [key, setKeyState] = useState(() => mem.key[provider] || (remember ? readKey(provider) : ''));
  const [turns, setTurnsState] = useState<Turn[]>(mem.turns);
  const [live, setLive] = useState<{ text: string; thinking: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<ReactNode>(null);
  const [models, setModels] = useState<string[]>(mem.models[provider]);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);

  const setTurns = (t: Turn[]) => { mem.turns = t; setTurnsState(t); };
  const setKey = (v: string) => { mem.key[provider] = v; setKeyState(v); if (remember) writeKey(provider, v); };
  useEffect(() => {
    setKeyState(mem.key[provider] || (remember ? readKey(provider) : ''));
    setModels(mem.models[provider]);
    setNote(null);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleRemember = () => {
    const on = !remember;
    setRemember(on);
    for (const p of ['anthropic', 'openai'] as const) writeKey(p, on && mem.key[p] ? mem.key[p] : null);
    if (on && key) writeKey(provider, key);
  };

  // The chat fills the window below its top, down to the page's bottom margin.
  useLayoutEffect(() => {
    const el = chat.current, area = el?.closest<HTMLElement>('.content');
    if (!el) return;
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
  }, [z]);

  // New text keeps the chat scrolled to the end, unless the reader scrolled up.
  const atEnd = useRef(true);
  useLayoutEffect(() => { const el = log.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [turns, live]);

  const cfg = (): LlmConfig => ({ provider, baseURL: base.trim() || DEFAULT_BASE[provider], apiKey: key.trim(), model: model.trim(), system, maxTokens: Number(maxTokens) || 0 });
  const missing = !key.trim() ? L.needKey : !model.trim() ? L.needModel : '';
  const busy = live !== null;

  const run = async (history: Turn[]) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    atEnd.current = true;
    setTurns(history);
    setLive({ text: '', thinking: '' });
    const acc = { text: '', thinking: '' };
    const res = await reply(cfg(), history, (d) => {
      if (d.text) acc.text += d.text;
      if (d.thinking) acc.thinking += d.thinking;
      setLive({ ...acc });
    }, ctrl.signal);
    abort.current = null;
    setLive(null);
    setTurns([...history, res]);
  };
  const send = () => {
    const text = draft.trim();
    if (!text || busy || missing) return;
    setDraft('');
    void run([...turns, { role: 'user', text: draft }]);
  };
  const regen = () => {
    if (busy) return;
    const last = turns[turns.length - 1];
    void run(last?.role === 'assistant' ? turns.slice(0, -1) : turns);
  };
  const fetchModels = async () => {
    if (!key.trim()) { setNote(L.needKey); return; }
    setNote(L.listing);
    try {
      const ids = await listModels(cfg());
      mem.models[provider] = ids;
      setModels(ids);
      setNote(ids.length ? f(L.models, { n: ids.length }) : L.noModels);
    } catch (e) { setNote(<span className="llm-err">{errText(toError(e))}</span>); }
  };
  const errText = (e: LlmError) => (e.kind === 'connect' ? L.connect : e.kind === 'http' ? f(L.http, { s: e.status, d: e.detail }) : f(L.other, { d: e.detail }));

  const meta = (t: Turn) => {
    const s = t.stats;
    if (!s) return null;
    const parts = [
      s.firstMs !== undefined ? f(L.first, { s: secs(s.firstMs) }) : '',
      f(L.total, { s: secs(s.totalMs) }),
      s.inTokens !== undefined || s.outTokens !== undefined ? f(L.tokens, { i: s.inTokens ?? '?', o: s.outTokens ?? '?' }) : '',
      s.stop ? f(L.stopReason, { r: s.stop }) : '',
      s.model ?? '',
    ].filter(Boolean);
    return <div className="llm-meta">{parts.join(' · ')}</div>;
  };
  const body = (text: string, thinking: string | undefined, streaming: boolean) => (
    <>
      {thinking && (
        <details className="llm-think" open={streaming && !text}>
          <summary>{L.thinking}</summary>
          <div className="llm-think-text">{thinking}</div>
        </details>
      )}
      {text && <CopyBlock value={text} className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{text}</ReactMarkdown></CopyBlock>}
    </>
  );

  return (
    <div className="tool-stack llm">
      <section className="card llm-cfg">
        <div className="llm-row">
          <Seg value={provider} onChange={setProvider} opts={[{ value: 'anthropic', label: L.anthropic }, { value: 'openai', label: L.openai }]} />
          <input className="field mono grow" value={base} placeholder={DEFAULT_BASE[provider]} onChange={(e) => setBase(e.target.value)} spellCheck={false} aria-label={L.base} title={L.base} />
          <input className="field mono grow" list="llm-models" value={model} placeholder={L.model + ' · ' + (provider === 'anthropic' ? L.modelPh : L.modelPhOpenai)} onChange={(e) => setModel(e.target.value)} spellCheck={false} aria-label={L.model} title={L.model} />
          <datalist id="llm-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          <button className="btn" onClick={() => void fetchModels()}>{L.listModels}</button>
        </div>
        <div className="llm-row">
          <input className="field mono grow" type="password" value={key} placeholder={L.key + ' · ' + L.keyPh} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} aria-label={L.key} title={L.key} />
          <label className="llm-check"><input type="checkbox" checked={remember} onChange={toggleRemember} /> {L.remember}</label>
          <label className="llm-max"><span>{L.maxTokens}</span>
            <input className="field mono" type="number" min={0} value={maxTokens || ''} placeholder={provider === 'openai' ? L.maxTokensNone : ''}
              onChange={(e) => setMaxTokens(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label={L.maxTokens} />
          </label>
        </div>
        <details className="llm-sys" open={!!system || undefined}>
          <summary>{L.system}{system ? '' : ' · ' + L.systemPh}</summary>
          <textarea className="field" rows={3} value={system} onChange={(e) => setSystem(e.target.value)} aria-label={L.system} />
        </details>
        <div className="llm-note">{note ?? L.keyNote}</div>
      </section>

      <section ref={chat} className="card llm-chat" style={height ? { height } : undefined}>
        <div className="card-head llm-head">
          <span className="llm-title">{f(L.turns, { n: turns.filter((t) => t.role === 'user').length })}</span>
          <span className="llm-head-btns">
            <button className="btn sm" onClick={regen} disabled={busy || !turns.length || !!missing}>{L.regen}</button>
            <button className="btn sm" onClick={() => setTurns([])} disabled={busy || !turns.length}>{L.clear}</button>
          </span>
        </div>
        <div ref={log} className="llm-log" onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
          {!turns.length && !busy && <div className="llm-empty">{L.empty}</div>}
          {turns.map((t, i) => (
            <div key={i} className={'llm-msg ' + t.role}>
              <div className="llm-who">{t.role === 'user' ? L.you : L.ai}</div>
              {t.role === 'user'
                ? <CopyBlock value={t.text} className="llm-user-text">{t.text}</CopyBlock>
                : body(t.text, t.thinking, false)}
              {t.refused && <div className="llm-warn">{f(L.refused, { r: t.stats?.stop ?? '' })}</div>}
              {t.error && <div className="llm-err">{errText(t.error)}</div>}
              {t.stopped && !t.error && <div className="llm-warn">{L.stopped}</div>}
              {t.role === 'assistant' && meta(t)}
            </div>
          ))}
          {live && (
            <div className="llm-msg assistant">
              <div className="llm-who">{L.ai}</div>
              {body(live.text, live.thinking, true)}
              <div className="llm-cursor" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="llm-input">
          <textarea className="field" rows={3} value={draft} placeholder={missing || L.ph} onChange={(e) => setDraft(e.target.value)} aria-label={L.ph}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          {busy
            ? <button className="btn inv llm-send" onClick={() => abort.current?.abort()}>{L.stop}</button>
            : <button className="btn inv llm-send" onClick={send} disabled={!draft.trim() || !!missing} title={missing || undefined}>{L.send}</button>}
        </div>
      </section>
    </div>
  );
}
