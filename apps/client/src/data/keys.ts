import { HOW_A_RACE_WORKS } from '../race/startline';

/**
 * Every control in the game, in plain words. One table, read by three things: the Keys tab of the board
 * (`ui/board.ts`), the strip of main keys across the top (`aboard/cheat.ts`) and the "new since you last sailed"
 * card (`aboard/tips.ts`). A new key is a new row here.
 *
 * Sailing is done on the boat's own parts or with these keys: there are no sailing buttons.
 */
export interface KeyRow {
  /** One string per key cap. "+" is a joiner, and anything longer than six letters is a gesture, not a key. */
  keys: string[];
  /** What it is called. */
  name: string;
  /** What it does, in a sentence or two. */
  what: string;
  /** The release note (`data/releases.json` id) this key arrived with. It is marked new to anyone who has not read that note. */
  since?: string;
}

export interface KeyGroup {
  id: string;
  title: string;
  note?: string;
  rows: KeyRow[];
}

export const KEY_GROUPS: KeyGroup[] = [
  { id: 'sailing', title: 'Sailing', note: 'The first five are all you need to get going.', rows: [
    { keys: ['A', 'D'], name: 'Steer', what: 'Turn the wheel left or right. The arrow keys do the same.' },
    { keys: ['W', 'S'], name: 'Mainsail', what: 'The big sail. W pulls it in, S lets it out.' },
    { keys: ['Q', 'E'], name: 'Jib', what: 'The front sail. Q pulls it in, E lets it out.' },
    { keys: ['T'], name: 'Tack', what: 'Turn the boat through the wind onto her other side. The crew swaps the sails over for you.' },
    { keys: ['P'], name: 'Autopilot', what: 'Press once and the pilot steers while you trim. Press again and the crew trims too, so she sails herself. A third press hands everything back. In a race the full pilot is limited to 3 minutes from the gun; steering alone is unlimited.', since: 'v30' },
    { keys: ['Shift', '+', 'P'], name: 'Autopilot mode', what: 'Choose what the autopilot follows: a compass heading, an angle to the wind, or your route on the chart.' },
    { keys: ['N'], name: 'Spinnaker', since: 'v19', what: 'The big coloured sail for when the wind is behind you. N puts it up or takes it down; while it is up, Q and E work its sheet. It will not go up with the wind ahead, must come down before a tack, and in more than about 20 knots it lays the boat over.' },
    { keys: ['J'], name: 'Reef', since: 'v19', what: 'Make the mainsail smaller when the wind gets up: the boat stands up straighter and steers again. Shift and J lets it back out.' },
    { keys: ['Point and scroll'], name: 'Grab the boat', what: 'Point at the wheel, the boom (the pole along the bottom of the mainsail) or a winch, then scroll or drag to move it.' },
  ] },
  { id: 'racing', title: 'Racing and talking', note: `How a race works. ${HOW_A_RACE_WORKS.join(' ')}`, rows: [
    { keys: ['R'], name: 'Fleet and racing', since: 'v8', what: 'See who else is out, call a race, join one, or fix one for later and send the link.' },
    { keys: ['Enter'], name: 'Hail', what: 'Type a message to the other boats on this water, then Enter again to send it. A boat that lives here answers too when she is within a few hundred metres: who she is, then the wind, the tide, a place to lie, the fishing.' },
    { keys: ['V'], name: 'Radio', since: 'v22', what: 'Hold to talk to every boat on this water on channel 16, let go to listen. Nothing is recorded. Voice works on the website only.' },
    { keys: ['Shift', '+', 'V'], name: 'Ferry and ship calls', since: 'v22', what: 'The ferries and ships call on the radio as they leave a berth, and call you by name when they will pass close; the coast station reads the weather, and yachts call for a radio check. This turns the spoken calls off or on.' },
    { keys: ['G'], name: 'Course guide', since: 'v15', what: 'Buoys on the marks, a ring round each one in a race, and a line of arrows on the water to the next. On by itself in a race.' },
  ] },
  { id: 'anchor', title: 'At anchor and ashore', rows: [
    { keys: ['X'], name: 'Stop here', since: 'v9', what: 'Slow right down first. Drops the anchor, or ties up if you are at a mooring or a dock. Press X again to set off.' },
    { keys: ['Z'], name: 'Sleep', since: 'v9', what: 'Skip to the morning. Only while stopped, and only when you are alone on the water.' },
    { keys: ['O'], name: 'Go ashore', since: 'v10', what: 'Tied up at a dock, O steps straight ashore. Anchored or on a mooring, it launches the tender: the kayak, the dinghy or the wave runner. Drive her with W A S D (Shift with W is a sprint, or flat out), press O at a beach or a bar to land, and O beside your boat to climb back aboard.' },
    { keys: ['W', 'A', 'S', 'D'], name: 'Walk, ashore', what: 'Once you have stepped off at a dock, landed the tender at a bar, or pressed O with the boat lying beside a guest dock, you are on foot. W A S D walks, Shift jogs, Q and E or a drag look round. O back where you came ashore takes you aboard.' },
    { keys: ['F'], name: 'Sit, lean, dance', what: 'Ashore: does whatever there is to do where you stand. Sit at a table or on a bar stool, lean on the rail and look out, warm your hands at a fire, dance. F again gets up, or changes the dance.' },
    { keys: ['G'], name: 'Order', what: 'Ashore, at the bar: the menu. Pick with the number keys. The last line stands everyone there a round. Nothing costs anything yet.' },
    { keys: ['1', '–', '5'], name: 'Wave and so on', what: 'Ashore: wave, cheers, point, shrug, laugh. The others ashore with you see it.' },
    { keys: ['T'], name: 'Tell the fleet', what: 'Ashore: tells every boat on the water where you are. Each is told how far and which way, and gets a mark on the chart.' },
    { keys: ['Shift', '+', 'O'], name: 'Change tender', what: 'Aboard, with the tender stowed: the next one your boat carries. Every boat has the kayak; 30 ft and up the dinghy, an outboard skiff; 42 ft and up (the catamaran, the 45 and the 50) a wave runner as well. Also chosen on the way in, beside the boat\'s name.' },
    { keys: ['K'], name: 'Crab pot', since: 'v9', what: 'Drops a pot with a buoy. Come back in about an hour and press K beside the buoy to pull it up.' },
    { keys: ['L'], name: 'Fishing line', since: 'v9', what: 'Line out or in. When "Fish on" appears, press L quickly to catch it.' },
    { keys: ['5'], name: 'Go diving', what: 'Anchored or on a mooring, or stopped in the tender: over the side with mask, fins, a speargun and a float with a dive flag. You swim on your fins with the arrow keys: each press of the up arrow is a kick, and you glide between kicks; left and right turn you; down puts your head down for a duck dive; E turns it up again; drag to look about. W A S D work the same. Kicking hard burns breath: kick, glide, and come up with air in hand. Rest on the float between dives, and wait for "breathed up" before the next. 5 under water heads for the surface, and 5 beside the boat climbs out. Clean dives grow your lungs: the logbook keeps your freediving level.' },
    { keys: ['F'], name: 'Speargun', what: 'Under water: fires the shaft where you are looking. It is good for three or four metres, so stalk close and slowly. The panel names the fish you are looking at and its rule: a protected fish, a short one or one over the limit costs a citation, and the gun stays on safe in a reserve.' },
    { keys: ['G'], name: 'Grab a lobster', what: 'Under water, within arm\'s reach of a lobster: takes it by hand, which is the only way allowed. Come at it from the front and slowly or it shoots off backwards. Each one is measured: short ones go back, and so do all of them out of season.' },
    { keys: ['6'], name: 'Lobster season practice', what: 'Where the water\'s own day is outside the lobster season: treats the season as open on your dives, and the water below as night, when lobster walk the reef. Only for you: nobody else\'s day changes. Press again to turn it off.' },
  ] },
  { id: 'views', title: 'Views', rows: [
    { keys: ['1', '2', '3', '4'], name: 'Camera', what: 'Jump to a view: the wheel, the mast, the bow, or above the boat.' },
    { keys: ['Drag'], name: 'Look around', what: 'Drag anywhere off the boat to swing the camera. Scroll to move in and out.' },
    { keys: ['M'], name: 'Chart', what: 'The map. Plan a route and see the wind and tide forecast.' },
    { keys: ['F'], name: 'Wind tunnel', since: 'v8', what: 'Shows the air flowing over your sails, and tells you whether they are set right.' },
    { keys: ['C'], name: 'Coaching', what: 'The one-line sailing hints on or off.' },
    { keys: ['Y'], name: 'Award lines', since: 'v20', what: 'Show or hide the line that says when you earn experience points.' },
    { keys: ['H'], name: 'Instruments', what: 'Hide or show the numbers on screen, and the tips with them.' },
  ] },
  { id: 'power', title: 'Under power', note: 'The engine, for when there is no wind or no room to sail. It is not allowed in a race.', rows: [
    { keys: ['I'], name: 'Engine', since: 'v21', what: 'Start it or stop it. It takes a second or two to fire, and starts out of gear.' },
    { keys: ['.'], name: 'Throttle up', since: 'v21', what: 'One step at a time: ahead slow, half, cruise, full. From astern it comes back through neutral.' },
    { keys: [','], name: 'Throttle down', since: 'v21', what: 'One step back: down to neutral, then astern slow and astern full. Astern is weak, and she steers badly backwards.' },
    { keys: ['.', ','], name: 'A powerboat\'s throttle', what: 'The centre console has no sails: the same two keys work a lever with sixteen positions ahead, from idling in gear to wide open, and hold to run it up or down. It stops in neutral on the way through. A and D turn the wheel, and with it the outboard: out of gear she hardly steers. In a sea the comma key is the one that looks after her.' },
  ] },
  { id: 'help', title: 'Time, and getting unstuck', rows: [
    { keys: ['U'], name: 'Tow', since: 'v10', what: 'Run aground? This tows you back to deep water.' },
    { keys: ['Space'], name: 'Pause', what: 'Only when you are alone on the water.' },
    { keys: ['Drag the clock'], name: 'Faster time', what: 'Drag the clock in the corner sideways to speed time up. Only when you are alone.' },
    { keys: ['/'], name: 'Key reminder', since: 'v13', what: 'Shows or hides the strip of keys at the top of the screen. It changes with what you are doing: racing, at anchor, in the kayak.' },
    { keys: ['B'], name: 'This board', what: 'Roadmap, what is new, these keys, feedback, your logbook and your profile.' },
  ] },
];

