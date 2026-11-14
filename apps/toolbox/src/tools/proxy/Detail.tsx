// One captured request: an overview, then the request and the response, each with its headers
// (a click copies a value; the title copies them all) and its body as the backend decoded it.
import { useEffect, useState } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import { Seg } from '../../components/Seg';
import { CopyBlock, Kv } from '../../components/Kv';
import { TextOut, downloadBlob, useOpt } from '../../components/Panes';
import type { HlLang } from '../../lib/highlight';
import { fmtWall } from '../../lib/time';
import type { Body, Flow, Part, ProxyBackend } from '../../lib/proxy/backend';
import { contentType, duration, formatDuration, formatSize, header, headText } from '../../lib/proxy/flows';
import { useBackendError } from './errors';

type View = 'overview' | Part;

export default function Detail({ b, flow }: { b: ProxyBackend; flow: Flow }) {
  const { T, S, copy, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [view, setView] = useOpt<View>('proxy.view', 'overview', ['overview', 'request', 'response']);
  const http = flow.kind === 'http';

  // Made when the request is opened, so the click copies it at once: browsers (Safari) refuse to
  // write the clipboard once the click has waited for the network.
  const [cmd, setCmd] = useState<{ id: string; text?: string; err?: string } | null>(null);
  useEffect(() => {
    if (!http) return;
    let off = false;
    b.curl(flow.id).then((text) => { if (!off) setCmd({ id: flow.id, text }); }, (e) => { if (!off) setCmd({ id: flow.id, err: errText(e) }); });
    return () => { off = true; };
  }, [b, flow.id, http]); // eslint-disable-line react-hooks/exhaustive-deps
  const curl = async () => {
    const ready = cmd?.id === flow.id ? cmd : null;
    if (ready?.text !== undefined) { copy(ready.text, P.curlCopied); return; }
    if (ready?.err) { toast(f(P.curlFailed, { d: ready.err }), 6000); return; }
    try { copy(await b.curl(flow.id), P.curlCopied); } catch (e) { toast(f(P.curlFailed, { d: errText(e) }), 6000); }
  };

  return (
    <div className="px-d">
      <div className="px-d-head">
        <CopyBlock value={flow.url} className="px-d-url"><b>{flow.method}</b> {flow.url}</CopyBlock>
        {http && <button className="btn sm" onClick={() => void curl()}>{P.curl}</button>}
      </div>
      {http && (
        <Seg size="sm" value={view} onChange={setView}
          opts={[{ value: 'overview', label: P.overview }, { value: 'request', label: P.request }, { value: 'response', label: P.response }]} />
      )}
      <div className="px-d-body">
        {!http || view === 'overview' ? <Overview flow={flow} tz={S.tz} /> : <Message b={b} flow={flow} part={view} />}
      </div>
    </div>
  );
}

function Overview({ flow, tz }: { flow: Flow; tz: string }) {
  const { T } = useApp();
  const P = T.px;
  const r = flow.response;
  const rows: [string, string][] = [
    [P.url, flow.url],
    [P.method, flow.method],
    [P.status, r ? `${r.status} ${r.reason}`.trim() : flow.error ? '' : flow.kind === 'http' ? P.waiting : ''],
    [P.started, fmtWall(flow.created, tz, true)],
    [P.duration, formatDuration(duration(flow))],
    [P.reqSize, formatSize(flow.request?.size)],
    [P.resSize, formatSize(r?.size)],
    [P.httpVersion, flow.request?.httpVersion ?? ''],
    [P.client, flow.client],
    [P.server, flow.server ?? ''],
    [P.tls, flow.tls ?? ''],
  ];
  return (
    <div className="px-kvs">
      {flow.error && <div className="px-err">{f(P.error, { e: flow.error })}</div>}
      {flow.kind !== 'http' && <div className="px-faint">{f(P.notHttp, { k: flow.kind.toUpperCase() })}</div>}
      {(flow.websocket || flow.replay) && <div className="px-faint">{[flow.websocket && P.websocket, flow.replay && P.replay].filter(Boolean).join(' · ')}</div>}
      {rows.filter(([, v]) => v).map(([k, v]) => <Kv key={k} label={k} value={v} />)}
    </div>
  );
}

function Message({ b, flow, part }: { b: ProxyBackend; flow: Flow; part: Part }) {
  const { T, copy } = useApp();
  const P = T.px;
  const m = part === 'request' ? flow.request : flow.response;
  if (!m) {
    return <div className="px-faint">{flow.error ? f(P.error, { e: flow.error }) : P.waiting}</div>;
  }
  const head = headText(flow, part);
  return (
    <div className="px-kvs">
      <button className="px-sub" onClick={() => copy(head)} title={part === 'request' ? P.copyHead : P.copyHeadRes}>
        {f(P.headers, { n: m.headers.length })}
      </button>
      <div className="px-head-line mono">{head.split('\n')[0]}</div>
      {m.headers.map(([k, v], i) => <Kv key={i} label={k} value={v} />)}
      <BodyView b={b} flow={flow} part={part} />
    </div>
  );
}

const langOf = (view: string): HlLang | undefined => (/JSON/i.test(view) ? 'json' : /XML|HTML/i.test(view) ? 'xml' : undefined);

function BodyView({ b, flow, part }: { b: ProxyBackend; flow: Flow; part: Part }) {
  const { T } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const m = part === 'request' ? flow.request : flow.response;
  const key = m?.bodyHash ? `${flow.id}/${part}/${m.bodyHash}` : null;
  const [got, setGot] = useState<{ key: string; body?: Body; err?: string; img?: string } | null>(null);
  const image = part === 'response' && /^image\//.test(header(m, 'content-type') ?? '');

  useEffect(() => {
    if (!key) return;
    let off = false;
    let url = '';
    (async () => {
      try {
        const body = await b.body(flow.id, part);
        if (image) url = URL.createObjectURL(await b.raw(flow.id, part));
        if (!off) setGot({ key, body, img: url || undefined });
      } catch (e) {
        if (!off) setGot({ key, err: errText(e) });
      }
    })();
    return () => { off = true; if (url) URL.revokeObjectURL(url); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const name = flow.path.split('?')[0].split('/').pop() || `${part}.bin`;
    downloadBlob(await b.raw(flow.id, part), name);
  };

  if (!m || !key) return <div className="px-sub plain">{P.noBody}</div>;
  const cur = got?.key === key ? got : null;
  const ct = part === 'response' ? contentType(flow) : (header(m, 'content-type') ?? '').split(';')[0];
  return (
    <div className="px-body">
      <div className="px-body-head">
        <span className="px-sub plain">
          {f(P.body, { s: formatSize(m.size) })}{ct ? ' · ' + ct : ''}{cur?.body ? ' · ' + f(P.bodyView, { v: cur.body.view }) : ''}
        </span>
        <button className="btn sm" onClick={() => void save()}>{P.raw}</button>
      </div>
      {!cur && <div className="px-faint">{P.loading}</div>}
      {cur?.err && <div className="px-err">{f(P.bodyFailed, { d: cur.err })}</div>}
      {cur?.img && <img className="px-img" src={cur.img} alt="" />}
      {cur?.body && (cur.body.text ? <TextOut text={cur.body.text} lang={langOf(cur.body.view)} /> : null)}
      {cur?.body?.truncated && <div className="px-faint">{f(P.truncated, { n: cur.body.text.split('\n').length })}</div>}
    </div>
  );
}
