import { describe, expect, it } from 'vitest';
import { done, runSteps, skipped, warned, type Run, type Step } from './steps';

/** A clock that moves 10 ms each time it is read. */
const clock = () => { let t = 0; return () => (t += 10); };

describe('runSteps', () => {
  it('runs the steps in order: each shows running, then what it did or why it was skipped', async () => {
    const seen: Run[] = [];
    const order: string[] = [];
    const steps: Step[] = [
      { title: 'a', run: async () => { order.push('a'); return done('did a'); } },
      { title: 'b', run: async () => { order.push('b'); return skipped('b already so'); } },
      { title: 'c', run: async () => { order.push('c'); return warned('c, with a caveat'); } },
    ];
    const r = await runSteps(steps, (x) => seen.push(x), { now: clock() });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(r.steps.map((s) => [s.title, s.state, s.detail])).toEqual([
      ['a', 'done', 'did a'], ['b', 'skipped', 'b already so'], ['c', 'warn', 'c, with a caveat'],
    ]);
    expect(r.steps.every((s) => s.ms === 10)).toBe(true);
    expect(r.summary).toEqual({ done: 1, skipped: 1, warned: 1, failed: 0, notRun: 0, ms: 70, ok: true });
    // Before anything ran, all were pending; then one at a time was running.
    expect(seen[0].steps.map((s) => s.state)).toEqual(['pending', 'pending', 'pending']);
    expect(seen[1].steps.map((s) => s.state)).toEqual(['running', 'pending', 'pending']);
    expect(seen.at(-1)).toEqual(r);
    // Each update is its own copy: an earlier one is not changed by later steps.
    expect(seen[1].steps[0].state).toBe('running');
  });

  it('stops at the first failure: its reason is shown, the steps after it are not run', async () => {
    const ran: string[] = [];
    const r = await runSteps([
      { title: 'a', run: async () => { ran.push('a'); return done(); } },
      { title: 'b', run: async () => { throw new Error('port 8888 is taken'); } },
      { title: 'c', run: async () => { ran.push('c'); return done(); } },
    ], () => {}, { now: clock(), describe: (e) => 'said: ' + (e as Error).message });
    expect(ran).toEqual(['a']);
    expect(r.steps.map((s) => [s.state, s.detail])).toEqual([['done', ''], ['failed', 'said: port 8888 is taken'], ['pending', '']]);
    expect(r.steps[2].ms).toBeNull();
    expect(r.summary).toMatchObject({ done: 1, failed: 1, notRun: 1, ok: false });
  });

  it('a second run over a world already set up skips every step, and says why', async () => {
    // Each step looks at the world first, as a script's steps do.
    const world = { started: false, trusted: false };
    const steps: Step[] = [
      { title: 'start', run: async () => (world.started ? skipped('running') : ((world.started = true), done('started'))) },
      { title: 'trust', run: async () => (world.trusted ? skipped('trusted') : ((world.trusted = true), done('trusted now'))) },
    ];
    const first = await runSteps(steps, () => {});
    expect(first.summary).toMatchObject({ done: 2, skipped: 0, ok: true });
    const second = await runSteps(steps, () => {});
    expect(second.steps.map((s) => [s.state, s.detail])).toEqual([['skipped', 'running'], ['skipped', 'trusted']]);
    expect(second.summary).toMatchObject({ done: 0, skipped: 2, failed: 0, ok: true });
  });

  it('without a describe, a thrown value is shown by its message', async () => {
    const r = await runSteps([{ title: 'x', run: async () => { throw 'plain'; } }], () => {});
    expect(r.steps[0].detail).toBe('plain');
  });
});
