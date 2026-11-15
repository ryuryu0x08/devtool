// The navigation page's links, in the order of /share/Container/homelab-nav/config/nav.toml on 6.2,
// each with the text tile it showed before (its icon text and colour, given or defaulted by the page)
// and the candidate chosen for it (null where none was).
import { app as auth } from './glyphs/auth.mjs';
import { app as chromium } from './glyphs/chromium.mjs';
import { app as cicd } from './glyphs/cicd.mjs';
import { app as devtool } from './glyphs/devtool.mjs';
import { app as gitea } from './glyphs/gitea.mjs';
import { app as grafana } from './glyphs/grafana.mjs';
import { app as longstitch } from './glyphs/longstitch.mjs';
import { app as paseo } from './glyphs/paseo.mjs';
import { app as picokvm } from './glyphs/picokvm.mjs';
import { app as pluck } from './glyphs/pluck.mjs';
import { app as resumeStudio } from './glyphs/resume-studio.mjs';
import { app as s3Manager } from './glyphs/s3-manager.mjs';
import { app as subtitles } from './glyphs/subtitles.mjs';
import { app as video2gif } from './glyphs/video2gif.mjs';

const withCurrent = (app, icon, color, chosen) => ({ ...app, current: { icon, color }, chosen });

export const APPS = [
  withCurrent(resumeStudio, 'Fo', '#2F5BD3', 'A'),
  withCurrent(pluck, '拾', '#0F7B6C', 'B'),
  withCurrent(longstitch, '长', '#C2571A', 'C'),
  withCurrent(video2gif, '视', '#1F6F9E', 'B'),
  withCurrent(devtool, '工', '#1F6F9E', 'A'),
  withCurrent(s3Manager, 'S', '#0F7B6C', 'A'),
  withCurrent(grafana, 'Gr', '#1F6F9E', 'B'),
  withCurrent(gitea, 'Gi', '#C2571A', 'A'),
  withCurrent(cicd, 'CI', '#7A4CC2', 'C'),
  withCurrent(subtitles, '字', '#C2571A', 'B'),
  withCurrent(chromium, '远', '#1F6F9E', 'A'),
  withCurrent(picokvm, 'Pi', '#B4235A', 'C'),
  withCurrent(paseo, 'Pa', '#3D4350', 'C'),
  withCurrent(auth, '钥', '#7C3AED', 'A'),
];

const GLYPH_LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** A candidate's code: its glyph's letter, as "B". */
export const candidateCode = (glyphIndex) => GLYPH_LETTERS[glyphIndex];

/** The index of the app's chosen glyph, or -1 when none was chosen. */
export const chosenIndex = (app) => (app.chosen ? GLYPH_LETTERS.indexOf(app.chosen) : -1);
