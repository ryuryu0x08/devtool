// A run of steps, done the way a careful script does them: each step first looks at whether its
// goal is already reached (then it is skipped and says why), otherwise does the work and checks it.
// The first failure stops the run; the steps after it stay as they were (not run). Every change
// is reported as a fresh copy, for the page to draw.

export type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'warn' | 'failed';

/** What a step reports. A failure is thrown instead: its message (or `describe`) is the reason. */
export interface Outcome { state: 'done' | 'skipped' | 'warn'; detail: string }

export interface Step { title: string; run: () => Promise<Outcome> }

export interface StepView { title: string; state: StepState; detail: string; ms: number | null }

export interface Summary { done: number; skipped: number; warned: number; failed: number; notRun: number; ms: number; ok: boolean }

export interface Run { steps: StepView[]; summary: Summary | null }

/** Did the work (with what it did). */
export const done = (detail = ''): Outcome => ({ state: 'done', detail });
/** Already so: nothing to do (with why). */
export const skipped = (detail: string): Outcome => ({ state: 'skipped', detail });
/** Did the work, with something the user should know. */
export const warned = (detail: string): Outcome => ({ state: 'warn', detail });

interface Options { describe?: (e: unknown) => string; now?: () => number }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runSteps(steps: Step[], onChange: (r: Run) => void, o: Options = {}): Promise<Run> {
  const now = o.now ?? (() => performance.now());
  const describe = o.describe ?? message;
  const views: StepView[] = steps.map((s) => ({ title: s.title, state: 'pending', detail: '', ms: null }));
  const snapshot = (summary: Summary | null): Run => ({ steps: views.map((v) => ({ ...v })), summary });
  const t0 = now();
  onChange(snapshot(null));
  let failed = false;
  for (const [i, step] of steps.entries()) {
    views[i].state = 'running';
    onChange(snapshot(null));
    const t = now();
    try {
      const r = await step.run();
      views[i] = { ...views[i], state: r.state, detail: r.detail };
    } catch (e) {
      views[i] = { ...views[i], state: 'failed', detail: describe(e) };
      failed = true;
    }
    views[i].ms = now() - t;
    if (failed) break;
  }
  const count = (s: StepState) => views.filter((v) => v.state === s).length;
  const summary: Summary = {
    done: count('done'), skipped: count('skipped'), warned: count('warn'), failed: count('failed'), notRun: count('pending'),
    ms: now() - t0, ok: !failed,
  };
  const r = snapshot(summary);
  onChange(r);
  return r;
}
