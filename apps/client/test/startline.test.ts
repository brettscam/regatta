import { describe, expect, it } from 'vitest';
import {
  ABEAM, CALLS, HOW_A_RACE_WORKS, RING, bearing3, dueCall, gunOutsideCall, inRingCall, marginText, nextText, preStart, preStartCall, preStartLine,
  shortRange, spokenRange, spokenTime, taken, takenCall,
} from '../src/race/startline';

const D2R = Math.PI / 180;

describe('what counts as taking a mark', () => {
  it('inside the ring is taken, on the ring or outside is not', () => {
    expect(taken(RING - 1, 0, 1000)).toBe('ring');
    expect(taken(RING, 0, 1000)).toBeNull();
    expect(taken(RING + 1, 900, 1000)).toBeNull();
  });

  it('a boat past the mark, abeam of it, is given it out to four ring widths and says so', () => {
    expect(taken(300, 1001, 1000)).toBe('abeam');
    expect(taken(ABEAM - 1, 1200, 1000)).toBe('abeam');
    expect(taken(ABEAM, 1200, 1000)).toBeNull();
    // Short of the mark's beam, the same distance off is nothing.
    expect(taken(300, 999, 1000)).toBeNull();
  });

  it('at the gun a boat outside the ring cannot be given the start abeam: her leg starts where she is', () => {
    for (const d of [RING, 200, 500, 3000]) expect(taken(d, 0, d)).toBeNull();
    expect(taken(60, 0, 60)).toBe('ring');
  });

  it('the ring is 130 metres, as drawn', () => {
    expect(RING).toBe(130);
  });
});

describe('time on distance before the gun', () => {
  it('measures to the edge of the ring, not to the mark', () => {
    expect(preStart(430, 3, 100).dist).toBe(300);
    expect(preStart(100, 3, 100).dist).toBe(0);
  });

  it('early by the time she would have in hand at the ring', () => {
    // 300 m to the ring at 3 m/s is 100 s. With 140 s to the gun she is 40 s early.
    const p = preStart(430, 3, 140);
    expect(p.state).toBe('early');
    expect(p.reach).toBeCloseTo(100);
    expect(p.margin).toBeCloseTo(40);
    expect(marginText(p)).toBe('0:40 early');
  });

  it('late by the time she would still be short of it', () => {
    const p = preStart(430, 3, 30);
    expect(p.state).toBe('late');
    expect(p.margin).toBeCloseTo(-70);
    expect(marginText(p)).toBe('1:10 late');
  });

  it('within a quarter of a minute either way is on time', () => {
    expect(preStart(430, 3, 110).state).toBe('ontime');
    expect(preStart(430, 3, 90).state).toBe('ontime');
    expect(preStart(430, 3, 116).state).toBe('early');
    expect(preStart(430, 3, 84).state).toBe('late');
    expect(marginText(preStart(430, 3, 100))).toBe('on time');
  });

  it('inside the ring there is nothing to reach', () => {
    const p = preStart(80, 0, 200);
    expect(p).toMatchObject({ state: 'inside', dist: 0, reach: 0 });
    expect(marginText(p)).toBe('in the ring');
  });

  it('a stopped boat is told so rather than given a figure of hours', () => {
    for (const speed of [0, 0.3, NaN]) {
      const p = preStart(600, speed, 200);
      expect(p.state).toBe('stopped');
      expect(p.reach).toBeNull();
      expect(marginText(p)).toBe('not moving');
    }
  });

  it('the line under the clock carries the gun, the distance and the figure', () => {
    expect(preStartLine(preStart(430, 3, 140), 'Reid Rock')).toBe('Gun in 2:20 · start ring at Reid Rock 300 m · 0:40 early');
    expect(preStartLine(preStart(50, 1, 75), 'Reid Rock')).toBe('Gun in 1:15 · in the start ring at Reid Rock');
    expect(preStartLine(preStart(2130, 0.2, 600), 'Reid Rock')).toBe('Gun in 10:00 · start ring at Reid Rock 1.1 nm · not moving');
  });
});

