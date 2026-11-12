"""Bake the Central San Francisco Bay course package from NOAA SFBOFS output and elevation tiles.

Run fetch_sfbofs.py and fetch_terrain.py first. Then:
    python3 bake_sfbay.py <sfbofs work dir> <tile dir> <output dir>

Writes course.json plus three small binaries:
    current.bin   surface current, int8 east and north per cell per hour
    depth.bin     water depth below the model datum, uint8 in half metres, 0 is land
    terrain.bin   land height, uint8 with a square-root scale

Everything is laid out on flat local grids in metres east and north of the course origin.
"""
import datetime as dt
import glob
import json
import math
import os
import sys

import contourpy
import matplotlib.tri as mtri
import numpy as np
from PIL import Image
from scipy.interpolate import NearestNDInterpolator
from scipy.ndimage import map_coordinates

from fetch_sfbofs import FIRST_CYCLE, FORECAST_HOURS, TRUTH_HOURS, wanted
from fetch_terrain import ZOOM

ORIGIN = dict(lat=37.83, lon=-122.45)
EARTH = 6371008.8
M_PER_DEG_LAT = EARTH * math.pi / 180.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(ORIGIN["lat"]))

# Local boxes in metres: (x0, y0, x1, y1).
CHART = (-13600.0, -7600.0, 11000.0, 9600.0)
TERRAIN = (-17200.0, -12400.0, 13400.0, 13200.0)
CURRENT_DX = 200.0
DEPTH_DX = 100.0
TERRAIN_DX = 80.0
WIND_DX = 2460.0
COAST_DX = 30.0
CURRENT_SCALE = 0.03   # m/s per count
TERRAIN_MAX = 820.0    # metres at count 255

# Positions are approximate, from general knowledge, and should be checked against a chart.
MARKS = [
    ("gate", "Golden Gate", 37.8197, -122.4786, "bridge"),
    ("alcatraz", "Alcatraz", 37.8267, -122.4230, "island"),
    ("blunt", "Point Blunt", 37.8530, -122.4190, "point"),
    ("angel", "Angel Island", 37.8609, -122.4326, "island"),
    ("harding", "Harding Rock", 37.8383, -122.4467, "buoy"),
    ("blossom", "Blossom Rock", 37.8183, -122.4033, "buoy"),
    ("bonita", "Point Bonita", 37.8155, -122.5297, "point"),
    ("fortpoint", "Fort Point", 37.8106, -122.4771, "point"),
    ("sausalito", "Sausalito", 37.8590, -122.4800, "town"),
    ("cityfront", "City Front", 37.8090, -122.4300, "town"),
    ("treasure", "Treasure Island", 37.8235, -122.3707, "island"),
    ("tiburon", "Tiburon", 37.8735, -122.4560, "town"),
]
TIDE_STATION = ("San Francisco (Presidio)", 37.8063, -122.4659)
BRIDGE = dict(south=(37.8140, -122.4778), north=(37.8254, -122.4794))


def to_xy(lat, lon):
    return (np.asarray(lon) - ORIGIN["lon"]) * M_PER_DEG_LON, (np.asarray(lat) - ORIGIN["lat"]) * M_PER_DEG_LAT


def to_latlon(x, y):
    return ORIGIN["lat"] + np.asarray(y) / M_PER_DEG_LAT, ORIGIN["lon"] + np.asarray(x) / M_PER_DEG_LON


def grid(box, dx):
    nx = int(round((box[2] - box[0]) / dx)) + 1
    ny = int(round((box[3] - box[1]) / dx)) + 1
    xs = box[0] + dx * np.arange(nx)
    ys = box[1] + dx * np.arange(ny)
    return xs, ys, nx, ny


# ---- elevation ------------------------------------------------------------------------------------

