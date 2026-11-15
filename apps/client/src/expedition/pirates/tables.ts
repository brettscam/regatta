// The Caribbean game's data: ships, goods, ports, routes, artifacts. Adding a row to a table here adds a ship, a port,
// a cargo, a sea lane or a thing for the cabinet. No code elsewhere names any of them, except the player's own sloop
// (`PLAYER_CLASS`) and the port she starts from (`HOME_PORT`).
//
// Everything is written from memory of the period about 1715 and of the chart, and none of it was checked against a
// source while writing. Ship sizes, crews and guns are typical figures for the type, not any one vessel's. Prices and
// purses are made for the game. The artifacts are inventions in the manner of the period: no such objects are recorded.

export type Nation = 'english' | 'spanish' | 'french' | 'dutch' | 'pirate';
export type ShipKind = 'merchant' | 'warship' | 'pirate';

/** One mast as it is drawn: where it stands, how tall, and what it carries. */
export interface MastLook {
  /** Distance from the stem as a share of her length. */
  at: number;
  /** Height above the deck, metres. */
  height: number;
  rig: 'gaff' | 'square';
}

export interface ShipClass {
  id: string;
  name: string;
  /** What the look-out calls her from her masts alone. */
  rigWords: string;
  kind: ShipKind;
  /** Length on deck, beam and freeboard amidships, metres. */
  loa: number;
  beam: number;
  freeboard: number;
  draft: number;
  masts: MastLook[];
  /** Guns in all, half to a side, and the weight of their shot in pounds. */
  guns: number;
  gunLb: number;
  crew: number;
  /** How much shot her hull will take. */
  hull: number;
  /** Her best speed in a fresh breeze, knots, the closest she lies to the wind, degrees, and how she goes dead before it against her best. */
  maxKt: number;
  pointDeg: number;
  runShare: number;
  /** How well her people lay a gun: 1 a man-of-war's crew. */
  gunnery: number;
  /** How much of a beating she takes before she strikes: 0 strikes at a shot, 1 never. */
  courage: number;
  /** How hard her people fight hand to hand, man for man. */
  fight: number;
  /** Tons of cargo she carries, the coin in her cabin (least and most), and the chance of something for the cabinet. */
  cargoTons: number;
  coin: [number, number];
  artifactChance: number;
  /** Notoriety gained by taking her. */
  infamy: number;
}

