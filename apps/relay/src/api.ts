// The window's side of the app's commands (src-tauri/src/lib.rs): what it shows (relay-core's
// view, keys masked) and the changes it asks for. Each change returns the new view.
import { invoke } from '@tauri-apps/api/core';

export type Protocol = 'anthropic' | 'openai';
export type AuthStyle = 'x-api-key' | 'bearer';

export type Server =
  | { state: 'running'; address: string }
  | { state: 'failed'; port: number; error: string }
  | { state: 'starting'; port: number };

export interface UpstreamView {
  id: string;
  name: string;
  baseUrl: string;
  keyHint: string;
  auth: AuthStyle;
  enabled: boolean;
  systemProxy: boolean;
}

export interface TokenView {
  id: string;
  name: string;
  hint: string;
  enabled: boolean;
  created: number;
  use: { requests: number; lastUsed: number };
}

export interface RouteView {
  id: string;
  name: string;
  protocol: Protocol;
  upstreams: UpstreamView[];
  tokens: TokenView[];
}

export interface Entry {
  at: number;
  route: string;
  token: string;
  upstream: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  note: string;
}

export interface View {
  port: number;
  server: Server;
  routes: RouteView[];
  recent: Entry[];
  configError: string | null;
}

/** An upstream as sent to be added or changed; `key` left out keeps the saved one. */
export interface UpstreamInput {
  name: string;
  baseUrl: string;
  key?: string;
  auth: AuthStyle;
  enabled: boolean;
  systemProxy: boolean;
}

export const api = {
  state: () => invoke<View>('state'),
  addRoute: (name: string, protocol: Protocol) => invoke<View>('add_route', { name, protocol }),
  renameRoute: (id: string, name: string) => invoke<View>('rename_route', { id, name }),
  deleteRoute: (id: string) => invoke<View>('delete_route', { id }),
  addUpstream: (route: string, upstream: UpstreamInput) => invoke<View>('add_upstream', { route, upstream }),
  updateUpstream: (route: string, id: string, upstream: UpstreamInput) => invoke<View>('update_upstream', { route, id, upstream }),
  moveUpstream: (route: string, id: string, by: number) => invoke<View>('move_upstream', { route, id, by }),
  deleteUpstream: (route: string, id: string) => invoke<View>('delete_upstream', { route, id }),
  addToken: (route: string, name: string) => invoke<{ view: View; token: string }>('add_token', { route, name }),
  setTokenEnabled: (route: string, id: string, enabled: boolean) => invoke<View>('set_token_enabled', { route, id, enabled }),
  deleteToken: (route: string, id: string) => invoke<View>('delete_token', { route, id }),
  setPort: (port: number) => invoke<View>('set_port', { port }),
};

/** The default way an upstream of this protocol takes its key. */
export const defaultAuth = (p: Protocol): AuthStyle => (p === 'anthropic' ? 'x-api-key' : 'bearer');
