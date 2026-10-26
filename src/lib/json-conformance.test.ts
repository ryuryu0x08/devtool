/// <reference types="node" />
// JSONTestSuite (test/json-test-suite, from nst/JSONTestSuite): the parser as the app uses it —
// strict UTF-8 decoding of the file's bytes, then parseJsonAst — plus lossless formatting.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Num, canon, decodeUtf8, type Obj } from './data';
import { astEqual, jsonValue, parseJsonAst, printJson } from './json';

const DIR = join(__dirname, '../../test/json-test-suite/test_parsing');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

/** What the app does with a dropped file: null if refused (bad UTF-8 or a parse error). */
function open(f: string) {
  const text = decodeUtf8(readFileSync(join(DIR, f)));
  if (text === null) return null;
  try { return { text, ...parseJsonAst(text) }; } catch { return null; }
}

describe('JSONTestSuite', () => {
  it('has the suite', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('accepts every y_ document and formats it token-for-token', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x.startsWith('y_'))) {
      const d = open(f);
      if (!d) { bad.push(f + ': rejected'); continue; }
      for (const ind of ['', 2, '\t'] as const) {
        const out = printJson(d.ast, ind);
        if (!astEqual(parseJsonAst(out).ast, d.ast)) bad.push(f + ': formatting changed a token');
      }
    }
    expect(bad).toEqual([]);
  });

  it('rejects every n_ document', () => {
    expect(files.filter((x) => x.startsWith('n_')).filter((f) => open(f) !== null)).toEqual([]);
  });

  it('i_ documents: no crash; accepted ones keep every number as written', () => {
    for (const f of files.filter((x) => x.startsWith('i_'))) {
      const d = open(f);
      if (!d) continue;
      expect(printJson(d.ast)).toBe(printJson(parseJsonAst(printJson(d.ast)).ast));
      for (const m of d.text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) expect(printJson(d.ast)).toContain(m[0]);
    }
  });

  it('agrees with JSON.parse on accept / reject and on values (where a double is exact)', () => {
    const differ: string[] = [];
    for (const f of files) {
      const text = decodeUtf8(readFileSync(join(DIR, f)));
      if (text === null) continue;
      let native: unknown, nativeOk = true;
      try { native = JSON.parse(text); } catch { nativeOk = false; }
      const ours = open(f);
      // A leading BOM is accepted (and reported) by us, rejected by JSON.parse.
      if (!!ours !== nativeOk && !text.startsWith('﻿')) differ.push(f);
      if (ours && nativeOk && !/\d{16,}|\d[eE][+-]?\d{3,}/.test(text)) {
        try { if (canon(jsonValue(ours.ast).v) !== canon(fromNative(native))) differ.push(f + ' (value)'); } catch { /* duplicate keys */ }
      }
    }
    expect(differ).toEqual([]);
  });
});

function fromNative(v: unknown): unknown {
  if (typeof v === 'number') return new Num(String(v), 'float', 'json');
  if (Array.isArray(v)) return v.map(fromNative);
  if (v && typeof v === 'object') {
    const o: Obj = {};
    for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: fromNative((v as Obj)[k]), enumerable: true });
    return o;
  }
  return v;
}
