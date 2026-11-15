import { describe, expect, it } from 'vitest';
import releases from '../src/data/releases.json';
import { ALL_KEYS, KEY_GROUPS, STRIPS, isNewSince, stripContext } from '../src/data/keys';
import { DAY, SERIES_GAP, TipPicker, busy, emptySnap, freshMemory, pace, readMemory, tipText, unread, whatsNew, writeMemory, type Snap, type Tip } from '../src/aboard/tipRules';
import { TIPS } from '../src/aboard/tipTable';

const snap = (over: Partial<Snap> = {}): Snap => ({ ...emptySnap(), ...over });
/** Someone with a few sails behind them: the first-sail welcome is not for them. */
const old = (over: Partial<Snap> = {}): Snap => snap({ sails: 12, hours: 9, t: 100, ...over });

/** Run the picker for a while with the game standing as `s` says, and return the first tip it offers. */
function run(picker: TipPicker, s: Snap, seconds: number): Tip | null {
  for (let t = 0; t < seconds; t += 0.5) {
    const tip = picker.next({ ...s, t: s.t + t }, 0.5);
    if (tip) return tip;
  }
  return null;
}

/** Show a tip and let it time out, as the card does. */
function showAndLeave(picker: TipPicker, tip: Tip, s: Snap): void {
  picker.showed(tip);
  picker.ended(s);
}

const fresh = (now = () => 1_000_000): TipPicker => new TipPicker(TIPS, freshMemory(), now);

