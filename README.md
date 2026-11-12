# Slack Tide (working title)

A realistic 3D sailing simulator that runs in the browser. You sail by handling the boat itself: point at a part and scroll, or drag it. The full plan is in [docs/PRD.md](docs/PRD.md).

**Status: milestone 1 built, waiting on its play test.** One 38 ft sloop, open water, one steady wind, single player.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints (http://localhost:5173 by default).

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Sim unit tests, PRD tuning targets, golden-track regression |
| `npm run typecheck` | Type-check every package |
| `npm run build` | Production build of the client into `apps/client/dist` |
| `npm run build:single -w @slack-tide/client` | One self-contained HTML file in `apps/client/dist-single`, for sharing a play-test build |
| `npm run golden:update` | Re-record the golden track after an intended physics change |
| `npx vite-node scripts/tune.ts` | Print steady-state speeds, heel and reef crossovers for tuning |

## Sailing her

Hover and scroll is the main control. Dragging the same part does the same thing, and every control has a key. There are no on-screen buttons for sailing.

| Point at | Scroll | Drag | Key |
| --- | --- | --- | --- |
| Wheel | Up or right steers to starboard, down or left to port | Drag the rim | A and D, or left and right arrows |
| Boom | Up hauls the mainsheet in, down eases | Drag the boom in or out | W in, S out |
| Jib winch, either side | Up trims that sheet, down eases it | Toward the centreline grinds, outward eases | Q trims the leeward sheet, E eases the loaded one |
| Water or sky | Zoom | Orbit. Right-drag or two fingers to pan | 1 helm, 2 mast, 3 foredeck, 4 drone |

- **T** tacks or gybes, and the crew swaps the jib sheets
- **Space** pauses. So does clicking the ship's clock. Drag the clock sideways to run time faster
- **Shift** makes scroll steps five times larger
- Double-click any part of the boat to fly to its working view
- **H** hides the instrument readout. The backquote key shows a frame-rate meter
- The wheel holds where you leave it. Until you first touch it, the boat holds her angle to the wind

The two jib sheets are separate, as on a real boat. Steer through the wind without touching them and the jib stays aback until you let the old sheet go and trim the new one.

What the boat tells you: the masthead vane points at the apparent wind, jib telltales lift on the windward side when the sail is starved and droop to leeward when it is stalled, the mast display shows speed, heading and apparent wind, and loose cloth looks and sounds loose.

Play-test options go in the address: `?wind=18&from=250&hdg=300&time=2024-07-15T01:00:00Z` sets wind speed in knots, wind direction, starting heading, and the date and time that place the sun.

## How it is built

```
packages/sim     The sailing model. No rendering, no browser APIs, fixed 1/60 s step, deterministic
packages/world   Wind and current at a place and time. Milestone 1: one steady wind
apps/client      Three.js rendering, drone camera, input, sound
boats/           Boat data files. sloop38.json holds dimensions, polar, sails, heel law and control bindings
courses/         Course data packages, from milestone 3
pipeline/        Python scripts that bake world tiles, from milestone 3
docs/PRD.md      The product plan
```

- **The sim knows nothing about drawing.** The client reads its state and outputs and draws them. The server will run the same code later
- **Controls bind by name.** Each entry in a boat's `controls` list names a node in the model and a sim control. The placeholder sloop is built in code (`apps/client/src/boat/buildSloop.ts`) with the same node names a glTF model will carry
- **One sea for eyes and hull.** `apps/client/src/scene/waves.ts` describes the waves once. The water shader draws them and the boat rides them
- **Physics, phase 1.** Target speed comes from the polar. Trim efficiency, reefing, heel, leeway, weather helm, rudder drag and a backed jib are layered on top. Constants live in the boat file, and the tests pin the PRD's tuning targets

## Milestone 1 checklist

- [x] Ocean with waves, sky with the sun placed by date, time and position
- [x] 38 ft sloop with hull, deck, mast, boom, main, jib, wheel and winches as named parts
- [x] Drone camera: orbit, zoom, pan, double-click to fly to the helm
- [x] Wheel, boom and jib sheets by hover and scroll, by drag and by key, with a hover glow and a value tag
- [x] Sails fill, luff and flog with trim, and the boat heels
- [x] Steady wind with a visible direction on the water
- [x] Sim core in its own package with unit tests against the polar
- [x] No on-screen buttons for sailing actions
- [ ] 60 frames a second on a recent laptop: needs checking on real hardware (backquote key shows the meter)
- [ ] The gate: a sailor who has never seen the game beats upwind through three tacks using only the mouse, with no instructions

## Known gaps, on purpose

- The sim runs on the main thread. It is already isolated behind plain state and commands, so moving it into a Web Worker is mechanical, and it comes with the autopilot work in milestone 3
- Reef and furler are in the sim and its tests, but have no parts to point at yet. They arrive with milestone 2
- No land, no tide, no current, no gusts. Those are milestone 3
- The sloop is a placeholder built in code, to be replaced by a proper model before milestone 3
