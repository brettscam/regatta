"""Write the Gulf of the Farallones' traffic lanes and its shipping: `features.json` (areas and lights) and `traffic.json`.

The traffic separation scheme off San Francisco has three approaches (northern, western, southern) meeting in a round
precautionary area centred on the sea buoy, where pilots board. Each approach is an inbound lane and an outbound lane
a mile wide with a mile between them. This script lays that out from a few numbers and then timetables ships through it,
so the lanes on the chart and the ships in them cannot disagree. Bearings and distances are from general knowledge of
the chart, not surveyed: check against a chart before trusting a position.

Everything is flat metres east and north of the course origin, which is the Bay's.

Usage: python3 pipeline/lanes.py courses/farallones
"""
import json
import math
import os
import sys

NM = 1852.0
BUOY = (-21342.0, -8896.0)            # the sea buoy "SF", once the San Francisco lightship's station
AREA_R = 6 * NM                       # the precautionary area
CHART = (-66000.0, -41000.0, 6000.0, 59000.0)
# Outward bearing of each approach, degrees true.
APPROACHES = {"northern": 305.0, "western": 247.0, "southern": 170.0}
# The main ship channel across the bar (buoys 1 and 2 to 7 and 8), then the deep water to the bridge and in to the Bay.
CHANNEL = [(-16200.0, -6920.0), (-11900.0, -5750.0)]
INWARD = [(-8300.0, -4500.0), (-5300.0, -2600.0), (-2512.0, -1145.0), (-500.0, -1050.0), (1800.0, -1500.0), (4500.0, -1750.0), (5700.0, -2600.0)]
REFERENCE_HOURS = 2.5


def unit(bearing):
    a = math.radians(bearing)
    return math.sin(a), math.cos(a)


def along(p, bearing, d):
    ux, uy = unit(bearing)
    return (p[0] + ux * d, p[1] + uy * d)


def reach(bearing):
    """How far out along a bearing from the buoy the chart goes, less a margin so a lane's corners stay on it."""
    ux, uy = unit(bearing)
    best = 1e9
    if ux < 0: best = min(best, (CHART[0] + 1500 - BUOY[0]) / ux)
    if ux > 0: best = min(best, (CHART[2] - 1500 - BUOY[0]) / ux)
    if uy < 0: best = min(best, (CHART[1] + 1500 - BUOY[1]) / uy)
    if uy > 0: best = min(best, (CHART[3] - 1500 - BUOY[1]) / uy)
    return best


def rnd(p):
    return [round(p[0]), round(p[1])]


def offset(points, d):
    """A line moved `d` metres to starboard of its own direction."""
    out = []
    for i, p in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        h = math.atan2(b[0] - a[0], b[1] - a[1])
        out.append((p[0] + math.cos(h) * d, p[1] - math.sin(h) * d))
    return out


def straightened(points, most=2500.0):
    """The same line with way points added so that none are more than `most` metres apart.
    The game draws a vessel's track as a smooth curve through her way points. With corners many miles apart that curve swings
    wide of the straight line by a ship's length or more, which is too much in a channel, and where a short leg follows a long
    one it can even loop. Evenly spaced points keep it on the line."""
    out = [points[0]]
    for a, b in zip(points[:-1], points[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / most))
        for k in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return out


