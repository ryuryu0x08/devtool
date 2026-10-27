// JSON Schema validation with Ajv (draft-06, draft-07, 2019-09, 2020-12, picked from $schema).
// What Ajv can't do exactly is said: numbers beyond double precision, ignored keywords.
import Ajv, { type ErrorObject } from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import draft6 from 'ajv/dist/refs/json-schema-draft-06.json';
import addFormats from 'ajv-formats';
import localize from 'ajv-i18n';
import { cp, numKey } from './data';
import { dupKeys, parseJsonAst, type JNode } from './json';

export type Draft = '06' | '07' | '2019-09' | '2020-12';

export class SchemaError extends Error {
  constructor(readonly code: 'draft4' | 'ref' | 'compile' | 'dup' | 'notSchema', readonly detail = '') { super(code + ': ' + detail); }
}

export function draftOf(schema: unknown): Draft {
  const id = schema && typeof schema === 'object' ? String((schema as Record<string, unknown>).$schema ?? '') : '';
  if (/draft-04/.test(id) || /draft-03/.test(id)) throw new SchemaError('draft4', id);
  if (/2020-12/.test(id)) return '2020-12';
  if (/2019-09/.test(id)) return '2019-09';
  if (/draft-06/.test(id)) return '06';
  return '07';
}

/** Numbers that JSON.parse (and so Ajv) can't hold exactly. */
export function inexact(n: JNode, path = '$', out: string[] = []): string[] {
  if (n.t === 'num' && numKey(n.raw) !== numKey(String(Number(n.raw)))) out.push(path + ' = ' + n.raw);
  else if (n.t === 'arr') n.e.forEach((x, i) => inexact(x, cp(path, i, true), out));
  else if (n.t === 'obj') n.e.forEach((x) => inexact(x.v, cp(path, x.k, false), out));
  return out;
}

/** JSON Pointer (/a/0/b~1c) → $.a[0]["b/c"]. */
export function pointerToPath(p: string): string {
  if (!p) return '$';
  return p.split('/').slice(1).reduce((acc, seg) => {
    const k = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(k) ? acc + '[' + k + ']' : cp(acc, k, false);
  }, '$');
}

export interface SchemaIssue { path: string; message: string; keyword: string; schemaPath: string }
export interface SchemaResult { valid: boolean; issues: SchemaIssue[]; draft: Draft; ignored: string[]; inexact: string[] }

function ajvFor(d: Draft, warn: (m: string) => void): Ajv {
  const opts = { allErrors: true, strict: 'log' as const, verbose: true, logger: { log() {}, warn: (...m: unknown[]) => warn(m.map(String).join(' ')), error() {} } };
  const a = d === '2020-12' ? new Ajv2020(opts) : d === '2019-09' ? new Ajv2019(opts) : new Ajv(opts);
  if (d === '06') a.addMetaSchema(draft6);
  addFormats(a);
  return a;
}

function parseStrict(text: string, which: 'schema' | 'data') {
  const { ast } = parseJsonAst(text);
  const d = dupKeys(ast);
  if (d.length) throw new SchemaError('dup', which + ':' + d[0]);
  return { ast, value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown };
}

export function validateJson(schemaText: string, dataText: string, lang: 'zh' | 'en'): SchemaResult {
  const s = parseStrict(schemaText, 'schema');
  if (typeof s.value !== 'object' && typeof s.value !== 'boolean') throw new SchemaError('notSchema');
  const data = parseStrict(dataText, 'data');
  const draft = draftOf(s.value);
  const ignored: string[] = [];
  // A fresh instance per schema, so earlier schemas ($id) and warnings don't leak in.
  const ajv = ajvFor(draft, (m) => ignored.push(m.replace(/^strict mode: /, '')));
  let validate;
  try { validate = ajv.compile(s.value as object); } catch (e) {
    const msg = String((e as Error).message);
    if (/can't resolve reference|missing ref/i.test(msg)) throw new SchemaError('ref', msg.replace(/^.*reference /i, ''));
    throw new SchemaError('compile', msg);
  }
  const valid = validate(data.value) as boolean;
  const errs: ErrorObject[] = validate.errors ?? [];
  if (lang === 'zh') localize.zh(errs);
  const issues = errs.map((e) => ({
    path: pointerToPath(e.instancePath), keyword: e.keyword, schemaPath: e.schemaPath,
    message: (e.message ?? e.keyword) + (e.keyword === 'additionalProperties' ? ': ' + String((e.params as { additionalProperty?: string }).additionalProperty) : ''),
  }));
  return { valid, issues, draft, ignored: [...new Set(ignored)], inexact: inexact(data.ast) };
}

/** A JSON object that reads as a schema ($schema, or type / properties at the top). */
export function looksSchema(text: string): boolean {
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === 'object' && !Array.isArray(v) && ('$schema' in v || ('type' in v && ('properties' in v || 'items' in v)));
  } catch { return false; }
}