/** Every row, without the groups. */
export const ALL_KEYS: KeyRow[] = KEY_GROUPS.flatMap((g) => g.rows);

/**
 * True when a key came in with a release note newer than the last one this person read.
 * @param ids the release notes' ids, newest first
 * @param seen the id of the newest note read. Empty, or an id that is no longer listed, marks nothing.
 */
export function isNewSince(since: string | undefined, seen: string, ids: readonly string[]): boolean {
  if (!since || !seen) return false;
  const at = ids.indexOf(since);
  const read = ids.indexOf(seen);
  return at >= 0 && read >= 0 && at < read;
}

/** What the player is doing, as far as the strip of main keys is concerned. */
export type StripContext = 'sailing' | 'racing' | 'held' | 'tender' | 'diving' | 'driving';

/** The handful of keys that matter most in each situation: the caps, then a word or two. */
export const STRIPS: Record<StripContext, Array<[string[], string]>> = {
  sailing: [
    [['A', 'D'], 'steer'],
    [['W', 'S'], 'mainsail in, out'],
    [['Q', 'E'], 'jib in, out'],
    [['T'], 'tack'],
    [['P'], 'autopilot'],
    [['R'], 'race'],
    [['B'], 'all keys'],
  ],
  racing: [
    [['A', 'D'], 'steer'],
    [['T'], 'tack'],
    [['N'], 'spinnaker'],
    [['J'], 'reef'],
    [['G'], 'rings and line'],
    [['R'], 'race panel'],
    [['V'], 'radio'],
  ],
  held: [
    [['X'], 'set off'],
    [['O'], 'go ashore'],
    [['5'], 'dive'],
    [['L', 'K'], 'fishing line, crab pot'],
    [['Z'], 'sleep till morning'],
    [['I'], 'engine'],
    [['B'], 'all keys'],
  ],
  driving: [
    [['.', ','], 'throttle up, down'],
    [['A', 'D'], 'steer'],
    [['I'], 'engine'],
    [['P'], 'autopilot'],
    [['M'], 'chart'],
    [['X'], 'stop here'],
    [['B'], 'all keys'],
  ],
  tender: [
    [['W', 'S'], 'ahead, back'],
    [['Shift'], 'flat out'],
    [['A', 'D'], 'turn'],
    [['O'], 'land, or climb back aboard'],
    [['B'], 'all keys'],
  ],
  diving: [
    [['↑'], 'kick, then glide'],
    [['←', '→'], 'turn'],
    [['↓', 'E'], 'head down, up'],
    [['F'], 'fire'],
    [['G'], 'grab a lobster'],
    [['5'], 'surface; climb out'],
  ],
};

/** Which strip to show. The kayak comes first: while she is out, the yacht's keys are not hers. */
export function stripContext(c: { away: boolean; racing: boolean; held: boolean; diving?: boolean; power?: boolean }): StripContext {
  return c.diving ? 'diving' : c.away ? 'tender' : c.racing ? 'racing' : c.held ? 'held' : c.power ? 'driving' : 'sailing';
}
