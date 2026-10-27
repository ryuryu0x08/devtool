import { useEffect, useMemo, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { Kv } from '../components/Kv';
import { Source } from '../components/Source';
import { useSettled } from '../components/useSettled';
import { textBytes } from '../lib/data';
import { ALGOS, ALGO_NAME, checkHash, digestAll, fmtDigest, type Digests, type HashFmt } from '../lib/hash';
import { hashBlob } from '../lib/hashFile';

/** Text up to this size is hashed at once; larger text and every file go to a worker. */
const SYNC_MAX = 1 << 20;

/** Hash a blob in a worker. Results belong to that blob only: never shown for another input. */
function useHashJob(blob: Blob | null) {
  const [st, setSt] = useState<{ blob: Blob | null; p: number; d?: Digests; err?: boolean }>({ blob: null, p: 0 });
  useEffect(() => {
    if (!blob) return;
    setSt({ blob, p: 0 });
    const job = hashBlob(blob, (p) => setSt((s) => (s.blob === blob ? { ...s, p } : s)));
    job.done.then(
      (d) => setSt((s) => (s.blob === blob ? { blob, p: blob.size, d } : s)),
      () => setSt((s) => (s.blob === blob ? { blob, p: 0, err: true } : s)),
    );
    return () => job.cancel();
  }, [blob]);
  return st.blob === blob ? st : { blob, p: 0 };
}

export function Hash() {
  const { S, set, T, replace } = useApp();
  const file = S.hashFile;
  const [text, pending] = useSettled(S.hashIn);
  const bytes = useMemo(() => (file ? null : textBytes(text, S.hashEol)), [file, text, S.hashEol]);
  const small = useMemo(() => (bytes && bytes.length <= SYNC_MAX ? digestAll(bytes) : null), [bytes]);
  const blob = useMemo(() => file ?? (bytes && bytes.length > SYNC_MAX ? new Blob([bytes as BlobPart]) : null), [file, bytes]);
  const job = useHashJob(blob);
  const d = pending ? undefined : blob ? job.d : small ?? undefined;
  const total = file ? file.size : bytes?.length ?? 0;
  const check = useMemo(() => (d ? checkHash(S.hashCheck, d) : null), [d, S.hashCheck]);

  const status = !file && !S.hashIn ? T.hs.empty
    : !file && bytes === null ? T.badText
      : job.err ? T.readFail
        : !d ? f(T.hs.busy, { p: total ? Math.floor((job.p / total) * 100) : 0 }) : '';

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'stretch' }}>
      <Source title={T.input} placeholder={T.hs.ph} text={S.hashIn}
        size={file ? '' : bytes ? f(T.bytes, { n: bytes.length.toLocaleString('en-US') }) : ''}
        onText={(v) => set({ hashIn: v, ...(v ? {} : { hashCr: false }) })}
        file={file} onFile={(fl) => set({ hashFile: fl, hashCr: false })}
        eol={S.hashEol} onEol={(e) => set({ hashEol: e })} cr={S.hashCr} onCr={() => set({ hashCr: true })}
        onClear={() => replace({ hashIn: '', hashFile: null, hashCr: false })} />

      <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="card-head" style={{ height: 44 }}>
          <span style={{ fontWeight: 600 }}>{T.result}</span>
          <Seg<HashFmt> size="sm" value={S.hashFmt} onChange={(v) => set({ hashFmt: v })}
            opts={[{ value: 'hex', label: 'hex' }, { value: 'HEX', label: 'HEX' }, { value: 'b64', label: 'Base64' }]} />
        </div>
        <div style={{ padding: '6px 16px 16px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {d ? (
            <>
              <span className="mono" style={{ fontSize: 12, color: 'var(--faint)', padding: '6px 0' }}>{file ? f(T.fileOf, { n: file.size.toLocaleString('en-US') }) : f(T.utf8Of, { n: total.toLocaleString('en-US') })}</span>
              {/* Each row copies its value when clicked, like the timestamp results. */}
              {ALGOS.map((a) => {
                const hit = check && 'algo' in check && check.algo === a;
                return <Kv key={a} data-algo={a} label={ALGO_NAME[a]} value={fmtDigest(d[a], S.hashFmt)} labelColor={hit ? (check.ok ? 'var(--add)' : 'var(--del)') : undefined} />;
              })}
            </>
          ) : (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: !file && bytes === null || job.err ? 'var(--del)' : 'var(--faint)' }}>
              <div className="hash-status">{status}</div>
              {blob && !job.err && !d && <div style={{ height: 4, borderRadius: 2, background: 'var(--seg)', marginTop: 12, overflow: 'hidden' }}><div style={{ height: '100%', width: (total ? (job.p / total) * 100 : 0) + '%', background: 'var(--acc)' }} /></div>}
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{T.hs.check} <span style={{ fontWeight: 400, color: 'var(--faint)' }}>· {T.hs.checkHint}</span></span>
            <input className="field hash-check" value={S.hashCheck} onChange={(e) => set({ hashCheck: e.target.value })} spellCheck={false}
              placeholder={T.hs.checkPh} style={{ height: 40, fontSize: 13, fontWeight: 400 }} />
            {check && (
              <span className="check-result" style={{ fontSize: 13, fontWeight: 500, color: 'unknown' in check ? 'var(--chg)' : check.ok ? 'var(--add)' : 'var(--del)' }}>
                {'unknown' in check
                  ? check.hexLen ? f(T.hs.hexLen, { n: check.hexLen }) : T.hs.unknown
                  : f(check.ok ? T.hs.ok : T.hs.bad, { a: ALGO_NAME[check.algo] }) + (check.form === 'b64' ? ' · ' + T.hs.viaB64 : '')}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
