// One route: how clients connect, the tokens handed out for it, the upstreams its requests go to
// (in order), and its latest requests.
import { useState, type FormEvent } from 'react';
import { api, defaultAuth, type AuthStyle, type Entry, type RouteView, type UpstreamInput, type UpstreamView, type View } from './api';
import { Copy, DeleteButton, Seg, Switch, time, useToast } from './ui';

type Apply = (p: Promise<View>) => Promise<boolean>;

export function Route({ route, address, lan, recent, apply }: { route: RouteView; address: string; lan: string[]; recent: Entry[]; apply: Apply }) {
  return (
    <div className="route">
      <Head route={route} apply={apply} />
      <Connect route={route} address={address} lan={lan} />
      <Tokens route={route} apply={apply} />
      <Upstreams route={route} apply={apply} />
      <Recent entries={recent.filter((e) => e.route === route.name)} />
    </div>
  );
}

function Head({ route, apply }: { route: RouteView; apply: Apply }) {
  const [name, setName] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (name === null || name.trim() === route.name || (await apply(api.renameRoute(route.id, name)))) setName(null);
  };
  return (
    <div className="route-head">
      {name === null ? (
        <>
          <h1 className="title">{route.name}</h1>
          <button type="button" className="btn sm ghost" onClick={() => setName(route.name)}>
            改名
          </button>
        </>
      ) : (
        <form className="rename" onSubmit={save}>
          <input value={name} autoFocus aria-label="入口名字" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} />
          <button className="btn sm inv">保存</button>
        </form>
      )}
      <span className="chip">{route.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
      <span className="spacer" />
      <DeleteButton label="删除入口" onConfirm={() => void apply(api.deleteRoute(route.id))} />
    </div>
  );
}

