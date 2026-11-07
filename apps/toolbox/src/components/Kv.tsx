import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useApp } from '../store';

/** Values longer than this are shown in part (the click still copies all of it). */
const KV_SHOW = 20_000;

/** A labelled value that copies itself when clicked anywhere on the row: no separate button to find. */
export function Kv({ label, value, labelColor, ...rest }: { label: string; value: string; labelColor?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'>) {
  const { T, copy } = useApp();
  const shown = value.length > KV_SHOW ? value.slice(0, /[\ud800-\udbff]/.test(value[KV_SHOW - 1]) ? KV_SHOW - 1 : KV_SHOW) + '…' : value;
  return (
    <button className="kv" title={T.clickCopy} onClick={() => copy(value)} {...rest}>
      <span className="k" style={labelColor ? { color: labelColor, fontWeight: 600 } : undefined}>{label}</span>
      <span className="v">{shown}</span>
    </button>
  );
}

export function KvRows({ rows }: { rows: [string, string][] }) {
  return <>{rows.map(([label, value]) => <Kv key={label} label={label} value={value} />)}</>;
}

/**
 * A block of result text: a click copies all of it (`value`, which may be longer than what is
 * shown); dragging selects part of it instead, to copy with ⌘C / Ctrl C.
 */
export function CopyBlock({ value, children, className = '', style }: { value: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const { T, copy } = useApp();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    copy(value);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(value); }
  };
  return (
    <div role="button" tabIndex={0} title={T.clickCopy} className={'copy-block ' + className} onClick={onClick} onKeyDown={onKey} style={style}>
      {children}
    </div>
  );
}
