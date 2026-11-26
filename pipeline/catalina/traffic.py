# Writes courses/catalina/ data from hand-kept tables. Run from the repository root:  python3 pipeline/catalina/traffic.py .
# Then: npx vite-node scripts/stamp.ts catalina; npx vite-node scripts/legs.ts catalina files; npx vite-node scripts/shore.ts catalina
# Everything here is from general knowledge of the place, not from a chart. See the note at the top of features.json.
import json, math, sys, re
root = sys.argv[1]
NM = 1852
KT = 0.514444
def off(a, b, o):
    """The line a->b moved `o` metres to its right."""
    dx, dy = b[0] - a[0], b[1] - a[1]; n = math.hypot(dx, dy); rx, ry = dy / n, -dx / n
    return [round(a[0] + rx * o), round(a[1] + ry * o)], [round(b[0] + rx * o), round(b[1] + ry * o)]
def along(a, b, n):
    return [[round(a[0] + (b[0] - a[0]) * k / n), round(a[1] + (b[1] - a[1]) * k / n)] for k in range(n + 1)]
W0, W1, W2 = [1500, 12800], [-15500, 16000], [-35000, 24500]
S0, S1 = [9800, 8800], [18000, -13730]
LW = 2 * NM / 2 + NM / 2
LS = 1.5 * NM / 2 + NM / 2
# Lane centre lines, as a ship runs them.
w_out_1 = off(W0, W1, LW); w_out_2 = off(W1, W2, LW)
w_in_2 = off(W2, W1, LW); w_in_1 = off(W1, W0, LW)
s_out = off(S0, S1, LS); s_in = off(S1, S0, LS)
west_in = along(w_in_2[0], w_in_2[1], 4) + along(w_in_1[0], w_in_1[1], 4)[1:]
west_out = along(w_out_1[0], w_out_1[1], 4) + along(w_out_2[0], w_out_2[1], 4)[1:]
south_in = along(s_in[0], s_in[1], 5)
south_out = along(s_out[0], s_out[1], 5)
QG = [10750, 19260]
AG = [4830, 17750]
lb_berth = [[10380, 19600], [9500, 19950], [8900, 20350], [8650, 20560]]
la_berth = [[5120, 18250], [5300, 18700], [4950, 19250]]
def phase(leave_h, cycle=86400): return int((-leave_h * 3600) % cycle)
def length(pts): return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
routes = []
def ship(idp, name, sign, model, L, B, kt, color, way_in, gate_in, t_in, way_out, gate_out, t_out, port):
    """t_in and t_out are hours into the season (05:00 PDT) at which she comes on to the chart inbound and lets go outbound."""
    gname = 'Queens Gate' if port == 'Long Beach' else 'Angels Gate'
    gate = QG if port == 'Long Beach' else AG
    berth = lb_berth if port == 'Long Beach' else la_berth
    turn_in = {('west', 'Long Beach'): [[6500, 14900], [9900, 17600]], ('west', 'Los Angeles'): [[3900, 15300], [4650, 16900]],
               ('south', 'Long Beach'): [[11200, 13500], [10800, 17300]], ('south', 'Los Angeles'): [[9500, 13500], [5800, 16300]]}
    turn_out = {('west', 'Long Beach'): [[10400, 17600], [7000, 16400], [4000, 16200]], ('west', 'Los Angeles'): [[4500, 16700], [2600, 16300]],
                ('south', 'Long Beach'): [[10200, 17300], [9000, 13000]], ('south', 'Los Angeles'): [[5200, 16500], [7600, 12500]]}
    lane_in = west_in if way_in == 'west' else south_in
    lane_out = west_out if way_out == 'west' else south_out
    pin = lane_in + turn_in[(way_in, port)] + [gate] + berth
    pout = berth[::-1] + [gate] + turn_out[(way_out, port)] + lane_out
    base = {'name': name, 'sign': sign, 'kind': 'ship', 'model': model, 'length': L, 'beam': B, 'speedKt': kt, 'mode': 'oneway', 'every': 86400, 'color': color}
    routes.append({'id': f'{idp}-in', **base, 'phase': phase(t_in), 'ends': ['sea', port], 'lane': f'{way_in}ern approach', 'gate': {'at': pin.index(gate), 'name': gname}, 'points': pin})
    routes.append({'id': f'{idp}-out', **base, 'phase': phase(t_out), 'ends': [port, 'sea'], 'lane': f'{way_out}ern approach', 'gate': {'at': pout.index(gate), 'name': gname}, 'points': pout})

