import { describe, expect, it } from 'vitest';
import { findAll, findInPieces } from './find';

describe('find', () => {
  it('finds every match, ignoring case unless asked', () => {
    expect(findAll('Name name NAME', 'name')).toEqual([0, 5, 10]);
    expect(findAll('Name name NAME', 'name', true)).toEqual([5]);
    expect(findAll('aaaa', 'aa')).toEqual([0, 2]);
    expect(findAll('abc', '')).toEqual([]);
    expect(findAll('x'.repeat(50), 'x', false, 3)).toEqual([0, 1, 2]);
    // A lower case of another length: offsets stay right (matched as typed).
    expect(findAll('İa İb', 'İb')).toEqual([3]);
  });

  it('maps matches across pieces to where they start and end', () => {
    // {"name": 1} highlighted as: `{`, `"name"`, `: `, `1`, `}`
    const pieces = ['{', '"name"', ': ', '1', '}'];
    expect(findInPieces(pieces, 'name": 1')).toEqual([{ start: { piece: 1, offset: 1 }, end: { piece: 3, offset: 1 } }]);
    // A match ending at a piece's end ends in that piece, not at the start of the next.
    expect(findInPieces(pieces, '"name"')).toEqual([{ start: { piece: 1, offset: 0 }, end: { piece: 1, offset: 6 } }]);
    // Empty pieces are passed over.
    expect(findInPieces(['ab', '', 'cd'], 'bc')).toEqual([{ start: { piece: 0, offset: 1 }, end: { piece: 2, offset: 1 } }]);
    expect(findInPieces(['ab', '', 'cd'], 'cd')).toEqual([{ start: { piece: 2, offset: 0 }, end: { piece: 2, offset: 2 } }]);
  });
});
