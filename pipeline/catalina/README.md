# Long Beach to Catalina: the hand-written data

Three small scripts write the files that sit beside the bake in `courses/catalina/`. They hold the tables (where the
breakwater runs, where each platform stands, the paths of Avalon) and do the arithmetic that is tedious by hand: lane
corners from a centreline, the kelp lines from the baked coast, the seats round a table, way points graded so a
ship's smoothed track does not swing wide. Run each from the repository root with `.` as its argument.

| Script | Writes |
| --- | --- |
| `features.py` | `features.json`: traffic lanes, the gates, keep-clear rings, reserves, lights, structures, kelp beds |
| `towns.py` | `towns.json`: Avalon and Two Harbors as paths and named spots (`apps/client/src/scene/town.ts`) |
| `traffic.py` | `traffic.json`, and the races and the start routes that the breakwater and the platforms decide |

Everything in them is from general knowledge of the place, not from a chart: see the note at the top of `features.json`.

After any of them, and after a re-bake:

```bash
npx vite-node scripts/stamp.ts catalina        # breakwaters, platforms and islands into depth.bin; lumps out of terrain.bin
npx vite-node scripts/legs.ts catalina files   # marks, legs and traffic against the depth
npx vite-node scripts/shore.ts catalina        # venues and both towns against the land and the depth
```

`scripts/stamp.ts` also adds the two depth insets the course definition names that `bake.py` has not made yet
(`San Pedro breakwater`, `Beta field`), so a platform in open water is a 50 m cell and not a 200 m one.
