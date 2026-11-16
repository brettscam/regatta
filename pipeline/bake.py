"""Bake a course package from NOAA tide model output, HRRR wind and elevation tiles.

Run fetch_ofs.py, fetch_hrrr.py and fetch_terrain.py for the course first. Then:
    python3 bake.py <course> <tide model work dir> <tile dir> <output dir> <hrrr work dir> [<outer model work dir>]

A course whose water reaches past its tide model (the Gulf of the Farallones) names a second, coarser model under
"outer" and is baked with that model's work dir as well: see fetch_wcofs.py.

The course is an id from pipeline/courses ("sf-bay", "san-juans") or a path to a definition file.

Writes course.json plus three small binaries:
    current.bin   surface current, int8 east and north per cell per hour
    depth.bin     water depth below the model datum, uint8 in half metres, 0 is land
    terrain.bin   land height, uint8 with a square-root scale

A big water can ask for insets: smaller, finer grids over the places that need the detail, under "insets" in its
definition. Each inset's cells follow the main grid's in the same file, and the grid's entry in course.json lists them.

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
from scipy.ndimage import label as label_pieces, map_coordinates
from scipy.spatial import cKDTree

import course as courses
import fetch_hrrr
import fetch_ofs
import fetch_wcofs
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


def channel_mask(c):
    """Where a course's dredged channels run: a function of local metres giving True inside one, and the depth there."""
    channels = c.spec.get("channels", [])

    def inside(gx, gy):
        hit = np.zeros(np.shape(gx), dtype=bool)
        depth = np.zeros(np.shape(gx))
        for ch in channels:
            pts = np.asarray(ch["points"], dtype=float)
            away = np.full(np.shape(gx), 1e9)
            for a, b in zip(pts[:-1], pts[1:]):
                seg = b - a
                t = np.clip(((gx - a[0]) * seg[0] + (gy - a[1]) * seg[1]) / (seg @ seg), 0.0, 1.0)
                away = np.minimum(away, np.hypot(gx - a[0] - t * seg[0], gy - a[1] - t * seg[1]))
            here = away <= ch["width"] / 2
            hit |= here
            depth = np.where(here, np.maximum(depth, ch["depth"]), depth)
        return hit, depth

    return inside if channels else None


def coast_rings(c, dem, land_of):
    CHART = c.spec["chart"]
    xs, ys, nx, ny = grid((CHART[0] - 300, CHART[1] - 300, CHART[2] + 300, CHART[3] + 300), c.spec["dx"]["coast"])
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = c.to_latlon(gx, gy)
    z = dem(lat, lon)
    if land_of is not None:
        z = np.where(land_of(gx, gy, z), 1.0, -1.0)
    channels = channel_mask(c)
    if channels is not None:
        z = np.where(channels(gx, gy)[0], -1.0, z)
    for r in c.spec.get("rocks", []):
        rx, ry = c.to_xy(r[1], r[2])
        z = np.where(np.hypot(gx - rx, gy - ry) <= r[3], 1.0, z)
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

