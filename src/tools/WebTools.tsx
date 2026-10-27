// Link parts and JWT decoding.
import { useEffect, useMemo, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Kv, KvRows } from '../components/Kv';
import { Empty, ErrLine, Grid, OutCard, TextIn, TextOut } from '../components/Panes';
import { useNow } from './Timestamp';
import { fmtWall, offLabel, relTime, tzOffset } from '../lib/time';
import { parseUrl } from '../lib/url';
import { JwtError, decodeJwt, times, verifyJwt, type Verify } from '../lib/jwt';
import { dupKeys } from '../lib/json';
import { toHex } from '../lib/hash';

const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' };

export function UrlParse() {
  const { S, set, T, replace } = useApp();
  const p = useMemo(() => parseUrl(S.urlpIn), [S.urlpIn]);
  const u = p?.url;
  const rows: [string, string][] = [];
  const notes: string[] = [];
  if (u && p) {
    if (p.assumed) notes.push(T.urlp.assumed);
    if (p.normalized) notes.push(T.urlp.normalized);
    let pathDec = u.pathname;
    try { pathDec = decodeURIComponent(u.pathname); } catch { /* keep encoded */ }
    rows.push(
      [T.urlp.protocol, u.protocol.replace(/:$/, '')],
      ...(u.username ? [[T.urlp.username, u.username] as [string, string]] : []),
      ...(u.password ? [[T.urlp.password, u.password] as [string, string]] : []),
      [T.urlp.host, u.hostname],
      [T.urlp.port, u.port || (DEFAULT_PORT[u.protocol] ? f(T.urlp.defPort, { p: DEFAULT_PORT[u.protocol] }) : '')],
      [T.urlp.path, u.pathname],
      ...(pathDec !== u.pathname ? [[T.urlp.pathDec, pathDec] as [string, string]] : []),
      [T.urlp.query, u.search],
      [T.urlp.hash, u.hash],
      ...(u.origin !== 'null' ? [[T.urlp.origin, u.origin] as [string, string]] : []),
      ...(p.normalized ? [['URL', p.normalized] as [string, string]] : []),
    );
  }
  return (
    <div className="tool-stack">
      <section className="card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-autofocus="1" className="field line mono" value={S.urlpIn} spellCheck={false} placeholder={T.urlp.ph}
          onChange={(e) => set({ urlpIn: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
        {S.urlpIn && <button className="btn sm" onClick={() => replace({ urlpIn: '' })}>{T.clear}</button>}
      </section>
      {!S.urlpIn.trim() ? null : !u || !p ? (
        <OutCard status={T.invalid} bad><ErrLine msg={T.urlp.notUrl} /></OutCard>
      ) : (
        <Grid>
          <OutCard status={u.host || u.protocol} notes={notes}>
            <div className="urlp-parts"><KvRows rows={rows.filter(([, v]) => v !== '')} /></div>
          </OutCard>
          <OutCard status={f(T.urlp.params, { n: p.params.length })}>
            {p.params.length
              ? <div className="urlp-params">{p.params.map(([k, v], i) => <Kv key={i} label={k || '""'} value={v} />)}</div>
              : <Empty>{T.urlp.noParams}</Empty>}
          </OutCard>
        </Grid>
      )}
    </div>
  );
}

export function Jwt() {
  const { S, set, T, replace } = useApp();
  const now = useNow();
  const r = useMemo(() => {
    if (!S.jwtIn.trim()) return null;
    try { return { j: decodeJwt(S.jwtIn) }; } catch (e) {
      if (!(e instanceof JwtError)) throw e;
      return { err: f(T.jwt.e[e.code], { n: e.part + 1 }) };
    }
  }, [S.jwtIn, T]);
  const j = r?.j;
  const [ver, setVer] = useState<{ key: string; signed: string; v: Verify } | null>(null);
  useEffect(() => {
    if (!j || !S.jwtKey || j.alg === 'none') return;
    let live = true;
    verifyJwt(j, S.jwtKey).then((v) => live && setVer({ key: S.jwtKey, signed: j.signed + toHex(j.sig), v }));
    return () => { live = false; };
  }, [j, S.jwtKey]);
  const v = j && ver && ver.key === S.jwtKey && ver.signed === j.signed + toHex(j.sig) ? ver.v : null;

  const tz = S.tz;
  const when = (ms: number) => {
    let off = '';
    try { off = offLabel(tzOffset(ms, tz)); } catch { /* invalid instant */ }
    return Number.isFinite(new Date(ms).getTime()) ? fmtWall(ms, tz) + ' ' + off + ' · ' + relTime(ms, now, T.relLocale) : String(ms / 1000);
  };
  const t = j ? times(j.payload.obj) : {};
  const state = t.exp !== undefined && t.exp <= now ? T.jwt.expired : t.nbf !== undefined && t.nbf > now ? T.jwt.notYet : t.exp !== undefined || t.nbf !== undefined ? T.jwt.valid : '';
  const notes: string[] = [];
  if (j) {
    for (const [name, part] of [[T.jwt.header, j.header], [T.jwt.payload, j.payload]] as const) {
      const d = dupKeys(part.ast);
      if (d.length) notes.push(f(T.jwt.dup, { p: name + ' ' + d.join(', ') }));
    }
    if (j.alg === 'none') notes.push(T.jwt.none);
  }
  const timeRows: [string, string][] = [];
  if (t.exp !== undefined) timeRows.push([T.jwt.exp, when(t.exp)]);
  if (t.iat !== undefined) timeRows.push([T.jwt.iat, when(t.iat)]);
  if (t.nbf !== undefined) timeRows.push([T.jwt.nbf, when(t.nbf)]);

  return (
    <div className="tool-stack">
      <Grid>
        <TextIn title={T.input} value={S.jwtIn} placeholder={T.jwt.ph} minH={160} onChange={(x) => set({ jwtIn: x })} onClear={() => replace({ jwtIn: '' })} />
        <OutCard status={!r ? T.result : r.err ? T.invalid : f(T.jwt.alg, { a: j!.alg || '?' }) + (state ? ' · ' + state : '')}
          bad={!!r?.err || state === T.jwt.expired} notes={notes}>
          {!r ? <Empty /> : r.err ? <ErrLine msg={r.err} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {timeRows.length > 0 && <div className="jwt-times"><KvRows rows={timeRows} /></div>}
              <div className="jwt-part"><div className="part-label">{T.jwt.payload}</div><TextOut text={j!.payload.text} /></div>
              <div className="jwt-part"><div className="part-label">{T.jwt.header}</div><TextOut text={j!.header.text} /></div>
              {j!.sig.length > 0 && <Kv label={T.jwt.sig + ' (hex)'} value={toHex(j!.sig)} />}
            </div>
          )}
        </OutCard>
      </Grid>
      {j && j.alg !== 'none' && (
        <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{T.jwt.verify}</span>
            {S.jwtKey && (
              <span className="jwt-verify" style={{ fontSize: 13, fontWeight: 600, color: v === 'ok' ? 'var(--add)' : v ? 'var(--del)' : 'var(--mut)' }}>
                {!v ? T.processing : v === 'unsupported' ? f(T.jwt.unsupported, { a: j.alg }) : T.jwt[v]}
              </span>
            )}
          </div>
          <textarea className="area field-area" value={S.jwtKey} spellCheck={false} placeholder={T.jwt.keyPh} aria-label={T.jwt.verify}
            onChange={(e) => set({ jwtKey: e.target.value })}
            style={{ minHeight: 64, padding: '10px 12px', font: "12.5px/1.5 'Geist Mono', monospace", border: '1px solid var(--line)', borderRadius: 8 }} />
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>{T.jwt.keyNote}</span>
        </section>
      )}
    </div>
  );
}
