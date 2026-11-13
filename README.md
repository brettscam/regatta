# Regatta

A realistic 3D sailing simulator that runs in the browser. You sail by handling the boat itself: point at a part and scroll, or drag it. The full plan is in [docs/PRD.md](docs/PRD.md).

**Status: milestone 1 built and waiting on its play test, with the chart, forecast and tide pulled forward from milestone 3 at the owner's request.** One 38 ft sloop on Central San Francisco Bay, replaying NOAA's wind (HRRR, 3 km), tidal stream and tide (SFBOFS) from 08:00 on 14 July 2024 for 36 hours.

## The way in

Opening the game asks three things, with the real water behind the panel showing each choice as it is made:

1. **Where**: four starts on the Central Bay, each with its own route and the wind and stream there right now
2. **First sail**: an optional lesson. One prompt at a time, each ticked off by doing it: look around, find the wind, take the wheel, trim the main, trim the jib, tack, hand over to the pilot, open the chart. Every control works throughout and it can be ended at any point
3. **Your boat**: a 30 ft sloop, the 38, or a 45 ft performance cruiser, with a name for the transom and a colour for the topsides. In company, the others see your boat as you fitted her out

Starts are data in `courses/sf-bay/starts.json`. Boats are data files in `boats/`, listed in `boats/lineup.json`. For play testing, `?go=1` skips the join screen, with `&spot=gate&boat=perf45&tutorial=1` to choose.

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

## Gybing

Let the boom come across on its own with the main eased and the wind up, and it lands hard. How hard depends on how far it swings, how much wind there is and how much main is up: a lurch and a round-up in a moderate breeze, a knockdown from about 19 kt true with a full main let right out. She is a keelboat, so she comes back up, stopped and head to wind. Haul the main in before the stern goes through the wind and the same gybe is gentle. `T` has the crew tend the sheet, and so does having the pilot on.

## Sailing in company

Open the same link with someone else and each of you sees the other's boat, live. Everyone sails in one clock, so one wind and one tide: the page moves you up to whoever is furthest on, and pause and fast-forward are off while another boat is there. Nothing is stored. Close the page and your boat leaves the others' water.

This uses the claude.ai artifact room, so it only works on the published page, for people the page has been shared with who are signed in. A local `npm run dev` build is single-handed.

There is other traffic on the Bay too: ferries, a ship in the channel and a few sailboats. They show on the chart with their course and speed, and an alarm sounds when one will pass close.

## Racing

Press R for the fleet and racing panel. It lists who is on the water with you, and lets anyone call a race: pick a course (Raccoon Strait to McCovey Cove, Round Alcatraz, the Golden Gate dash, or the route on your own chart), the minutes to the gun, and how many pace boats. Everyone on the water is told and joins with R. The first mark is the start: be there at the gun and pass it after. The bar under the clock counts down, then shows your time and place. Pace boats are full sims on the autopilot, in the same boat as the caller, each a little off the pace. Courses are data in `courses/sf-bay/races.json`.

## Stopping, and catching supper

- **X** stops her: on her own anchor (under 2 kt, in up to 25 m), or on a mooring or alongside a dock when she is within 90 m of one and under 2.5 kt. Her sails stow and she lies to the wind and tide. X again gets her under way
- **Z**, while held and alone on the water, turns in for the night and wakes at 06:30
- **K** drops a crab pot with a buoy in her colours (up to three). Back alongside the buoy, K hauls it. Pots fill over about an hour
- **O**, while held, launches the outrigger. Paddle with W A S D on the tide, O lands her on a beach or at one of the named places, O alongside the boat comes back aboard
- **U** calls for a tow to deep water when she is aground
- **L** puts a fishing line out. Trolling and bottom fishing find different fish in different water. When one is on, L strikes

## Two homes

The same code is published two ways. On claude.ai it is a single-file Artifact (`npm run build:single -w @slack-tide/client`, then `node scripts/make-artifact.mjs`) with shared water, votes, feedback and logbooks from the Artifact runtime. On Vercel it is the ordinary Vite build, single-player until a backend is chosen; `apps/client/src/net/platform.ts` is the seam a backend plugs into.

## The wind tunnel

Press F. Smoke lines run with the apparent wind past the sails at four heights: pale and smooth where the air follows the sail, red and broken behind a sail sheeted too hard, grey and shaking past one that is luffing. A card puts numbers to it, and turns the trim rule round to say what apparent wind angle the sails as set are asking for, so you can either steer to the sails or trim to the course.

## Roadmap, release notes and feedback

Press B, or click Roadmap · Feedback at the bottom left.

- **Roadmap**: what is planned, grouped in releases, with a vote up or down on each item. It is data in `apps/client/src/data/roadmap.json`
- **What's new**: release notes, newest first, in `apps/client/src/data/releases.json`. A returning player sees a New marker until they have read the latest
- **Feedback**: a note, a problem or an idea, sent from the boat. It can attach what the boat was doing at the time
- **Logbook**: miles, hours, marks and knockdowns for this skipper, and the fleet's

Votes, feedback and logbooks are kept in the published page's database, so they need the page shared with the player as a contributor. Feedback is readable only by its sender and by the page's editors, and is copied to a Google Sheet for triage.

## Coaching and gusts

- The readout names the point of sail and the tack, and shows a gust on its way with the seconds until it arrives, or that she is in a gust or a lull
- A strong gust raises an alert and drops time back to real speed
- Coaching hints (C turns them off) say one line when a sail has been luffing or stalled for a while, the jib is aback, she is in irons or overpowered, or the other tack would lay the mark

## Instruments, chart and passage plan

- **Wind and tide dial** (top left): bow up. The solid pointer is where the apparent wind comes from, the hollow one the true wind, and the blue arrow is which way the tide is setting the boat. Underneath: true wind, height of tide and whether it is rising, and the stream at the boat. **H** hides all of it
- **Chart preview** (bottom right): the boat, her track, the route, and wind and stream at the boat
- **Chart** (**M**): click water to drop a waypoint, drag one to move it, double-click one to remove it. Each leg shows course, distance, forecast wind, fair or foul tide, speed over ground and planned arrival, worked out from the boat's polar and the forecast
- **Plan against actual**: the track sailed is drawn over the planned route, a dashed ring shows where the plan says the boat should be now, and each mark records planned and actual arrival
- **Forecast timeline** (under the chart): wind, tide height and the stream through the Golden Gate for the next day. Drag it to look ahead and the chart shows the forecast stream and wind for that time. Double-click it to come back to now
- **Alarms**: shallow water, aground and each mark reached. An alarm drops time back to real speed

Play-test options go in the address: `?go=1` skips the join screen, `?start=20` begins 20 hours into the season instead of 2.5, and `?x=1300&y=250&hdg=293` sets the starting position in metres from the course origin and the heading.

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
- Gust strength comes from the model's gust speed. When each puff arrives does not
- The crew are figures only. Skill, fatigue and watches are milestone 4
- The sloop is a placeholder built in code, to be replaced by a proper model before milestone 3
