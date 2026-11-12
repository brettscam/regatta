# Slack Tide

Browser sailing simulator. The plan is `docs/PRD.md`. Read it before starting a milestone.

## Standing rules from the PRD

- Build milestone by milestone. Stop at each gate for a play test. Do not start the next milestone until the user says the gate passed
- `packages/sim` has no rendering or browser code, ever. It must stay deterministic: fixed step, no `Math.random`, no clocks
- Never add an on-screen button for a sailing action. If a control seems to need one, raise it as a question
- Before changing physics, make sure the golden-track test exists and passes. After an intended change, run `npm run golden:update` and look at the diff
- Adding a boat or a course should add data, not code

## Commands

- `npm test` runs the sim tests. `npm run typecheck` checks all packages. `npm run dev` serves the client
- `npx vite-node scripts/tune.ts` prints reef crossovers, speeds against the polar and the tacking angle

## Conventions that are easy to get wrong

- Sim: x east, y north, metres. Heading is compass radians, clockwise from north. Speeds in m/s, `KT` converts
- Every signed sim value is positive to starboard: rudder (turns the boat to starboard), heel (leans to starboard), boom and jib clew angle, leeway speed, and wind angles (wind on the starboard side)
- Client world: X east, Y up, Z south, so sim (x, y) maps to (x, 0, -y)
- Boat model frame: +X starboard, +Y up, -Z forward, origin on the waterline amidships. The boat's rotation is YXZ with y = -heading, x = pitch, z = -heel
- Jib sheets are stored as slack in radians, 0 is hard in. Mainsheet is the widest boom angle it allows
- Interactive parts are named nodes (`wheel`, `boom`, `winch_port`, `winch_stbd`, `furler`). Bindings live in the boat's JSON `controls` list

## Status

Milestone 1 is built and waiting on its play test gate.
