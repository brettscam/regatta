import type { Voyage } from '../voyage';

// The boat journey of the James Caird, Elephant Island to South Georgia, 24 April to 10 May 1916.
//
// Sources, from memory of them and not checked against the page while writing: Shackleton, "South" (1919), chapter 9;
// Worsley, "Shackleton's Boat Journey" (1933); Lansing, "Endurance" (1959), which follows Worsley's log day by day.
// Each day below carries what those accounts say and a mark of how far to trust the detail here:
//   attested       the event and its date are in all three accounts and I am sure of them
//   probable       the event is in the record; its date, or the wind's direction and strength, is my best recollection
//   reconstructed  the record is thin for this day, and the weather is filled in to join the days either side
// Wind speeds are nowhere measured in the record. They are set from the words used (gale, hurricane, fine) on the
// 1916 Beaufort scale. Nothing here should be quoted as a source.
//
// Coasts are drawn from the positions of capes and bays as I know them, to a few kilometres. They are outlines to
// recognise and to make a landfall on, not charts: bays are simplified and small islets left out.

export const CAIRD: Voyage = {
  id: 'caird-1916',
  title: 'The James Caird, 1916',
  line: 'Elephant Island to South Georgia. Six men, a ship\'s lifeboat, 800 miles of the Southern Ocean',
  briefing: [
    '24 April 1916. The Endurance was crushed in the Weddell Sea pack and sank in November. Her twenty-eight men have reached Elephant Island in three boats and are camped on a spit of shingle where no ship will look for them.',
    'Sir Ernest Shackleton takes five of them, Worsley, Crean, McNish, McCarthy and Vincent, in the largest boat to fetch help from the whaling stations of South Georgia: 800 miles to the north-east, across the stormiest ocean in the world, at the start of winter.',
    'The James Caird is a double-ended whaler 22 ft 6 in long and 6 ft in the beam. McNish, the carpenter, has raised her sides and decked her over with canvas on a frame of sledge runners and box lids. She carries about a ton of shingle and rocks for ballast, a jib, a lug mainsail and a small mizzen.',
    'Worsley has a sextant, a chronometer and a compass. There is no position on the chart but the one you reckon from the courses steered and the speed guessed. South Georgia is a hundred miles long. Miss it, and there is nothing to leeward but the South Atlantic.',
  ],
  boat: 'caird',
  boatName: 'James Caird',
  sea: { id: 'scotia-sea', name: 'The Scotia Sea', lat0: -57.8, lon0: -46, south: -63, north: -52.3, west: -59.5, east: -32.5 },
  // Ship's time is kept three hours behind Greenwich, near enough the sun's time at 46 W. Worsley's chronometer kept Greenwich.
  timeZone: 'Etc/GMT+3',
  dayZero: '1916-04-24T00:00:00-03:00',
  // They got away from the beach about half past twelve.
  castOff: 12.5,
  days: 22,
  // Off Cape Valentine, the north-east end of Elephant Island, heading north for open water.
  from: { name: 'Cape Valentine, Elephant Island', lat: -61.06, lon: -54.6, headingDeg: 5 },
  // The mouth of King Haakon Bay, under Cape Rosa, where they came in at dusk on 10 May.
  to: { name: 'King Haakon Bay', lat: -54.165, lon: -37.44, radius: 6500 },
  lostEast: -34.2,

  islands: [
    {
      name: 'Elephant Island', group: 'elephant', peak: 970,
      outline: [
        [61.100, 54.650], [61.135, 54.700], [61.170, 54.850], [61.215, 55.000], [61.270, 55.200], [61.225, 55.330], [61.170, 55.420],
        [61.105, 55.480], [61.060, 55.400], [61.050, 55.360], [61.065, 55.200], [61.085, 55.050], [61.095, 54.870], [61.085, 54.750],
      ],
      spine: [[61.23, 55.17, 970], [61.13, 55.05, 850], [61.10, 54.80, 600]],
    },
    {
      name: 'Clarence Island', group: 'elephant', peak: 1950,
      outline: [[61.115, 54.020], [61.160, 53.950], [61.250, 53.980], [61.320, 54.100], [61.270, 54.170], [61.180, 54.130], [61.130, 54.080]],
      spine: [[61.27, 54.10, 1950], [61.17, 54.05, 1400]],
    },
    { name: 'Cornwallis Island', group: 'elephant', peak: 470, outline: [[61.060, 54.455], [61.075, 54.460], [61.085, 54.490], [61.068, 54.505]] },
    { name: 'Gibbs Island', group: 'elephant', peak: 520, outline: [[61.462, 55.450], [61.482, 55.500], [61.492, 55.620], [61.476, 55.680], [61.458, 55.600]] },
    { name: 'Aspland Island', group: 'elephant', peak: 730, outline: [[61.462, 55.870], [61.490, 55.890], [61.492, 55.950], [61.468, 55.945]] },
    {
      name: 'South Georgia', group: 'south-georgia', peak: 2934,
      outline: [
        // The north coast, west to east: Cape Alexandra, Cape Buller, the Bay of Isles, Possession, Antarctic and Fortuna Bays,
        // Stromness, the two Cumberland Bays, Cape George, St Andrews Bay, Royal Bay, Gold Harbour.
        [54.005, 38.030], [54.000, 37.930], [54.015, 37.800], [53.990, 37.700], [53.985, 37.400], [54.050, 37.330], [54.030, 37.160],
        [54.110, 37.110], [54.060, 36.980], [54.120, 36.930], [54.085, 36.830], [54.150, 36.800], [54.110, 36.650], [54.160, 36.700],
        [54.180, 36.560], [54.250, 36.700], [54.220, 36.520], [54.330, 36.480], [54.240, 36.400], [54.290, 36.260], [54.380, 36.280],
        [54.400, 36.180], [54.440, 36.200], [54.490, 36.030], [54.530, 36.090], [54.540, 35.920], [54.630, 35.950], [54.720, 35.800],
        [54.790, 35.830], [54.810, 35.950],
        // Cape Disappointment, the south end.
        [54.890, 36.110],
        // The south-west coast, east to west: Novosilski Bay, Undine South Harbour, Jacobsen Bight, Holmestrand, Cape Nunez,
        // Queen Maud Bay, Cape Rosa, King Haakon Bay, Cheapman Bay, Cape Demidov, Wilson Harbour, Cape Paryadin.
        [54.800, 36.180], [54.740, 36.330], [54.680, 36.330], [54.660, 36.500], [54.560, 36.560], [54.520, 36.650], [54.470, 36.800],
        [54.420, 36.800], [54.400, 36.950], [54.330, 37.050], [54.300, 37.230], [54.270, 37.420], [54.230, 37.330], [54.190, 37.420],
        [54.176, 37.300], [54.156, 37.200], [54.136, 37.320], [54.130, 37.450], [54.150, 37.560], [54.135, 37.700], [54.100, 37.720],
        [54.085, 37.900], [54.060, 38.020],
      ],
      // The Allardyce and Salvesen Ranges. Mount Paget, 2,934 m, is the highest.
      spine: [
        [54.07, 37.75, 600], [54.10, 37.30, 900], [54.17, 37.00, 1300], [54.25, 36.83, 1900], [54.35, 36.68, 2300], [54.43, 36.55, 2934],
        [54.52, 36.40, 2300], [54.62, 36.25, 2100], [54.75, 36.05, 1500], [54.83, 36.05, 900],
      ],
    },
    { name: 'Bird Island', group: 'south-georgia', peak: 365, outline: [[53.995, 38.045], [54.015, 38.050], [54.016, 38.110], [53.998, 38.100]] },
    { name: 'Willis Islands', group: 'south-georgia', peak: 550, outline: [[53.993, 38.170], [54.012, 38.180], [54.012, 38.230], [53.995, 38.220]] },
    // Six miles off the south-west coast. They were driven past it in the hurricane of 9 May.
    { name: 'Annenkov Island', group: 'south-georgia', peak: 650, outline: [[54.465, 37.020], [54.485, 37.000], [54.515, 37.050], [54.510, 37.110], [54.480, 37.120]] },
    { name: 'Cooper Island', group: 'south-georgia', peak: 415, outline: [[54.780, 35.750], [54.800, 35.740], [54.820, 35.780], [54.800, 35.820]] },
  ],
  // Both of these are placed from the accounts, not from a chart: a reef between Annenkov Island and the main island,
  // and broken ground to seaward of the island where they saw the sea breaking as they clawed past.
  rocks: [
    { name: 'Hauge Reef', at: [54.445, 36.985] },
    { name: 'Rocks west of Annenkov Island', at: [54.500, 37.165] },
  ],

  script: [
    {
      day: 0, date: '24 April', sure: 'attested',
      record: 'A fine day with the sun out. They launched after noon, worked through a belt of loose ice and ran north before a westerly breeze to get clear of the pack. A heavy swell.',
      weather: [{ hour: 6, from: 250, kt: 13, cloud: 0.3, air: -2 }, { hour: 14, from: 245, kt: 16, cloud: 0.35, air: -1 }, { hour: 22, from: 255, kt: 20, cloud: 0.6, air: -3 }],
    },
    {
      day: 1, date: '25 April', sure: 'probable',
      record: 'The wind went into the south-west and freshened to a gale. They held north. Everything below was already wet.',
      weather: [{ hour: 6, from: 235, kt: 26, cloud: 0.8, air: -3 }, { hour: 14, from: 230, kt: 35, cloud: 0.9, air: -4 }, { hour: 22, from: 240, kt: 38, cloud: 0.9, air: -4 }],
    },
    {
      day: 2, date: '26 April', sure: 'attested',
      record: 'Gale and a high sea. The sun showed at noon and Worsley got his first sight: 128 miles from Elephant Island. Course altered to the north-east for South Georgia.',
      weather: [{ hour: 6, from: 245, kt: 38, cloud: 0.8, air: -3 }, { hour: 12, from: 250, kt: 32, cloud: 0.55, air: -2 }, { hour: 21, from: 270, kt: 26, cloud: 0.8, air: -2 }],
    },
    {
      day: 3, date: '27 April', sure: 'probable',
      record: 'The wind backed into the north and blew hard, heading her. Thick weather, rain and mist, no sun.',
      weather: [{ hour: 4, from: 300, kt: 24, cloud: 0.95, air: 0 }, { hour: 12, from: 335, kt: 30, cloud: 1, air: 1 }, { hour: 22, from: 320, kt: 26, cloud: 1, air: 1 }],
    },
    {
      day: 4, date: '28 April', sure: 'reconstructed',
      record: 'The wind eased and drew to the north-west. A big westerly swell, overcast, no sight.',
      weather: [{ hour: 8, from: 310, kt: 20, cloud: 0.9, air: 0 }, { hour: 18, from: 285, kt: 17, cloud: 0.85, air: -1 }],
    },
    {
      day: 5, date: '29 April', sure: 'attested',
      record: 'A fresh westerly drawing south-west and a good run. A sight at noon: 238 miles made good. By night it was blowing hard from the south-west and turning very cold.',
      weather: [{ hour: 6, from: 260, kt: 20, cloud: 0.6, air: -2 }, { hour: 12, from: 245, kt: 24, cloud: 0.5, air: -3 }, { hour: 22, from: 225, kt: 36, cloud: 0.85, air: -7 }],
    },
    {
      day: 6, date: '30 April', sure: 'attested',
      record: 'A south-westerly gale straight off the ice. The sea too high to run before: they hove to with the sea anchor. Spray froze where it fell and the boat began to ice up.',
      weather: [{ hour: 6, from: 220, kt: 44, cloud: 0.9, air: -9 }, { hour: 14, from: 215, kt: 50, cloud: 0.9, air: -10 }, { hour: 22, from: 215, kt: 52, cloud: 0.9, air: -11 }],
    },
    {
      day: 7, date: '1 May', sure: 'attested',
      record: 'Hove to. The ice on her was a foot thick and she lay low and dead in the water. They crawled out on the decking in turn to chop it away, and threw over the spare oars and two frozen sleeping bags.',
      weather: [{ hour: 6, from: 215, kt: 50, cloud: 0.85, air: -11 }, { hour: 14, from: 220, kt: 46, cloud: 0.8, air: -10 }, { hour: 22, from: 225, kt: 42, cloud: 0.8, air: -9 }],
    },
    {
      day: 8, date: '2 May', sure: 'attested',
      record: 'The ice sawed through the painter and the sea anchor was lost. They set a reefed jib and ran. The gale eased through the day.',
      weather: [{ hour: 6, from: 225, kt: 40, cloud: 0.8, air: -7 }, { hour: 14, from: 230, kt: 32, cloud: 0.7, air: -5 }, { hour: 22, from: 235, kt: 24, cloud: 0.5, air: -4 }],
    },
    {
      day: 9, date: '3 May', sure: 'attested',
      record: 'The gale blew itself out. A clear, bright day: gear spread to dry, and a good sight at noon put them 403 miles on, more than half way.',
      weather: [{ hour: 6, from: 235, kt: 18, cloud: 0.25, air: -2 }, { hour: 14, from: 240, kt: 14, cloud: 0.15, air: 0 }, { hour: 22, from: 245, kt: 15, cloud: 0.3, air: -1 }],
    },
    {
      day: 10, date: '4 May', sure: 'probable',
      record: 'Fine weather held, with a fresh breeze on the quarter. The best run of the passage, near a hundred miles in the day.',
      weather: [{ hour: 8, from: 230, kt: 20, cloud: 0.4, air: 0 }, { hour: 18, from: 225, kt: 24, cloud: 0.5, air: 0 }],
    },
    {
      day: 11, date: '5 May', sure: 'attested',
      record: 'The wind went north-west and rose to a hard gale with a cross sea. At midnight Shackleton, at the tiller, took a line of white to the south for a break in the cloud. It was the crest of the biggest wave he had seen in twenty-six years at sea. It broke over her and half filled her.',
      weather: [{ hour: 6, from: 270, kt: 24, cloud: 0.8, air: 1 }, { hour: 14, from: 305, kt: 32, cloud: 0.95, air: 2 }, { hour: 23, from: 315, kt: 44, cloud: 1, air: 2 }],
    },
    {
      day: 12, date: '6 May', sure: 'probable',
      record: 'The north-westerly gale eased, leaving a heavy confused sea. The second cask of water was found brackish and short.',
      weather: [{ hour: 8, from: 310, kt: 34, cloud: 0.9, air: 2 }, { hour: 18, from: 300, kt: 26, cloud: 0.85, air: 1 }],
    },
    {
      day: 13, date: '7 May', sure: 'attested',
      record: 'Kelp in the water and more birds. A doubtful sight through mist put them about ninety miles from the north-west end of South Georgia. Thirst was now the worst of it.',
      weather: [{ hour: 8, from: 300, kt: 20, cloud: 0.8, air: 2 }, { hour: 18, from: 295, kt: 18, cloud: 0.85, air: 1 }],
    },
    {
      day: 14, date: '8 May', sure: 'attested',
      record: 'Thick and squally. Shags, which never go far from land. A little after noon McCarthy saw black cliffs through a rift in the cloud: South Georgia, about ten miles off. Breakers everywhere and night coming, so they stood off to wait for daylight.',
      weather: [{ hour: 6, from: 290, kt: 22, cloud: 0.95, air: 2 }, { hour: 13, from: 280, kt: 26, cloud: 0.8, air: 2 }, { hour: 22, from: 270, kt: 36, cloud: 0.95, air: 1 }],
    },
    {
      day: 15, date: '9 May', sure: 'attested',
      record: 'A hurricane from the west and south-west, driving her onto the coast. They set what sail she would bear and clawed off all day, bailing without rest, and cleared Annenkov Island in the dark by very little. The same storm sank a 500-ton steamer. In the evening the wind fell.',
      weather: [{ hour: 3, from: 285, kt: 50, cloud: 1, air: 1 }, { hour: 10, from: 270, kt: 62, cloud: 1, air: 0 }, { hour: 16, from: 240, kt: 66, cloud: 1, air: -1 }, { hour: 22, from: 225, kt: 34, cloud: 0.8, air: -1 }],
    },
    {
      day: 16, date: '10 May', sure: 'attested',
      record: 'Light airs and a big swell. They stood in for King Haakon Bay, found the wind blowing out of it and a reef across the mouth, and beat in tack after tack. At dusk they ran her into a cove under Cape Rosa.',
      weather: [{ hour: 5, from: 250, kt: 16, cloud: 0.6, air: 0 }, { hour: 12, from: 290, kt: 11, cloud: 0.5, air: 1 }, { hour: 17, from: 100, kt: 9, cloud: 0.6, air: 0 }],
    },
    // After the record ends the ocean goes on as it always does: a low every two days or so.
    { day: 17, date: '11 May', sure: 'reconstructed', record: 'No record: the ordinary weather of the Southern Ocean in May.', weather: [{ hour: 6, from: 280, kt: 22, cloud: 0.8, air: 1 }, { hour: 18, from: 310, kt: 32, cloud: 0.95, air: 2 }] },
    { day: 18, date: '12 May', sure: 'reconstructed', record: 'No record.', weather: [{ hour: 6, from: 250, kt: 40, cloud: 0.9, air: -2 }, { hour: 18, from: 235, kt: 32, cloud: 0.7, air: -4 }] },
    { day: 19, date: '13 May', sure: 'reconstructed', record: 'No record.', weather: [{ hour: 6, from: 255, kt: 22, cloud: 0.5, air: -2 }, { hour: 18, from: 300, kt: 30, cloud: 0.9, air: 1 }] },
    { day: 20, date: '14 May', sure: 'reconstructed', record: 'No record.', weather: [{ hour: 6, from: 290, kt: 38, cloud: 1, air: 1 }, { hour: 18, from: 240, kt: 42, cloud: 0.85, air: -3 }] },
    { day: 21, date: '15 May', sure: 'reconstructed', record: 'No record.', weather: [{ hour: 6, from: 235, kt: 30, cloud: 0.6, air: -4 }, { hour: 18, from: 260, kt: 24, cloud: 0.6, air: -2 }] },
  ],

  // Bergs and growlers drift out of the Weddell Sea round these islands. They met loose ice the first afternoon and ran
  // north to be clear of it by dark.
  ice: { north: -59.9, days: 2.5 },
  // The West Wind Drift, setting east to north-east at half a knot to a knot.
  drift: { toward: 65, spread: 22, kt: [0.5, 1.0] },

  // For the later stages. Stage 1 reads none of these.
  events: [
    { day: 0, hour: 15, kind: 'ice', record: 'Loose pack and lumps of old ice across the course, about two hours out.' },
    { day: 2, hour: 12, kind: 'sight', record: 'First observation: 128 miles from Elephant Island.' },
    { day: 5, hour: 12, kind: 'sight', record: 'Second observation: 238 miles made good.' },
    { day: 6, hour: 18, kind: 'hove-to', record: 'Hove to with the sea anchor in a south-westerly gale.' },
    { day: 7, hour: 8, kind: 'icing', record: 'A foot of ice on the decking. Chopped away by hand, three times.' },
    { day: 8, hour: 9, kind: 'sea-anchor-lost', record: 'The painter chafed through on the ice and the sea anchor went.' },
    { day: 9, hour: 12, kind: 'sight', record: 'Third observation: 403 miles from Elephant Island.' },
    { day: 11, hour: 24, kind: 'great-wave', record: 'The great wave, at midnight.' },
    { day: 12, hour: 10, kind: 'water', record: 'The last cask of water found brackish.' },
    { day: 13, hour: 12, kind: 'kelp', record: 'Kelp, and birds from the land.' },
    { day: 14, hour: 12.5, kind: 'landfall', record: 'Land seen through the murk, about ten miles off.' },
    { day: 15, hour: 10, kind: 'hurricane', record: 'Hurricane on a lee shore.' },
    { day: 16, hour: 17, kind: 'landing', record: 'Landed in a cove inside King Haakon Bay.' },
  ],
};

export const VOYAGES: Voyage[] = [CAIRD];
