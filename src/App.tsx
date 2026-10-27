import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { TOOLS, f, type ToolId } from './i18n';
import {
  AppCtx, CONFIG, INPUT_KEYS, WIDE_MIN, dictFor, initState, lsSet, pickPrefs, type Ctx, type Patch, type State,
} from './store';
import { hasMs, parseTime } from './lib/time';
import { loadImage, scanImage } from './lib/qr';
import { smolParse } from './lib/toml';
import { clipboardUnsafe, decodeUtf8, normEol } from './lib/data';
import { b64decode, looksB64 } from './lib/b64';
import { hashLike } from './lib/hash';
import { MobileBar, Sidebar } from './components/Sidebar';
import { Palette } from './components/Palette';
import { Vis } from './components/Vis';
import { Timestamp } from './tools/Timestamp';
import { QrGen, QrScan } from './tools/Qr';
import { Formatter } from './tools/Formatter';
import { Diff } from './tools/Diff';
import { Base64 } from './tools/Base64';
import { Hash } from './tools/Hash';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i;
/** Files held in memory (Base64 / Hash): replacing one can be undone like replacing text. */
const FILE_KEYS: (keyof State)[] = ['hashFile', 'b64File'];

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
  // Undo restores everything the patch changed; it is offered when typed text or a file is lost.
  const replace = useCallback((patch: Partial<State>, msg?: string) => {
    const s = ref.current;
    const prev: Partial<State> = { tool: s.tool };
    let lost = false;
    for (const k of Object.keys(patch) as (keyof State)[]) {
      (prev as Record<string, unknown>)[k] = s[k];
      if ((INPUT_KEYS as (keyof State)[]).includes(k) && (s[k] as string).trim() && s[k] !== patch[k]) lost = true;
      if (FILE_KEYS.includes(k) && s[k] && s[k] !== patch[k]) lost = true;
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
    if (looksB64(s)) return 'b64';
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
    else if (d === 'b64') { const n = normEol(s); tool = 'b64'; patch = { b64In: n.text, b64Cr: n.cr, b64File: null, b64Mode: 'dec' }; }
    else { tool = 'qrgen'; patch = { qrText: normEol(s).text }; }
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

  /** Base64 and Hash take any file as bytes; decoding Base64 reads a file of Base64 text into the input. */
  const byteFile = useCallback((file: File, note?: string) => {
    const s = ref.current, t = dictFor(s.lang);
    if (s.tool === 'hash') set({ hashFile: file, hashCr: false });
    else if (s.b64Mode === 'enc') set({ b64File: file, b64Cr: false });
    else {
      file.arrayBuffer().then((buf) => {
        const text = decodeUtf8(buf);
        let decodable = false;
        try { decodable = text !== null && !!b64decode(text); } catch { /* not Base64 */ }
        if (decodable) { replace({ b64In: normEol(text!).text, b64Cr: false }, note); return; }
        set({ b64Mode: 'enc', b64File: file, b64Cr: false });
        toast(t.b64.notText, 6000);
      }, () => toast(t.readFail, 5000));
      return;
    }
    if (note) toast(note, 5000);
  }, [replace, toast]);

  /** Comparing: fill the side not edited last, so pasting twice fills A, then B. */
  const fillDiff = useCallback((raw: string, note?: string) => {
    const s = ref.current, t = dictFor(s.lang);
    const side = s.diffLast === 'diffA' ? 'diffB' : 'diffA';
    replace({ [side]: normEol(raw).text, diffLast: side }, [note, f(t.filledSide, { s: side === 'diffA' ? 'A' : 'B' })].filter(Boolean).join(' · '));
  }, [replace]);

  /**
   * Text pasted on a blank area, or read from a dropped .txt, stays in the current tool when that
   * tool can use it. Returns false when it should be routed to a tool by its content instead.
   */
  const takeText = useCallback((raw: string, note?: string): boolean => {
    const s = ref.current, t = dictFor(s.lang);
    const n = normEol(raw);
    const msg = (...m: string[]) => [note, ...m].filter(Boolean).join(' · ') || undefined;
    switch (s.tool) {
      case 'qrgen':
        replace({ qrText: n.text }, msg());
        return true;
      case 'hash':
        // A checksum pasted while there is something to check is checked, not hashed.
        if (hashLike(n.text) && (s.hashFile || s.hashIn)) replace({ hashCheck: n.text.trim() }, msg(t.hs.toCheck));
        else replace({ hashIn: n.text, hashFile: null, hashCr: n.cr }, msg());
        return true;
      case 'b64': {
        const mode = looksB64(n.text) ? 'dec' : 'enc';
        replace({ b64In: n.text, b64File: null, b64Cr: n.cr, b64Mode: mode },
          msg(mode !== s.b64Mode ? f(t.b64.switched, { m: mode === 'dec' ? t.b64.dec : t.b64.enc }) : ''));
        return true;
      }
      case 'diff': {
        const d = detect(raw);
        if (d !== 'json' && d !== 'toml' && !/^\s*[[{]/.test(raw)) return false;
        fillDiff(raw, note);
        return true;
      }
    }
    return false;
  }, [detect, fillDiff, replace]);

  const handleFiles = useCallback((files: File[]) => {
    const s0 = ref.current, t = dictFor(s0.lang);
    if (!files.length) return;
    if (s0.tool === 'b64' || s0.tool === 'hash') {
      byteFile(files[0], files.length > 1 ? f(t.onlyFirst, { n: files[0].name }) : undefined);
      return;
    }
    const isImage = (x: File) => /^image\//.test(x.type) || (!x.type && IMAGE_EXT.test(x.name));
    const isData = (x: File) => /\.(json|toml)$/i.test(x.name);
    // Comparing: one .json / .toml fills the next side; two fill A and B at once.
    if (s0.tool === 'diff' && files.some(isData)) {
      const two = files.filter(isData).slice(0, 2);
      Promise.all(two.map((x) => x.arrayBuffer())).then((bufs) => {
        const texts = bufs.map((b) => decodeUtf8(b));
        if (texts.some((x) => x === null)) { toast(t.notUtf8, 5000); return; }
        if (two.length === 2) replace({ diffA: normEol(texts[0]!).text, diffB: normEol(texts[1]!).text, diffLast: 'diffB' }, f(t.diffFiles, { a: two[0].name, b: two[1].name }));
        else fillDiff(texts[0]!, files.length > 1 ? f(t.onlyFirst, { n: two[0].name }) : undefined);
      }, () => toast(t.readFail, 5000));
      return;
    }
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
      else if (!takeText(s, note)) routeText(s);
    });
  }, [byteFile, decodeFile, fillDiff, replace, routeText, takeText, toast]);

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
      const s = ref.current;
      const bytes = s.tool === 'b64' || s.tool === 'hash';
      // Text wins: apps like Office put a picture of the selection next to the text.
      const text = e.clipboardData?.getData('text') || '';
      // No text: a file. Base64 / Hash take any file (whitespace is content there); others scan images.
      if (bytes ? !text : !text.trim()) {
        const items = Array.from(e.clipboardData?.items || []);
        const file = items.find((it) => (bytes ? it.kind === 'file' : it.type?.startsWith('image/')))?.getAsFile();
        if (file) { e.preventDefault(); if (bytes) byteFile(file); else decodeFile(file, dictFor(s.lang).pasted); }
        return;
      }
      if (isField(e.target) || !CONFIG.smartPaste) return;
      e.preventDefault();
      if (!takeText(text)) routeText(text);
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
  }, [byteFile, decodeFile, routeText, takeText, handleFiles]);

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
            {S.tool === 'b64' && <Base64 />}
            {S.tool === 'hash' && <Hash />}
          </div>
        </main>
        {S.palette && <Palette />}
        {S.dragOver && (
          <div className="drop-overlay">
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--acc)' }}>{T.dropHere}</span>
            <span style={{ fontSize: 13, color: 'var(--mut)' }}>{S.tool === 'b64' || S.tool === 'hash' ? T.dropAny : S.tool === 'diff' ? T.dropDiff : T.dropHereSub}</span>
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