describe('the tip table', () => {
  it('has ids that are unique and safe to keep in a browser', () => {
    const ids = TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it('says every tip in a title and a sentence or two, whatever the moment', () => {
    const moments = [snap(), old({ boatName: 'Kestrel', company: 1, windKt: 24, berth: { name: 'Sausalito', kind: 'dock', d: 100 }, ashore: { name: 'Sausalito', where: 'the No Name Bar', d: 100, dock: true } }), old({ voice: true })];
    for (const tip of TIPS) {
      expect(tip.title.length).toBeGreaterThan(3);
      expect(tip.title.length).toBeLessThan(36);
      for (const m of moments) {
        const text = tipText(tip, m);
        expect(text.length).toBeGreaterThan(15);
        expect(text.length).toBeLessThan(300);
        expect(text).not.toMatch(/undefined|NaN|null/);
      }
    }
  });

  it('names only keys that are in the Keys tab', () => {
    const known = new Set(ALL_KEYS.flatMap((k) => k.keys));
    for (const tip of TIPS) for (const k of tip.keys) expect(known.has(k), `${tip.id}: ${k}`).toBe(true);
  });

  it('says nothing to a boat sailing quietly alone in her first seconds', () => {
    expect(run(fresh(), snap({ t: 0 }), 5)).toBeNull();
  });
});

describe('the right tip at the right moment', () => {
  const offered = (s: Snap, seconds = 120): string | undefined => run(fresh(), s, seconds)?.id;

  it('tells of the radio when another boat appears, on the website', () => {
    const s = old({ voice: true, shared: true, company: 1, boatName: 'Kestrel', nearBoat: 900 });
    const tip = run(fresh(), s, 30)!;
    expect(tip.id).toBe('company-radio');
    expect(tip.keys).toContain('V');
    expect(tipText(tip, s)).toContain('Kestrel');
    expect(tipText(tip, s)).toContain('Hold V');
  });

  it('points to hails instead where there is no voice', () => {
    const s = old({ voice: false, shared: true, company: 2, boatName: 'Kestrel' });
    const tip = run(fresh(), s, 30)!;
    expect(tip.id).toBe('company-hail');
    expect(tip.keys).toEqual(['Enter']);
    expect(tipText(tip, s)).toContain('Enter');
  });

  it('explains a ferry call the first time one is heard, and how to silence them', () => {
    const tip = run(fresh(), old({ trafficCalls: 1 }), 30)!;
    expect(tip.id).toBe('radio-call');
    expect(tip.keys).toEqual(['Shift', '+', 'V']);
  });

  it('suggests a race once friends have been about for a while, and not while one is on', () => {
    const picker = fresh();
    picker.finish('company-hail');
    const s = old({ shared: true, company: 1 });
    expect(run(picker, s, 60)).toBeNull();
    expect(run(picker, s, 60)?.id).toBe('race-call');
    expect(offered(old({ shared: true, company: 1, racing: true, countdown: -600 }), 200)).not.toBe('race-call');
  });

  it('says a race has been called', () => {
    expect(offered(old({ raceOffered: true }))).toBe('race-offer');
  });

  it('reefs when it blows and she is laid over, and after a knockdown', () => {
    const s = old({ windKt: 22, heelDeg: 31 });
    const tip = run(fresh(), s, 30)!;
    expect(tip.id).toBe('reef');
    expect(tipText(tip, s)).toContain('22 knots');
    expect(offered(old({ windKt: 16, knockdowns: 1 }), 30)).toBe('reef');
    // Not in a breeze, not when already reefed right down.
    expect(offered(old({ windKt: 12, heelDeg: 20 }), 30)).toBeUndefined();
    expect(offered(old({ windKt: 24, heelDeg: 31, reef: 2 }), 30)).toBeUndefined();
  });

  it('offers the spinnaker running in a moderate wind, the engine when stuck, the tow when aground', () => {
    expect(offered(old({ twaDeg: 160, windKt: 10 }), 60)).toBe('spinnaker');
    expect(offered(old({ twaDeg: 160, windKt: 22 }), 60)).toBeUndefined();
    expect(offered(old({ stuck: 70, windKt: 1, speedKt: 0.2 }), 30)).toBe('engine');
    expect(offered(old({ stuck: 70, racing: true, countdown: -900 }), 30)).toBeUndefined();
    expect(offered(old({ aground: true, speedKt: 0 }), 30)).toBe('aground');
  });

  it('knows a dock from a mooring from an anchorage, and the way ashore', () => {
    const at = (kind: 'dock' | 'mooring' | 'anchorage'): string => {
      const s = old({ berth: { name: 'Ayala Cove', kind, d: 200 } });
      return tipText(run(fresh(), s, 30)!, s);
    };
    expect(at('dock')).toContain('tie up');
    expect(at('mooring')).toContain('pick it up');
    expect(at('anchorage')).toContain('drop the anchor');
    // Not in a blow, and not in a race.
    expect(offered(old({ berth: { name: 'Ayala Cove', kind: 'dock', d: 200 }, windKt: 22, heelDeg: 10 }), 30)).toBeUndefined();
    const held = old({ hold: 'anchor', heldFor: 20, speedKt: 0, ashore: { name: 'Sausalito', where: 'the No Name Bar', d: 300, dock: false } });
    const tip = run(fresh(), held, 30)!;
    expect(tip.id).toBe('ashore');
    expect(tipText(tip, held)).toContain('kayak');
    expect(tipText(tip, { ...held, ashore: { ...held.ashore!, dock: true } })).toContain('step ashore');
  });

  it('keeps fishing and crab pots for a boat that has lain at anchor a while', () => {
    expect(offered(old({ hold: 'anchor', heldFor: 30, speedKt: 0 }), 20)).toBeUndefined();
    expect(offered(old({ hold: 'anchor', heldFor: 90, speedKt: 0 }), 20)).toBe('catch');
    expect(offered(old({ hold: 'anchor', heldFor: 90, speedKt: 0, night: true }), 60)).toBe('sleep');
  });

  it('points at the chart when the mark is far upwind, and at the guide and the pilot on a passage', () => {
    expect(offered(old({ t: 150, marks: 2, mark: { d: 4000, upwind: true } }), 40)).toBe('chart');
    expect(offered(old({ t: 250, marks: 2, mark: { d: 900, upwind: false } }), 40)).toBe('guide');
    const picker = fresh();
    picker.finish('guide');
    expect(run(picker, old({ t: 500, hand: true, marks: 2, mark: { d: 4000, upwind: false } }), 60)?.id).toBe('pilot');
  });

  it('explains the start to a first-time racer well before the gun, and the points after the race', () => {
    expect(offered(old({ racing: true, countdown: 240, races: 0 }), 30)).toBe('race-start');
    expect(offered(old({ racing: true, countdown: 240, races: 3 }), 30)).toBeUndefined();
    expect(offered(old({ raceDone: 1, races: 1 }), 30)).toBe('race-done');
  });

  it('greets a returning player with what is new, once', () => {
    expect(offered(old({ t: 0, news: 2 }), 30)).toBe('news');
  });
});

describe('never at a bad moment', () => {
  it('counts a tack, a knockdown, a collision, an open panel and the start sequence as busy', () => {
    expect(busy(snap())).toBe(false);
    expect(busy(snap({ manoeuvre: true }))).toBe(true);
    expect(busy(snap({ knocked: true }))).toBe(true);
    expect(busy(snap({ hitAgo: 5 }))).toBe(true);
    expect(busy(snap({ panel: true }))).toBe(true);
    expect(busy(snap({ racing: true, countdown: 40 }))).toBe(true);
    expect(busy(snap({ racing: true, countdown: -10 }))).toBe(true);
    expect(busy(snap({ racing: true, countdown: 200 }))).toBe(false);
    expect(busy(snap({ racing: true, countdown: -120 }))).toBe(false);
  });

  it('holds a due tip until the boat has been quiet for a few seconds', () => {
    const picker = fresh();
    const s = old({ aground: true, manoeuvre: true });
    expect(run(picker, s, 60)).toBeNull();
    // The tack is over: a few seconds more, then the tip.
    expect(picker.next({ ...s, manoeuvre: false, t: 161 }, 0.5)).toBeNull();
    expect(run(picker, { ...s, manoeuvre: false, t: 162 }, 10)?.id).toBe('aground');
  });

  it('says nothing in the last minute before the gun', () => {
    expect(run(fresh(), old({ racing: true, countdown: 50, races: 0, windKt: 24, heelDeg: 30 }), 20)).toBeNull();
  });

  it('offers nothing while a tip is already up, but still notices what is done', () => {
    const picker = fresh();
    const s = old({ windKt: 24, heelDeg: 30 });
    for (let t = 0; t < 30; t += 0.5) expect(picker.next({ ...s, t: s.t + t }, 0.5, true)).toBeNull();
    picker.next({ ...s, reef: 1 }, 0.5, true);
    expect(picker.memory.done.reef).toBe(true);
  });
});

describe('pacing', () => {
  it('speaks less to an old hand', () => {
    expect(pace(0)).toEqual({ gap: 120, cap: 7 });
    expect(pace(2).gap).toBeGreaterThan(pace(0).gap);
    expect(pace(5).cap).toBeLessThan(pace(2).cap);
  });

  it('leaves two minutes between tips for a beginner', () => {
    const picker = fresh();
    const s = old({ trafficCalls: 1, raceOffered: true });
    const first = run(picker, s, 30)!;
    expect(first.id).toBe('race-offer');
    showAndLeave(picker, first, { ...s, t: 120 });
    expect(run(picker, { ...s, t: 120 }, 119)).toBeNull();
    expect(run(picker, { ...s, t: 239 }, 10)?.id).toBe('radio-call');
  });

  it('lets something urgent through sooner, and outside the count', () => {
    const picker = fresh();
    const s = old({ trafficCalls: 1 });
    showAndLeave(picker, run(picker, s, 30)!, { ...s, t: 110 });
    expect(picker.shown).toBe(1);
    const urgent = run(picker, { ...s, t: 110, aground: true }, 40)!;
    expect(urgent.id).toBe('aground');
    picker.showed(urgent);
    expect(picker.shown).toBe(1);
  });

  it('stops at a handful on one sail', () => {
    // Twenty tips that are always due, shown to a mate: four and no more.
    const many: Tip[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: 'A tip', text: 'Words', keys: [], priority: i, when: () => true }));
    const picker = new TipPicker(many, freshMemory(), () => 5000);
    let t = 0;
    let shown = 0;
    for (let i = 0; i < 20; i++) {
      const s = snap({ rank: 3, t });
      const tip = run(picker, s, 600);
      if (!tip) break;
      shown++;
      t += 600;
      showAndLeave(picker, tip, { ...s, t });
    }
    expect(shown).toBe(pace(3).cap);
  });

  it('does not show a beginner\'s tip to a skipper', () => {
    expect(run(fresh(), old({ rank: 4, knockdowns: 2, windKt: 8 }), 30)).toBeNull();
    expect(run(fresh(), old({ rank: 1, knockdowns: 2, windKt: 8 }), 30)?.id).toBe('weather');
  });

  it('runs the first-sail welcome as four tips over the first minutes', () => {
    const picker = fresh();
    const seen: Array<[string, number]> = [];
    let showing: Tip | null = null;
    let until = 0;
    for (let t = 0; t < 240; t += 0.5) {
      const s = snap({ t, shared: true });
      if (showing && t >= until) {
        picker.ended(s);
        showing = null;
      }
      const tip = picker.next(s, 0.5, showing !== null);
      if (!tip) continue;
      picker.showed(tip);
      showing = tip;
      until = t + 16;
      seen.push([tip.id, t]);
    }
    expect(seen.map(([id]) => id)).toEqual(['welcome-steer', 'welcome-trim', 'welcome-keys', 'welcome-company']);
    for (let i = 1; i < seen.length; i++) expect(seen[i][1] - seen[i - 1][1]).toBeGreaterThanOrEqual(SERIES_GAP);
    // None of it counts against the session's handful.
    expect(picker.shown).toBe(0);
  });

  it('leaves the wheel and the sheets to the lesson when there is one', () => {
    const tip = run(fresh(), snap({ t: 0, lesson: true }), 80);
    expect(tip).toBeNull();
  });
});