export const SHIP_CLASSES: ShipClass[] = [
  {
    id: 'jamaica-sloop', name: 'Jamaica sloop', rigWords: 'one mast, fore-and-aft: a sloop', kind: 'pirate',
    loa: 18.5, beam: 6.1, freeboard: 1.7, draft: 2.5, masts: [{ at: 0.36, height: 21, rig: 'gaff' }],
    guns: 6, gunLb: 4, crew: 32, hull: 100, maxKt: 11, pointDeg: 50, runShare: 0.82,
    gunnery: 0.85, courage: 0.75, fight: 1.25, cargoTons: 45, coin: [0, 0], artifactChance: 0, infamy: 0,
  },
  {
    id: 'trading-sloop', name: 'trading sloop', rigWords: 'one mast, fore-and-aft: a sloop', kind: 'merchant',
    loa: 14.5, beam: 4.9, freeboard: 1.4, draft: 2.0, masts: [{ at: 0.36, height: 16, rig: 'gaff' }],
    guns: 4, gunLb: 3, crew: 11, hull: 60, maxKt: 6.6, pointDeg: 52, runShare: 0.82,
    gunnery: 0.5, courage: 0.12, fight: 0.75, cargoTons: 24, coin: [40, 170], artifactChance: 0.06, infamy: 3,
  },
  {
    id: 'brigantine', name: 'brigantine', rigWords: 'two masts, square on the fore: a brigantine', kind: 'merchant',
    loa: 22, beam: 6.6, freeboard: 2.0, draft: 2.8, masts: [{ at: 0.27, height: 19, rig: 'square' }, { at: 0.62, height: 21, rig: 'gaff' }],
    guns: 8, gunLb: 4, crew: 22, hull: 115, maxKt: 6.4, pointDeg: 58, runShare: 0.95,
    gunnery: 0.55, courage: 0.24, fight: 0.85, cargoTons: 70, coin: [120, 520], artifactChance: 0.14, infamy: 5,
  },
  {
    id: 'merchantman', name: 'merchant ship', rigWords: 'three masts, square-rigged: a ship', kind: 'merchant',
    loa: 29, beam: 8.2, freeboard: 2.8, draft: 3.6, masts: [{ at: 0.2, height: 22, rig: 'square' }, { at: 0.5, height: 26, rig: 'square' }, { at: 0.8, height: 17, rig: 'gaff' }],
    guns: 12, gunLb: 6, crew: 34, hull: 185, maxKt: 6.0, pointDeg: 64, runShare: 1,
    gunnery: 0.55, courage: 0.4, fight: 0.85, cargoTons: 150, coin: [300, 1100], artifactChance: 0.22, infamy: 8,
  },
  {
    id: 'register-ship', name: 'Spanish register ship', rigWords: 'three masts, square-rigged and deep laden: a great ship', kind: 'merchant',
    loa: 34, beam: 9.6, freeboard: 3.6, draft: 4.4, masts: [{ at: 0.2, height: 25, rig: 'square' }, { at: 0.5, height: 30, rig: 'square' }, { at: 0.8, height: 19, rig: 'gaff' }],
    guns: 20, gunLb: 8, crew: 85, hull: 270, maxKt: 5.8, pointDeg: 66, runShare: 1,
    gunnery: 0.7, courage: 0.62, fight: 1.0, cargoTons: 200, coin: [1600, 4200], artifactChance: 0.65, infamy: 14,
  },
  {
    id: 'guarda-costa', name: 'guarda costa sloop', rigWords: 'one mast, fore-and-aft: a sloop, and a big crew on her deck', kind: 'warship',
    loa: 18, beam: 5.9, freeboard: 1.7, draft: 2.4, masts: [{ at: 0.36, height: 20, rig: 'gaff' }],
    guns: 8, gunLb: 4, crew: 58, hull: 110, maxKt: 9.4, pointDeg: 51, runShare: 0.82,
    gunnery: 0.8, courage: 0.7, fight: 1.1, cargoTons: 10, coin: [60, 260], artifactChance: 0.05, infamy: 10,
  },
  {
    id: 'navy-sloop', name: 'sloop of war', rigWords: 'two masts, square-rigged, and a pennant at the main: a King\'s sloop', kind: 'warship',
    loa: 23, beam: 7.0, freeboard: 2.2, draft: 3.0, masts: [{ at: 0.27, height: 21, rig: 'square' }, { at: 0.63, height: 24, rig: 'square' }],
    guns: 10, gunLb: 6, crew: 70, hull: 130, maxKt: 9.2, pointDeg: 57, runShare: 0.98,
    gunnery: 0.9, courage: 0.75, fight: 1.3, cargoTons: 12, coin: [80, 320], artifactChance: 0.08, infamy: 18,
  },
  {
    id: 'rover', name: 'rover\'s sloop', rigWords: 'one mast, fore-and-aft: a sloop, sailed hard', kind: 'pirate',
    loa: 17.5, beam: 5.8, freeboard: 1.6, draft: 2.4, masts: [{ at: 0.36, height: 20, rig: 'gaff' }],
    guns: 8, gunLb: 4, crew: 50, hull: 100, maxKt: 9.6, pointDeg: 50, runShare: 0.82,
    gunnery: 0.8, courage: 0.6, fight: 1.2, cargoTons: 40, coin: [200, 900], artifactChance: 0.3, infamy: 2,
  },
];

export const PLAYER_CLASS = 'jamaica-sloop';
/** What the player's sloop can be brought up to in port. SEAM: a bigger ship is another class with its own limits. */
export const PLAYER_LIMITS = { guns: 10, crew: 75 };
/** Men it takes to work one gun, and to sail her while they do. */
export const MEN_PER_GUN = 4;
export const MEN_TO_SAIL = 8;