def lanes():
    areas = [{
        "id": "pilot-area", "name": "Precautionary area", "kind": "precaution",
        "circle": {"x": round(BUOY[0]), "y": round(BUOY[1]), "r": round(AREA_R)},
        "say": "Six miles round the sea buoy. Ships from three lanes meet here, slow down and take their pilots",
        "warn": "Inside the precautionary area: ships turn here to pick up pilots and line up for the channel. Watch all round",
    }]
    centres = {}
    for name, out_bearing in APPROACHES.items():
        inbound = (out_bearing + 180.0) % 360.0
        far = reach(out_bearing)
        # Starboard side of the inbound heading.
        sx, sy = math.cos(math.radians(inbound)), -math.sin(math.radians(inbound))
        for which, side, toward in (("inbound", 1, inbound), ("outbound", -1, out_bearing)):
            centre = [(BUOY[0] + unit(out_bearing)[0] * d + sx * side * NM, BUOY[1] + unit(out_bearing)[1] * d + sy * side * NM) for d in (far, AREA_R * 0.98)]
            centres[(name, which)] = centre if which == "inbound" else centre[::-1]
            a, b = centre
            corners = [(a[0] + sx * NM / 2, a[1] + sy * NM / 2), (b[0] + sx * NM / 2, b[1] + sy * NM / 2), (b[0] - sx * NM / 2, b[1] - sy * NM / 2), (a[0] - sx * NM / 2, a[1] - sy * NM / 2)]
            areas.append({
                "id": f"{name}-{which}", "name": f"{name.capitalize()} approach, {which}", "kind": "lane", "toward": round(toward),
                "points": [rnd(p) for p in corners],
                "warn": f"In the {name} traffic lane, where ships run {which} at 12 to 20 knots. Cross it at right angles and do not loiter",
            })
        a = along(BUOY, out_bearing, far)
        b = along(BUOY, out_bearing, AREA_R * 0.98)
        corners = [(a[0] + sx * NM / 2, a[1] + sy * NM / 2), (b[0] + sx * NM / 2, b[1] + sy * NM / 2), (b[0] - sx * NM / 2, b[1] - sy * NM / 2), (a[0] - sx * NM / 2, a[1] - sy * NM / 2)]
        areas.append({"id": f"{name}-zone", "name": f"{name.capitalize()} approach separation zone", "kind": "separation", "points": [rnd(p) for p in corners]})
    return areas, centres


# ---- the timetable --------------------------------------------------------------------------------
# Names are made up. (name, model, length, beam, knots, hull colour, lane in, lane out, hour of day she is at the outer end inbound,
# hours in port). Each ship comes in once a day and goes out once a day, so in the season's 36 hours most are seen twice.
# Arrivals bunch on the morning and afternoon tides, as they do: three or four ships an hour then, one or two between.
SHIPS = [
    ("Pacific Meridian", "container", 300, 43, 16, "#14181c", "western", "western", 5.2, 14),
    ("Kowloon Bridge", "container", 335, 46, 17, "#1d3f6e", "western", "northern", 6.4, 13),
    ("Maersk Tamalpais", "container", 294, 32, 15, "#5e8fb0", "southern", "western", 7.1, 11),
    ("Oakland Express", "container", 260, 32, 16, "#b55a1e", "northern", "southern", 8.0, 16),
    ("Sierra Madre", "container", 280, 40, 16, "#2e5d3a", "southern", "southern", 14.3, 13),
    ("Hanjin Carquinez", "container", 304, 40, 17, "#14181c", "western", "western", 15.6, 12),
    ("Tokyo Bay", "container", 320, 44, 16, "#7a2a22", "northern", "western", 16.4, 10),
    ("Polar Endeavour", "tanker", 272, 46, 13, "#1a1c20", "northern", "northern", 6.0, 14),
    ("Valdez Trader", "tanker", 250, 44, 12, "#2a2f36", "northern", "northern", 9.3, 11),
    ("Richmond Star", "tanker", 183, 32, 13, "#7d2c26", "southern", "southern", 7.6, 9),
    ("Martinez Voyager", "tanker", 228, 42, 12, "#1a1c20", "western", "southern", 13.2, 9),
    ("Benicia Spirit", "tanker", 183, 32, 13, "#31445c", "southern", "northern", 17.1, 15),
    ("Golden Bear Carrier", "carcarrier", 200, 32, 17, "#2c5a8a", "western", "western", 5.9, 8),
    ("Hoegh Sausalito", "carcarrier", 199, 36, 18, "#c9cdd0", "southern", "western", 10.4, 7),
    ("Nagoya Highway", "carcarrier", 190, 32, 17, "#2e6b55", "western", "southern", 15.0, 9),
    ("Star of the Pacific", "cruise", 290, 37, 19, "#1f3f77", "southern", "southern", 6.7, 9.5),
    ("Coral Monarch", "cruise", 330, 38, 20, "#c23b2a", "northern", "southern", 5.6, 11),
    ("Matson Farallon", "container", 262, 32, 20, "#1b2f55", "western", "western", 8.6, 12.5),
    ("Bulk Cordell", "tanker", 190, 32, 12, "#5a4a32", "northern", "western", 11.5, 12),
    ("Ever Bonita", "container", 366, 51, 16, "#2f6d3e", "western", "northern", 17.8, 10),
]


