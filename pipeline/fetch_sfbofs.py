"""Download NOAA SFBOFS model output from the NOAA Open Data bucket on AWS and keep only what the game needs.

SFBOFS is NOAA's San Francisco Bay Operational Forecast System (FVCOM). Each file is one hour of the whole
model: about 55 MB. This script pulls a run of hours, extracts the surface current, water level and model wind
for the region of interest, and stores a small .npz per hour.

The archive for 2024 holds forecast files only (f000 to f048 for the 03z, 09z, 15z and 21z cycles).
  - "What happened" is stitched from the first six hours of each successive cycle, the closest thing to an analysis.
  - "The forecast" is one whole cycle, f000 to f048, as it was issued at the time.

Usage: python3 fetch_sfbofs.py <work dir>
"""
import concurrent.futures as cf
import datetime as dt
import os
import subprocess
import sys

import netCDF4 as nc
import numpy as np

BUCKET = "https://s3.amazonaws.com/noaa-nos-ofs-pds/sfbofs/netcdf"
# Elements kept: generous box around the central Bay and the Golden Gate.
BOX = dict(lon0=-122.68, lon1=-122.26, lat0=37.70, lat1=37.97)
# The season: 36 hours from 08:00 PDT on 14 July 2024, so the morning calm and the afternoon build are both in it.
FIRST_CYCLE = dt.datetime(2024, 7, 14, 15)
TRUTH_HOURS = 36
FORECAST_HOURS = 48


def key(cycle: dt.datetime, fh: int) -> str:
    return f"{cycle:%Y%m}/nos.sfbofs.fields.f{fh:03d}.{cycle:%Y%m%d}.t{cycle:%H}z.nc"


def wanted():
    """(valid time, cycle, forecast hour, kind) for every file needed."""
    out = {}
    for h in range(TRUTH_HOURS + 1):
        cycle = FIRST_CYCLE + dt.timedelta(hours=6 * min(h // 6, (TRUTH_HOURS - 1) // 6))
        fh = h - int((cycle - FIRST_CYCLE).total_seconds() // 3600)
        out[(cycle, fh)] = None
    for fh in range(FORECAST_HOURS + 1):
        out[(FIRST_CYCLE, fh)] = None
    return list(out)


def extract(path: str, dest: str, geom_dest: str) -> None:
    d = nc.Dataset(path)
    lonc = np.asarray(d["lonc"][:]) - 360.0
    latc = np.asarray(d["latc"][:])
    keep = (lonc > BOX["lon0"]) & (lonc < BOX["lon1"]) & (latc > BOX["lat0"]) & (latc < BOX["lat1"])
    if not os.path.exists(geom_dest):
        np.savez_compressed(
            geom_dest,
            lon=np.asarray(d["lon"][:]) - 360.0, lat=np.asarray(d["lat"][:]), h=np.asarray(d["h"][:]),
            nv=np.asarray(d["nv"][:]).T - 1, lonc=lonc, latc=latc, keep=keep,
        )
    np.savez_compressed(
        dest,
        time=str(nc.num2date(d["time"][0], d["time"].units)),
        u=np.asarray(d["u"][0, 0, :])[keep].astype("f4"), v=np.asarray(d["v"][0, 0, :])[keep].astype("f4"),
        uw=np.asarray(d["uwind_speed"][0, :])[keep].astype("f4"), vw=np.asarray(d["vwind_speed"][0, :])[keep].astype("f4"),
        zeta=np.asarray(d["zeta"][0, :]).astype("f4"),
    )
    d.close()


def one(work: str, cycle: dt.datetime, fh: int) -> str:
    name = f"{cycle:%Y%m%d}.t{cycle:%H}z.f{fh:03d}"
    dest = os.path.join(work, f"{name}.npz")
    if os.path.exists(dest):
        return f"have {name}"
    raw = os.path.join(work, f"{name}.nc")
    subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "300", "-o", raw, f"{BUCKET}/{key(cycle, fh)}"], check=True)
    extract(raw, dest, os.path.join(work, "geometry.npz"))
    os.remove(raw)
    return f"got  {name}"


if __name__ == "__main__":
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    jobs = wanted()
    # The first one alone, so the shared geometry file is written once.
    print(one(work, *jobs[0]), flush=True)
    with cf.ThreadPoolExecutor(6) as pool:
        for msg in pool.map(lambda j: one(work, *j), jobs[1:]):
            print(msg, flush=True)
    print(f"{len(jobs)} hours ready in {work}")