def load_dem(tile_dir):
    """Mosaic of Terrarium tiles and a sampler by latitude and longitude."""
    names = sorted(glob.glob(os.path.join(tile_dir, f"{ZOOM}_*.png")))
    coords = [tuple(int(p) for p in os.path.basename(n)[:-4].split("_")[1:]) for n in names]
    x0 = min(c[0] for c in coords)
    y0 = min(c[1] for c in coords)
    w = max(c[0] for c in coords) - x0 + 1
    h = max(c[1] for c in coords) - y0 + 1
    mosaic = np.zeros((h * 256, w * 256), dtype="f4")
    for n, (tx, ty) in zip(names, coords):
        rgb = np.asarray(Image.open(n).convert("RGB")).astype("f4")
        mosaic[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    n_tiles = 2 ** ZOOM

    def sample(lat, lon):
        px = (np.asarray(lon) + 180.0) / 360.0 * n_tiles * 256 - x0 * 256 - 0.5
        py = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n_tiles * 256 - y0 * 256 - 0.5
        return map_coordinates(mosaic, [py, px], order=1, mode="nearest")

    return sample


# ---- coastline ------------------------------------------------------------------------------------

def _reduce(points, tol):
    """Douglas-Peucker on an open line."""
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = points[b] - points[a]
        length = np.hypot(*seg) or 1e-9
        d = np.abs(seg[0] * (points[a + 1:b, 1] - points[a, 1]) - seg[1] * (points[a + 1:b, 0] - points[a, 0])) / length
        i = int(np.argmax(d))
        if d[i] > tol:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return points[keep]


def simplify(points, tol):
    """Simplify a closed ring: split it at the point farthest from its start and reduce each half."""
    if len(points) < 6:
        return points
    far = int(np.argmax(np.hypot(*(points - points[0]).T)))
    if far == 0 or far == len(points) - 1:
        return points
    return np.vstack([_reduce(points[:far + 1], tol)[:-1], _reduce(points[far:], tol)])


def ring_area(p):
    return 0.5 * abs(np.dot(p[:-1, 0], p[1:, 1]) - np.dot(p[1:, 0], p[:-1, 1]))


def coast_rings(dem):
    xs, ys, nx, ny = grid((CHART[0] - 300, CHART[1] - 300, CHART[2] + 300, CHART[3] + 300), COAST_DX)
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = to_latlon(gx, gy)
    z = dem(lat, lon)
    gen = contourpy.contour_generator(x=xs, y=ys, z=z, fill_type=contourpy.FillType.OuterOffset)
    polys, offsets = gen.filled(0.3, 1e6)
    rings = []
    for pts, offs in zip(polys, offsets):
        for a, b in zip(offs[:-1], offs[1:]):
            ring = simplify(np.asarray(pts[a:b]), 14.0)
            if len(ring) >= 4 and ring_area(ring) > 4000:
                rings.append([int(round(v)) for v in ring.ravel()])
    return rings


# ---- main -----------------------------------------------------------------------------------------

def main(work, tile_dir, out):
    os.makedirs(out, exist_ok=True)
    geom = np.load(os.path.join(work, "geometry.npz"))
    keep = geom["keep"]
    nx_, ny_ = to_xy(geom["lat"], geom["lon"])
    tri = mtri.Triangulation(nx_, ny_, geom["nv"])
    finder = tri.get_trifinder()
    full_to_kept = np.cumsum(keep) - 1
    dem = load_dem(tile_dir)

    # Current grid: which model element each cell sits in.
    cxs, cys, cnx, cny = grid(CHART, CURRENT_DX)
    cgx, cgy = np.meshgrid(cxs, cys)
    elem = finder(cgx, cgy)
    inside = (elem >= 0) & keep[np.clip(elem, 0, None)]
    cell_elem = np.where(inside, full_to_kept[np.clip(elem, 0, None)], 0)

    # Wind grid: mean of the model wind over the elements near each coarse cell, nearest where there are none.
    wxs, wys, wnx, wny = grid(CHART, WIND_DX)
    ex, ey = to_xy(geom["latc"][keep], geom["lonc"][keep])
    wgx, wgy = np.meshgrid(wxs, wys)
    wind_pick = NearestNDInterpolator(np.c_[ex, ey], np.arange(len(ex)))(wgx, wgy).astype(int)

    # Tide station: nearest model node.
    sx, sy = to_xy(TIDE_STATION[1], TIDE_STATION[2])
    tide_node = int(np.argmin((nx_ - sx) ** 2 + (ny_ - sy) ** 2))

    def load(cycle, fh):
        return np.load(os.path.join(work, f"{cycle:%Y%m%d}.t{cycle:%H}z.f{fh:03d}.npz"))

    def wind_of(d):
        # Smooth a little by averaging each cell's nearest element with its neighbours on the coarse grid.
        u = d["uw"][wind_pick]
        v = d["vw"][wind_pick]
        return [int(round(float(a) * 10)) for a in u.ravel()], [int(round(float(a) * 10)) for a in v.ravel()]

    jobs = wanted()
    truth_jobs = jobs[:TRUTH_HOURS + 1]
    current = np.zeros((TRUTH_HOURS + 1, cny, cnx, 2), dtype="i1")
    truth_wind, truth_tide = [], []
    for i, (cycle, fh) in enumerate(truth_jobs):
        d = load(cycle, fh)
        valid = FIRST_CYCLE + dt.timedelta(hours=i)
        stamp = dt.datetime.strptime(str(d["time"])[:19], "%Y-%m-%d %H:%M:%S")
        assert abs((stamp - valid).total_seconds()) < 120, (stamp, valid)  # the file's time is a rounded float
        u = np.where(inside, d["u"][cell_elem], 0.0)
        v = np.where(inside, d["v"][cell_elem], 0.0)
        current[i, ..., 0] = np.clip(np.round(u / CURRENT_SCALE), -127, 127)
        current[i, ..., 1] = np.clip(np.round(v / CURRENT_SCALE), -127, 127)
        uu, vv = wind_of(d)
        truth_wind.append({"u": uu, "v": vv})
        truth_tide.append(round(float(d["zeta"][tide_node]), 3))
    forecast_wind, forecast_tide = [], []
    for fh in range(FORECAST_HOURS + 1):
        d = load(FIRST_CYCLE, fh)
        uu, vv = wind_of(d)
        forecast_wind.append({"u": uu, "v": vv})
        forecast_tide.append(round(float(d["zeta"][tide_node]), 3))
    current.tofile(os.path.join(out, "current.bin"))

    # Depth: the model's own bathymetry where it has water, the elevation tiles elsewhere.
    dxs, dys, dnx, dny = grid(CHART, DEPTH_DX)
    dgx, dgy = np.meshgrid(dxs, dys)
    h_model = np.asarray(mtri.LinearTriInterpolator(tri, geom["h"])(dgx, dgy).filled(np.nan))
    lat, lon = to_latlon(dgx, dgy)
    elev = dem(lat, lon)
    depth = np.where(np.isnan(h_model), np.clip(-elev, 0, None), h_model)
    depth = np.where(elev > 0.5, 0.0, np.maximum(depth, 0.6))
    np.clip(np.round(depth * 2), 0, 255).astype("u1").tofile(os.path.join(out, "depth.bin"))

    # Terrain for the 3D view: land height only.
    txs, tys, tnx, tny = grid(TERRAIN, TERRAIN_DX)
    tgx, tgy = np.meshgrid(txs, tys)
    lat, lon = to_latlon(tgx, tgy)
    land = np.clip(dem(lat, lon), 0, TERRAIN_MAX)
    np.round(np.sqrt(land / TERRAIN_MAX) * 255).astype("u1").tofile(os.path.join(out, "terrain.bin"))

    rings = coast_rings(dem)

    def mark(m):
        x, y = to_xy(m[2], m[3])
        return {"id": m[0], "name": m[1], "x": round(float(x)), "y": round(float(y)), "kind": m[4]}

    def xy(latlon):
        x, y = to_xy(*latlon)
        return [round(float(x)), round(float(y))]

    course = {
        "id": "sf-bay",
        "name": "Central San Francisco Bay",
        "origin": ORIGIN,
        "timeZone": "America/Los_Angeles",
        "season": {
            "id": f"{FIRST_CYCLE:%Y-%m-%d}",
            "start": f"{FIRST_CYCLE:%Y-%m-%dT%H:%M:%SZ}",
            "hours": TRUTH_HOURS,
            "stepSeconds": 3600,
            "source": "NOAA SFBOFS (San Francisco Bay Operational Forecast System), NOAA Open Data on AWS. What happened is stitched from the first six hours of each six-hourly cycle.",
        },
        "forecast": {
            "issued": f"{FIRST_CYCLE:%Y-%m-%dT%H:%M:%SZ}",
            "hours": FORECAST_HOURS,
            "source": f"SFBOFS {FIRST_CYCLE:%H}z cycle of {FIRST_CYCLE:%d %b %Y}, as issued.",
        },
        "current": {"x0": CHART[0], "y0": CHART[1], "dx": CURRENT_DX, "nx": cnx, "ny": cny, "scale": CURRENT_SCALE, "steps": TRUTH_HOURS + 1, "file": "current.bin"},
        "depth": {"x0": CHART[0], "y0": CHART[1], "dx": DEPTH_DX, "nx": dnx, "ny": dny, "scale": 0.5, "file": "depth.bin"},
        "terrain": {"x0": TERRAIN[0], "y0": TERRAIN[1], "dx": TERRAIN_DX, "nx": tnx, "ny": tny, "max": TERRAIN_MAX, "file": "terrain.bin",
                    "source": "Terrarium elevation tiles (Mapzen, AWS Open Data)."},
        "wind": {"x0": CHART[0], "y0": CHART[1], "dx": WIND_DX, "nx": wnx, "ny": wny, "scale": 0.1, "truth": truth_wind, "forecast": forecast_wind,
                 "note": "The wind SFBOFS was driven with, in tenths of a metre per second, blowing toward east (u) and north (v)."},
        "tide": {"station": TIDE_STATION[0], "x": xy(TIDE_STATION[1:])[0], "y": xy(TIDE_STATION[1:])[1], "truth": truth_tide, "forecast": forecast_tide,
                 "note": "Water level in metres above the model datum, close to mean sea level."},
        "bridge": {"south": xy(BRIDGE["south"]), "north": xy(BRIDGE["north"])},
        "marks": [mark(m) for m in MARKS],
        "bounds": {"x0": CHART[0], "y0": CHART[1], "x1": CHART[2], "y1": CHART[3]},
        "coast": rings,
    }
    with open(os.path.join(out, "course.json"), "w") as f:
        json.dump(course, f, separators=(",", ":"))
    sizes = {n: os.path.getsize(os.path.join(out, n)) // 1024 for n in ["course.json", "current.bin", "depth.bin", "terrain.bin"]}
    print("wrote", sizes, "kB;", len(rings), "coast rings,", sum(len(r) // 2 for r in rings), "points")


if __name__ == "__main__":
    main(*sys.argv[1:4])
