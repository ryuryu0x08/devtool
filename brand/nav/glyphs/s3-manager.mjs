// S3 管理器: a page for browsing and managing the S3 buckets.
import { fillCircle, line, path, rect } from '../draw.mjs';

export const app = {
  id: 's3-manager',
  name: 'S3 管理器',
  accent: '#ff7a82',
  glyphs: [
    {
      name: '桶',
      note: '对象存储的「桶」',
      draw: () => [
        path('M4 6.5 5.8 19a2.5 2.5 0 0 0 2.5 2.1h7.4a2.5 2.5 0 0 0 2.5-2.1L20 6.5'),
        path('M3.5 6.5c0-1.7 3.8-3 8.5-3s8.5 1.3 8.5 3-3.8 3-8.5 3-8.5-1.3-8.5-3Z'),
        path('M5 12.5c2 1 4.5 1.5 7 1.5s5-.5 7-1.5', 'hi'),
      ],
    },
    {
      name: '存储柜',
      note: '三层存储，每层一盏灯',
      draw: () => [
        rect(3, 3, 18, 18, 3),
        line(3, 9, 21, 9),
        line(3, 15, 21, 15),
        fillCircle(7, 6, 1.1, 'hi'),
        fillCircle(7, 12, 1.1, 'soft'),
        fillCircle(7, 18, 1.1, 'soft'),
        line(11, 6, 17, 6, 'soft'),
        line(11, 12, 17, 12, 'soft'),
        line(11, 18, 17, 18, 'soft'),
      ],
    },
    {
      name: '文件夹与云',
      note: '一个文件夹里装着一朵云',
      draw: () => [
        path('M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'),
        path('M9 17.5h6.5a2.2 2.2 0 0 0 .2-4.4 3 3 0 0 0-5.8-.6A2.5 2.5 0 0 0 9 17.5Z', 'hi'),
      ],
    },
  ],
};
