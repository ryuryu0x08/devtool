// 视频字幕: bilingual subtitles for an uploaded video.
import { fillPath, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'subtitles',
  name: '视频字幕',
  accent: '#ff6fa3',
  glyphs: [
    {
      name: 'CC 字幕',
      note: '屏幕下方两行字幕',
      draw: () => [
        rect(2.5, 4.5, 19, 15, 3),
        line(6, 13, 14, 13, 'hi'),
        line(16.5, 13, 18, 13, 'hi'),
        line(6, 16.2, 9, 16.2, 'soft'),
        line(11.5, 16.2, 18, 16.2, 'soft'),
      ],
    },
    {
      name: '双语',
      note: '画面里一行中文、一行英文',
      draw: () => [
        rect(2.5, 4.5, 19, 15, 3),
        fillPath('M10.5 7.5v4.4l3.6-2.2Z', 'soft'),
        line(6, 14.5, 18, 14.5, 'hi'),
        line(8, 17, 16, 17, 'soft'),
      ],
    },
    {
      name: '对白气泡',
      note: '一个说话气泡，里面是字幕行',
      draw: () => [
        path('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5Z'),
        line(8, 9, 16, 9, 'hi'),
        line(8, 12.5, 13, 12.5, 'soft'),
      ],
    },
  ],
};
