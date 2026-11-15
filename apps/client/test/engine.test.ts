import { describe, expect, it } from 'vitest';
import type { EngineSpec } from '@slack-tide/sim';
import {
  RACE_REFUSAL, batteryWarning, fuelWarning, panelShown, raceBarsEngine, throttleName, throttleSays, throttleStep,
} from '../src/aboard/engineRules';

const engine: EngineSpec = { powerKw: 22, cruiseKt: 6.8, burnLph: 3, tankL: 130, batteryAh: 300, alternatorA: 60, windage: 0.025 };
const free = { engineOn: true, cranking: false, hold: 'none' as const, notch: 0, barred: false };

describe('the engine in a race', () => {
  it('is free outside a race and until five minutes before the gun', () => {
    expect(raceBarsEngine(null)).toBe(false);
    expect(raceBarsEngine({ entered: false, finished: false, countdown: 0 })).toBe(false);
    expect(raceBarsEngine({ entered: true, finished: false, countdown: 301 })).toBe(false);
  });

  it('is barred from five minutes before the gun until she finishes', () => {
    expect(raceBarsEngine({ entered: true, finished: false, countdown: 300 })).toBe(true);
    expect(raceBarsEngine({ entered: true, finished: false, countdown: 10 })).toBe(true);
    expect(raceBarsEngine({ entered: true, finished: false, countdown: -1800 })).toBe(true);
    expect(raceBarsEngine({ entered: true, finished: true, countdown: -1800 })).toBe(false);
  });

  it('will not go into gear while barred, and says why', () => {
    expect(throttleStep({ ...free, barred: true }, 1)).toEqual({ say: RACE_REFUSAL });
    expect(throttleStep({ ...free, barred: true }, -1)).toEqual({ say: RACE_REFUSAL });
    // Coming out of gear is always allowed.
    expect(throttleStep({ ...free, barred: true, notch: 1 }, -1)).toEqual({ to: 0 });
    expect(throttleStep({ ...free, barred: true, notch: -1 }, 1)).toEqual({ to: 0 });
  });
});

describe('the throttle', () => {
  it('steps ahead and astern through neutral, and stops at each end', () => {
    expect(throttleStep(free, 1)).toEqual({ to: 1 });
    expect(throttleStep(free, -1)).toEqual({ to: -1 });
    expect(throttleStep({ ...free, notch: 3 }, -1)).toEqual({ to: 2 });
    expect(throttleStep({ ...free, notch: 4 }, 1).to).toBeUndefined();
    expect(throttleStep({ ...free, notch: -2 }, -1).to).toBeUndefined();
  });

  it('does nothing with the engine off, starting, or the boat held, and says which', () => {
    expect(throttleStep({ ...free, engineOn: false }, 1).say).toMatch(/I starts it/);
    expect(throttleStep({ ...free, engineOn: false, cranking: true }, 1).say).toMatch(/turning over/);
    expect(throttleStep({ ...free, hold: 'anchor' }, 1).say).toMatch(/at anchor/);
    expect(throttleStep({ ...free, hold: 'mooring' }, -1).say).toMatch(/made fast/);
  });

  it('names each position and the speed it gives', () => {
    expect(throttleName(0)).toBe('Neutral');
    expect(throttleName(1)).toBe('Ahead slow');
    expect(throttleName(-2)).toBe('Astern full');
    expect(throttleSays(engine, 3)).toBe('Ahead cruise: about 7 kt in flat water');
    expect(throttleSays(engine, 1)).toBe('Ahead slow: about 2.7 kt in flat water');
    expect(throttleSays(engine, 0)).toMatch(/Neutral/);
  });
});

describe('the gauges', () => {
  it('warn once as the fuel falls through a fifth, and again when nearly dry', () => {
    expect(fuelWarning(engine, 0.5, 0.4)).toBeNull();
    expect(fuelWarning(engine, 0.201, 0.2)).toMatch(/fifth of a tank: about 9 hours/);
    expect(fuelWarning(engine, 0.2, 0.19)).toBeNull();
    expect(fuelWarning(engine, 0.081, 0.08)).toMatch(/very low: 10 litres/);
  });

  it('warn about the battery long before the pilot drops out, and not while the engine is charging it', () => {
    expect(batteryWarning(0.36, 0.35, false)).toMatch(/35%/);
    expect(batteryWarning(0.36, 0.35, true)).toBeNull();
    expect(batteryWarning(0.19, 0.18, false)).toMatch(/At 10% the autopilot/);
    expect(batteryWarning(0.8, 0.79, false)).toBeNull();
  });

  it('the panel is only there with the engine on or something low', () => {
    expect(panelShown({ engineOn: false, cranking: false, fuel: 1, battery: 1 })).toBe(false);
    expect(panelShown({ engineOn: true, cranking: false, fuel: 1, battery: 1 })).toBe(true);
    expect(panelShown({ engineOn: false, cranking: true, fuel: 1, battery: 1 })).toBe(true);
    expect(panelShown({ engineOn: false, cranking: false, fuel: 0.15, battery: 1 })).toBe(true);
    expect(panelShown({ engineOn: false, cranking: false, fuel: 1, battery: 0.3 })).toBe(true);
  });
});
