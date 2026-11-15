import { describe, expect, it } from 'vitest';
import { addEvent, eventLink, makeEvent, readEvent, sharedEvent } from '../src/race/events';
import { readCall } from '../src/race/race';

const marks = [{ name: 'Start', x: 0, y: 0 }, { name: 'Finish', x: 900, y: 400 }];

describe('a race call says which class it is sailed in', () => {
  it('keeps the class through the check every call goes through', () => {
    expect(readCall({ id: 'abc', name: 'Round the cove', gun: 1200, marks, host: 'Ines', pace: 1, cls: 'sloop38' })?.cls).toBe('sloop38');
  });

  it('a call from an older copy of the game names no class, so everyone sails her own boat', () => {
    const call = readCall({ id: 'abc', name: 'Round the cove', gun: 1200, marks });
    expect(call).not.toBeNull();
    expect(call && 'cls' in call).toBe(false);
  });

  it('drops a class that is not a plain boat id', () => {
    for (const cls of ['<b>', '', 38, 'a'.repeat(40), '../x', null]) {
      const call = readCall({ id: 'abc', name: 'Round the cove', gun: 1200, marks, cls });
      expect(call, String(cls)).not.toBeNull();
      expect(call?.cls, String(cls)).toBeUndefined();
    }
  });
});

describe('a race fixed for a time carries its class', () => {
  const at = Date.now() + 3600e3;
  (globalThis as { location?: unknown }).location ??= { origin: 'https://example.test', pathname: '/' };

  it('through the link', () => {
    const link = eventLink(makeEvent('san-juans', 'strait-cove', at, 'Race', 'perf45'));
    const q = new URL(link).searchParams;
    expect(q.get('cls')).toBe('perf45');
    const back = readEvent({ course: q.get('race'), at: q.get('at'), water: q.get('water'), cls: q.get('cls') });
    expect(back?.cls).toBe('perf45');
    // The class does not change which race it is.
    expect(back?.id).toBe(makeEvent('san-juans', 'strait-cove', at).id);
  });

  it('an old link has no class and reads as before', () => {
    const e = readEvent({ course: 'strait-cove', at: String(at), water: 'san-juans' });
    expect(e).not.toBeNull();
    expect(e && 'cls' in e).toBe(false);
    expect(new URL(eventLink(e!)).searchParams.has('cls')).toBe(false);
  });

  it('refuses a class that is not a plain id', () => {
    const e = readEvent({ course: 'strait-cove', at, cls: '<script>' });
    expect(e).not.toBeNull();
    expect(e?.cls).toBeUndefined();
  });

  it('heard first without its class, it takes the class from a boat that knows it', () => {
    const later = at + 7200e3;
    expect(addEvent(makeEvent('sf-bay', 'strait-cove', later))).toBe(true);
    expect(addEvent(makeEvent('sf-bay', 'strait-cove', later, 'Race', 'sloop30'))).toBe(false);
    const id = makeEvent('sf-bay', 'strait-cove', later).id;
    // Nothing else has been fixed here, so it is the one this page passes on.
    expect(sharedEvent()?.id).toBe(id);
    expect(sharedEvent()?.cls).toBe('sloop30');
  });
});
