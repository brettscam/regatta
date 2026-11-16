"""Download the sea state for a course's season from NOAA's GFS wave model (WAVEWATCH III), from NOAA Open Data on AWS.

Reads the US West Coast grid (0.16 degrees, about 10 nautical miles) at the point a course names under "sea", hourly:
the analysis and first five forecast hours of each six-hourly run. Writes one small JSON of series: the combined sea,
the wind sea, and the two largest swell trains, each as height (m), period (s) and the direction it comes from.

Usage: python3 fetch_wave.py <course> <work dir> [<course folder>]
"""
import datetime as dt
import json
import os
import subprocess
import sys

import eccodes as ec
import numpy as np

import course as courses

BUCKET = "https://s3.amazonaws.com/noaa-gfs-bdp-pds"
# Fields are told apart by their place in the file's index: the swell partitions share one name inside the file.
FIELDS = {
    "HTSGW:surface": "height", "PERPW:surface": "peakPeriod", "DIRPW:surface": "peakFrom",
    "WVHGT:surface": "windSeaHeight", "WVPER:surface": "windSeaPeriod", "WVDIR:surface": "windSeaFrom",
    "SWELL:1 in sequence": "swell1Height", "SWPER:1 in sequence": "swell1Period", "SWDIR:1 in sequence": "swell1From",
    "SWELL:2 in sequence": "swell2Height", "SWPER:2 in sequence": "swell2Period", "SWDIR:2 in sequence": "swell2From",
}


def curl(args):
    return subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "180", *args], check=True, capture_output=True)


def read(c, work: str, cycle: dt.datetime, fh: int) -> dict:
    url = f"{BUCKET}/gfs.{cycle:%Y%m%d}/{cycle:%H}/wave/gridded/gfswave.t{cycle:%H}z.wcoast.0p16.f{fh:03d}.grib2"
    raw = os.path.join(work, f"{cycle:%Y%m%d%H}.f{fh:03d}.grib2")
    if not os.path.exists(raw):
        curl(["-o", raw, url])
        curl(["-o", raw + ".idx", url + ".idx"])
    names = [":".join(line.split(":")[3:5]) for line in open(raw + ".idx").read().splitlines()]
    lat0, lon0 = c.spec["sea"]["at"]
    out = {}
    with open(raw, "rb") as f:
        for name in names:
            g = ec.codes_grib_new_from_file(f)
            if name in FIELDS:
                vals = ec.codes_get_values(g)
                lat = ec.codes_get_array(g, "latitudes")
                lon = ec.codes_get_array(g, "longitudes")
                lon = np.where(lon > 180, lon - 360, lon)
                missing = ec.codes_get(g, "missingValue")
                ok = (vals != missing) & np.isfinite(vals)
                away = np.where(ok, (lat - lat0) ** 2 + ((lon - lon0) * 0.79) ** 2, 1e9)
                i = int(np.argmin(away))
                out[FIELDS[name]] = round(float(vals[i]), 2) if away[i] < 0.5 ** 2 else None
                out["lat"], out["lon"] = round(float(lat[i]), 3), round(float(lon[i]), 3)
            ec.codes_release(g)
    return out


if __name__ == "__main__":
    c = courses.load(sys.argv[1])
    work = sys.argv[2]
    os.makedirs(work, exist_ok=True)
    hours = []
    for h in range(c.truth_hours + 1):
        valid = c.first_cycle + dt.timedelta(hours=h)
        cycle = valid.replace(hour=valid.hour - valid.hour % 6)
        hours.append(read(c, work, cycle, valid.hour % 6))
    def train(h, key):
        vals = [h.get(f"{key}Height"), h.get(f"{key}Period"), h.get(f"{key}From")]
        return None if any(v is None for v in vals) else [vals[0], round(vals[1], 1), round(vals[2])]

    recorded = {
        "source": "NOAA GFS wave model (WAVEWATCH III), US West Coast grid at 0.16 degrees: the analysis and first five forecast hours of each six-hourly run. NOAA Open Data on AWS.",
        "at": {"lat": hours[0]["lat"], "lon": hours[0]["lon"], "name": c.spec["sea"]["name"]},
        "start": f"{c.first_cycle:%Y-%m-%dT%H:%M:%SZ}",
        "stepSeconds": 3600,
        "height": [h["height"] for h in hours],
        "windSea": [train(h, "windSea") for h in hours],
        "swell1": [train(h, "swell1") for h in hours],
        "swell2": [train(h, "swell2") for h in hours],
    }
    # With a course folder as the third argument, the record goes into its sea.json beside whatever is written there by hand.
    if len(sys.argv) > 3:
        path = os.path.join(sys.argv[3], "sea.json")
        sea = json.load(open(path)) if os.path.exists(path) else {}
        sea["recorded"] = recorded
        with open(path, "w") as f:
            f.write("{\n" + ",\n".join(f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in sea.items()) + "\n}\n")
        print(f"{len(hours)} hours of sea state in {path}")
    else:
        with open(os.path.join(work, "sea.json"), "w") as f:
            json.dump(recorded, f)
        print(f"{len(hours)} hours of sea state in {work}/sea.json")