describe('memory', () => {
  it('never repeats a tip the player has acted on', () => {
    const picker = fresh();
    const s = old({ voice: true, company: 1 });
    const tip = run(picker, s, 30)!;
    picker.showed(tip);
    expect(picker.pressed('KeyV', false, tip)).toBe(true);
    picker.ended(s);
    expect(run(new TipPicker(TIPS, picker.memory, () => 1_000_000 + 30 * DAY), { ...s, t: 5000 }, 400)?.id).not.toBe('company-radio');
  });

  it('counts a key pressed before the tip was ever shown', () => {
    const picker = fresh();
    picker.pressed('KeyJ', false);
    expect(run(picker, old({ windKt: 24, heelDeg: 32 }), 30)).toBeNull();
  });

  it('tells Shift+V from V', () => {
    const picker = fresh();
    picker.pressed('KeyV', false);
    expect(picker.memory.done['radio-call']).toBeUndefined();
    expect(picker.memory.done['company-radio']).toBe(true);
    picker.pressed('KeyV', true);
    expect(picker.memory.done['radio-call']).toBe(true);
  });

  it('takes B as an answer only for the card that is up', () => {
    const picker = fresh();
    const done = TIPS.find((t) => t.id === 'race-done')!;
    picker.pressed('KeyB', false);
    expect(picker.memory.done['race-done']).toBeUndefined();
    expect(picker.pressed('KeyB', false, done)).toBe(true);
    expect(picker.memory.done['race-done']).toBe(true);
  });

  it('brings back a tip that was left alone, after its cooldown, and only so many times', () => {
    let now = 1_000_000;
    const picker = new TipPicker(TIPS, freshMemory(), () => now);
    const s = old({ trafficCalls: 1 });
    showAndLeave(picker, run(picker, s, 30)!, s);
    // Later on the same day, on a new sail: not again.
    expect(run(new TipPicker(TIPS, picker.memory, () => now + 3600), s, 30)).toBeNull();
    now += DAY + 60;
    const again = new TipPicker(TIPS, picker.memory, () => now);
    const second = run(again, s, 30)!;
    expect(second.id).toBe('radio-call');
    showAndLeave(again, second, s);
    now += 30 * DAY;
    expect(run(new TipPicker(TIPS, picker.memory, () => now), s, 30)).toBeNull();
  });

  it('forgets a tip that a tack took down before it could be read', () => {
    const picker = fresh();
    const s = old({ trafficCalls: 1 });
    const tip = run(picker, s, 30)!;
    picker.showed(tip);
    picker.withdrew(tip);
    expect(picker.memory.seen[tip.id]).toBeUndefined();
    expect(picker.shown).toBe(0);
    expect(run(picker, s, 30)?.id).toBe('radio-call');
  });

  it('is silent once tips are switched off, and speaks again when they are switched on', () => {
    const picker = fresh();
    picker.setOff(true);
    const s = old({ aground: true });
    expect(run(picker, s, 60)).toBeNull();
    picker.setOff(false);
    expect(run(picker, s, 60)?.id).toBe('aground');
  });

  it('survives being saved and read back', () => {
    const picker = fresh();
    const s = old({ trafficCalls: 1 });
    showAndLeave(picker, run(picker, s, 30)!, s);
    picker.finish('reef');
    picker.memory.news = 'v25';
    const back = readMemory(writeMemory(picker.memory));
    expect(back).toEqual(picker.memory);
  });

  it('throws away anything saved that is not the right shape', () => {
    expect(readMemory('not json')).toEqual(freshMemory());
    expect(readMemory(null)).toEqual(freshMemory());
    expect(readMemory('[1,2]')).toEqual(freshMemory());
    const m = readMemory(JSON.stringify({ off: 'yes', news: '<b>', done: ['reef', 7, 'Bad Id', '__proto__'], seen: { reef: [2, 100], bad: 'x', 'radio-call': [-1, 5], guide: [1e99, NaN], chart: [3.7, 12.9] } }));
    expect(m.off).toBe(false);
    expect(m.news).toBe('');
    expect(Object.keys(m.done)).toEqual(['reef']);
    expect(m.seen).toEqual({ reef: { n: 2, at: 100 }, chart: { n: 3, at: 12 } });
  });
});

