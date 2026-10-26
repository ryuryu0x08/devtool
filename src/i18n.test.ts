/// <reference types="node" />
// UI strings: both languages complete, same placeholders, and every f(T.x, {...}) call in the
// code passes exactly the placeholders its string uses (an unfilled "{n}" would show on screen).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICT } from './i18n';

type Tree = { [k: string]: string | string[] | Tree };
const flat = (t: Tree, pre = ''): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((o, [k, v]) => {
    if (typeof v === 'string') o[pre + k] = v;
    else if (Array.isArray(v)) v.forEach((x, i) => (o[pre + k + '.' + i] = x));
    else Object.assign(o, flat(v, pre + k + '.'));
    return o;
  }, {});
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const zh = flat(DICT.zh as unknown as Tree), en = flat(DICT.en as unknown as Tree);

describe('i18n', () => {
  it('both languages have the same keys and no empty strings', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(Object.entries({ ...zh, ...en }).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
  it('both languages use the same placeholders', () => {
    expect(Object.keys(zh).filter((k) => holes(zh[k]).join() !== holes(en[k]).join())).toEqual([]);
  });
  it('every f(T.key, { … }) call passes exactly the placeholders of its string', () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) files.push(p);
    });
    walk(join(__dirname));
    const bad: string[] = [];
    let calls = 0;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // f(T.key, {…}), f(T.key[x], {…}) and f(cond ? T.a : T.b, {…})
      const re = /\bf\(\s*(?:[^,?]*\?\s*T\.(\w+)\s*:\s*T\.(\w+)|(?:T|t|dictFor\([^)]*\))\.([\w.]+)(?:\[[^\]]+\])?)\s*,\s*\{([^}]*)\}\s*\)/g;
      for (const m of src.matchAll(re)) for (const key of [m[1], m[2], m[3]].filter(Boolean)) {
        calls++;
        // `{ n: x, L }`: names before a colon, or shorthand properties.
        const given = m[4].split(',').map((x) => /^\s*(\w+)/.exec(x)?.[1]).filter((x): x is string => !!x);
        const strings = Object.keys(zh).filter((k) => k === key || k.startsWith(key + '.'));
        if (!strings.length) { bad.push(file + ': unknown key ' + key); continue; }
        for (const k of strings) {
          const need = holes(zh[k]);
          const missing = need.filter((h) => !given.includes(h));
          if (missing.length) bad.push(`${file}: ${k} needs {${missing}}`);
        }
      }
    }
    expect(calls).toBeGreaterThanOrEqual(39);
    expect(bad).toEqual([]);
  });
});
