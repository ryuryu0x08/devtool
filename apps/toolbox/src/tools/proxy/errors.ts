import { useCallback } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import { BackendError } from '../../lib/proxy/backend';

/** A backend failure in the user's words; `api` names the address that couldn't be reached. */
export function useBackendError() {
  const { T } = useApp();
  const P = T.px;
  return useCallback((e: unknown, api = '') => {
    const err = e instanceof BackendError ? e : new BackendError('failed', String((e as Error)?.message ?? e));
    if (err.kind === 'unreachable') return f(P.unreachable, { a: api, o: location.origin });
    if (err.kind === 'unauthorized') return P.unauthorized;
    if (err.kind === 'incompatible') return f(P.incompatible, { a: api });
    if (err.kind === 'timeout') return f(P.timeout, { d: err.message });
    return f(P.failed, { d: err.message });
  }, [P]);
}
