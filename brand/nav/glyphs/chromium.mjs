// 远程浏览器: a Chromium running on the NAS, used from the phone.
import { circle, fillCircle, fillPath, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'chromium',
  name: '远程浏览器',
  accent: '#5cb0ff',
  glyphs: [
    {
      name: '浏览器窗口',
      note: '一个浏览器窗口和远处传来的信号',
      draw: () => [
        rect(2.5, 4, 19, 16, 3),
        line(2.5, 8.5, 21.5, 8.5),
        fillCircle(5.5, 6.25, 0.9, 'soft'),
        fillCircle(8.2, 6.25, 0.9, 'soft'),
        path('M8.5 16a5 5 0 0 1 7 0', 'hi'),
        path('M10.5 18.2a2.2 2.2 0 0 1 3 0', 'hi'),
      ],
    },
    {
      name: '地球与光标',
      note: '一个地球，外面有一只鼠标指针',
      draw: () => [
        circle(10.5, 10.5, 7.5),
        path('M3 10.5h15', 'soft'),
        path('M10.5 3c-2.4 2.2-2.4 12.8 0 15M10.5 3c2.4 2.2 2.4 12.8 0 15', 'soft'),
        fillPath('M15 14.2 21.2 16.8 18.4 17.9 17.3 20.7Z'),
      ],
    },
    {
      name: '远程窗口',
      note: '窗口里一个指向远处的箭头',
      draw: () => [
        path('M12 3.5H6A2.5 2.5 0 0 0 3.5 6v12A2.5 2.5 0 0 0 6 20.5h12a2.5 2.5 0 0 0 2.5-2.5v-6'),
        line(10.5, 13.5, 20.5, 3.5, 'hi'),
        path('M14.5 3.5h6v6', 'hi'),
      ],
    },
  ],
};