ship('pacific-gaviota', 'Pacific Gaviota', 'the motor vessel Pacific Gaviota', 'container', 335, 46, 15, '#14181c', 'west', QG, 0.3, 'west', QG, 12.5, 'Long Beach')
ship('kaohsiung-trader', 'Kaohsiung Trader', 'the motor vessel Kaohsiung Trader', 'container', 300, 43, 14, '#1d3f6e', 'west', AG, 4.2, 'south', AG, 15.5, 'Los Angeles')
ship('cape-dume', 'Cape Dume', 'the tanker Cape Dume', 'tanker', 250, 44, 12, '#5a1f1a', 'south', QG, 7.5, 'south', QG, 20.5, 'Long Beach')
ship('camellia-highway', 'Camellia Highway', 'the car carrier Camellia Highway', 'carcarrier', 200, 32, 14, '#1f5fa8', 'south', AG, 2.4, 'west', AG, 9.6, 'Los Angeles')

# The Catalina boats: fast catamarans, about an hour each way.
avalon = [[10400, 22850], [10560, 22300], [10770, 20600], QG, [10690, 18000], [6500, 5000], [300, -17000], [-1650, -22250], [-2012, -22792]]
routes.append({'id': 'ferry-avalon', 'name': 'Avalon Jet', 'sign': 'the Catalina boat Avalon Jet', 'kind': 'ferry', 'model': 'catamaran', 'length': 44, 'beam': 12, 'speedKt': 29, 'mode': 'shuttle', 'dwell': 2700, 'phase': phase(1.0, 1), 'color': '#1c4f9c', 'ends': ['Long Beach', 'Avalon'], 'gate': {'at': 3, 'name': 'Queens Gate'}, 'points': avalon})
isthmus = [[4950, 19250], [5300, 18700], [5120, 18250], AG, [4350, 16500], [-8000, 0], [-16800, -10300], [-18235, -11905]]
routes.append({'id': 'ferry-isthmus', 'name': 'Isthmus Express', 'sign': 'the Catalina boat Isthmus Express', 'kind': 'ferry', 'model': 'catamaran', 'length': 38, 'beam': 11, 'speedKt': 27, 'mode': 'shuttle', 'dwell': 7200, 'phase': 0, 'color': '#b5332a', 'ends': ['San Pedro', 'Two Harbors'], 'gate': {'at': 3, 'name': 'Angels Gate'}, 'points': isthmus})

# A tug and her barge, working between the two ports inside the breakwater.
routes.append({'id': 'tug-point-fermin', 'name': 'Point Fermin', 'sign': 'the tug Point Fermin, with a barge in tow', 'kind': 'ferry', 'model': 'tug', 'length': 90, 'beam': 14, 'speedKt': 6.5, 'mode': 'shuttle', 'dwell': 2400, 'hideAtEnds': True, 'phase': 900, 'color': '#b5332a', 'ends': ['Los Angeles', 'Long Beach'], 'points': [[5050, 19000], [5900, 18950], [8000, 19650], [9700, 20150], [10200, 20000]]})

# The sportfishing boats: out at first light, on the grounds all morning, home after noon. Hidden while they lie at the landing.
def party(pid, name, color, kt, leave_h, fish_h, home, way, grounds):
    pts = way
    T = length(pts) / (kt * KT)
    T += min(45, T * 0.25)
    dwell = int(fish_h * 3600)
    routes.append({'id': pid, 'name': name, 'sign': f'the sportfisher {name}', 'kind': 'ferry', 'model': 'trawler', 'length': 24, 'beam': 7, 'speedKt': kt, 'mode': 'shuttle', 'dwell': dwell, 'dwellHome': int(86400 - 2 * T - dwell), 'hideAtEnds': 'first', 'phase': phase(leave_h), 'color': color, 'ends': [home, grounds], 'points': pts})
