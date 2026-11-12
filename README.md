# Slack Tide (working title)

A realistic 3D sailing simulator that runs in the browser. You sail by handling the boat itself: point at a part and scroll, or drag it. The full plan is in [docs/PRD.md](docs/PRD.md).

**Status: milestone 1 built and waiting on its play test, with the chart, forecast and tide pulled forward from milestone 3 at the owner's request.** One 38 ft sloop on Central San Francisco Bay, replaying NOAA's wind, tidal stream and tide from 14 and 15 July 2024.

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
| Autopilot head (aft cabin bulkhead) | Turns the heading or wind angle it holds | Drag its dial. Click it to change what it holds | P engages or releases. Shift+P changes what it holds |
| Water or sky | Zoom | Orbit. Right-drag or two fingers to pan | 1 helm, 2 mast, 3 foredeck, 4 drone |

- **T** tacks or gybes, and the crew swaps the jib sheets
- **Space** pauses. So does clicking the ship's clock. Drag the clock sideways to run time faster
- **Shift** makes scroll steps five times larger
- Double-click any part of the boat to fly to its working view
- **H** hides the instrument readout. The backquote key shows a frame-rate meter
- The wheel holds where you leave it. Until you first touch it, the boat holds her angle to the wind
- **M** opens the chart. So does clicking the chart preview in the corner. **Esc** closes it

The two jib sheets are separate, as on a real boat. Steer through the wind without touching them and the jib stays aback until you let the old sheet go and trim the new one.

What the boat tells you: the masthead vane points at the apparent wind, jib telltales lift on the windward side when the sail is starved and droop to leeward when it is stalled, the mast display shows speed, heading and apparent wind, and loose cloth looks and sounds loose.

## Autopilot

The pilot holds one of three things: a **heading**, a **wind angle**, or the **route**. While it steers, the crew trims the sails, so the boat sails herself. Touch the wheel and you have the helm back. Pick up a sheet and the crew leaves the trimming to you.

- **Route** steers for the next mark on the chart, crabbing across the tide so her course over ground stays on the mark. When each mark is reached it carries on to the next
- When the mark is to windward it sails close-hauled and tacks when the mark can be laid. It short-tacks away from shoal water rather than run up it
- It gives up when overpowered: a few seconds of losing to the helm and it hands the wheel back with an alarm
- It does not reef, avoid other vessels or look ahead for land on a reach. Keep a watch

## Sailing in company

Open the same link with someone else and each of you sees the other's boat, live. Everyone sails in one clock, so one wind and one tide: the page moves you up to whoever is furthest on, and pause and fast-forward are off while another boat is there. Nothing is stored. Close the page and your boat leaves the others' water.

This uses the claude.ai artifact room, so it only works on the published page, for people the page has been shared with who are signed in. A local `npm run dev` build is single-handed.

There is other traffic on the Bay too: ferries, a ship in the channel and a few sailboats. They show on the chart with their course and speed, and an alarm sounds when one will pass close.

## Instruments, chart and passage plan

- **Wind and tide dial** (top left): bow up. The solid pointer is where the apparent wind comes from, the hollow one the true wind, and the blue arrow is which way the tide is setting the boat. Underneath: true wind, height of tide and whether it is rising, and the stream at the boat. **H** hides all of it
- **Chart preview** (bottom right): the boat, her track, the route, and wind and stream at the boat
- **Chart** (**M**): click water to drop a waypoint, drag one to move it, double-click one to remove it. Each leg shows course, distance, forecast wind, fair or foul tide, speed over ground and planned arrival, worked out from the boat's polar and the forecast
- **Plan against actual**: the track sailed is drawn over the planned route, a dashed ring shows where the plan says the boat should be now, and each mark records planned and actual arrival
- **Forecast timeline** (under the chart): wind, tide height and the stream through the Golden Gate for the next day. Drag it to look ahead and the chart shows the forecast stream and wind for that time. Double-click it to come back to now
- **Alarms**: shallow water, aground and each mark reached. An alarm drops time back to real speed

Play-test options go in the address: `?start=20` begins 20 hours into the season instead of 2.5, and `?x=1300&y=250&hdg=293` sets the starting position in metres from the course origin and the heading.

## How it is built

```
packages/sim     The sailing model. No rendering, no browser APIs, fixed 1/60 s step, deterministic
packages/world   Wind, current, tide and depth at a place and time, replayed from a baked course package
packages/nav     Passage planning: leg times from polar and forecast, plan against actual
apps/client      Three.js rendering, drone camera, input, sound
boats/           Boat data files. sloop38.json holds dimensions, polar, sails, heel law and control bindings
courses/         Course data packages. sf-bay is baked from NOAA SFBOFS and open elevation data
pipeline/        Python scripts that bake them. See pipeline/README.md
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

## Beyond milestone 1, built early

- [x] Real wind, tidal stream, tide height, depth and coastline for the Central Bay, replayed (milestone 3)
- [x] Land and the Golden Gate Bridge in the 3D view, grounding in shallow water
- [x] Chartplotter with waypoints, passage plan, plan against actual, and a forecast that can be wrong (milestone 3)
- [x] Wind and tide dial on screen, two crew figures aboard
- [ ] Milestone 3 gate still open: set and drift at the Gate checked against NOAA within half a knot

- [x] Autopilot: heading, wind angle and route, with the crew trimming (milestone 3)
- [x] Shared water: other people's boats live in your world on one clock (multiplayer step 2, without accounts or a server)
- [x] Bay traffic, city and landmarks, and a more detailed boat

## Known gaps, on purpose

- The sim runs on the main thread. It is already isolated behind plain state and commands, so moving it into a Web Worker is mechanical, and it comes with the autopilot work in milestone 3
- Reef and furler are in the sim and its tests, but have no parts to point at yet. They arrive with milestone 2
- Waves do not break on the shore and the wind does not know about the hills. Wind shadows are milestone 3 work
- Gusts and shifts are added on top of the hourly model wind, as the PRD allows. They are not from data
- The crew are figures only. Skill, fatigue and watches are milestone 4
- The sloop is a placeholder built in code, to be replaced by a proper model before milestone 3
