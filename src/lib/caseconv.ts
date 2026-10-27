// Identifier case conversion: camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, …

export type CaseKind = 'camel' | 'pascal' | 'snake' | 'constant' | 'kebab' | 'dot' | 'title' | 'lower' | 'upper';
export const CASES: CaseKind[] = ['camel', 'pascal', 'snake', 'constant', 'kebab', 'dot', 'title', 'lower', 'upper'];

/**
 * Words of an identifier or phrase: split at separators and case changes, keeping acronyms
 * together (XMLHttpRequest → XML, Http, Request) and digits with the word before them (v2Api → v2, Api).
 */
export function words(s: string): string[] {
  return s
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((part) => part.match(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+\p{N}*|\p{Lu}+\p{N}*|\p{N}+|[\p{L}\p{N}]+/gu) ?? [])
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function convertCase(s: string, k: CaseKind): string {
  if (k === 'lower') return s.toLowerCase();
  if (k === 'upper') return s.toUpperCase();
  const w = words(s);
  switch (k) {
    case 'camel': return w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join('');
    case 'pascal': return w.map(cap).join('');
    case 'snake': return w.map((x) => x.toLowerCase()).join('_');
    case 'constant': return w.map((x) => x.toUpperCase()).join('_');
    case 'kebab': return w.map((x) => x.toLowerCase()).join('-');
    case 'dot': return w.map((x) => x.toLowerCase()).join('.');
    case 'title': return w.map(cap).join(' ');
  }
}

/** Each line converted on its own. */
export const convertLines = (s: string, k: CaseKind) => s.split('\n').map((l) => (l.trim() ? convertCase(l, k) : l)).join('\n');
