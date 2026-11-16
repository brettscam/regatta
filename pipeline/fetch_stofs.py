"""Read tide and stream from NOAA's global tide and surge model, STOFS-2D-Global, on NOAA Open Data on AWS.

For waters with no regional NOAA tide model (the Virgin Islands, say). STOFS-2D-Global is an ADCIRC model of the
whole ocean on a triangle mesh that is fine near land: 100 to 400 m among the Virgin Islands. It gives the water
level and the depth-averaged stream, which is the tide and the wind-driven set with no difference between surface
and bottom. Each cycle (00z, 06z, 12z, 18z) is one 26 GB file of streams and one 12 GB file of levels, hourly: six
hours of nowcast up to the cycle time, then 180 of forecast.

Nothing is downloaded whole. The files are HDF5, and netCDF reads them by byte range (`#mode=bytes`), so only the
pieces of the mesh that cover the course are fetched: about 40 MB for each hour.

  - "What happened" is the nowcast, six hours from each successive cycle
  - "The forecast" tide is the first cycle's own forecast at the mesh node nearest the tide station

This writes the same files as fetch_ofs.py (geometry.npz, one .npz an hour, forecast_tide.npz), so bake.py reads
either. Only the wet part of the mesh is kept: the model's mesh runs up over the land so that it can flood.

Usage: python3 fetch_stofs.py <course> <work dir>
"""
import concurrent.futures as cf
import datetime as dt
import os
import sys

import netCDF4 as nc
import numpy as np

import course as courses
import fetch_ofs

NOWCAST_HOURS = 6
DRY = -9000.0   # the model's value for a node that is dry


def url(c, cycle: dt.datetime, what: str) -> str:
    return f"{c.model['bucket']}/{c.model['fieldsKey'].format(cycle=cycle, what=what)}#mode=bytes"


def geometry(c, work: str) -> dict:
    """The wet mesh inside the course's box, cut out of the global one and renumbered."""
    dest = os.path.join(work, "geometry.npz")
    if not os.path.exists(dest):
        box = c.model["box"]
        d = nc.Dataset(url(c, c.first_cycle, "cwl"))
        lon = np.asarray(d["x"][:])
        lat = np.asarray(d["y"][:])
        inside = (lon > box["lon0"]) & (lon < box["lon1"]) & (lat > box["lat0"]) & (lat < box["lat1"])
        lo, hi = int(np.argmax(inside)), int(len(inside) - np.argmax(inside[::-1]))
        h = np.asarray(d["depth"][lo:hi])
        nv = np.asarray(d["element"][:]) - 1
        d.close()
        # Elements wholly inside the box and under water at the model datum.
        nv = nv[inside[nv].all(axis=1)]
        nv = nv[h[nv - lo].mean(axis=1) > c.model.get("dryDepth", 0.3)]
        nodes = np.unique(nv)
        local = np.searchsorted(nodes, nv)
        lon, lat, h = lon[nodes], lat[nodes], h[nodes - lo]
        np.savez_compressed(
            dest, lon=lon, lat=lat, h=h, nv=local, lonc=lon[local].mean(axis=1), latc=lat[local].mean(axis=1),
            keep=np.ones(len(local), dtype=bool), nodes=nodes, lo=lo, hi=hi,
        )
    return np.load(dest)


def model_time(d, i: int) -> dt.datetime:
    # The units carry a Fortran comment after the date: "seconds since 2024-04-04 12:00:00        ! NCDASE - BASE_DAT"
    base = dt.datetime.strptime(d["time"].units.split("since")[1].split("!")[0].strip(), "%Y-%m-%d %H:%M:%S")
    return base + dt.timedelta(seconds=float(d["time"][i]))


def one(job) -> str:
    name, work, cycle, n = job
    c = courses.load(name)
    dest = fetch_ofs.hour_path(work, cycle, "n", n)
    if os.path.exists(dest):
        return f"have {os.path.basename(dest)}"
    g = np.load(os.path.join(work, "geometry.npz"))
    lo, hi, nodes, nv = int(g["lo"]), int(g["hi"]), g["nodes"], g["nv"]
    i = n - 1   # the file starts five hours before its cycle time
    vel = nc.Dataset(url(c, cycle, "cwl.vel"))
    lev = nc.Dataset(url(c, cycle, "cwl"))
    when = model_time(vel, i)
    assert when == cycle + dt.timedelta(hours=n - NOWCAST_HOURS), (when, cycle, n)
    field = lambda ds, key: np.ma.filled(ds[key][i, lo:hi], np.nan).astype("f8")[nodes - lo]
    u, v, zeta = field(vel, "u-vel"), field(vel, "v-vel"), field(lev, "zeta")
    vel.close()
    lev.close()
    dry = ~np.isfinite(zeta) | (zeta < DRY)
    u = np.where(dry | ~np.isfinite(u) | (u < DRY), 0.0, u)
    v = np.where(dry | ~np.isfinite(v) | (v < DRY), 0.0, v)
    zeta = np.where(dry, np.nanmedian(np.where(dry, np.nan, zeta)), zeta)
    # bake.py wants the stream on elements: the mean of the three corners.
    np.savez_compressed(dest, time=f"{when:%Y-%m-%d %H:%M:%S}", u=u[nv].mean(axis=1).astype("f4"), v=v[nv].mean(axis=1).astype("f4"), zeta=zeta.astype("f4"))
    return f"got  {os.path.basename(dest)}"


def forecast_tide(c, work: str) -> str:
    dest = fetch_ofs.forecast_tide_path(work)
    if os.path.exists(dest):
        return "have the forecast tide"
    g = np.load(os.path.join(work, "geometry.npz"))
    name, lat0, lon0 = c.spec["tideStation"]
    k = int(np.argmin(((g["lon"] - lon0) * c.m_per_deg_lon) ** 2 + ((g["lat"] - lat0) * courses.M_PER_DEG_LAT) ** 2))
    node = int(g["nodes"][k])
    d = nc.Dataset(url(c, c.first_cycle, "cwl"))
    first = NOWCAST_HOURS - 1
    assert model_time(d, first) == c.first_cycle
    zeta = np.ma.filled(d["zeta"][first:first + c.forecast_hours + 1, node], np.nan)
    d.close()
    np.savez_compressed(dest, zeta=zeta.astype("f4"), station=name, lat=g["lat"][k], lon=g["lon"][k])
    return f"got  the forecast tide at the node nearest {name}"


if __name__ == "__main__":
    c = courses.load(sys.argv[1])
    work = sys.argv[2]
    os.makedirs(work, exist_ok=True)
    g = geometry(c, work)
    print(f"mesh: {len(g['lon'])} wet nodes, {len(g['nv'])} elements", flush=True)
    jobs = [(sys.argv[1], work, cycle, n) for cycle, _, n in dict.fromkeys(fetch_ofs.truth_jobs(c))]
    # netCDF is not safe from several threads at once, so each hour is read in its own process.
    with cf.ProcessPoolExecutor(4) as pool:
        for msg in pool.map(one, jobs):
            print(msg, flush=True)
    print(forecast_tide(c, work), flush=True)
    print(f"{len(jobs)} hours ready in {work}")