def main(name, work, tile_dir, out, hrrr_dir, outer_dir=None):
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

    # The current grids: the main one, then any insets. Each knows which model element its cells sit in.
    insets = c.spec.get("insets", {})
    channels = channel_mask(c)
    current_grids = [{"x0": CHART[0], "y0": CHART[1], "dx": CURRENT_DX, "nx": cnx, "ny": cny, "gx": cgx, "gy": cgy, "inside": inside, "elem": cell_elem}]
    for spec in insets.get("current", []):
        ixs, iys, inx, iny = grid(spec["box"], spec["dx"])
        igx, igy = np.meshgrid(ixs, iys)
        ielem = finder(igx, igy)
        current_grids.append({"x0": spec["box"][0], "y0": spec["box"][1], "dx": spec["dx"], "nx": inx, "ny": iny, "gx": igx, "gy": igy, "inside": ielem >= 0, "elem": np.where(ielem >= 0, ielem, 0)})

    # A second, coarser model for the water the first does not reach. Its stream fills every wet cell outside the first
    # model's mesh, and over the last `outerBlend` metres inside the mesh's seaward edge the two are mixed, so there is no
    # step in the stream where one model hands over to the other.
    outer = None
    if "outer" in c.spec:
        assert outer_dir, "this course has an outer model: give its work dir as the last argument"
        blend = c.spec.get("outerBlend", 5000.0)
        # The open sea beyond the mesh, on the main current grid: wet, outside the mesh, and the biggest such piece.
        lat, lon = to_latlon(cgx, cgy)
        sea = ~inside & (dem(lat, lon) < -2.0)
        pieces, _ = label_pieces(sea)
        biggest = 1 + int(np.argmax(np.bincount(pieces.ravel())[1:]))
        open_sea = cKDTree(np.c_[cgx[pieces == biggest], cgy[pieces == biggest]])
        first = np.load(fetch_wcofs.hour_path(outer_dir, 0))
        wet = first["mask"] > 0.5
        ox, oy = to_xy(first["lat"][wet], first["lon"][wet])
        for g in current_grids:
            away, _ = open_sea.query(np.c_[g["gx"].ravel(), g["gy"].ravel()])
            w = np.clip((away.reshape(g["gx"].shape) - CURRENT_DX) / blend, 0.0, 1.0)
            lat, lon = to_latlon(g["gx"], g["gy"])
            # Dry cells carry no stream. In a dredged channel the tiles may say land (a jetty's shadow): that is water.
            water = dem(lat, lon) <= 0.5
            if channels is not None:
                water |= channels(g["gx"], g["gy"])[0]
            g["weight"] = np.where(g["inside"], w, 0.0)
            g["water"] = water | g["inside"]
        outer = {"wet": wet, "pts": np.c_[ox, oy]}

    def outer_stream(i, g):
        """The outer model's stream on a grid at season hour i, east and north."""
        d = np.load(fetch_wcofs.hour_path(outer_dir, i))
        found = []
        for key in ("u", "v"):
            vals = d[key][outer["wet"]]
            lin = LinearNDInterpolator(outer["pts"], vals)(g["gx"], g["gy"])
            near = NearestNDInterpolator(outer["pts"], vals)(g["gx"], g["gy"])
            found.append(np.where(np.isnan(lin), near, lin))
        return found

    # Wind grid, filled from NOAA's 3 km HRRR model: linear between its points, nearest beyond them.
    wxs, wys, wnx, wny = grid(CHART, WIND_DX)
    wgx, wgy = np.meshgrid(wxs, wys)

    def wind_of(path):
        d = np.load(path)
        px, py = to_xy(d["lat"], d["lon"])
        pts = np.c_[px, py]
        fields = []
        for key in ("u", "v", "gust"):
            lin = LinearNDInterpolator(pts, d[key])(wgx, wgy)
            near = NearestNDInterpolator(pts, d[key])(wgx, wgy)
            fields.append(np.where(np.isnan(lin), near, lin))
        u, v, gust = fields
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
    currents = [np.zeros((TRUTH_HOURS + 1, g["ny"], g["nx"], 2), dtype="i1") for g in current_grids]
    truth_wind, truth_tide = [], []
    for i, job in enumerate(truth_jobs):
        d = load(*job)
        valid = FIRST_CYCLE + dt.timedelta(hours=i)
        stamp = dt.datetime.strptime(str(d["time"])[:19], "%Y-%m-%d %H:%M:%S")
        assert abs((stamp - valid).total_seconds()) < 120, (stamp, valid)  # the file's time is a rounded float
        for g, current in zip(current_grids, currents):
            u = np.where(g["inside"], d["u"][g["elem"]], 0.0)
            v = np.where(g["inside"], d["v"][g["elem"]], 0.0)
            if outer is not None:
                ou, ov = outer_stream(i, g)
                u = np.where(g["water"], g["weight"] * u + (1 - g["weight"]) * ou, 0.0)
                v = np.where(g["water"], g["weight"] * v + (1 - g["weight"]) * ov, 0.0)
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
        tide_source = f"Tide: {model} {FIRST_CYCLE:%H}z cycle, its station forecast nearest {TIDE_STATION[0]}."
    forecast_wind = [wind_of(fetch_hrrr.forecast_path(hrrr_dir, h)) for h in range(fetch_hrrr.forecast_span(c) + 1)]
    with open(os.path.join(out, "current.bin"), "wb") as f:
        for current in currents:
            current.tofile(f)
    if outer is not None:
        truth_source = truth_source.rstrip(".") + f". Beyond that model's water (it stops about 45 km off the Golden Gate and at Point Reyes): {c.spec['outer']['title']}, stitched from the first 24 hours of each daily run."

    # Depth: the model's own bathymetry where it has water, the elevation tiles elsewhere.
    h_of = mtri.LinearTriInterpolator(tri, geom["h"])
    # Rocks the tiles are too coarse to hold: [name, latitude, longitude, radius in metres, height in metres or 0 for not drawn].
    rocks = [(*to_xy(r[1], r[2]), r[3], r[4]) for r in c.spec.get("rocks", [])]

    def depth_on(box, step):
        dxs, dys, dnx, dny = grid(box, step)
        dgx, dgy = np.meshgrid(dxs, dys)
        h_model = np.asarray(h_of(dgx, dgy).filled(np.nan))
        lat, lon = to_latlon(dgx, dgy)
        elev = dem(lat, lon)
        if land_of is None:
            depth = np.where(np.isnan(h_model), np.clip(-elev, 0, None), h_model)
            depth = np.where(elev > 0.5, 0.0, np.maximum(depth, 0.6))
        else:
            # Outside the model's water the tiles' soundings are not to be trusted either: call it a shoal.
            depth = np.where(land_of(dgx, dgy, elev), 0.0, np.maximum(np.where(np.isnan(h_model), 0.6, h_model), 0.6))
        if channels is not None:
            hit, dredged = channels(dgx, dgy)
            depth = np.where(hit, np.maximum(depth, dredged), depth)
        for rx, ry, radius, _ in rocks:
            # A rock too small for the elevation tiles: dry out to its radius, and never less than the one cell nearest it.
            depth = np.where(np.hypot(dgx - rx, dgy - ry) <= max(radius, step * 0.55), 0.0, depth)
        return np.clip(np.round(depth * 2), 0, 255).astype("u1"), dnx, dny

    depth_cells, dnx, dny = depth_on(CHART, DEPTH_DX)
    depth_insets = []
    with open(os.path.join(out, "depth.bin"), "wb") as f:
        depth_cells.tofile(f)
        for spec in insets.get("depth", []):
            cells, inx, iny = depth_on(spec["box"], spec["dx"])
            cells.tofile(f)
            depth_insets.append({"x0": spec["box"][0], "y0": spec["box"][1], "dx": spec["dx"], "nx": inx, "ny": iny, "name": spec["name"]})

    # Terrain for the 3D view: land height only.
    def terrain_on(box, step):
        txs, tys, tnx, tny = grid(box, step)
        tgx, tgy = np.meshgrid(txs, tys)
        lat, lon = to_latlon(tgx, tgy)
        land = np.clip(dem(lat, lon), 0, TERRAIN_MAX)
        if land_of is not None:
            # Land the model does not cover stands at least a metre proud, so the drawn shore is where the depth says it is.
            land = np.where(land_of(tgx, tgy, land), np.maximum(land, 1.0), 0.0)
        if channels is not None:
            land = np.where(channels(tgx, tgy)[0], 0.0, land)
        for rx, ry, radius, height in rocks:
            # Drawn only if the course gives it a height: some rocks carry a lighthouse that is drawn with its own.
            if height > 0:
                land = np.where(np.hypot(tgx - rx, tgy - ry) <= max(radius, step * 0.55), np.maximum(land, height), land)
        return np.round(np.sqrt(land / TERRAIN_MAX) * 255).astype("u1"), tnx, tny

    terrain_cells, tnx, tny = terrain_on(TERRAIN, TERRAIN_DX)
    terrain_insets = []
    with open(os.path.join(out, "terrain.bin"), "wb") as f:
        terrain_cells.tofile(f)
        for spec in insets.get("terrain", []):
            cells, inx, iny = terrain_on(spec["box"], spec["dx"])
            cells.tofile(f)
            terrain_insets.append({"x0": spec["box"][0], "y0": spec["box"][1], "dx": spec["dx"], "nx": inx, "ny": iny, "name": spec["name"]})

    rings = coast_rings(c, dem, land_of)

    def mark(m):
        x, y = to_xy(m[2], m[3])
        return {"id": m[0], "name": m[1], "x": round(float(x)), "y": round(float(y)), "kind": m[4]}

    def xy(latlon):
        x, y = to_xy(*latlon)
        return [round(float(x)), round(float(y))]

    MARKS = c.spec["marks"]
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
            "source": f"{truth_source} Wind and gusts: NOAA HRRR 3 km analyses, one an hour. Both from NOAA Open Data on AWS.",
        },
        "forecast": {
            "issued": f"{FIRST_CYCLE:%Y-%m-%dT%H:%M:%SZ}",
            "hours": FORECAST_HOURS,
            "source": f"Wind: HRRR {c.hrrr_forecast_cycle:%H}z cycle of {c.hrrr_forecast_cycle:%d %b %Y}. {tide_source} Both as issued.",
            "windIssued": f"{c.hrrr_forecast_cycle:%Y-%m-%dT%H:%M:%SZ}",
        },
        "current": {"x0": CHART[0], "y0": CHART[1], "dx": CURRENT_DX, "nx": cnx, "ny": cny, "scale": CURRENT_SCALE, "steps": TRUTH_HOURS + 1, "file": "current.bin"},
        "depth": {"x0": CHART[0], "y0": CHART[1], "dx": DEPTH_DX, "nx": dnx, "ny": dny, "scale": 0.5, "file": "depth.bin"},
        "terrain": {"x0": TERRAIN[0], "y0": TERRAIN[1], "dx": TERRAIN_DX, "nx": tnx, "ny": tny, "max": TERRAIN_MAX, "file": "terrain.bin",
                    "source": "Terrarium elevation tiles (Mapzen, AWS Open Data)."},
        "wind": {"x0": CHART[0], "y0": CHART[1], "dx": WIND_DX, "nx": wnx, "ny": wny, "scale": 0.1, "truth": truth_wind, "forecast": forecast_wind,
                 "note": "HRRR 10 m wind in tenths of a metre per second, blowing toward east (u) and north (v), and surface gust speed (g)."},
        "tide": {"station": TIDE_STATION[0], "x": xy(TIDE_STATION[1:])[0], "y": xy(TIDE_STATION[1:])[1], "truth": truth_tide, "forecast": forecast_tide,
                 "note": "Water level in metres above the model datum, close to mean sea level."},
        "bridge": {"south": xy(c.spec["bridge"]["south"]), "north": xy(c.spec["bridge"]["north"])} if "bridge" in c.spec else None,
        "marks": [mark(m) for m in MARKS],
        "bounds": {"x0": CHART[0], "y0": CHART[1], "x1": CHART[2], "y1": CHART[3]},
        "coast": rings,
    }
    if course["bridge"] is None:
        del course["bridge"]
    # Insets, where the course has them: listed on the grid they refine, in the order their cells follow it in the file.
    current_insets = [{"x0": g["x0"], "y0": g["y0"], "dx": g["dx"], "nx": g["nx"], "ny": g["ny"], "name": spec["name"]} for g, spec in zip(current_grids[1:], insets.get("current", []))]
    for key, found in (("current", current_insets), ("depth", depth_insets), ("terrain", terrain_insets)):
        if found:
            course[key]["insets"] = found
    if "streamAt" in c.spec:
        label, name, lat, lon, flood = c.spec["streamAt"]
        course["stream"] = {"label": label, "name": name, "x": xy((lat, lon))[0], "y": xy((lat, lon))[1], "flood": flood}
    with open(os.path.join(out, "course.json"), "w") as f:
        json.dump(course, f, separators=(",", ":"))
    sizes = {n: os.path.getsize(os.path.join(out, n)) // 1024 for n in ["course.json", "current.bin", "depth.bin", "terrain.bin"]}
    print("wrote", sizes, "kB;", len(rings), "coast rings,", sum(len(r) // 2 for r in rings), "points")


if __name__ == "__main__":
    main(*sys.argv[1:7])
