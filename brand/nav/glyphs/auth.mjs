// 鉴权后台: the shared login's admin page (sessions, revoking, access log).
import { circle, fillCircle, fillRect, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'auth',
  name: '鉴权后台',
  accent: '#a684ff',
  glyphs: [
    {
      name: '盾牌',
      note: '一面盾牌上一个对号',
      draw: () => [
        path('M12 2.8 19.5 5.6v5.8c0 4.7-3.1 8.4-7.5 9.9-4.4-1.5-7.5-5.2-7.5-9.9V5.6Z'),
        path('M8.5 12 11 14.5l4.5-4.5', 'hi'),
      ],
    },
    {
      name: '钥匙',
      note: '一把钥匙',
      draw: () => [
        circle(7.5, 15.5, 4),
        path('M10.4 12.6 20 3'),
        path('M16.5 6.5l2.5 2.5M14 9l2 2', 'hi'),
        fillCircle(7.5, 15.5, 1.2, 'soft'),
      ],
    },
    {
      name: '锁',
      note: '一把挂锁，锁孔点亮',
      draw: () => [
        path('M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3'),
        rect(4.5, 10.5, 15, 11, 2.5),
        fillCircle(12, 15, 1.6),
        fillRect(11.2, 15.5, 1.6, 3, 0.6),
        line(4.5, 10.5, 19.5, 10.5, 'soft'),
      ],
    },
  ],
};
