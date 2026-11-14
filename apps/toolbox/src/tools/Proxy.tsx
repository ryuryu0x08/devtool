// Proxy & capture: a capture backend (lib/proxy/backend.ts; mitmproxy-addons for now) seen and
// driven from here: its captured requests, the system proxy, its root certificate and its scripts.
// Loaded only when opened.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { CopyBlock } from '../components/Kv';
import { useOpt } from '../components/Panes';
import { BackendError, type BackendInfo, type ProxyBackend, type SystemProxy } from '../lib/proxy/backend';
import { MitmproxyBackend } from '../lib/proxy/mitmproxy';
import { DEFAULT_API, onConnection, parseConnection, saveConnection, savedConnection, type Connection } from '../lib/proxy/connection';
import Capture from './proxy/Capture';
import Cert from './proxy/Cert';
import Scripts from './proxy/Scripts';
import { useBackendError } from './proxy/errors';

type Tab = 'capture' | 'cert' | 'scripts';
/** While the backend can't be reached, try again this often (it may be starting). */
const RETRY_MS = 3000;
/** The system proxy can be changed behind our back (Clash re-applying its own): look again this often. */
const SYS_POLL_MS = 5000;

/** The one place that picks the implementation. */
const backendFor = (c: Connection): ProxyBackend => new MitmproxyBackend(c.api, c.token);

type Status =
  | { s: 'idle' }
  | { s: 'connecting' }
  | { s: 'error'; e: BackendError }
  | { s: 'on'; b: ProxyBackend; info: BackendInfo };

