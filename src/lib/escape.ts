// String escaping for JSON, JavaScript, Java, C, SQL and POSIX shell, and back.
// Unescaping is strict: an escape the language doesn't have is an error with its position.

export type EscLang = 'json' | 'js' | 'java' | 'c' | 'sql' | 'shell';

export class EscError extends Error {
  constructor(readonly code: 'bad' | 'nul' | 'expand' | 'op' | 'quote' | 'utf8', readonly pos: number) { super(code + ' at ' + pos); }
}

const h = (n: number, w: number) => n.toString(16).padStart(w, '0');

export function escapeStr(s: string, lang: EscLang): string {
  switch (lang) {
    case 'json':
      return JSON.stringify(s).slice(1, -1);
    case 'sql':
      return s.replace(/'/g, "''");
    case 'shell':
      if (s.includes('\0')) throw new EscError('nul', s.indexOf('\0'));
      // Single quotes keep everything literal; a quote itself is closed, escaped and reopened.
      return "'" + s.replace(/'/g, "'\\''") + "'";
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = c.charCodeAt(0);
    const next = s[i + 1] || '';
    const simple: Record<string, string> = { '\\': '\\\\', '"': '\\"', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
    if (simple[c]) out += simple[c];
    else if (lang === 'js' && c === '\v') out += '\\v';
    else if (lang === 'c' && c === '\v') out += '\\v';
    else if (lang === 'c' && c === '\x07') out += '\\a';
    else if (n < 0x20 || n === 0x7f || (lang !== 'c' && (n === 0x2028 || n === 0x2029))) {
      if (lang === 'c') out += '\\' + n.toString(8).padStart(3, '0');
      else if (lang === 'js' && n === 0 && !/[0-9]/.test(next)) out += '\\0';
      else if (lang === 'js' && n < 0x100) out += '\\x' + h(n, 2);
      else out += '\\u' + h(n, 4);
    } else if (lang === 'c' && c === '?' && s[i - 1] === '?') out += '\\?'; // never "??" (a trigraph)
    else out += c;
  }
  return out;
}

/** The inverse; `notes` lists things the reader should know (legacy escapes, lone surrogates…). */
export function unescapeStr(s: string, lang: EscLang): { text: string; words?: number } {
  switch (lang) {
    case 'json': {
      // Raw control characters and unknown escapes are errors in JSON.
      let out = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '"' ) throw new EscError('quote', i);
        if (c.charCodeAt(0) < 0x20) throw new EscError('bad', i);
        if (c !== '\\') { out += c; continue; }
        const e = s[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) { out += map[e]; i++; }
        else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 5; }
        else throw new EscError('bad', i);
      }
      return { text: out };
    }
    case 'sql': {
      let out = '';
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== "'") { out += s[i]; continue; }
        if (s[i + 1] !== "'") throw new EscError('quote', i);
        out += "'";
        i++;
      }
      return { text: out };
    }
    case 'shell':
      return unescapeShell(s);
  }
  // JS, Java and C share the backslash forms; each has its own set.
  const bytes: number[] = [];
  const enc = new TextEncoder();
  let out = '';
  const flush = () => {
    if (!bytes.length) return;
    try { out += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { throw new EscError('utf8', 0); }
    bytes.length = 0;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      if (lang === 'c') { const cp = s.codePointAt(i)!; const ch = String.fromCodePoint(cp); bytes.push(...enc.encode(ch)); i += ch.length - 1; }
      else out += c;
      continue;
    }
    const e = s[i + 1];
    if (e === undefined) throw new EscError('bad', i);
    const add = (t: string) => { if (lang === 'c') bytes.push(...enc.encode(t)); else out += t; };
    const common: Record<string, string> = { '\\': '\\', '"': '"', "'": "'", n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    let m: RegExpExecArray | null;
    const rest = s.slice(i);
    if (e in common) { add(common[e]); i++; }
    else if (lang !== 'java' && e === 'v') { add('\v'); i++; }
    else if (lang === 'c' && e === 'a') { add('\x07'); i++; }
    else if (lang === 'c' && e === '?') { add('?'); i++; }
    else if (lang === 'java' && e === 's') { add(' '); i++; }
    else if ((m = /^\\u([0-9a-fA-F]{4})/.exec(rest))) {
      const cu = parseInt(m[1], 16);
      if (lang === 'c') { flush(); out += String.fromCharCode(cu); } else out += String.fromCharCode(cu);
      i += 5;
    } else if (lang === 'js' && (m = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(rest)) && parseInt(m[1], 16) <= 0x10ffff) { out += String.fromCodePoint(parseInt(m[1], 16)); i += m[0].length - 1; }
    else if (lang === 'c' && (m = /^\\U([0-9a-fA-F]{8})/.exec(rest)) && parseInt(m[1], 16) <= 0x10ffff) { flush(); out += String.fromCodePoint(parseInt(m[1], 16)); i += 9; }
    else if (lang === 'js' && (m = /^\\x([0-9a-fA-F]{2})/.exec(rest))) { out += String.fromCharCode(parseInt(m[1], 16)); i += 3; }
    else if (lang === 'c' && (m = /^\\x([0-9a-fA-F]+)/.exec(rest))) {
      const v = parseInt(m[1], 16);
      if (v > 0xff) throw new EscError('bad', i);
      bytes.push(v);
      i += m[0].length - 1;
    } else if (lang === 'js' && e === '0' && !/[0-9]/.test(s[i + 2] || '')) { out += '\0'; i++; }
    else if ((lang === 'c' || lang === 'java') && (m = lang === 'c' ? /^\\([0-7]{1,3})/.exec(rest) : /^\\([0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(rest))) {
      const v = parseInt(m[1], 8);
      if (lang === 'c') { if (v > 0xff) throw new EscError('bad', i); bytes.push(v); } else out += String.fromCharCode(v);
      i += m[0].length - 1;
    } else if (lang === 'js' && (e === '\n' || e === ' ' || e === ' ')) i++;
    else if (lang === 'js' && e === '\r') i += s[i + 2] === '\n' ? 2 : 1;
    else if (lang === 'js' && !/[0-9xu]/.test(e)) { out += e; i++; }
    else throw new EscError('bad', i);
  }
  flush();
  return { text: out };
}

/**
 * A POSIX shell word (or several) back to its text: '…', "…", $'…' and backslashes outside
 * quotes. Expansions ($x, $(…), `…`) and operators can't be undone without running a shell.
 */
function unescapeShell(s: string): { text: string; words: number } {
  const words: string[] = [];
  let cur = '', inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[ \t\n]/.test(c)) { if (inWord) { words.push(cur); cur = ''; inWord = false; } continue; }
    inWord = true;
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new EscError('quote', i);
      cur += s.slice(i + 1, j);
      i = j;
    } else if (c === '$' && s[i + 1] === "'") {
      let j = i + 2;
      for (; j < s.length && s[j] !== "'"; j++) {
        if (s[j] !== '\\') { cur += s[j]; continue; }
        const e = s[j + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '?': '?' };
        let m: RegExpExecArray | null;
        if (e in map) { cur += map[e]; j++; }
        else if ((m = /^\\x([0-9a-fA-F]{1,2})/.exec(s.slice(j)))) { cur += String.fromCharCode(parseInt(m[1], 16)); j += m[0].length - 1; }
        else if ((m = /^\\u([0-9a-fA-F]{1,4})/.exec(s.slice(j)))) { cur += String.fromCharCode(parseInt(m[1], 16)); j += m[0].length - 1; }
        else if ((m = /^\\([0-7]{1,3})/.exec(s.slice(j)))) { cur += String.fromCharCode(parseInt(m[1], 8)); j += m[0].length - 1; }
        else throw new EscError('bad', j);
      }
      if (j >= s.length) throw new EscError('quote', i);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '$' || s[j] === '`') throw new EscError('expand', j);
        if (s[j] === '\\' && /[$`"\\\n]/.test(s[j + 1] || '')) { if (s[j + 1] !== '\n') cur += s[j + 1]; j++; }
        else cur += s[j];
      }
      if (j >= s.length) throw new EscError('quote', i);
      i = j;
    } else if (c === '\\') {
      if (i + 1 >= s.length) throw new EscError('bad', i);
      if (s[i + 1] !== '\n') cur += s[i + 1];
      i++;
    } else if (c === '$' || c === '`') throw new EscError('expand', i);
    else if (/[|&;<>()]/.test(c)) throw new EscError('op', i);
    else cur += c;
  }
  if (inWord) words.push(cur);
  return { text: words.join('\n'), words: words.length };
}
