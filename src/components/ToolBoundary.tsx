// An unexpected error inside a tool shows a message in the tool's place instead of blanking the
// whole page. Changing the tool's inputs (clearing them, a paste, undo) tries again.
import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; reset: unknown[]; fallback: (err: Error, retry: () => void) => ReactNode }

export class ToolBoundary extends Component<Props, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: unknown) {
    return { err: err instanceof Error ? err : new Error(String(err)) };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.err && (prev.reset.length !== this.props.reset.length || prev.reset.some((v, i) => v !== this.props.reset[i]))) this.setState({ err: null });
  }

  render() {
    return this.state.err ? this.props.fallback(this.state.err, () => this.setState({ err: null })) : this.props.children;
  }
}
