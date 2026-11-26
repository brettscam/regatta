"""The land of Long Beach to Catalina from real data: its shape, its shoreline and its colour, over the first bake's.

Usage: python3 pipeline/catalina/land.py <work dir from fetch_island.py> courses/catalina [base dir]
Then:  npx vite-node scripts/stamp.ts catalina

`base dir` holds the first bake's course.json, depth.bin and terrain.bin (pipeline/bake.py catalina, then
scripts/stamp.ts). Without it they are read from the course folder, which is only right straight after bake.py: this
script rewrites them, and reading its own output again would shoal the island twice.

What it does, for two regions (the island, and the mainland shore from Palos Verdes to Huntington Beach):
  - where the land is: from one clear Sentinel-2 scene (22 August 2025) at 10 m, and under its few clouds another (30 August). Ground is bright in the short-wave
    infrared (B11) and the near infrared (B08); the sea is black in both, and so is the floating kelp in B11, which is
    why B11 and not the near infrared alone draws the line. Where both were cloudy the elevation tiles decide. Water that
    does not reach the sea is filled in; land that is not the island, the mainland or a named rock is dropped, and so is
    anything where features.json draws a structure (the breakwaters, the oil islands, Belmont Pier): it is drawn there;
  - how high: Terrarium elevation, zoom 13 (about 16 m), which agrees with the picture to a pixel. Land is at least a
    metre above the sea and climbs from the waterline, so a beach is not cut off flat;
  - the land is drawn on finer insets: the island at 40 m in ten strips along its length (a box round the whole
    island would be mostly sea), Palos Verdes and the Long Beach shore at 50 m, Avalon and Two Harbors at 10 m (last,
    so they are the ones drawn and read there; read towns.json first, as the ground under a town's level paths is
    graded to just below them, and a pier stands over water, not on the knoll the picture makes of its deck). Their edges lie on the 200 m grid's
    lines, so the coarse grid's cells are either inside an inset or outside them all. The coarse grid itself is
    re-made from the same sources inside both regions, so it agrees where it is still drawn and read;
  - the depth: the tide model's, wherever it had water, shoaling to the new shore, with land wherever the new land is.
    Insets at 50 m over the island's strips and the Long Beach harbor, and 5 and 10 m ones over the piers at Avalon and Two
    Harbors so scripts/stamp.ts can make them solid;
  - the chart's coastline rings, from the 10 m shoreline;
  - the colour: `land.jpg`, one picture holding both regions' true colour (TCI), sea filled with the colour of the
    nearest land so the drawn shoreline does not fringe, cloud filled the same way. `course.terrain.image` says which
    part of the picture covers which box.
Needs numpy, scipy, contourpy, pillow, rasterio.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

DRY = 0.4             # the game's waterline: land is above this (scene/terrain.ts)
# Bird Rock and Ship Rock, off the Isthmus: latitude, longitude, radius and height in metres. Each is found in the picture
# within 60 m of where it is said to be, and drawn as a knoll that size: at 10 m a pixel a rock is only a bright speck.
ROCKS = [(33.4514, -118.4875, 45, 28), (33.4633, -118.4917, 45, 24)]
CELL = 10.0
QUALITY = 64          # of land.jpg
DATES = ("20250822", "20250830")   # Sentinel-2 scenes: the picture, then one to see under its clouds

REGIONS = {
    "island": {
        "box": (-29800, -28800, 1600, -6800), "tiles": ("LT", "LS"),
        "terrain_dx": 40.0, "strips": 10, "margin": 400.0,
        "depth_dx": 50.0, "depth_margin": 600.0,
        "image": {"box": (-29600, -28600, 800, -7000), "width": 1600},
    },
    "mainland": {
        "box": (-15000, 9000, 31000, 29000), "tiles": ("LT", "MT"),
        "terrain": [("Palos Verdes", (-13000, 15000, 1400, 27000), 50.0), ("Long Beach", (1400, 16800, 21400, 26200), 50.0)],
        "depth": [("Long Beach harbor", (-1000, 16000, 21400, 25400), 50.0)],
        "image": {"box": (-13400, 14000, 23000, 29000), "width": 1536},
    },
}
# The piers at Avalon and Two Harbors: fine depth insets, so a pier can be a line of solid cells and a float beside it water.
# 5 m where a solid pier has floats moored beside it (a 10 m cell would swallow the float), 10 m round the rest of Avalon Bay.
FINE = [("Avalon pier and mole", (-2400, -23050, -1950, -22750), 5.0), ("Avalon harbor", (-2700, -23200, -1700, -22100), 10.0), ("Isthmus pier", (-18400, -12100, -18200, -11900), 5.0)]
# The two towns' own land, at 10 m, last of the insets so it is the one drawn and read there: the waterfronts are laid
# on it (towns.json), and the ground under a promenade or a quay is graded to just below it, as a town's front is.
# Berths dredged for the Catalina boats: water within `reach` metres of the line is at least `depth` deep. The Cabrillo Mole.
BERTHS = [([(-2058, -22884), (-2040, -22790)], 45.0, 7.5)]
TOWNS = [("Avalon", (-2800, -23400, -1600, -22200)), ("Two Harbors", (-18800, -12800, -18000, -11800))]


def load_dem(tile_dir, zoom=13):
    """Terrarium tiles in a folder, as a function of latitude and longitude giving metres above the sea."""
    names = [f for f in os.listdir(tile_dir) if f.startswith(f"{zoom}_")]
    xs = [int(f.split("_")[1]) for f in names]
    ys = [int(f.split("_")[2].split(".")[0]) for f in names]
    tx0, ty0 = min(xs), min(ys)
    big = np.full(((max(ys) - ty0 + 1) * 256, (max(xs) - tx0 + 1) * 256), -50.0, np.float32)
    for f, x, y in zip(names, xs, ys):
        a = np.asarray(Image.open(os.path.join(tile_dir, f)).convert("RGB"), np.float32)
        big[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    n = 2 ** zoom * 256

    def sample(lat, lon):
        px = (lon + 180.0) / 360.0 * n - tx0 * 256 - 0.5
        py = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n - ty0 * 256 - 0.5
        return ndimage.map_coordinates(big, [py, px], order=1, mode="nearest")
    return sample


def simplify(pts, tol):
    if len(pts) > 4 and np.allclose(pts[0], pts[-1]):
        # A closed ring: cut it at the point farthest from its start and do the two halves.
        k = int(np.argmax(np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1])))
        return np.vstack([simplify(pts[:k + 1], tol)[:-1], simplify(pts[k:], tol)])
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = pts[b] - pts[a]
        length = np.hypot(*seg) or 1.0
        d = np.abs(seg[0] * (pts[a + 1:b, 1] - pts[a, 1]) - seg[1] * (pts[a + 1:b, 0] - pts[a, 0])) / length
        k = int(np.argmax(d))
        if d[k] > tol:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return pts[keep]


def to_line(line, X, Y):
    best = np.full(X.shape, 1e9, np.float32)
    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
        l2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1.0
        u = np.clip(((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / l2, 0, 1)
        best = np.minimum(best, np.hypot(X - ax - (bx - ax) * u, Y - ay - (by - ay) * u))
    return best


class Region:
    """One region at 10 m: where its land is, how high, and what colour, on a grid of course metres."""

    def __init__(self, name, spec, work, course, dem, structures):
        self.name, self.spec = name, spec
        x0, y0, x1, y1 = spec["box"]
        self.x0, self.y0 = x0, y0
        xs = np.arange(x0, x1 + CELL / 2, CELL)
        ys = np.arange(y0, y1 + CELL / 2, CELL)
        X, Y = np.meshgrid(xs, ys)
        lat0, lon0 = course["origin"]["lat"], course["origin"]["lon"]
        mlat = 6371008.8 * math.pi / 180
        mlon = mlat * math.cos(math.radians(lat0))
        self.latlon = lambda x, y: (lat0 + y / mlat, lon0 + x / mlon)
        self.at = lambda lat, lon: ((lon - lon0) * mlon, (lat - lat0) * mlat)
        H = dem(lat0 + Y / mlat, lon0 + X / mlon).astype(np.float32)
        from rasterio.warp import transform as warp
        e, n = warp("EPSG:4326", "EPSG:32611", (lon0 + X / mlon).ravel(), (lat0 + Y / mlat).ravel())
        e, n = np.asarray(e).reshape(X.shape), np.asarray(n).reshape(X.shape)

        def sample(asset, date, order=1):
            out, got = None, np.zeros(X.shape, bool)
            for t in spec["tiles"]:
                z = np.load(os.path.join(work, f"{name}_{asset}_{t}_{date}.npz"))
                a, tr = z["rgb"].astype(np.float32), z["transform"]
                col, row = (e - tr[2]) / tr[0] - 0.5, (n - tr[5]) / tr[4] - 0.5
                ok = (col >= 0) & (row >= 0) & (col <= a.shape[2] - 1) & (row <= a.shape[1] - 1)
                s = np.stack([ndimage.map_coordinates(a[k], [row, col], order=order) for k in range(a.shape[0])], -1)
                ok &= s.sum(-1) > 0
                if out is None:
                    out = np.zeros(X.shape + (a.shape[0],), np.float32)
                out[ok & ~got] = s[ok & ~got]
                got |= ok
            return out, got

        # ---- where the land is: from the first date's picture, and a later one's under its clouds ----
        # Land is what every clear look says is land: a cloud one day is open water the next.
        land = np.ones(X.shape, bool)
        clear = np.zeros(X.shape, bool)
        looks = []
        for date in DATES:
            nir, seen = sample("B08", date)
            swir, _ = sample("B11", date)
            col, _ = sample("TCI", date)
            scl, _ = sample("SCL", date, 0)
            cloud = ndimage.binary_dilation(np.isin(scl[..., 0], [8, 9, 10]), iterations=4) | ~seen
            said = (swir[..., 0] > 800) & (nir[..., 0] > 600)
            land &= said | cloud
            clear |= ~cloud
            looks.append((~cloud, said, col))
            bright = swir[..., 0] if date == DATES[0] else np.maximum(bright, swir[..., 0])
        cloud = ~clear
        land[cloud] = H[cloud] > 1.0
        # The colour: the first look that was clear and agrees.
        rgb = np.zeros(X.shape + (3,), np.float32)
        done = cloud.copy()
        for ok, said, col in looks:
            use = ok & (said == land) & ~done
            rgb[use] = col[use]
            done |= use
        cloud |= ~done
        # Structures are drawn where they stand: their rock and concrete is not land here.
        for s in structures:
            if s.get("line"):
                land &= to_line(s["line"], X, Y) > (45 if s["kind"] == "breakwater" else 15)
            elif s.get("r"):
                land &= np.hypot(X - s["x"], Y - s["y"]) > s["r"] + 40
        # A bridge, a ship alongside, a pier or a raft of boats is not land: anything narrower than about 40 m on the
        # island and 60 m on the mainland (whose bridges over the harbor channels are wide) goes, so it cannot cut a channel off.
        r = 2 if name == "island" else 3
        disk = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r + 0.01
        land = ndimage.binary_opening(land, disk)
        # Water: a slip or a cove narrower than 30 m is not sea; only water that reaches the open sea is.
        water = ndimage.binary_opening(~land, np.ones((3, 3), bool))
        lab, _ = ndimage.label(water)
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        water = lab == int(np.argmax(sizes))
        land = ~water
        # Land: the island, the mainland and its harbor islands; and the named rocks. Not a ship, a buoy or a raft.
        land = ndimage.binary_opening(land, np.ones((2, 2), bool))
        lab, count = ndimage.label(land)
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        keep = sizes >= (0.25e6 / CELL ** 2 if name == "mainland" else sizes.max())
        keep[0] = False
        land = keep[lab]
        rock = np.zeros(X.shape, np.float32)
        for lat, lon, r, top in ROCKS:
            rx, ry = self.at(lat, lon)
            i, j = int(round((rx - x0) / CELL)), int(round((ry - y0) / CELL))
            if not (6 <= i < X.shape[1] - 6 and 6 <= j < X.shape[0] - 6):
                continue
            win = bright[j - 6:j + 7, i - 6:i + 7]
            dj, di = np.unravel_index(int(np.argmax(win)), win.shape)
            cx, cy = x0 + (i - 6 + di) * CELL, y0 + (j - 6 + dj) * CELL
            d = np.hypot(X - cx, Y - cy)
            rock = np.maximum(rock, np.where(d < r, top * np.sqrt(np.clip(1 - (d / r) ** 2, 0, 1)), 0))
        land |= rock > 0
        self.land = land
        self.sd = (ndimage.distance_transform_edt(land) - ndimage.distance_transform_edt(~land)) * CELL
        # ---- how high ----
        inland = np.clip(self.sd, 0, 60)
        self.h = np.where(land, np.maximum(np.maximum(H, 1.0 + inland * 0.05), rock), 0.0).astype(np.float32)
        # ---- what colour: sea and cloud take the colour of the nearest clear land ----
        self.raw = np.clip(rgb, 0, 255).astype(np.uint8)
        good = land & ~cloud
        _, (ri, ci) = ndimage.distance_transform_edt(~good, return_indices=True)
        col = rgb[ri, ci]
        col[good] = rgb[good]
        self.rgb = col
        print(f"{name}: {land.sum() * CELL ** 2 / 1e6:.1f} km2 of land, highest {self.h.max():.0f} m, {count} pieces before tidying")

    def read(self, field, x, y, order=1):
        """A 10 m field at course positions."""
        return ndimage.map_coordinates(field, [(np.asarray(y) - self.y0) / CELL, (np.asarray(x) - self.x0) / CELL], order=order, mode="nearest")

    def inside(self, x, y):
        x0, y0, x1, y1 = self.spec["box"]
        return (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)

    def carve(self, towns):
        """Grade the land under each town's level ground (a promenade, a quay, a pier's foot, the walk round the
        Casino) to just under its surface, with a bank rising from it, so the land does not stand up through it."""
        X0, Y0 = self.x0, self.y0
        ny, nx = self.h.shape
        # A pier stands on piles over the water. The picture sees its deck and the buildings on it as ground, and would
        # put a knoll under it: past the first few metres from its foot, the water goes back under it.
        for t in towns:
            for p in t["paths"]:
                if p["kind"] != "pier" or p["width"] < 5:
                    continue
                (ax, ay), (bx, by) = p["points"][0], p["points"][-1]
                L = math.hypot(bx - ax, by - ay)
                ux, uy = (bx - ax) / L, (by - ay) / L
                start = (ax + ux * 10, ay + uy * 10)
                i0, i1 = max(0, int((min(ax, bx) - 40 - X0) / CELL)), min(nx, int((max(ax, bx) + 40 - X0) / CELL) + 2)
                j0, j1 = max(0, int((min(ay, by) - 40 - Y0) / CELL)), min(ny, int((max(ay, by) + 40 - Y0) / CELL) + 2)
                GX, GY = np.meshgrid(X0 + np.arange(i0, i1) * CELL, Y0 + np.arange(j0, j1) * CELL)
                near = to_line([start, (bx, by)], GX, GY) < p["width"] / 2 + 14
                self.land[j0:j1, i0:i1] &= ~near
                self.h[j0:j1, i0:i1][near] = 0
        self.sd = (ndimage.distance_transform_edt(self.land) - ndimage.distance_transform_edt(~self.land)) * CELL
        for t in towns:
            for p in t["paths"]:
                if p["kind"] in ("street", "path", "float"):
                    continue
                # Under the surface by more than a step of the stored heights (about 0.4 m at 3 m), with room to the side.
                z = p.get("floor", t["floor"]) - 0.9
                reach = p["width"] / 2 + 8
                if p["kind"] == "round":
                    cx, cy = p["centre"]
                    pts = None
                    lo = (cx - p["inner"] - reach - 40, cy - p["inner"] - reach - 40, cx + p["inner"] + reach + 40, cy + p["inner"] + reach + 40)
                else:
                    pts = p["points"]
                    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
                    lo = (min(xs) - reach - 40, min(ys) - reach - 40, max(xs) + reach + 40, max(ys) + reach + 40)
                i0, i1 = max(0, int((lo[0] - X0) / CELL)), min(nx, int((lo[2] - X0) / CELL) + 2)
                j0, j1 = max(0, int((lo[1] - Y0) / CELL)), min(ny, int((lo[3] - Y0) / CELL) + 2)
                GX, GY = np.meshgrid(X0 + np.arange(i0, i1) * CELL, Y0 + np.arange(j0, j1) * CELL)
                if pts is None:
                    # The walk and what stands inside it, all level.
                    d = np.maximum(np.hypot(GX - cx, GY - cy) - (p["inner"] + p["width"] / 2), 0)
                else:
                    d = to_line(pts, GX, GY)
                cap = z + np.clip(d - reach, 0, None) * 0.9
                sub = self.h[j0:j1, i0:i1]
                on = self.land[j0:j1, i0:i1]
                self.h[j0:j1, i0:i1] = np.where(on, np.maximum(np.minimum(sub, cap), 1.0), sub)

    def heights(self, x, y, dx):
        """Land heights on a grid of spacing dx: the 10 m heights smoothed to that spacing over land only, 0 over water."""
        s = dx / CELL / 2.5
        wet = ndimage.gaussian_filter(self.land.astype(np.float32), s)
        hs = ndimage.gaussian_filter(self.h, s) / np.maximum(wet, 1e-3)
        sd = ndimage.gaussian_filter(self.sd, s * 0.6)
        h = self.read(hs, x, y)
        return np.where(self.read(sd, x, y) > 0, np.maximum(h, 1.0), 0.0)


def strips(region, n, dx, margin):
    """Boxes along the island, each round its land, on the 200 m grid's lines."""
    ys, xs = np.nonzero(region.land)
    X = region.x0 + xs * CELL
    Y = region.y0 + ys * CELL
    lo, hi = X.min() - margin, X.max() + margin
    edges = np.linspace(lo, hi, n + 1)
    snap = lambda v, f: f(v / 200.0) * 200.0
    out = []
    for k in range(n):
        a, b = snap(edges[k], math.floor) if k == 0 else out[-1][2], snap(edges[k + 1], math.ceil)
        sel = (X >= a) & (X <= b)
        y0, y1 = snap(Y[sel].min() - margin, math.floor), snap(Y[sel].max() + margin, math.ceil)
        out.append((a, y0, b, y1))
    return out


