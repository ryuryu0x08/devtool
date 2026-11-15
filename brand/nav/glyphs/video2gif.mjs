// 视频转GIF: turns a video clip into a GIF.
import { fillPath, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'video2gif',
  name: '视频转GIF',
  accent: '#ff9a5c',
  glyphs: [
    {
      name: '播放变循环',
      note: '播放键绕着一圈循环箭头',
      draw: () => [
        path('M19.2 8.5A8 8 0 1 0 20 12'),
        path('M20.2 4.5v4.3h-4.3'),
        fillPath('M10 8.4v7.2l6-3.6Z'),
      ],
    },
    {
      name: '帧序列',
      note: '一段视频拆成三帧',
      draw: () => [
        rect(2.5, 6, 6, 12, 1.5, 'soft'),
        rect(9, 6, 6, 12, 1.5),
        rect(15.5, 6, 6, 12, 1.5, 'hi'),
        line(4.5, 3, 19.5, 3, 'soft'),
        line(4.5, 21, 19.5, 21, 'soft'),
      ],
    },
    {
      name: '视频 → GIF',
      note: '摄像机里一个循环箭头',
      draw: () => [
        rect(2.5, 6.5, 12, 11, 2.5),
        path('M14.5 10.5 19 8v8l-4.5-2.5'),
        path('M6.2 12a2.4 2.4 0 1 0 2.4-2.4', 'hi'),
        path('M8.6 7.9v1.7h1.7', 'hi'),
      ],
    },
  ],
};
