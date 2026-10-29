import { describe, expect, it } from 'vitest';
import { appendLiveDelta, type LiveTurn } from '../src/features/live/types';

describe('bounded live captions', () => {
  it('keeps the latest forty turns with stable increasing identities after eviction', () => {
    let turns: LiveTurn[] = [];
    for (let index = 0; index < 85; index++)
      turns = appendLiveDelta(turns, 'You', `Turn ${index}`, index * 3000, index * 3000 + 100);
    expect(turns).toHaveLength(40);
    expect(turns[0]).toMatchObject({ id: '46', text: 'Turn 45' });
    expect(turns.at(-1)).toMatchObject({ id: '85', text: 'Turn 84' });
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(40);
  });

  it('bounds a continuous turn without mutating previously rendered snapshots', () => {
    const previous = appendLiveDelta([], 'klnk', 'Original ', 0, 100);
    const next = appendLiveDelta(previous, 'klnk', 'x'.repeat(6000), 100, 500);
    expect(previous).toEqual([{ id: '1', speaker: 'klnk', text: 'Original ', endMs: 100 }]);
    expect(next).toEqual([{ id: '1', speaker: 'klnk', text: 'x'.repeat(4000), endMs: 500 }]);
    expect(appendLiveDelta(next, 'klnk', null)).toBe(next);
  });
});
