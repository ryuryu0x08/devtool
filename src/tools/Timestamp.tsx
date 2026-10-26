import { useEffect, useMemo, useState } from 'react';
import { COMMON_TZ, TZ_ZH, f } from '../i18n';
import { localTz, lsSet, useApp } from '../store';
import { Seg } from '../components/Seg';
import {
  daysIn, exactUnits, fmtISO, fmtWall, fracStr, hasMs, offLabel, parseTime, parseTs, relTime, resolveWall, tzOffset, tzParts, utc, type TsUnit,
} from '../lib/time';

interface Zone { id: string; hay: string }
let zoneCache: Zone[] | null = null;

/** All IANA zones with a lowercase search haystack (id, Chinese name, offset forms). */
function zones(): Zone[] {
  if (zoneCache) return zoneCache;
  let list: string[];
  try { list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone').slice(); }
  catch { list = COMMON_TZ.slice(); }
  if (!list.includes('UTC')) list.unshift('UTC');
  const now = Date.now();
  zoneCache = list.map((id) => {
    let off = 0;
    try { off = tzOffset(now, id); } catch { /* unknown zone */ }
    const m = Math.round(off / 60000);
    const hh = Math.trunc(m / 60);
    const ol = offLabel(off);
    return { id, hay: (id + ' ' + (TZ_ZH[id] || '') + ' ' + ol + ' ' + (m < 0 ? '-' : '+') + Math.abs(hh) + ' ' + ol.replace('−', '-')).toLowerCase().replace(/_/g, ' ') };
  });
  return zoneCache;
}

const safeOff = (now: number, id: string) => {
  try { return tzOffset(now, id); } catch { return 0; }
};

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function TzPicker({ now }: { now: number }) {
  const { S, set, T, lang } = useApp();
  const zoneLabel = (id: string) => (lang === 'zh' && TZ_ZH[id] ? TZ_ZH[id] : id === 'UTC' ? 'UTC' : id.split('/').pop()!.replace(/_/g, ' '));

  const setTz = (id: string) => {
    const rec = [id, ...S.tzRecent.filter((x) => x !== id)].slice(0, 5);
    lsSet('tz', id);
    lsSet('tzRecent', rec);
    set({ tz: id, tzRecent: rec, tzOpen: false, tzQ: '' });
  };

  type Row = { header: string } | { id: string };
  const rows = useMemo<Row[]>(() => {
    if (!S.tzOpen) return [];
    const q = S.tzQ.trim().toLowerCase();
    if (!q) {
      const seen = new Set<string>(), out: Row[] = [];
      const sec = (title: string, ids: string[]) => {
        ids = ids.filter((i) => !seen.has(i));
        if (!ids.length) return;
        out.push({ header: title });
        ids.forEach((i) => { seen.add(i); out.push({ id: i }); });
      };
      sec(T.tzLocal, [localTz]);
      sec(T.tzRecent, S.tzRecent);
      sec(T.tzCommon, COMMON_TZ);
      return out;
    }
    const qq = q.replace(/^utc/, '').trim() || q;
    return zones().filter((z) => z.hay.includes(q) || z.hay.includes(qq)).slice(0, 60).map((z) => ({ id: z.id }));
  }, [S.tzOpen, S.tzQ, S.tzRecent, T]);

  const close = () => set({ tzOpen: false, tzQ: '' });

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => set((s) => ({ tzOpen: !s.tzOpen, tzQ: '' }))} className="search-btn"
        style={{ gap: 8, height: 38, width: 'auto', padding: '0 12px 0 14px', borderRadius: 999, color: 'var(--ink)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--acc)' }} />
        <span style={{ fontWeight: 600 }}>{zoneLabel(S.tz)}</span>
        <span className="mono" style={{ color: 'var(--mut)' }}>{offLabel(safeOff(now, S.tz))}</span>
        <span style={{ color: 'var(--faint)' }}>▾</span>
      </button>
      {S.tzOpen && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div className="pop" style={{ position: 'absolute', right: 0, top: 46, zIndex: 41, width: 340, maxWidth: 'calc(100vw - 28px)' }}>
            <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
              <input autoFocus value={S.tzQ} onChange={(e) => set({ tzQ: e.target.value })} placeholder={T.tzSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    const it = rows.find((r) => 'id' in r) as { id: string } | undefined;
                    if (it) setTz(it.id);
                  }
                }}
                style={{ width: '100%', height: 36, padding: '0 12px', border: '1px solid var(--line2)', borderRadius: 8, background: 'var(--bg)', outline: 'none', fontSize: 13 }} />
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto', padding: 6 }}>
              {rows.map((r, i) =>
                'header' in r ? (
                  <div key={'h' + i} style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{r.header}</div>
                ) : (
                  <button key={r.id + i} className={'list-item' + (r.id === S.tz ? ' on' : '')} onClick={() => setTz(r.id)}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{zoneLabel(r.id)}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.id + (r.id === localTz ? T.tzLocalTag : '')}
                      </span>
                    </span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--mut)' }}>{offLabel(safeOff(now, r.id))}</span>
                    <span style={{ width: 14, color: 'var(--acc)', fontWeight: 600 }}>{r.id === S.tz ? '✓' : ''}</span>
                  </button>
                ),
              )}
              {!rows.length && <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>{T.tzNone}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KvRows({ rows }: { rows: [string, string][] }) {
  const { T, copy } = useApp();
  return (
    <>
      {rows.map(([label, value]) => (
        <button key={label} className="kv" onClick={() => copy(value)}>
          <span className="k">{label}</span><span className="v">{value}</span><span className="c">{T.copy}</span>
        </button>
      ))}
    </>
  );
}

export function Timestamp() {
  const { S, set, T, lang, copy, toast } = useApp();
  const now = useNow();
  const tz = S.tz;
  const zoneLabel = lang === 'zh' && TZ_ZH[tz] ? TZ_ZH[tz] : tz === 'UTC' ? 'UTC' : tz.split('/').pop()!.replace(/_/g, ' ');
  // Offset at the converted moment, not now — they differ across DST.
  const offAt = (ms: number) => offLabel(safeOff(ms, tz));
  const np = tzParts(now, tz);

  // Timestamp → date
  const r = parseTs(S.tsIn, S.tsUnit);
  const tsOk = hasMs(r) ? (r as { ms: number; sub: string; u: TsUnit; dig: number }) : null;
  const tsErr = r && 'err' in r ? T[r.err] : '';

  // Date → timestamp
  const m = parseTime(S.tmIn, tz, now);
  const tm = hasMs(m) ? (m as { ms: number; sub?: string; note?: string; alt?: number; gap?: boolean }) : null;

  const setMs = (ms: number) => set({ tmIn: fmtWall(ms, tz) });
  /** The current input's instant, with its sub-millisecond digits (adjusting must not drop them). */
  const base = () => {
    const x = parseTime(S.tmIn, tz, Date.now());
    return hasMs(x) ? { ms: x.ms, sub: (x as { sub?: string }).sub || '' } : { ms: Date.now(), sub: '' };
  };
  const setExact = (ms: number, sub: string) => set({ tmIn: fmtWall(ms, tz, true, sub) });
  /** Set a wall-clock time; if DST makes it not exist, say what it became instead. */
  const setWall = (y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, sub: string) => {
    const w = resolveWall(y, mo, d, h, mi, s, ms, tz);
    setExact(w.ms, sub);
    if (w.gap) toast(f(T.dstShifted, { t: fmtWall(w.ms, tz) }), 6000);
  };
  // ±1 day keeps the wall-clock time (24 h would drift by an hour across DST).
  const shiftDays = (n: number) => {
    const b = base(), p = tzParts(b.ms, tz);
    setWall(p.y, p.m, p.d + n, p.h, p.mi, p.s, p.ms, b.sub);
  };
  const shiftHours = (n: number) => { const b = base(); setExact(b.ms + n * 36e5, b.sub); };
  const quick: [string, () => void][] = [
    [T.q.now, () => setMs(Date.now())],
    [T.q.today, () => setWall(np.y, np.m, np.d, 0, 0, 0, 0, '')],
    [T.q.tomorrow, () => setWall(np.y, np.m, np.d + 1, 0, 0, 0, 0, '')],
    [T.q.month, () => setWall(np.y, np.m, 1, 0, 0, 0, 0, '')],
    [T.q.m1d, () => shiftDays(-1)],
    [T.q.m1h, () => shiftHours(-1)],
    [T.q.p1h, () => shiftHours(1)],
    [T.q.p1d, () => shiftDays(1)],
  ];

  /** ↑ / ↓ adjusts the segment under the caret (canonical format) or minutes; ⇧ adjusts hours. */
  const onTmKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const el = e.currentTarget;
    const pos = el.selectionStart || 0;
    const b = base(), p = tzParts(b.ms, tz);
    const canonF = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(S.tmIn);
    let seg = canonF ? (pos <= 4 ? 0 : pos <= 7 ? 1 : pos <= 10 ? 2 : pos <= 13 ? 3 : pos <= 16 ? 4 : 5) : 4;
    if (e.shiftKey) seg = 3;
    const a = [p.y, p.m, p.d, p.h, p.mi, p.s];
    a[seg] += dir;
    if (seg <= 1) {
      const dt = new Date(utc(a[0], a[1], 1));
      const dim = daysIn(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
      if (a[2] > dim) a[2] = dim;
    }
    setWall(a[0], a[1], a[2], a[3], a[4], a[5], p.ms, b.sub);
    requestAnimationFrame(() => { try { el.setSelectionRange(pos, pos); } catch { /* detached */ } });
  };

  const nowS = String(Math.floor(now / 1000)), nowWall = fmtWall(now, tz);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--mut)' }}>
          <span style={{ marginRight: 2 }}>{T.now}</span>
          {/* Text that changes every second can't be selected, so each value is a copy button. */}
          {[nowS, String(now), nowWall].map((v, i) => (
            <button key={i} className="btn mono now-btn" title={T.copy} onClick={() => copy(v)}
              style={{ height: 30, padding: '0 10px', borderColor: 'var(--line)', color: 'var(--ink)' }}>{v}</button>
          ))}
          <span>{T.wd[np.wd]}</span>
        </div>
        <TzPicker now={now} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))' }}>
        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{T.ts2t} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>→</span> {T.t2ts}</h2>
            <Seg size="sm" value={S.tsUnit} onChange={(u) => set({ tsUnit: u })}
              opts={[{ value: 'auto', label: T.auto }, { value: 's', label: T.units.s }, { value: 'ms', label: T.units.ms }]} />
          </div>
          <input data-autofocus="1" className="field" value={S.tsIn} onChange={(e) => set({ tsIn: e.target.value })}
            inputMode="numeric" spellCheck={false} placeholder={T.tsPh} />
          {tsOk && (() => {
            const ms = tsOk.ms, sub = tsOk.sub, p = tzParts(ms, tz);
            const main = fmtWall(ms, tz);
            // Digits finer than a millisecond (µs / ns input) are shown, never dropped.
            const msPart = p.ms || sub ? '.' + fracStr(p.ms, sub) : '';
            const rows: [string, string][] = [
              [T.rowISO, fmtISO(ms, tz, sub)],
              [T.rowUTC, fmtWall(ms, 'UTC', true, sub)],
              [T.rowRel, relTime(ms, now, T.relLocale)],
              tsOk.u === 's' ? [T.units.ms, exactUnits(ms, sub, 0)] : [T.units.s, exactUnits(ms, sub, 3)],
            ];
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="hero" onClick={() => copy(main + msPart)}>
                  <span style={{ fontSize: 12, color: 'var(--mut)' }}>
                    {S.tsUnit === 'auto' ? f(T.detected, { u: T.units[tsOk.u], d: tsOk.dig }) : f(T.forced, { u: T.units[tsOk.u] })}
                  </span>
                  <span className="hero-big">{main}<span style={{ color: 'var(--faint)', fontWeight: 500 }}>{msPart}</span></span>
                  <span style={{ fontSize: 13, color: 'var(--mut)' }}>{T.wd[p.wd] + ' · ' + zoneLabel + ' ' + offAt(ms)}</span>
                </button>
                <KvRows rows={rows} />
              </div>
            );
          })()}
          {tsErr && <div style={{ fontSize: 13, color: 'var(--del)', padding: 2 }}>{tsErr}</div>}
          {!r && <div style={{ fontSize: 13, color: 'var(--faint)', padding: 2 }}>{T.tsEmpty}</div>}
        </section>

        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: '30px' }}>{T.t2ts} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>→</span> {T.ts2t}</h2>
          <input className="field" value={S.tmIn} onChange={(e) => set({ tmIn: e.target.value })} onKeyDown={onTmKey}
            spellCheck={false} placeholder={T.tmPh} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {quick.map(([label, fn]) => <button key={label} className="pill" onClick={fn}>{label}</button>)}
          </div>
          {tm && (() => {
            const ms = tm.ms, sub = tm.sub || '', p = tzParts(ms, tz);
            // Exact: a time with a fraction gives a fractional timestamp rather than a truncated one.
            const sec = exactUnits(ms, sub, 3);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="hero" onClick={() => copy(sec)}>
                  <span style={{ fontSize: 12, color: 'var(--mut)' }}>{f(T.parsedAs, { v: fmtWall(ms, tz, true, sub) + ' ' + T.wd[p.wd] })}</span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="hero-big">{sec}</span><span style={{ fontSize: 13, color: 'var(--mut)' }}>{T.sec}</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--mut)' }}>
                    {(tm.note ? tm.note + ' → ' : '') + zoneLabel + ' ' + offAt(ms) + ' · ' + relTime(ms, now, T.relLocale)}
                  </span>
                </button>
                {(tm.alt !== undefined || tm.gap) && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--chg)', background: 'var(--chgBg)', borderRadius: 8, padding: '8px 10px', margin: '2px 0 4px' }}>
                    {tm.alt !== undefined
                      ? f(T.dstTwice, { a: offAt(ms), b: offAt(tm.alt), s: exactUnits(tm.alt, sub, 3) })
                      : f(T.dstGap, { t: fmtWall(ms, tz) + ' ' + offAt(ms) })}
                  </div>
                )}
                <KvRows rows={[[T.units.ms, exactUnits(ms, sub, 0)], [T.rowISO, fmtISO(ms, tz, sub)], [T.rowUTC, fmtWall(ms, 'UTC', true, sub)]]} />
              </div>
            );
          })()}
          {m && 'err' in m && <div style={{ fontSize: 13, color: 'var(--del)', padding: 2, lineHeight: 1.5 }}>{T.tmErr}</div>}
        </section>
      </div>
    </div>
  );
}
