"""Fetch what the land of Long Beach to Catalina is baked from: elevation tiles at zoom 13 and one clear Sentinel-2 scene.

Usage: python3 pipeline/catalina/fetch_island.py <work dir> [scene dates, e.g. 20250822,20250830]

Two boxes: the island, and the mainland shore from Palos Verdes to Huntington Beach. The first date is the picture; a
later one only fills in under the first one's clouds (on 22 August a bank of cloud lay off the island's east end).
Elevation: Terrarium tiles (Mapzen, AWS Open Data, s3.amazonaws.com), zoom 13, about 16 m a pixel at this latitude.
Imagery: Sentinel-2 L2A from the AWS open-data bucket `sentinel-cogs` (sentinel-cogs.s3.us-west-2.amazonaws.com), as
cloud-optimised GeoTIFFs read by window over HTTP: only each box's part of the MGRS tiles it lies across (11SLT;
11SLS for the island's east end, 11SMT for the mainland east of Seal Beach). For each box and date: the true-colour
picture (TCI, 10 m), the near infrared (B08, 10 m: water is black in it, so it draws the shoreline), the short-wave infrared (B11, 20 m: black over water and over floating kelp
alike, which the near infrared is not) and the scene classification (SCL, 20 m: cloud).
With no date it lists the summer's scenes with the cloud each has over the island, clearest first.
Needs: numpy, pillow, rasterio.
"""
import math
import os
import subprocess
import sys
import urllib.request

import numpy as np

BOXES = {
    "island": {"lat0": 33.27, "lat1": 33.51, "lon0": -118.64, "lon1": -118.27, "tiles": ("LT", "LS")},
    "mainland": {"lat0": 33.62, "lat1": 33.82, "lon0": -118.46, "lon1": -117.95, "tiles": ("LT", "MT")},
}
ZOOM = 13
S2 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"


def tile_xy(lat, lon, z):
    n = 2 ** z
    return int((lon + 180.0) / 360.0 * n), int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def fetch_tiles(out, box):
    os.makedirs(out, exist_ok=True)
    x0, y0 = tile_xy(box["lat1"], box["lon0"], ZOOM)
    x1, y1 = tile_xy(box["lat0"], box["lon1"], ZOOM)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            dest = os.path.join(out, f"{ZOOM}_{x}_{y}.png")
            if not os.path.exists(dest):
                subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "60", "-o", dest, f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"], check=True)
    print(f"elevation tiles x {x0}..{x1}, y {y0}..{y1}")


def scenes(tile, months=("2025/6", "2025/7", "2025/8", "2025/9")):
    out = []
    for m in months:
        url = f"{S2}/?list-type=2&prefix=sentinel-s2-l2a-cogs/11/S/{tile}/{m}/&delimiter=/"
        text = urllib.request.urlopen(url, timeout=60).read().decode()
        out += [p.split("/")[-2] for p in text.split("<Prefix>")[2:] for p in [p.split("</Prefix>")[0]]]
    return out


def window(tile, scene, box, asset="TCI", level=0):
    """A box's part of one scene, as (array bands x rows x cols, transform, crs)."""
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    y, mth = scene.split("_")[2][:4], str(int(scene.split("_")[2][4:6]))
    url = f"{S2}/sentinel-s2-l2a-cogs/11/S/{tile}/{y}/{mth}/{scene}/{asset}.tif"
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(url, overview_level=level - 1 if level else None) as src:
            b = transform_bounds("EPSG:4326", src.crs, box["lon0"], box["lat0"], box["lon1"], box["lat1"])
            w = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            w = w.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            if w.width < 2 or w.height < 2:
                return None
            return src.read(window=w), src.window_transform(w), src.crs.to_string()


if __name__ == "__main__":
    work = sys.argv[1]
    for name, box in BOXES.items():
        fetch_tiles(os.path.join(work, "tiles13"), box)
    if len(sys.argv) < 3:
        rows = []
        for scene in scenes("LT"):
            try:
                got = window("LT", scene, BOXES["island"], "SCL", 0)
            except Exception:  # a scene with no such asset, or a part upload
                continue
            if got is None:
                continue
            scl = got[0][0]
            valid = scl > 0
            cloud = np.isin(scl, [3, 8, 9, 10]) & valid
            rows.append((float(cloud.sum()) / max(1, valid.sum()), float(valid.mean()), scene))
            print(f"{scene}: cloud {rows[-1][0]:.3f}, covered {rows[-1][1]:.2f}", flush=True)
        rows.sort()
        print("clearest:", [r[2] for r in rows if r[1] > 0.95][:5])
        sys.exit(0)
    for date in sys.argv[2].split(","):
        for name, box in BOXES.items():
            for tile in box["tiles"]:
                scene = next((s for s in scenes(tile, (f"{date[:4]}/{int(date[4:6])}",)) if f"_{date}_" in s), None)
                if not scene:
                    print("no scene on", date, "for", tile)
                    continue
                for asset in ("TCI", "B08", "B11", "SCL"):
                    dest = os.path.join(work, f"{name}_{asset}_{tile}_{date}.npz")
                    if os.path.exists(dest):
                        continue
                    got = window(tile, scene, box, asset)
                    if got is None:
                        continue
                    arr, tr, crs = got
                    np.savez_compressed(dest, rgb=arr, transform=np.array(tr)[:6], crs=crs, scene=scene)
                    print(name, asset, tile, scene, arr.shape, crs, flush=True)
