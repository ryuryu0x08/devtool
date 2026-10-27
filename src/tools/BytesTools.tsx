// Bytes and numbers: Hex ⇄ text / bytes, gzip / deflate, integer bases.
import { useEffect, useMemo, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { Kv } from '../components/Kv';
import { Source } from '../components/Source';
import { useSettled } from '../components/useSettled';
import { BytesOut, Empty, ErrLine, Flag, Grid, NumIn, OutCard, TextOut, Toolbar, download, errStatus, useOpt } from '../components/Panes';
import { useFileBytes } from './Base64';
import { errInfo, textBytes, type ErrInfo } from '../lib/data';
import { b64decode, b64encode } from '../lib/b64';
import { HexError, bytesToHex, hexToBytes, looksHex, type HexPrefix, type HexSep } from '../lib/hex';
import { compress, decompress, sniffZ, type ZFmt } from '../lib/gzip';
import { NumError, readInt, widths, writeInt } from '../lib/numbase';

const HEX_MAX_MB = 10;
const GZ_MAX_MB = 200;
/** Compressed output longer than this (as Base64) is offered for download only. */
const SHOW_MB = 2;

export function Hex() {
  const { S, set, T, replace, toast } = useApp();
  const [mode, setMode] = useOpt<'enc' | 'dec'>('hex.mode', 'enc', ['enc', 'dec']);
  const [sep, setSep] = useOpt<HexSep>('hex.sep', ' ', ['', ' ', ':']);
  const [upper, setUpper] = useOpt('hex.upper', false);
  const [prefix, setPrefix] = useOpt<HexPrefix>('hex.prefix', '', ['', '0x', '\\x']);
  const [view, setView] = useOpt<'text' | 'hex'>('hex.view', 'text', ['text', 'hex']);
  const enc = mode === 'enc';
  const file = enc ? S.hexFile : null;
  const fb = useFileBytes(file, HEX_MAX_MB);
  const [text, pending] = useSettled(S.hexIn);

  const out = useMemo<{ hex: string; n: number } | { bad: true } | { err: string; info: ErrInfo } | { bytes: Uint8Array } | null>(() => {
    if (enc) {
      const b = file ? fb.bytes : textBytes(text, 'lf');
      if (b === null) return { bad: true };
      if (!b || (!file && !text)) return null;
      return { hex: bytesToHex(b, sep, upper, prefix), n: b.length };
    }
    try {
      const b = hexToBytes(text);
      return b && { bytes: b };
    } catch (e) {
      if (!(e instanceof HexError)) throw e;
      return { err: e.code === 'char' ? f(T.hex.char, { c: e.ch }) : T.hex.odd, info: errInfo(e, text) };
    }
  }, [enc, file, fb.bytes, text, sep, upper, prefix, T]);
  const loading = pending || (!!file && !fb.bytes && !fb.err);

  return (
    <div className="tool-stack">
      <Toolbar>
        <Seg value={mode} onChange={setMode} opts={[{ value: 'enc', label: T.hex.toHex }, { value: 'dec', label: T.hex.toText }]} />
        {enc && <>
          <Seg value={sep} onChange={setSep} opts={[{ value: '', label: T.hex.none }, { value: ' ', label: T.hex.space }, { value: ':', label: T.hex.colon }]} />
          <Seg value={prefix} onChange={setPrefix} mono opts={[{ value: '', label: '–' }, { value: '0x', label: '0x' }, { value: '\\x', label: '\\x' }]} />
          <Flag on={upper} label={T.ui.upper} onClick={() => setUpper(!upper)} />
        </>}
      </Toolbar>
      <Grid>
        <Source title={T.input} placeholder={enc ? T.hex.ph : T.hex.hexPh} text={S.hexIn}
          size={file ? '' : enc ? f(T.bytes, { n: (textBytes(S.hexIn, 'lf')?.length ?? 0).toLocaleString('en-US') }) : ''}
          onText={(v) => set({ hexIn: v })} file={file} onFile={enc ? (fl) => set({ hexFile: fl }) : undefined}
          onFirstPaste={(t) => {
            const m = looksHex(t) ? 'dec' : 'enc';
            if (m !== mode) { setMode(m); toast(f(T.ui.switched, { m: m === 'dec' ? T.hex.toText : T.hex.toHex }), 3000); }
          }}
          onClear={() => replace({ hexIn: '', hexFile: null })} />
        {out && 'bytes' in out && !loading
          ? <BytesOut bytes={out.bytes} view={view} onView={setView} name="bytes" />
          : (
            <OutCard bad={!!out && ('bad' in out || 'err' in out) || !!fb.err}
              status={loading ? T.processing : fb.err ? (fb.err === 'big' ? f(T.hex.tooBig, { n: HEX_MAX_MB }) : T.readFail) : !out ? T.result
                : 'bad' in out ? T.badText : 'err' in out ? errStatus(T, out.info) : 'hex' in out ? f(T.bytes, { n: out.n.toLocaleString('en-US') }) : T.result}>
              {loading || fb.err ? null : !out ? <Empty /> : 'err' in out ? <ErrLine msg={out.err} info={out.info} /> : 'hex' in out ? <TextOut text={out.hex} /> : null}
            </OutCard>
          )}
      </Grid>
    </div>
  );
}

const ZFMTS: { value: ZFmt; label: string }[] = [{ value: 'gzip', label: 'gzip' }, { value: 'deflate', label: 'zlib (deflate)' }, { value: 'deflate-raw', label: 'raw deflate' }];
const zName = (z: ZFmt) => ZFMTS.find((x) => x.value === z)!.label;

/** Compressed data typed as text: hex when it is hex, else Base64. */
function readData(s: string): Uint8Array | null {
  const t = s.trim();
  if (!t) return null;
  if (looksHex(t)) { try { return hexToBytes(t); } catch { /* try Base64 */ } }
  try { return b64decode(t)?.bytes ?? null; } catch { return null; }
}

/** Pasted text that is gzip / zlib data (Base64 or hex, with its header), to decompress rather than compress. */
export const looksZData = (t: string) => {
  if (t.trim().length < 16 || !/^[A-Za-z0-9+/=\s_:,-]+$/.test(t)) return false;
  const b = readData(t);
  return !!b && b.length >= 8 && sniffZ(b) !== 'deflate-raw';
};

type ZOut = { bytes: Uint8Array; inN: number; fmt: ZFmt } | { err: string } | null;

export function Gzip() {
  const { S, set, T, replace } = useApp();
  const [mode, setMode] = useOpt<'zip' | 'unzip'>('gz.mode', 'zip', ['zip', 'unzip']);
  const [fmt, setFmt] = useOpt<ZFmt>('gz.fmt', 'gzip', ['gzip', 'deflate', 'deflate-raw']);
  const [view, setView] = useOpt<'text' | 'hex'>('gz.view', 'text', ['text', 'hex']);
  const zip = mode === 'zip';
  const file = S.gzFile;
  const fb = useFileBytes(file, GZ_MAX_MB);
  const [text, pending] = useSettled(S.gzIn);
  const [res, setRes] = useState<{ key: unknown[]; out: ZOut }>({ key: [], out: null });
  const key = useMemo(() => [zip, file ? fb.bytes : text, fmt], [zip, file, fb.bytes, text, fmt]);

  useEffect(() => {
    let live = true;
    const done = (out: ZOut) => live && setRes({ key, out });
    const input = file ? fb.bytes : zip ? textBytes(text, 'lf') : readData(text);
    if (file && !fb.bytes) return;
    if (input === null) { done(!text.trim() ? null : { err: zip ? T.badText : T.gzip.notData }); return; }
    if (!input || (!file && !text)) { done(null); return; }
    const use = zip ? fmt : sniffZ(input);
    (zip ? compress(input, use) : decompress(input, use)).then(
      (bytes) => done({ bytes, inN: input.length, fmt: use }),
      () => done({ err: f(T.gzip.fail, { f: zName(use) }) }),
    );
    return () => { live = false; };
  }, [key, T]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = res.key === key ? res.out : undefined;
  const loading = pending || out === undefined && !fb.err;

  const ok = out && 'bytes' in out ? out : null;
  const ratio = ok ? f(T.gzip.ratio, { a: ok.inN.toLocaleString('en-US'), b: ok.bytes.length.toLocaleString('en-US'), p: ok.inN ? Math.round((ok.bytes.length / ok.inN) * 1000) / 10 : 0 }) : '';
  const tooLong = ok && zip && ok.bytes.length * 4 / 3 > SHOW_MB * 1024 * 1024;
  const b64 = useMemo(() => (ok && zip && !tooLong ? b64encode(ok.bytes) : ''), [ok, zip, tooLong]);
  const ext = (z: ZFmt) => (z === 'gzip' ? '.gz' : z === 'deflate' ? '.zz' : '.deflate');
  const baseName = file ? file.name.replace(/\.(gz|zz|deflate)$/i, '') : 'data';

  return (
    <div className="tool-stack">
      <Toolbar>
        <Seg value={mode} onChange={setMode} opts={[{ value: 'zip', label: T.gzip.zip }, { value: 'unzip', label: T.gzip.unzip }]} />
        {zip && <Seg value={fmt} onChange={setFmt} opts={ZFMTS} />}
      </Toolbar>
      <Grid>
        <Source title={T.input} placeholder={zip ? T.gzip.ph : T.gzip.unPh} text={S.gzIn}
          size={file ? '' : f(T.ui.chars, { n: [...S.gzIn].length.toLocaleString('en-US') })}
          onText={(v) => set({ gzIn: v })} file={file} onFile={(fl) => set({ gzFile: fl })}
          onFirstPaste={(t) => { if (mode === 'zip' && looksZData(t)) setMode('unzip'); }}
          onClear={() => replace({ gzIn: '', gzFile: null })} />
        {ok && !zip && !loading
          ? <BytesOut bytes={ok.bytes} view={view} onView={setView} name={baseName} status={f(T.gzip.detected, { f: zName(ok.fmt) }) + ' · ' + ratio} />
          : (
            <OutCard bad={!!out && 'err' in out || !!fb.err}
              status={fb.err ? (fb.err === 'big' ? f(T.gzip.tooBig, { n: GZ_MAX_MB }) : T.readFail) : loading ? T.processing : out && 'err' in out ? T.invalid : ok ? T.gzip.out64 + ' · ' + ratio : T.result}
              right={ok && <button className="btn sm" onClick={() => download(ok.bytes, baseName + ext(ok.fmt))}>{T.ui.download}</button>}
              notes={tooLong ? [f(T.gzip.dlOnly, { n: SHOW_MB })] : []}>
              {fb.err || loading ? null : out && 'err' in out ? <ErrLine msg={out.err} /> : ok ? (tooLong ? null : <TextOut text={b64} />) : <Empty />}
            </OutCard>
          )}
      </Grid>
    </div>
  );
}

const BASES = [2, 8, 10, 16] as const;

export function NumBase() {
  const { S, set, T, replace } = useApp();
  const [from, setFrom] = useOpt<string>('base.from', 'auto', ['auto', '2', '8', '10', '16', 'other']);
  const [other, setOther] = useOpt('base.other', 36);
  const base = from === 'auto' ? 'auto' : from === 'other' ? other : Number(from);
  const r = useMemo(() => {
    if (!S.numIn.trim()) return null;
    try { return { ...readInt(S.numIn, base) }; } catch (e) {
      if (!(e instanceof NumError)) throw e;
      const b = base === 'auto' ? 10 : base;
      return { err: e.code === 'char' ? f(T.base.e.char, { c: e.ch, n: b }) : T.base.e[e.code], info: errInfo(e, S.numIn) };
    }
  }, [S.numIn, base, T]);
  const name: Record<number, string> = { 2: T.base.bin, 8: T.base.oct, 10: T.base.dec, 16: T.base.hex };
  const ok = r && 'v' in r ? r : null;
  const rows: [string, string][] = ok ? [
    ...BASES.map((b) => [name[b], writeInt(ok.v, b)] as [string, string]),
    ...(from === 'other' && !BASES.includes(other as 2) ? [[f(T.base.baseN, { n: other }), writeInt(ok.v, other)] as [string, string]] : []),
    ['HEX', writeInt(ok.v, 16).toUpperCase()],
  ] : [];
  const w = ok ? widths(ok.v) : [];
  return (
    <div className="tool-stack">
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input data-autofocus="1" className="field line mono" value={S.numIn} spellCheck={false} placeholder={T.base.ph} aria-label={T.input}
            onChange={(e) => set({ numIn: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          {S.numIn && <button className="btn sm" onClick={() => replace({ numIn: '' })}>{T.clear}</button>}
        </div>
        <Toolbar>
          <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>{T.base.from}</span>
          <Seg size="sm" value={from} onChange={setFrom} opts={[{ value: 'auto', label: T.base.auto }, { value: '2', label: '2' }, { value: '8', label: '8' }, { value: '10', label: '10' }, { value: '16', label: '16' }, { value: 'other', label: T.base.other }]} />
          {from === 'other' && <NumIn label={T.base.from} value={other} min={2} max={36} onChange={setOther} />}
        </Toolbar>
      </section>
      {r && (
        <Grid>
          <OutCard status={ok ? f(T.base.readAs, { n: ok.base }) : errStatus(T, r.info)} bad={!ok}>
            {ok ? <div className="base-rows">{rows.map(([k, v]) => <Kv key={k} label={k} value={v} />)}</div> : <ErrLine msg={r.err!} info={r.info} />}
          </OutCard>
          {ok && w.length > 0 && (
            <OutCard status={T.base.widths}>
              <div className="base-widths">
                {w.map((x) => (
                  <div key={x.bits} style={{ marginBottom: 6 }}>
                    <Kv label={f(T.base.hexW, { n: x.bits })} value={x.hex} />
                    <Kv label={f(T.base.unsigned, { n: x.bits })} value={x.unsigned.toString()} />
                    <Kv label={f(T.base.signed, { n: x.bits })} value={x.signed.toString()} />
                  </div>
                ))}
              </div>
            </OutCard>
          )}
        </Grid>
      )}
    </div>
  );
}