party('fish-horseshoe', 'Morning Bite', '#e8e4d8', 10, 0.6, 4.5, 'Alamitos Bay', [[15650, 20350], [15750, 19900], [15750, 19350], [13500, 16800], [7300, 12950]], 'the Horseshoe Kelp')
party('fish-rigs', 'Yellowtail Queen', '#2f5f8a', 11, 0.3, 5, 'Long Beach', [[10450, 22750], [10560, 22300], [10770, 20600], QG, [11300, 17500], [14500, 6500], [15500, 3950]], 'the rigs')
party('fish-island', 'Calico Kid', '#b9b3a2', 12, 0.1, 5.5, 'San Pedro', [[4950, 19250], [5300, 18700], [5120, 18250], AG, [4300, 16500], [-2000, -5000], [-4800, -14900]], 'the island')

# The cruise ship: in from the south-east after breakfast, at anchor off Avalon all day, gone by evening.
cruise = [[24000, -31000], [12000, -27000], [3000, -23200], [-900, -21500]]
T = length(cruise) / (11 * KT); T += min(45, T * 0.25)
routes.append({'id': 'cruise-avalon', 'name': 'Coral Empress', 'sign': 'the cruise ship Coral Empress', 'kind': 'ship', 'model': 'cruise', 'length': 270, 'beam': 34, 'speedKt': 11, 'mode': 'shuttle', 'dwell': 34200, 'dwellHome': int(86400 - 2 * T - 34200), 'hideAtEnds': 'first', 'phase': phase(1.4), 'color': '#f2f0ea', 'ends': ['sea', 'the anchorage off Avalon'], 'points': cruise})

def grade(pts):
    """Way points for a smooth curve: a long leg beside a short one is cut into pieces that grow from the short end, so the spline through them does not swing wide."""
    out = [list(pts[0])]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        before = math.hypot(a[0] - pts[i - 1][0], a[1] - pts[i - 1][1]) if i > 0 else 700
        after = math.hypot(pts[i + 2][0] - b[0], pts[i + 2][1] - b[1]) if i + 2 < len(pts) else 700
        cuts = []
        d, step = 0, max(500, min(before, 3000)) * 1.8
        while d + step < L / 2:
            d += step; cuts.append(d); step = min(step * 1.8, 5000)
        back = []
        d, step = 0, max(500, min(after, 3000)) * 1.8
        while d + step < L / 2:
            d += step; back.append(L - d); step = min(step * 1.8, 5000)
        for c in cuts + back[::-1]:
            out.append([round(a[0] + (b[0] - a[0]) * c / L), round(a[1] + (b[1] - a[1]) * c / L)])
        out.append(list(b))
    return out
for r in routes:
    gate = r['points'][r['gate']['at']] if 'gate' in r else None
    r['points'] = grade(r['points'])
    if gate is not None: r['gate']['at'] = r['points'].index(list(gate))

out = {
  'note': 'Written by hand, with made-up names. Ships keep to the lanes of features.json and use the two gates; each is one passage in and one out a day. The Catalina boats are fast catamarans, about an hour each way. A phase is seconds into the vessel\'s cycle at referenceHours into the season, which starts at 05:00 PDT.',
  'referenceHours': 0, 'station': 'San Pedro Radio', 'routes': routes,
}
s = json.dumps(out, indent=1, ensure_ascii=False)
s = re.sub(r'\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]', r'[\1, \2]', s)
open(root + '/courses/catalina/traffic.json', 'w').write(s + '\n')
print(len(routes), 'routes')

# ---- races ----
races = json.load(open(root + '/courses/catalina/races.json'))
races = [r for r in races if r['id'] == 'to-avalon']
# The gate's mark lies just outside the wall, so a boat beating out against a southerly is through the gap before she need tack.
for r in races:
    for m in r['marks']:
        if m['name'] == 'Queens Gate': m['y'] = 19100
