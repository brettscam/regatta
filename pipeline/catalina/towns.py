# Writes courses/catalina/ data from hand-kept tables. Run from the repository root:  python3 pipeline/catalina/towns.py .
# Then: npx vite-node scripts/stamp.ts catalina; npx vite-node scripts/legs.ts catalina files; npx vite-node scripts/shore.ts catalina
# The waterfronts are fitted to the 10 m shoreline baked by pipeline/catalina/land.py from Sentinel-2; the names and
# what stands where along them are from general knowledge of the place, not from a chart. Run land.py again after this:
# it grades the land under the towns' level ground.
import json, math, sys, re
root = sys.argv[1]

def unit(a, b):
    d = math.hypot(b[0] - a[0], b[1] - a[1]); return ((b[0] - a[0]) / d, (b[1] - a[1]) / d)
def r1(v): return round(v * 10) / 10
def bearing(v): return round(math.degrees(math.atan2(v[0], v[1])) % 360)
def table(spots, n, x, y, say=None):
    spots.append({'name': f'table-{n}', 'kind': 'table', 'x': r1(x), 'y': r1(y), 'face': 0, **({'say': say} if say else {})})
    for k, (dx, dy) in enumerate([(0.95, 0), (-0.95, 0), (0, 0.95), (0, -0.95)]):
        spots.append({'name': f'table-{n}-seat-{k+1}', 'kind': 'seat', 'x': r1(x + dx), 'y': r1(y + dy), 'face': bearing((-dx, -dy))})

# ---------------------------------------------------------------- Avalon
# Fitted to the shoreline of the 10 m land (pipeline/catalina/land.py, from Sentinel-2): Casino Point with the Casino's
# red roof on it, the bay's west shore under the bluff, the beach along Crescent Avenue, the green pier's foot jutting
# into the bay, a small beach south of it, and the Cabrillo Mole at the bay's south-east corner.
CAS = (-2385, -22362)
A = (-2420, -22409)
front = [A, (-2455, -22411), (-2486, -22431), (-2511, -22465), (-2528, -22500), (-2533, -22535), (-2533, -22590), (-2529, -22640), (-2515, -22672), (-2504, -22702), (-2494, -22732), (-2488, -22758), (-2474, -22787)]
crescent = [(-2474, -22787), (-2446, -22822), (-2416, -22858), (-2392, -22906), (-2365, -22924), (-2318, -22940), (-2310, -22975), (-2296, -23006), (-2268, -23025), (-2220, -23026), (-2188, -23008)]
moleroad = [(-2188, -23008), (-2170, -22985), (-2152, -22958), (-2130, -22926), (-2100, -22914), (-2074, -22900), (-2062, -22880)]
proot = (-2333, -22934)
out = (math.sin(math.radians(45)), math.cos(math.radians(45)))   # the pier runs north-east into the bay
east = (out[1], -out[0])
def P(s, off=0): return (r1(proot[0] + out[0] * s + east[0] * off), r1(proot[1] + out[1] * s + east[1] * off))
def ring(r, deg): return (r1(CAS[0] + r * math.cos(math.radians(deg))), r1(CAS[1] + r * math.sin(math.radians(deg))))

