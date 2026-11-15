// Proxy & Capture: a slim bar over what the backend captures, which takes the rest of the page.
// The bar says how things are (on, which part of starting it is at, why it couldn't), holds the
// system proxy and the root certificate as chips, the backend and its entry behind a settings
// button, and on / off. Offered in the macOS desktop app only (TOOLS in i18n.ts): the app runs the
// backend (desktop/capture.cjs) and says each change as it happens, so nothing here asks again on
// a timer.
//
// Switching on does every part in turn, each first looking at whether it is already so
// (lib/steps.ts): it checks the entry, fixes it when the app can (an older install, distutils
// missing), starts the backend or uses one already running, connects, trusts the root
// certificate and takes over the system proxy. The last two don't keep it from being on: what
// failed is told, and its chip shows it. Off: the system proxy put back, the backend stopped; the
// app then puts back whatever the backend left pointing at itself. Loaded only when opened.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { useOpt } from '../components/Panes';
import { useFillHeight } from '../components/useFillHeight';
import { done, runSteps, skipped, warned, type Run, type Step } from '../lib/steps';
import type { CaptureBackend, CaptureState, EntryCheck, EntryFix, Repaired } from '../lib/desktop';
import type { BackendInfo, CaInfo, ProxyBackend, SystemProxy } from '../lib/proxy/backend';
import { LaunchError, backendFor, launcher, type Launcher } from '../lib/proxy/launcher';
import Capture from './proxy/Capture';
import Cert from './proxy/Cert';
import Scripts from './proxy/Scripts';
import { entryText, exitText, useBackendError, useDescribe } from './proxy/errors';

type Tab = 'capture' | 'cert' | 'scripts';
type Px = ReturnType<typeof useApp>['T']['px'];
/** The entry is checked once typing has paused this long. */
const CHECK_AFTER_MS = 400;
/** How long a warning (a part that didn't work, the system proxy put back) stays. */
const NOTE_MS = 8000;

/** The last switch: running (its parts as they go), or failed (why, in full). */
type Phase = { kind: 'idle' } | { kind: 'busy'; on: boolean; run: Run | null } | { kind: 'failed'; on: boolean; text: string };

/** An entry the backend can start from (as it is, or once the app has fixed it). */
const usable = (c: EntryCheck | 'checking' | null) => typeof c === 'object' && !!c && (c.status === 'ok' || c.status === 'needs-fix');

export default function Proxy() {
  const { T } = useApp();
  if (!launcher) {
    return <div className="tool-stack proxy"><section className="card px-pad"><p className="px-note">{T.px.desktopOnly}</p></section></div>;
  }
  return <Launch L={launcher} />;
}

