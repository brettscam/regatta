"""Download 10 m wind and surface gust from NOAA's HRRR model (3 km) for the season, from NOAA Open Data on AWS.

HRRR is NOAA's High-Resolution Rapid Refresh. Each hourly file is about 150 MB, but its index lists where every field
sits, so only the three fields needed are fetched, about 3 MB an hour.

  - "What happened" is the analysis (f00) of each hourly cycle.
  - "The forecast" is one long cycle as issued before the season starts.

HRRR winds are stored relative to its map grid. They are turned to true east and north here.

Usage: python3 fetch_hrrr.py <work dir>
"""
import concurrent.futures as cf
import datetime as dt
import math
import os
import re
import subprocess
import sys

import eccodes as ec
import numpy as np

from fetch_sfbofs import FIRST_CYCLE, TRUTH_HOURS

BUCKET = "https://s3.amazonaws.com/noaa-hrrr-bdp-pds"
BOX = dict(lon0=-122.75, lon1=-122.18, lat0=37.66, lat1=38.02)
# The 12z cycle runs 48 hours and is out before anyone casts off.
FORECAST_CYCLE = dt.datetime(2024, 7, 14, 12)
FORECAST_HOURS = 48
# HRRR's Lambert conformal grid: cone constant for a 38.5 degree standard parallel, central meridian 97.5 W.
CONE = math.sin(math.radians(38.5))
CENTRAL_LON = -97.5
FIELDS = [r":UGRD:10 m above ground:", r":VGRD:10 m above ground:", r":GUST:surface:"]


def curl(args):
    return subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "180", *args], check=True, capture_output=True)


def fetch(cycle: dt.datetime, fh: int, dest: str) -> str:
    if os.path.exists(dest):
        return f"have {os.path.basename(dest)}"
    url = f"{BUCKET}/hrrr.{cycle:%Y%m%d}/conus/hrrr.t{cycle:%H}z.wrfsfcf{fh:02d}.grib2"
    idx = curl([url + ".idx"]).stdout.decode().splitlines()
    out = {}
    for pattern, key in zip(FIELDS, ["u", "v", "gust"]):
        i = next(n for n, line in enumerate(idx) if re.search(pattern, line))
        a = int(idx[i].split(":")[1])
        b = int(idx[i + 1].split(":")[1]) - 1
        raw = dest + f".{key}.grib2"
        curl(["-r", f"{a}-{b}", "-o", raw, url])
        with open(raw, "rb") as f:
            g = ec.codes_grib_new_from_file(f)
            vals = ec.codes_get_values(g)
            if "keep" not in out:
                lat = ec.codes_get_array(g, "latitudes")
                lon = ec.codes_get_array(g, "longitudes")
                lon = np.where(lon > 180, lon - 360, lon)
                out["keep"] = (lat > BOX["lat0"]) & (lat < BOX["lat1"]) & (lon > BOX["lon0"]) & (lon < BOX["lon1"])
                out["lat"] = lat[out["keep"]]
                out["lon"] = lon[out["keep"]]
            ec.codes_release(g)
        out[key] = vals[out["keep"]]
        os.remove(raw)
    # Grid-relative to earth-relative.
    a = np.radians(CONE * (out["lon"] - CENTRAL_LON))
    east = np.cos(a) * out["u"] + np.sin(a) * out["v"]
    north = -np.sin(a) * out["u"] + np.cos(a) * out["v"]
    np.savez_compressed(dest, lat=out["lat"], lon=out["lon"], u=east.astype("f4"), v=north.astype("f4"), gust=out["gust"].astype("f4"))
    return f"got  {os.path.basename(dest)}"


def truth_path(work: str, h: int) -> str:
    return os.path.join(work, f"analysis.{h:03d}.npz")


def forecast_path(work: str, h: int) -> str:
    return os.path.join(work, f"forecast.{h:03d}.npz")


def forecast_lead() -> int:
    """Hours between the forecast cycle and the start of the season."""
    return int((FIRST_CYCLE - FORECAST_CYCLE).total_seconds() // 3600)


def forecast_span() -> int:
    """Season hours the forecast covers."""
    return FORECAST_HOURS - forecast_lead()


if __name__ == "__main__":
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    jobs = []
    for h in range(TRUTH_HOURS + 1):
        valid = FIRST_CYCLE + dt.timedelta(hours=h)
        jobs.append((valid, 0, truth_path(work, h)))
    for h in range(forecast_span() + 1):
        jobs.append((FORECAST_CYCLE, forecast_lead() + h, forecast_path(work, h)))
    with cf.ThreadPoolExecutor(8) as pool:
        for msg in pool.map(lambda j: fetch(*j), jobs):
            print(msg, flush=True)
    print(f"{len(jobs)} hours ready in {work}")
