// Grafana 监控: the dashboards that watch 6.3.
import { arc, circle, fillCircle, fillRect, line, path, polar, rect } from '../draw.mjs';

const [needleX, needleY] = polar(12, 15, 6, -55);

export const app = {
  id: 'grafana',
  name: 'Grafana 监控',
  accent: '#ffad55',
  glyphs: [
    {
      name: '折线',
      note: '一条起伏的指标曲线',
      draw: () => [
        path('M3 4v16h18', 'soft'),
        path('M6.5 15.5 10 11l3 3 5.5-7'),
        fillCircle(18.5, 7, 1.6),
      ],
    },
    {
      name: '仪表盘',
      note: '一个指针表',
      draw: () => [
        path(arc(12, 15, 9, 180, 360)),
        path(arc(12, 15, 9, 300, 360), 'hi'),
        line(12, 15, needleX, needleY),
        fillCircle(12, 15, 1.6, 'main'),
        line(5, 19.5, 19, 19.5, 'soft'),
      ],
    },
    {
      name: '面板',
      note: '看板上的几块图',
      draw: () => [
        rect(3, 3, 18, 7, 2.5),
        rect(3, 14, 7, 7, 2.5),
        rect(14, 14, 7, 7, 2.5),
        path('M6 7.6 9 5.5 12 6.8 15 5 18 6.2', 'hi'),
        fillRect(5.2, 17.3, 1.5, 2, 0.4, 'soft'),
        fillRect(7.4, 16, 1.5, 3.3, 0.4, 'soft'),
        circle(17.5, 17.5, 1.6, 'soft'),
      ],
    },
  ],
};
