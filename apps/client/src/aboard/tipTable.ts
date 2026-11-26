import { DAY, type Snap, type Tip } from './tipRules';

/**
 * Every pop-up tip in the game. A new tip is a new row: an id, the words, the keys to draw, and `when`, the moment
 * it is for, written against the snapshot in `tipRules.ts`. Nothing else needs touching.
 *
 * Words: a short title, then one or two plain sentences that a person who has never sailed can follow.
 * Priority: 100 is "she is in trouble now", 80 to 95 something that has just happened, 40 to 60 a good moment,
 * under 30 a nicety. Ids are kept in players' browsers, so do not rename one: retire it and add another.
 */

const SITE = 'bajaregatta.com';
/** New to the game: the first couple of sails. */
const novice = (s: Snap): boolean => s.sails <= 2 && s.hours < 1.5;
const sailing = (s: Snap): boolean => s.hold === 'none' && !s.tender && !s.aground;
/** Under way in a boat that has sails: the tips about sails, tacking and racing are for her only. */
const underSail = (s: Snap): boolean => sailing(s) && !s.power;
const other = (s: Snap): string => s.boatName || 'Another boat';
/** The tender she carries, as the skipper would call it: the skiff is the dinghy. */
const dinghy = (s: Snap): string => (s.tenderName === 'Skiff' ? 'dinghy' : s.tenderName.toLowerCase());

