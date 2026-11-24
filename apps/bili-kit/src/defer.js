// Gates the page's Mermaid: a call to `parse` or `render` waits until its diagram is near the
// screen, then calls run one at a time, with the main thread given back before each.
//
// The page renders every diagram of a document as soon as it opens; each render is one block of
// main-thread work (45-400 ms here, Mermaid measures text in the DOM so it cannot run in a
// worker), and 38 of them in a row froze this document for 4.5 s. Gated, only the diagrams near
// the screen are rendered, and scrolling and clicks get the main thread between them. While a call
// waits, the page shows its own "rendering" spinner for that diagram.
//
// `env.whenNear(text)` resolves when a diagram with that Mermaid text is near the screen (or at
// once when no diagram has it, such as an editing preview); `env.breather()` gives the main thread
// back. No DOM here.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__biliKitDefer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GATED = Symbol.for('bili-kit.gated');

  function gateMermaid(mermaid, env) {
    if (!mermaid || mermaid[GATED]) return mermaid;
    let queue = Promise.resolve();

    function gate(name) {
      const original = mermaid[name];
      if (typeof original !== 'function') return;
      mermaid[name] = function (...args) {
        const text = name === 'render' ? args[1] : args[0];
        const turn = () => env.breather().then(() => original.apply(mermaid, args));
        return Promise.resolve(env.whenNear(text)).then(() => {
          const run = queue.then(turn, turn);
          queue = run.catch(() => {});
          return run;
        });
      };
    }

    gate('parse');
    gate('render');
    mermaid[GATED] = true;
    return mermaid;
  }

  return { gateMermaid };
});
