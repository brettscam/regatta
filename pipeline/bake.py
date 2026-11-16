"""Bake a course package from NOAA tide model output, HRRR wind and elevation tiles.

Run fetch_ofs.py, fetch_hrrr.py and fetch_terrain.py for the course first. Then:
    python3 bake.py <course> <tide model work dir> <tile dir> <output dir> <hrrr work dir>

The course is an id from pipeline/courses ("sf-bay", "san-juans") or a path to a definition file.

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
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree

import course as courses
import fetch_hrrr
import fetch_ofs
from fetch_terrain import ZOOM

CURRENT_SCALE = 0.03   # m/s per count

# Everything about a place comes from its definition in pipeline/courses: the origin, the boxes (local metres,
# x0, y0, x1, y1), the grid spacings, the marks and the tide station. Mark positions there are approximate, from
# general knowledge, and should be checked against a chart.


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


def coast_rings(c, dem, land_of):
    CHART = c.spec["chart"]
    xs, ys, nx, ny = grid((CHART[0] - 300, CHART[1] - 300, CHART[2] + 300, CHART[3] + 300), c.spec["dx"]["coast"])
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = c.to_latlon(gx, gy)
    z = dem(lat, lon)
    if land_of is not None:
        z = np.where(land_of(gx, gy, z), 1.0, -1.0)
    gen = contourpy.contour_generator(x=xs, y=ys, z=z, fill_type=contourpy.FillType.OuterOffset)
    polys, offsets = gen.filled(0.3, 1e6)
    rings = []
    for pts, offs in zip(polys, offsets):
        for a, b in zip(offs[:-1], offs[1:]):
            ring = simplify(np.asarray(pts[a:b]), c.spec["coast"]["tolerance"])
            if len(ring) >= 4 and ring_area(ring) > c.spec["coast"]["minArea"]:
                rings.append([int(round(v)) for v in ring.ravel()])
    return rings


# ---- main -----------------------------------------------------------------------------------------

def main(name, work, tile_dir, out, hrrr_dir):
    c = courses.load(name)
    to_xy, to_latlon = c.to_xy, c.to_latlon
    CHART, TERRAIN = tuple(c.spec["chart"]), tuple(c.spec["terrain"])
    dx = c.spec["dx"]
    CURRENT_DX, DEPTH_DX, TERRAIN_DX, WIND_DX = dx["current"], dx["depth"], dx["terrain"], dx["wind"]
    TERRAIN_MAX = c.spec["terrainMax"]   # metres at count 255
    TIDE_STATION = c.spec["tideStation"]
    FIRST_CYCLE, TRUTH_HOURS, FORECAST_HOURS = c.first_cycle, c.truth_hours, c.forecast_hours
    os.makedirs(out, exist_ok=True)
    geom = np.load(os.path.join(work, "geometry.npz"))
    keep = geom["keep"]
    nx_, ny_ = to_xy(geom["lat"], geom["lon"])
    # Only the elements kept by the fetch: the whole model can be hundreds of thousands of triangles.
    # Triangle numbers from here on are positions in the kept list, which is how the hourly files are stored.
    tri = mtri.Triangulation(nx_, ny_, geom["nv"][keep])
    finder = tri.get_trifinder()
    dem = load_dem(tile_dir)

    # Where the land is. By default the elevation tiles say: anything above half a metre.
    # Some tiles are no use for that: around the San Juans their sea is coarse bathymetry that rings above zero
    # between the islands. A course can ask for `"landFrom": "model"` instead, and then water is wherever the tide
    # model has water, and land is ground above half a metre that the model does not cover.
    land_of = None
    if c.spec.get("landFrom") == "model":
        land_of = lambda gx, gy, elev: (np.asarray(finder(gx, gy)) < 0) & (elev > 0.5)

    # Current grid: which model element each cell sits in.
    cxs, cys, cnx, cny = grid(CHART, CURRENT_DX)
    cgx, cgy = np.meshgrid(cxs, cys)
    elem = finder(cgx, cgy)
    inside = elem >= 0
    cell_elem = np.where(inside, elem, 0)
    # Where the grid is coarse beside a narrow pass, a cell whose centre misses the model's water by less than
    # `currentReach` cells takes the nearest element's stream, so the pass keeps its rate. Off unless the course asks.
    reach = c.spec.get("currentReach", 0) * CURRENT_DX
    if reach > 0:
        ex, ey = to_xy(geom["latc"][keep], geom["lonc"][keep])
        away, nearest = cKDTree(np.c_[ex, ey]).query(np.c_[cgx.ravel(), cgy.ravel()])
        near = (away.reshape(cgx.shape) < reach) & ~inside
        cell_elem = np.where(near, nearest.reshape(cgx.shape), cell_elem)
        inside = inside | near

    # Wind grid, filled from NOAA's 3 km HRRR model: linear between its points, nearest beyond them.
    wxs, wys, wnx, wny = grid(CHART, WIND_DX)
    wgx, wgy = np.meshgrid(wxs, wys)

    # A water can ask for two things of its wind (`wind.seaOnly`, `wind.lee`). Neither is on unless asked for.
    wind_spec = c.spec.get("wind", {})
    height_at = lambda x, y: np.clip(dem(*to_latlon(x, y)), 0, None)

    def blocking(x, y, bearing, reach, rise):
        """How much high ground stands in a direction from each point: 0 open, 1 fully in its shadow.
        Ground of height h at distance d counts as h / (rise * d + 25), so a hill shelters ten times its height or so."""
        most = np.zeros_like(x)
        for dist in np.arange(150.0, reach + 1, 150.0):
            most = np.maximum(most, height_at(x + np.sin(bearing) * dist, y + np.cos(bearing) * dist) / (rise * dist + 25.0))
        return np.clip(most, 0, 1)

    # Each wind cell is judged at five points, its middle and four round it, and only those that are afloat count.
    if "lee" in wind_spec:
        lee_x = wgx[..., None] + np.array([0, -0.25, 0.25, -0.25, 0.25]) * WIND_DX
        lee_y = wgy[..., None] + np.array([0, -0.25, -0.25, 0.25, 0.25]) * WIND_DX
        lee_afloat = height_at(lee_x, lee_y) < 1.0
        lee_count = np.maximum(lee_afloat.sum(axis=-1), 1)

    def island_effects(u, v, gust, lee):
        """Wind shadow under high islands and a little more wind where it is squeezed past them, by rule.
        The analysis grid is too coarse to hold either."""
        from_ = np.arctan2(-u, -v)[..., None]
        over_water = lambda a: (a * lee_afloat).sum(axis=-1) / lee_count
        shade = over_water(blocking(lee_x, lee_y, from_, lee["reach"], lee["rise"]))
        flanks = blocking(lee_x, lee_y, from_ + math.pi / 2, lee["reach"] / 2, lee["rise"]) + blocking(lee_x, lee_y, from_ - math.pi / 2, lee["reach"] / 2, lee["rise"])
        squeeze = over_water(np.clip(flanks, 0, 2) / 2)
        mean = (1 - lee["calm"] * shade) * (1 + lee["squeeze"] * squeeze * (1 - shade))
        # Under a high island the mean wind drops away but the puffs still come down off the hill.
        puffs = (1 - lee["calm"] * 0.45 * shade) * (1 + lee["squeeze"] * squeeze * (1 - shade))
        return u * mean, v * mean, gust * puffs

    def wind_of(path):
        d = np.load(path)
        px, py = to_xy(d["lat"], d["lon"])
        pts = np.c_[px, py]
        # Model points on or hard by the hills carry ridge-top wind, far stronger than the water below gets. Leave out
        # every point with ground higher than `seaOnly` metres within 1.25 km, and fill in from the open water.
        at_sea = np.ones(len(px), dtype=bool)
        if "seaOnly" in wind_spec:
            for reach in (0.0, 600.0, 1250.0):
                for k in range(8 if reach else 1):
                    at_sea &= height_at(px + reach * math.sin(k * math.pi / 4), py + reach * math.cos(k * math.pi / 4)) <= wind_spec["seaOnly"]
        pts = pts[at_sea]
        fields = []
        for key in ("u", "v", "gust"):
            lin = LinearNDInterpolator(pts, d[key][at_sea])(wgx, wgy)
            near = NearestNDInterpolator(pts, d[key][at_sea])(wgx, wgy)
            fields.append(np.where(np.isnan(lin), near, lin))
        u, v, gust = fields
        if "lee" in wind_spec:
            u, v, gust = island_effects(u, v, gust, wind_spec["lee"])
        # A gust is never less than the mean wind.
        gust = np.maximum(gust, np.hypot(u, v))
        tenths = lambda a: [int(round(float(x) * 10)) for x in a.ravel()]
        return {"u": tenths(u), "v": tenths(v), "g": tenths(gust)}

    # Tide station: nearest model node.
    sx, sy = to_xy(TIDE_STATION[1], TIDE_STATION[2])
    tide_node = int(np.argmin((nx_ - sx) ** 2 + (ny_ - sy) ** 2))

    def load(cycle, kind, n):
        return np.load(fetch_ofs.hour_path(work, cycle, kind, n))

    truth_jobs = fetch_ofs.truth_jobs(c)
    current = np.zeros((TRUTH_HOURS + 1, cny, cnx, 2), dtype="i1")
    truth_wind, truth_tide = [], []
    for i, job in enumerate(truth_jobs):
        d = load(*job)
        valid = FIRST_CYCLE + dt.timedelta(hours=i)
        stamp = dt.datetime.strptime(str(d["time"])[:19], "%Y-%m-%d %H:%M:%S")
        assert abs((stamp - valid).total_seconds()) < 120, (stamp, valid)  # the file's time is a rounded float
        u = np.where(inside, d["u"][cell_elem], 0.0)
        v = np.where(inside, d["v"][cell_elem], 0.0)
        current[i, ..., 0] = np.clip(np.round(u / CURRENT_SCALE), -127, 127)
        current[i, ..., 1] = np.clip(np.round(v / CURRENT_SCALE), -127, 127)
        truth_wind.append(wind_of(fetch_hrrr.truth_path(hrrr_dir, i)))
        truth_tide.append(round(float(d["zeta"][tide_node]), 3))
    model = c.model["name"].upper()
    if c.model["archive"] == "forecast":
        forecast_tide = [round(float(load(*job)["zeta"][tide_node]), 3) for job in fetch_ofs.forecast_jobs(c)]
        truth_source = f"Tide and stream: {c.model['title']}, stitched from the first six hours of each six-hourly cycle."
        tide_source = f"Tide: {model} {FIRST_CYCLE:%H}z cycle."
    else:
        station = np.load(fetch_ofs.forecast_tide_path(work))
        forecast_tide = [round(float(z), 3) for z in station["zeta"]]
        truth_source = f"Tide and stream: {c.model['title']}, the nowcast for each hour."
        where = "forecast at the mesh node" if c.model.get("reader") == "stofs" else "station forecast"
        tide_source = f"Tide: {model} {FIRST_CYCLE:%H}z cycle, its {where} nearest {TIDE_STATION[0]}."
    forecast_wind = [wind_of(fetch_hrrr.forecast_path(hrrr_dir, h)) for h in range(fetch_hrrr.forecast_span(c) + 1)]
    current.tofile(os.path.join(out, "current.bin"))

    # Depth: the model's own bathymetry where it has water, the elevation tiles elsewhere.
    dxs, dys, dnx, dny = grid(CHART, DEPTH_DX)
    dgx, dgy = np.meshgrid(dxs, dys)
    h_model = np.asarray(mtri.LinearTriInterpolator(tri, geom["h"])(dgx, dgy).filled(np.nan))
    lat, lon = to_latlon(dgx, dgy)
    elev = dem(lat, lon)
    if land_of is None:
        depth = np.where(np.isnan(h_model), np.clip(-elev, 0, None), h_model)
        depth = np.where(elev > 0.5, 0.0, np.maximum(depth, 0.6))
    else:
        # Outside the model's water the tiles' soundings are not to be trusted either: call it a shoal.
        depth = np.where(land_of(dgx, dgy, elev), 0.0, np.maximum(np.where(np.isnan(h_model), 0.6, h_model), 0.6))
    # Reefs and rocks the model's mesh is too coarse to hold, charted by hand in the definition: a round patch
    # ("at" and "radius") or a band along a line ("line" and "width"), never deeper than "depth". Water only.
    for shoal in c.spec.get("shoals", []):
        pts = np.array([to_xy(lat, lon) for lat, lon in shoal.get("line", [shoal.get("at")])], dtype="f8")
        reach = shoal.get("radius", shoal.get("width", 0) / 2)
        away = np.full(dgx.shape, np.inf)
        for a, b in zip(pts, pts[1:] if len(pts) > 1 else pts):
            ab = b - a
            t = np.clip(((dgx - a[0]) * ab[0] + (dgy - a[1]) * ab[1]) / (ab @ ab or 1.0), 0, 1)
            away = np.minimum(away, np.hypot(dgx - a[0] - t * ab[0], dgy - a[1] - t * ab[1]))
        depth = np.where((away <= reach) & (depth > 0), np.minimum(depth, shoal["depth"]), depth)
    np.clip(np.round(depth * 2), 0, 255).astype("u1").tofile(os.path.join(out, "depth.bin"))

    # Terrain for the 3D view: land height only.
    txs, tys, tnx, tny = grid(TERRAIN, TERRAIN_DX)
    tgx, tgy = np.meshgrid(txs, tys)
    lat, lon = to_latlon(tgx, tgy)
    land = np.clip(dem(lat, lon), 0, TERRAIN_MAX)
    if land_of is not None:
        # Land the model does not cover stands at least a metre proud, so the drawn shore is where the depth says it is.
        land = np.where(land_of(tgx, tgy, land), np.maximum(land, 1.0), 0.0)
    np.round(np.sqrt(land / TERRAIN_MAX) * 255).astype("u1").tofile(os.path.join(out, "terrain.bin"))

    rings = coast_rings(c, dem, land_of)

    def mark(m):
        x, y = to_xy(m[2], m[3])
        return {"id": m[0], "name": m[1], "x": round(float(x)), "y": round(float(y)), "kind": m[4]}

    def xy(latlon):
        x, y = to_xy(*latlon)
        return [round(float(x)), round(float(y))]

    MARKS = c.spec["marks"]
    # Waters outside HRRR name their own wind sources. The Bay and the San Juans do not, and bake as they always have.
    wind = c.spec.get("wind", {})
    wind_truth = wind.get("truth", "NOAA HRRR 3 km analyses, one an hour")
    wind_forecast = wind.get("forecast", "HRRR")
    wind_note = "HRRR 10 m wind" if not wind else "10 m wind"
    course = {
        "id": c.id,
        "name": c.name,
        "origin": c.origin,
        "timeZone": c.spec["timeZone"],
        "season": {
            "id": f"{FIRST_CYCLE:%Y-%m-%d}",
            "start": f"{FIRST_CYCLE:%Y-%m-%dT%H:%M:%SZ}",
            "hours": TRUTH_HOURS,
            "stepSeconds": 3600,
            "source": f"{truth_source} Wind and gusts: {wind_truth}. Both from NOAA Open Data on AWS.",
        },
        "forecast": {
            "issued": f"{FIRST_CYCLE:%Y-%m-%dT%H:%M:%SZ}",
            "hours": FORECAST_HOURS,
            "source": f"Wind: {wind_forecast} {c.hrrr_forecast_cycle:%H}z cycle of {c.hrrr_forecast_cycle:%d %b %Y}. {tide_source} Both as issued.",
            "windIssued": f"{c.hrrr_forecast_cycle:%Y-%m-%dT%H:%M:%SZ}",
        },
        "current": {"x0": CHART[0], "y0": CHART[1], "dx": CURRENT_DX, "nx": cnx, "ny": cny, "scale": CURRENT_SCALE, "steps": TRUTH_HOURS + 1, "file": "current.bin"},
        "depth": {"x0": CHART[0], "y0": CHART[1], "dx": DEPTH_DX, "nx": dnx, "ny": dny, "scale": 0.5, "file": "depth.bin"},
        "terrain": {"x0": TERRAIN[0], "y0": TERRAIN[1], "dx": TERRAIN_DX, "nx": tnx, "ny": tny, "max": TERRAIN_MAX, "file": "terrain.bin",
                    "source": "Terrarium elevation tiles (Mapzen, AWS Open Data)."},
        "wind": {"x0": CHART[0], "y0": CHART[1], "dx": WIND_DX, "nx": wnx, "ny": wny, "scale": 0.1, "truth": truth_wind, "forecast": forecast_wind,
                 "note": f"{wind_note} in tenths of a metre per second, blowing toward east (u) and north (v), and surface gust speed (g)."},
        "tide": {"station": TIDE_STATION[0], "x": xy(TIDE_STATION[1:])[0], "y": xy(TIDE_STATION[1:])[1], "truth": truth_tide, "forecast": forecast_tide,
                 "note": "Water level in metres above the model datum, close to mean sea level."},
        "bridge": {"south": xy(c.spec["bridge"]["south"]), "north": xy(c.spec["bridge"]["north"])} if "bridge" in c.spec else None,
        "marks": [mark(m) for m in MARKS],
        "bounds": {"x0": CHART[0], "y0": CHART[1], "x1": CHART[2], "y1": CHART[3]},
        "coast": rings,
    }
    if "modelled" in wind:
        course["wind"]["modelled"] = wind["modelled"]
    if course["bridge"] is None:
        del course["bridge"]
    if "streamAt" in c.spec:
        label, name, lat, lon, flood = c.spec["streamAt"]
        course["stream"] = {"label": label, "name": name, "x": xy((lat, lon))[0], "y": xy((lat, lon))[1], "flood": flood}
    with open(os.path.join(out, "course.json"), "w") as f:
        json.dump(course, f, separators=(",", ":"))
    sizes = {n: os.path.getsize(os.path.join(out, n)) // 1024 for n in ["course.json", "current.bin", "depth.bin", "terrain.bin"]}
    print("wrote", sizes, "kB;", len(rings), "coast rings,", sum(len(r) // 2 for r in rings), "points")


if __name__ == "__main__":
    main(*sys.argv[1:6])
