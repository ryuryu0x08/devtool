import { useMemo, useRef } from 'react';
import { Vis } from '../components/Vis';
import { f } from '../i18n';
import { Pair } from '../components/Split';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { byteLen } from '../lib/data';
import { qrCanvas, qrModel, type Ec, type QrModel } from '../lib/qr';

export function QrGen() {
  const { S, set, T, copy, toast, replace } = useApp();
  const m = useMemo(() => qrModel(S.qrText, S.qrEc), [S.qrText, S.qrEc]);
  const has = !!m && 'd' in m;
  const model = has ? (m as QrModel) : null;

  const download = () => {
    if (!model) return;
    const a = document.createElement('a');
    a.href = qrCanvas(model).toDataURL('image/png');
    a.download = 'qrcode.png';
    a.click();
  };
  const copyImg = () => {
    if (!model) return;
    const cv = qrCanvas(model);
    // Pass a promise so clipboard.write runs inside the click (Safari rejects it from a toBlob callback).
    const png = new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed')))));
    // Putting an image on the clipboard can take seconds: say it has started.
    toast(T.imgCopying, 60_000);
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(() => toast(T.imgCopied), () => toast(T.imgCopyFail));
    } catch {
      toast(T.imgCopyFail);
    }
  };

  return (
    <Pair>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="card-head" style={{ minHeight: 0, padding: '12px 16px' }}>
          <span style={{ fontWeight: 600 }}>{T.qrContent}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{f(T.bytes, { n: byteLen(S.qrText) })}</span>
            <button className="btn" onClick={() => replace({ qrText: '' })} style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 400, borderColor: 'var(--line)', background: 'transparent' }}>{T.clear}</button>
          </span>
        </div>
        <textarea data-autofocus="1" className="area" value={S.qrText} onChange={(e) => set({ qrText: e.target.value })} spellCheck={false}
          placeholder={T.qrPh} style={{ minHeight: 300, padding: 16, fontSize: 14 }} />
      </section>
      <section className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        {/* The code itself copies the image when clicked. */}
        <button className="qr-box" onClick={copyImg} disabled={!model} title={model ? T.copyImg : undefined} aria-label={T.qrImgLabel}
          style={{ width: '100%', maxWidth: 300, aspectRatio: '1', background: '#ffffff', border: '1px solid var(--line)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: model ? 'pointer' : 'default', font: 'inherit' }}>
          {model ? (
            <svg viewBox={`0 0 ${model.n} ${model.n}`} shapeRendering="crispEdges" style={{ width: '100%', height: '100%', display: 'block' }}>
              <path d={model.d} fill="#111111" />
            </svg>
          ) : (
            <span style={{ fontSize: 13, color: m ? 'oklch(0.52 0.18 25)' : '#8f8e89', textAlign: 'center' }}>{!m ? T.qrEmpty : 'err' in m && m.err === 'bad' ? T.qrBadText : T.qrTooLong}</span>
          )}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>{T.ec}</span>
          <Seg<Ec> mono value={S.qrEc} onChange={(l) => set({ qrEc: l })}
            opts={(['L', 'M', 'Q', 'H'] as Ec[]).map((l) => ({ value: l, label: l, title: T.ecT[l] }))} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{model ? model.n + '×' + model.n : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn inv" onClick={download} style={{ height: 38, padding: '0 16px', borderRadius: 9 }}>{T.dlPng}</button>
          <button className="btn" onClick={() => copy(S.qrText)} style={{ height: 38, padding: '0 16px', borderRadius: 9 }}>{T.copyText}</button>
        </div>
      </section>
    </Pair>
  );
}

type Kind = 'url' | 'wifi' | 'mail' | 'tel' | 'text';
const kindOf = (t: string): Kind =>
  /^https?:\/\//i.test(t) ? 'url' : /^wifi:/i.test(t) ? 'wifi' : /^(mailto:|[\w.+-]+@[\w-]+\.[\w.]+$)/i.test(t) ? 'mail' : /^tel:/i.test(t) ? 'tel' : 'text';

export function QrScan() {
  const { S, T, isMac, copy, decodeFile } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const sc = S.scan;
  const pick = () => fileRef.current?.click();
  const codes = sc && !sc.busy ? sc.codes : [];
  const pct = (a: number, b: number) => (a / b * 100).toFixed(2) + '%';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!sc ? (
        <button className="dropzone" onClick={pick}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 600, padding: '10px 18px', border: '1px solid var(--line2)', borderRadius: 12, background: 'var(--bg)', boxShadow: '0 2px 0 var(--line2)' }}>
            {isMac ? '⌘ V' : 'Ctrl V'}
          </span>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{T.dropTitle}</span>
          <span style={{ fontSize: 13, color: 'var(--mut)' }}>{T.dropSub}</span>
        </button>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
          <section className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ position: 'relative', lineHeight: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--sub)' }}>
              <img src={sc.src} alt="" style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 560, objectFit: 'contain' }} />
              {codes.map((c, i) => (
                <div key={i} style={{ position: 'absolute', left: pct(c.x, sc.w), top: pct(c.y, sc.h), width: pct(c.w, sc.w), height: pct(c.h, sc.h), border: '2px solid oklch(0.6 0.2 262)', borderRadius: 6, background: 'oklch(0.6 0.2 262 / .12)' }}>
                  <span className="mono" style={{ position: 'absolute', left: -2, top: -2, minWidth: 22, height: 22, padding: '0 6px', borderRadius: '6px 0 6px 0', background: 'oklch(0.52 0.2 262)', color: '#fff', fontSize: 12, fontWeight: 600, lineHeight: '22px', textAlign: 'center' }}>{i + 1}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12.5, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sc.name}</span>
              <button className="btn" onClick={pick} style={{ flex: 'none', fontSize: 12.5 }}>{T.another}</button>
            </div>
          </section>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 32 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{sc.busy ? T.scanning : sc.failed ? T.imgLoadFail : codes.length ? f(T.found, { n: codes.length }) : T.notFound}</span>
              {codes.length > 1 && <button className="btn" onClick={() => copy(codes.map((c) => c.text).join('\n'))} style={{ fontSize: 12.5 }}>{T.copyAll}</button>}
            </div>
            {!sc.busy && !sc.failed && !codes.length && (
              <div className="card" style={{ padding: 18, borderRadius: 12, fontSize: 13, color: 'var(--mut)', lineHeight: 1.6 }}>{T.notFoundSub}</div>
            )}
            {codes.map((c, i) => {
              const k = kindOf(c.text);
              return (
                <div key={i} className="card" style={{ borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ minWidth: 22, height: 22, padding: '0 6px', borderRadius: 6, background: 'var(--acc)', color: 'var(--accInk)', fontSize: 12, fontWeight: 600, lineHeight: '22px', textAlign: 'center' }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: 'var(--mut)', padding: '2px 8px', borderRadius: 999, background: 'var(--seg)' }}>{T.kinds[k]}</span>
                    {c.enc && <span style={{ fontSize: 12, color: 'var(--chg)', padding: '2px 8px', borderRadius: 999, background: 'var(--chgBg)' }}>{c.enc === 'browser' ? T.decodedByBrowser : f(T.decodedAs, { e: c.enc })}</span>}
                  </div>
                  <button className="qr-text" onClick={() => copy(c.text)} title={T.clickCopy}><Vis text={c.text} /></button>
                  {k === 'url' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <a href={c.text} target="_blank" rel="noopener noreferrer" className="btn"
                        style={{ padding: '0 14px', display: 'inline-flex', alignItems: 'center', fontSize: 12.5, color: 'var(--ink)', textDecoration: 'none' }}>{T.open} ↗</a>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
      <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }}
        onChange={(e) => { const fl = e.target.files?.[0]; if (fl) decodeFile(fl); e.target.value = ''; }} />
    </div>
  );
}
