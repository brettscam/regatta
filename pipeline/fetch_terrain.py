"""Download elevation tiles (Terrarium format, Mapzen/AWS open data) covering the course region.

Usage: python3 fetch_terrain.py <course> <tile dir>
"""
import math
import os
import subprocess
import sys

import course as courses

ZOOM = 12


def tile_xy(lat: float, lon: float, z: int):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


if __name__ == "__main__":
    box = courses.load(sys.argv[1]).spec["tileBox"]
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    x0, y0 = tile_xy(box["lat1"], box["lon0"], ZOOM)
    x1, y1 = tile_xy(box["lat0"], box["lon1"], ZOOM)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            dest = os.path.join(out, f"{ZOOM}_{x}_{y}.png")
            if not os.path.exists(dest):
                url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"
                subprocess.run(["curl", "-sS", "-f", "--retry", "4", "-m", "60", "-o", dest, url], check=True)
    print(f"tiles x {x0}..{x1}, y {y0}..{y1} in {out}")