def where(points, speed, tau):
    """Position `tau` seconds into a passage along a line of points at a steady speed, or None when she is not on it."""
    if tau < 0:
        return None
    left = tau * speed
    for a, b in zip(points[:-1], points[1:]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if left <= length:
            u = left / length
            return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
        left -= length
    return None


def too_close(placed, pts, speed, start, room):
    """True if a passage would come within `room(x)` metres of one already timetabled."""
    for other_pts, other_speed, other_start in placed:
        for minute in range(0, 24 * 60):
            t = minute * 60.0
            mine = where(pts, speed, (t - start) % 86400.0)
            theirs = where(other_pts, other_speed, (t - other_start) % 86400.0)
            if mine and theirs and math.hypot(mine[0] - theirs[0], mine[1] - theirs[1]) < room(mine[0]):
                return True
    return False


def astern(_x):
    """Room between two ships going the same way: a mile and a half."""
    return 1.6 * NM


def meeting(x):
    """Room between a ship coming in and one going out. In the channel and the Gate they pass port to port a cable and a half apart.
    Out in the pilot area, where their tracks cross, it is half a mile."""
    return 250.0 if x > CHANNEL[0][0] - 800.0 else 1000.0


def ship_routes(centres):
    routes = []
    pilot_in = (BUOY[0] + 1200.0, BUOY[1] - 300.0)
    channel_in = offset(CHANNEL, 140.0)
    inward_in = offset(INWARD, 180.0)
    channel_out = offset(CHANNEL[::-1], 140.0)
    inward_out = offset(INWARD[::-1], 180.0)
    pilot_out = (BUOY[0] + 600.0, BUOY[1] + 1900.0)
    placed = {"in": [], "out": []}
    for name, model, length, beam, knots, colour, lane_in, lane_out, hour, port in SHIPS:
        speed = knots * 0.514444
        slug = name.lower().replace(" ", "-")
        common = {"kind": "ship", "model": model, "length": length, "beam": beam, "speedKt": knots, "mode": "oneway", "every": 86400, "color": colour}
        # Inbound: down the lane, across the pilot area past the buoy, over the bar by the channel, under the bridge.
        pts_in = straightened(centres[(lane_in, "inbound")] + [pilot_in] + channel_in + inward_in)
        # Outbound: the same water the other way, on her own side of it.
        pts_out = straightened(inward_out + channel_out + [pilot_out] + centres[(lane_out, "outbound")])
        dist_in = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts_in[:-1], pts_in[1:]))
        # The season starts at 08:00. A ship that would crowd one already timetabled comes a little later: the pilots space them out, as they do.
        start_in = (hour - 8.0) * 3600.0
        for _ in range(60):
            start_out = start_in + dist_in / speed + port * 3600.0
            if not (too_close(placed["in"], pts_in, speed, start_in, astern) or too_close(placed["out"], pts_out, speed, start_out, astern)
                    or too_close(placed["out"], pts_in, speed, start_in, meeting) or too_close(placed["in"], pts_out, speed, start_out, meeting)):
                break
            start_in += 360.0
        # She is one ship: she must be in and alongside before she sails, and gone before she comes again.
        dist_out = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts_out[:-1], pts_out[1:]))
        away = (start_out - start_in) % 86400.0
        assert dist_in / speed + 3600.0 < away < 86400.0 - dist_out / speed - 3600.0, f"{name} would meet herself: change her hours in port"
        placed["in"].append((pts_in, speed, start_in))
        placed["out"].append((pts_out, speed, start_out))
        bridge = lambda pts: min(range(len(pts)), key=lambda i: math.hypot(pts[i][0] + 2512.0, pts[i][1] + 1145.0))
        for way, pts, start, gate in (("in", pts_in, start_in, bridge(pts_in)), ("out", pts_out, start_out, bridge(pts_out))):
            routes.append({
                "id": f"{slug}-{way}", "name": name, **common,
                # `phase` is how far into her daily cycle she is at the reference time.
                "phase": round((REFERENCE_HOURS * 3600.0 - start) % 86400.0),
                "ends": ["sea", "the Bay"] if way == "in" else ["the Bay", "sea"],
                "lane": lane_in if way == "in" else lane_out,
                "gate": {"at": gate, "name": "the Golden Gate"},
                "points": [rnd(p) for p in pts],
            })
    return routes