function Launch({ L }: { L: Launcher }) {
  const { T, toast } = useApp();
  const P = T.px;
  const [backends, setBackends] = useState<CaptureBackend[]>([]);
  const [bid, setBid] = useOpt<string>('proxy.backend', 'bmitmproxy');
  const backend = backends.find((b) => b.id === bid) ?? backends[0] ?? null;
  const id = backend?.id ?? bid;
  const name = backend?.name ?? id;
  const [entryOpt, setEntry] = useOpt<string>('proxy.entry.' + id, '');
  const entry = entryOpt.trim();
  const describe = useDescribe(name);
  const errText = useBackendError();
  const [tab, setTab] = useOpt<Tab>('proxy.tab', 'capture', ['capture', 'cert', 'scripts']);

  const [check, setCheck] = useState<EntryCheck | 'checking' | null>(null);
  const [cs, setCs] = useState<CaptureState | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** The fix the app is making now (told as it begins). */
  const [fixing, setFixing] = useState<EntryFix | null>(null);
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState(false);
  /** Bumped when the system's proxy settings change (told by the app): the chip looks again. */
  const [sysTick, setSysTick] = useState(0);
  const [live, setLive] = useState(true);
  const busyRef = useRef(false);

  // The backends, and what runs now; then its changes as they come.
  useEffect(() => {
    let off = false;
    L.backends().then((b) => { if (!off) setBackends(b); }, () => { /* none listed: the entry check says why */ });
    L.get().then((s) => { if (!off) setCs(s); }, () => {});
    const listSep = P.listSep;
    const where = (items: Repaired[]) => items.map((i) => `${i.service} ${i.kind === 'web' ? 'HTTP' : 'HTTPS'}`).join(listSep);
    const un = L.onEvent((e) => {
      if (e.type === 'state') setCs(e.state);
      else if (e.type === 'system-proxy') setSysTick((x) => x + 1);
      else if (e.type === 'progress') setFixing(e.what);
      else if (e.type === 'repaired') {
        setSysTick((x) => x + 1);
        toast(e.failed?.length ? f(P.repairFailed, { s: where(e.failed) }) : f(P.repaired, { s: where(e.items) }), NOTE_MS);
      }
    });
    return () => { off = true; un(); };
  }, [L]); // eslint-disable-line react-hooks/exhaustive-deps

  // No entry yet: where the backend usually is.
  useEffect(() => {
    if (entry) return;
    let off = false;
    L.defaultEntry(id).then((d) => { if (!off && d) setEntry(d); }, () => {});
    return () => { off = true; };
  }, [L, id, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // The entry checked as it changes, and a backend already running from it found.
  useEffect(() => {
    setPhase((p) => (p.kind === 'failed' ? { kind: 'idle' } : p));
    if (!entry) { setCheck(null); return; }
    let off = false;
    setCheck('checking');
    const t = setTimeout(async () => {
      let c: EntryCheck;
      try {
        c = await L.inspect(id, entry);
      } catch (e) {
        if (!off) setCheck({ status: 'unknown', reason: 'probe-failed', tail: describe(e) });
        return;
      }
      if (off) return;
      setCheck(c);
      if (c.status === 'ok' && !busyRef.current) L.find(id, entry).then((s) => { if (!off) setCs(s); }, () => { /* busy: the state comes by event */ });
    }, CHECK_AFTER_MS);
    return () => { off = true; clearTimeout(t); };
  }, [L, id, entry, describe]);

  const b = useMemo(() => (cs ? backendFor(cs) : null), [cs?.state, cs?.backend, cs?.api, cs?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [ca, setCa] = useState<CaInfo | null>(null);
  const [sp, setSp] = useState<SystemProxy | null>(null);
  useEffect(() => {
    setInfo(null);
    setCa(null);
    if (!b) return;
    let off = false;
    b.info().then((i) => { if (!off) setInfo(i); }, () => { /* the bar says why */ });
    b.ca().then((c) => { if (!off) setCa(c); }, () => {});
    return () => { off = true; };
  }, [b]);
  useEffect(() => {
    if (!b) { setSp(null); return; }
    let off = false;
    b.systemProxy().then((s) => { if (!off) setSp(s); }, () => {});
    return () => { off = true; };
  }, [b, sysTick]);

  const isOn = cs?.state === 'on';
  const busy = phase.kind === 'busy' || cs?.state === 'starting' || cs?.state === 'stopping';

  const switchOn = (): Step[] => {
    let c: EntryCheck;
    let st: CaptureState;
    let bk: ProxyBackend;
    return [
      {
        title: P.stepEntry,
        run: async () => {
          c = await L.inspect(id, entry);
          setCheck(c);
          if (!usable(c)) throw new LaunchError({ code: 'unusable', ...c });
          return done();
        },
      },
      {
        title: P.stepFix,
        run: async () => {
          if (c.status !== 'needs-fix') return skipped('');
          c = await L.fix(id, entry);
          setCheck(c);
          return done();
        },
      },
      {
        title: P.stepStart,
        run: async () => {
          const r = await L.start(id, entry);
          st = r.state;
          const taken = r.warnings.find((w) => w.code === 'proxy-port-busy');
          return taken ? warned(f(P.portBusy, { port: String(taken.port), by: String(taken.by ?? P.someone), used: String(taken.used) })) : done();
        },
      },
      {
        title: P.stepConnect,
        run: async () => {
          const made = backendFor(st);
          if (!made) throw new LaunchError({ code: 'internal', message: 'no backend for ' + st.backend });
          bk = made;
          await bk.info();
          return done();
        },
      },
      {
        title: P.stepTrust,
        run: async () => {
          try {
            const now = await bk.ca();
            if (now.trusted) return skipped('');
            if (now.sharedInsecure) return warned(f(P.warnTrust, { d: P.insecureShort }));
            if (!now.trustSupported) return warned(f(P.warnTrust, { d: P.trustNo }));
            const after = await bk.trustCa();
            setCa(after);
            return after.trusted ? done() : warned(f(P.warnTrust, { d: P.trustNot }));
          } catch (e) {
            return warned(f(P.warnTrust, { d: errText(e) }));
          }
        },
      },
      {
        title: P.stepSys,
        run: async () => {
          try {
            const now = await bk.systemProxy();
            if (!now.supported) return warned(f(P.warnSys, { d: P.sysNo }));
            if (now.enabled) return skipped('');
            const after = await bk.setSystemProxy(true);
            setSp(after);
            // The app keeps the backend's record of the settings before, to put back what it leaves.
            await L.checkProxy().catch(() => {});
            return after.enabled ? done() : warned(f(P.warnSys, { d: P.sysNot }));
          } catch (e) {
            return warned(f(P.warnSys, { d: errText(e) }));
          }
        },
      },
    ];
  };

  const switchOff = (): Step[] => [
    {
      title: P.stepRestore,
      run: async () => {
        const bk = cs ? backendFor(cs) : null;
        if (!bk) return skipped('');
        try {
          // The takeover is what is undone: some services may have been changed back by another
          // program (so the settings in effect no longer point here) while others still point here.
          const now = await bk.systemProxy();
          if (!now.takenOver) return skipped('');
          const after = await bk.setSystemProxy(false);
          return after.takenOver ? warned(f(P.warnRestore, { d: P.restoreNot })) : done();
        } catch (e) {
          return warned(f(P.warnRestore, { d: errText(e) }));
        }
      },
    },
    // What the backend left pointing at itself is put back by the app (told as 'repaired').
    { title: P.stepStop, run: async () => { await L.stop(); return done(); } },
  ];

  const go = async (on: boolean) => {
    busyRef.current = true;
    setDetails(false);
    setSettings(false);
    setFixing(null);
    setPhase({ kind: 'busy', on, run: null });
    const r = await runSteps(on ? switchOn() : switchOff(), (run) => setPhase({ kind: 'busy', on, run }), { describe });
    busyRef.current = false;
    setFixing(null);
    const failed = r.steps.find((s) => s.state === 'failed');
    if (failed) {
      setPhase({ kind: 'failed', on, text: failed.detail });
      return;
    }
    setPhase({ kind: 'idle' });
    if (on) setTab('capture');
    const notes = r.steps.filter((s) => s.state === 'warn').map((s) => s.detail);
    if (notes.length) toast(notes.join(' '), NOTE_MS);
  };

  const [sysBusy, setSysBusy] = useState(false);
  const toggleSys = async () => {
    if (!b || !sp) return;
    setSysBusy(true);
    try {
      setSp(await b.setSystemProxy(!sp.enabled));
      await L.checkProxy().catch(() => {});
    } catch (e) {
      toast(f(P.sysFailed, { d: errText(e) }), NOTE_MS);
    }
    setSysBusy(false);
  };

  const status = useStatus(P, phase, cs, fixing, live, info);
  const connected = isOn && b && info;

  return (
    <div className="tool-stack proxy">
      <section className="card px-bar">
        <span className={'px-dot ' + status.tone} aria-hidden />
        <span className="px-status" title={status.title}>{status.text}</span>
        {status.detail && (
          <button className="px-link" onClick={() => setDetails(!details)} aria-expanded={details}>{P.details}</button>
        )}
        {phase.kind === 'failed' && <button className="px-link" onClick={() => void go(phase.on)}>{P.retry}</button>}
        <span className="px-spacer" />
        {connected && (
          <>
            <Seg size="sm" value={tab} onChange={setTab} opts={[{ value: 'capture', label: P.tabs.capture }, { value: 'cert', label: P.tabs.cert }, { value: 'scripts', label: P.tabs.scripts }]} />
            <SysChip P={P} sp={sp} busy={sysBusy} onClick={() => void toggleSys()} />
            <CertChip P={P} ca={ca} onClick={() => setTab('cert')} />
          </>
        )}
        <div className="px-settings">
          <button className={'px-icon' + (settings ? ' on' : '')} onClick={() => setSettings(!settings)} aria-expanded={settings} aria-label={P.settings} title={P.settings}>
            <GearIcon />
            {typeof check === 'object' && check && !usable(check) && <span className="px-badge-dot" aria-hidden />}
          </button>
          {settings && (
            <Popover onClose={() => setSettings(false)}>
              <div className="px-pop-row">
                <span className="px-pop-label">{P.backendLabel}</span>
                <Seg size="sm" value={id} onChange={setBid} opts={(backends.length ? backends : [{ id, name }]).map((x) => ({ value: x.id, label: x.name }))} />
              </div>
              <label className="px-pop-row col">
                <span className="px-pop-label">{P.entry}</span>
                <input className="field mono" value={entryOpt} onChange={(e) => setEntry(e.target.value)} placeholder={P.entryPh} title={P.entryTitle}
                  spellCheck={false} disabled={busy || isOn} aria-label={P.entry} autoFocus />
              </label>
              <EntryLine P={P} check={check} name={name} id={id} />
              {isOn && cs && (
                <div className="px-faint">
                  {f(P.running, { p: cs.pid ?? '', b: info ? f(P.backend, { b: info.backend, v: info.version, e: info.engine }) : name })}
                  {!cs.owned && ' · ' + P.notOurs}
                </div>
              )}
            </Popover>
          )}
        </div>
        <button className={'btn' + (isOn ? '' : ' inv')} onClick={() => void go(!isOn)} disabled={busy || (!isOn && !entry)}>{isOn ? P.off : P.on}</button>
      </section>
      {details && status.detail && <pre className="px-details">{status.detail}</pre>}
      {connected ? (
        <>
          {/* The capture keeps watching while another tab is shown, so nothing is missed. */}
          <div hidden={tab !== 'capture'}><Capture b={b} info={info} onLive={setLive} /></div>
          {tab === 'cert' && <Cert b={b} info={info} onCa={setCa} />}
          {tab === 'scripts' && <Scripts b={b} />}
        </>
      ) : (
        <Idle P={P} check={check} name={name} id={id} busy={busy || isOn} entry={entry} onOn={() => void go(true)} onSettings={() => setSettings(true)} />
      )}
    </div>
  );
}

/** What the bar says: its tone (the dot's colour), one line, the full text behind "details". */
function useStatus(P: Px, phase: Phase, cs: CaptureState | null, fixing: EntryFix | null, live: boolean, info: BackendInfo | null) {
  return useMemo(() => {
    if (phase.kind === 'busy') {
      const step = phase.run?.steps.find((s) => s.state === 'running');
      const part = fixing && step?.title === P.stepFix ? P.fixShort[fixing] : step?.title;
      const text = part ? f(phase.on ? P.busyOn : P.busyOff, { s: part }) : phase.on ? P.stateStarting : P.stateStopping;
      return { tone: 'busy', text, title: '', detail: '' };
    }
    if (phase.kind === 'failed') {
      const [first, ...rest] = phase.text.split('\n');
      const more = rest.join('\n').trim() !== '';
      // The line that leads into what follows ("…exited (code 1):") reads as a sentence on its own.
      const line = more ? first.replace(/[：:]\s*$/, '') : first;
      return { tone: 'bad', text: f(phase.on ? P.failedOn : P.failedOff, { d: line }), title: phase.text, detail: more ? phase.text : '' };
    }
    if (!cs) return { tone: 'off', text: '', title: '', detail: '' };
    if (cs.state === 'on') {
      const title = [info ? f(P.backend, { b: info.backend, v: info.version, e: info.engine }) : '', 'pid ' + (cs.pid ?? ''), cs.owned ? '' : P.notOurs].filter(Boolean).join(' · ');
      return { tone: live ? 'on' : 'warn', text: f(P.stateOn, { port: cs.proxyPort ?? '' }) + (live ? '' : ' · ' + P.offline), title, detail: '' };
    }
    if (cs.state === 'starting' || cs.state === 'stopping') return { tone: 'busy', text: cs.state === 'starting' ? P.stateStarting : P.stateStopping, title: '', detail: '' };
    const exit = cs.exit;
    if (exit?.reason === 'exited') {
      // What it printed says why when it failed (an exit code); a signal ended it from outside.
      const tail = typeof exit.code === 'number' && exit.code !== 0 ? exit.tail ?? '' : '';
      return { tone: 'bad', text: f(P.stateExited, { c: exitText(P, exit.code, exit.signal) || exit.error || '?' }), title: '', detail: tail };
    }
    if (exit?.reason === 'gone') return { tone: 'bad', text: P.stateGone, title: '', detail: '' };
    return { tone: 'off', text: P.stateOff, title: '', detail: '' };
  }, [P, phase, cs, fixing, live, info]);
}

/** Off: one line where the capture will be, and the way on (or to an entry that works). */
function Idle({ P, check, name, id, busy, entry, onOn, onSettings }: {
  P: Px; check: EntryCheck | 'checking' | null; name: string; id: string; busy: boolean; entry: string; onOn: () => void; onSettings: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  const height = useFillHeight(box, 320);
  const bad = !busy && (check === null || (typeof check === 'object' && !usable(check)));
  return (
    <section ref={box} className="card px-idle" style={height ? { height } : undefined}>
      <p className="px-idle-text">{bad ? (check ? entryText(P, check, name, id) : P.entryNone) : P.idle}</p>
      {bad ? (
        <button className="btn" onClick={onSettings}>{P.setEntry}</button>
      ) : (
        !busy && <button className="btn inv" onClick={onOn} disabled={!entry}>{P.on}</button>
      )}
    </section>
  );
}

function EntryLine({ P, check, name, id }: { P: Px; check: EntryCheck | 'checking' | null; name: string; id: string }) {
  if (check === null) return <div className="px-entry-check none">{P.entryNone}</div>;
  if (check === 'checking') return <div className="px-entry-check none">{P.checking}</div>;
  const tone = check.status === 'ok' ? 'ok' : check.status === 'needs-fix' ? 'warn' : 'bad';
  return <div className={'px-entry-check ' + tone}><span className={'px-dot ' + (tone === 'ok' ? 'on' : tone)} aria-hidden />{entryText(P, check, name, id)}</div>;
}

/** The system proxy: taken over (green), changed back by another program (amber), or not; a click turns it the other way. */
function SysChip({ P, sp, busy, onClick }: { P: Px; sp: SystemProxy | null; busy: boolean; onClick: () => void }) {
  if (!sp?.supported) return null;
  const tone = sp.enabled ? 'on' : sp.overridden ? 'warn' : 'off';
  const desc = sp.enabled ? f(P.sysOn, { v: sp.upstream ? f(P.sysVia, { u: sp.upstream }) : P.sysDirect }) : sp.overridden ? P.sysOverridden : sp.upstream ? f(P.sysOff, { u: sp.upstream }) : P.sysOffDirect;
  const title = [desc, P.sysRestore, sp.bypass.length ? f(P.bypass, { n: sp.bypass.length }) + '\n' + sp.bypass.join(', ') : ''].filter(Boolean).join('\n');
  return (
    <button className={'px-chip ' + tone} onClick={onClick} disabled={busy} aria-pressed={sp.enabled} title={title}>
      <span className={'px-dot ' + tone} aria-hidden />{busy ? P.sysBusy : sp.overridden && !sp.enabled ? P.sysChipOverridden : P.sysChip}
    </button>
  );
}

/** The root certificate: trusted on this computer (green) or not (amber); a click shows it. */
function CertChip({ P, ca, onClick }: { P: Px; ca: CaInfo | null; onClick: () => void }) {
  if (!ca) return null;
  const tone = ca.trusted ? 'on' : 'warn';
  return (
    <button className={'px-chip ' + tone} onClick={onClick} title={ca.trusted ? P.trusted : P.untrusted}>
      <span className={'px-dot ' + tone} aria-hidden />{ca.trusted ? P.certChip : P.certChipNo}
    </button>
  );
}

/** Below its button; closed by a click elsewhere or Escape. */
function Popover({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Inside its button's box (the button toggles it) or itself: not elsewhere.
    const down = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, []);
  return <div ref={ref} className="pop px-pop" role="dialog">{children}</div>;
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
