# World pipeline

Bakes real, archived data into the small files the game replays. Nothing here runs during play.

A place to sail is a course definition in `pipeline/courses/<id>.json`: its origin, the boxes to fetch and to chart, grid spacings, the tide model, the 36 hours to replay, the tide station and the named marks. Every script takes the course id first. There are two: `sf-bay` and `san-juans`.

```bash
pip install netCDF4 numpy scipy matplotlib contourpy pillow eccodes
```

```bash
python3 pipeline/fetch_ofs.py san-juans /tmp/sj/ofs
```

```bash
python3 pipeline/fetch_hrrr.py san-juans /tmp/sj/hrrr
```

```bash
python3 pipeline/fetch_terrain.py san-juans /tmp/sj/tiles
```

```bash
python3 pipeline/bake.py san-juans /tmp/sj/ofs /tmp/sj/tiles courses/san-juans /tmp/sj/hrrr
```

Then check the hand-written files beside the baked ones (starts, places, races, traffic) against the new depth:

```bash
npx vite-node scripts/legs.ts san-juans files
```

| Script | What it does |
| --- | --- |
| `course.py` | Reads a course definition and turns latitude and longitude into flat metres from its origin |
| `fetch_ofs.py` | Downloads NOAA tide model output from NOAA Open Data on AWS (SFBOFS, about 55 MB an hour; SSCOFS, about 210 MB an hour) and keeps the surface current, water level and model wind for the region. The season is `season.start` and `season.hours` in the definition |
| `fetch_hrrr.py` | Downloads 10 m wind and surface gust from NOAA's HRRR 3 km model, one analysis an hour for what happened and one 48 hour cycle for the forecast. It fetches only those three fields by byte range, about 3 MB an hour, and turns the grid-relative winds to true east and north |
| `fetch_terrain.py` | Downloads Terrarium elevation tiles for the region from AWS Open Data |
| `bake.py` | Writes `course.json`, `current.bin`, `depth.bin` and `terrain.bin` on flat local grids in metres from the course origin |

The San Francisco Bay bake is unchanged: `bake.py sf-bay` on the same downloads writes the same four files, byte for byte.

## San Juan Islands

| | |
| --- | --- |
| Chart | 48.42 N to 48.80 N, 123.26 W to 122.72 W: 39.6 km by 42 km. Origin 48.60 N, 123.00 W |
| Season | 36 hours from 08:00 PDT on 25 June 2025 (15z), a new moon spring tide with a southerly breeze |
| Tide and stream | SSCOFS, NOAA's Salish Sea and Columbia River Operational Forecast System (FVCOM), hourly nowcast fields |
| Grids | Stream 300 m (133 by 141, 37 hours), depth 100 m (397 by 421), terrain 100 m (477 by 501), wind 2 km (21 by 22) |
| Tide station | Friday Harbor: the model node nearest NOAA station 9449880 |

What is different from the Bay, and why:

- SSCOFS has been on AWS since November 2024, as nowcast fields only (`fields.n001` to `n006` for the six hours up to each 03z, 09z, 15z and 21z cycle). "What happened" is those. There are no forecast fields, so the forecast tide is read from the first cycle's `stations.forecast.nc` at the model station nearest Friday Harbor. In `model.archive` this is `"nowcast"`; the Bay's is `"forecast"`
- The elevation tiles cannot say where the shore is here. Between the islands their sea is coarse bathymetry that rings above zero, which closed half the passes. So `"landFrom": "model"`: water is wherever the tide model has water, and land is ground above half a metre that the model does not cover. The model's mesh is 130 to 250 m in the passes. Water outside the mesh (small coves) is baked as a 0.6 m shoal
- The stream grid is coarser than the Bay's (300 m against 200 m) because the chart is four times the area. `"currentReach": 1` lets a grid cell whose centre just misses the model's water take the nearest element's stream, so a pass two cells wide keeps its rate
- Depths are below the model datum, close to mean sea level, as on the Bay. The tide here falls 1.9 m below it, so legs are checked for 4 m at the lowest water, not 4 m charted
- Parts of Canada at the western and north-western edges (Saturna, the Penders, Sidney Island, the Chatham Islands) come out low or missing in the tiles. They are outside the sailing ground

## Notes for whoever extends this

- The SFBOFS archive on AWS for 2024 holds forecast files only (`f000` to `f048` for the 03z, 09z, 15z and 21z cycles), with no separate nowcast. "What happened" is stitched from the first six hours of each cycle. "The forecast" is one whole cycle as issued, so it drifts from what happened, as a real forecast does
- The wind is HRRR's, at 3 km. On the Bay it shows the morning calm, the afternoon build, lighter air outside the Gate and in the lee of the hills, and gusts. It does not resolve the narrowest features, such as the acceleration right under the bridge, or the lee of a single island
- Gusts in the game are a moving pattern whose strength is set by HRRR's gust speed over its mean wind for that hour and place. The timing of individual puffs is not from data
- The tidal stream the planner uses is the same field the boat sails in. Tides are predictable enough that this is what a real tide atlas gives you
- NOAA's tide prediction API, Open-Meteo and OpenStreetMap's Overpass were not reachable from the build machine, which is why everything comes from AWS Open Data
- Mark positions in the course definitions are approximate and should be checked against a chart
- netCDF and GRIB reading are not safe from several threads at once. The fetch scripts download side by side and read one at a time
- To choose a season for a new place, look for a day with the tide and wind you want before fetching: the models' `stations.forecast.nc` files are small and give the tide and stream at named stations, and HRRR analyses can be sampled at a few points by byte range
