// The tools in the sidebar, palette and phone bar: the built-in ones, then the local plugins
// (each a tool of its own), then "add a plugin".
import { useEffect, useReducer } from 'react';
import { TOOLS, type Tool, type ToolId } from '../i18n';
import { PLUGIN_PREFIX, iconOf, nameOf, plugins, subscribe } from '../lib/plugins';

export type ToolEntry = Omit<Tool, 'id'> & { id: ToolId };

export function allTools(): ToolEntry[] {
  const own: ToolEntry[] = plugins().map((p) => {
    const name = nameOf(p.html);
    return { id: `${PLUGIN_PREFIX}${p.id}` as ToolId, cat: 'local', icon: iconOf(p.html), zh: [name, name, '本地插件'], en: [name, name, 'Local plugin'], kw: name + ' plugin 插件' };
  });
  return [...TOOLS.filter((t) => t.id !== 'local'), ...own, ...TOOLS.filter((t) => t.id === 'local')];
}

/** allTools(), kept current as plugins are added, renamed or removed. */
export function useTools(): ToolEntry[] {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(bump), []);
  return allTools();
}
