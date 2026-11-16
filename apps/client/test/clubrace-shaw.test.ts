import { describe, expect, it } from 'vitest';
import { LONG, sailLevels } from './clubrace';

// Round Shaw is thirteen miles through four passes, the longest race there is and the tightest water, so it has a file
// to itself and is sailed by the best boat and the two worst. Started in the early afternoon the fleet carries the flood
// north and comes home on the last of it. Started in the late morning, nobody at all gets back past Turn Rock against
// the flood, however well she is sailed.
describe('club racing round Shaw Island', () => {
  it('the ringer and the back-markers all get through the passes without touching bottom', async () => {
    const rows = await sailLevels('san-juans', 'round-shaw', 5.5, 'a', ['ringer', 'casual', 'sunset']);
    const [ringer, casual, sunset] = rows;
    for (const r of rows) {
      expect(r.finish, `${r.level} finishes`).not.toBeNull();
      expect(r.agroundSeconds, `${r.level} aground`).toBe(0);
      expect(r.tows, `${r.level} towed`).toBe(0);
    }
    expect(casual.finish!).toBeGreaterThan(ringer.finish!);
    expect(sunset.finish!).toBeGreaterThan(ringer.finish!);
    expect(Math.max(casual.finish!, sunset.finish!) / ringer.finish!).toBeLessThan(1.7);
  }, LONG);
});
