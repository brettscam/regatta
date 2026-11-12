# Sailing Sim PRD

Nov 11, 2026 · @Brett Smith

## Summary

A realistic 3D sailing simulator that runs in the browser. You sail by handling the boat itself, in a world with real tides, real currents and weather replayed from history. The name is still open, so this doc uses "the game".

- **Players:** sailors and people learning to sail. Smithers and his sailing friends are the first testers
- **Purpose:** playing it should make you better on a real boat. Reading a forecast, timing a tide gate, trimming, reefing early, planning watches
- **First build:** one 38 ft sloop, San Francisco Bay and the Golden Gate, single player
- **After that:** more boats, the Baja Ha-Ha and other passages, then a shared multiplayer world

Decisions already made:

| Decision | Choice |
| --- | --- |
| View | Full 3D world with a free drone camera |
| Controls | Point at a part of the boat and scroll, or drag it. A key for every control. No side panels, no button rows |
| Look | Realistic water, sky and boat |
| First boat | Generic 38 ft ocean-ready sloop |
| Rig depth | Core controls first, full rig added one system at a time |
| Weather | Real history replayed, not live feeds |
| Where it gets built | Claude Code, from this doc |

An earlier 2D prototype, [Farallones Run](https://claude.ai/artifact/MchEDfRNZKL9y5PpkzpoU6), was rejected as the interface. Its sailing math (polar lookup, trim efficiency, heel and reef logic, two autopilot modes) is a usable starting point for the physics in milestone 1.

## Design pillars

Every feature has to pass these five rules. When two conflict, the lower number wins.

1. **Hands on the boat.** Every sailing action happens on a part of the boat: point at it and scroll, or drag it. If a feature needs a button on the screen, redesign the feature
2. **Real consequences.** Wind, tide, current and sea state come from real data and act the way they do on the water. Bad trim is slow. A missed tide gate costs hours
3. **The boat tells you.** Information lives where it lives on a real boat: telltales, the windex, mast displays, the chartplotter, the feel of the helm. Screen overlays are a backup the player can switch off
4. **Learn by doing.** No tutorial wall. A luffing sail looks and sounds like one. An optional coach explains what the boat is already showing
5. **Time is yours.** The game runs in real time. Pause, hand over to the autopilot and crew, come back tomorrow, or fast-forward if you choose. A crossing has to fit around a real life

## Core loop

A session runs in this order: read the forecast, set a course, then sail it at real-time speed. Real time is the default, so one hour of sailing takes one real hour unless the player chooses otherwise.

1. **Plan.** Pick a course and a start time. Open the forecast and see wind, current, tide and swell for the hours and days ahead. Then set the course by dropping waypoints on the chartplotter. For passages, also load provisions and set a watch schedule
2. **Sail.** Cast off and sail at real-time speed. Steer, trim and reef by hand as conditions change
3. **Hand over.** Engage the autopilot to follow the course and put crew on watch. Speeding up time is optional and never required
4. **Check in.** Alarms drop time back to normal speed when something needs you: a wind shift, rising wind, shallow water, a watch change, landfall
5. **Arrive.** Review your track against the fastest possible one, get a logbook entry, earn progress

Two session shapes have to work. A Bay sail is 20 to 40 minutes played mostly by hand. An ocean passage runs in real time by default, with the boat on autopilot and crew between check-ins. Fast-forward is there for players who want it.

## Camera and interaction

The player flies a drone around the boat and sails it by pointing at its parts and scrolling, or by dragging them. Nothing sits in a side panel.

**Camera**

- Drag on water or sky to orbit the boat. Scroll on water or sky, or pinch, to zoom from a winch close-up to a high aerial shot
- Two-finger drag or right-drag to pan. The camera keeps following the boat
- Double-click a part of the boat to fly to its working view: the helm, the mast base, the foredeck, the chart table below
- The horizon stays level. The camera never clips through sails or hull

**Controls, phase 1**

Hover and scroll is the primary control. Point at a part of the boat and roll the scroll wheel to work it. Dragging the same part does the same thing. Every control also has a key.

| Part you point at | Scroll | Drag | Key | What happens |
| --- | --- | --- | --- | --- |
| Wheel | Steer to port or starboard | Drag left or right | A and D, or left and right arrows | Turns the rudder. The wheel holds where you leave it |
| Boom | Mainsheet in or out | Drag the boom in or out | W and S | Sets sheet length. The wind fills the sail to that limit |
| Jib winch, either side | Trim or ease that sheet | Drag in to grind, out to ease | Q and E | Trims the jib on the working side |
| Furler | Roll the jib in or out | Drag along the foot of the jib |  | Any amount of jib, from full to none |
| Mast | Reef down or shake out | Drag the head of the main to a reef point | R, Shift+R | Reef 1, reef 2, or full main |
| Autopilot head | Change the held heading or wind angle | Drag its dial | P to engage or release | Holds a heading, a wind angle, or the route |
| Chartplotter | Zoom the chart once open | Drag waypoints | M | Full-screen chart for setting the course |
| Chart table |  |  | F | Opens the forecast |
| Engine lever | Throttle up or down | Drag forward or back |  | Motoring, for docking and calms |
| Water or sky | Zoom the camera | Orbit the camera | 1 to 4 for helm, mast, foredeck and drone views | Camera only, never touches the boat |
| Ship's clock |  |  | Space | Pause and resume |

- T tacks or gybes the boat, and the crew handles the sheets through the turn
- Scroll steps are small, and holding Shift makes them five times larger
- Scrolling never zooms the camera while the pointer is on a boat part

**Feedback**

- The part under the pointer glows, so it is always clear what a scroll will move
- While scrolling or dragging, a small tag at the pointer shows the one number that matters: rudder angle, sheet load, sail area
- Sails luff, flog and fill visibly. Telltales stream or stall. The boat heels and rounds up when overpowered
- Sound carries half the feedback: flogging cloth, winch clicks, water on the hull, wind in the rig

**What may sit on the screen**

- One small readout that mirrors the mast displays (speed, heading, wind, depth), so the numbers stay readable from drone height. The player can hide it
- A ship's clock in a corner for time. It runs in real time unless the player changes it. Click it to pause, drag it to fast-forward. This is the one overlay control, and it is an open question below
- Alarms appear as a short line of text and a sound, then fly the camera to the problem

Mouse and keyboard are equal. Anything a key does can also be done with the pointer on the boat. On touch, dragging replaces scrolling, so an iPad build stays possible.

## The boat

The first boat is a generic 38 ft ocean-ready sloop, modeled closely enough that a sailor recognizes every part.

**Baseline spec, approximate and open to tuning**

| Item | Value |
| --- | --- |
| Rig | Sloop, roller-furling jib, slab-reefed main with two reefs |
| Hull | Fin keel, spade rudder, wheel steering |
| Length overall | 38 ft (11.6 m) |
| Beam | About 12.5 ft (3.8 m) |
| Draft | About 6.5 ft (2.0 m) |
| Layout | Lines led aft to the cockpit, two primary winches, inboard diesel |

**Rig depth by phase**

| Phase | Systems the player can work |
| --- | --- |
| 1, core | Wheel, mainsheet, jib sheets, furler, two reefs, autopilot, engine |
| 2, sail shape | Traveler, vang, backstay, halyard tension, outhaul |
| 3, downwind | Asymmetric spinnaker, then symmetric with pole, guys and topping lift. Preventer |
| 4, seamanship | Anchoring, dock lines and fenders, dinghy |

Each phase adds controls that change how the boat sails, never decoration. Phase 2 controls only ship once the physics can reward them.

**How boats are built in code**

- A boat is a data file plus a 3D model. The data file holds dimensions, polar table, sail inventory, righting curve and the list of controls
- The model is glTF. Every interactive part is a named node (`wheel`, `boom`, `winch_port`, `furler`) so the input layer binds by name
- Sails are meshes shaped by trim values. Camber, twist and luffing come from the sim, with no full cloth simulation in phase 1
- Adding a boat means adding a data file and a model, with no new code

**The five-boat lineup, proposed**

| Boat | Role |
| --- | --- |
| 30 ft sloop | Starter, forgiving, Bay sailing |
| 38 ft sloop | First build, coastal and offshore |
| 45 ft performance cruiser | Faster, more sail to manage |
| 42 ft catamaran | No heel warning, reef by the numbers, charter style |
| 50 ft bluewater cruiser | Long passages, heavy weather |

These become real makes and models once polar data is secured for each. See open questions.

## The world

The water and weather are real data from a past date range, baked ahead of time and replayed. Nothing is fetched live during play, which keeps cost near zero and puts every player in the same conditions.

| Layer | What the player experiences | Source | Status |
| --- | --- | --- | --- |
| Tidal current | Water that moves, the boat set sideways, rips at the Gate | [NOAA SFBOFS](https://tidesandcurrents.noaa.gov/ofs/sfbofs/sfbofs_info.html), a 3D model of the Bay and its entrance with currents and water levels | Confirmed available. Hourly output [archived from 2014](https://www.ncei.noaa.gov/products/weather-climate-models/co-ops-operational-forecast), also [on AWS](https://docs.opendata.aws/noaa-ofs-pds/readme.html) |
| Tide height | Depth under the keel, shoals that cover and uncover | SFBOFS water levels, checked against [NOAA CO-OPS predictions](https://tidesandcurrents.noaa.gov/api/) | Confirmed available |
| Wind | Gusts, shifts, the afternoon build | ERA5 reanalysis, hourly from 1940, through the [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) | Available, but the grid is about 25 km, too coarse for the Bay |
| Waves and swell | Sea state outside the Gate | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Available |
| Depths and coastline | Land, bridges, shoals, channels | NOAA charts and bathymetry | To evaluate |
| Sky and light | Sun and moon by date and time, fog | Computed. Fog from visibility records later | Design only |

**Replay model**

- A season is a real past date range, for example one week in July 2024. The pipeline bakes that range into compact tiles
- The game clock maps to that range. Everyone in a session shares the clock and so shares the weather
- The forecast the player reads is the forecast that was issued at the time where an archive exists, otherwise the real outcome with error added. The forecast must be able to be wrong

**Known gaps**

- Bay wind needs local detail that a 25 km grid cannot give. Plan: a higher-resolution archive if one fits, otherwise terrain rules layered on the coarse data (the slot, wind shadows behind Angel Island and the headlands)
- Hourly data has no gusts. The sim adds gusts and short shifts on top, scaled to the hourly values
- Ocean passages need current data beyond the Bay model. To evaluate before the Ha-Ha milestone
- Open-Meteo's free tier is for non-commercial use. A commercial release pulls ERA5 from Copernicus directly

## Physics model

Phase 1 uses a polar-driven model with forces layered on for heel, leeway and helm. It is fast, predictable and already proven in the 2D prototype. A full force model replaces it when sail-shape controls arrive.

**Phase 1**

- Target speed comes from the boat's polar table at the current true wind angle and speed
- Each sail has a trim efficiency from how far its sheet is from ideal for the apparent wind. Eased too far and it luffs, sheeted too hard and it stalls
- Reefing lowers the effective wind the boat feels, which lowers heel faster than it lowers speed
- Heel comes from apparent wind, sail area and point of sail. Past about 20 degrees it costs speed. Past the limit the boat rounds up and overpowers the helm
- Leeway grows upwind and with heel
- The boat moves through the water and the water moves over the ground. Speed and heading through water differ from speed and course over ground, and the instruments show both
- Waves drive the visible motion of the hull and add resistance upwind. Wind against tide steepens the sea
- Depth under the keel is chart depth plus tide height minus draft. Touching bottom stops the boat

**Phase 2**

- Sail lift and drag, keel and rudder lift, and a righting-moment curve produce speed and heel directly
- The force model is tuned until it reproduces the polar, then the polar becomes a test instead of an input

**Engineering rules**

- The sim is a standalone module with no rendering code, on a fixed time step, fully deterministic. The same inputs always give the same track
- Determinism is what makes replays, ghosts and multiplayer fairness possible
- Time compression runs more steps per frame. Above a set rate the sim switches to a coarser passage step

**Tuning targets for the 38 ft sloop**

| Behavior | Target |
| --- | --- |
| Tacking angle | About 90 degrees through the wind |
| Top speed reaching in 15 to 20 kt | 7.5 to 8.5 kt |
| First reef upwind | Pays off at about 18 kt true |
| Second reef upwind | Pays off at about 24 kt true |
| Gate at max ebb | Current set matches the NOAA data for that hour |

## Passage systems

These are the systems a real skipper relies on, each reached through an object on the boat.

| System | Where it lives | What it does |
| --- | --- | --- |
| Chartplotter | Helm, and the chart table below | Chart with depths and current arrows. Set a course by dropping and dragging waypoints, then steer it yourself or hand it to the autopilot. Shows own track and laylines |
| Forecast | Chart table | Wind, current, tide and swell for the hours and days ahead, with a time scrubber. Open it before casting off and any time underway. Can be wrong |
| Tide book | Chart table | Tide heights and current times for the gates on the course |
| Autopilot | Control head at the helm | Hold heading, hold wind angle, or follow the route. Gives up when overpowered |
| Ship's clock | Corner of the screen | Real time by default. Pause any time. Optional fast-forward up to several hundred times |
| Alarms | Sound, a line of text, camera move | Wind shift, wind over a set speed, shallow water, off course, watch change, arrival. Any alarm drops time to normal speed |
| Watches | Crew list at the companionway | Roster, schedule, who is on deck |
| Provisions and tanks | Galley and tank gauges | Water, food, fuel, battery |
| Logbook | Chart table | Automatic entries plus the player's own notes |

**Crew and watches**

- Each crew member has a skill level and a fatigue level
- The crew on watch steers and trims to their skill. A tired or green crew is slow to react and misses shifts
- The player sets the schedule, for example three hours on and six off, and can take any watch personally
- Sailing solo is allowed and makes sleep the main problem to manage

**Provisions**

- Water, food and fuel are loaded before departure and used per person per day
- Running short raises fatigue and limits motoring. Kept simple in the first version

**Saving**

- The whole sim state saves at any moment. A passage resumes exactly where it stopped, on any device once accounts exist. On leaving, the player chooses to pause the world or to leave the boat sailing in real time under autopilot and crew

## Courses

San Francisco Bay ships first because its tides teach the most in the least distance. The Baja Ha-Ha is the first real passage.

| Order | Course | Distance, approximate | What it teaches |
| --- | --- | --- | --- |
| 1 | Central Bay: Sausalito, Angel Island, Alcatraz, the Gate | 10 to 25 nm | Tides, current gates, the slot wind, reefing |
| 2 | Golden Gate to Southeast Farallon and back | 52 nm | Ocean swell, the bar, fog, navigation out of sight of land |
| 3 | Baja Ha-Ha: San Diego to Cabo San Lucas with two stops | 750 nm | Passage planning, watches, provisions, downwind sailing |
| 4 | San Francisco to San Diego | 450 nm | Coastal passage, Point Conception, the delivery before the Ha-Ha |
| 5 | San Francisco to Hawaii | 2,100 nm | Trade winds, routing around the Pacific High |
| 6 | British Virgin Islands | Short hops | Catamaran handling, anchoring, line-of-sight pilotage |
| 7 | San Juan Islands | Short hops | Strong currents, tidal gates, rocks |
| Later | Croatia and the Med, Polynesia, around the world |  |  |

The [Baja Ha-Ha starts in San Diego](https://www.latitude38.com/lectronic/baja-ha-ha-xxxii-cruisers-rally-registration-opens-friday), not San Francisco, so the trip south from the Bay is its own course.

Each course is a data package: a region of baked world tiles, a set of marks or waypoints, a start window and a list of replay seasons. Adding a course adds data, with no new code.

## Progression and multiplayer

Progress comes from the logbook, the way it does in real sailing. Multiplayer arrives in four steps, each useful without the next.

**Progression**

- The logbook records miles, night hours, heavy-weather hours and passages completed
- Ratings modeled on real sailing certifications gate boats and courses: basic keelboat, coastal cruising, bareboat, offshore passage making
- Each rating has a practical test in the game, such as a man-overboard recovery or a night entry
- Regatta results unlock race events and faster boats
- No money or boat buying in the first version

**Multiplayer steps**

| Step | What players get | Needs |
| --- | --- | --- |
| 1. Ghosts | Sail the same course in the same replay week as friends and see their tracks. Leaderboard at the finish | Accounts, saved tracks |
| 2. Shared water | Friends' boats live in your world on a shared clock. Start-line racing | Game server, live sync |
| 3. Crew | Several players on one boat, each working a station | Shared boat state, roles |
| 4. Persistent world | Rallies and regattas on a calendar, fleets underway while you are offline | Always-on world clock |

**The clock problem**

Time compression and a shared world pull against each other. The working rule:

- Bay races run in real time for everyone
- Ocean events run on a published world clock, for example one sailing day per real hour, the same for all boats
- A player who is offline hands the boat to autopilot and crew, and it keeps sailing to their standing orders

The server owns the clock and the weather. Each client runs the sim for its own boat, and the server checks tracks against the same deterministic sim.

## Tech stack and architecture

A browser game in TypeScript and Three.js, with the sailing sim as a separate deterministic core and the world data baked offline.

&#91;embedded content: architecture · 6 parts\]

Player input and world data both feed the sim core. The renderer only draws what the sim reports, and the server later runs the same core to keep everyone honest.

| Part | Choice | Why |
| --- | --- | --- |
| Language and build | TypeScript, Vite | One language for client, sim and server |
| 3D | Three.js on WebGL2. Evaluate its WebGPU renderer for the ocean | Runs in any modern browser, large ecosystem |
| Ocean | Spectral or Gerstner wave shader with foam and wakes | Realistic water is the look the game depends on |
| Sky and light | Physical sky model, sun and moon by date, fog volumes | Time of day and San Francisco fog |
| Boat assets | glTF with named nodes, authored in Blender | Parts bind to controls by name |
| Sim core | Standalone TypeScript package, fixed step, runs in a Web Worker | Deterministic, testable, reusable on the server |
| Data pipeline | Python with xarray, reading NOAA NetCDF and reanalysis data | Bakes currents, tides, wind and depths into binary tiles |
| Tile hosting | Static files on a CDN | No live data cost during play |
| Server, from multiplayer on | Node with WebSockets, Postgres | Clock, sessions, accounts, saves, logbooks |
| Hosting | Vercel for the client, a small always-on host for the socket server | Vercel is already in use |
| Tests | Unit tests on the sim, golden-track regression tests, screenshot tests | Physics changes must not silently change how the boat sails |

**Repo layout**

- `packages/sim` for the sailing model, with no rendering or browser dependencies
- `packages/world` for tile loading and sampling of wind, current, tide and depth at a position and time
- `apps/client` for rendering, camera, input and sound
- `apps/server` for multiplayer, added at milestone 5
- `pipeline/` for the Python scripts that bake world tiles
- `boats/` and `courses/` for data files and models

**Instructions for Claude Code**

- Build milestone by milestone and stop at each gate for a play test
- Keep the sim free of rendering code from the first commit
- Never add an on-screen button for a sailing action. If a control seems to need one, raise it as a question
- Write the golden-track tests before changing physics

## Milestones

Six milestones in order. Each one ends at a play test, and the next does not start until the gate passes.

&#91;embedded content: roadmap · 6 milestones with gates\]

Milestones 1 to 3 are single player and need no server. Milestone 3 is the first version worth handing to friends.

**Gate tests in full**

| Milestone | The gate passes when |
| --- | --- |
| 1 | A sailor who has never seen the game beats upwind through three tacks using only the mouse on the boat, with no instructions |
| 2 | In 22 kt true, a reefed boat is measurably faster upwind than an unreefed one, and the player can tell why from the boat alone |
| 3 | At max ebb at the Gate, the boat's set and drift match the NOAA data for that hour within half a knot. The player can open the forecast, set a course on the chartplotter and sail it in real time |
| 4 | The Farallones round trip is completed across two separate sessions with crew on watch in between |
| 5 | Four friends race the same replay week and all see the same finish order |
| 6 | The Ha-Ha is completed with a crew, a watch schedule and provisions that ran neither out nor absurdly over |

**Milestone 1 acceptance, the first thing Claude Code builds**

- [ ] Realistic ocean with waves, a sky with sun position, 60 frames a second on a recent laptop
- [ ] 38 ft sloop model with hull, deck, mast, boom, main, jib, wheel and winches as named parts
- [ ] Drone camera: orbit, zoom, pan, double-click to fly to the helm
- [ ] Wheel, boom and jib sheets work by hover and scroll, by drag and by key, with a hover glow and a tag showing the value
- [ ] Sails fill, luff and flog according to trim, and the boat heels
- [ ] Steady wind with a visible direction on the water
- [ ] Sim core runs in its own package with unit tests against the polar
- [ ] No on-screen buttons for sailing actions

## Tabled and open questions

These are parked or undecided. The first four open questions have working answers, so milestone 1 can start.

**Tabled for now**

- Money, budgets and buying boats
- Fishing
- Live weather feeds
- Native mobile apps and VR

**Open questions**

- [ ] What is the game called? Working title for now: Slack Tide
- [ ] Where does the 38 ft sloop model come from: a licensed 3D model, a commissioned one, or built in Blender during milestone 1? For milestone 1: a placeholder sloop built in code with every part named, replaced by a proper model before milestone 3
- [ ] Is the ship's clock in the corner acceptable as the one overlay control for time, or should time live on an object on the boat? For now: the corner clock, real time by default
- [ ] Desktop browser only at first, or iPad from the start? For now: desktop first, with mouse, scroll and keyboard
- [ ] Just for friends, or a commercial release? This decides data licensing and hosting
- [ ] Which real makes and models are the five boats? ORC publishes polar tables on rating certificates, but its [terms of use](https://orc.org/offshore-racing-congress---website-terms-of-use) treat certificate data as ORC property, so using it needs a license or another source such as builder polars
- [ ] Which higher-resolution wind archive covers the Bay well enough, or do terrain rules on coarse data do the job?
- [ ] What world-clock rate suits shared ocean passages?
- [ ] How much of the crew is simulated people with names and skills, and how much is a simple setting?

## Sources

- [NOAA CO-OPS Data API](https://tidesandcurrents.noaa.gov/api/), tide and tidal current predictions
- [San Francisco Bay Operational Forecast System](https://tidesandcurrents.noaa.gov/ofs/sfbofs/sfbofs_info.html), model coverage and grid
- [NCEI archive of CO-OPS forecast systems](https://www.ncei.noaa.gov/products/weather-climate-models/co-ops-operational-forecast), SFBOFS output from 2014
- [NOAA OFS data on AWS](https://docs.opendata.aws/noaa-ofs-pds/readme.html)
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), ERA5 from 1940
- [Open-Meteo Marine Weather API](https://open-meteo.com/en/docs/marine-weather-api), waves and swell
- [ORC website terms of use](https://orc.org/offshore-racing-congress---website-terms-of-use)
- [Latitude 38 on the 2026 Baja Ha-Ha](https://www.latitude38.com/lectronic/baja-ha-ha-xxxii-cruisers-rally-registration-opens-friday)

Distances in the course table and the boat spec are approximate figures from general knowledge and should be checked when each course and boat is built.
