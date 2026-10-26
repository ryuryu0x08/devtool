export interface SegOpt<V extends string> { value: V; label: string; title?: string }

/** Segmented control. */
export function Seg<V extends string>({ opts, value, onChange, size, mono }: {
  opts: SegOpt<V>[];
  value: V;
  onChange: (v: V) => void;
  size?: 'sm';
  mono?: boolean;
}) {
  return (
    <div className={'seg' + (size ? ' ' + size : '')}>
      {opts.map((o) => (
        <button
          key={o.value}
          className={(o.value === value ? 'on' : '') + (mono ? ' mono' : '')}
          title={o.title}
          onClick={() => onChange(o.value)}
          style={mono ? { minWidth: 36 } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Check-style toggle button (✓ / ○). */
export function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className={'btn' + (on ? ' on' : '')} onClick={onClick}>
      {on ? '✓' : '○'} {label}
    </button>
  );
}
