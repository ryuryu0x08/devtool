// Gitea 代码托管: the Git server.
import { circle, line, path } from '../draw.mjs';

export const app = {
  id: 'gitea',
  name: 'Gitea 代码托管',
  accent: '#7fd36b',
  glyphs: [
    {
      name: '分支',
      note: '一条分支从主线分出又合回',
      draw: () => [
        circle(6, 5, 2),
        circle(6, 19, 2),
        circle(18, 8, 2, 'hi'),
        path('M6 7v10'),
        path('M18 10c0 4.5-3.5 5.5-9.2 7.6', 'hi'),
      ],
    },
    {
      name: '提交',
      note: '一串提交，最新的一个点亮',
      draw: () => [
        line(7, 5.5, 7, 18.5, 'soft'),
        circle(7, 5, 2),
        circle(7, 12, 2),
        circle(7, 19, 2.3, 'hi'),
        line(12, 5, 19, 5, 'soft'),
        line(12, 12, 17, 12, 'soft'),
        line(12, 19, 19, 19, 'hi'),
      ],
    },
    {
      name: '茶杯',
      note: 'Gitea 的名字来自「茶」：一杯冒着热气的茶',
      draw: () => [
        path('M4.5 10h12v4.5a5.5 5.5 0 0 1-5.5 5.5h-1a5.5 5.5 0 0 1-5.5-5.5Z'),
        path('M16.5 11.5h1.5a2.5 2.5 0 0 1 0 5h-1.8'),
        path('M8.5 3c-1 1.2 1 2.3 0 3.6M12.5 3c-1 1.2 1 2.3 0 3.6', 'hi'),
      ],
    },
  ],
};
