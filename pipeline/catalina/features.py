# Writes courses/catalina/ data from hand-kept tables. Run from the repository root:  python3 pipeline/catalina/features.py .
# Then: npx vite-node scripts/stamp.ts catalina; npx vite-node scripts/legs.ts catalina files; npx vite-node scripts/shore.ts catalina
# Everything here is from general knowledge of the place, not from a chart. See the note at the top of features.json.
import json, math, sys, re
root = sys.argv[1]
c = json.load(open(root + '/courses/catalina/course.json'))
MLAT = 6371008.8 * math.pi / 180
MLON = MLAT * math.cos(math.radians(c['origin']['lat']))
def at(lat, lon): return [round((lon - c['origin']['lon']) * MLON), round((lat - c['origin']['lat']) * MLAT)]

def lane(a, b, off, width):
    """A lane beside the line a->b: its centre `off` metres to the right of the line, `width` wide. Corners in the order the chart wants: start, end, end, start."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy); rx, ry = dy / n, -dx / n
    p = lambda q, o: [round(q[0] + rx * o), round(q[1] + ry * o)]
    return [p(a, off - width / 2), p(b, off - width / 2), p(b, off + width / 2), p(a, off + width / 2)]
def bearing(a, b): return round(math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360)

NM = 1852
areas = []
# ---- the approaches to Los Angeles and Long Beach ----
W0, W1, W2 = [1500, 12800], [-15500, 16000], [-35000, 24500]
S0, S1 = [9800, 8800], [18000, -13730]
SEP_W, SEP_S = 2 * NM, 1.5 * NM
def scheme(name, idp, pts, sep, out_say, in_say):
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        # Leaving the port a ship keeps to the right of the line; arriving, to the right of the line the other way.
        o = {'id': f'{idp}-out-{i+1}', 'name': f'{name}, outbound lane', 'kind': 'lane', 'toward': bearing(a, b), 'points': lane(a, b, sep / 2 + NM / 2, NM)}
        n = {'id': f'{idp}-in-{i+1}', 'name': f'{name}, inbound lane', 'kind': 'lane', 'toward': bearing(b, a), 'points': lane(b, a, sep / 2 + NM / 2, NM)}
        if i == 0:
            o['warn'] = out_say
            n['warn'] = in_say
        areas.extend([o, n, {'id': f'{idp}-sep-{i+1}', 'name': f'{name}, separation zone', 'kind': 'separation', 'points': lane(a, b, 0, sep)}])
scheme('Western approach', 'west', [W0, W1, W2], SEP_W,
       'The outbound lane of the western approach. Ships leaving for the Santa Barbara Channel run north-west along it at 15 to 20 knots. Cross it square and do not loiter',
       'The inbound lane of the western approach. Ships for Los Angeles and Long Beach come down it from the north-west. Cross it square')
scheme('Southern approach', 'south', [S0, S1], SEP_S,
       'The southbound lane of the southern approach. Ships bound down the coast run along it. Cross it square',
       'The northbound lane of the southern approach. Ships come up it from the Gulf of Santa Catalina for the pilot station. Cross it square')
areas.append({'id': 'precaution', 'name': 'Precautionary Area', 'kind': 'precaution',
  'points': [[1500, 16700], [12600, 18700], [14300, 12400], [11400, 6900], [1500, 9300]],
  'say': 'Where the lanes meet off the breakwater. Ships slow, turn and pick up their pilots',
  'warn': 'The precautionary area off the breakwater. The lanes meet here: ships turn for Queens Gate and Angels Gate and pick up their pilots. Keep a good lookout all round'})
areas.append({'id': 'queens-gate', 'name': 'Queens Gate', 'kind': 'precaution', 'circle': {'x': 10750, 'y': 19260, 'r': 420},
  'say': 'The gap into Long Beach. 640 m wide',
  'warn': 'Queens Gate, the gap in the breakwater for Long Beach. Long Beach Light flashes white on the west side. Ships and the Catalina boats use it: keep to the edge if one is coming'})
areas.append({'id': 'angels-gate', 'name': 'Angels Gate', 'kind': 'precaution', 'circle': {'x': 4830, 'y': 17750, 'r': 430},
  'say': 'The gap into Los Angeles. Angels Gate Light on its west side',
  'warn': 'Angels Gate, the gap in the breakwater for Los Angeles harbor. Angels Gate Light flashes green on the west side'})

platforms = [
  ('edith', 'Platform Edith', 14750, 5100, 49, 20, None),
  ('ellen', 'Platform Ellen', 15900, 3600, 81, 35, None),
  ('elly', 'Platform Elly', 16000, 3650, 78, 35, 'ellen'),
  ('eureka', 'Platform Eureka', 17000, 1500, 213, 50, None),
]
for pid, name, x, y, depth, turn, bridge in platforms:
    areas.append({'id': f'{pid}-ring', 'name': name, 'kind': 'keepclear', 'circle': {'x': x, 'y': y, 'r': 250},
      'say': 'Oil platform. Lit, with a horn in thick weather',
      'warn': f'{name}. An oil platform on steel legs in {depth} m of water: solid, lit all night, and it sounds a horn in thick weather. Pass outside the legs and mind the boat landing'})

areas.append({'id': 'casino-point-dive-park', 'name': 'Casino Point Dive Park', 'kind': 'refuge', 'noTake': True, 'circle': {'x': -2230, 'y': -22300, 'r': 130},
  'say': 'Underwater park. Divers down. Nothing may be taken',
  'warn': 'The dive park off Casino Point: a roped-off underwater park with divers down all day. No boats inside the buoys, and nothing may be taken'})
areas.append({'id': 'lovers-cove', 'name': "Lover's Cove", 'kind': 'refuge', 'noTake': True, 'circle': {'x': -1790, 'y': -22960, 'r': 150},
  'say': 'Marine reserve. Snorkelers. Nothing may be taken',
  'warn': "Lover's Cove: a marine reserve just past the mole, full of snorkelers and bright orange garibaldi. No anchoring, and nothing may be taken"})
lp = at(33.4060, -118.3660)
areas.append({'id': 'long-point-reserve', 'name': 'Long Point Reserve', 'kind': 'refuge', 'noTake': True, 'circle': {'x': lp[0] + 300, 'y': lp[1] + 300, 'r': 900},
  'say': 'State marine reserve. Nothing may be taken',
  'warn': 'The marine reserve round Long Point. Sail through as you like, but nothing may be taken here: no lines, no pots, no lobster'})
areas.append({'id': 'blue-cavern', 'name': 'Blue Cavern', 'kind': 'refuge', 'noTake': True, 'circle': {'x': -16750, 'y': -11000, 'r': 700},
  'say': 'Marine conservation area off Blue Cavern Point. Nothing may be taken',
  'warn': 'Blue Cavern Point, east of the Isthmus: a conservation area off the marine science station. No anchoring and nothing may be taken'})

def L(xy, **kw):
    d = {'id': kw.pop('id'), 'name': kw.pop('name'), 'x': xy[0], 'y': xy[1]}
    d.update(kw)
    return d
G, R = '#7dffa8', '#ff5a48'
lights = [
  L([4450, 17600], id='angels-gate-light', name='Angels Gate Light', focal=22, tower=21, character='Fl G 15s', period=15, shows=1.2, range=18, colour=G, on='land', say='The lighthouse on the end of the San Pedro breakwater, since 1913. The west side of Angels Gate'),
  L([10430, 19260], id='long-beach-light', name='Long Beach Light', focal=15, tower=13, character='Fl W 5s', period=5, shows=0.6, range=20, on='land', say='The "robot light", a square tower on six columns on the end of the Middle Breakwater. The west side of Queens Gate'),
  L([11070, 19260], id='queens-gate-east', name='Queens Gate east', focal=9, tower=7, character='Fl R 4s', period=4, shows=0.5, range=6, colour=R, on='land', say='The west end of the Long Beach breakwater'),
  L([5210, 17900], id='angels-gate-east', name='Angels Gate east', focal=9, tower=7, character='Fl R 2.5s', period=2.5, shows=0.4, range=6, colour=R, on='land', say='The west end of the Middle Breakwater'),
  L([15150, 19290], id='long-beach-east', name='Breakwater east end', focal=9, tower=7, character='Fl W 4s', period=4, shows=0.5, range=6, on='land', say='The east end of the Long Beach breakwater. Round it for Alamitos Bay'),
  L(at(33.7054, -118.2937), id='fermin', name='Point Fermin', focal=37, tower=8, character='Fl W 10s', period=10, shows=0.8, range=13, on='land', say='The bluff at the west end of the breakwater. The wooden lighthouse of 1874 stands in the park above'),
  L(at(33.7419, -118.4107), id='vicente', name='Point Vicente', focal=56, tower=20, character='Fl (2) W 20s', period=20, shows=1.6, range=24, on='land', say='The tall white tower on the cliffs of Palos Verdes, at the turn of the coast'),
  L(at(33.4063, -118.3663), id='long-point', name='Long Point', focal=22, tower=5, character='Fl W 10s', period=10, shows=0.8, range=11, on='land', say='The point of the island nearest the mainland'),
  L(at(33.3020, -118.3170), id='east-end', name='Catalina East End', focal=65, tower=5, character='Fl W 10s', period=10, shows=0.8, range=14, on='land', say='Seal Rocks lie under it'),
  L(at(33.4790, -118.6040), id='west-end', name='Catalina West End', focal=23, tower=5, character='Fl W 10s', period=10, shows=0.8, range=12, on='land'),
  L(at(33.4633, -118.4917), id='ship-rock', name='Ship Rock', focal=23, tower=6, character='Fl W 4s', period=4, shows=0.5, range=6, on='rock', say='A rock like a ship under sail, a mile north of the Isthmus, white with birds. Foul ground reaches south of it'),
  L([-2302, -22375], id='casino-point-light', name='Casino Point', focal=9.5, tower=3, character='Fl G 4s', period=4, shows=0.5, range=5, colour=G, on='buoy', say='On the sea wall under the Casino. The north side of the way in to Avalon'),
  L([-2056, -22764], id='cabrillo-mole-light', name='Cabrillo Mole', focal=8, tower=3, character='Fl R 4s', period=4, shows=0.5, range=5, colour=R, on='buoy', say='The end of the ferry mole. The south side of the way in to Avalon'),
]

structures = [
  {'id': 'san-pedro-breakwater', 'name': 'San Pedro Breakwater', 'kind': 'breakwater', 'height': 4.3, 'line': [[1720, 17770], [2500, 17380], [4450, 17600]], 'say': 'Rock, 1899 to 1912. From Cabrillo Beach to Angels Gate Light'},
  {'id': 'middle-breakwater', 'name': 'Middle Breakwater', 'kind': 'breakwater', 'height': 4.3, 'line': [[5210, 17900], [5840, 18160], [6550, 18420], [7740, 18890], [8640, 19235], [9840, 19258], [10430, 19260]], 'say': 'Detached, three and a half miles from Angels Gate to Queens Gate'},
  {'id': 'long-beach-breakwater', 'name': 'Long Beach Breakwater', 'kind': 'breakwater', 'height': 4.3, 'line': [[11070, 19260], [12320, 19270], [14640, 19278], [15150, 19290]], 'say': 'Detached, two and a half miles east from Queens Gate. Open water round its east end'},
  {'id': 'belmont-pier', 'name': 'Belmont Pier', 'kind': 'pier', 'height': 6, 'line': [[13990, 23090], [13990, 22640]], 'say': 'The concrete pleasure pier at Belmont Shore, with a T at its end'},
  {'id': 'island-grissom', 'name': 'Island Grissom', 'kind': 'island', 'dress': 'resort', 'x': 10980, 'y': 23290, 'r': 125, 'say': 'The oil island nearest downtown'},
  {'id': 'island-white', 'name': 'Island White', 'kind': 'island', 'dress': 'resort', 'x': 13050, 'y': 22560, 'r': 125, 'say': 'Oil island off Belmont Shore'},
  {'id': 'island-chaffee', 'name': 'Island Chaffee', 'kind': 'island', 'dress': 'resort', 'x': 14880, 'y': 21090, 'r': 120, 'say': 'The easternmost oil island'},
  {'id': 'island-freeman', 'name': 'Island Freeman', 'kind': 'island', 'dress': 'resort', 'x': 12750, 'y': 21290, 'r': 135, 'say': 'The largest and furthest out of the four'},
]
says = {'edith': 'A drilling and production platform, the nearest to Long Beach', 'ellen': 'The drilling platform of the Beta field, joined to Elly by a footbridge', 'elly': 'The processing platform of the Beta field: no wells, all pipes and vessels', 'eureka': 'The deepest of the four, in over 200 m at the edge of the shelf'}
for pid, name, x, y, depth, turn, bridge in platforms:
    s = {'id': pid, 'name': name, 'kind': 'platform', 'x': x, 'y': y, 'w': 46 if pid == 'edith' else 52, 'd': 40, 'turn': turn, 'height': 21, 'depth': depth}
    if bridge: s['bridgeTo'] = bridge
    s['say'] = says[pid]
    structures.append(s)

# ---- kelp: the lee shore of the island, from the baked coast ----
ring = c['coast'][0]
pts = [(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
if pts[0] == pts[-1]: pts.pop()
n = len(pts)
east = max(range(n), key=lambda i: pts[i][0]); west = min(range(n), key=lambda i: pts[i][0])
def walk(a, b, step):
    out = []; i = a
    while True:
        out.append(pts[i])
        if i == b: break
        i = (i + step) % n
    return out
p1, p2 = walk(east, west, 1), walk(east, west, -1)
front = p1 if sum(p[1] for p in p1) / len(p1) > sum(p[1] for p in p2) / len(p2) else p2
def piece(x0, x1):
    seg = [p for p in front if x0 <= p[0] <= x1]
    out = [[p[0], p[1]] for p in seg[::2]]
    if seg and out[-1] != [seg[-1][0], seg[-1][1]]: out.append([seg[-1][0], seg[-1][1]])
    return out
kelp = [
  {'id': 'east-end', 'name': 'Seal Rocks to Pebbly Beach', 'reach': 300, 'line': piece(-1500, 0)},
  {'id': 'avalon', 'name': "Lover's Cove and Casino Point", 'reach': 260, 'clear': [[-2270, -22700, 340], [-2420, -22180, 110]], 'line': piece(-2700, -1500)},
  {'id': 'frog-rock', 'name': 'Frog Rock to Long Point', 'reach': 300, 'line': piece(-6200, -2700)},
  {'id': 'whites', 'name': "Long Point to White's Landing and Empire Landing", 'reach': 300, 'clear': [[-6350, -17450, 230]], 'line': piece(-14500, -6200)},
  {'id': 'blue-cavern', 'name': 'Blue Cavern to the Isthmus', 'reach': 300, 'clear': [[-18150, -11800, 470]], 'line': piece(-18900, -14500)},
  {'id': 'emerald', 'name': 'Emerald Bay to Arrow Point', 'reach': 300, 'clear': [[-20800, -9200, 230]], 'line': piece(-24500, -18900)},
  {'id': 'west-end', 'name': 'Arrow Point to the West End', 'reach': 300, 'line': piece(-28400, -24500)},
  {'id': 'horseshoe', 'name': 'Horseshoe Kelp', 'reach': 380, 'depth': [14, 32], 'line': [[6300, 13100], [7000, 12600], [7700, 13000]]},
]
kelp = [k for k in kelp if len(k['line']) >= 2]

out = {
  'note': 'Written by hand from general knowledge of the charts, not from a chart: positions are approximate and wait to be checked against NOAA charts 18746, 18749 and 18757. The breakwaters follow the line of rocks the tide model and the elevation tiles already show; the oil islands are where the baked land has them; the Beta field platforms (Ellen, Elly, Eureka) and Edith are placed from memory to about half a mile. The traffic lanes are drawn simpler and narrower than the real scheme and are kept west of the platforms. Lights have the right colours and roughly the right rhythms. Structures are made solid by scripts/stamp.ts, which writes them into depth.bin. Kelp lines follow the baked coast: scene/kelp.ts turns them into the canopy. Not for navigation.',
  'areas': areas, 'lights': lights, 'structures': structures, 'kelp': kelp,
}
s = json.dumps(out, indent=1, ensure_ascii=False)
s = re.sub(r'\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]', r'[\1, \2]', s)
open(root + '/courses/catalina/features.json', 'w').write(s + '\n')
print(len(areas), 'areas', len(lights), 'lights', len(structures), 'structures', [(k['id'], len(k['line'])) for k in kelp])
print('east', pts[east], 'west', pts[west], 'ship rock', at(33.4633, -118.4917), 'long point', lp, at(33.3020, -118.3170), at(33.4790, -118.6040))
