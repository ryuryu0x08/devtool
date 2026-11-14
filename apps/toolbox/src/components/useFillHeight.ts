import { useLayoutEffect, useState, type RefObject } from 'react';
import { useZoom } from './Zoom';

/**
 * The height (CSS px of the tool area) that makes `ref` reach from its top down to the window's
 * bottom margin, at least `min`; 0 until measured. Followed as the window or the content above
 * it changes size.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, min = 360): number {
  const z = useZoom()[0] / 100;
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current, area = el?.closest<HTMLElement>('.content');
    if (!el) return;
    const measure = () => {
      const pad = area ? parseFloat(getComputedStyle(area).paddingBottom) || 0 : 0;
      const h = Math.floor(Math.max(min, (innerHeight - (el.getBoundingClientRect().top + scrollY)) / z - pad));
      setHeight((o) => (Math.abs(o - h) < 2 ? o : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area ?? el);
    addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, [ref, z, min]);
  return height;
}
