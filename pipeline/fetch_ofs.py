"""Download NOAA tide model output from the NOAA Open Data bucket on AWS and keep only what the game needs.

The models are NOAA's Operational Forecast Systems (FVCOM): SFBOFS for San Francisco Bay, SSCOFS for the Salish Sea.
Each file is one hour of the whole model: about 55 MB for SFBOFS, 210 MB for SSCOFS. This script pulls a run of hours,
extracts the surface current, water level and model wind for the course's region, and stores a small .npz per hour.

What the archive holds differs by model and year, so a course definition says which kind it is:
  - "forecast": forecast files only (f000 to f048 for the 03z, 09z, 15z and 21z cycles), as SFBOFS has for 2024.
      "What happened" is stitched from the first six hours of each successive cycle, the closest thing to an analysis.
      "The forecast" is one whole cycle, f000 to f048, as it was issued at the time.
  - "nowcast": nowcast fields (n001 to n006 are the six hours up to each cycle time), as SSCOFS has from November 2024.
      "What happened" is the nowcast. There are no forecast fields, so the forecast tide comes from the station
      forecast file of the first cycle, at the model's station nearest the course's tide station.

Usage: python3 fetch_ofs.py <course> <work dir>
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
# netCDF is not safe to use from several threads at once: downloads run side by side, reading takes turns.
READING = threading.Lock()


def truth_jobs(c):
    """(cycle, kind, hour) of the file for every hour of the season, in order. kind is "f" (forecast) or "n" (nowcast)."""
    out = []
    for h in range(c.truth_hours + 1):
        if c.model["archive"] == "forecast":
            cycle = c.first_cycle + dt.timedelta(hours=6 * min(h // 6, (c.truth_hours - 1) // 6))
            out.append((cycle, "f", h - int((cycle - c.first_cycle).total_seconds() // 3600)))
        else:
            k = (h + 5) // 6
            out.append((c.first_cycle + dt.timedelta(hours=6 * k), "n", 6 if h == 0 else h - 6 * (k - 1)))
    return out


def forecast_jobs(c):
    """Field files of the forecast cycle, where the archive has them."""
    if c.model["archive"] != "forecast":
        return []
    return [(c.first_cycle, "f", fh) for fh in range(c.forecast_hours + 1)]


def wanted(c):
    """Every field file needed, each once, the season's hours first."""
    return list(dict.fromkeys(truth_jobs(c) + forecast_jobs(c)))


def hour_name(cycle: dt.datetime, kind: str, n: int) -> str:
    return f"{cycle:%Y%m%d}.t{cycle:%H}z.{kind}{n:03d}"


def hour_path(work: str, cycle: dt.datetime, kind: str, n: int) -> str:
    return os.path.join(work, hour_name(cycle, kind, n) + ".npz")


def forecast_tide_path(work: str) -> str:
    return os.path.join(work, "forecast_tide.npz")


def west_positive(lon):
    """Model longitudes run 0 to 360. Bring them to -180 to 180."""
    lon = np.asarray(lon)
    return np.where(lon > 180.0, lon - 360.0, lon)


def extract(c, path: str, dest: str, geom_dest: str) -> None:
    box = c.model["box"]
    d = nc.Dataset(path)
    lonc = west_positive(d["lonc"][:])
    latc = np.asarray(d["latc"][:])
    keep = (lonc > box["lon0"]) & (lonc < box["lon1"]) & (latc > box["lat0"]) & (latc < box["lat1"])
    if not os.path.exists(geom_dest):
        np.savez_compressed(
            geom_dest,
            lon=west_positive(d["lon"][:]), lat=np.asarray(d["lat"][:]), h=np.asarray(d["h"][:]),
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


def download(url: str, dest: str) -> None:
    subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "600", "-o", dest, url], check=True)


def one(c, work: str, cycle: dt.datetime, kind: str, n: int) -> str:
    name = hour_name(cycle, kind, n)
    dest = hour_path(work, cycle, kind, n)
    if os.path.exists(dest):
        return f"have {name}"
    raw = os.path.join(work, f"{name}.nc")
    download(f"{BUCKET}/{c.model['fieldsKey'].format(cycle=cycle, kind=kind, n=n)}", raw)
    with READING:
        extract(c, raw, dest, os.path.join(work, "geometry.npz"))
    os.remove(raw)
    return f"got  {name}"


def station_forecast(c, work: str) -> str:
    """The forecast water level at the model station nearest the tide station, hourly from the first cycle."""
    dest = forecast_tide_path(work)
    if os.path.exists(dest):
        return "have the station forecast"
    raw = os.path.join(work, "stations.forecast.nc")
    download(f"{BUCKET}/{c.model['stationsKey'].format(cycle=c.first_cycle)}", raw)
    _, lat0, lon0 = c.spec["tideStation"]
    with READING:
        d = nc.Dataset(raw)
        lon = west_positive(d["lon"][:])
        lat = np.asarray(d["lat"][:])
        i = int(np.argmin(((lon - lon0) * c.m_per_deg_lon) ** 2 + ((lat - lat0) * courses.M_PER_DEG_LAT) ** 2))
        away = float(np.hypot((lon[i] - lon0) * c.m_per_deg_lon, (lat[i] - lat0) * courses.M_PER_DEG_LAT))
        times = nc.num2date(d["time"][:], d["time"].units)
        hours = np.array([(t - times[0]).total_seconds() / 3600.0 for t in times])
        assert abs((dt.datetime(*times[0].timetuple()[:6]) - c.first_cycle).total_seconds()) < 120, times[0]
        zeta = np.interp(np.arange(c.forecast_hours + 1), hours, np.asarray(d["zeta"][:, i]))
        name = str(nc.chartostring(d["name_station"][:])[i]).strip()
        d.close()
    os.remove(raw)
    np.savez_compressed(dest, zeta=zeta.astype("f4"), station=name, lat=lat[i], lon=lon[i])
    return f"got  the station forecast at {name!r}, {away:.0f} m from the tide station"


if __name__ == "__main__":
    c = courses.load(sys.argv[1])
    work = sys.argv[2]
    os.makedirs(work, exist_ok=True)
    jobs = wanted(c)
    # The first one alone, so the shared geometry file is written once.
    print(one(c, work, *jobs[0]), flush=True)
    with cf.ThreadPoolExecutor(4) as pool:
        for msg in pool.map(lambda j: one(c, work, *j), jobs[1:]):
            print(msg, flush=True)
    if c.model["archive"] == "nowcast":
        print(station_forecast(c, work), flush=True)
    print(f"{len(jobs)} hours ready in {work}")
