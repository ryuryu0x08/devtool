import { useEffect, useMemo, useState } from 'react';
import { f } from '../i18n';
import { Pair } from '../components/Split';
import { useApp } from '../store';
import { Seg, Toggle } from '../components/Seg';
import { Source } from '../components/Source';
import { CopyBlock } from '../components/Kv';
import { useSettled } from '../components/useSettled';
import { Vis, countInvisible } from '../components/Vis';
import { decodeUtf8, errInfo, textBytes, type ErrInfo } from '../lib/data';
import { B64Error, b64decode, b64encode, hexDump, looksB64, sniff, type B64Note } from '../lib/b64';
import { toHex } from '../lib/hash';

/** Files above this are refused: the Base64 text would be too large to show or copy. */
const FILE_MAX_MB = 50;
/** Longer output is shown in part (Copy / Download still give all of it). */
const SHOW_CHARS = 200_000;
const SHOW_BYTES = 4096;

/** Bytes of a file, read once per file; never those of a previous file. */
export function useFileBytes(file: File | null, maxMb = FILE_MAX_MB) {
  const [st, setSt] = useState<{ file: File | null; bytes?: Uint8Array; err?: 'big' | 'read' }>({ file: null });
  useEffect(() => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) { setSt({ file, err: 'big' }); return; }
    let live = true;
    file.arrayBuffer().then((b) => live && setSt({ file, bytes: new Uint8Array(b) }), () => live && setSt({ file, err: 'read' }));
    return () => { live = false; };
  }, [file, maxMb]);
  return st.file === file ? st : { file };
}

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Dec = { bytes: Uint8Array; notes: B64Note[]; mime?: string; text: string | null } | { err: B64Error; info: ErrInfo } | null;

