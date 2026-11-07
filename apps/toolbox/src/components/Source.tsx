import { useRef } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { bytesLabel, type Eol } from '../lib/data';
import { Seg } from './Seg';
import { Vis } from './Vis';

/** Exact size of a file: "12.3 MB (12,345,678 bytes)". */
export function useSize() {
  const { T } = useApp();
  return (n: number) => f(T.fileSize, { h: bytesLabel(n), n: n.toLocaleString('en-US') });
}

/**
 * Input for tools that work on bytes (Base64, hashes): text, or a file taken byte for byte.
 * Text boxes turn CRLF into LF, so the line ending is a choice and a pasted CRLF is reported.
 */
export function Source(p: {
  title: string; placeholder: string; size: string;
  text: string; onText: (s: string) => void;
  file?: File | null; onFile?: (f: File | null) => void;
  eol?: Eol; onEol?: (e: Eol) => void; cr?: boolean; onCr?: () => void;
  /** Text pasted into the empty box (the whole input), for tools that pick a mode from it. */
  onFirstPaste?: (text: string) => void;
  onClear: () => void;
}) {
  const { T } = useApp();
  const pick = useRef<HTMLInputElement>(null);
  const size = useSize();
  const eolBar = !p.file && p.onEol && (p.text.includes('\n') || p.cr);
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head" style={{ height: 44, gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{p.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.size}</span>
          {p.onFile && <button className="btn sm" onClick={() => pick.current?.click()}>{T.pickFile}</button>}
          <button className="btn sm" onClick={p.onClear}>{T.clear}</button>
        </span>
      </div>
      {p.file ? (
        <div style={{ flex: 1, minHeight: 220, padding: 20, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <span style={{ fontWeight: 600, wordBreak: 'break-all' }}><Vis text={p.file.name} /></span>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--mut)' }}>{size(p.file.size)} · {p.file.type || T.unknownType}</span>
          <button className="btn" onClick={() => p.onFile?.(null)}>{T.removeFile}</button>
        </div>
      ) : (
        <textarea data-autofocus="1" className="area" value={p.text} spellCheck={false} placeholder={p.placeholder}
          onChange={(e) => p.onText(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (t.includes('\r')) p.onCr?.();
            if (!p.text && t) p.onFirstPaste?.(t);
          }}
          style={{ flex: 1, minHeight: 220, padding: '14px 16px', font: "13px/1.65 'Geist Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} />
      )}
      {eolBar && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>{T.eol}</span>
          <Seg size="sm" value={p.eol!} onChange={p.onEol!} opts={[{ value: 'lf', label: 'LF' }, { value: 'crlf', label: 'CRLF' }]} />
          {p.cr && <span style={{ fontSize: 12, color: 'var(--chg)', flex: '1 1 240px' }}>{T.crPasted}</span>}
        </div>
      )}
      <input type="file" ref={pick} style={{ display: 'none' }}
        onChange={(e) => { const fl = e.target.files?.[0]; if (fl) p.onFile?.(fl); e.target.value = ''; }} />
    </section>
  );
}
