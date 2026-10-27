import type { ButtonHTMLAttributes } from 'react';
import { useApp } from '../store';

/** A labelled value that copies itself when clicked anywhere on the row: no separate button to find. */
export function Kv({ label, value, labelColor, ...rest }: { label: string; value: string; labelColor?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'>) {
  const { T, copy } = useApp();
  return (
    <button className="kv" onClick={() => copy(value)} {...rest}>
      <span className="k" style={labelColor ? { color: labelColor, fontWeight: 600 } : undefined}>{label}</span>
      <span className="v">{value}</span>
      <span className="c">{T.copy}</span>
    </button>
  );
}

export function KvRows({ rows }: { rows: [string, string][] }) {
  return <>{rows.map(([label, value]) => <Kv key={label} label={label} value={value} />)}</>;
}
