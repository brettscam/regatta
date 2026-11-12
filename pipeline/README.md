# World pipeline

Bakes real, archived data into the small files the game replays. Nothing here runs during play.

```bash
pip install netCDF4 numpy scipy matplotlib contourpy pillow
```

```bash
python3 pipeline/fetch_sfbofs.py /tmp/sfbofs
```

```bash
python3 pipeline/fetch_terrain.py /tmp/tiles
```

```bash
python3 pipeline/bake_sfbay.py /tmp/sfbofs /tmp/tiles courses/sf-bay
```

| Script | What it does |
| --- | --- |
| `fetch_sfbofs.py` | Downloads NOAA SFBOFS model output (about 55 MB an hour) from NOAA Open Data on AWS and keeps the surface current, water level and model wind for the region. Set the season with `FIRST_CYCLE`, `TRUTH_HOURS` and `FORECAST_HOURS` |
| `fetch_terrain.py` | Downloads Terrarium elevation tiles for the region from AWS Open Data |
| `bake_sfbay.py` | Writes `course.json`, `current.bin`, `depth.bin` and `terrain.bin` on flat local grids in metres from the course origin |

Notes for whoever extends this:

- The SFBOFS archive on AWS for 2024 holds forecast files only (`f000` to `f048` for the 03z, 09z, 15z and 21z cycles), with no separate nowcast. "What happened" is stitched from the first six hours of each cycle. "The forecast" is one whole cycle as issued, so it drifts from what happened, as a real forecast does
- The wind is the wind SFBOFS was driven with. It is real and hourly, but coarse. A finer archive such as HRRR (3 km, also on AWS) is the next step for the Bay's local wind
- The tidal stream the planner uses is the same field the boat sails in. Tides are predictable enough that this is what a real tide atlas gives you
- NOAA's tide prediction API and Open-Meteo were not reachable from the build machine, which is why everything comes from AWS Open Data
- Mark positions in `bake_sfbay.py` are approximate and should be checked against a chart
