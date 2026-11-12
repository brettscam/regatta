# Slack Tide

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

## Status

Milestone 1 is built and waiting on its play test gate. At the owner's request, parts of milestone 3 were built early: the Bay replay (wind, stream, tide, depth, land), the chartplotter with passage planning and plan against actual, the forecast timeline, an on-screen wind and tide dial, crew figures, the autopilot, Bay traffic and scenery, and shared water for sailing in company. The owner asked for these on-screen instruments directly, which overrides the PRD's lean toward keeping information on the boat. They hide with H.
