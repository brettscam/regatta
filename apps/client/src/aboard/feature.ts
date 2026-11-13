import type { Sim } from '@slack-tide/sim';
import type { ReplayWorld } from '@slack-tide/world';
import type { BoatView, Livery } from '../boat/boatView';
import type { YardBoat } from '../boat/yard';
import type { DroneCamera } from '../camera/drone';
import type { Logbook } from '../net/logbook';
import type { RemoteBoat } from '../net/fleet';
import type { Place } from '../session';
import type { Stage } from '../stage';
import type { Hud } from '../ui/hud';
import type { Passage } from '../ui/passage';

/** What a feature is handed to work with. Everything a feature needs from the game comes through here. */
export interface AboardContext {
  sim: Sim;
  world: ReplayWorld;
  /** The shared scene: `stage.scene` to add meshes to, `stage.seaLevel(x, z, seaTime)` for the height of the water. */
  stage: Stage;
  hud: Hud;
  passage: Passage;
  boatView: BoatView;
  drone: DroneCamera;
  spec: YardBoat;
  livery: Livery;
  skipper: string;
  places: Place[];
  logbook: Logbook;
  /** A passing remark at the bottom of the screen. */
  say(text: string, seconds?: number): void;
  /** Something that needs the player. Also drops time back to real speed. */
  alarm(text: string): void;
  /** True while other people's boats are on the water. The clock is shared then, so time cannot be skipped. */
  sharing(): boolean;
  /** The other people's boats here now. */
  company(): RemoteBoat[];
  /** Seconds into the recorded season, now. */
  seasonNow(): number;
  /** True while a key is held down, by its KeyboardEvent.code. */
  held(code: string): boolean;
  /** Another feature, by id, for the few cases where one depends on another. */
  feature<T extends Feature>(id: string): T | undefined;
}

/**
 * Something to do aboard besides sailing: anchoring, fishing, taking the outrigger ashore.
 * Each one is a class in this folder that implements this, listed in `index.ts`. The session calls the hooks.
 * Rule from the PRD: no on-screen button for an action on the boat. Keys, and words on the screen that say what happened.
 */
export interface Feature {
  readonly id: string;
  /**
   * A key was pressed that the game itself does not use. Return true if this feature took it.
   * Taken already: Space P T H C M B R F X Z Enter Escape Backquote, digits 1 to 4, W S A D Q E, the arrows, and each boat's own control keys.
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
   * For when the player has left the boat, in the outrigger for instance. Sim coordinates: x east, y north, heading compass radians.
   */
  focus?(): { x: number; y: number; heading: number; height: number } | null;
  /** A few short fields to tell the other boats along with this boat's position. Keys of two or three letters. */
  wire?(): Record<string, unknown>;
  dispose?(): void;
}
