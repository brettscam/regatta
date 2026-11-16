"""Download 10 m wind and gust for waters HRRR does not reach, from NOAA Open Data on AWS.

HRRR stops at the edge of the continental United States. For Puerto Rico and the Virgin Islands NOAA runs:

  - RTMA, the Real-Time Mesoscale Analysis: what the wind was, every hour, on a 1.25 km grid that reaches from
    68.2 W to 64.0 W and 16.8 N to 19.7 N. It is a model first guess corrected with the hour's observations and
    fitted to the terrain. Each file is under 2 MB. "What happened" is these
  - the NAM 3 km Puerto Rico nest, a forecast every six hours out to 60 hours. "The forecast" is one cycle as issued.
    Its files are 70 MB an hour, so only the wind and gust are fetched, by byte range

Both grids are Mercator or latitude and longitude, so their winds are already true east and north.

Writes the same files as fetch_hrrr.py, so bake.py reads either.

Usage: python3 fetch_rtma.py <course> <work dir>
"""
import concurrent.futures as cf
import datetime as dt
import os
import re
import subprocess
import sys

import eccodes as ec
import numpy as np

import course as courses
import fetch_hrrr

RTMA = "https://s3.amazonaws.com/noaa-rtma-pds"
NAM = "https://s3.amazonaws.com/noaa-nam-pds"
WANTED = {"10u": "u", "10v": "v", "i10fg": "gust", "gust": "gust"}


def curl(args):
    return subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "180", *args], check=True, capture_output=True)


def spans(idx, patterns):
    """Byte ranges of the messages whose index lines match. Two fields can share a message (NAM's 10 m wind)."""
    starts = sorted({int(line.split(":")[1]) for line in idx})
    out = []
    for p in patterns:
        a = next(int(line.split(":")[1]) for line in idx if re.search(p, line))
        later = [s for s in starts if s > a]
        out.append((a, later[0] - 1 if later else None))
    return sorted(set(out))


def fetch(box: dict, url: str, dest: str) -> str:
    if os.path.exists(dest):
        return f"have {os.path.basename(dest)}"
    idx = curl([url + ".idx"]).stdout.decode().splitlines()
    raw = dest + ".grib2"
    with open(raw, "wb") as f:
        for a, b in spans(idx, [r":UGRD:10 m above ground:", r":VGRD:10 m above ground:", r":GUST:"]):
            f.write(curl(["-r", f"{a}-{b if b is not None else ''}", url]).stdout)
    out = {}
    # A message can hold several fields, which eccodes only hands over when asked to.
    ec.codes_grib_multi_support_on()
    with open(raw, "rb") as f:
        while True:
            g = ec.codes_grib_new_from_file(f)
            if g is None:
                break
            key = WANTED.get(ec.codes_get(g, "shortName"))
            if key:
                assert ec.codes_get(g, "gridType") in ("mercator", "regular_ll"), "grid-relative winds would need turning"
                if "keep" not in out:
                    lat = ec.codes_get_array(g, "latitudes")
                    lon = ec.codes_get_array(g, "longitudes")
                    lon = np.where(lon > 180, lon - 360, lon)
                    out["keep"] = (lat > box["lat0"]) & (lat < box["lat1"]) & (lon > box["lon0"]) & (lon < box["lon1"])
                    out["lat"] = lat[out["keep"]]
                    out["lon"] = lon[out["keep"]]
                out[key] = ec.codes_get_values(g)[out["keep"]]
            ec.codes_release(g)
    os.remove(raw)
    np.savez_compressed(dest, lat=out["lat"], lon=out["lon"], u=out["u"].astype("f4"), v=out["v"].astype("f4"), gust=out["gust"].astype("f4"))
    return f"got  {os.path.basename(dest)}"


def fetch_job(job) -> str:
    return fetch(*job)


if __name__ == "__main__":
    c = courses.load(sys.argv[1])
    work = sys.argv[2]
    os.makedirs(work, exist_ok=True)
    box = c.spec["hrrrBox"]
    jobs = []
    for h in range(c.truth_hours + 1):
        t = c.first_cycle + dt.timedelta(hours=h)
        jobs.append((box, f"{RTMA}/prrtma.{t:%Y%m%d}/prrtma.t{t:%H}z.2dvaranl_ndfd.grb2", fetch_hrrr.truth_path(work, h)))
    cycle = c.hrrr_forecast_cycle
    for h in range(fetch_hrrr.forecast_span(c) + 1):
        fh = fetch_hrrr.forecast_lead(c) + h
        jobs.append((box, f"{NAM}/nam.{cycle:%Y%m%d}/nam.t{cycle:%H}z.priconest.hiresf{fh:02d}.tm00.grib2", fetch_hrrr.forecast_path(work, h)))
    # GRIB decoding is not safe from several threads at once, so the hours are fetched one process each.
    with cf.ProcessPoolExecutor(6) as pool:
        for msg in pool.map(fetch_job, jobs):
            print(msg, flush=True)
    print(f"{len(jobs)} hours ready in {work}")
