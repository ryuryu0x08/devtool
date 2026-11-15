// Folio 简历编辑器: a résumé editor that exports PDF.
import { circle, fillRect, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'resume-studio',
  name: 'Folio 简历编辑器',
  accent: '#6f9bff',
  glyphs: [
    {
      name: '简历',
      note: '一页简历：头像、姓名和几行经历',
      draw: () => [
        rect(4.5, 2.5, 15, 19, 2.5),
        circle(9, 8, 2),
        line(12.5, 7, 16, 7),
        line(12.5, 9.5, 15, 9.5, 'soft'),
        line(8, 13.5, 16, 13.5),
        line(8, 17, 14, 17, 'soft'),
        fillRect(14.5, 16, 2, 2, 0.5),
      ],
    },
    {
      name: '对开页',
      note: 'Folio 的本义：摊开的两页',
      draw: () => [
        path('M12 6.5C9.5 4.8 6 4.5 3 5.2V19c3-.7 6.5-.4 9 1.3 2.5-1.7 6-2 9-1.3V5.2c-3-.7-6.5-.4-9 1.3Z'),
        line(12, 6.5, 12, 20.3),
        line(5.5, 9, 9.5, 9.5, 'soft'),
        line(5.5, 12.5, 9.5, 13, 'soft'),
        line(14.5, 9.5, 18.5, 9, 'hi'),
        line(14.5, 13, 18.5, 12.5, 'soft'),
      ],
    },
    {
      name: '钢笔',
      note: '一页纸和一支在写的笔',
      draw: () => [
        path('M13 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12'),
        line(8, 9, 11.5, 9, 'soft'),
        line(8, 13, 13, 13, 'soft'),
        line(8, 17, 11, 17, 'soft'),
        path('M18.2 2.8a1.9 1.9 0 0 1 2.7 2.7l-6.6 6.6-3.6.9.9-3.6Z', 'hi'),
      ],
    },
  ],
};
