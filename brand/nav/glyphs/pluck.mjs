// 拾取 Pluck: downloads media from a link.
import { arrowHead, line, path, rect, scaled } from '../draw.mjs';

const LINK_SCALE = 0.66; // the link drawn on the 24 grid, shrunk into the upper left

export const app = {
  id: 'pluck',
  name: '拾取 Pluck',
  accent: '#3ed3b8',
  glyphs: [
    {
      name: '下载到托盘',
      note: '箭头落进托盘',
      draw: () => [
        line(12, 3.5, 12, 14.5),
        path(arrowHead(12, 14.5, 90, 5.2)),
        path('M3.5 15.5v2.5a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-2.5', 'hi'),
      ],
    },
    {
      name: '链接取回',
      note: '一个链接，旁边一个落下的箭头',
      draw: () => [
        scaled(`translate(1.5 1.5) scale(${LINK_SCALE})`, 2 / LINK_SCALE, [
          path('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7'),
          path('M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'),
        ]),
        line(18.5, 12, 18.5, 20.5, 'hi'),
        path(arrowHead(18.5, 20.5, 90, 3.6), 'hi'),
      ],
    },
    {
      name: '片子',
      note: '一段胶片和一个下载箭头',
      draw: () => [
        rect(3, 4.5, 18, 15, 2.5),
        line(7, 4.5, 7, 19.5, 'soft'),
        line(17, 4.5, 17, 19.5, 'soft'),
        line(12, 8.5, 12, 15.5, 'hi'),
        path(arrowHead(12, 15.5, 90, 3.6), 'hi'),
      ],
    },
  ],
};
