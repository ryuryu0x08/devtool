// Visual cron editor: pick how often, then the time and days with clicks. It reads the expression
// and writes it back, so the two always agree; "Advanced" edits each field.
import { useMemo, useState, type ReactNode } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import type { Dialect } from '../lib/cron';
import { EVERY, LIMITS, presetOf, readExpr, toPreset, values, writeExpr, type FKind, type Model, type Part, type Preset } from '../lib/cronbuild';

const FREQ: Preset[] = ['minute', 'everyN', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const STEP_MIN = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
const STEP_HOUR = [1, 2, 3, 4, 6, 8, 12];
/** Monday first, as calendars here are. */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, '0');
const one = (p: Part) => (p.k === 'list' && p.v.length === 1 ? p.v[0] : null);
const isLast = (p: Part) => p.k === 'raw' && p.t.toUpperCase() === 'L';
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function Select({ value, options, onChange, label }: { value: number; options: [number, string][]; onChange: (n: number) => void; label: string }) {
  const opts = options.some(([v]) => v === value) ? options : [...options, [value, String(value)] as [number, string]].sort((a, b) => a[0] - b[0]);
  return (
    <select className="field cron-sel" value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}

/** Toggle buttons for values; the last one chosen can't be turned off. */
function Chips({ items, chosen, onChange, cols, label, keepOne }: {
  items: [number, string][]; chosen: number[]; onChange: (v: number[]) => void; cols: number; label: string; keepOne: string;
}) {
  return (
    <div className="cron-chips" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map(([v, t]) => {
        const on = chosen.includes(v);
        const only = on && chosen.length === 1;
        return (
          <button key={v} className={'chip-btn' + (on ? ' on' : '')} aria-pressed={on} title={only ? keepOne : undefined}
            onClick={() => { if (!only) onChange(on ? chosen.filter((x) => x !== v) : [...chosen, v].sort((a, b) => a - b)); }}>{t}</button>
        );
      })}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="cron-row"><span className="cron-row-label">{label}</span><div className="cron-row-body">{children}</div></div>
);

export function CronBuilder({ expr, dialect, onExpr }: { expr: string; dialect: Dialect; onExpr: (e: string) => void }) {
  const { T, lang } = useApp();
  const B = T.cron.b;
  const empty = !expr.trim();
  const model = useMemo(() => (empty ? null : readExpr(expr, dialect)), [expr, dialect, empty]);
  const [adv, setAdv] = useState(false);
  const preset: Preset | null = empty ? null : !model ? null : adv ? 'custom' : presetOf(model);
  const emit = (m: Model) => onExpr(writeExpr(m, dialect));
  const pick = (p: Preset) => {
    setAdv(p === 'custom');
    if (p !== 'custom' || empty) emit(toPreset(p === 'custom' ? 'daily' : p, model));
  };
  // Short weekday names fit seven chips on a phone: 一 … 日, Sun … Sat.
  const wd = (v: number) => T.wd[v].replace(/^周/, '');
  const monthName = (n: number) => (lang === 'zh' ? f(B.monthOf, { n }) : new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(Date.UTC(2000, n - 1, 1)));
  const label = (k: FKind, v: number) => (k === 'dow' ? wd(v) : k === 'mon' ? monthName(v) : String(v));

  const time = model && one(model.hour) !== null && one(model.min) !== null ? pad(one(model.hour)!) + ':' + pad(one(model.min)!) : '09:00';
  const timeRow = model && (
    <Row label={B.at}>
      <input type="time" className="field cron-time" value={time} aria-label={B.at}
        onChange={(e) => {
          const m = /^(\d{2}):(\d{2})/.exec(e.target.value);
          if (m) emit({ ...model, hour: { k: 'list', v: [+m[1]] }, min: { k: 'list', v: [+m[2]] } });
        }} />
    </Row>
  );

  let body: ReactNode = null;
  if (model && preset) {
    const m = model;
    switch (preset) {
      case 'everyN': {
        const n = m.min.k === 'step' ? m.min.n : 5;
        body = <Row label={B.every}><Select label={B.minutes} value={n} options={STEP_MIN.map((x) => [x, String(x)])} onChange={(x) => emit({ ...m, min: { k: 'step', from: 0, n: x, star: true } })} /><span>{B.minutes}</span></Row>;
        break;
      }
      case 'hourly': {
        const n = m.hour.k === 'step' ? m.hour.n : 1;
        body = (
          <Row label={B.every}>
            <Select label={B.hours} value={n} options={STEP_HOUR.map((x) => [x, String(x)])} onChange={(x) => emit({ ...m, hour: x === 1 ? EVERY : { k: 'step', from: 0, n: x, star: true } })} />
            <span>{B.hours}</span>
            <span className="cron-sep">{B.atMinute}</span>
            <Select label={B.atMinute} value={one(m.min) ?? 0} options={range(0, 59).map((x) => [x, pad(x)])} onChange={(x) => emit({ ...m, min: { k: 'list', v: [x] } })} />
            <span>{B.minuteUnit}</span>
          </Row>
        );
        break;
      }
      case 'daily': body = timeRow; break;
      case 'weekly': {
        const set = (v: number[]) => emit({ ...m, dow: { k: 'list', v } });
        body = (<>
          <Row label={T.cron.fields.dow}>
            <Chips label={T.cron.fields.dow} keepOne={B.keepOne} cols={7} items={DOW_ORDER.map((v) => [v, wd(v)])} chosen={values(m.dow)} onChange={set} />
            <div className="cron-quick">
              <button className="btn sm" onClick={() => set([1, 2, 3, 4, 5])}>{B.workdays}</button>
              <button className="btn sm" onClick={() => set([0, 6])}>{B.weekend}</button>
            </div>
          </Row>
          {timeRow}
        </>);
        break;
      }
      case 'monthly': {
        const last = isLast(m.dom);
        body = (<>
          <Row label={B.day}>
            <Chips label={B.day} keepOne={B.keepOne} cols={8} items={range(1, 31).map((v) => [v, String(v)])} chosen={last ? [] : values(m.dom)}
              onChange={(v) => emit({ ...m, dom: { k: 'list', v } })} />
            <button className={'btn sm cron-last' + (last ? ' on' : '')} aria-pressed={last} disabled={dialect === 'unix'} title={dialect === 'unix' ? B.lastDayUnix : undefined}
              onClick={() => emit({ ...m, dom: last ? { k: 'list', v: [1] } : { k: 'raw', t: 'L' } })}>{B.lastDay}</button>
          </Row>
          {timeRow}
        </>);
        break;
      }
      case 'yearly':
        body = (<>
          <Row label={T.cron.fields.mon}>
            <Chips label={T.cron.fields.mon} keepOne={B.keepOne} cols={6} items={range(1, 12).map((v) => [v, monthName(v)])} chosen={values(m.mon)} onChange={(v) => emit({ ...m, mon: { k: 'list', v } })} />
          </Row>
          <Row label={B.day}>
            <Select label={B.day} value={one(m.dom) ?? 1} options={range(1, 31).map((x) => [x, lang === 'zh' ? f(B.dayOf, { n: x }) : String(x)])} onChange={(x) => emit({ ...m, dom: { k: 'list', v: [x] } })} />
          </Row>
          {timeRow}
        </>);
        break;
      case 'custom': body = <Advanced m={m} dialect={dialect} emit={emit} label={label} />; break;
    }
  }

  return (
    <section className="card cron-builder" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{B.title}</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>{empty ? B.start : B.hint}</span>
      </div>
      {!empty && !model ? <div style={{ fontSize: 13, color: 'var(--chg)' }}>{B.cant}</div> : (<>
        <div className="cron-freq" role="radiogroup" aria-label={B.title}>
          {FREQ.map((p) => (
            <button key={p} role="radio" aria-checked={preset === p} className={'btn' + (preset === p ? ' on' : '')} onClick={() => pick(p)}>{B.freq[p]}</button>
          ))}
        </div>
        {body}
      </>)}
    </section>
  );
}

const FIELDS: Record<Dialect, FKind[]> = {
  unix: ['min', 'hour', 'dom', 'mon', 'dow'],
  spring: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'],
  quartz: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'],
};
const COLS: Record<FKind, number> = { sec: 10, min: 10, hour: 12, dom: 8, mon: 6, dow: 7 };

/** Every field on its own: every value, chosen values, a range, or a step. */
function Advanced({ m, dialect, emit, label }: { m: Model; dialect: Dialect; emit: (m: Model) => void; label: (k: FKind, v: number) => string }) {
  const { T } = useApp();
  const B = T.cron.b;
  const setPart = (k: FKind, p: Part) => {
    const next: Model = { ...m, [k]: p };
    // Quartz: day of month and day of week exclude each other.
    if (dialect === 'quartz' && p.k !== 'every') {
      if (k === 'dom') next.dow = EVERY;
      if (k === 'dow') next.dom = EVERY;
    }
    emit(next);
  };
  return (
    <div className="cron-adv">
      {dialect === 'quartz' && <div style={{ fontSize: 12, color: 'var(--faint)' }}>{B.quartzOne}</div>}
      {FIELDS[dialect].map((k) => {
        const p = m[k];
        const [lo, hi] = LIMITS[k];
        const all = (k === 'dow' ? DOW_ORDER : range(lo, hi)).map((v) => [v, label(k, v)] as [number, string]);
        const opts = range(lo, hi).map((v) => [v, label(k, v)] as [number, string]);
        const vals = values(p);
        const modeOpts = (['every', 'list', 'range', 'step'] as const).map((x) => ({ value: x as string, label: B.modes[x] }));
        if (p.k === 'raw') modeOpts.push({ value: 'raw', label: B.modes.raw });
        const to = (x: string) => {
          if (x === 'every') setPart(k, EVERY);
          else if (x === 'list') setPart(k, { k: 'list', v: vals.length ? vals : [p.k === 'step' ? p.from : lo] });
          else if (x === 'range') {
            const a = vals.length ? vals[0] : lo;
            setPart(k, { k: 'range', a, b: vals.length > 1 ? vals[vals.length - 1] : Math.min(hi, a + (k === 'dow' ? 4 : 1)) });
          }
          else if (x === 'step') setPart(k, { k: 'step', from: lo, n: 2, star: true });
        };
        return (
          <div key={k} className="cron-field">
            <div className="cron-field-head">
              <span className="cron-row-label">{T.cron.fields[k]}</span>
              <Seg size="sm" value={p.k} onChange={to} opts={modeOpts} />
            </div>
            {p.k === 'list' && <Chips label={T.cron.fields[k]} keepOne={B.keepOne} cols={COLS[k]} items={all} chosen={p.v} onChange={(v) => setPart(k, { k: 'list', v })} />}
            {p.k === 'range' && (
              <div className="cron-inline">
                <span>{B.from}</span>
                <Select label={B.from} value={p.a} options={opts} onChange={(a) => setPart(k, { k: 'range', a, b: Math.max(a, p.b) })} />
                <span>{B.to}</span>
                <Select label={B.to} value={p.b} options={opts} onChange={(b) => setPart(k, { k: 'range', a: Math.min(p.a, b), b })} />
              </div>
            )}
            {p.k === 'step' && (
              <div className="cron-inline">
                <span>{B.every}</span>
                <Select label={B.every} value={p.n} options={range(1, hi - lo + 1).map((v) => [v, String(v)])} onChange={(n) => setPart(k, { ...p, n })} />
                <span>{B.startAt}</span>
                <Select label={B.startAt} value={p.from} options={opts} onChange={(from) => setPart(k, { ...p, from, star: from === lo })} />
              </div>
            )}
            {p.k === 'raw' && (
              <div className="cron-inline">
                <input className="field line mono" value={p.t} spellCheck={false} aria-label={T.cron.fields[k]} style={{ maxWidth: 220 }}
                  onChange={(e) => { const t = e.target.value.trim(); if (t) setPart(k, { k: 'raw', t }); }} />
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>{B.rawNote}</span>
              </div>
            )}
          </div>
        );
      })}
      {m.year && <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>{B.year}: <span className="mono">{m.year}</span></div>}
    </div>
  );
}
