import { useCallback } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import type { CaptureFailure, EntryCheck, EntryFix } from '../../lib/desktop';
import { BackendError } from '../../lib/proxy/backend';
import { LaunchError } from '../../lib/proxy/launcher';

type Px = ReturnType<typeof useApp>['T']['px'];

/** A backend failure in the user's words. */
export function useBackendError() {
  const { T } = useApp();
  const P = T.px;
  return useCallback((e: unknown) => {
    const err = e instanceof BackendError ? e : new BackendError('failed', String((e as Error)?.message ?? e));
    if (err.kind === 'unreachable') return P.unreachable;
    if (err.kind === 'unauthorized') return P.unauthorized;
    if (err.kind === 'incompatible') return P.incompatible;
    if (err.kind === 'timeout') return f(P.timeout, { d: err.message });
    return f(P.failed, { d: err.message });
  }, [P]);
}

/** How a process ended: its exit code or the signal. */
export function exitText(P: Px, code: unknown, signal: unknown) {
  if (typeof code === 'number' && code >= 0) return f(P.exitCode, { c: code });
  if (typeof signal === 'string' && signal) return f(P.exitSignal, { s: signal });
  return '';
}

/** What a check of the entry found, with what to do about it. */
export function entryText(P: Px, c: EntryCheck, name: string, id = name) {
  switch (c.status) {
    case 'ok': return f(P.entryOk, { n: name, v: c.version ?? '' });
    case 'missing': {
      const install = (P.install as Record<string, string>)[id];
      return [P.entryMissing, f(P.noDownload, { n: name }), install].filter(Boolean).join(' ');
    }
    case 'not-executable': return P.entryNotExec;
    case 'outdated': return f(P.entryOld, { n: name, v: c.version ?? '' }) + (c.source ? f(P.oldSource, { s: c.source }) : P.oldManual);
    case 'needs-fix': return f(P.entryNeedsFix, { n: name, v: c.version ?? '', f: (c.fixes ?? []).map((x) => f(P.fixes[x], { s: c.source ?? '' })).join(P.fixJoin) });
    default:
      if (c.reason === 'no-distutils') return P.entryNoDistutils;
      if (c.reason === 'not-python') return f(P.entryNotPython, { n: name });
      if (c.reason === 'not-bmitmproxy') return f(P.entryNotBackend, { n: name });
      return f(P.entryProbeFailed, { n: name, t: c.tail ?? '' });
  }
}

/** What the desktop app said went wrong, in the user's words. */
export function launchText(P: Px, x: CaptureFailure, name: string) {
  const s = (k: string) => String(x[k] ?? '');
  switch (x.code) {
    case 'unusable': return entryText(P, x as unknown as EntryCheck, name);
    case 'exited': return f(P.errExited, { c: exitText(P, x.exitCode, x.signal) || s('error'), t: s('tail') });
    case 'timeout': return f(P.errTimeout, { s: s('seconds'), t: s('tail') });
    case 'token-mismatch': return P.errToken;
    case 'incompatible': return P.errIncompatible;
    case 'found-unreachable': return f(P.errFoundUnreachable, { p: s('pid') });
    case 'other-running': return f(P.errOther, { e: s('entry'), p: s('pid') });
    case 'busy': return P.errBusy;
    case 'bad-entry': return P.errBadEntry;
    case 'no-pipx': return P.errNoPipx;
    case 'fix-failed': {
      const what = P.fixShort[x.fix as EntryFix] ?? s('fix');
      return x.exitCode === undefined ? f(P.errFixNoTake, { f: what }) : f(P.errFix, { f: what, c: exitText(P, x.exitCode, null), t: s('tail') });
    }
    case 'cannot-fix': return x.status ? entryText(P, x as unknown as EntryCheck, name) : P.errCannotFix;
    case 'running': return P.errRunning;
    case 'no-port': return P.errNoPort;
    default: return f(P.errInternal, { d: [x.code, s('message')].filter(Boolean).join(': ') });
  }
}

/** Any failure of the tool (the app's, the backend's, or another), in the user's words. */
export function useDescribe(name: string) {
  const { T } = useApp();
  const errText = useBackendError();
  return useCallback((e: unknown) => {
    if (e instanceof LaunchError) return launchText(T.px, e.failure, name);
    if (e instanceof BackendError) return errText(e);
    return e instanceof Error ? e.message : String(e);
  }, [T.px, errText, name]);
}
