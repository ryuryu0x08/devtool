// UUID: generate v4 / v7 and inspect any UUID. Generated values are never stored.
import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { KvRows } from '../components/Kv';
import { ErrLine, Flag, Grid, NumIn, OutCard, TextOut, Toolbar, useOpt } from '../components/Panes';
import { fmtISO, fmtWall } from '../lib/time';
import { parseUuid, uuid4, uuid7 } from '../lib/uuid';

export function Uuid() {
  const { S, set, T, replace } = useApp();
  const [ver, setVer] = useOpt<string>('uuid.ver', '4', ['4', '7']);
  const [n, setN] = useOpt('uuid.n', 5);
  const [upper, setUpper] = useOpt('uuid.upper', false);
  const [noHyphen, setNoHyphen] = useOpt('uuid.noHyphen', false);
  const count = Math.min(1000, Math.max(1, n));
  const [seed, setSeed] = useState(0);
  const list = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: count }, () => (ver === '7' ? uuid7(now) : uuid4()));
  }, [ver, count, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = list.map((u) => { const x = noHyphen ? u.replace(/-/g, '') : u; return upper ? x.toUpperCase() : x; }).join('\n');

  const info = useMemo(() => (S.uuidIn.trim() ? parseUuid(S.uuidIn) : null), [S.uuidIn]);
  const rows: [string, string][] = [];
  if (info) {
    rows.push([T.uuid.canonical, info.canonical]);
    if (info.nil) rows.push([T.uuid.ver, T.uuid.nil]);
    else if (info.max) rows.push([T.uuid.ver, T.uuid.max]);
    else {
      rows.push([T.uuid.ver, (T.uuid.kinds as Record<string, string>)[String(info.version)] ?? 'v' + info.version]);
      rows.push([T.uuid.variant, T.uuid.variants[info.variant]]);
    }
    if (info.ms !== undefined) {
      rows.push([T.uuid.time, fmtWall(info.ms, S.tz, true, info.sub)]);
      rows.push([T.rowISO, fmtISO(info.ms, 'UTC', info.sub)]);
      rows.push([T.units.ms, String(info.ms)]);
    }
    if (info.clockSeq !== undefined) rows.push([T.uuid.clockSeq, String(info.clockSeq)]);
    if (info.node) rows.push([T.uuid.node, info.node]);
  }
  return (
    <Grid>
      <div className="tool-stack">
        <Toolbar>
          <Seg value={ver} onChange={setVer} opts={[{ value: '4', label: 'v4' }, { value: '7', label: 'v7' }]} />
          <NumIn label={T.ui.count} value={count} min={1} max={1000} onChange={setN} />
          <Flag on={upper} label={T.ui.upper} onClick={() => setUpper(!upper)} />
          <Flag on={noHyphen} label={T.uuid.noHyphen} onClick={() => setNoHyphen(!noHyphen)} />
          <button className="btn primary" onClick={() => setSeed(seed + 1)}>↻ {T.ui.regen}</button>
        </Toolbar>
        <OutCard className="uuid-gen" status={T.uuid.gen + ' · ' + count} notes={ver === '7' ? [T.uuid.v7note] : []}>
          <TextOut text={shown} />
        </OutCard>
      </div>
      <div className="tool-stack">
        <section className="card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="field line mono" value={S.uuidIn} spellCheck={false} placeholder={T.uuid.parsePh} aria-label={T.uuid.parse}
            onChange={(e) => set({ uuidIn: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          {S.uuidIn && <button className="btn sm" onClick={() => replace({ uuidIn: '' })}>{T.clear}</button>}
        </section>
        {S.uuidIn.trim() && (
          <OutCard className="uuid-info" status={info ? T.uuid.parse : T.invalid} bad={!info}>
            {info ? <KvRows rows={rows} /> : <ErrLine msg={T.uuid.notUuid} />}
          </OutCard>
        )}
      </div>
    </Grid>
  );
}