export function shipClass(id: string): ShipClass {
  const c = SHIP_CLASSES.find((k) => k.id === id);
  if (!c) throw new Error(`No ship class ${id}`);
  return c;
}

export interface Good {
  id: string;
  name: string;
  /** Coin a ton, in a port that neither grows it nor wants it. */
  price: number;
}

export const GOODS: Good[] = [
  { id: 'sugar', name: 'Sugar', price: 9 },
  { id: 'rum', name: 'Rum', price: 13 },
  { id: 'tobacco', name: 'Tobacco', price: 15 },
  { id: 'hides', name: 'Hides', price: 7 },
  { id: 'logwood', name: 'Logwood', price: 11 },
  { id: 'cloth', name: 'Cloth', price: 22 },
  { id: 'cacao', name: 'Cacao', price: 26 },
  { id: 'indigo', name: 'Indigo', price: 38 },
  { id: 'spices', name: 'Spices', price: 55 },
  { id: 'silver', name: 'Plate', price: 120 },
];

export interface Port {
  id: string;
  name: string;
  nation: Nation;
  /** The town, degrees north and west. The anchorage is found off it when the sea is made. */
  lat: number;
  lonW: number;
  say: string;
  /** Notoriety at which the port is shut to her and its guns open. Null for a port that asks no questions. */
  shutAt: number | null;
  /** What each good fetches here against its plain price. A good not listed fetches the plain price. */
  pays: Record<string, number>;
  /** What the yard and the taverns can do, as a share of the plain cost of a repair and of the plain number of men to be found. 0 for none. */
  repair: number;
  recruits: number;
  gunsForSale: boolean;
  /** Coin the governor takes to forget a little of what she has done, or 0 where no one can be bought. */
  pardon: number;
}

export const PORTS: Port[] = [
  {
    id: 'port-royal', name: 'Port Royal', nation: 'english', lat: 17.935, lonW: 76.84,
    say: 'Jamaica. What the earthquake of 1692 left of the richest town in the Indies: a King\'s yard, merchants, and a gibbet on the point.',
    shutAt: 40, pays: { sugar: 0.6, rum: 0.7, cloth: 1.25, indigo: 1.2, cacao: 1.15, spices: 1.2, silver: 1.0, tobacco: 1.1, logwood: 1.2 },
    repair: 1, recruits: 0.7, gunsForSale: true, pardon: 0,
  },
  {
    id: 'tortuga', name: 'Tortuga', nation: 'french', lat: 20.01, lonW: 72.72,
    say: 'Cayona road, under the fort on the rock. The old home of the Brethren of the Coast, and still no place to ask a man his trade.',
    shutAt: null, pays: { sugar: 0.9, rum: 1.3, cloth: 1.1, tobacco: 0.75, hides: 0.7, indigo: 0.9, silver: 0.95, spices: 1.1 },
    repair: 1.25, recruits: 1.4, gunsForSale: true, pardon: 350,
  },
  {
    id: 'santiago', name: 'Santiago de Cuba', nation: 'spanish', lat: 19.975, lonW: 75.87,
    say: 'A long harbour behind the Morro castle. The governor buys cloth and asks few questions of a quiet ship. He hangs the others.',
    shutAt: 12, pays: { cloth: 1.5, rum: 1.1, sugar: 0.8, tobacco: 0.6, hides: 0.6, cacao: 0.8, spices: 1.3, indigo: 1.1, silver: 0.9 },
    repair: 1.1, recruits: 0, gunsForSale: false, pardon: 0,
  },
  {
    id: 'ile-a-vache', name: 'Île-à-Vache', nation: 'pirate', lat: 18.1, lonW: 73.66,
    say: 'A low island off the south of Hispaniola where the buccaneers careened. Smugglers buy anything here, at their own price.',
    shutAt: null, pays: { sugar: 0.75, rum: 0.9, cloth: 0.9, tobacco: 0.9, hides: 0.8, logwood: 0.8, cacao: 0.9, indigo: 0.85, spices: 0.85, silver: 0.85 },
    repair: 0.8, recruits: 1.0, gunsForSale: false, pardon: 0,
  },
];

