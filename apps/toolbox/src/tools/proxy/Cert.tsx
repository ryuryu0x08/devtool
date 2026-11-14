// The backend's root certificate: trusted on this computer from here (the system asks for the
// password), and for other devices the proxy address to set and a QR code to the page that
// installs it.
import { useEffect, useMemo, useState } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import { Kv } from '../../components/Kv';
import { downloadBlob } from '../../components/Panes';
import { fmtWall } from '../../lib/time';
import { qrModel } from '../../lib/qr';
import type { BackendInfo, CaInfo, CertFormat, ProxyBackend } from '../../lib/proxy/backend';
import { useBackendError } from './errors';

const FORMATS: CertFormat[] = ['pem', 'cer', 'p12'];

export default function Cert({ b, info }: { b: ProxyBackend; info: BackendInfo }) {
  const { T, S, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [ca, setCa] = useState<CaInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    b.ca().then((c) => { if (!off) setCa(c); }, (e) => { if (!off) setErr(errText(e)); });
    return () => { off = true; };
  }, [b]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTrust = async (on: boolean) => {
    setBusy(true);
    setErr('');
    try {
      setCa(await (on ? b.trustCa() : b.untrustCa()));
      toast(on ? P.trustDone : P.untrustDone, 4000);
    } catch (e) {
      setErr(f(P.trustFailed, { d: errText(e) }));
    }
    setBusy(false);
  };
  const save = async (fmt: CertFormat) => {
    try { downloadBlob(await b.caFile(fmt), `${ca?.organization || 'proxy'}-ca-cert.${fmt}`); } catch (e) { toast(errText(e), 6000); }
  };

  const qr = useMemo(() => qrModel(info.onboarding, 'M'), [info.onboarding]);
  const trustLine = !ca ? '' : ca.trusted === true ? P.trusted : ca.trusted === false ? P.untrusted : P.trustUnknown;

  return (
    <div className="px-cert">
      <section className="card px-pad">
        <div className="px-title">{P.ca}</div>
        {err && <div className="px-err" role="alert">{err}</div>}
        {ca && (
          <>
            <div className={'px-trust ' + (ca.trusted ? 'ok' : 'no')}>{trustLine}</div>
            <div className="px-kvs">
              <Kv label={P.subject} value={ca.subject} />
              {ca.organization && <Kv label={P.org} value={ca.organization} />}
              <Kv label={P.sha256} value={ca.sha256} />
              <Kv label={P.valid} value={f(P.validRange, { a: fmtWall(ca.notBefore, S.tz).slice(0, 10), b: fmtWall(ca.notAfter, S.tz).slice(0, 10) })} />
            </div>
            {ca.sharedInsecure ? <div className="px-warn">{P.insecure}</div>
              : !ca.trustSupported ? <div className="px-note">{P.trustUnsupported}</div>
              : (
                <div className="px-row">
                  {ca.trusted
                    ? <button className="btn" onClick={() => void setTrust(false)} disabled={busy}>{P.untrust}</button>
                    : <button className="btn inv" onClick={() => void setTrust(true)} disabled={busy}>{P.trust}</button>}
                  {busy && <span className="px-note">{P.trustAsk}</span>}
                </div>
              )}
            <div className="px-label">{P.files}</div>
            <div className="px-row">
              {FORMATS.map((fmt) => <button key={fmt} className="btn sm" onClick={() => void save(fmt)}>.{fmt}</button>)}
            </div>
          </>
        )}
      </section>

      <section className="card px-pad">
        <div className="px-title">{P.devices}</div>
        <ol className="px-steps">
          <li>
            <div>{P.devStep1}</div>
            {info.lan.length ? <div className="px-kvs">{info.lan.map((a) => <Kv key={a} label={P.proxyAddr} value={a} />)}</div>
              : <div className="px-warn">{P.noLan}</div>}
          </li>
          <li>
            <div>{f(P.devStep2, { u: info.onboarding })}</div>
            {qr && !('err' in qr) && (
              <div className="px-qr" role="img" aria-label={f(P.qrLabel, { u: info.onboarding })}>
                <svg viewBox={`-2 -2 ${qr.n + 4} ${qr.n + 4}`} shapeRendering="crispEdges"><rect x={-2} y={-2} width={qr.n + 4} height={qr.n + 4} fill="#fff" /><path d={qr.d} fill="#111111" /></svg>
              </div>
            )}
            <Kv label="URL" value={info.onboarding} />
          </li>
        </ol>
        <div className="px-faint">{P.ios}</div>
        <div className="px-faint">{P.android}</div>
      </section>
    </div>
  );
}
