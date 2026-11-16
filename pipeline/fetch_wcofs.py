"""Download surface current and water level from NOAA's West Coast model (WCOFS, ROMS, 4 km) for a course's outer water.

A course whose water reaches past its tide model names a second one under "outer" in its definition. The Gulf of the
Farallones does: SFBOFS stops about 45 km off the Golden Gate and at Point Reyes, short of the Farallones and Bodega.
WCOFS covers the whole coast and its tides, coarsely.

WCOFS runs once a day at 03z. The archive on AWS for 2024 holds its forecast surface files only (`2ds.f001` to
`f072`, about 73 MB each). "What happened" is stitched from the first 24 hours of each day's run.

Usage: python3 fetch_wcofs.py <course> <work dir>
"""
import concurrent.futures as cf
import datetime as dt
import os
import subprocess
import sys
import threading

import netCDF4 as nc
import numpy as np

import course as courses

BUCKET = "https://s3.amazonaws.com/noaa-nos-ofs-pds"
READING = threading.Lock()


def jobs(c):
    """(cycle, forecast hour) of the file for every hour of the season, in order."""
    out = []
    for h in range(c.truth_hours + 1):
        valid = c.first_cycle + dt.timedelta(hours=h)
        # The latest 03z run that started before this hour.
        cycle = (valid - dt.timedelta(hours=3, seconds=1)).replace(hour=3, minute=0, second=0)
        out.append((cycle, int((valid - cycle).total_seconds() // 3600)))
    return out


def hour_path(work: str, h: int) -> str:
    return os.path.join(work, f"outer.{h:03d}.npz")


def extract(c, path: str, dest: str, valid: dt.datetime) -> None:
    box = c.spec["outer"]["box"]
    d = nc.Dataset(path)
    lon = np.asarray(d["lon_rho"][:])
    lat = np.asarray(d["lat_rho"][:])
    inside = (lon > box["lon0"]) & (lon < box["lon1"]) & (lat > box["lat0"]) & (lat < box["lat1"])
    rows = np.where(inside.any(axis=1))[0]
    cols = np.where(inside.any(axis=0))[0]
    j0, j1, i0, i1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    stamp = nc.num2date(d["ocean_time"][0], d["ocean_time"].units)
    assert abs((dt.datetime(*stamp.timetuple()[:6]) - valid).total_seconds()) < 120, (stamp, valid)
    # Currents sit on the cell faces, along the grid's own axes. Bring them to the cell centres and turn them to east and north.
    u = np.ma.filled(d["u_sur"][0, j0:j1, i0 - 1:i1], 0.0)
    v = np.ma.filled(d["v_sur"][0, j0 - 1:j1, i0:i1], 0.0)
    ur = 0.5 * (u[:, :-1] + u[:, 1:])
    vr = 0.5 * (v[:-1, :] + v[1:, :])
    a = np.asarray(d["angle"][j0:j1, i0:i1])
    east = ur * np.cos(a) - vr * np.sin(a)
    north = ur * np.sin(a) + vr * np.cos(a)
    np.savez_compressed(
        dest, time=str(stamp), lon=lon[j0:j1, i0:i1], lat=lat[j0:j1, i0:i1], mask=np.asarray(d["mask_rho"][j0:j1, i0:i1]),
        h=np.asarray(d["h"][j0:j1, i0:i1]), u=east.astype("f4"), v=north.astype("f4"),
        zeta=np.ma.filled(d["zeta"][0, j0:j1, i0:i1], 0.0).astype("f4"),
    )
    d.close()


def one(c, work: str, h: int, cycle: dt.datetime, fh: int) -> str:
    dest = hour_path(work, h)
    if os.path.exists(dest):
        return f"have hour {h}"
    raw = os.path.join(work, f"raw.{h:03d}.nc")
    key = c.spec["outer"]["fieldsKey"].format(cycle=cycle, n=fh)
    subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "900", "-o", raw, f"{BUCKET}/{key}"], check=True)
    with READING:
        extract(c, raw, dest, c.first_cycle + dt.timedelta(hours=h))
    os.remove(raw)
    return f"got  hour {h}: {cycle:%Y%m%d} t{cycle:%H}z f{fh:03d}"


if __name__ == "__main__":
    c = courses.load(sys.argv[1])
    work = sys.argv[2]
    os.makedirs(work, exist_ok=True)
    with cf.ThreadPoolExecutor(4) as pool:
        for msg in pool.map(lambda j: one(c, work, j[0], *j[1]), list(enumerate(jobs(c)))):
            print(msg, flush=True)
    print(f"{c.truth_hours + 1} hours ready in {work}")