export const HOME_PORT = 'port-royal';

/** A turn in a sea lane, degrees north and west. */
export type LaneTurn = [number, number];

export interface Lane {
  id: string;
  nation: Nation;
  /** The ships that sail it and how often each kind is met, as weights. */
  ships: Array<[string, number]>;
  /** What they carry, as weights. */
  cargo: Array<[string, number]>;
  /** Hours between one ship leaving and the next. */
  every: number;
  /** A man-of-war goes round and round her beat. A trader sails it once. */
  patrol?: boolean;
  turns: LaneTurn[];
  /** How a rumour in a tavern speaks of it. */
  rumour: string;
}

const PR: LaneTurn = [17.84, 76.86];
const MORANT: LaneTurn = [17.78, 76.02];
const PASSAGE_S: LaneTurn = [19.35, 74.6];
const PASSAGE_N: LaneTurn = [20.3, 73.78];
const NORTH_OUT: LaneTurn = [21.22, 73.95];
const SANTIAGO: LaneTurn = [19.84, 75.88];
const CRUZ: LaneTurn = [19.62, 77.9];
const TORTUGA: LaneTurn = [19.97, 72.74];
const TIBURON: LaneTurn = [18.25, 74.75];
const VACHE: LaneTurn = [17.98, 73.68];

