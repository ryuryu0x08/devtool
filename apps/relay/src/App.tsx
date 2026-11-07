// The window: whether the relay listens and where, the routes (left), the chosen route (right).
// It reads the app's state every 1.5 s (requests and their counts change by themselves).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Protocol, type View } from './api';
import { Route } from './Route';
import { Copy, Seg, useToast } from './ui';

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    const read = () =>
      api.state().then(
        (v) => live && setView(v),
        (e) => live && toast(String(e), true),
      );
    void read();
    const h = setInterval(read, 1500);
    return () => {
      live = false;
      clearInterval(h);
    };
  }, [toast]);

  /** Runs a change: the new state on success, the reason as a message otherwise. */
  const apply = useCallback(
    async (p: Promise<View>) => {
      try {
        setView(await p);
        return true;
      } catch (e) {
        toast(String(e), true);
        return false;
      }
    },
    [toast],
  );

  if (!view) return <div className="loading">启动中...</div>;
  const route = view.routes.find((r) => r.id === chosen) ?? view.routes[0];
  const address = view.server.state === 'running' ? view.server.address : `http://127.0.0.1:${view.port}`;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">接口中继</div>
        <ServerState view={view} apply={apply} />
        <nav className="routes" aria-label="入口">
          {view.routes.map((r) => (
            <button key={r.id} type="button" className={'route-item' + (r.id === route?.id ? ' on' : '')} onClick={() => setChosen(r.id)}>
              <span>{r.name}</span>
              <span className="faint">{r.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
            </button>
          ))}
        </nav>
        <NewRoute
          apply={apply}
          made={(v) => {
            const last = v.routes[v.routes.length - 1];
            if (last) setChosen(last.id);
          }}
        />
      </aside>
      <main className="main">
        {view.configError && <div className="banner bad">{view.configError}</div>}
        {route ? (
          <Route key={route.id} route={route} address={address} recent={view.recent} apply={apply} />
        ) : (
          <div className="empty big">
            <p>先在左边新建一个入口: 选 Anthropic 或 OpenAI, 再加上游和 token.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ServerState({ view, apply }: { view: View; apply: (p: Promise<View>) => Promise<boolean> }) {
  const [port, setPort] = useState(String(view.port));
  useEffect(() => setPort(String(view.port)), [view.port]);
  const s = view.server;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(port);
    if (Number.isInteger(n) && n !== view.port) void apply(api.setPort(n));
  };
  return (
    <div className="server">
      {s.state === 'running' && (
        <div className="state ok">
          <span className="dot" /> 运行中 <Copy text={s.address} shown={s.address.replace('http://', '')} className="mono" />
        </div>
      )}
      {s.state === 'starting' && <div className="state">启动中...</div>}
      {s.state === 'failed' && (
        <div className="state bad">
          <span className="dot" /> {s.error}
        </div>
      )}
      <form className="port" onSubmit={submit}>
        <span className="faint">端口</span>
        <input className="mono" value={port} inputMode="numeric" aria-label="端口" onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
        {port !== String(view.port) && <button className="btn sm">应用</button>}
      </form>
    </div>
  );
}

function NewRoute({ apply, made }: { apply: (p: Promise<View>) => Promise<boolean>; made: (v: View) => void }) {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<Protocol>('anthropic');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = api.addRoute(name, protocol);
    if (await apply(p)) {
      setName('');
      made(await p);
    }
  };
  return (
    <form className="new-route" onSubmit={submit}>
      <div className="faint">新建入口</div>
      <input value={name} placeholder="名字, 比如 主线" aria-label="新入口名字" onChange={(e) => setName(e.target.value)} />
      <Seg<Protocol> value={protocol} options={[['anthropic', 'Anthropic'], ['openai', 'OpenAI']]} onChange={setProtocol} />
      <button className="btn sm inv" disabled={!name.trim()}>
        新建
      </button>
    </form>
  );
}
