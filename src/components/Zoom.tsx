// Text size of the tool area (not the sidebar): everything in it scales together, so proportions
// stay as designed. Stored with the preferences.
import { useApp } from '../store';
import { useOpt } from './Panes';

export const ZOOMS = [80, 90, 100, 110, 125, 140, 160];

export function useZoom(): [number, (z: number) => void] {
  return useOpt('ui.zoom', 100, ZOOMS);
}

/** A− 100% A+ ; a click on the percentage goes back to 100%. */
export function ZoomControl({ vertical }: { vertical?: boolean }) {
  const { T } = useApp();
  const [z, setZ] = useZoom();
  const i = ZOOMS.indexOf(z);
  return (
    <div className={'zoom-ctl' + (vertical ? ' vertical' : '')} role="group" aria-label={T.ui.zoom}>
      <button className="zoom-btn" onClick={() => setZ(ZOOMS[i - 1])} disabled={i <= 0} aria-label={T.ui.zoomOut} title={T.ui.zoomOut}>A−</button>
      <button className="zoom-btn pct" onClick={() => setZ(100)} title={T.ui.zoomReset} aria-label={T.ui.zoom + ' ' + z + '%'}>{z}%</button>
      <button className="zoom-btn" onClick={() => setZ(ZOOMS[i + 1])} disabled={i >= ZOOMS.length - 1} aria-label={T.ui.zoomIn} title={T.ui.zoomIn}>A+</button>
    </div>
  );
}
