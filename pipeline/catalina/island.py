"""Santa Catalina Island from real data: its land, its shoreline and its colour, written over the first bake's.

Usage: python3 pipeline/catalina/island.py <work dir from fetch_island.py> courses/catalina
Then:  npx vite-node scripts/stamp.ts catalina

The first bake drew the island on a 200 m grid with the tide model's mesh for a shoreline. This replaces, for the
island only (the mainland, the wind, the stream and the tide are untouched):
  - the land: one inset at 32 m over the whole island from Terrarium zoom 13 elevation, true heights;
  - the shoreline: land is where that elevation stands above half a metre. The depth chart's land is re-made to the
    same line on a 64 m inset over the island, with 10 m insets over Avalon Bay and the pier at Two Harbors so their
    piers can be charted (scripts/stamp.ts) and so what is drawn, what is charted and where a boat grounds agree;
  - the depth near the island: the tide model's, where it had water, shoaling to the new shore;
  - the chart's coastline rings for the island;
  - the colour: `land.jpg`, a Sentinel-2 true-colour scene (22 August 2025) over the island, sea masked out.
Needs numpy, scipy, contourpy, pillow, rasterio.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

BOX = (-29600.0, -28600.0)          # south-west corner of every island grid
TERRAIN_DX, TERRAIN_N = 32.0, (923, 676)
DEPTH_DX, DEPTH_N = 64.0, (462, 338)
FINE = [("Avalon harbor", (-2600.0, -23100.0, -1900.0, -22150.0), 10.0), ("Isthmus Cove pier", (-18520.0, -12180.0, -18100.0, -11840.0), 10.0)]
IMAGE = (2048, 1500)
DRY = 0.5


def load_dem(tile_dir, zoom=13):
    names = [f for f in os.listdir(tile_dir) if f.startswith(f"{zoom}_")]
    xs = sorted({int(f.split("_")[1]) for f in names})
    ys = sorted({int(f.split("_")[2].split(".")[0]) for f in names})
    big = np.zeros((len(ys) * 256, len(xs) * 256), np.float32)
    for f in names:
        x, y = int(f.split("_")[1]), int(f.split("_")[2].split(".")[0])
        a = np.asarray(Image.open(os.path.join(tile_dir, f)).convert("RGB"), np.float32)
        big[(y - ys[0]) * 256:(y - ys[0] + 1) * 256, (x - xs[0]) * 256:(x - xs[0] + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    n = 2 ** zoom * 256

    def sample(lat, lon):
        px = (lon + 180.0) / 360.0 * n - xs[0] * 256 - 0.5
        py = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n - ys[0] * 256 - 0.5
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


def main(work, out):
    course = json.load(open(os.path.join(out, "course.json")))
    lat0, lon0 = course["origin"]["lat"], course["origin"]["lon"]
    mlat = 6371008.8 * math.pi / 180
    mlon = mlat * math.cos(math.radians(lat0))
    dem = load_dem(os.path.join(work, "tiles13"))
    height = lambda x, y: dem(lat0 + y / mlat, lon0 + x / mlon)
    grid = lambda x0, y0, dx, nx, ny: np.meshgrid(x0 + np.arange(nx) * dx, y0 + np.arange(ny) * dx)

    from rasterio.warp import transform as warp
    scenes = [np.load(os.path.join(work, f"tci_{tile}.npz")) for tile in ("LT", "LS")]

    def sample_rgb(gx, gy):
        """The picture at course positions: colours 0 to 255, and where there is any."""
        e, nth = warp("EPSG:4326", "EPSG:32611", (lon0 + gx / mlon).ravel(), (lat0 + gy / mlat).ravel())
        e, nth = np.asarray(e).reshape(gx.shape), np.asarray(nth).reshape(gx.shape)
        rgb = np.zeros(gx.shape + (3,), np.float32)
        got = np.zeros(gx.shape, bool)
        for z in scenes:
            a, tr = z["rgb"].astype(np.float32), z["transform"]
            col, row = (e - tr[2]) / tr[0] - 0.5, (nth - tr[5]) / tr[4] - 0.5
            ok = (col >= 0) & (row >= 0) & (col <= a.shape[2] - 1) & (row <= a.shape[1] - 1)
            samp = np.stack([ndimage.map_coordinates(a[k], [row, col], order=1, mode="nearest") for k in range(3)], -1)
            ok &= samp.sum(-1) > 0
            rgb[ok & ~got] = samp[ok & ~got]
            got |= ok
        return rgb, got

    # ---- the land ------------------------------------------------------------------------------------
    T = course["terrain"]
    tmax = T["max"]
    nx, ny = TERRAIN_N
    X, Y = grid(BOX[0], BOX[1], TERRAIN_DX, nx, ny)
    H = height(X, Y)
    H[[0, -1], :] = 0
    H[:, [0, -1]] = 0
    # The tiles' sea floor rings above zero in patches off the island, so height alone does not say where the land is.
    # The picture does: sea is dark and blue in it. Land is ground above half a metre that is not sea in the picture;
    # away from the island itself only a rock small enough to be one is kept (Bird Rock, Ship Rock), not a patch of cloud.
    seen, got = sample_rgb(X, Y)
    r, b = seen[..., 0] / 255.0, seen[..., 2] / 255.0
    sea = got & (b > r * 1.1) & (r < 0.25)
    land = (H > DRY) & ~sea
    land = ndimage.binary_opening(land, np.ones((2, 2), bool)) | (land & ndimage.binary_dilation(ndimage.binary_opening(land, np.ones((3, 3), bool))))
    lab, n = ndimage.label(land)
    sizes = ndimage.sum(land, lab, range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    near = ndimage.distance_transform_edt(lab != biggest) * TERRAIN_DX
    for i, size in enumerate(sizes):
        if i + 1 == biggest:
            continue
        where = lab == i + 1
        if size > 30 or size < 2 or near[where].min() > 2500:
            land[where] = False
    H = np.where(land, H, 0)
    print(f"island: highest {H.max():.0f} m, {land.sum() * TERRAIN_DX ** 2 / 1e6:.1f} km2 of land, {n} pieces")
    enc = lambda h: np.clip(np.round(np.sqrt(np.clip(h, 0, tmax) / tmax) * 255), 0, 255).astype(np.uint8)
    old = np.fromfile(os.path.join(out, "terrain.bin"), np.uint8)
    main_t = old[:T["nx"] * T["ny"]].reshape(T["ny"], T["nx"]).copy()
    MX, MY = grid(T["x0"], T["y0"], T["dx"], T["nx"], T["ny"])
    inside = (MX >= BOX[0]) & (MX <= BOX[0] + (nx - 1) * TERRAIN_DX) & (MY >= BOX[1]) & (MY <= BOX[1] + (ny - 1) * TERRAIN_DX)
    hm = height(MX, MY)
    main_t[inside] = enc(np.where(hm > DRY, hm, 0))[inside]
    parts, kept, o = [main_t.ravel()], [], T["nx"] * T["ny"]
    for g in T.get("insets", []):
        cells = old[o:o + g["nx"] * g["ny"]]
        o += g["nx"] * g["ny"]
        if g.get("name") in ("Avalon", "Two Harbors", "Catalina"):
            continue
        kept.append(g)
        parts.append(cells)
    hb = enc(H)
    hb[land & (hb == 0)] = 1
    kept.append({"x0": BOX[0], "y0": BOX[1], "dx": TERRAIN_DX, "nx": nx, "ny": ny, "name": "Catalina"})
    parts.append(hb.ravel())
    T["insets"] = kept
    np.concatenate(parts).tofile(os.path.join(out, "terrain.bin"))

    # ---- the depth: the same shoreline, and water shoaling to it -----------------------------------------
    D = course["depth"]
    scale = D["scale"]
    oldd = np.fromfile(os.path.join(out, "depth.bin"), np.uint8)
    main_d = oldd[:D["nx"] * D["ny"]].reshape(D["ny"], D["nx"]).copy()
    # The tide model's depths with its land filled from the nearest water, to read anywhere.
    wet = main_d > 0
    idx = ndimage.distance_transform_edt(~wet, return_distances=False, return_indices=True)
    filled = main_d[idx[0], idx[1]].astype(np.float32) * scale
    was = lambda x, y: ndimage.map_coordinates(filled, [(y - D["y0"]) / D["dx"], (x - D["x0"]) / D["dx"]], order=1, mode="nearest")
    # Distance off the new shore, metres, on the land grid.
    off = ndimage.distance_transform_edt(~land) * TERRAIN_DX
    off_at = lambda x, y: ndimage.map_coordinates(off, [(y - BOX[1]) / TERRAIN_DX, (x - BOX[0]) / TERRAIN_DX], order=1, mode="nearest")
    land_at = lambda x, y: ndimage.map_coordinates(land.astype(np.float32), [(y - BOX[1]) / TERRAIN_DX, (x - BOX[0]) / TERRAIN_DX], order=1, mode="constant") > 0.5

    def depth_cells(x, y):
        d = np.minimum(was(x, y), 1.2 + 0.13 * off_at(x, y))
        return np.where(land_at(x, y), 0, np.clip(np.round(d / scale), 1, 255)).astype(np.uint8)
    DX, DY = grid(D["x0"], D["y0"], D["dx"], D["nx"], D["ny"])
    ins = (DX >= BOX[0]) & (DX <= BOX[0] + (nx - 1) * TERRAIN_DX) & (DY >= BOX[1]) & (DY <= BOX[1] + (ny - 1) * TERRAIN_DX)
    main_d[ins] = depth_cells(DX, DY)[ins]
    parts, kept, o = [main_d.ravel()], [], D["nx"] * D["ny"]
    for g in D.get("insets", []):
        cells = oldd[o:o + g["nx"] * g["ny"]]
        o += g["nx"] * g["ny"]
        if g.get("name") in ("Avalon", "Two Harbors", "Catalina") or g.get("name") in [f[0] for f in FINE]:
            continue
        kept.append(g)
        parts.append(cells)
    # The fine harbor insets come before the island's: the first inset that covers a place is the one read.
    for name, (x0, y0, x1, y1), dx in FINE:
        gx, gy = int(round((x1 - x0) / dx)) + 1, int(round((y1 - y0) / dx)) + 1
        FX, FY = grid(x0, y0, dx, gx, gy)
        kept.append({"x0": x0, "y0": y0, "dx": dx, "nx": gx, "ny": gy, "name": name})
        parts.append(depth_cells(FX, FY).ravel())
    gx, gy = DEPTH_N
    FX, FY = grid(BOX[0], BOX[1], DEPTH_DX, gx, gy)
    kept.append({"x0": BOX[0], "y0": BOX[1], "dx": DEPTH_DX, "nx": gx, "ny": gy, "name": "Catalina"})
    parts.append(depth_cells(FX, FY).ravel())
    D["insets"] = kept
    np.concatenate(parts).tofile(os.path.join(out, "depth.bin"))

    # ---- the chart's coastline ---------------------------------------------------------------------------
    import contourpy
    gen = contourpy.contour_generator(X, Y, np.where(land, H, -3.0).astype(np.float64))
    rings = []
    for line in gen.lines(DRY):
        if len(line) < 5:
            continue
        area = 0.5 * abs(np.dot(line[:-1, 0], line[1:, 1]) - np.dot(line[1:, 0], line[:-1, 1]))
        if area < 3000:
            continue
        s = simplify(line, 20.0)
        rings.append([int(round(v)) for p in s for v in p])
    x1, y1 = BOX[0] + (nx - 1) * TERRAIN_DX, BOX[1] + (ny - 1) * TERRAIN_DX
    keep = [r for r in course["coast"] if not all(BOX[0] <= r[k] <= x1 and BOX[1] <= r[k + 1] <= y1 for k in range(0, len(r), 2))]
    rings.sort(key=len, reverse=True)
    course["coast"] = rings + keep
    print(f"coast: {len(rings)} island rings, {sum(len(r) // 2 for r in rings)} points")

    # ---- the colour --------------------------------------------------------------------------------------
    W, Hh = IMAGE
    ix = BOX[0] + (np.arange(W) + 0.5) / W * (x1 - BOX[0])
    iy = y1 - (np.arange(Hh) + 0.5) / Hh * (y1 - BOX[1])
    IX, IY = np.meshgrid(ix, iy)
    rgb, got = sample_rgb(IX, IY)
    isl = land_at(IX, IY) & got
    # Natural colour, a little lifted: the scene's own 8-bit rendering is dark over dry land.
    c = np.clip(rgb / 255.0, 0, 1) ** 0.82
    grey = c.mean(-1, keepdims=True)
    c = np.clip(grey + (c - grey) * 1.25, 0, 1)
    mean = c[isl].mean(0)
    # The sea is masked: land's colour is carried a few pixels out so the shore does not fringe, and beyond is the island's mean.
    dist, (ri, ci) = ndimage.distance_transform_edt(~isl, return_indices=True)
    c = np.where((dist <= 6)[..., None], c[ri, ci], mean)
    img = Image.fromarray((c * 255).round().astype(np.uint8), "RGB")
    img.save(os.path.join(out, "land.jpg"), quality=74, optimize=True)
    T["image"] = {"file": "land.jpg", "x0": BOX[0], "y0": BOX[1], "x1": x1, "y1": y1, "source": "Sentinel-2 L2A true colour, 22 August 2025 (Copernicus, from the AWS open-data registry)."}
    T["source"] = "Terrarium elevation tiles (Mapzen, AWS Open Data). The island from zoom 13, on a 32 m grid."
    json.dump(course, open(os.path.join(out, "course.json"), "w"), separators=(",", ":"))
    print("land.jpg", os.path.getsize(os.path.join(out, "land.jpg")), "bytes; terrain.bin", os.path.getsize(os.path.join(out, "terrain.bin")), "depth.bin", os.path.getsize(os.path.join(out, "depth.bin")))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
