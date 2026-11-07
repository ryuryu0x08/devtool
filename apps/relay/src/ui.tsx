// Small pieces the window is made of: a switch, a value that copies on click, a delete that asks
// for a second click, and a short message at the bottom.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Toasts({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ text: string; bad: boolean; n: number } | null>(null);
  const n = useRef(0);
  // The same function every time: the window's effects that use it don't start over.
  const show = useCallback((text: string, bad = false) => setT({ text, bad, n: ++n.current }), []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.bad ? 5000 : 1800);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div key={t.n} className={'toast' + (t.bad ? ' bad' : '')} role="status">
          {t.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={'switch' + (on ? ' on' : '')} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** A value shown as it is; a click copies it. */
export function Copy({ text, shown, className = '' }: { text: string; shown?: ReactNode; className?: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('复制失败, 请手动选中复制', true);
    }
  };
  return (
    <button type="button" className={'copy ' + className} title="点击复制" onClick={copy}>
      {shown ?? text}
    </button>
  );
}

/** A delete that asks "确认删除?" on the first click and does it on the second (3 s to decide). */
export function DeleteButton({ onConfirm, label = '删除' }: { onConfirm: () => void; label?: string }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const h = setTimeout(() => setAsking(false), 3000);
    return () => clearTimeout(h);
  }, [asking]);
  return (
    <button
      type="button"
      className={'btn sm' + (asking ? ' danger' : '')}
      onClick={() => {
        if (asking) {
          setAsking(false);
          onConfirm();
        } else setAsking(true);
      }}
    >
      {asking ? '确认删除?' : label}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg sm" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** "14:03:21" today, "11-06 14:03" before. */
export function time(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return d.toDateString() === new Date().toDateString() ? hms : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms.slice(0, 5)}`;
}
