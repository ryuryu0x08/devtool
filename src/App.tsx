import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { TOOLS, f, type ToolId } from './i18n';
import {
  AppCtx, CONFIG, INPUT_KEYS, WIDE_MIN, dictFor, initState, lsSet, pickPrefs, type Ctx, type Patch, type State,
} from './store';
import { hasMs, parseTime } from './lib/time';
import { loadImage, scanImage } from './lib/qr';
import { smolParse } from './lib/toml';
import { clipboardUnsafe, decodeUtf8 } from './lib/data';
import { MobileBar, Sidebar } from './components/Sidebar';
import { Palette } from './components/Palette';
import { Vis } from './components/Vis';
import { Timestamp } from './tools/Timestamp';
import { QrGen, QrScan } from './tools/Qr';
import { Formatter } from './tools/Formatter';
import { Diff } from './tools/Diff';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i;

const reducer = (s: State, p: Patch): State => ({ ...s, ...(typeof p === 'function' ? p(s) : p) });

const isField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function App() {
  const [S, set] = useReducer(reducer, undefined, initState);
  const ref = useRef(S);
  ref.current = S;
  const T = dictFor(S.lang);
  const lang = S.lang === 'en' ? 'en' : 'zh';
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const dark = S.theme === 'dark' || (S.theme === 'auto' && S.sysDark);

  const toastTimer = useRef<number | undefined>(undefined);
  const toast = useCallback((msg: string, ms = 1500, undo: Partial<State> | null = null) => {
    clearTimeout(toastTimer.current);
    set({ toast: msg, undo });
    toastTimer.current = window.setTimeout(() => set({ toast: '', undo: null }), ms);
  }, []);

  // Sample / clear / convert / smart paste / file drop replace what the user typed: never without a way back.
  const replace = useCallback((patch: Partial<State>, msg?: string) => {
    const s = ref.current;
    const prev: Partial<State> = { tool: s.tool };
    let lost = false;
    for (const k of INPUT_KEYS) {
      if (!(k in patch)) continue;
      (prev as Record<string, unknown>)[k] = s[k];
      if (s[k].trim() && s[k] !== patch[k]) lost = true;
    }
    set(patch);
    const t = dictFor(s.lang);
    if (lost) toast((msg ? msg + ' · ' : '') + t.replacedOld, 8000, prev);
    else if (msg) toast(msg, 4000);
  }, [toast]);

  const copy = useCallback((text: string, msg?: string) => {
    const t = dictFor(ref.current.lang);
    // The system clipboard may truncate at NUL or replace lone surrogates: say so.
    const done = () => (clipboardUnsafe(text) ? toast(t.copyRisky, 5000) : toast(msg || t.copied));
    const fallback = () => {
      const prev = document.activeElement;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
      ta.remove();
      // select() took focus; give it back so the user's caret stays where it was.
      if (prev instanceof HTMLElement && prev !== document.body) prev.focus();
      // Never claim success when nothing was copied.
      if (ok) done();
      else toast(t.copyFail, 5000);
    };
    try { navigator.clipboard.writeText(String(text)).then(done, fallback); } catch { fallback(); }
  }, [toast]);

  const toolName = useCallback((id: ToolId) => {
    const t = TOOLS.find((x) => x.id === id);
    return t ? t[ref.current.lang === 'en' ? 'en' : 'zh'][0] : '';
  }, []);

  const go = useCallback((id: ToolId) => {
    set({ tool: id, palette: false, pq: '', pi: 0, tzOpen: false });
    if (!ref.current.wide) window.scrollTo(0, 0);
  }, []);

  /** Guess which tool a piece of pasted text belongs to. */
  const detect = useCallback((text: string): ReturnType<Ctx['detect']> => {
    const s = String(text || '').trim();
    if (!s) return null;
    if (/^-?\d{9,19}(\.\d+)?$/.test(s)) return 'ts';
    if (/^[[{]/.test(s)) { try { JSON.parse(s); return 'json'; } catch { /* not JSON */ } }
    if (/^\s*(\[[^\]\n]+\]|[\w."'-]+\s*=)/m.test(s)) { try { smolParse(s); return 'toml'; } catch { /* not TOML */ } }
    if (s.length < 40 && /\d/.test(s) && hasMs(parseTime(s, ref.current.tz, Date.now()))) return 'tm';
    return null;
  }, []);

  const routeText = useCallback((text: string, silent?: boolean) => {
    const s = String(text);
    const d = detect(s);
    let patch: Partial<State>, tool: ToolId;
    if (d === 'ts') { tool = 'ts'; patch = { tsIn: s.trim() }; }
    else if (d === 'tm') { tool = 'ts'; patch = { tmIn: s.trim() }; }
    else if (d === 'json') { tool = 'json'; patch = { json: s, sel: { ...ref.current.sel, json: '' } }; }
    else if (d === 'toml') { tool = 'toml'; patch = { toml: s, sel: { ...ref.current.sel, toml: '' } }; }
    else { tool = 'qrgen'; patch = { qrText: s }; }
    replace({ ...patch, tool, palette: false, pq: '' }, silent ? undefined : f(dictFor(ref.current.lang).routed, { t: toolName(tool) }));
  }, [detect, replace, toolName]);

  const decodeFile = useCallback(async (file: File, name?: string) => {
    const t = dictFor(ref.current.lang);
    // Browsers give no type for files without a known extension: try to read those as images too.
    if (!file || (file.type && !/^image\//.test(file.type))) { toast(t.notImage); return; }
    const old = ref.current.scan;
    if (old?.src) URL.revokeObjectURL(old.src);
    const src = URL.createObjectURL(file);
    const nm = name || file.name || 'image';
    set({ tool: 'qrscan', scan: { src, name: nm, busy: true, codes: [], w: 1, h: 1 }, palette: false });
    let img: HTMLImageElement;
    try { img = await loadImage(src); } catch {
      // Unreadable (e.g. HEIC outside Safari): say so rather than "no QR code found".
      if (ref.current.scan?.src === src) set({ scan: { src, name: nm, busy: false, codes: [], w: 1, h: 1, failed: true } });
      return;
    }
    const codes = await scanImage(img);
    // Ignore results for an image that has since been replaced.
    if (ref.current.scan?.src !== src) return;
    set({ scan: { src, name: nm, busy: false, codes, w: img.naturalWidth, h: img.naturalHeight } });
  }, [toast]);

  const handleFiles = useCallback((files: File[]) => {
    const t = dictFor(ref.current.lang);
    const isImage = (x: File) => /^image\//.test(x.type) || (!x.type && IMAGE_EXT.test(x.name));
    const file = files.find((x) => isImage(x) || /\.(json|toml|txt)$/i.test(x.name));
    if (!file) { toast(t.unsupportedFile, 5000); return; }
    // Only one file is opened; say which when several were dropped.
    const note = files.length > 1 ? f(t.onlyFirst, { n: file.name }) : undefined;
    if (isImage(file)) {
      decodeFile(file);
      if (note) toast(note, 5000);
      return;
    }
    file.arrayBuffer().then((buf) => {
      // file.text() would silently turn invalid bytes into U+FFFD.
      const s = decodeUtf8(buf);
      if (s === null) { toast(t.notUtf8, 5000); return; }
      if (/\.toml$/i.test(file.name)) replace({ toml: s, sel: { ...ref.current.sel, toml: '' }, tool: 'toml' }, note);
      else if (/\.json$/i.test(file.name)) replace({ json: s, sel: { ...ref.current.sel, json: '' }, tool: 'json' }, note);
      else routeText(s);
    });
  }, [decodeFile, replace, routeText, toast]);

  // Global listeners: resize, system theme, shortcuts, smart paste, drag & drop.
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth >= WIDE_MIN;
      if (w !== ref.current.wide) set({ wide: w });
    };
    let mq: MediaQueryList | null = null;
    const onMq = (e: MediaQueryListEvent) => set({ sysDark: e.matches });
    try { mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', onMq); } catch { /* old browser */ }

    const onKey = (e: KeyboardEvent) => {
      // Keys that confirm or cancel an IME composition (pinyin etc.) are not shortcuts.
      if (e.isComposing || e.keyCode === 229) return;
      const s = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); set({ palette: !s.palette, pq: '', pi: 0 }); return; }
      if (mod && k === 'b' && s.wide) { e.preventDefault(); set({ side: !s.side }); return; }
      if (e.key === 'Escape') {
        if (s.palette) set({ palette: false });
        else if (s.tzOpen) set({ tzOpen: false, tzQ: '' });
        return;
      }
      if (e.key === '/' && !isField(e.target) && !s.palette) { e.preventDefault(); set({ palette: true, pq: '', pi: 0 }); }
    };

    const onPaste = (e: ClipboardEvent) => {
      // Text wins: apps like Office put a picture of the selection next to the text.
      const text = e.clipboardData?.getData('text') || '';
      if (!text.trim()) {
        for (const it of Array.from(e.clipboardData?.items || [])) {
          if (it.type?.startsWith('image/')) {
            const file = it.getAsFile();
            if (file) { e.preventDefault(); decodeFile(file, dictFor(ref.current.lang).pasted); return; }
          }
        }
        return;
      }
      if (isField(e.target) || !CONFIG.smartPaste) return;
      e.preventDefault();
      routeText(text);
    };

    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const dEnter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; if (!ref.current.dragOver) set({ dragOver: true }); };
    const dOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const dLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth--; if (depth <= 0) { depth = 0; set({ dragOver: false }); } };
    const dDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      set({ dragOver: false });
      handleFiles(Array.from(e.dataTransfer!.files || []));
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', dEnter);
    window.addEventListener('dragover', dOver);
    window.addEventListener('dragleave', dLeave);
    window.addEventListener('drop', dDrop);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', dEnter);
      window.removeEventListener('dragover', dOver);
      window.removeEventListener('dragleave', dLeave);
      window.removeEventListener('drop', dDrop);
      mq?.removeEventListener('change', onMq);
    };
  }, [decodeFile, routeText, handleFiles]);

  // Theme on <html> so body background and native controls follow it.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [dark, lang]);

  // Persist the current tool, preferences and (debounced) inputs.
  useEffect(() => { lsSet('tool', S.tool); }, [S.tool]);
  const prefs = JSON.stringify(pickPrefs(S));
  useEffect(() => { try { localStorage.setItem('tb.prefs', prefs); } catch { /* ignore */ } }, [prefs]);
  // Inputs are saved one key at a time. If one doesn't fit, its stored copy is removed (so a
  // reload never shows stale content) and the user is told it won't be kept.
  const saved = useRef<Partial<Record<string, string>>>({});
  const unsaved = useRef(new Set<string>());
  useEffect(() => {
    if (!CONFIG.rememberInputs) return;
    const t = setTimeout(() => {
      const s = ref.current;
      let newlyFailed = false;
      for (const k of INPUT_KEYS) {
        if (saved.current[k] === s[k]) continue;
        try {
          localStorage.setItem('tb.in.' + k, JSON.stringify(s[k]));
          saved.current[k] = s[k];
          unsaved.current.delete(k);
        } catch {
          try { localStorage.removeItem('tb.in.' + k); } catch { /* storage unavailable */ }
          saved.current[k] = undefined;
          if (!unsaved.current.has(k)) newlyFailed = true;
          unsaved.current.add(k);
        }
      }
      try { localStorage.removeItem('tb.inputs'); } catch { /* storage unavailable */ }
      if (newlyFailed) toast(dictFor(s.lang).notSaved, 5000);
    }, 400);
    return () => clearTimeout(t);
  }, INPUT_KEYS.map((k) => S[k]));

  // On desktop, focus the tool's main input after switching tools, unless the user is already
  // typing elsewhere (moving focus then would send their keystrokes or paste to the wrong field).
  useEffect(() => {
    if (!ref.current.wide) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[data-autofocus]');
      const a = document.activeElement;
      const typing = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || (a instanceof HTMLElement && a.isContentEditable);
      if (el && !typing && !ref.current.palette) el.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [S.tool]);

  const ctx = useMemo<Ctx>(() => ({ S, set, T, lang, isMac, go, copy, toast, replace, toolName, routeText, detect, decodeFile }),
    [S, T, lang, isMac, go, copy, toast, replace, toolName, routeText, detect, decodeFile]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        {S.wide && <Sidebar />}
        <main className="main">
          {!S.wide && <MobileBar />}
          <div className="content" style={{ padding: S.wide ? '26px 36px 56px' : '14px 14px 40px' }}>
            {S.tool === 'ts' && <Timestamp />}
            {S.tool === 'qrgen' && <QrGen />}
            {S.tool === 'qrscan' && <QrScan />}
            {(S.tool === 'json' || S.tool === 'toml') && <Formatter key={S.tool} lang={S.tool} />}
            {S.tool === 'diff' && <Diff />}
          </div>
        </main>
        {S.palette && <Palette />}
        {S.dragOver && (
          <div className="drop-overlay">
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--acc)' }}>{T.dropHere}</span>
            <span style={{ fontSize: 13, color: 'var(--mut)' }}>{T.dropHereSub}</span>
          </div>
        )}
        {S.toast && (
          <div className="toast">
            <Vis text={S.toast} />
            {S.undo && (
              <button className="toast-undo" onClick={() => { clearTimeout(toastTimer.current); set({ ...S.undo!, toast: '', undo: null }); }}>{T.undo}</button>
            )}
          </div>
        )}
      </div>
    </AppCtx.Provider>
  );
}