races += [
 {'id': 'to-isthmus', 'name': 'Long Beach to the Isthmus', 'blurb': 'Out through Queens Gate and west-south-west across the channel to Two Harbors, 25 miles, crossing both shipping lanes. Bird Rock and Ship Rock mark the way in.',
  'marks': [{'name': 'Queens Gate', 'x': 10750, 'y': 19100}, {'name': 'Mid channel', 'x': -4000, 'y': 4000}, {'name': 'Off the Isthmus', 'x': -17200, 'y': -10600}, {'name': 'Isthmus Cove', 'x': -18100, 'y': -11600}]},
 {'id': 'avalon-isthmus', 'name': 'Avalon to the Isthmus', 'blurb': 'Up the front side of the island from the Casino, a mile off the cliffs all the way, to Isthmus Cove. Fourteen miles in the lee, where the breeze comes and goes. The marks keep you out of the calms under the cliffs: there is no wind in there, and nothing to anchor in.',
  'marks': [{'name': 'Avalon', 'x': -1300, 'y': -22500}, {'name': 'Off Hamilton Cove', 'x': -900, 'y': -20700}, {'name': 'Off Frog Rock', 'x': -2000, 'y': -18600}, {'name': 'Off Willow Cove', 'x': -3200, 'y': -16400}, {'name': 'Off Long Point', 'x': -4500, 'y': -14400},
            {'name': 'Off Goat Harbor', 'x': -7200, 'y': -13300}, {'name': 'Off Empire Landing', 'x': -10000, 'y': -12100}, {'name': "Off Ripper's Cove", 'x': -12800, 'y': -10900}, {'name': 'Off Blue Cavern', 'x': -15500, 'y': -9900}, {'name': 'Off the Isthmus', 'x': -17300, 'y': -10100}, {'name': 'Isthmus Cove', 'x': -18100, 'y': -11600}]},
 {'id': 'platforms', 'name': 'Round the platforms', 'blurb': 'From Queens Gate out to the Beta field: leave Edith and Ellen to port, round outside Eureka and come back up past Elly. Twenty-four miles, the rigs growing out of the haze for an hour before you reach them. Every mark is a quarter of a mile or more off the steel: they are solid.',
  'marks': [{'name': 'Queens Gate', 'x': 10750, 'y': 19100}, {'name': 'Off Edith', 'x': 14200, 'y': 5000}, {'name': 'West of Ellen', 'x': 15000, 'y': 3200}, {'name': 'South of Eureka', 'x': 16700, 'y': 300}, {'name': 'East of Eureka', 'x': 18000, 'y': 1400}, {'name': 'East of Elly', 'x': 17000, 'y': 4300}, {'name': 'Queens Gate', 'x': 10750, 'y': 19100}]},
]
s = json.dumps(races, indent=2, ensure_ascii=False)
s = re.sub(r'\{\s*"name": ("[^"]*"),\s*"x": (-?\d+),\s*"y": (-?\d+)\s*\}', r'{ "name": \1, "x": \2, "y": \3 }', s)
open(root + '/courses/catalina/races.json', 'w').write(s + '\n')

starts = json.load(open(root + '/courses/catalina/starts.json'))
for st in starts:
    for m in st['route']:
        if m['name'] == 'Queens Gate': m['y'] = 19100
    if st['id'] == 'alamitos' and st['route'][0]['name'] == 'Queens Gate':
        st['route'].insert(0, {'name': 'Inside the breakwater', 'x': 11250, 'y': 19850})
starts.append({'id': 'rigs', 'name': 'The oil platforms', 'where': 'Between Platform Edith and Platform Ellen, eight miles out from Long Beach',
  'teaches': 'The rigs. Four steel platforms in deep water at the edge of the shipping lanes: sail round them close, mind the legs, and look for yellowtail in their shade.',
  'x': 14600, 'y': 4300, 'route': [{'name': 'West of Ellen', 'x': 15000, 'y': 3200}, {'name': 'South of Eureka', 'x': 16700, 'y': 300}, {'name': 'East of Eureka', 'x': 18000, 'y': 1400}, {'name': 'East of Elly', 'x': 17000, 'y': 4300}]})
starts = [s for s in starts if s['id'] != 'rigs'] + [s for s in starts if s['id'] == 'rigs'][-1:]
open(root + '/courses/catalina/starts.json', 'w').write(json.dumps(starts, indent=2, ensure_ascii=False) + '\n')