/** How clients connect; `lan`: the addresses other devices on the local network use, if it is on. */
function Connect({ route, address, lan }: { route: RouteView; address: string; lan: string[] }) {
  const at = (a: string) => (route.protocol === 'openai' ? a + '/v1' : a);
  const base = at(address);
  return (
    <section className="card">
      <div className="card-head">客户端怎么连</div>
      <div className="rows">
        <div className="row">
          <span className="k">地址</span>
          <Copy text={base} className="mono" />
        </div>
        {lan.length > 0 && (
          <div className="row lan-row">
            <span className="k">局域网</span>
            <span className="hint">
              {lan.map((a) => (
                <Copy key={a} text={at(a)} className="mono" />
              ))}
            </span>
          </div>
        )}
        {route.protocol === 'anthropic' ? (
          <div className="row">
            <span className="k">Claude Code</span>
            <span className="hint">
              <Copy text={`ANTHROPIC_BASE_URL=${base}`} className="mono" /> 和 <span className="mono">ANTHROPIC_AUTH_TOKEN=</span>下面生成的 token
            </span>
          </div>
        ) : (
          <div className="row">
            <span className="k">OpenAI SDK</span>
            <span className="hint">
              <Copy text={`base_url="${base}"`} className="mono" /> 和 <span className="mono">api_key=</span>下面生成的 token
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function Tokens({ route, apply }: { route: RouteView; apply: Apply }) {
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ route: string; token: string } | null>(null);
  const toast = useToast();
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.addToken(route.id, name);
      setMade({ route: route.id, token: r.token });
      setName('');
      await apply(Promise.resolve(r.view));
    } catch (err) {
      toast(String(err), true);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        token <span className="sub">发给使用者; 只保存它的指纹, 生成时显示一次</span>
      </div>
      {made && made.route === route.id && (
        <div className="reveal">
          <div>新 token, 只显示这一次:</div>
          <Copy text={made.token} className="mono big" />
          <button type="button" className="btn sm" onClick={() => setMade(null)}>
            已保存
          </button>
        </div>
      )}
      <div className="rows">
        {route.tokens.map((t) => (
          <div className="row token" key={t.id}>
            <span className="name">{t.name}</span>
            <span className="mono faint">{t.hint}</span>
            <span className="faint">{t.use.requests ? `${t.use.requests} 次 · 最近 ${time(t.use.lastUsed)}` : '本次启动后未用过'}</span>
            <span className="spacer" />
            <Switch on={t.enabled} label={t.enabled ? '停用' : '启用'} onChange={(on) => void apply(api.setTokenEnabled(route.id, t.id, on))} />
            <DeleteButton onConfirm={() => void apply(api.deleteToken(route.id, t.id))} />
          </div>
        ))}
        <form className="row add" onSubmit={add}>
          <input value={name} placeholder="使用者的名字" aria-label="token 名字" onChange={(e) => setName(e.target.value)} />
          <button className="btn sm inv" disabled={!name.trim()}>
            生成 token
          </button>
        </form>
      </div>
    </section>
  );
}

function Upstreams({ route, apply }: { route: RouteView; apply: Apply }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        上游 <span className="sub">按顺序尝试; 连不上, 429 或 5xx 时换下一个</span>
      </div>
      {!route.upstreams.some((u) => u.enabled) && (
        <div className="warn" role="alert">
          {route.upstreams.length === 0 ? '还没有上游' : '上游都已停用'}: 这个入口的请求会返回 503. {route.upstreams.length === 0 ? '在下面添加一个, 填完点「添加上游」.' : '打开一个上游的开关.'}
        </div>
      )}
      <div className="rows">
        {route.upstreams.map((u, i) =>
          editing === u.id ? (
            <UpstreamForm key={u.id} route={route} upstream={u} apply={apply} done={() => setEditing(null)} />
          ) : (
            <div className={'row upstream' + (u.enabled ? '' : ' off')} key={u.id}>
              <span className="order">{i + 1}</span>
              <span className="name">{u.name}</span>
              <span className="mono url">{u.baseUrl}</span>
              <span className="mono faint">{u.keyHint}</span>
              <span className="faint">
                {u.auth === 'bearer' ? 'Bearer' : 'x-api-key'}
                {u.systemProxy ? ' · 系统代理' : ''}
              </span>
              <span className="spacer" />
              <Switch on={u.enabled} label={u.enabled ? '停用' : '启用'} onChange={(on) => void apply(api.updateUpstream(route.id, u.id, { ...input(u), enabled: on }))} />
              <button type="button" className="btn sm" aria-label="上移" disabled={i === 0} onClick={() => void apply(api.moveUpstream(route.id, u.id, -1))}>
                ↑
              </button>
              <button type="button" className="btn sm" aria-label="下移" disabled={i === route.upstreams.length - 1} onClick={() => void apply(api.moveUpstream(route.id, u.id, 1))}>
                ↓
              </button>
              <button type="button" className="btn sm" onClick={() => setEditing(u.id)}>
                编辑
              </button>
              <DeleteButton onConfirm={() => void apply(api.deleteUpstream(route.id, u.id))} />
            </div>
          ),
        )}
        {editing === null && <UpstreamForm route={route} apply={apply} done={() => {}} />}
      </div>
    </section>
  );
}

/** What a saved upstream is set to, its key left out (kept as it is). */
const input = (u: UpstreamView): UpstreamInput => ({ name: u.name, baseUrl: u.baseUrl, auth: u.auth, enabled: u.enabled, systemProxy: u.systemProxy });

function UpstreamForm({ route, upstream, apply, done }: { route: RouteView; upstream?: UpstreamView; apply: Apply; done: () => void }) {
  const blank = { name: '', baseUrl: '', key: '', auth: defaultAuth(route.protocol), systemProxy: false };
  const [f, setF] = useState(upstream ? { ...input(upstream), key: '' } : blank);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: UpstreamInput = { name: f.name, baseUrl: f.baseUrl, auth: f.auth, enabled: upstream?.enabled ?? true, systemProxy: f.systemProxy, ...(f.key || !upstream ? { key: f.key } : {}) };
    const ok = await apply(upstream ? api.updateUpstream(route.id, upstream.id, body) : api.addUpstream(route.id, body));
    if (ok) {
      if (!upstream) setF(blank);
      done();
    }
  };
  const example = route.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com (不含 /v1)';
  return (
    <form className="upstream-form" onSubmit={submit}>
      <input className="f-name" value={f.name} placeholder="名字" aria-label="上游名字" onChange={(e) => set({ name: e.target.value })} />
      <input className="mono f-url" value={f.baseUrl} placeholder={example} aria-label="上游地址" onChange={(e) => set({ baseUrl: e.target.value })} />
      <input className="mono f-key" type="password" value={f.key} placeholder={upstream ? `key: ${upstream.keyHint}, 不改就留空` : 'key'} aria-label="上游 key" onChange={(e) => set({ key: e.target.value })} />
      <Seg<AuthStyle> value={f.auth} options={[['x-api-key', 'x-api-key'], ['bearer', 'Bearer']]} onChange={(auth) => set({ auth })} />
      <label className="check">
        <input type="checkbox" checked={f.systemProxy} onChange={(e) => set({ systemProxy: e.target.checked })} />
        经系统代理
      </label>
      <button className="btn sm inv">{upstream ? '保存' : '添加上游'}</button>
      {upstream && (
        <button type="button" className="btn sm" onClick={done}>
          取消
        </button>
      )}
    </form>
  );
}

function Recent({ entries }: { entries: Entry[] }) {
  return (
    <section className="card">
      <div className="card-head">
        最近的请求 <span className="sub">不记 key, 请求内容和查询参数</span>
      </div>
      {entries.length === 0 ? (
        <div className="empty">还没有请求</div>
      ) : (
        <table className="recent">
          <tbody>
            {entries.slice(0, 50).map((e, i) => (
              <tr key={e.at + ':' + i}>
                <td className="mono faint">{time(e.at)}</td>
                <td>{e.token}</td>
                <td>{e.upstream}</td>
                <td className="mono">
                  {e.method} {e.path}
                </td>
                <td className={'mono status s' + String(e.status)[0]}>{e.status}</td>
                <td className="mono faint">{e.ms} ms</td>
                <td className="faint note">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