def grid_of(box, dx, name):
    x0, y0, x1, y1 = box
    return {"x0": x0, "y0": y0, "dx": dx, "nx": int(round((x1 - x0) / dx)) + 1, "ny": int(round((y1 - y0) / dx)) + 1, "name": name}


def points(g):
    return np.meshgrid(g["x0"] + np.arange(g["nx"]) * g["dx"], g["y0"] + np.arange(g["ny"]) * g["dx"])


def split(spec, cells):
    """A grid and its insets as arrays, from its cells."""
    out, o = [], spec["nx"] * spec["ny"]
    out.append(cells[:o].reshape(spec["ny"], spec["nx"]).copy())
    for g in spec.get("insets", []):
        out.append(cells[o:o + g["nx"] * g["ny"]].reshape(g["ny"], g["nx"]).copy())
        o += g["nx"] * g["ny"]
    return out


def main(work, out, base):
    course = json.load(open(os.path.join(base, "course.json")))
    features = json.load(open(os.path.join(out, "features.json")))
    structures = [s for s in features.get("structures", []) if s["kind"] in ("breakwater", "pier", "island")]
    dem = load_dem(os.path.join(work, "tiles13"))
    regions = {name: Region(name, spec, work, course, dem, structures) for name, spec in REGIONS.items()}
    towns = json.load(open(os.path.join(out, "towns.json")))
    regions["island"].carve(towns)
    isl, mai = regions["island"], regions["mainland"]
    in_any = lambda x, y: isl.inside(x, y) | mai.inside(x, y)

    def region_heights(x, y, dx):
        h = np.zeros(np.shape(x), np.float32)
        for r in regions.values():
            m = r.inside(x, y)
            if m.any():
                h[m] = r.heights(x[m], y[m], dx)
        return h

    # ---- the land ------------------------------------------------------------------------------------------
    T = course["terrain"]
    tmax = T["max"]
    enc = lambda h: np.where(h > DRY, np.maximum(1, np.round(np.sqrt(np.clip(h, 0, tmax) / tmax) * 255)), 0).astype(np.uint8)
    told = split(T, np.fromfile(os.path.join(base, "terrain.bin"), np.uint8))
    MX, MY = points(T)
    main_t = told[0]
    m = in_any(MX, MY)
    main_t[m] = enc(region_heights(MX[m], MY[m], T["dx"]))
    insets = [grid_of(b, isl.spec["terrain_dx"], f"Catalina {k + 1}") for k, b in enumerate(strips(isl, isl.spec["strips"], isl.spec["terrain_dx"], isl.spec["margin"]))]
    insets += [grid_of(b, dx, name) for name, b, dx in mai.spec["terrain"]]
    insets += [grid_of(b, CELL, name) for name, b in TOWNS]
    parts = [main_t.ravel()]
    for g in insets:
        GX, GY = points(g)
        parts.append(enc(region_heights(GX, GY, g["dx"])).ravel())
        print(f"terrain inset {g['name']}: {g['nx']} by {g['ny']} at {g['dx']:.0f} m")
    T["insets"] = insets
    np.concatenate(parts).tofile(os.path.join(out, "terrain.bin"))

    # ---- the depth: the same shoreline, and water shoaling to it -------------------------------------------
    D = course["depth"]
    scale = D["scale"]
    dold = split(D, np.fromfile(os.path.join(base, "depth.bin"), np.uint8))
    grids = [D] + D.get("insets", [])
    # The tide model's depths, read from the finest of the first bake's grids, land filled from the nearest water.
    filled = []
    for g, a in zip(grids, dold):
        wet = a > 0
        idx = ndimage.distance_transform_edt(~wet, return_distances=False, return_indices=True)
        filled.append(a[idx[0], idx[1]].astype(np.float32) * scale)

    def was(x, y):
        d = ndimage.map_coordinates(filled[0], [(y - D["y0"]) / D["dx"], (x - D["x0"]) / D["dx"]], order=1, mode="nearest")
        for g, f in reversed(list(zip(grids[1:], filled[1:]))):
            # The first inset covering a place is the one read, so the earlier ones win: they are written last.
            m = (x >= g["x0"]) & (y >= g["y0"]) & (x <= g["x0"] + (g["nx"] - 1) * g["dx"]) & (y <= g["y0"] + (g["ny"] - 1) * g["dx"])
            if m.any():
                d[m] = ndimage.map_coordinates(f, [(y[m] - g["y0"]) / g["dx"], (x[m] - g["x0"]) / g["dx"]], order=1, mode="nearest")
        return d

    def depth_cells(x, y, keep):
        """Depth cells at course positions: land where the new land is, the tide model's water shoaling to the new shore."""
        out = keep.copy()
        for r in regions.values():
            m = r.inside(x, y)
            if not m.any():
                continue
            sd = r.read(r.sd, x[m], y[m])
            off = np.maximum(-sd, 0)
            shoal = 1.2 + 0.13 * off if r.name == "island" else 2.0 + 0.15 * off
            d = np.minimum(was(x[m], y[m]), shoal)
            for line, reach, deep in BERTHS:
                d = np.where(to_line(line, x[m], y[m]) < reach, np.maximum(d, deep), d)
            out[m] = np.where(sd > 0, 0, np.clip(np.round(d / scale), 1, 255)).astype(np.uint8)
        return out

    DX, DY = points(D)
    main_d = depth_cells(DX, DY, dold[0])
    dins, dparts = [], []
    for name, b, dx in FINE:
        g = grid_of(b, dx, name)
        GX, GY = points(g)
        dins.append(g)
        dparts.append(depth_cells(GX, GY, np.zeros(GX.shape, np.uint8)).ravel())
    for name, b, dx in mai.spec["depth"]:
        g = grid_of(b, dx, name)
        GX, GY = points(g)
        dins.append(g)
        dparts.append(depth_cells(GX, GY, np.zeros(GX.shape, np.uint8)).ravel())
    # Insets of the first bake that are not re-made here (the Beta field, out among the platforms) stay as they were.
    remade = {"Avalon", "Two Harbors", "Long Beach harbor", "San Pedro breakwater", "Catalina", "Isthmus Cove pier"} | {f[0] for f in FINE}
    for g, a in zip(grids[1:], dold[1:]):
        if g.get("name") in remade or g.get("name", "").startswith("Catalina"):
            continue
        dins.append(g)
        dparts.append(a.ravel())
    for k, b in enumerate(strips(isl, isl.spec["strips"], isl.spec["depth_dx"], isl.spec["depth_margin"])):
        g = grid_of(b, isl.spec["depth_dx"], f"Catalina {k + 1}")
        GX, GY = points(g)
        dins.append(g)
        dparts.append(depth_cells(GX, GY, np.zeros(GX.shape, np.uint8)).ravel())
    for g in dins:
        print(f"depth inset {g['name']}: {g['nx']} by {g['ny']} at {g['dx']:.0f} m")
    D["insets"] = dins
    np.concatenate([main_d.ravel()] + dparts).tofile(os.path.join(out, "depth.bin"))

    # ---- the chart's coastline -----------------------------------------------------------------------------
    import contourpy
    rings = []
    for r in regions.values():
        f = ndimage.gaussian_filter(r.land.astype(np.float32), 1.0)[::2, ::2]
        ys = r.y0 + np.arange(f.shape[0]) * CELL * 2
        xs = r.x0 + np.arange(f.shape[1]) * CELL * 2
        # Filled, so a polygon cut by the region's edge closes along it: the mainland's runs on past the chart's top and right.
        gen = contourpy.contour_generator(xs, ys, f.astype(np.float64), fill_type="OuterOffset")
        polys, offsets = gen.filled(0.5, 10.0)
        for pts, offs in zip(polys, offsets):
            for a, b in zip(offs[:-1], offs[1:]):
                line = pts[a:b]
                if len(line) < 5:
                    continue
                if not np.allclose(line[0], line[-1]):
                    line = np.vstack([line, line[:1]])
                area = 0.5 * abs(np.dot(line[:-1, 0], line[1:, 1]) - np.dot(line[1:, 0], line[:-1, 1]))
                if area < 1500:
                    continue
                s = simplify(line, 12.0)
                rings.append([int(round(v)) for p in s for v in p])
    # The oil islands are drawn as structures, and are land on the chart.
    for s in structures:
        if s["kind"] == "island":
            rings.append([int(round(v)) for k in range(16) for v in (s["x"] + s["r"] * math.cos(k * math.pi / 8), s["y"] + s["r"] * math.sin(k * math.pi / 8))])
    keep = []
    for ring in course["coast"]:
        rx, ry = np.array(ring[0::2], float), np.array(ring[1::2], float)
        if not in_any(rx, ry).all():
            keep.append(ring)
    rings.sort(key=len, reverse=True)
    course["coast"] = rings + keep
    print(f"coast: {len(rings)} rings, {sum(len(r) // 2 for r in rings)} points; {len(keep)} kept from the first bake")

    # ---- the colour: both regions in one picture ---------------------------------------------------------------
    bands, boxes, v = [], [], 0
    for r in regions.values():
        x0, y0, x1, y1 = r.spec["image"]["box"]
        w = r.spec["image"]["width"]
        hgt = int(round(w * (y1 - y0) / (x1 - x0)))
        i0, i1 = int((x0 - r.x0) / CELL), int((x1 - r.x0) / CELL)
        j0, j1 = int((y0 - r.y0) / CELL), int((y1 - r.y0) / CELL)
        c = r.rgb[j0:j1, i0:i1][::-1]
        c = np.clip(c / 255.0, 0, 1) ** 0.85
        grey = c.mean(-1, keepdims=True)
        c = np.clip(grey + (c - grey) * 1.15, 0, 1)
        im = Image.fromarray((c * 255).round().astype(np.uint8), "RGB").resize((w, hgt), Image.LANCZOS)
        bands.append(im)
        boxes.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "u0": 0, "u1": w, "v0": v, "v1": v + hgt})
        v += hgt
    width = max(b.width for b in bands)
    atlas = Image.new("RGB", (width, v))
    for b, box in zip(bands, boxes):
        atlas.paste(b.resize((width, b.height)), (0, box["v0"]))
        atlas.paste(b, (0, box["v0"]))
    for box in boxes:
        # As fractions of the picture, from its left and bottom edges, the way a texture is read.
        box["u0"], box["u1"] = 0, round(box["u1"] / width, 6)
        box["v0"], box["v1"] = round(1 - box["v1"] / v, 6), round(1 - box["v0"] / v, 6)
    atlas.save(os.path.join(out, "land.jpg"), quality=QUALITY, optimize=True, progressive=True)
    T["image"] = {"file": "land.jpg", "boxes": boxes, "source": "Sentinel-2 L2A true colour, 22 August 2025 (Copernicus, from the AWS open-data registry), 10 m, sea and cloud filled with the nearest land's colour."}
    T["source"] = "Terrarium elevation tiles (Mapzen, AWS Open Data) from zoom 13, with the shoreline from Sentinel-2. The island on 40 m insets, Palos Verdes and the Long Beach shore on 50 m insets, 200 m elsewhere."
    json.dump(course, open(os.path.join(out, "course.json"), "w"), separators=(",", ":"))
    sizes = {f: os.path.getsize(os.path.join(out, f)) for f in ("land.jpg", "terrain.bin", "depth.bin", "course.json")}
    print("bytes", sizes, "picture", atlas.size)
    # For the checks and pictures that follow: the 10 m land and heights of each region.
    for r in regions.values():
        np.savez_compressed(os.path.join(work, f"baked_{r.name}.npz"), land=r.land, h=r.h, sd=r.sd, x0=r.x0, y0=r.y0, raw=r.raw)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else sys.argv[2])