paths = [
  {'id': 'casino-way', 'name': 'Casino Way', 'kind': 'promenade', 'width': 7, 'points': front},
  {'id': 'crescent', 'name': 'Crescent Avenue', 'kind': 'promenade', 'width': 9, 'points': crescent},
  {'id': 'pier', 'name': 'the green Pleasure Pier', 'kind': 'pier', 'width': 7, 'paint': '#2f7d4f', 'points': [P(-2), P(128)]},
  {'id': 'dinghy-dock', 'name': 'the dinghy dock', 'kind': 'float', 'width': 4, 'points': [P(96, -5.5), P(122, -5.5)]},
  {'id': 'mole-road', 'name': 'the road to the mole', 'kind': 'promenade', 'width': 7, 'points': moleroad},
  {'id': 'mole', 'name': 'Cabrillo Mole', 'kind': 'quay', 'width': 18, 'points': [(-2058, -22884), (-2040, -22790)]},
  {'id': 'lovers-cove-walk', 'name': "the walk to Lover's Cove", 'kind': 'promenade', 'width': 5, 'points': [(-2058, -22884), (-2010, -22858), (-1992, -22878), (-1977, -22904), (-1953, -22930), (-1930, -22952), (-1908, -22976), (-1893, -23006), (-1872, -23034)]},
  {'id': 'sumner', 'name': 'Sumner Avenue', 'kind': 'street', 'width': 6, 'points': [(-2394, -22912), (-2425, -22955), (-2452, -23000), (-2475, -23045)]},
  {'id': 'catalina-avenue', 'name': 'Catalina Avenue', 'kind': 'street', 'width': 6, 'points': [(-2336, -22938), (-2342, -22985), (-2350, -23030), (-2358, -23075)]},
  {'id': 'fuel-pier', 'name': 'the fuel dock', 'kind': 'pier', 'width': 4, 'points': [(-2532, -22520), (-2496, -22520)]},
  {'id': 'fuel-float', 'name': 'the fuel float', 'kind': 'float', 'width': 5, 'points': [(-2493.5, -22536), (-2493.5, -22504)]},
  {'id': 'casino-steps', 'name': 'the Casino steps', 'kind': 'street', 'width': 6, 'points': [A, ring(33, 235)]},
  {'id': 'casino-walk', 'name': 'the walk round the Casino', 'kind': 'round', 'width': 8, 'centre': list(CAS), 'inner': 27, 'floor': 6},
  {'id': 'dive-stairs', 'name': 'the dive park stairs', 'kind': 'pier', 'width': 4, 'floor': 3.9, 'points': [ring(33, 80), ring(49, 80)]},
  {'id': 'dive-float', 'name': 'the dive park landing', 'kind': 'float', 'width': 4, 'points': [ring(49, 80), ring(64, 80)]},
]
spots = []
S = lambda name, kind, xy, face, say=None: spots.append({'name': name, 'kind': kind, 'x': r1(xy[0]), 'y': r1(xy[1]), 'face': face, **({'say': say} if say else {})})
S('dinghy-dock', 'dock', P(109, -5.5), bearing((-east[0], -east[1])), 'Tenders three deep on the float beside the green pier')
S('pier-end', 'sight', P(125), bearing(out), 'The end of the green pier: the whole mooring field, the Casino on its point, and the mainland a smudge beyond')
S('pier-scale', 'sight', P(100, 1.5), bearing(east), 'The scale where marlin and swordfish have been weighed since the tuna-club days')
S('harbormaster', 'door', P(116, 1.5), bearing(east), "The harbormaster's office, at the end of the pier")
S('pier-foot', 'sight', P(4), bearing(out))
S('fountain', 'sight', crescent[4], 40, 'The tiled fountain in the middle of Crescent Avenue')
S('bench-1', 'bench', front[12], 60)
S('bench-2', 'bench', front[7], 90, 'A bench on Casino Way, under the bluff')
S('bench-3', 'bench', crescent[3], 50)
S('bench-4', 'bench', crescent[9], 10)
S('bench-5', 'bench', moleroad[3], 290)
# The bar under the awning, on the front between the two bends.
I, J = crescent[1], crescent[2]
ub = unit(I, J); lw = (ub[1], -ub[0])
if lw[0] > 0: lw = (-lw[0], -lw[1])          # the land side here is to the south-west
bp = lambda t, o: (I[0] + (J[0] - I[0]) * t + lw[0] * o, I[1] + (J[1] - I[1]) * t + lw[1] * o)
table(spots, 1, *bp(0.35, 2.4), say='A table at the bar under the striped awning')
table(spots, 2, *bp(0.7, 2.4))
for k in range(3): S(f'bar-{k+1}', 'bar', bp(0.08 + 0.07 * k, 3.4), bearing(lw))
# The cafe at the foot of the pier.
M2, N = crescent[4], crescent[5]
um = unit(M2, N); ls = (um[1], -um[0])
if ls[0] > 0: ls = (-ls[0], -ls[1])
cp = lambda t, o: (M2[0] + (N[0] - M2[0]) * t + ls[0] * o, M2[1] + (N[1] - M2[1]) * t + ls[1] * o)
table(spots, 3, *cp(0.3, 2.6), say='The cafe at the foot of the pier')
table(spots, 4, *cp(0.65, 2.6))
# The restaurant on the road to the mole.
Pq, Q = moleroad[2], moleroad[3]
table(spots, 5, (Pq[0] + Q[0]) / 2 - 1.2, (Pq[1] + Q[1]) / 2 - 1.2, say='The restaurant on the road to the mole, looking back across the moorings at the Casino')
S('casino-steps', 'steps', ring(36, 235), 40, 'The steps up to the Casino terrace')
S('casino-door', 'door', ring(31, 200), 20, 'The Casino: no gambling, ever. A ballroom on the top floor and a picture palace under it, since 1929')
S('casino-rail', 'sight', ring(32, 20), 90, 'The rail on the seaward side of the Casino')
S('dive-park-stairs', 'steps', ring(32, 80), 15, 'The stairs down into the dive park: kelp, garibaldi and a wreck or two inside the buoys')
S('dive-park-landing', 'dock', ring(58, 80), 15)
S('fuel-dock', 'dock', (-2493.5, -22520), 90, 'The fuel float under the bluff')
S('ferry-gate', 'sight', (-2044, -22808), 20, 'Where the boat from the mainland lands, an hour from Long Beach')
S('mole-end', 'sight', (-2042, -22796), 350)
S('lovers-cove-steps', 'steps', (-1875, -23030), 70, "The steps into Lover's Cove, where the snorkelers go in")
S('sumner-top', 'sight', (-2473, -23042), 200)
S('catalina-avenue-top', 'sight', (-2357, -23072), 190)
avalon = {'id': 'avalon', 'name': 'Avalon', 'kind': 'bar', 'x': crescent[4][0], 'y': crescent[4][1], 'floor': 3, 'paths': paths, 'spots': spots,
          'landings': [{'place': 'avalon', 'spot': 'dinghy-dock'}, {'place': 'avalon-fuel', 'spot': 'fuel-dock'}, {'place': 'casino-point', 'spot': 'dive-park-landing'}]}

