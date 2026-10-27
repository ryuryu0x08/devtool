// Cron expressions (description, next runs in the chosen zone) and colours (formats, contrast).
import { useMemo } from 'react';
import { TZ_ZH, f } from '../i18n';
import { useApp, type State } from '../store';
import { Seg } from '../components/Seg';
import { Kv, KvRows } from '../components/Kv';
import { ErrLine, Grid, OutCard, Toolbar, useOpt } from '../components/Panes';
import { TzPicker, useNow } from './Timestamp';
import { CronBuilder } from './CronBuilder';
import { errInfo, type ErrInfo } from '../lib/data';
import { fmtWall, offLabel, tzOffset, tzParts } from '../lib/time';
import { CronError, describe, guessDialect, nextRuns, parseCron, type Cron as CronT, type Dialect } from '../lib/cron';
import { contrast, formats, parseColor, type Rgba } from '../lib/color';

const KINDS: Record<Dialect, (keyof typeof FIELD_KEYS)[]> = {
  unix: ['min', 'hour', 'dom', 'mon', 'dow'],
  spring: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'],
  quartz: ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year'],
};
const FIELD_KEYS = { sec: 0, min: 0, hour: 0, dom: 0, mon: 0, dow: 0, year: 0 };

/** Offset of the i-th whitespace-separated field in s. */
function fieldPos(s: string, i: number): number {
  const re = /\S+/g;
  let m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) { if (k++ === i) return m.index; }
  return 0;
}