export const TIPS: Tip[] = [
  // ---- the first sail: four tips over the first minutes ------------------------------------------------
  {
    id: 'welcome-steer', icon: 'helm', title: 'Welcome aboard', keys: ['A', 'D'], series: true, priority: 99, max: 1,
    text: 'The crew is steering for now. Press A or D and the wheel is yours: A turns her left, D turns her right.',
    when: (s) => novice(s) && !s.lesson && s.t >= 6 && underSail(s),
    done: ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'], doneWhen: (s) => s.hand,
  },
  {
    id: 'welcome-trim', icon: 'sail', title: 'Set the sails', keys: ['W', 'S', 'Q', 'E'], series: true, priority: 98, max: 1,
    text: 'W pulls the mainsail in and S lets it out. Q and E do the same for the jib, the front sail. If a sail flutters, pull it in until it just stops.',
    when: (s) => novice(s) && !s.lesson && s.t >= 45 && underSail(s),
    done: ['KeyW', 'KeyS', 'KeyQ', 'KeyE'],
  },
  {
    id: 'welcome-power', icon: 'engine', title: 'Welcome aboard', keys: ['.', ',', 'A', 'D'], series: true, priority: 99, max: 2,
    text: 'No sails on this one. The full stop key opens the throttle a step and the comma key closes it: hold either. A and D turn the wheel. In a sea, the comma key is the one that looks after her.',
    when: (s) => s.power && s.sails <= 3 && s.t >= 14 && sailing(s),
    done: ['Period'],
  },
  {
    id: 'welcome-keys', icon: 'keys', title: 'Every key, when you want it', keys: ['/', 'B'], series: true, priority: 97, max: 1,
    text: 'The / key shows the main keys across the top of the screen. B opens the board: its Keys tab lists every one, and you can search it.',
    when: (s) => novice(s) && s.t >= 90,
    done: ['Slash', 'KeyB'],
  },
  {
    id: 'welcome-company', icon: 'boats', title: 'You may not be alone', keys: ['R'], series: true, priority: 96, max: 1,
    text: 'Other people sail this water. When one is out, her boat appears with the skipper\'s name over the mast. R shows who is here.',
    when: (s) => novice(s) && s.shared && s.company === 0 && s.t >= 150,
    done: ['KeyR'],
  },

  // ---- back after an update --------------------------------------------------------------------------
  {
    id: 'news', icon: 'news', title: 'New since you last sailed', keys: ['B'], list: 'news', priority: 85, max: 99, cooldown: 0, secs: 26,
    text: 'The game has changed while you were ashore. B has the rest, under What\'s new.',
    when: (s) => s.news > 0 && s.t >= 10,
    ack: ['KeyB'],
  },

  // ---- other people: the radio, hails and races ------------------------------------------------------
  {
    id: 'company-radio', icon: 'radio', title: 'You have company', keys: ['V', 'Enter'], priority: 95, max: 3, cooldown: DAY / 4, hold: 5, secs: 22,
    text: (s) => `${other(s)} is on this water with you. Hold V and talk: every boat here hears you on channel 16. Let go to listen. Enter types a message instead.`,
    when: (s) => s.voice && s.company > 0,
    done: ['KeyV'],
  },
  {
    id: 'company-hail', icon: 'radio', title: 'You have company', keys: ['Enter'], priority: 95, max: 3, cooldown: DAY / 4, hold: 5, secs: 22,
    text: (s) => `${other(s)} is on this water with you. Press Enter, type a message and press Enter again: every boat here reads it. To talk by voice, sail on the website, ${SITE}, and hold V.`,
    when: (s) => !s.voice && s.shared && s.company > 0,
    done: ['Enter'],
  },
  {
    id: 'radio-call', icon: 'radio', title: 'That was the radio', keys: ['Shift', '+', 'V'], priority: 60,
    text: 'Ferries and ships call on channel 16 as they leave a berth, and call you by name when they will pass close. The words are written at the bottom left. Shift and V turns their calls off.',
    when: (s) => s.trafficCalls > 0,
    done: ['Shift+KeyV'],
  },
  {
    id: 'race-offer', icon: 'flag', title: 'A race has been called', keys: ['R'], priority: 80, cooldown: 600, max: 3,
    text: 'Press R to see it and join. If you are far away, joining tows you to the start.',
    when: (s) => s.raceOffered && !s.racing && underSail(s),
    done: ['KeyR'],
  },
  {
    id: 'race-call', icon: 'flag', title: 'Race them', keys: ['R'], priority: 55, hold: 90,
    text: 'Press R to call a race now, or fix one for later and send your friends the link.',
    when: (s) => s.company > 0 && !s.racing && !s.raceOffered && underSail(s),
    done: ['KeyR'],
  },
  {
    id: 'race-start', icon: 'flag', title: 'Your first start', keys: [], priority: 90, secs: 24,
    text: 'Sail to the ring on the water round the start mark. The line under the clock says how far it is, and whether you will be early or late. Be inside the ring, and moving, when the gun goes.',
    when: (s) => s.racing && s.races === 0 && s.countdown !== null && s.countdown > 90,
  },
  {
    id: 'race-done', icon: 'star', title: 'Race sailed', keys: ['B'], priority: 70,
    text: 'Finishing earns experience points. B opens the board: your rank is on the Logbook tab, and your skipper\'s name and looks on the Profile tab.',
    when: (s) => s.raceDone > 0 && !s.racing,
    ack: ['KeyB'],
  },

  // ---- trouble ---------------------------------------------------------------------------------------
  {
    id: 'aground', icon: 'tow', title: 'Aground', keys: ['U'], priority: 100, urgent: true, hold: 6, cooldown: 600, max: 3,
    text: 'She is on the bottom. Press U and a tow takes her to the nearest deep water.',
    when: (s) => s.aground,
    done: ['KeyU'],
  },
  {
    id: 'reef', icon: 'sail', title: 'Too much sail', keys: ['J'], priority: 92, urgent: true, hold: 8, cooldown: 900, max: 3,
    text: (s) => `She is overpowered in ${Math.round(s.windKt)} knots. Press J and the crew reefs the mainsail: she stands up and steers again. Shift and J lets it out when the wind eases.`,
    when: (s) => sailing(s) && s.reef < s.reefs && ((s.windKt > 17 && s.heelDeg > 24) || (s.knockdowns > 0 && s.windKt > 14)),
    done: ['KeyJ'], doneWhen: (s) => s.reef > 0,
  },
  {
    id: 'engine', icon: 'engine', title: 'Going nowhere', keys: ['I', '.', ','], priority: 75, cooldown: 1800,
    text: 'Press I to start the engine, then the full stop key to put her ahead. The comma key throttles back. It is not allowed in a race.',
    when: (s) => s.hasEngine && !s.engine && !s.racing && underSail(s) && s.stuck > 50,
    done: ['KeyI'], doneWhen: (s) => s.engine,
  },
  {
    id: 'weather', icon: 'wind', title: 'Too much wind today?', keys: [], priority: 25, upTo: 2, max: 1,
    text: 'On the way in, under the time of day, you can choose Lighter weather: about two thirds of this wind, and much kinder.',
    when: (s) => s.knockdowns >= 2,
  },

  // ---- more sail, less work --------------------------------------------------------------------------
  {
    id: 'spinnaker', icon: 'sail', title: 'Wind behind you', keys: ['N'], priority: 45, hold: 25,
    text: 'Press N to set the spinnaker, the big coloured sail for running. Q and E work its sheet. N again takes it down, which it must be before a tack.',
    when: (s) => s.hasSpin && !s.spin && !s.engine && sailing(s) && s.twaDeg > 138 && s.windKt >= 5 && s.windKt <= 16 && s.speedKt > 1.5,
    done: ['KeyN'], doneWhen: (s) => s.spin,
  },
  {
    id: 'pilot', icon: 'helm', title: 'A long way to go', keys: ['P'], priority: 30, hold: 30,
    text: (s) => (s.power
      ? 'P switches the autopilot on: it steers for your next mark and the throttle stays yours. Shift and P has it hold a heading instead.'
      : 'P switches the autopilot on: she steers herself and the crew trims the sails. Shift and P chooses what it follows: a heading, the wind, or your route.'),
    when: (s) => s.hand && !s.racing && sailing(s) && s.t > 420 && s.mark !== null && s.mark.d > 2500,
    done: ['KeyP'],
  },
  {
    id: 'chart', icon: 'chart', title: 'The mark is upwind', keys: ['M'], priority: 40, hold: 20,
    text: 'She cannot sail straight at it, so it will take some tacks. Press M for the chart: your route, the tide and the forecast are all there.',
    when: (s) => underSail(s) && s.t > 120 && s.mark !== null && s.mark.upwind && s.mark.d > 1500,
    done: ['KeyM'],
  },
  {
    id: 'guide', icon: 'chart', title: 'Where is the mark?', keys: ['G'], priority: 35,
    text: 'Press G: a buoy stands on each mark of your route, and a line of arrows on the water leads to the next one.',
    when: (s) => s.marks > 0 && !s.racing && sailing(s) && s.t > 200,
    done: ['KeyG'],
  },
  {
    id: 'flow', icon: 'wind', title: 'See the wind', keys: ['F'], priority: 35, hold: 20,
    text: 'Press F for the wind tunnel view: lines of smoke show the air over your sails, and whether they are set right.',
    when: (s) => underSail(s) && !s.engine && ((s.mistrim && s.t > 60) || (novice(s) && s.t > 300)),
    done: ['KeyF'],
  },

  // ---- stopping, and life aboard ---------------------------------------------------------------------
  {
    id: 'berth', icon: 'anchor', title: 'Stop here', keys: ['X'], priority: 50, hold: 5,
    text: (s) => {
      const b = s.berth;
      if (!b) return 'Slow right down and press X to stop. X again sets off.';
      if (b.kind === 'dock') return `${b.name} has a dock. Slow right down beside it and press X to tie up. X again casts off.`;
      if (b.kind === 'mooring') return `${b.name} has mooring buoys. Slow right down by one and press X to pick it up. X again lets go.`;
      return `${b.name} is a good anchorage. Slow right down and press X to drop the anchor. X again weighs it.`;
    },
    when: (s) => s.berth !== null && s.berth.d < 350 && s.hold === 'none' && !s.tender && !s.racing && s.windKt < 18,
    done: ['KeyX'], doneWhen: (s) => s.hold !== 'none',
  },
  {
    id: 'anchor', icon: 'anchor', title: 'You can stop anywhere', keys: ['X'], priority: 20, hold: 40,
    text: 'Where the water is shallow enough, slow right down and press X: the anchor goes down. X again weighs it.',
    when: (s) => sailing(s) && !s.racing && s.t > 600 && s.depth > 3 && s.depth < 15 && s.windKt < 12 && s.speedKt < 2.5,
    done: ['KeyX'], doneWhen: (s) => s.hold !== 'none',
  },
  {
    id: 'ashore', icon: 'shore', title: 'Go ashore', keys: ['O'], priority: 50, hold: 8,
    text: (s) => {
      const a = s.ashore;
      if (!a) return 'Press O to go ashore.';
      return a.dock
        ? `Press O to step ashore to ${a.where}. Every place you land is stamped on the bar hop, on the board's Logbook tab.`
        : `${a.where} is close. Press O to launch the ${dinghy(s)} and ${s.tenderName === 'Kayak' ? 'paddle' : 'run'} in with W A S D, then O at the beach to land. Every place you land is stamped on the bar hop, on the board's Logbook tab.`;
    },
    when: (s) => s.hold !== 'none' && !s.tender && !s.walking && s.ashore !== null && s.ashore.d < 700,
    done: ['KeyO'], doneWhen: (s) => s.tender,
  },
  // ---- ashore: on foot -------------------------------------------------------------------------------
  {
    id: 'walk', icon: 'shore', title: 'On your own two feet', keys: ['W', 'A', 'S', 'D', 'Q', 'E'], priority: 62, hold: 3, max: 2,
    text: (s) => `You are ashore at ${s.walking?.where ?? 'the dock'}. W A S D walks and Shift jogs. Q and E, or a drag, look round. O back at the dock takes you aboard again.`,
    when: (s) => s.walking !== null,
    done: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
  },
  {
    id: 'walk-do', icon: 'shore', title: 'Pull up a chair', keys: ['F', 'G'], priority: 55, hold: 25, max: 2,
    text: (s) => `Walk up to a table, a bar stool, the rail or the dance floor and press F.${s.walking?.menu ? ' At the bar, G is the menu: it is on the house for now.' : ''}`,
    when: (s) => s.walking !== null && !s.walking.posed,
    done: ['KeyF', 'KeyG'],
  },
  {
    id: 'walk-company', icon: 'boats', title: 'You have company ashore', keys: ['1', '2', '3', '4', '5', 'Enter'], priority: 64, hold: 4, max: 3, secs: 24,
    text: (s) => `${other(s)} is ashore here too. 1 waves, 2 is cheers, 3 points, 4 shrugs, 5 laughs. Enter types words that show over your head${s.voice ? ', and V is the radio as ever: hold it and talk' : ''}. From the bar's menu you can stand everyone a round.`,
    when: (s) => s.walking !== null && s.walking.friends > 0,
    done: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Enter'],
  },
  {
    id: 'walk-tell', icon: 'radio', title: 'Tell them where you are', keys: ['T'], priority: 42, hold: 40, max: 2,
    text: (s) => `Other boats are out on this water. T tells them you are at ${s.walking?.where ?? 'the bar'}: each gets how far and which way, and a mark on the chart.`,
    when: (s) => s.walking !== null && s.walking.friends === 0 && s.company > 0,
    done: ['KeyT'],
  },
  {
    id: 'tender', icon: 'kayak', title: 'In the kayak', keys: ['W', 'A', 'S', 'D', 'O'], priority: 60, hold: 3,
    text: 'W and S paddle ahead and back, A and D turn her. Press O at a beach to land, and O beside your boat to climb back aboard.',
    when: (s) => s.tender && s.tenderName === 'Kayak',
    ack: ['KeyO'],
  },
  {
    id: 'tender-powered', icon: 'kayak', title: 'Under power', keys: ['W', 'Shift', 'A', 'D', 'O'], priority: 60, hold: 3,
    text: (s) => `W opens the throttle and Shift with it is flat out; S ${s.tenderName === 'Skiff' ? 'goes astern' : 'brakes'}, A and D steer. ${s.tenderName === 'Skiff' ? 'Ease off into a steep sea or she fills.' : 'Ease off before a hard turn or she throws you.'} Five knots near anchored boats and docks. O lands her, or brings you back aboard.`,
    when: (s) => s.tender && s.tenderName !== 'Kayak',
    ack: ['KeyO'],
  },
  {
    id: 'tender-launch', icon: 'kayak', title: 'Take the tender', keys: ['O', 'Shift', '+', 'O'], priority: 14, hold: 25,
    text: (s) => `She is ${s.hold === 'anchor' ? 'anchored' : 'made fast'}, so the tender can go. O to launch the ${dinghy(s)}${s.tenderOthers.length ? ` (Shift+O: ${s.tenderOthers.map((t) => t.toLowerCase()).join(' / ')})` : ''}. The boat stays where she is while you are away.`,
    when: (s) => s.hold !== 'none' && !s.tender && !s.walking && !s.racing && (s.berth === null || s.berth.kind !== 'dock' || s.berth.d > 40) && (s.ashore === null || s.ashore.d >= 700),
    done: ['KeyO', 'Shift+KeyO'], doneWhen: (s) => s.tender,
  },
  {
    id: 'sleep', icon: 'moon', title: 'Turn in', keys: ['Z'], priority: 30, hold: 20,
    text: 'It is dark and she is safe. Press Z to sleep until morning. It works only while you are stopped, and alone on the water.',
    when: (s) => s.hold !== 'none' && !s.tender && s.night && s.company === 0,
    done: ['KeyZ'],
  },
  {
    id: 'catch', icon: 'fish', title: 'Catch supper', keys: ['L', 'K'], priority: 15, hold: 20, cooldown: 3 * DAY, max: 2,
    text: 'L puts a fishing line over: when the crew shout "Fish on", press L again quickly. K drops a crab pot with a buoy: come back in about an hour and press K beside it.',
    when: (s) => !s.fishing && !s.tender && !s.racing && ((s.hold !== 'none' && s.heldFor > 60) || (s.hold === 'none' && s.t > 900 && s.depth > 4 && s.depth < 35 && s.speedKt > 0.4 && s.speedKt < 3)),
    done: ['KeyL', 'KeyK'],
  },
  {
    id: 'dive', icon: 'fish', title: 'Go over the side', keys: ['5'], priority: 13, hold: 40, cooldown: 3 * DAY, max: 2,
    text: '5 puts you in the water with a mask, fins and a speargun, from the boat at anchor or from the tender. The arrow keys are your fins: up kicks, down puts your head down to dive. You have one breath, so kick, glide, and rest on the float between dives.',
    when: (s) => !s.tender && !s.racing && !s.night && s.hold !== 'none' && s.heldFor > 150 && s.depth > 2 && s.depth < 30,
    done: ['Digit5'],
  },

  // ---- fishing, on a water with its own fishing (`s.fishing` is there) ---------------------------------------
  {
    id: 'fish-troll', icon: 'fish', title: 'Tow a lure', keys: ['L'], priority: 16, hold: 25, cooldown: 2 * DAY, max: 3,
    text: (s) => `She is making ${s.speedKt.toFixed(0)} knots over fishing water. L puts a lure out astern: feathers fish at 5 to 7 knots, plugs at 6 to 9. When the reel goes off, slow down.`,
    when: (s) => !!s.fishing && !s.fishing.out && s.fishing.trollWater && !s.tender && !s.racing && s.hold === 'none' && s.t > 240 && s.speedKt > 4.5 && s.speedKt < 9.5 && !s.night,
    done: ['KeyL'],
  },
  {
    id: 'fish-fight', icon: 'fish', title: 'Fish on', keys: ['L'], priority: 88, urgent: true, max: 3, cooldown: 600, secs: 14,
    text: 'Hold L to wind while the fish rests, and let go while it runs: the drag tires it for you. Slow the boat, or the line parts. Winding against a run breaks it too.',
    when: (s) => !!s.fishing?.fighting,
    doneWhen: (s) => (s.fishing?.landed ?? 0) >= 3,
  },
  {
    id: 'fish-card', icon: 'fish', title: 'The fishing card', keys: ['Shift', '+', 'L'], priority: 14, hold: 40, cooldown: 2 * DAY, max: 2,
    text: 'Shift+L opens the fishing card: what is biting here and why, the lure or the bait, the day\'s catch, and tournaments against the club or your friends. The chart (M) has a fishing layer.',
    when: (s) => !!s.fishing?.out && !s.fishing.fighting && !s.racing,
    done: ['Shift+KeyL'],
  },
  {
    id: 'fish-bait', icon: 'fish', title: 'The bait barge', keys: [], priority: 15, hold: 10, cooldown: 2 * DAY, max: 2,
    text: 'The bait barge is close by. Stop beside it, under a knot and a half, and the crew take a scoop of live sardines: nearly everything eats one, and it is the only way for halibut.',
    when: (s) => !!s.fishing?.bargeNear && s.fishing.bait === 0 && !s.racing && !s.tender,
    doneWhen: (s) => (s.fishing?.bait ?? 0) > 0,
  },
  {
    id: 'fish-derby', icon: 'flag', title: 'A fishing tournament', keys: ['Shift', '+', 'L'], priority: 45, hold: 4, cooldown: 1800, max: 4,
    text: 'A fishing tournament has been called on this water. Shift+L, then Join: fish anywhere you like until the lines come out, and the leaderboard is on the card.',
    when: (s) => !!s.fishing?.offered && !s.racing,
    ack: ['Shift+KeyL'],
  },

  // ---- the board -------------------------------------------------------------------------------------
  {
    id: 'points', icon: 'star', title: 'Experience points', keys: ['B', 'Y'], priority: 20, upTo: 1,
    text: 'The lines that come up on the right are points for sailing her well. B, then the Logbook tab, shows your rank. Y hides the lines.',
    when: (s) => s.xpGained > 0 && s.t > 360,
    done: ['KeyY'], ack: ['KeyB'],
  },
  {
    id: 'board', icon: 'news', title: 'Have your say', keys: ['B'], priority: 10, max: 1,
    text: 'B opens the board. Vote on what gets built next, and tell the people building Regatta what felt right and what felt off.',
    when: (s) => s.sails >= 2 && s.t > 900 && sailing(s),
    done: ['KeyB'],
  },

  // ---- shown only when asked for: the radio light is clicked ------------------------------------------
  {
    id: 'radio-about', icon: 'radio', title: 'The radio, channel 16', keys: ['V', 'Shift', '+', 'V'], priority: 0, max: 99, cooldown: 0, secs: 22,
    text: (s) => (s.voice
      ? 'Hold V to talk to every boat on this water, and let go to listen. Nothing is recorded. This light comes on when anyone is on the air. Shift and V turns the ferry and ship calls off or on.'
      : `Ferries and ships call here as they leave a berth or pass close, and this light comes on. Shift and V turns their calls off or on. Voice between boats (hold V) works on the website, ${SITE}. Here, press Enter to type to the other boats.`),
    when: () => false,
  },

  // ---- rows for features on the way: take the comment marks off and fill in the trigger ---------------
  // Each needs one small fact in the snapshot (`Snap` in tipRules.ts, filled in `tips.ts`), named below.
  //
  // Crew aboard one boat (needs `crewAboard: number`, `crewInvite: boolean`):
  // {
  //   id: 'crew-invite', icon: 'boats', title: 'Sail her together', keys: ['R'], priority: 50, hold: 60,
  //   text: 'A friend can come aboard as crew and work the sheets while you steer. R has the invitation.',
  //   when: (s) => s.company > 0 && s.crewAboard === 0 && !s.racing,
  //   done: ['KeyR'],
  // },
  //
  // Tenders seen by everyone (needs `tendersNear: number`):
  // {
  //   id: 'tender-company', icon: 'kayak', title: 'Someone is paddling in', keys: ['O'], priority: 40,
  //   text: (s) => `${other(s)} has taken the kayak ashore. Stop nearby with X, then O, and join them.`,
  //   when: (s) => s.tendersNear > 0 && s.hold === 'none',
  //   done: ['KeyO'],
  // },
  //
  // Resident boats that answer the radio (needs `resident: { name: string; d: number } | null`):
  // {
  //   id: 'resident-hail', icon: 'radio', title: 'A boat that lives here', keys: ['V'], priority: 45, hold: 10,
  //   text: (s) => `${s.resident!.name} keeps a radio watch. Hold V and call her.`,
  //   when: (s) => s.resident !== null && s.resident.d < 800,
  //   done: ['KeyV'],
  // },
  //
  // Landmarks ashore (needs `landmark: { name: string; say: string; d: number } | null`):
  // {
  //   id: 'landmark', icon: 'shore', title: 'Worth a look', keys: ['3'], priority: 15, cooldown: 3 * DAY,
  //   text: (s) => `${s.landmark!.name} is off the bow. ${s.landmark!.say} Press 3 for the view from the foredeck.`,
  //   when: (s) => s.landmark !== null && s.landmark.d < 900 && s.hold === 'none',
  // },
];