export const LANES: Lane[] = [
  {
    id: 'sugar-fleet', nation: 'english', every: 9, ships: [['merchantman', 3], ['brigantine', 4], ['trading-sloop', 1]],
    cargo: [['sugar', 6], ['rum', 3], ['indigo', 1], ['logwood', 1]],
    turns: [PR, MORANT, PASSAGE_S, PASSAGE_N, NORTH_OUT],
    rumour: 'The sugar ships are clearing from Port Royal for home, round Morant Point and up through the Windward Passage.',
  },
  {
    id: 'london-trade', nation: 'english', every: 11, ships: [['merchantman', 2], ['brigantine', 4]],
    cargo: [['cloth', 6], ['spices', 1], ['rum', 1]],
    turns: [NORTH_OUT, PASSAGE_N, PASSAGE_S, MORANT, PR],
    rumour: 'Ships out of Bristol and London come down the Windward Passage for Jamaica with cloth and ironware, and money to buy sugar.',
  },
  {
    id: 'cuba-coast', nation: 'spanish', every: 10, ships: [['brigantine', 4], ['trading-sloop', 3], ['merchantman', 1]],
    cargo: [['tobacco', 5], ['hides', 4], ['sugar', 1]],
    turns: [SANTIAGO, CRUZ, [19.75, 79.3], [19.95, 80.6], [20.0, 81.5]],
    rumour: 'Tobacco and hides go west from Santiago under the Sierra Maestra, round Cabo Cruz and on for Havana.',
  },
  {
    id: 'havana-santiago', nation: 'spanish', every: 13, ships: [['brigantine', 3], ['merchantman', 2]],
    cargo: [['cloth', 4], ['spices', 1], ['cacao', 2]],
    turns: [[20.0, 81.5], [19.95, 80.6], [19.75, 79.3], CRUZ, SANTIAGO],
    rumour: 'The Havana traders come east along the south of Cuba, standing well off the Gardens of the Queen, bound for Santiago.',
  },
  {
    id: 'cartagena-plate', nation: 'spanish', every: 46, ships: [['register-ship', 1]],
    cargo: [['silver', 3], ['cacao', 3], ['indigo', 2], ['spices', 1]],
    turns: [[16.98, 75.9], [18.3, 75.35], SANTIAGO],
    rumour: 'A register ship is looked for at Santiago out of Cartagena, with plate and cacao. She will come up from the south, east of the Formigas.',
  },
  {
    id: 'french-indigo', nation: 'french', every: 9, ships: [['brigantine', 3], ['trading-sloop', 4]],
    cargo: [['indigo', 4], ['sugar', 3], ['tobacco', 2]],
    turns: [[18.62, 72.92], [18.98, 73.55], [19.6, 73.65], [20.0, 73.6], TORTUGA],
    rumour: 'The French planters of Léogâne send their indigo out by the Gonâve channel and round Cap du Môle.',
  },
  {
    id: 'french-supply', nation: 'french', every: 12, ships: [['trading-sloop', 4], ['brigantine', 2]],
    cargo: [['cloth', 3], ['rum', 3], ['hides', 2]],
    turns: [TORTUGA, [20.0, 73.6], [19.6, 73.65], [18.98, 73.55], [18.62, 72.92]],
    rumour: 'Small craft run from Tortuga down to Petit-Goâve with wine, cloth and whatever was landed quietly at Cayona.',
  },
  {
    id: 'curacao-dutch', nation: 'dutch', every: 14, ships: [['brigantine', 3], ['merchantman', 2]],
    cargo: [['cacao', 4], ['spices', 2], ['cloth', 3]],
    turns: [[17.75, 72.3], VACHE, TIBURON, MORANT, PR],
    rumour: 'Dutchmen from Curaçao work along the south of Hispaniola to Jamaica, selling to anyone, with cacao and East India goods.',
  },
  {
    id: 'jamaica-coast', nation: 'english', every: 7, ships: [['trading-sloop', 5], ['brigantine', 1]],
    cargo: [['rum', 4], ['sugar', 4], ['logwood', 1]],
    turns: [[18.66, 77.55], [18.62, 78.35], [18.2, 78.62], [17.8, 78.2], [17.55, 77.2], PR],
    rumour: 'Droghers bring rum and sugar round from the north-side estates by Negril and Portland Point to Port Royal.',
  },
  {
    id: 'bay-logwood', nation: 'english', every: 16, ships: [['brigantine', 3], ['trading-sloop', 2]],
    cargo: [['logwood', 7], ['hides', 1]],
    turns: [[18.1, 81.5], [17.95, 78.75], [17.55, 77.2], PR],
    rumour: 'The Baymen send their logwood up from Honduras: slow, deep brigantines, coming in from the west under Jamaica.',
  },
  {
    id: 'kings-beat', nation: 'english', every: 60, patrol: true, ships: [['navy-sloop', 1]], cargo: [],
    turns: [PR, MORANT, [18.45, 76.0], [18.7, 77.0], [18.66, 78.4], [18.0, 78.75], [17.5, 77.3], PR],
    rumour: 'The King\'s sloop on the Jamaica station cruises round the island and is back at Port Royal within the week.',
  },
  {
    id: 'guarda-beat', nation: 'spanish', every: 50, patrol: true, ships: [['guarda-costa', 1]], cargo: [],
    turns: [SANTIAGO, [19.75, 75.0], PASSAGE_S, [19.4, 76.2], [19.6, 77.6], SANTIAGO],
    rumour: 'The guarda costa of Santiago keeps between Cabo Cruz and the Windward Passage, and takes any foreigner she can call a smuggler.',
  },
  {
    id: 'rover', nation: 'pirate', every: 70, patrol: true, ships: [['rover', 1]], cargo: [['rum', 2], ['cloth', 2], ['indigo', 1], ['silver', 1]],
    turns: [TORTUGA, [20.0, 73.6], PASSAGE_N, PASSAGE_S, TIBURON, [18.9, 74.6], [19.6, 73.65], [20.0, 73.6], TORTUGA],
    rumour: 'Another rover is working the Windward Passage out of Tortuga. He takes what he can carry, from anyone who has it.',
  },
];

export interface Artifact {
  id: string;
  name: string;
  /** What it is and where it is said to have come from. */
  line: string;
  /** Coin a collector would give. Counted in her riches, never sold. */
  worth: number;
}

