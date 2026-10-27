// App-wide state, its localStorage persistence, and the context shared by every tool.
import { createContext, useContext } from 'react';
import { DICT, SAMPLE_A, SAMPLE_B, SAMPLE_JSON, SAMPLE_TOML, TOOLS, type Dict, type Lang, type ToolId } from './i18n';
import { fmtWall, tzParts, type TsUnit } from './lib/time';
import type { Ec, FoundCode } from './lib/qr';
import type { Eol } from './lib/data';
import type { HashFmt } from './lib/hash';

/** Behaviour switches (editor props in the design prototype). */
export const CONFIG = { smartPaste: true, rememberInputs: true, defaultView: 'tree' as 'tree' | 'text' };

export const WIDE_MIN = 880;

export type Theme = 'light' | 'dark' | 'auto';
export type FmtLang = 'json' | 'toml';

export interface Scan { src: string; name: string; busy: boolean; codes: FoundCode[]; w: number; h: number; failed?: boolean }

export interface State {
  tool: ToolId;
  wide: boolean;
  side: boolean;
  lang: Lang;
  theme: Theme;
  sysDark: boolean;
  palette: boolean;
  pq: string;
  pi: number;
  toast: string;
  /** Inputs (and tool) to restore if the user undoes the last replacement. */
  undo: Partial<State> | null;
  tz: string;
  tzRecent: string[];
  tzOpen: boolean;
  tzQ: string;
  tsIn: string;
  tsUnit: TsUnit | 'auto';
  tmIn: string;
  qrText: string;
  qrEc: Ec;
  scan: Scan | null;
  dragOver: boolean;
  json: string;
  toml: string;
  indent: '2' | '4' | 'tab';
  sortKeys: boolean;
  view: 'tree' | 'text';
  collapsed: Record<FmtLang, Record<string, boolean>>;
  sel: Record<FmtLang, string>;
  diffA: string;
  diffB: string;
  ignoreOrder: boolean;
  onlyDiff: boolean;
  diffView: 'tree' | 'list';
  dCol: Record<string, boolean>;
  /** Side edited last: the next paste or dropped file fills the other one. */
  diffLast: 'diffA' | 'diffB' | null;
  b64In: string;
  b64Mode: 'enc' | 'dec';
  b64Url: boolean;
  b64Pad: boolean;
  b64DataUrl: boolean;
  b64Eol: Eol;
  /** The pasted text had CR line breaks, which the input box turned into LF. */
  b64Cr: boolean;
  /** A file to encode (exact bytes); not stored across reloads. */
  b64File: File | null;
  b64View: 'text' | 'hex';
  hashIn: string;
  hashFmt: HashFmt;
  hashEol: Eol;
  hashCr: boolean;
  hashFile: File | null;
  hashCheck: string;
  urlIn: string;
  urlpIn: string;
  jwtIn: string;
  uniIn: string;
  htmlIn: string;
  hexIn: string;
  numIn: string;
  gzIn: string;
  yamlIn: string;
  xmlIn: string;
  sqlIn: string;
  schemaIn: string;
  schemaData: string;
  tdA: string;
  tdB: string;
  reSrc: string;
  reText: string;
  reRepl: string;
  caseIn: string;
  countIn: string;
  procIn: string;
  escIn: string;
  uuidIn: string;
  cronIn: string;
  colorIn: string;
  colorFg: string;
  colorBg: string;
  /** Not stored: a JWT key / secret stays in memory only. */
  jwtKey: string;
  /** Files for Hex and Gzip (exact bytes); not stored. */
  hexFile: File | null;
  gzFile: File | null;
  /** Text diff: side edited last (the next paste fills the other). */
  tdLast: 'tdA' | 'tdB' | null;
  /** Options of the newer tools, by "tool.option"; stored with the preferences. */
  o: Record<string, string | number | boolean>;
}

export type Patch = Partial<State> | ((s: State) => Partial<State>);