describe('the calls before the gun', () => {
  it('each is due once, in the seconds after its moment', () => {
    const made = new Set<number>();
    const heard: number[] = [];
    for (let left = 320; left > -5; left -= 0.5) {
      const due = dueCall(left, made);
      if (due !== null) {
        made.add(due);
        heard.push(due);
      }
    }
    expect(heard).toEqual(CALLS);
  });

  it('a boat that joins with two and a half minutes to go is not told about five', () => {
    expect(dueCall(150, new Set())).toBeNull();
    expect(dueCall(119.5, new Set())).toBe(120);
    expect(dueCall(119.5, new Set([120]))).toBeNull();
  });

  it('the minute call tells an early boat how far, by how much, and what to do', () => {
    expect(preStartCall(60, preStart(430, 15, 60), true)).toBe('1 minute. You are 300 metres from the start ring, 40 seconds early: slow down or circle');
  });

  it('a boat with minutes in hand is told there is no hurry', () => {
    expect(preStartCall(300, preStart(430, 3, 300), true)).toBe('5 minutes. You are 300 metres from the start ring, 3 minutes 20 early: no hurry, stay near it');
  });

  it('a late boat is told to sail straight for it', () => {
    expect(preStartCall(30, preStart(430, 3, 30), true)).toBe('30 seconds. You are 300 metres from the start ring, 1 minute 10 late at this speed: sail straight for it');
  });

  it('on time, stopped and inside each have their own words', () => {
    expect(preStartCall(120, preStart(430, 2.5, 120), true)).toBe('2 minutes. You are 300 metres from the start ring, on time at this speed: hold it');
    expect(preStartCall(120, preStart(1130, 0, 120), true)).toBe('2 minutes. You are 0.5 miles from the start ring and not moving: get her sailing toward it');
    expect(preStartCall(60, preStart(90, 2, 60), true)).toBe('1 minute. You are in the start ring: stay in it or close by');
  });

  it('ten seconds is only ever ten seconds', () => {
    expect(preStartCall(10, preStart(430, 3, 10), true)).toBe('10 seconds');
  });

  it('with the guide hidden the calls are the bare time', () => {
    expect(preStartCall(300, preStart(430, 3, 300), false)).toBe('5 minutes to the gun');
    expect(preStartCall(60, preStart(430, 3, 60), false)).toBe('1 minute to the gun');
    expect(preStartCall(30, preStart(430, 3, 30), false)).toBe('30 seconds');
  });

  it('sailing into the ring early is said once, with the time left', () => {
    expect(inRingCall(130)).toContain('You are in the start ring, 2:10 to the gun');
  });
});

describe('the gun and the marks', () => {
  const next = { name: 'Raccoon Strait', metres: 1.2 * 1852, bearing: 75 * D2R, last: false };

  it('a mark rounded names the next one, how far and on what bearing', () => {
    expect(takenCall('Point Stuart', 2, 'ring', 100, next)).toBe('Point Stuart rounded. Next: Raccoon Strait, 1.2 miles, bearing 075°');
  });

  it('the last mark is called the finish', () => {
    expect(nextText({ ...next, name: 'Ayala Cove', last: true })).toBe('Next: the finish at Ayala Cove, 1.2 miles, bearing 075°');
  });

  it('a boat in the ring at the gun is told at once that she has started', () => {
    expect(takenCall('Reid Rock', 0, 'ring', 60, next, true)).toBe('Gun! You are in the ring: started at Reid Rock. Next: Raccoon Strait, 1.2 miles, bearing 075°');
  });

  it('a boat outside it at the gun gets the distance to the ring and the bearing', () => {
    expect(gunOutsideCall('Reid Rock', 430, 255 * D2R)).toBe('Gun! The start ring at Reid Rock is 300 metres off, bearing 255°. Sail into it to start');
  });

  it('sailing into the start ring after the gun is the start', () => {
    expect(takenCall('Reid Rock', 0, 'ring', 120, next)).toBe('Started at Reid Rock. Next: Raccoon Strait, 1.2 miles, bearing 075°');
  });

  it('a mark given abeam, outside the ring, says so and how far off she was', () => {
    expect(takenCall('Point Stuart', 2, 'abeam', 300, next)).toBe('Point Stuart passed abeam, 300 metres off: it counts. Next: Raccoon Strait, 1.2 miles, bearing 075°');
    expect(takenCall('Reid Rock', 0, 'abeam', 300, next)).toContain('Started: Reid Rock passed abeam, 300 metres off');
  });
});

describe('the words', () => {
  it('distances', () => {
    expect(spokenRange(304)).toBe('300 metres');
    expect(spokenRange(3)).toBe('10 metres');
    expect(spokenRange(2222)).toBe('1.2 miles');
    expect(shortRange(304)).toBe('300 m');
    expect(shortRange(2222)).toBe('1.2 nm');
  });

  it('times', () => {
    expect(spokenTime(40)).toBe('40 seconds');
    expect(spokenTime(1)).toBe('1 second');
    expect(spokenTime(70)).toBe('1 minute 10');
    expect(spokenTime(180)).toBe('3 minutes');
  });

  it('bearings are three figures and never 360', () => {
    expect(bearing3(75 * D2R)).toBe('075');
    expect(bearing3(-90 * D2R)).toBe('270');
    expect(bearing3(359.7 * D2R)).toBe('000');
  });

  it('how a race works is three or four sentences that name the ring size', () => {
    expect(HOW_A_RACE_WORKS.length).toBeLessThanOrEqual(4);
    expect(HOW_A_RACE_WORKS.join(' ')).toContain(`${RING} metres`);
  });
});