// Inventions, written to sit in the period. Add one and it can turn up in a prize.
export const ARTIFACTS: Artifact[] = [
  { id: 'astrolabe', name: 'A mariner\'s astrolabe', worth: 240, line: 'Cast brass, the scale worn smooth at the tropics. Scratched inside the ring: a pilot\'s mark and the year 1598.' },
  { id: 'jade-mask', name: 'A jade mask', worth: 600, line: 'Green stone, shell eyes, no bigger than a hand. Dug from a mound in Yucatán and carried in a friar\'s chest.' },
  { id: 'bishops-ring', name: 'A bishop\'s ring', worth: 420, line: 'Gold, set with an amethyst the size of a musket ball. The bishop it was made for never reached his see.' },
  { id: 'wreck-chart', name: 'A chart of a wreck', worth: 150, line: 'Ink on vellum: a reef, three crosses and soundings in fathoms. Nothing says which reef.' },
  { id: 'emerald-cross', name: 'An emerald cross', worth: 900, line: 'Seven stones from the mines of Muzo in a gold setting, made for a convent in Seville.' },
  { id: 'potosi-bar', name: 'A bar of Potosí silver', worth: 380, line: 'Sixty pounds, stamped with the assayer\'s mark and the King\'s fifth. The mule train it left on is not recorded.' },
  { id: 'backstaff', name: 'An ebony backstaff', worth: 130, line: 'Pearwood vanes, an ivory scale. Its owner\'s name has been cut away with a knife.' },
  { id: 'pilot-book', name: 'A Spanish pilot\'s book', worth: 520, line: 'A derrotero: every harbour from Trinidad to Vera Cruz, drawn by hand, with the marks to come in by. Worth more than a ship to the right captain.' },
  { id: 'gold-whistle', name: 'A gold boatswain\'s call', worth: 210, line: 'Given by an admiral to a man who saved a flagship, and pawned by his grandson in Havana.' },
  { id: 'pearl-rope', name: 'A rope of Margarita pearls', worth: 700, line: 'Two hundred and six, matched. Dived for off the Pearl Coast before the beds gave out.' },
  { id: 'toledo-rapier', name: 'A Toledo rapier', worth: 260, line: 'The blade signed by its maker. The cup of the hilt is dented where it stopped a boarding axe.' },
  { id: 'gold-frog', name: 'A gold frog', worth: 340, line: 'Hollow, cast in one piece, from a grave on the isthmus. The Spaniards melted a thousand like it.' },
  { id: 'ships-bell', name: 'A ship\'s bell', worth: 110, line: 'Bronze, cracked, the name of a galleon round the rim. She went on a reef in a hurricane a lifetime ago.' },
  { id: 'sea-clock', name: 'A sand-glass in a silver frame', worth: 160, line: 'A four-hour glass, the watch-glass of a flagship, with the arms of Castile on the base.' },
  { id: 'governors-seal', name: 'A governor\'s seal', worth: 300, line: 'With this and a steady hand a man could write himself a commission, or a pardon.' },
  { id: 'ivory-saint', name: 'An ivory Saint James', worth: 280, line: 'Carved in Manila, shipped to Acapulco, carried across Mexico on a mule. It has been round more of the world than any of the crew.' },
  { id: 'obsidian-mirror', name: 'A black glass mirror', worth: 230, line: 'Volcanic glass, polished, in a gilt frame added later. The Mexica looked into such things for what was coming.' },
  { id: 'huguenot-bible', name: 'A Huguenot\'s Bible', worth: 90, line: 'Geneva, 1588. Three generations of births and deaths in the flyleaf, the last at Tortuga.' },
  { id: 'tortoise-box', name: 'A tortoiseshell box of charts', worth: 190, line: 'Cayman shell, silver hinges. Inside, four charts of the Florida passage with a Dutch hand\'s corrections.' },
  { id: 'feather-cloak', name: 'A cloak of green feathers', worth: 480, line: 'Quetzal feathers on cotton, made for a lord of Guatemala. It should have rotted long ago. It has not.' },
  { id: 'brass-swivel', name: 'An old brass swivel gun', worth: 200, line: 'A breech-loader of a kind not made for a century, with dolphins for handles. It still fires.' },
  { id: 'letter-marque', name: 'A lapsed letter of marque', worth: 140, line: 'Signed at Whitehall in the late war against France and Spain. It ran out with the peace in 1713. Some captains did not notice.' },
];
