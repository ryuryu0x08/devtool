// 工具箱: this repository's toolbox. The first glyph is its own mark, "Dev" and a cursor
// (brand/toolbox/mark.mjs), laid over the tile as on the toolbox's icons; the others are alternatives.
import { MARK } from '../../toolbox/mark.mjs';
import { fillRect, line, path, rect, scaled, wholeTile } from '../draw.mjs';

const MARK_TILE = 32; // the grid the mark is laid out on

function mark() {
  const { x, y, width, height, rx } = MARK.cursor;
  const letters = Object.values(MARK.letters).map((d) => path(d));
  return scaled(`${wholeTile(MARK_TILE)} ${MARK.transform}`, MARK.stroke, [...letters, fillRect(x, y, width, height, rx)]);
}

export const app = {
  id: 'devtool',
  name: '工具箱',
  accent: '#5a86ff',
  glyphs: [
    {
      name: 'Dev 光标',
      note: '工具箱自己的图标：Dev 和一个终端光标',
      draw: () => [mark()],
    },
    {
      name: '提示符',
      note: '命令行的 > 和一个下划线光标',
      draw: () => [
        path('M5 7.5 10 12l-5 4.5'),
        line(12.5, 17, 19, 17, 'hi'),
      ],
    },
    {
      name: '工具箱',
      note: '原来的工具箱图标：提手、箱身和蓝色搭扣',
      draw: () => [
        path('M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5'),
        rect(3.5, 7.5, 17, 12, 2.5),
        line(3.5, 12.8, 20.5, 12.8),
        fillRect(10.5, 11, 3, 3.5, 0.8),
      ],
    },
  ],
};