# ---------------------------------------------------------------- Two Harbors
beach = [(-18405, -12018), (-18360, -12045), (-18318, -12070), (-18275, -12085)]
b1, b2 = beach[1], beach[2]
ub = unit(b1, b2); outb = (-ub[1], ub[0])
if outb[1] < 0: outb = (-outb[0], -outb[1])
eb = (outb[1], -outb[0])
rootb = ((b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2)
def PB(s, off=0): return (r1(rootb[0] + outb[0] * s + eb[0] * off), r1(rootb[1] + outb[1] * s + eb[1] * off))
dc = PB(-9.5)
deck = [(r1(dc[0] - ub[0] * 14), r1(dc[1] - ub[1] * 14)), (r1(dc[0] + ub[0] * 14), r1(dc[1] + ub[1] * 14))]
road = [PB(-1, -22), (-18420, -12140), (-18470, -12220), (-18510, -12300), (-18550, -12380), (-18600, -12460), (-18640, -12540), (-18670, -12620), (-18690, -12676)]
paths = [
  {'id': 'beach', 'name': 'the beach at Isthmus Cove', 'kind': 'promenade', 'width': 6, 'points': beach},
  {'id': 'pier', 'name': 'the pier', 'kind': 'pier', 'width': 6, 'points': [PB(-2), PB(96)]},
  {'id': 'dinghy-dock', 'name': 'the dinghy dock', 'kind': 'float', 'width': 4, 'points': [PB(42, 5), PB(68, 5)]},
  {'id': 'fuel-float', 'name': 'the fuel float', 'kind': 'float', 'width': 5, 'points': [PB(80, -5.5), PB(100, -5.5)]},
  {'id': 'bar-deck', 'name': "the bar's deck", 'kind': 'street', 'width': 14, 'points': deck},
  {'id': 'isthmus-road', 'name': 'the road across the Isthmus', 'kind': 'path', 'width': 5, 'points': road},
  {'id': 'cat-harbor-pier', 'name': 'the Cat Harbor dinghy pier', 'kind': 'pier', 'width': 4, 'points': [(-18690, -12674), (-18724, -12810)]},
  {'id': 'cat-harbor-dock', 'name': 'the Cat Harbor dinghy dock', 'kind': 'float', 'width': 4, 'points': [(-18720.3, -12779.8), (-18726.6, -12805)]},
]
spots = []
S('dinghy-dock', 'dock', PB(55, 5), bearing(eb), 'Everybody\'s dinghy, on the float or pulled up the beach')
S('pier-end', 'sight', PB(93), bearing(outb), 'The end of the pier: the moorings in rows, Bird Rock white with birds, and Ship Rock beyond')
S('fuel-dock', 'dock', PB(90, -5.5), bearing((-eb[0], -eb[1])))
S('pier-foot', 'sight', PB(3), bearing(outb))
for n, (a, o) in enumerate([(-9, 2.5), (-3, -2.5), (4, 2.5), (10, -2.5)]):
    table(spots, n + 1, dc[0] + ub[0] * a + outb[0] * o, dc[1] + ub[1] * a + outb[1] * o, say='A table on the deck at the head of the pier, sand underfoot' if n == 0 else None)
for k in range(3): S(f'bar-{k+1}', 'bar', (dc[0] + ub[0] * (-1.2 + 1.2 * k) - outb[0] * 5.5, dc[1] + ub[1] * (-1.2 + 1.2 * k) - outb[1] * 5.5), bearing((-outb[0], -outb[1])), 'The bar at the head of the pier. A buffalo milk, please' if k == 0 else None)
S('bench-1', 'bench', beach[2], bearing(outb))
S('beach-east', 'sight', (-18279, -12084), 40)
S('isthmus-saddle', 'sight', (-18510, -12300), 215, 'The top of the Isthmus: one harbor behind, the other ahead, and the island half a mile wide')
S('cat-harbor-beach', 'sight', (-18689, -12672), 200, 'The head of Catalina Harbor, the quiet side')
S('cat-harbor-dock', 'dock', (-18723.8, -12792.3), 250)
isthmus = {'id': 'isthmus', 'name': 'Two Harbors', 'kind': 'bar', 'x': r1(rootb[0]), 'y': r1(rootb[1]), 'floor': 3, 'paths': paths, 'spots': spots,
           'landings': [{'place': 'isthmus', 'spot': 'dinghy-dock'}, {'place': 'isthmus-pier', 'spot': 'fuel-dock'}, {'place': 'catharbor', 'spot': 'cat-harbor-dock'}]}

for t in (avalon, isthmus):
    for p in t['paths']:
        if 'points' in p: p['points'] = [[r1(x), r1(y)] for x, y in p['points']]
s = json.dumps([avalon, isthmus], indent=1, ensure_ascii=False)
s = re.sub(r'\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]', r'[\1, \2]', s)
s = re.sub(r'\{\s*"name": ("[^"]*"),\s*"kind": ("[^"]*"),\s*"x": (-?[\d.]+),\s*"y": (-?[\d.]+),\s*"face": (-?[\d.]+)\s*\}', r'{ "name": \1, "kind": \2, "x": \3, "y": \4, "face": \5 }', s)
open(root + '/courses/catalina/towns.json', 'w').write(s + '\n')
print('pier', P(0), P(128), 'out', out, 'two harbors pier', PB(0), PB(96), 'deck', deck, 'fuel', PB(90, -5.5), 'spots', len(avalon['spots']), len(isthmus['spots']))
