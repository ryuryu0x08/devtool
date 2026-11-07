// Regular expression testing (JavaScript syntax). Runs in a worker with a time limit: a pattern
// with catastrophic backtracking would otherwise freeze the page.

export interface ReMatch { i: number; text: string; groups: { name: string; value: string | undefined; start?: number }[] }
export interface ReResult { matches: ReMatch[]; total: number; replaced?: string; err?: string }

const MAX = 1000;

/** Read "/pattern/flags" as pattern + flags. */
export function splitLiteral(s: string): { pattern: string; flags: string } | null {
  const m = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(s.trim());
  return m ? { pattern: m[1], flags: m[2] } : null;
}

export function runRegex(pattern: string, flags: string, text: string, repl: string | null): ReResult {
  let re: RegExp;
  try { re = new RegExp(pattern, flags.includes('d') ? flags : flags + 'd'); } catch (e) { return { matches: [], total: 0, err: String((e as Error).message) }; }
  const matches: ReMatch[] = [];
  let total = 0;
  const names = groupNames(pattern);
  const take = (m: RegExpExecArray) => {
    total++;
    if (matches.length >= MAX) return;
    const groups = m.slice(1).map((v, k) => ({ name: names[k] ?? String(k + 1), value: v, start: m.indices?.[k + 1]?.[0] }));
    matches.push({ i: m.index, text: m[0], groups });
  };
  if (re.global || re.sticky) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      take(m);
      if (!re.global) break;
      // An empty match must not repeat forever.
      if (m[0] === '') re.lastIndex = re.unicode || re.flags.includes('v') ? nextCp(text, re.lastIndex) : re.lastIndex + 1;
    }
  } else {
    const m = re.exec(text);
    if (m) take(m);
  }
  let replaced: string | undefined;
  if (repl !== null) {
    try { replaced = text.replace(new RegExp(pattern, flags), repl); } catch { replaced = undefined; }
  }
  return { matches, total, replaced };
}

/** Name of each capturing group in order (null for numbered ones). */
export function groupNames(p: string): (string | null)[] {
  const out: (string | null)[] = [];
  let cls = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { i++; continue; }
    if (cls) { if (c === ']') cls = false; continue; }
    if (c === '[') { cls = true; continue; }
    if (c !== '(') continue;
    if (p[i + 1] !== '?') out.push(null);
    else if (p[i + 2] === '<' && p[i + 3] !== '=' && p[i + 3] !== '!') out.push(/^\(\?<([^>]+)>/.exec(p.slice(i))?.[1] ?? null);
  }
  return out;
}

const nextCp = (s: string, i: number) => (i < s.length && s.codePointAt(i)! > 0xffff ? i + 2 : i + 1);

let active: Worker | null = null;

/** Run in a worker; after `ms` it is stopped and reported as too slow. */
export function runRegexAsync(pattern: string, flags: string, text: string, repl: string | null, ms = 1500): Promise<ReResult | 'timeout'> {
  active?.terminate();
  return new Promise((resolve) => {
    let w: Worker;
    try { w = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' }); } catch { resolve(runRegex(pattern, flags, text, repl)); return; }
    active = w;
    const t = setTimeout(() => { w.terminate(); if (active === w) active = null; resolve('timeout'); }, ms);
    w.onmessage = (e: MessageEvent<ReResult>) => { clearTimeout(t); w.terminate(); if (active === w) active = null; resolve(e.data); };
    // A failure inside the worker (e.g. too much recursion) is reported; only a worker that
    // could not start falls back to running here.
    w.onerror = (ev) => {
      // Handled here, so it isn't also reported as an uncaught error of the page.
      ev.preventDefault();
      clearTimeout(t); w.terminate(); if (active === w) active = null;
      if (ev.message) { resolve({ matches: [], total: 0, err: ev.message.replace(/^Uncaught\s+/, '') }); return; }
      try { resolve(runRegex(pattern, flags, text, repl)); } catch (e) { resolve({ matches: [], total: 0, err: String((e as Error).message) }); }
    };
    w.postMessage({ pattern, flags, text, repl });
  });
}
