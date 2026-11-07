// Building blocks shared by the text tools: input card, result card, error line, options.
import { useMemo, useEffect, type ReactNode } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from './Seg';
import { Vis, countInvisible } from './Vis';
import { Hl } from './Hl';
import type { HlLang } from '../lib/highlight';
import { CopyBlock } from './Kv';
import { decodeUtf8, type ErrInfo } from '../lib/data';
import { hexDump, sniff } from '../lib/b64';
import { toHex } from '../lib/hash';

/** A tool option, stored with the preferences. A stored value of the wrong type or not among
 *  `allowed` reads as the default. */
type Widen<T> = T extends boolean ? boolean : T extends number ? number : T;
export function useOpt<T extends string | number | boolean>(key: string, def: T, allowed?: readonly Widen<T>[]): [Widen<T>, (v: Widen<T>) => void] {
  const { S, set } = useApp();
  const raw = S.o[key];
  const ok = typeof raw === typeof def && (!allowed || allowed.includes(raw as Widen<T>));
  return [(ok ? raw : def) as Widen<T>, (v) => set((s) => ({ o: { ...s.o, [key]: v } }))];
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Grid({ children, min = 380 }: { children: ReactNode; min?: number }) {
  return <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, alignItems: 'stretch' }}>{children}</div>;
}

/** Input card: title, size, clear, and a text box (the tool's main input gets focus). */
export function TextIn(p: {
  title: string; value: string; onChange: (v: string) => void; placeholder: string; onClear?: () => void;
  size?: string; minH?: number; focus?: boolean; mono?: boolean; onFirstPaste?: (t: string) => void; className?: string; children?: ReactNode;
}) {
  const { T } = useApp();
  return (
    <section className={'card ' + (p.className ?? '')} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head" style={{ height: 44, gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{p.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {p.size && <span className="mono" style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap' }}>{p.size}</span>}
          {p.onClear && <button className="btn sm" onClick={p.onClear}>{T.clear}</button>}
        </span>
      </div>
      <textarea data-autofocus={p.focus === false ? undefined : '1'} className="area" value={p.value} spellCheck={false} placeholder={p.placeholder}
        onChange={(e) => p.onChange(e.target.value)}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (!p.value && t) p.onFirstPaste?.(t); }}
        style={{ flex: 1, minHeight: p.minH ?? 220, padding: '14px 16px', font: p.mono === false ? "14px/1.6 'Geist', 'PingFang SC', sans-serif" : "13px/1.65 'Geist Mono', 'PingFang SC', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} />
      {p.children}
    </section>
  );
}

/** Result card: a status line (red when it is an error), notes in amber, then the body. */
export function OutCard(p: { status: ReactNode; bad?: boolean; right?: ReactNode; notes?: string[]; children?: ReactNode; className?: string }) {
  return (
    <section className={'card out-card ' + (p.className ?? '')} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div className="card-head" style={{ minHeight: 44, gap: 8, flexWrap: 'wrap', padding: '6px 16px' }}>
        <span className="out-status" style={{ fontWeight: 600, fontSize: 13, color: p.bad ? 'var(--del)' : undefined, minWidth: 0, overflowWrap: 'anywhere' }}>{p.status}</span>
        {p.right && <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{p.right}</span>}
      </div>
      {!!p.notes?.length && <div className="out-notes">{p.notes.map((n, i) => <span key={i}><Vis text={n} /></span>)}</div>}
      <div className="pane-scroll" style={{ padding: '12px 16px', flex: 1, minHeight: 0, overflow: 'auto', maxHeight: '70vh' }}>{p.children}</div>
    </section>
  );
}

/** Longer results are shown in part (laying out megabytes of text freezes the page); a click
 *  still copies all of it. */
export const SHOW_CHARS = 200_000;

/** The first `n` UTF-16 units of s, not cutting a surrogate pair in half. */
export function head(s: string, n: number): string {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}

