// Where another boat's tender is between the reports of her. Plain arithmetic: no DOM and no Three.js.
import type { TenderReport } from './tenders';

/** Longest she is run on from one report, seconds. After that she is taken to have stopped where she would be. */
const RUN_ON = 2;

/**
 * One tender seen from another page. Reports come a few times a second at best, and she may be doing nearly forty knots,
 * so between them she is run on along her heading at the speed she gave, and each new report pulls her gently onto
 * its own line rather than moving her there at once.
 */
export class TenderTrack {
  x = 0;
  y = 0;
  heading = 0;
  /** m/s along her heading, as she last said. Zero once the reports have stopped. */
  speed = 0;
  kind = '';
  ashore = false;
  private report: TenderReport | null = null;
  private at = 0;
  private placed = false;

  /** A report of her, and when it was heard, seconds on any steady clock. */
  hear(report: TenderReport, at: number): void {
    // Another kind is another craft: she is put straight where she says.
    if (report.kind !== this.kind) this.placed = false;
    this.report = report;
    this.at = at;
    this.kind = report.kind;
    this.ashore = report.ashore;
  }

  /** Move her on. `now` is on the clock `hear` was given, `dt` is the frame's length. */
  update(now: number, dt: number): void {
    const r = this.report;
    if (!r) return;
    const age = Math.max(0, now - this.at);
    const run = Math.min(RUN_ON, age);
    const fx = Math.sin(r.heading);
    const fy = Math.cos(r.heading);
    const tx = r.x + fx * r.speed * run;
    const ty = r.y + fy * r.speed * run;
    if (!this.placed) {
      this.placed = true;
      this.x = tx;
      this.y = ty;
      this.heading = r.heading;
      this.speed = r.speed;
      return;
    }
    this.speed = age < RUN_ON ? r.speed : 0;
    // Her own way carries her, and what is left over is the error to be eased out.
    const pull = Math.min(1, dt * 4);
    this.x += fx * this.speed * dt;
    this.y += fy * this.speed * dt;
    this.x += (tx - this.x) * pull;
    this.y += (ty - this.y) * pull;
    this.heading += Math.atan2(Math.sin(r.heading - this.heading), Math.cos(r.heading - this.heading)) * Math.min(1, dt * 8);
  }
}
