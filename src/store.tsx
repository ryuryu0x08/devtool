// App-wide state, its localStorage persistence, and the context shared by every tool.
import { createContext, useContext } from 'react';
import { DICT, SAMPLE_A, SAMPLE_B, SAMPLE_JSON, SAMPLE_TOML, TOOLS, type Dict, type Lang, type ToolId } from './i18n';
import { fmtWall, tzParts, type TsUnit } from './lib/time';
import type { Ec, FoundCode } from './lib/qr';

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

type Inputs = Pick<State, 'tsIn' | 'tmIn' | 'qrText' | 'json' | 'toml' | 'diffA' | 'diffB'>;
type Prefs = Pick<State, 'side' | 'lang' | 'theme' | 'indent' | 'sortKeys' | 'view' | 'ignoreOrder' | 'onlyDiff' | 'diffView'>;

export const INPUT_KEYS: (keyof Inputs)[] = ['tsIn', 'tmIn', 'qrText', 'json', 'toml', 'diffA', 'diffB'];
export const pickPrefs = (S: State): Prefs => ({
  side: S.side, lang: S.lang, theme: S.theme, indent: S.indent, sortKeys: S.sortKeys, view: S.view,
  ignoreOrder: S.ignoreOrder, onlyDiff: S.onlyDiff, diffView: S.diffView,
});

export function initState(): State {
  // Last-used zone wins; default is this device's zone.
  let tz = ls<string>('tz') || localTz;
  try { tzParts(Date.now(), tz); } catch { tz = localTz; }
  // Each input is stored separately (tb.in.<key>); tb.inputs is the older combined format.
  const inp: Partial<Inputs> = {};
  if (CONFIG.rememberInputs) {
    const old = ls<Partial<Inputs>>('inputs') || {};
    for (const k of INPUT_KEYS) {
      const v = ls<string>('in.' + k) ?? old[k];
      if (typeof v === 'string') inp[k] = v;
    }
  }
  const pr: Partial<Prefs> = ls<Prefs>('prefs') || {};
  const now = Date.now();
  const navLang: Lang = String(navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const saved = ls<string>('tool');
  let sysDark = false;
  try { sysDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch { /* old browser */ }
  return {
    tool: (TOOLS.some((t) => t.id === saved) ? saved : 'ts') as ToolId,
    wide: window.innerWidth >= WIDE_MIN,
    side: pr.side !== false,
    lang: pr.lang || navLang,
    theme: pr.theme || 'auto',
    sysDark,
    palette: false, pq: '', pi: 0, toast: '', undo: null,
    tz, tzRecent: ls<string[]>('tzRecent') || [], tzOpen: false, tzQ: '',
    tsIn: inp.tsIn ?? String(Math.floor(now / 1000)),
    tsUnit: 'auto',
    tmIn: inp.tmIn ?? fmtWall(now, tz),
    qrText: inp.qrText ?? 'https://example.com/hello',
    qrEc: 'M', scan: null, dragOver: false,
    json: inp.json ?? SAMPLE_JSON,
    toml: inp.toml ?? SAMPLE_TOML,
    indent: pr.indent || '2',
    sortKeys: !!pr.sortKeys,
    view: pr.view || CONFIG.defaultView,
    collapsed: { json: {}, toml: {} },
    sel: { json: '', toml: '' },
    diffA: inp.diffA ?? SAMPLE_A,
    diffB: inp.diffB ?? SAMPLE_B,
    ignoreOrder: !!pr.ignoreOrder,
    onlyDiff: pr.onlyDiff !== false,
    diffView: pr.diffView || 'tree',
    dCol: {},
  };
}

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
  detect: (text: string) => 'ts' | 'tm' | 'json' | 'toml' | null;
  decodeFile: (file: File, name?: string) => void;
}

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export const dictFor = (lang: Lang) => DICT[lang === 'en' ? 'en' : 'zh'];
