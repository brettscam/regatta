import { planRoute, plannedPosition, trackFix, type LegPlan, type PlanWeather, type Point, type RoutePlan, type TrackFix, type Waypoint } from '@slack-tide/nav';
import type { PolarTable } from '@slack-tide/sim';

export interface RouteMark extends Waypoint {
  /** Sim time the boat got there, or null if still ahead. */
  reachedAt: number | null;
  /** The plan's time for this mark, kept once it has been reached so plan and actual can be compared. */
  plannedEta: number | null;
  /** The leg as planned when it was last worked out. */
  leg: LegPlan | null;
}

export interface PassageStatus {
  next: RouteMark | null;
  nextIndex: number;
  fix: TrackFix | null;
  /** Seconds behind the plan (positive) or ahead of it (negative). Null with no plan. */
  behind: number | null;
  /** The plan's ETA at the next mark, shifted by how far behind or ahead the boat is running. */
  etaNext: number | null;
  /** Where the plan says the boat should be right now. */
  planned: Point | null;
}

const ARRIVAL_RADIUS = 130;

/** The route being sailed: marks, the plan worked out from the forecast, and what actually happened. */
export class Passage {
  marks: RouteMark[] = [];
  plan: RoutePlan | null = null;
  /** The boat's track over the ground as x, y pairs. */
  readonly track: number[] = [];
  /** Bumped whenever the route or plan changes, so views know to redraw. */
  version = 0;
  private lastFix = { x: NaN, y: NaN, t: -1e9 };
  private legStart: Point = { x: 0, y: 0 };

  constructor(private readonly polar: PolarTable, private readonly weather: PlanWeather) {}

  /** Where the leg now being sailed began. */
  get legOrigin(): Point {
    return this.legStart;
  }

  get nextIndex(): number {
    const i = this.marks.findIndex((m) => m.reachedAt === null);
    return i < 0 ? this.marks.length : i;
  }

  /** Replace the marks still ahead and work the plan out again from where the boat is now. */
  setRoute(waypoints: Waypoint[], boat: Point, t: number): void {
    const done = this.marks.filter((m) => m.reachedAt !== null);
    this.marks = [...done, ...waypoints.map((w) => ({ ...w, reachedAt: null, plannedEta: null, leg: null }))];
    this.replan(boat, t);
  }

  ahead(): RouteMark[] {
    return this.marks.slice(this.nextIndex);
  }

  addMark(p: Point, boat: Point, t: number): void {
    const n = this.marks.length + 1;
    this.marks.push({ x: p.x, y: p.y, name: `WP ${n}`, reachedAt: null, plannedEta: null, leg: null });
    this.replan(boat, t);
  }

  moveMark(index: number, p: Point, boat: Point, t: number): void {
    const m = this.marks[index];
    if (!m || m.reachedAt !== null) return;
    m.x = p.x;
    m.y = p.y;
    this.replan(boat, t);
  }

  removeMark(index: number, boat: Point, t: number): void {
    if (!this.marks[index] || this.marks[index].reachedAt !== null) return;
    this.marks.splice(index, 1);
    this.replan(boat, t);
  }

  /** Work out the plan for the marks still ahead, starting from the boat's position now. */
  replan(boat: Point, t: number): void {
    const ahead = this.ahead();
    this.legStart = { x: boat.x, y: boat.y };
    this.plan = ahead.length ? planRoute(this.polar, boat, ahead, t, this.weather) : null;
    ahead.forEach((m, i) => {
      m.leg = this.plan!.legs[i];
      m.plannedEta = this.plan!.legs[i].eta;
    });
    this.version++;
  }

  /** Record the track and tick off marks as the boat reaches them. Call every frame. */
  update(boat: Point, t: number): void {
    const moved = Math.hypot(boat.x - this.lastFix.x, boat.y - this.lastFix.y);
    if (!(moved < 12) && (t - this.lastFix.t > 2 || !(moved < 60))) {
      this.track.push(boat.x, boat.y);
      this.lastFix = { x: boat.x, y: boat.y, t };
      if (this.track.length > 12000) this.track.splice(0, 2000);
    }
    const i = this.nextIndex;
    const next = this.marks[i];
    if (!next) return;
    const fix = trackFix(boat, this.legStart, next);
    const legLength = Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y);
    // Reached when close, or when the boat has gone past the mark abeam of it.
    if (fix.toGo < ARRIVAL_RADIUS || (fix.along > legLength && fix.toGo < ARRIVAL_RADIUS * 4)) {
      next.reachedAt = t;
      this.legStart = { x: next.x, y: next.y };
      this.version++;
    }
  }

  status(boat: Point, t: number): PassageStatus {
    const i = this.nextIndex;
    const next = this.marks[i] ?? null;
    if (!next || !this.plan) return { next, nextIndex: i, fix: null, behind: null, etaNext: null, planned: null };
    const fix = trackFix(boat, this.legStart, next);
    // How far along the planned route the boat has really got, and when the plan expected that.
    const planLegIndex = this.plan.legs.findIndex((l) => l.to === next || (l.to.x === next.x && l.to.y === next.y));
    let behind: number | null = null;
    let etaNext: number | null = null;
    if (planLegIndex >= 0) {
      const leg = this.plan.legs[planLegIndex];
      const legStartTime = planLegIndex === 0 ? this.plan.startTime : this.plan.legs[planLegIndex - 1].eta;
      // Progress on this leg is how much closer the boat is to the mark than the leg's planned start was.
      const made = Math.min(1, Math.max(0, 1 - fix.toGo / Math.max(1, leg.distance)));
      const plannedTimeHere = legStartTime + made * leg.seconds;
      behind = t - plannedTimeHere;
      etaNext = leg.eta + behind;
    }
    return { next, nextIndex: i, fix, behind, etaNext, planned: plannedPosition(this.plan, t) };
  }
}
