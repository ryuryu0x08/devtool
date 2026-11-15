// CI/CD 状态: the NAS pipeline's status page.
import { arrowHead, circle, fillCircle, line, path } from '../draw.mjs';

export const app = {
  id: 'cicd',
  name: 'CI/CD 状态',
  accent: '#4cd07d',
  glyphs: [
    {
      name: '流水线',
      note: '三个阶段连成一条线，最后一个通过',
      draw: () => [
        line(7, 12, 9.5, 12, 'soft'),
        line(14.5, 12, 17, 12, 'soft'),
        circle(4.5, 12, 2.5),
        circle(12, 12, 2.5),
        fillCircle(19.5, 12, 3),
      ],
    },
    {
      name: '无限循环',
      note: 'CI 与 CD 首尾相接的 ∞',
      draw: () => [
        path('M12 12c-1.8-2.4-3.4-4-5.5-4a4 4 0 0 0 0 8c2.1 0 3.7-1.6 5.5-4Z'),
        path('M12 12c1.8 2.4 3.4 4 5.5 4a4 4 0 0 0 0-8c-2.1 0-3.7 1.6-5.5 4Z', 'hi'),
      ],
    },
    {
      name: '发布箭头',
      note: '一个对号走到底，往上发出',
      draw: () => [
        path('M4 13.5 8.5 18 20 6.5', 'hi'),
        path(arrowHead(20, 6.5, -45, 5.5), 'hi'),
        line(4, 5, 10, 5, 'soft'),
        line(4, 8.5, 7.5, 8.5, 'soft'),
      ],
    },
  ],
};
