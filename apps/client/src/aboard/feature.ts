import type { Sim } from '@slack-tide/sim';
import type { ReplayWorld } from '@slack-tide/world';
import type { Sound } from '../audio/sound';
import type { BoatView, Livery } from '../boat/boatView';
import type { YardBoat } from '../boat/yard';
import type { DroneCamera } from '../camera/drone';
import type { Logbook } from '../net/logbook';
import type { RemoteBoat } from '../net/fleet';
import type { Place } from '../session';
import type { Stage } from '../stage';
import type { Race, RaceCourse } from '../race/race';
import type { ShadedWind } from '../race/shadow';
import type { Seaway } from './seaway';
import type { Hud } from '../ui/hud';
import type { Passage } from '../ui/passage';
import type { CourseFeatures } from '../world/features';

/** What a feature is handed to work with. Everything a feature needs from the game comes through here. */
export interface AboardContext {
  sim: Sim;
  world: ReplayWorld;
  /** The wind her sim is fed: the world's, scaled by `air.factor` when another boat is taking it. See `race/shadow.ts`. */
  air: ShadedWind;
  /**
   * The sea as she meets it: `seaway.sea` the sea state at the boat, `seaway.wake` a ship's wake at whoever is being
   * followed, and `seaway.on((event, strength) => ...)` to be told when she slams, surfs or meets a wake. See `seaway.ts`.
   */
  seaway: Seaway;
  /** The shared scene: `stage.scene` to add meshes to, `stage.seaLevel(x, z, seaTime)` for the height of the water. */
  stage: Stage;
  hud: Hud;
  passage: Passage;
  /** The boat as drawn, and what she is. Both change when she changes boats for a one-design race, so read them when needed rather than keeping them. */
  boatView: BoatView;
  drone: DroneCamera;
  spec: YardBoat;
  livery: Livery;
  skipper: string;
  places: Place[];
  /** Hazards, traffic lanes, refuges and lights, on a water that has them. See `world/features.ts`. */
  features?: CourseFeatures;
  logbook: Logbook;
  /** A passing remark at the bottom of the screen. */
  say(text: string, seconds?: number): void;
  /** A line among the hails, as if spoken by `from`: where words on the radio are written out. */
  heard(from: string, text: string): void;
  /** Something that needs the player. Also drops time back to real speed. */
  alarm(text: string): void;
  /** True while other people's boats are on the water. The clock is shared then, so time cannot be skipped. */
  sharing(): boolean;
  /** The other people's boats here now. */
  company(): RemoteBoat[];
  /** The race this boat is in, if any, and its marks. */
  race?: Race;
  /** Every race course on this water. */
  races: RaceCourse[];
  /** Seconds into the recorded season, now. */
  seasonNow(): number;
  /** True while a key is held down, by its KeyboardEvent.code. */
  held(code: string): boolean;
  /** The game's sound, all of it made from noise and tones. Silent until the player has touched the page. */
  sound: Sound;
  /** Another feature, by id, for the few cases where one depends on another. */
  feature<T extends Feature>(id: string): T | undefined;
}

/**
 * Something to do aboard besides sailing: anchoring, fishing, taking the kayak ashore.
 * Each one is a class in this folder that implements this, listed in `index.ts`. The session calls the hooks.
 * Rule from the PRD: no on-screen button for an action on the boat. Keys, and words on the screen that say what happened.
 */
export interface Feature {
  readonly id: string;
  /**
   * A key was pressed that the game itself does not use. Return true if this feature took it.
   * Taken already: Space P T H C M B R F G X Z K L O U N J V Y I Comma Period Slash Enter Escape Backquote, digits 1 to 6, W S A D Q E, the arrows, and each boat's own control keys.
   */
  key?(code: string, shift: boolean): boolean;
  /** One fixed sim step, 1/60 s of game time. Runs many times a frame when time is speeded up. Keep it cheap. */
  step?(): void;
  /** Once a rendered frame, after the sim has stepped. `dt` is real seconds. `seaTime` is the time to pass to `stage.seaLevel`. */
  update?(dt: number, seaTime: number): void;
  /** A few words when this feature has something to say about what the boat is doing: "At anchor", "Ashore at Sam's". Shown on the readout and to the fleet. */
  status?(): string;
  /**
   * When this returns a point, the camera follows it instead of the boat and the sailing controls are switched off.
   * For when the player has left the boat, in the kayak for instance. Sim coordinates: x east, y north, heading compass radians.
   */
  focus?(): { x: number; y: number; heading: number; height: number } | null;
  /**
   * The player has hailed (Enter, then words). Return true if somebody this feature looks after heard it and will answer.
   * `withinHail` says who that would be, for the prompt in the hail box, or null when nobody is in range.
   */
  hail?(text: string): boolean;
  withinHail?(): string | null;
  /** A few short fields to tell the other boats along with this boat's position. Keys of two or three letters. */
  wire?(): Record<string, unknown>;
  /**
   * She has changed boats where she lies, for a race sailed in one class. `ctx.boatView` and `ctx.spec` are already the new ones.
   * Anything hung on the old boat's model has to be hung on the new one here.
   */
  reboat?(): void;
  dispose?(): void;
}