export function Base64() {
  const { S, set, T, replace, toast } = useApp();
  const enc = S.b64Mode === 'enc';
  const file = enc ? S.b64File : null;
  const [text, pending] = useSettled(S.b64In);
  const fb = useFileBytes(file);

  const encOut = useMemo<{ bad: true } | { out: string; n: number } | null>(() => {
    if (!enc) return null;
    const bytes = file ? fb.bytes : textBytes(text, S.b64Eol);
    if (bytes === null) return { bad: true };
    if (!bytes || (!file && !text)) return null;
    // data URLs are read with the standard alphabet and padding only.
    const asData = !!file && S.b64DataUrl;
    const b = b64encode(bytes, asData ? false : S.b64Url, asData ? true : S.b64Pad);
    return { out: asData ? 'data:' + (file!.type || 'application/octet-stream') + ';base64,' + b : b, n: bytes.length };
  }, [enc, file, fb.bytes, text, S.b64Eol, S.b64Url, S.b64Pad, S.b64DataUrl]);

  const dec = useMemo<Dec>(() => {
    if (enc) return null;
    try {
      const r = b64decode(text);
      return r && { ...r, text: decodeUtf8(r.bytes) };
    } catch (e) {
      if (e instanceof B64Error) return { err: e, info: errInfo(e, text) };
      throw e;
    }
  }, [enc, text]);
  const ok = dec && 'bytes' in dec ? dec : null;
  const loading = pending || (!!file && !fb.bytes && !fb.err);
  const kind = ok ? sniff(ok.bytes) : null;
  const preview = useMemo(() => (ok && kind?.mime.startsWith('image/') ? URL.createObjectURL(new Blob([ok.bytes as BlobPart], { type: kind.mime })) : ''), [ok, kind]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const view = ok && ok.text !== null ? S.b64View : 'hex';

  const noteText = (n: B64Note) =>
    n.k === 'dataUrl' ? f(T.b64.n.dataUrl, { m: n.mime || T.b64.noType }) : n.k === 'ws' ? f(T.b64.n.ws, { n: n.n }) : T.b64.n[n.k];
  const errText = (e: B64Error) =>
    e.code === 'char' ? f(T.b64.e.char, { c: e.ch }) : e.code === 'len' ? f(T.b64.e.len, { n: e.n }) : T.b64.e[e.code];
  const fileName = () => {
    const ext = kind?.ext ?? (ok?.text !== null ? 'txt' : 'bin');
    return 'decoded.' + ext;
  };

  const notes: string[] = [];
  if (ok) {
    notes.push(...ok.notes.map(noteText));
    const inv = ok.text ? countInvisible(ok.text) : 0;
    if (inv) notes.push(f(T.invisibleChars, { n: inv }));
  }
  if (enc && file && S.b64DataUrl) notes.push(T.b64.dataUrlStd);

  const shown = (s: string) => (s.length > SHOW_CHARS ? s.slice(0, SHOW_CHARS) : s);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Seg value={S.b64Mode} onChange={(m) => set({ b64Mode: m })} opts={[{ value: 'enc', label: T.b64.enc }, { value: 'dec', label: T.b64.dec }]} />
        {enc && !(file && S.b64DataUrl) && (
          <>
            <span className="sep" />
            <Seg value={S.b64Url ? 'url' : 'std'} onChange={(v) => set({ b64Url: v === 'url' })} opts={[{ value: 'std', label: T.b64.std + ' + /' }, { value: 'url', label: T.b64.url + ' - _' }]} />
            <Toggle on={S.b64Pad} label={T.b64.pad} onClick={() => set((s) => ({ b64Pad: !s.b64Pad }))} />
          </>
        )}
        {enc && file && <Toggle on={S.b64DataUrl} label={T.b64.dataUrl} onClick={() => set((s) => ({ b64DataUrl: !s.b64DataUrl }))} />}
      </div>

      <Pair>
        <Source title={T.input} placeholder={enc ? T.b64.encPh : T.b64.decPh} text={S.b64In}
          size={file ? '' : f(T.bytes, { n: (textBytes(S.b64In, enc ? S.b64Eol : 'lf')?.length ?? 0).toLocaleString('en-US') })}
          onText={(v) => set({ b64In: v, ...(v ? {} : { b64Cr: false }) })}
          file={file} onFile={(fl) => set({ b64File: fl, b64Cr: false })}
          eol={S.b64Eol} onEol={enc ? (e) => set({ b64Eol: e }) : undefined} cr={enc && S.b64Cr} onCr={() => set({ b64Cr: true })}
          onFirstPaste={(t) => {
            // Pasting into the empty box: Base64 / a data URL is decoded, anything else encoded.
            const m = looksB64(t) ? 'dec' : 'enc';
            if (m !== S.b64Mode) { set({ b64Mode: m }); toast(f(T.b64.switched, { m: m === 'dec' ? T.b64.dec : T.b64.enc }), 3000); }
          }}
          onClear={() => replace({ b64In: '', b64File: null, b64Cr: false })} />

        <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-head" style={{ height: 44, gap: 8 }}>
            <span className="b64-status" style={{ fontWeight: 600, fontSize: 13, color: dec && 'err' in dec || encOut && 'bad' in encOut || fb.err ? 'var(--del)' : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? T.processing
                : fb.err ? (fb.err === 'big' ? f(T.b64.tooBig, { n: FILE_MAX_MB }) : T.readFail)
                  : encOut && 'bad' in encOut ? T.badText
                    : encOut ? f(T.b64.encInfo, { n: encOut.n.toLocaleString('en-US'), c: encOut.out.length.toLocaleString('en-US') })
                      : dec && 'err' in dec ? (dec.info.line ? f(T.errAt, { l: dec.info.line, c: dec.info.col ?? 1 }) : T.invalid)
                        : ok ? f(ok.text !== null ? T.b64.decText : T.b64.decBin, { n: ok.bytes.length.toLocaleString('en-US') })
                          : T.result}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              {ok && ok.text !== null && (
                <Seg size="sm" value={view} onChange={(v) => set({ b64View: v })} opts={[{ value: 'text', label: T.b64.text }, { value: 'hex', label: T.b64.hex }]} />
              )}
              {ok && <button className="btn sm" onClick={() => download(ok.bytes, fileName(), kind?.mime ?? 'application/octet-stream')}>{T.b64.dl}</button>}
            </span>
          </div>
          {notes.length > 0 && (
            <div className="b64-notes" style={{ padding: '8px 16px', background: 'var(--chgBg)', color: 'var(--chg)', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {notes.map((n, i) => <span key={i}>{n}</span>)}
            </div>
          )}
          <div style={{ padding: '12px 16px', flex: 1, minHeight: 0, overflow: 'auto', maxHeight: '70vh' }}>
            {dec && 'err' in dec ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--del)' }}>
                <span style={{ fontSize: 13 }}><Vis text={errText(dec.err)} /></span>
                {dec.info.line && (
                  <pre style={{ margin: 0, font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', whiteSpace: 'pre', overflow: 'auto', padding: '2px 0' }}>
                    <Vis text={dec.info.before} /><mark className="err-at">{dec.info.at ? <Vis text={dec.info.at} /> : ' '}</mark><Vis text={dec.info.after} />
                  </pre>
                )}
              </div>
            ) : ok ? (
              <>
                {preview && <img src={preview} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ display: 'block', maxWidth: '100%', maxHeight: 240, marginBottom: 12, borderRadius: 8, border: '1px solid var(--line)' }} />}
                {/* The result copies itself: the decoded text, or in hex view the bytes as plain hex. */}
                {view === 'text'
                  ? <CopyBlock value={ok.text!}><pre className="b64-out" style={{ margin: 0, font: "13px/1.6 'Geist Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><Vis text={shown(ok.text!)} /></pre></CopyBlock>
                  : <CopyBlock value={toHex(ok.bytes)}><pre className="b64-hex" style={{ margin: 0, font: "12.5px/1.6 'Geist Mono', monospace", whiteSpace: 'pre', overflow: 'auto' }}>{hexDump(ok.bytes, SHOW_BYTES)}</pre></CopyBlock>}
                {(view === 'text' ? ok.text!.length > SHOW_CHARS : ok.bytes.length > SHOW_BYTES) && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>{view === 'text' ? f(T.b64.outFirst, { n: SHOW_CHARS.toLocaleString('en-US') }) : f(T.b64.hexFirst, { n: SHOW_BYTES })}</div>
                )}
              </>
            ) : encOut && 'out' in encOut ? (
              <>
                <CopyBlock value={loading ? '' : encOut.out}><pre className="b64-out" style={{ margin: 0, font: "13px/1.6 'Geist Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{shown(encOut.out)}</pre></CopyBlock>
                {encOut.out.length > SHOW_CHARS && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>{f(T.b64.outFirst, { n: SHOW_CHARS.toLocaleString('en-US') })}</div>}
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>{loading || (encOut && 'bad' in encOut) || fb.err ? '' : T.b64.empty}</div>
            )}
          </div>
        </section>
      </Pair>
    </div>
  );
}