/** Text result: a click copies all of it; invisible characters are marked. */
/** A text result; with `lang`, in syntax colours. */
export function TextOut({ text, className, lang }: { text: string; className?: string; lang?: HlLang }) {
  const { T } = useApp();
  const cut = text.length > SHOW_CHARS;
  return (
    <CopyBlock value={text}>
      <pre className={'tool-out ' + (className ?? '')} style={{ margin: 0, font: "13px/1.6 'Geist Mono', 'PingFang SC', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><Hl lang={lang} text={cut ? head(text, SHOW_CHARS) : text} /></pre>
      {cut && <div className="shown-first" style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>{f(T.ui.shownFirst, { n: SHOW_CHARS.toLocaleString('en-US') })}</div>}
    </CopyBlock>
  );
}

export const Empty = ({ children }: { children?: ReactNode }) => {
  const { T } = useApp();
  return <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>{children ?? T.ui.empty}</div>;
};

/** An error message and its line with the offending character marked. */
export function ErrLine({ msg, info }: { msg: string; info?: ErrInfo | null }) {
  return (
    <div className="err-box" style={{ display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--del)' }}>
      <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}><Vis text={msg} /></span>
      {info?.line && (
        <pre style={{ margin: 0, font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', whiteSpace: 'pre', overflow: 'auto', padding: '2px 0' }}>
          <Vis text={info.before} /><mark className="err-at">{info.at ? <Vis text={info.at} /> : ' '}</mark><Vis text={info.after} />
        </pre>
      )}
    </div>
  );
}

/** "Line l, column c" for an error with a position, else "Invalid". */
export function errStatus(T: ReturnType<typeof useApp>['T'], info?: ErrInfo | null) {
  return info?.line ? f(T.errAt, { l: info.line, c: info.col ?? 1 }) : T.invalid;
}

export function download(bytes: Uint8Array, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Results larger than this are shown as a hex dump of their start (and downloaded), not as text. */
const TEXT_MAX = 64 * 1024 * 1024;

/** Bytes as a result: UTF-8 text when they are, else a hex dump; downloadable either way. A name
 *  that already has an extension (notes.txt from notes.txt.gz) is kept as it is. */
export function BytesOut({ bytes, view, onView, name, extraNotes = [], status }: {
  bytes: Uint8Array; view: 'text' | 'hex'; onView: (v: 'text' | 'hex') => void; name: string; extraNotes?: string[]; status?: string;
}) {
  const { T } = useApp();
  // Very large results aren't turned into text: the string alone could exhaust the page.
  const big = bytes.length > TEXT_MAX;
  const text = useMemo(() => (big ? null : decodeUtf8(bytes)), [bytes, big]);
  const kind = sniff(bytes);
  const v = text === null ? 'hex' : view;
  const preview = useMemo(() => (kind?.mime.startsWith('image/') ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: kind.mime })) : ''), [bytes, kind]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const inv = text ? countInvisible(text) : 0;
  const notes = [...extraNotes, ...(inv ? [f(T.invisibleChars, { n: inv })] : [])];
  return (
    <OutCard status={status ?? f(big ? T.ui.bigOut : text === null ? T.ui.notUtf8Out : T.ui.utf8Out, { n: bytes.length.toLocaleString('en-US') })} notes={notes}
      right={<>
        {text !== null && <Seg size="sm" value={v} onChange={onView} opts={[{ value: 'text', label: T.ui.textView }, { value: 'hex', label: T.ui.hexView }]} />}
        <button className="btn sm" onClick={() => download(bytes, /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : name + '.' + (kind?.ext ?? (text !== null ? 'txt' : 'bin')), kind?.mime)}>{T.ui.download}</button>
      </>}>
      {preview && <img src={preview} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ display: 'block', maxWidth: '100%', maxHeight: 240, marginBottom: 12, borderRadius: 8, border: '1px solid var(--line)' }} />}
      {v === 'text'
        ? <TextOut text={text!} />
        : <CopyBlock value={toHex(bytes)}><pre className="hex-dump" style={{ margin: 0, font: "12.5px/1.6 'Geist Mono', monospace", whiteSpace: 'pre', overflow: 'auto' }}>{hexDump(bytes, 4096)}</pre></CopyBlock>}
      {v === 'hex' && bytes.length > 4096 && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>{f(T.b64.hexFirst, { n: 4096 })}</div>}
    </OutCard>
  );
}

/** A number box that keeps to [min, max]. */
export function NumIn({ value, onChange, min, max, width = 72, label }: { value: number; onChange: (n: number) => void; min: number; max: number; width?: number; label: string }) {
  return (
    <label className="num-in">
      <span>{label}</span>
      <input type="number" className="field" value={value} min={min} max={max} aria-label={label}
        onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        style={{ width, height: 32, fontSize: 13, padding: '0 8px', fontWeight: 400 }} />
    </label>
  );
}

/** Small on / off button for options. */
export function Flag({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }) {
  return <button className={'btn' + (on ? ' on' : '')} onClick={onClick} title={title} aria-pressed={on}>{on ? '✓' : '○'} {label}</button>;
}
