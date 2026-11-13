# Regatta

The game is called Regatta. The repo folder and package scope still say slack-tide, the earlier working title.

Browser sailing simulator. The plan is `docs/PRD.md`. Read it before starting a milestone.

## Standing rules from the PRD

- Build milestone by milestone. Stop at each gate for a play test. Do not start the next milestone until the user says the gate passed
- `packages/sim` has no rendering or browser code, ever. It must stay deterministic: fixed step, no `Math.random`, no clocks
- Never add an on-screen button for a sailing action. If a control seems to need one, raise it as a question
- Before changing physics, make sure the golden-track test exists and passes. After an intended change, run `npm run golden:update` and look at the diff
- Adding a boat or a course should add data, not code

## Commands

- `npm test` runs the sim, world and nav tests. `npm run typecheck` checks all packages. `npm run dev` serves the client
- `npx vite-node scripts/tune.ts` prints reef crossovers, speeds against the polar and the tacking angle

## Conventions that are easy to get wrong

- Sim: x east, y north, metres. Heading is compass radians, clockwise from north. Speeds in m/s, `KT` converts
- Every signed sim value is positive to starboard: rudder (turns the boat to starboard), heel (leans to starboard), boom and jib clew angle, leeway speed, and wind angles (wind on the starboard side)
- Client world: X east, Y up, Z south, so sim (x, y) maps to (x, 0, -y)
- Boat model frame: +X starboard, +Y up, -Z forward, origin on the waterline amidships. The boat's rotation is YXZ with y = -heading, x = pitch, z = -heel
- Jib sheets are stored as slack in radians, 0 is hard in. Mainsheet is the widest boom angle it allows
- Interactive parts are named nodes (`wheel`, `boom`, `winch_port`, `winch_stbd`, `furler`). Bindings live in the boat's JSON `controls` list

- The world is `ReplayWorld` in `packages/world`, fed by `courses/sf-bay` (baked by `pipeline/`, see its README). Session time is seconds since the session start. `startOffset` places it in the season
- Course coordinates are flat metres east and north of `course.origin`. Grids have row 0 at the southern edge
- Chart and planning live in `apps/client/src/ui/chart.ts` and `passage.ts`. The maths is in `packages/nav` and is tested there

- The autopilot's steering is in the sim (`helmMode` heading, wind or route, `setRoute`). The player-facing part is `apps/client/src/input/pilot.ts`. Pilot on means crew trimming on
- Shared water is `apps/client/src/net/fleet.ts`, built on the artifact runtime's `room` presence. It needs `capabilities: { room: {}, user: { scopes: ["profile"] } }` when publishing. Clocks agree by everyone moving up to the furthest-on boat with `world.shiftTime`
- Traffic positions are pure functions of session time, so every player sees the same vessels
- Wind is NOAA HRRR, stream and tide NOAA SFBOFS. The season runs 36 hours from 08:00 PDT on 14 July 2024. Start times offered on the join screen are in `courses/sf-bay/times.json`

- Entry is `main.ts` (boot and frame loop), `stage.ts` (scene everyone shares), `lobby.ts` plus `ui/join.ts` (the join screen), `session.ts` (one sail). `window.regatta` holds debug handles once a sail starts
- Boat display fields and the picker order live in `boats/*.json` and `boats/lineup.json`. `BoatView` takes a livery (topsides colour, transom name)

- The board (key B) is `ui/board.ts`: roadmap with votes, release notes, feedback form, logbook. The roadmap is `src/data/roadmap.json`, release notes `src/data/releases.json` (newest first). Every publish adds a note there: the newest note's id is what marks the "New" flag for returning players
- Votes, feedback and logbooks are in the artifact's `db` (`net/store.ts`, `net/logbook.ts`): `votes/<uid>`, `feedback/<uid>`, `profiles/<uid>`. Feedback is readable only by its sender and by editors. Writing needs Contributor access to the page
- Publishing needs `capabilities` with `room`, `user` (profile scope) and `db` with the six rules (votes, feedback, profiles, each with a `{self}` rule). Omitting `capabilities` on a republish carries them forward
- Feedback is copied to the Google Sheet "Regatta feedback" in the owner's Drive by hand for now (read `feedback` with ArtifactData, append rows). The page cannot post to Google itself
- Coaching hints are `ui/hints.ts`, gust look-ahead is `ui/gusts.ts`. Both only read the sim and the world
- A saved boat is only restored if `isSoundState` passes. `Sim.restore` fills fields a saved state lacks from a fresh state, so adding a field to `SimState` cannot break a boat handed across a republish
- Racing is `apps/client/src/race/` (`race.ts` the rules and the room protocol, `pace.ts` the autopilot pace boats) with the panel in `ui/fleetpanel.ts` (key R). Courses are data in `courses/sf-bay/races.json`: the first mark is the start. A race is announced through room presence (`rc` the call, `rj` joined, `rp` marks rounded, `rd` metres to go, `rf` finish time). Everything read from another boat's presence goes through `readCall` first
- Things to do aboard besides sailing are plug-ins: a class in `apps/client/src/aboard/` implementing `Feature` (`feature.ts`), listed in `aboard/index.ts`. The session calls the hooks (key, step, update, status, focus, wire). Anchoring and mooring are in the sim: `holdAt`, `release`, `state.hold`
- Anchoring, moorings, docks and the night aboard are `aboard/mooring.ts` (keys X and Z) with the pure decisions in `mooringRules.ts`. Crab pots (`pots.ts`, key K) and fishing (`fishing.ts`, key L) share the pure catch logic in `catch.ts`, which uses hashes, never `Math.random`, so tests can pin it. Client tests live in `apps/client/test/`
- A boat's held state is drawn by `BoatView` from `state.hold` (sails stowed, boom cover, rode or mooring line), so other players' boats and the pace boats show it too. It travels in presence as `hd`, `hx`, `hy`
- The platform seam is `apps/client/src/net/platform.ts`: the only place that asks for `room`, `db` and `user`. On claude.ai it returns the artifact capabilities; on the website (Vercel) it returns null and the UI says what is not available there yet
- Vercel builds from `apps/client` using `apps/client/vercel.json`, which installs from the workspace root. Production deploys from `main`
- The wind tunnel view (key F) is `aboard/flow.ts`. Its smoke lines are drawn from the sim's trim state (luff, stall, backed), not from a fluid solver
- `scripts/legs.ts` checks marks and legs against the depth chart before a course or place goes into the data
- The recorded weather is 36 hours. `world.wrapSeason` moves a session back a day when it reaches the end. Boats whose clock is past the end are not followed

## Status

Milestone 1 is built and waiting on its play test gate. At the owner's request, parts of milestone 3 were built early: the Bay replay (wind, stream, tide, depth, land), the chartplotter with passage planning and plan against actual, the forecast timeline, an on-screen wind and tide dial, crew figures, the autopilot, Bay traffic and scenery, shared water for sailing in company with hails, the roadmap and feedback board, coaching hints, gust warnings, racing with pace boats, anchoring and the wind tunnel view. The owner asked for these on-screen instruments directly, which overrides the PRD's lean toward keeping information on the boat. They hide with H.