# Everything else afloat out here. Loops and shuttles as on the Bay; the tug is a one-way passage like the ships.
OTHERS = [
    {"id": "pilot-boat", "name": "Pilot boat Drake", "kind": "ferry", "model": "pilot", "length": 32, "beam": 8.5, "speedKt": 9, "mode": "loop", "phase": 300, "color": "#1b2a3a",
     "points": [[-20300, -8300], [-19800, -9900], [-21500, -10700], [-23000, -9600], [-22400, -7900]]},
    {"id": "whale-watch", "name": "Salty Lady", "kind": "ferry", "model": "catamaran", "length": 20, "beam": 7.5, "speedKt": 14, "mode": "loop", "phase": 5200, "color": "#0e6f7c",
     "ends": ["San Francisco", "the Farallones"],
     "points": [[3800, -1300], [-500, -900], [-2500, -950], [-5400, -2300], [-8600, -4200], [-12000, -5200], [-16400, -6300], [-30000, -10500], [-44000, -15500], [-48000, -16700], [-50600, -15800], [-51800, -13600], [-50400, -11800], [-47600, -12300], [-40000, -11500], [-25000, -9000], [-16000, -7700], [-11800, -6500], [-8200, -5000], [-5200, -3000], [-2500, -1350], [-400, -1300], [3600, -1800]]},
    {"id": "tug-south", "name": "Tug Sea Otter and barge", "kind": "ship", "model": "tug", "length": 210, "beam": 20, "speedKt": 7.5, "mode": "oneway", "every": 43200, "phase": 14000, "color": "#8a2f24",
     "ends": ["Humboldt Bay", "the south"],
     "points": [[-61000, 58500], [-58500, 40000], [-57000, 20000], [-48000, 2000], [-36000, -14000], [-24000, -28000], [-17500, -40500]]},
    {"id": "tug-north", "name": "Tug Bodega Chief and barge", "kind": "ship", "model": "tug", "length": 190, "beam": 18, "speedKt": 7, "mode": "oneway", "every": 43200, "phase": 30500, "color": "#2b5a44",
     "ends": ["the south", "Humboldt Bay"],
     "points": [[-22500, -40500], [-29000, -28000], [-41000, -13000], [-52500, 3000], [-60000, 20000], [-61500, 40000], [-64000, 58500]]},
    {"id": "fish-cordell", "name": "Lucky Strike", "kind": "ferry", "model": "trawler", "length": 16, "beam": 5, "speedKt": 3.5, "mode": "loop", "phase": 900, "color": "#2f5f8a",
     "points": [[-56000, 6000], [-58500, 9500], [-61000, 7500], [-60500, 3500], [-57500, 2500]]},
    {"id": "fish-farallon", "name": "Maria Elena", "kind": "ferry", "model": "trawler", "length": 14, "beam": 4.6, "speedKt": 3, "mode": "loop", "phase": 2600, "color": "#b9b3a2",
     "points": [[-45500, -17500], [-47500, -19500], [-50500, -18800], [-51500, -17200], [-48500, -16900]]},
    {"id": "fish-duxbury", "name": "Bolinas Belle", "kind": "ferry", "model": "trawler", "length": 12, "beam": 4.2, "speedKt": 3, "mode": "loop", "phase": 400, "color": "#7a2e2a",
     "points": [[-24500, 4200], [-26500, 5600], [-29000, 4800], [-28500, 2600], [-25500, 2200]]},
    {"id": "fish-pillar", "name": "Half Moon", "kind": "ferry", "model": "trawler", "length": 15, "beam": 4.8, "speedKt": 3.5, "mode": "loop", "phase": 1700, "color": "#2d6e63",
     "points": [[-9000, -33000], [-11500, -35500], [-13500, -33500], [-12500, -30500], [-9800, -30200]]},
    {"id": "fish-bodega", "name": "Tides Inn", "kind": "ferry", "model": "trawler", "length": 13, "beam": 4.4, "speedKt": 3, "mode": "loop", "phase": 2100, "color": "#d9d4c4",
     "points": [[-51500, 49500], [-53500, 47500], [-56000, 48500], [-56500, 51000], [-54500, 50500]]},
    {"id": "sail-albatross", "name": "Albatross", "kind": "sail", "model": "sloop", "length": 12, "beam": 3.8, "speedKt": 6, "mode": "loop", "phase": 300, "color": "#f2f0ea",
     "points": [[-4200, -1900], [-6800, -2600], [-8600, -1700], [-9700, 200], [-8500, -2400], [-6000, -2600]]},
    {"id": "sail-shearwater", "name": "Shearwater", "kind": "sail", "model": "sloop", "length": 13, "beam": 4, "speedKt": 6.2, "mode": "loop", "phase": 2200, "color": "#1d2f4f",
     "points": [[-12500, -9500], [-17000, -11500], [-20500, -13500], [-18500, -15500], [-13500, -12500], [-11000, -10500]]},
    {"id": "sail-drake", "name": "Golden Hinde", "kind": "sail", "model": "sloop", "length": 11, "beam": 3.5, "speedKt": 5.4, "mode": "loop", "phase": 900, "color": "#2d6e63",
     "points": [[-43000, 17500], [-40500, 15500], [-37500, 16500], [-38500, 19000], [-41500, 19600]]},
]