export function Cron() {
  const { S, set, T, replace, lang, copy } = useApp();
  const now = useNow();
  const [mode, setMode] = useOpt<string>('cron.dialect', 'auto', ['auto', 'unix', 'spring', 'quartz']);
  const expr = S.cronIn;
  const dialect: Dialect = mode === 'auto' ? guessDialect(expr) : (mode as Dialect);
  const minute = Math.floor(now / 60000);
  type R = { c: CronT; desc: string; next: ReturnType<typeof nextRuns> } | { msg: string; info: ErrInfo | null } | null;
  const r = useMemo((): R => {
    if (!expr.trim()) return null;
    try {
      const c = parseCron(expr, dialect);
      return { c, desc: describe(c, lang), next: nextRuns(c, S.tz, Date.now(), 10) };
    } catch (e) {
      if (!(e instanceof CronError)) throw e;
      const want = dialect === 'unix' ? '5' : dialect === 'spring' ? '6' : '6–7';
      const kind = KINDS[dialect][e.field];
      // "第 2 个字段（时）" / "field 2 (hour)"
      const i = lang === 'zh' ? '第 ' + (e.field + 1) + ' 个字段' + (kind ? '（' + T.cron.fields[kind] + '）' : '') : 'field ' + (e.field + 1) + (kind ? ' (' + T.cron.fields[kind] + ')' : '');
      const msg = f(T.cron.e[e.code], { i, t: e.token, w: want, n: e.field });
      return { msg, info: e.code === 'count' || e.code === 'quartzQ' || !kind ? null : errInfo({ pos: expr.indexOf(e.token, fieldPos(expr, e.field)) }, expr) };
    }
    // Next runs are recomputed each minute.
  }, [expr, dialect, S.tz, lang, T, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = r && 'c' in r ? r : null;
  const zoneLabel = lang === 'zh' && TZ_ZH[S.tz] ? TZ_ZH[S.tz] : S.tz;
  const notes: string[] = [];
  if (ok) {
    if (mode === 'auto' && !ok.c.macro) notes.push(f(T.cron.as, { d: T.cron[ok.c.dialect] }));
    const f2 = ok.c.f;
    // Both day fields restricted: say which rule decides (implementations differ for Unix "*/n").
    if (!ok.c.reboot && f2.dom && f2.dow && !f2.dom.any && !f2.dow.any) {
      if (ok.c.dialect !== 'unix') notes.push(f(T.cron.andRule, { d: T.cron[ok.c.dialect] }));
      else notes.push(f2.dom.star || f2.dow.star ? T.cron.starAnd : T.cron.unixOr);
    }
    if (ok.next.skipped) notes.push(f(T.cron.skipped, { n: ok.next.skipped }));
    if (ok.next.runs.some((x) => x.repeated)) notes.push(T.cron.repeated);
  }
  const runRow = (ms: number) => {
    let off = '';
    try { off = offLabel(tzOffset(ms, S.tz)); } catch { /* invalid zone */ }
    return fmtWall(ms, S.tz) + ' ' + T.wd[tzParts(ms, S.tz).wd] + ' ' + off;
  };
  return (
    <div className="tool-stack">
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input data-autofocus="1" className="field line mono" value={expr} spellCheck={false} placeholder={T.cron.ph} aria-label={T.input}
            onChange={(e) => set({ cronIn: e.target.value })} style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono', monospace" }} />
          {expr && <button className="btn sm" onClick={() => replace({ cronIn: '' })}>{T.clear}</button>}
        </div>
        <Toolbar>
          <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>{T.cron.dialect}</span>
          <Seg size="sm" value={mode} onChange={setMode} opts={[{ value: 'auto', label: T.cron.auto }, { value: 'unix', label: T.cron.unix }, { value: 'spring', label: T.cron.spring }, { value: 'quartz', label: T.cron.quartz }]} />
          <span style={{ flex: 1 }} />
          <TzPicker now={now} />
        </Toolbar>
      </section>
      <CronBuilder expr={expr} dialect={dialect} onExpr={(e) => set({ cronIn: e })} />
      {r && ('c' in r ? (
        <OutCard className="cron-out" status={f(T.cron.next, { n: r.next.runs.length || 10, z: zoneLabel })} notes={notes}>
          <button className="hero cron-desc" title={T.clickCopy} onClick={() => copy(r.c.reboot ? T.cron.reboot : r.desc)} style={{ marginBottom: 8 }}>
            <span className="hero-big" style={{ fontSize: 18 }}>{r.c.reboot ? T.cron.reboot : r.desc}</span>
          </button>
          {!r.c.reboot && (r.next.runs.length
            ? <div className="cron-runs">{r.next.runs.map((x, i) => <Kv key={i} label={'#' + (i + 1) + (x.repeated ? ' *' : '')} value={runRow(x.ms)} />)}</div>
            : <ErrLine msg={T.cron.none} />)}
        </OutCard>
      ) : (
        <OutCard status={T.invalid} bad><ErrLine msg={r.msg} info={r.info} /></OutCard>
      ))}
    </div>
  );
}

function ColorField({ k, label, focus }: { k: 'colorIn' | 'colorFg' | 'colorBg'; label: string; focus?: boolean }) {
  const { S, set, T } = useApp();
  const p = parseColor(S[k]);
  const hex = p ? formats({ ...p.c, a: 1 }).hex : '#000000';
  return (
    <label className="color-field" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
      {label && <span style={{ fontSize: 12.5, color: 'var(--mut)', whiteSpace: 'nowrap' }}>{label}</span>}
      <input type="color" value={hex} aria-label={T.color.pick + ' ' + label} title={T.color.pick}
        onChange={(e) => set({ [k]: e.target.value } as Partial<State>)}
        style={{ width: 36, height: 32, padding: 0, border: '1px solid var(--line)', borderRadius: 6, background: 'none', flex: 'none' }} />
      <input data-autofocus={focus ? '1' : undefined} className="field line mono" value={S[k]} spellCheck={false} placeholder={k === 'colorIn' ? T.color.ph : ''} aria-label={label || T.input}
        onChange={(e) => set({ [k]: e.target.value } as Partial<State>)}
        style={{ flex: 1, minWidth: 0, borderColor: S[k].trim() && !p ? 'var(--del)' : undefined }} />
    </label>
  );
}

const css = (c: Rgba) => `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255} / ${c.a})`;

export function Color() {
  const { S, set, T } = useApp();
  const p = useMemo(() => (S.colorIn.trim() ? parseColor(S.colorIn) : null), [S.colorIn]);
  const fg = parseColor(S.colorFg), bg = parseColor(S.colorBg);
  const ratio = fg && bg ? contrast(fg.c, { ...bg.c, a: 1 }) : null;
  const fm = p ? formats(p.c) : null;
  const notes = p ? [...(p.mapped ? [T.color.mapped] : []), ...(p.from === 'hsl' || p.from === 'oklch' ? [T.color.rounded] : [])] : [];
  const r2 = ratio === null ? '' : String(Math.floor(ratio * 100) / 100);
  const checks: [string, number][] = [[T.color.aa, 4.5], [T.color.aaLarge, 3], [T.color.aaa, 7], [T.color.aaaLarge, 4.5]];
  return (
    <div className="tool-stack">
      <section className="card" style={{ padding: 16 }}>
        <ColorField k="colorIn" label="" focus />
      </section>
      <Grid min={320}>
        {S.colorIn.trim() && (p && fm ? (
          <OutCard className="color-out" status={fm.hex} notes={notes}>
            <div className="swatch" style={{ marginBottom: 10 }}><div style={{ background: css(p.c) }} /></div>
            <KvRows rows={[['HEX', fm.hex], ['RGB', fm.rgb], ['HSL', fm.hsl], ['OKLCH', fm.oklch]]} />
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => set({ colorFg: fm.hex })}>→ {T.color.fg}</button>
              <button className="btn sm" onClick={() => set({ colorBg: fm.hex })}>→ {T.color.bg}</button>
            </div>
          </OutCard>
        ) : <OutCard status={T.invalid} bad><ErrLine msg={T.color.notColor} /></OutCard>)}
        <OutCard className="contrast-out" status={T.color.contrast + (ratio !== null ? ' · ' + f(T.color.ratio, { r: r2 }) : '')} bad={ratio === null}
          notes={fg && fg.c.a < 1 ? [T.color.alphaNote] : []}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ColorField k="colorFg" label={T.color.fg} />
            <ColorField k="colorBg" label={T.color.bg} />
            <div><button className="btn sm" onClick={() => set({ colorFg: S.colorBg, colorBg: S.colorFg })}>⇅ {T.ui.swap}</button></div>
            {fg && bg && ratio !== null ? (
              <>
                <div className="contrast-sample" style={{ background: css({ ...bg.c, a: 1 }), color: css(fg.c), borderRadius: 10, padding: '14px 16px', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 24, fontWeight: 600 }}>{T.color.sample}</div>
                  <div style={{ fontSize: 14 }}>{T.color.sample}</div>
                </div>
                <Kv label={T.color.contrast} value={f(T.color.ratio, { r: r2 })} />
                {checks.map(([label, min]) => (
                  <div key={label} className="contrast-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 12px' }}>
                    <span style={{ color: 'var(--mut)' }}>{label}</span>
                    <span style={{ fontWeight: 600, color: ratio >= min ? 'var(--add)' : 'var(--del)' }}>{ratio >= min ? T.color.pass : T.color.fail}</span>
                  </div>
                ))}
              </>
            ) : <ErrLine msg={T.color.notColor} />}
          </div>
        </OutCard>
      </Grid>
    </div>
  );
}
