// The proxy tool's view of a capture backend: what the window shows and asks for, the same
// whichever proxy does the work. lib/proxy/mitmproxy.ts is the first implementation
// (mitmproxy-addons, `bmitmproxy serve`). Times are milliseconds since the epoch.

export type Part = 'request' | 'response';
export type CertFormat = 'pem' | 'cer' | 'p12';

export interface Message {
  httpVersion: string;
  headers: [string, string][];
  /** Body size as received; null while it is still coming or wasn't read. */
  size: number | null;
  /** Identifies the body's content (changes when it does); null without a body. */
  bodyHash: string | null;
  start: number | null;
  end: number | null;
}

export interface Flow {
  id: string;
  kind: 'http' | 'tcp' | 'udp' | 'dns' | 'other';
  created: number;
  method: string;
  scheme: string;
  /** As the client named it (the Host header), else the address connected to. */
  host: string;
  port: number;
  path: string;
  url: string;
  request: Message | null;
  response: (Message & { status: number; reason: string }) | null;
  error: string | null;
  /** The client's address ("192.168.1.8:51234"). */
  client: string;
  /** The server's address, once connected. */
  server: string | null;
  /** TLS version towards the server, when it is TLS. */
  tls: string | null;
  websocket: boolean;
  replay: boolean;
}

export type FlowEvent =
  /** The whole list, on (re)connecting and when the backend replaced it (cleared, trimmed). */
  | { type: 'reset'; flows: Flow[] }
  | { type: 'upsert'; flow: Flow }
  | { type: 'remove'; id: string };

export interface Body {
  text: string;
  /** How the backend decoded it ("JSON", "gRPC", "Raw"…). */
  view: string;
  /** Only the first lines are in `text`; the raw download has all of it. */
  truncated: boolean;
}

export interface BackendInfo {
  /** The implementation ("mitmproxy-addons"). */
  backend: string;
  version: string;
  engine: string;
  /** "serve": started without a window (can be stopped from here); "app": its own window. */
  mode: 'serve' | 'app';
  proxyPort: number;
  /** Addresses other devices on the local network use ("192.168.1.5:8888"). */
  lan: string[];
  /** Page a proxied device opens to install the certificate ("http://mitm.it"). */
  onboarding: string;
}

export interface SystemProxy {
  /** This system's proxy settings can be changed by the backend (macOS for now). */
  supported: boolean;
  platform: string;
  /** The system's HTTP and HTTPS proxies point to this proxy now. */
  enabled: boolean;
  /** Taken over earlier, and since changed by another program (e.g. Clash re-applying its own). */
  overridden: boolean;
  /** Where traffic goes on to: the proxy the system used before ("http://127.0.0.1:7890"). */
  upstream: string | null;
  /** Addresses that bypass the proxy (and so aren't captured). */
  bypass: string[];
  /** This proxy's address ("127.0.0.1:8888"). */
  proxy: string;
}

export interface CaInfo {
  subject: string;
  organization: string;
  sha256: string;
  notBefore: number;
  notAfter: number;
  /** Its private key is public (the backend's shared test certificate): never trust it. */
  sharedInsecure: boolean;
  /** The backend can install it on this computer. */
  trustSupported: boolean;
  /** Trusted on this computer; null when the backend can't tell. */
  trusted: boolean | null;
  platform: string;
}

export type ScriptStatus = 'loaded' | 'failed' | 'pending' | 'missing' | 'disabled';

export interface Script {
  id: number;
  path: string;
  enabled: boolean;
  status: ScriptStatus;
  /** The load error (a traceback) when `failed`. */
  error: string;
}

export type ErrorKind =
  /** Nothing answered (not running, or the page's address isn't allowed: the browser can't tell which). */
  | 'unreachable'
  /** Missing or wrong token. */
  | 'unauthorized'
  /** Something answered, but not a backend this tool can use (an older version, another program). */
  | 'incompatible'
  /** This system doesn't support it. */
  | 'unsupported'
  /** The backend answered with a reason (a cancelled system prompt, a bad path…). */
  | 'failed'
  | 'timeout';

export class BackendError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly status = 0) {
    super(message);
  }
}

export interface ProxyBackend {
  info(): Promise<BackendInfo>;
  /** Ends the backend (only when `info().mode` is "serve"); a taken-over system proxy is restored. */
  stop(): Promise<void>;

  /** Live flows: `reset` first, then changes; `onLive` says whether updates are arriving. Returns the stop. */
  watch(onEvent: (e: FlowEvent) => void, onLive: (live: boolean) => void): () => void;
  body(id: string, part: Part): Promise<Body>;
  raw(id: string, part: Part): Promise<Blob>;
  curl(id: string): Promise<string>;
  /** Drops these flows from the backend (the list's "clear", once its undo has passed). */
  remove(ids: string[]): Promise<void>;

  systemProxy(): Promise<SystemProxy>;
  setSystemProxy(on: boolean): Promise<SystemProxy>;

  ca(): Promise<CaInfo>;
  /** Installs and trusts it on this computer: the system asks for the user's password first. */
  trustCa(): Promise<CaInfo>;
  untrustCa(): Promise<CaInfo>;
  caFile(format: CertFormat): Promise<Blob>;

  scripts(): Promise<Script[]>;
  /** Resolve once the script has loaded or failed (or a few seconds passed: `pending`). */
  addScript(path: string, create: boolean): Promise<Script>;
  setScriptEnabled(id: number, on: boolean): Promise<Script>;
  removeScript(id: number): Promise<void>;
  readScript(id: number): Promise<string>;
  writeScript(id: number, content: string): Promise<Script>;
}
