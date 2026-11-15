// PicoKVM: keyboard, screen and mouse of the Windows machine, over the network.
import { fillRect, line, path, rect } from '../draw.mjs';

export const app = {
  id: 'picokvm',
  name: 'PicoKVM',
  accent: '#4fd0de',
  glyphs: [
    {
      name: '显示器与键盘',
      note: '一台显示器和一排按键',
      draw: () => [
        rect(3, 3, 18, 12, 2.5),
        line(9, 18.5, 15, 18.5),
        line(12, 15, 12, 18.5),
        path('M8.5 9.5 10.5 7.5M8.5 12 13.5 7', 'hi'),
      ],
    },
    {
      name: 'KVM 盒子',
      note: '一个小盒子，指示灯亮着，连着网线',
      draw: () => [
        rect(3, 8, 18, 10, 2.5),
        fillRect(6, 12, 2.2, 2.2, 0.5),
        fillRect(9.5, 12, 2.2, 2.2, 0.5, 'soft'),
        line(14, 13.1, 18, 13.1, 'soft'),
        path('M8 8V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V8', 'soft'),
        line(12, 18, 12, 21, 'soft'),
      ],
    },
    {
      name: '远程桌面',
      note: '屏幕里一个 Windows 的四格窗',
      draw: () => [
        rect(2.5, 3.5, 19, 13, 2.5),
        line(8, 20.5, 16, 20.5),
        fillRect(8.5, 6.5, 3, 3, 0.4),
        fillRect(12.5, 6.5, 3, 3, 0.4),
        fillRect(8.5, 10.5, 3, 3, 0.4),
        fillRect(12.5, 10.5, 3, 3, 0.4),
      ],
    },
  ],
};