export const ls = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem('tb.' + k);
    return v == null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
};
export const lsSet = (k: string, v: unknown) => {
  try { localStorage.setItem('tb.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

export const localTz = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

type Inputs = Pick<State, 'tsIn' | 'tmIn' | 'qrText' | 'json' | 'toml' | 'diffA' | 'diffB' | 'b64In' | 'hashIn' | 'hashCheck'
  | 'urlIn' | 'urlpIn' | 'jwtIn' | 'uniIn' | 'htmlIn' | 'hexIn' | 'numIn' | 'gzIn' | 'yamlIn' | 'xmlIn' | 'sqlIn' | 'schemaIn' | 'schemaData' | 'tdA' | 'tdB' | 'reSrc' | 'reText' | 'reRepl' | 'caseIn' | 'countIn' | 'procIn' | 'escIn' | 'uuidIn' | 'cronIn' | 'colorIn' | 'colorFg' | 'colorBg'>;
type Prefs = Pick<State, 'side' | 'lang' | 'theme' | 'indent' | 'sortKeys' | 'view' | 'ignoreOrder' | 'onlyDiff' | 'diffView' | 'b64Mode' | 'b64Url' | 'b64Pad' | 'b64DataUrl' | 'hashFmt' | 'o'>;

export const INPUT_KEYS: (keyof Inputs)[] = ['tsIn', 'tmIn', 'qrText', 'json', 'toml', 'diffA', 'diffB', 'b64In', 'hashIn', 'hashCheck',
  'urlIn', 'urlpIn', 'jwtIn', 'uniIn', 'htmlIn', 'hexIn', 'numIn', 'gzIn', 'yamlIn', 'xmlIn', 'sqlIn', 'schemaIn', 'schemaData', 'tdA', 'tdB', 'reSrc', 'reText', 'reRepl', 'caseIn', 'countIn', 'procIn', 'escIn', 'uuidIn', 'cronIn', 'colorIn', 'colorFg', 'colorBg'];
export const pickPrefs = (S: State): Prefs => ({
  side: S.side, lang: S.lang, theme: S.theme, indent: S.indent, sortKeys: S.sortKeys, view: S.view,
  ignoreOrder: S.ignoreOrder, onlyDiff: S.onlyDiff, diffView: S.diffView,
  b64Mode: S.b64Mode, b64Url: S.b64Url, b64Pad: S.b64Pad, b64DataUrl: S.b64DataUrl, hashFmt: S.hashFmt, o: S.o,
});

const validTz = (z: string) => {
  try { tzParts(Date.now(), z); return true; } catch { return false; }
};

export function initState(): State {
  // Last-used zone wins; default is this device's zone.
  const stored = ls<unknown>('tz');
  const tz = typeof stored === 'string' && validTz(stored) ? stored : validTz(localTz) ? localTz : 'UTC';
  // Each input is stored separately (tb.in.<key>); tb.inputs is the older combined format.
  const inp: Partial<Inputs> = {};
  if (CONFIG.rememberInputs) {
    const old = ls<Partial<Inputs>>('inputs') || {};
    for (const k of INPUT_KEYS) {
      const v = ls<string>('in.' + k) ?? old[k];
      if (typeof v === 'string') inp[k] = v;
    }
  }
  // Stored preferences may be damaged or from an older version: keep only valid values.
  const raw = ls<Record<string, unknown>>('prefs');
  const pr: Record<string, unknown> = raw && typeof raw === 'object' ? raw : {};
  const oneOf = <V,>(v: unknown, opts: readonly V[], d: V): V => (opts.includes(v as V) ? (v as V) : d);
  const recent = ls<unknown>('tzRecent');
  const now = Date.now();
  const navLang: Lang = String(navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const saved = ls<string>('tool');
  let sysDark = false;
  try { sysDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch { /* old browser */ }
  return {
    tool: (TOOLS.some((t) => t.id === saved) ? saved : 'ts') as ToolId,
    wide: window.innerWidth >= WIDE_MIN,
    side: pr.side !== false,
    lang: oneOf(pr.lang, ['zh', 'en'] as const, navLang),
    theme: oneOf(pr.theme, ['light', 'dark', 'auto'] as const, 'auto'),
    sysDark,
    palette: false, pq: '', pi: 0, toast: '', undo: null,
    tz, tzRecent: Array.isArray(recent) ? recent.filter((z): z is string => typeof z === 'string' && validTz(z)).slice(0, 5) : [], tzOpen: false, tzQ: '',
    tsIn: inp.tsIn ?? String(Math.floor(now / 1000)),
    tsUnit: 'auto',
    tmIn: inp.tmIn ?? fmtWall(now, tz),
    qrText: inp.qrText ?? 'https://example.com/hello',
    qrEc: 'M', scan: null, dragOver: false,
    json: inp.json ?? SAMPLE_JSON,
    toml: inp.toml ?? SAMPLE_TOML,
    indent: oneOf(pr.indent, ['2', '4', 'tab'] as const, '2'),
    sortKeys: !!pr.sortKeys,
    view: oneOf(pr.view, ['tree', 'text'] as const, CONFIG.defaultView),
    collapsed: { json: {}, toml: {} },
    sel: { json: '', toml: '' },
    diffA: inp.diffA ?? SAMPLE_A,
    diffB: inp.diffB ?? SAMPLE_B,
    ignoreOrder: !!pr.ignoreOrder,
    onlyDiff: pr.onlyDiff !== false,
    diffView: oneOf(pr.diffView, ['tree', 'list'] as const, 'tree'),
    dCol: {},
    diffLast: null,
    b64In: inp.b64In ?? '',
    b64Mode: oneOf(pr.b64Mode, ['enc', 'dec'] as const, 'enc'),
    b64Url: pr.b64Url === true,
    b64Pad: pr.b64Pad !== false,
    b64DataUrl: pr.b64DataUrl === true,
    b64Eol: 'lf', b64Cr: false, b64File: null, b64View: 'text',
    hashIn: inp.hashIn ?? '',
    hashFmt: oneOf(pr.hashFmt, ['hex', 'HEX', 'b64'] as const, 'hex'),
    hashEol: 'lf', hashCr: false, hashFile: null,
    hashCheck: inp.hashCheck ?? '',
    urlIn: inp.urlIn ?? '',
    urlpIn: inp.urlpIn ?? '',
    jwtIn: inp.jwtIn ?? '',
    uniIn: inp.uniIn ?? '',
    htmlIn: inp.htmlIn ?? '',
    hexIn: inp.hexIn ?? '',
    numIn: inp.numIn ?? '',
    gzIn: inp.gzIn ?? '',
    yamlIn: inp.yamlIn ?? '',
    xmlIn: inp.xmlIn ?? '',
    sqlIn: inp.sqlIn ?? '',
    schemaIn: inp.schemaIn ?? '',
    schemaData: inp.schemaData ?? '',
    tdA: inp.tdA ?? '',
    tdB: inp.tdB ?? '',
    reSrc: inp.reSrc ?? '',
    reText: inp.reText ?? '',
    reRepl: inp.reRepl ?? '',
    caseIn: inp.caseIn ?? '',
    countIn: inp.countIn ?? '',
    procIn: inp.procIn ?? '',
    escIn: inp.escIn ?? '',
    uuidIn: inp.uuidIn ?? '',
    cronIn: inp.cronIn ?? '',
    colorIn: inp.colorIn ?? '',
    colorFg: inp.colorFg ?? '#1b1b1d',
    colorBg: inp.colorBg ?? '#ffffff',
    jwtKey: '', hexFile: null, gzFile: null, tdLast: null,
    // Each option is checked where it is read (useOpt), so damaged values fall back to defaults.
    o: pr.o && typeof pr.o === 'object' && !Array.isArray(pr.o) ? Object.fromEntries(Object.entries(pr.o as object).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) : {},
  };
}

/** What pasted text looks like: a tool, or 'tm' (a date for the timestamp tool's second box). */
export type Detected = 'ts' | 'tm' | 'json' | 'toml' | 'b64' | 'jwt' | 'uuid' | 'color' | 'cron' | 'xml' | 'sql' | 'yaml' | 'url' | 'uni' | 'html' | null;

export interface Ctx {
  S: State;
  set: (p: Patch) => void;
  T: Dict;
  lang: Lang;
  isMac: boolean;
  go: (id: ToolId) => void;
  copy: (text: string, msg?: string) => void;
  toast: (msg: string, ms?: number) => void;
  /** Apply a patch that replaces inputs; if non-empty input is lost, offer to undo it. */
  replace: (patch: Partial<State>, msg?: string) => void;
  toolName: (id: ToolId) => string;
  routeText: (text: string, silent?: boolean) => void;
  detect: (text: string) => Detected;
  decodeFile: (file: File, name?: string) => void;
}

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export const dictFor = (lang: Lang) => DICT[lang === 'en' ? 'en' : 'zh'];
