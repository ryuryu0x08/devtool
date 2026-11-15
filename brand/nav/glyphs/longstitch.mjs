// 长图拼接: stitches screenshots into one long image.
import { fillRect, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'longstitch',
  name: '长图拼接',
  accent: '#b48cff',
  glyphs: [
    {
      name: '叠成长条',
      note: '三张图上下接成一张',
      draw: () => [
        rect(6.5, 2.5, 11, 19, 2.5),
        line(6.5, 8.8, 17.5, 8.8, 'hi'),
        line(6.5, 15.2, 17.5, 15.2, 'hi'),
        path('M9 6.5 11 4.8 13 6 15 4.5', 'soft'),
        line(9.5, 12, 14.5, 12, 'soft'),
        path('M9 19 11.5 17.2 15 18.5', 'soft'),
      ],
    },
    {
      name: '缝线',
      note: '两张图之间一道虚线缝合',
      draw: () => [
        path('M6.5 10.5V5a2.5 2.5 0 0 1 2.5-2.5h6A2.5 2.5 0 0 1 17.5 5v5.5'),
        path('M6.5 13.5V19A2.5 2.5 0 0 0 9 21.5h6a2.5 2.5 0 0 0 2.5-2.5v-5.5'),
        line(4, 12, 5.5, 12, 'hi'),
        line(8.5, 12, 10.5, 12, 'hi'),
        line(13.5, 12, 15.5, 12, 'hi'),
        line(18.5, 12, 20, 12, 'hi'),
      ],
    },
    {
      name: '长截图',
      note: '一张手机截图向下延长',
      draw: () => [
        path('M17.5 9V5A2.5 2.5 0 0 0 15 2.5H9A2.5 2.5 0 0 0 6.5 5v14A2.5 2.5 0 0 0 9 21.5h6a2.5 2.5 0 0 0 2.5-2.5v-3'),
        line(10.5, 5.2, 13.5, 5.2, 'soft'),
        line(20.5, 8, 20.5, 16, 'hi'),
        path('M18.7 14.2 20.5 16l1.8-1.8', 'hi'),
        fillRect(9.5, 9, 5, 3.5, 1, 'soft'),
        line(9.5, 15.5, 14.5, 15.5, 'soft'),
      ],
    },
  ],
};
