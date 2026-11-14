import { KT, type Sim } from '@slack-tide/sim';
import type { ReplayWorld } from '@slack-tide/world';

export interface GustReport {
  /** A short line for the readout, or '' when the wind is steady. */
  line: string;
  /** Set once when a strong gust is first seen coming: worth interrupting for. */
  alert: string;
}

/**
 * Looks to windward the way a sailor watches for dark water. The wind is a known function of place and time, so the
 * boat's own track can be run forward to see what she will sail into over the next half minute.
 */
export class GustWatch {
  private clock = 0;
  private quietUntil = 0;
  private readonly report: GustReport = { line: '', alert: '' };

  constructor(private readonly world: ReplayWorld, private readonly sim: Sim) {}

  /** Call every frame. The look ahead itself runs twice a second. */
  update(dt: number): GustReport {
    const r = this.report;
    r.alert = '';
    this.clock -= dt;
    this.quietUntil -= dt;
    if (this.clock > 0) return r;
    this.clock = 0.5;

    const s = this.sim.state;
    const o = this.sim.out;
    const now = o.tws / KT;
    const mean = this.world.wind(s.x, s.y, s.t).speed / KT;
    const vx = Math.sin(o.cog) * o.sog;
    const vy = Math.cos(o.cog) * o.sog;
    let peak = now;
    let arrives = 0;
    for (let k = 5; k <= 40; k += 5) {
      const kt = this.world.gustyWind(s.x + vx * k, s.y + vy * k, s.t + k).speed / KT;
      if (kt > peak) peak = kt;
      // It has arrived when most of the rise is here.
      if (!arrives && kt - now >= 2.5) arrives = k;
    }
    const rise = peak - now;
    if (rise >= 3 && peak >= now * 1.15 && peak >= 10 && arrives) {
      r.line = `Gust ${Math.round(peak)} kt in ${arrives} s`;
      if (peak >= 18 && rise >= 4 && this.quietUntil <= 0) {
        this.quietUntil = 90;
        const reefed = s.reef > 0 || s.hold !== 'none' ? '' : ' Be ready to ease the main';
        r.alert = `Gust coming: ${Math.round(peak)} kt in about ${arrives} seconds.${reefed}`;
      }
    } else if (now - mean >= 3 && now >= mean * 1.15) {
      r.line = `In a gust, ${Math.round(now)} kt`;
    } else if (mean - now >= 3 && now <= mean * 0.85) {
      r.line = `In a lull, ${Math.round(now)} kt`;
    } else {
      r.line = '';
    }
    return r;
  }
}
