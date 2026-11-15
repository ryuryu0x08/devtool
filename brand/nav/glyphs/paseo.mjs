// Paseo: the coding-agent web UI on 6.3 (paseo is Spanish for a stroll).
import { circle, fillCircle, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'paseo',
  name: 'Paseo',
  accent: '#9d8cff',
  glyphs: [
    {
      name: '小径',
      note: '一条弯曲的小路，走向一个终点',
      draw: () => [
        path('M4 20c4-1 4-6 8-7s4-6 8-7', 'soft'),
        fillCircle(4, 20, 1.8, 'main'),
        fillCircle(12, 13, 1.4, 'soft'),
        circle(20, 6, 2.5, 'hi'),
      ],
    },
    {
      name: '对话里的代码',
      note: '一个对话气泡，里面是 </>',
      draw: () => [
        path('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5Z'),
        path('M9.5 8 7.5 10.5 9.5 13', 'hi'),
        path('M14.5 8 16.5 10.5 14.5 13', 'hi'),
        line(12.8, 8, 11.2, 13, 'soft'),
      ],
    },
    {
      name: '终端与星光',
      note: '终端窗口里一个 > 和一颗代表 AI 的星',
      draw: () => [
        rect(2.5, 4.5, 19, 15, 3),
        path('M6.5 10 9 12.5l-2.5 2.5'),
        line(11, 15.5, 13.5, 15.5, 'soft'),
        path('M17 7.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z', 'hi'),
      ],
    },
  ],
};