def main(out):
    areas, centres = lanes()
    path = os.path.join(out, "features.json")
    features = json.load(open(path)) if os.path.exists(path) else {"areas": [], "lights": []}
    # Lanes are this script's. Everything else in the file is written by hand and kept.
    kept = [a for a in features["areas"] if a["kind"] not in ("lane", "separation", "precaution")]
    features["areas"] = kept + areas
    with open(path, "w") as f:
        parts = []
        for key, value in features.items():
            if key in ("areas", "lights", "handover"):
                parts.append(f' {json.dumps(key)}: [\n' + ",\n".join("  " + json.dumps(v, ensure_ascii=False) for v in value) + "\n ]")
            else:
                parts.append(f" {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)}")
        f.write("{\n" + ",\n".join(parts) + "\n}\n")
    # The tugs cross the lanes. Each is timed so that she is never within a mile of a ship: a tow cannot get out of the way.
    ships = ship_routes(centres)
    for tug in OTHERS:
        if tug["mode"] != "oneway":
            continue
        speed = tug["speedKt"] * 0.514444
        for _ in range(200):
            clear = True
            for minute in range(0, 24 * 60):
                t = minute * 60.0
                mine = where(tug["points"], speed, (t - REFERENCE_HOURS * 3600.0 + tug["phase"]) % tug["every"])
                if not mine:
                    continue
                for r in ships:
                    theirs = where(r["points"], r["speedKt"] * 0.514444, (t - REFERENCE_HOURS * 3600.0 + r["phase"]) % r["every"])
                    if theirs and math.hypot(mine[0] - theirs[0], mine[1] - theirs[1]) < 1.2 * NM:
                        clear = False
                        break
                if not clear:
                    break
            if clear:
                break
            tug["phase"] = (tug["phase"] + 240) % tug["every"]
        else:
            raise SystemExit(f"no clear time for {tug['id']}")
    traffic = {
        "note": "Ships keep to the traffic lanes, the pilot area, the main ship channel over the bar and the deep water under the bridge: over 15 m everywhere. Each ship is two one-way passages a day, in and out. Names are made up. A phase is seconds into the vessel's cycle at referenceHours into the season. Lanes and ships are written by pipeline/lanes.py.",
        "referenceHours": REFERENCE_HOURS,
        "routes": ships + OTHERS,
    }
    with open(os.path.join(out, "traffic.json"), "w") as f:
        f.write("{\n \"note\": " + json.dumps(traffic["note"]) + ",\n \"referenceHours\": " + json.dumps(REFERENCE_HOURS) + ",\n \"routes\": [\n")
        f.write(",\n".join("  " + json.dumps(r) for r in traffic["routes"]))
        f.write("\n ]\n}\n")
    # How busy is it? Ships on passage at each hour of the first day.
    busy = []
    for hour in range(24):
        t = (hour - 8.0) * 3600.0
        n = 0
        for r in traffic["routes"]:
            if r["mode"] != "oneway" or r["kind"] != "ship" or r["model"] == "tug":
                continue
            length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(r["points"][:-1], r["points"][1:]))
            tau = (t - REFERENCE_HOURS * 3600.0 + r["phase"]) % r["every"]
            n += tau < length / (r["speedKt"] * 0.514444)
        busy.append(n)
    print("ships on passage by hour of day, 00 to 23:", busy)
    print(len(traffic["routes"]), "routes;", len(areas), "lane areas")


if __name__ == "__main__":
    main(sys.argv[1])
