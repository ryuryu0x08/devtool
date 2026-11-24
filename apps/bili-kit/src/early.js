// Runs at document_start in the page (world MAIN), before the page loads Mermaid: catches
// `globalThis.mermaid = ...` (the last line of the page's Mermaid bundle) and gates it (defer.js),
// so a diagram is rendered only when it is near the screen.
(function () {
  if (window.__biliKitEarly) return;
  window.__biliKitEarly = true;
  const { gateMermaid } = window.__biliKitDefer;

  // Within a screen above or below what is shown. scrollMargin widens the document's scroll
  // container too (the editor scrolls inside one), which rootMargin alone does not.
  const MARGIN = '100% 0px';
  const waiting = new Map();
  let sight = null;
  function observer() {
    if (sight) return sight;
    sight = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          sight.unobserve(entry.target);
          for (const resolve of waiting.get(entry.target) || []) resolve();
          waiting.delete(entry.target);
        }
      },
      { rootMargin: MARGIN, scrollMargin: MARGIN },
    );
    return sight;
  }

  function whenNear(text) {
    const viewers = [...document.querySelectorAll('mermaid-viewer')].filter((v) => v.code === text);
    if (!viewers.length) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        resolve();
      };
      for (const v of viewers) {
        const list = waiting.get(v);
        if (list) list.push(once);
        else {
          waiting.set(v, [once]);
          observer().observe(v);
        }
      }
    });
  }

  // One frame for scrolling, input and paint before the next render.
  const breather = () => new Promise((resolve) => setTimeout(resolve, 16));
  const env = { whenNear, breather };

  let current = window.mermaid;
  if (current) {
    gateMermaid(current, env);
    return;
  }
  Object.defineProperty(window, 'mermaid', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set(value) {
      current = gateMermaid(value, env);
    },
  });
})();