describe('what is new', () => {
  const notes = releases.notes;
  const ids = notes.map((n) => n.id);

  it('lists nothing for someone who has read the newest note, or was never here', () => {
    expect(unread(notes, notes[0].id)).toEqual([]);
    expect(unread(notes, '')).toEqual([]);
    expect(unread(notes, 'v999')).toEqual([]);
  });

  it('lists the notes since the last visit, the ones that brought a key first, three at most', () => {
    const lines = whatsNew(notes, 'v19', ALL_KEYS);
    expect(lines).toHaveLength(3);
    expect(unread(notes, 'v19').map((n) => n.id).slice(-1)).toEqual(['v20']);
    expect(lines.every((l) => l.keys.length > 0)).toBe(true);
    expect(lines.find((l) => l.title.includes('radio'))?.keys).toEqual(['V']);
    expect(whatsNew(notes, notes[1].id, ALL_KEYS)).toEqual([{ title: notes[0].title, keys: [] }]);
  });

  it('marks keys that came in after the last note read', () => {
    expect(isNewSince('v22', 'v20', ids)).toBe(true);
    expect(isNewSince('v20', 'v20', ids)).toBe(false);
    expect(isNewSince('v9', 'v20', ids)).toBe(false);
    expect(isNewSince(undefined, 'v20', ids)).toBe(false);
    expect(isNewSince('v22', '', ids)).toBe(false);
  });

  it('dates every key by a release note that exists', () => {
    for (const k of ALL_KEYS) if (k.since) expect(ids, `${k.name}: ${k.since}`).toContain(k.since);
  });
});

describe('the Keys tab and the strip', () => {
  it('has the five groups asked for, each with rows that say something', () => {
    expect(KEY_GROUPS.map((g) => g.title).slice(0, 5)).toEqual(['Sailing', 'Racing and talking', 'At anchor and ashore', 'Views', 'Under power']);
    for (const k of ALL_KEYS) {
      expect(k.keys.length).toBeGreaterThan(0);
      expect(k.what.length).toBeGreaterThan(20);
    }
  });

  it('shows the racing keys in a race, the anchor keys at anchor, the paddle in the kayak', () => {
    expect(stripContext({ away: false, racing: false, held: false })).toBe('sailing');
    expect(stripContext({ away: false, racing: true, held: false })).toBe('racing');
    expect(stripContext({ away: false, racing: false, held: true })).toBe('held');
    expect(stripContext({ away: true, racing: false, held: true })).toBe('tender');
    expect(STRIPS.racing.flatMap(([keys]) => keys)).toContain('V');
    expect(STRIPS.held.flatMap(([keys]) => keys)).toEqual(expect.arrayContaining(['X', 'O', 'K', 'L']));
    for (const rows of Object.values(STRIPS)) expect(rows.length).toBeLessThanOrEqual(7);
  });
});