export default function Proxy() {
  const { T } = useApp();
  const P = T.px;
  const [conn, setConn] = useState<Connection>(savedConnection);
  const [st, setSt] = useState<Status>({ s: 'idle' });
  const attempt = useRef(0);

  const connect = useCallback(async (c: Connection) => {
    const mine = ++attempt.current;
    setSt((o) => (o.s === 'error' ? o : { s: 'connecting' }));
    const b = backendFor(c);
    try {
      const info = await b.info();
      if (mine === attempt.current) setSt({ s: 'on', b, info });
    } catch (e) {
      if (mine === attempt.current) setSt({ s: 'error', e: e instanceof BackendError ? e : new BackendError('failed', String(e)) });
    }
  }, []);

  // A saved token connects at once; a link opened or a token pasted later connects too.
  useEffect(() => {
    if (conn.token) void connect(conn);
    return onConnection((c) => { setConn(c); void connect(c); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Not running yet (or an older version still is): keep trying, so starting it in the terminal is enough.
  useEffect(() => {
    if (st.s !== 'error' || (st.e.kind !== 'unreachable' && st.e.kind !== 'incompatible') || !conn.token) return;
    const t = setTimeout(() => void connect(conn), RETRY_MS);
    return () => clearTimeout(t);
  }, [st, conn, connect]);

  const submit = (c: Connection) => {
    const clean = { api: c.api.trim().replace(/\/+$/, '') || DEFAULT_API, token: c.token.trim() };
    saveConnection(clean);
  };

  if (st.s === 'on') {
    return <Connected key={conn.api + conn.token} b={st.b} info={st.info} onLeave={(next) => { attempt.current++; setSt(next ?? { s: 'idle' }); }} />;
  }
  return <Connect conn={conn} st={st} onSubmit={submit} P={P} />;
}

function Connect({ conn, st, onSubmit, P }: { conn: Connection; st: Status; onSubmit: (c: Connection) => void; P: ReturnType<typeof useApp>['T']['px'] }) {
  const [api, setApi] = useState(conn.api);
  const [token, setToken] = useState(conn.token);
  useEffect(() => { setApi(conn.api); setToken(conn.token); }, [conn]);
  const errText = useBackendError();
  const port = (() => { try { return new URL(api.trim() || DEFAULT_API).port; } catch { return ''; } })();
  const cmd = `bmitmproxy serve --origin "${location.origin}"` + (port && port !== new URL(DEFAULT_API).port ? ` --web-port ${port}` : '');
  // The whole link pasted into the token box: take both parts.
  const onToken = (v: string) => {
    const c = /#proxy\?/.test(v) ? parseConnection(v) : null;
    if (c) { if (c.api) setApi(c.api); setToken(c.token ?? ''); } else setToken(v);
  };
  return (
    <div className="tool-stack proxy">
      <section className="card px-connect">
        <div className="px-title">{P.connectTitle}</div>
        <p className="px-note">{P.intro}</p>
        <div className="px-label">{P.command}</div>
        <CopyBlock value={cmd} className="px-cmd"><code>{cmd}</code></CopyBlock>
        <p className="px-faint">{P.install}</p>
        <form className="px-row" onSubmit={(e) => { e.preventDefault(); onSubmit({ api, token }); }}>
          <input className="field mono px-api" value={api} placeholder={DEFAULT_API} onChange={(e) => setApi(e.target.value)} spellCheck={false} aria-label={P.api} title={P.api} />
          <input className="field mono grow" type="password" value={token} placeholder={P.token + ' · ' + P.tokenPh} onChange={(e) => onToken(e.target.value)} autoComplete="off" spellCheck={false} aria-label={P.token} />
          <button className="btn inv" type="submit" disabled={!token.trim()}>{st.s === 'connecting' ? P.connecting : P.connect}</button>
        </form>
        {st.s === 'error' && <div className="px-err" role="alert">{errText(st.e, conn.api)}</div>}
      </section>
    </div>
  );
}

function Connected({ b, info, onLeave }: { b: ProxyBackend; info: BackendInfo; onLeave: (next?: Status) => void }) {
  const { T, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [tab, setTab] = useOpt<Tab>('proxy.tab', 'capture', ['capture', 'cert', 'scripts']);
  const [live, setLive] = useState(false);
  const [stopping, setStopping] = useState(false);

  const stop = async () => {
    setStopping(true);
    try {
      await b.stop();
      toast(P.stopped, 5000);
      onLeave();
    } catch (e) {
      setStopping(false);
      toast(errText(e), 6000);
    }
  };

  return (
    <div className="tool-stack proxy">
      <section className="card px-head">
        <div className="px-row">
          <span className={'px-dot' + (live ? ' on' : '')} title={live ? P.live : P.offline} />
          <span className="px-backend">{f(P.backend, { b: info.backend, v: info.version, e: info.engine })}{info.mode === 'app' ? ' · ' + P.modeApp : ''}</span>
          {!live && <span className="px-warn">{P.offline}</span>}
          <span className="px-spacer" />
          {info.mode === 'serve' && <button className="btn sm" onClick={() => void stop()} disabled={stopping}>{stopping ? P.stopping : P.stop}</button>}
          <button className="btn sm" onClick={() => onLeave()}>{P.disconnect}</button>
        </div>
        <SysProxy b={b} />
      </section>
      <Seg value={tab} onChange={setTab} opts={[{ value: 'capture', label: P.tabs.capture }, { value: 'cert', label: P.tabs.cert }, { value: 'scripts', label: P.tabs.scripts }]} />
      {/* The capture keeps watching while another tab is shown, so nothing is missed. */}
      <div hidden={tab !== 'capture'}><Capture b={b} info={info} onLive={setLive} /></div>
      {tab === 'cert' && <Cert b={b} info={info} />}
      {tab === 'scripts' && <Scripts b={b} />}
    </div>
  );
}

function SysProxy({ b }: { b: ProxyBackend }) {
  const { T } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [sp, setSp] = useState<SystemProxy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stopped = false;
    const load = () => b.systemProxy().then((s) => { if (!stopped) setSp(s); }, () => { /* shown by the connection state */ });
    void load();
    const t = setInterval(() => void load(), SYS_POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [b]);

  const toggle = async () => {
    if (!sp) return;
    setBusy(true);
    setErr('');
    try { setSp(await b.setSystemProxy(!sp.enabled)); } catch (e) { setErr(f(P.sysFailed, { d: errText(e) })); }
    setBusy(false);
  };
  const desc = useMemo(() => {
    if (!sp) return '';
    if (!sp.supported) return f(P.sysUnsupported, { p: sp.proxy });
    if (sp.enabled) return f(P.sysOn, { v: sp.upstream ? f(P.sysVia, { u: sp.upstream }) : P.sysDirect });
    return sp.upstream ? f(P.sysOff, { u: sp.upstream }) : P.sysOffDirect;
  }, [sp, P]);

  if (!sp) return null;
  return (
    <div className="px-sys">
      <div className="px-row">
        {sp.supported && (
          <button className={'btn' + (sp.enabled ? ' on' : '')} onClick={() => void toggle()} disabled={busy} aria-pressed={sp.enabled}>
            {sp.enabled ? '✓' : '○'} {P.sys}
          </button>
        )}
        <span className="px-note">{busy ? P.sysBusy : desc}</span>
      </div>
      {sp.overridden && <div className="px-warn">{P.sysOverridden}</div>}
      {err && <div className="px-err" role="alert">{err}</div>}
      {sp.supported && (
        <div className="px-faint">
          {P.sysRestore}
          {sp.bypass.length > 0 && (
            <details className="px-bypass">
              <summary>{f(P.bypass, { n: sp.bypass.length })}</summary>
              <div title={P.bypassTitle}>{sp.bypass.join(', ')}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
