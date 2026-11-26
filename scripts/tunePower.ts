// The tuning table for a powerboat: what `scripts/tune.ts` prints for a boat file with a `power` block.
// Speed and burn by throttle, the climb onto the plane, the sea-state table, turning, and the fuel for a crossing.
import { Sim, KT, D2R, R2D, CRANK_SECONDS, US_GALLON, comfortSpeed, leverBurn, leverFor, leverRpm, leverSpeed, type BoatSpec, type Environment, type SeaSample } from '../packages/sim/src';

const env = (windKt = 0, sea?: SeaSample): Environment => ({ sample: () => ({ windDir: 0, windSpeed: windKt * KT, currentX: 0, currentY: 0 }), sea: sea ? () => sea : undefined });

export function tunePower(boat: BoatSpec): void {
  const p = boat.power!;
  const tank = boat.engine?.tankL ?? 0;
  const run = (e: Environment, lever: number, headingDeg = 0, seconds = 120) => {
    const sim = new Sim(boat, e, { headingDeg, speedKt: 0 });
    sim.startEngine();
    sim.advance(CRANK_SECONDS + 0.1);
    sim.setHelm('heading', headingDeg * D2R);
    sim.setThrottle(lever);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < seconds * 60; i++) { sim.step(); if (i >= seconds * 30) { sum += sim.state.speed; n++; } }
    return { sim, kt: sum / n / KT };
  };

  console.log(`${boat.name}: ${tank} L tank (${(tank / US_GALLON).toFixed(0)} US gal), draught ${boat.dimensions.draft} m\n`);
  console.log('Speed by throttle, flat calm (lever, rpm, kt as tabled / as sailed, L/h, US gal/h, nm per US gal, range nm on a full tank)');
  for (let l = -2; l <= 4 + 1e-9; l += p.leverStep) {
    if (Math.abs(l) < 1e-9) { console.log(`${'0.00'.padStart(6)} ${String(p.idleRpm).padStart(5)}   neutral, idling at ${p.idleLph} L/h`); continue; }
    if (l < 0 && Math.abs(l % 1) > 1e-9) continue;
    const kt = leverSpeed(p, l) / KT;
    const lph = leverBurn(p, l);
    console.log(`${l.toFixed(2).padStart(6)} ${String(Math.round(leverRpm(p, l))).padStart(5)} ${kt.toFixed(1).padStart(6)} /${run(env(), l, 0, 60).kt.toFixed(1).padStart(5)} ${lph.toFixed(1).padStart(6)} ${(lph / US_GALLON).toFixed(1).padStart(5)} ${(Math.abs(kt) / (lph / US_GALLON)).toFixed(2).padStart(5)} ${Math.round((tank / lph) * Math.abs(kt)).toString().padStart(4)}`);
  }

  {
    const sim = new Sim(boat, env(), { speedKt: 0 });
    sim.startEngine();
    sim.advance(CRANK_SECONDS + 0.1);
    sim.setThrottle(4);
    const marks = [10, p.planeKt, 20, 30, 35];
    let line = '';
    let bow = 0;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step();
      bow = Math.max(bow, sim.out.trim * R2D);
      if (marks.length && sim.state.speed / KT >= marks[0]) line += `${marks.shift()} kt in ${(i / 60).toFixed(1)} s   `;
    }
    console.log(`\nFlat out from rest: ${line} bow up ${bow.toFixed(1)}° on the hump, ${(sim.out.trim * R2D).toFixed(1)}° at speed`);
  }

  console.log('\nThe sea: comfortable speed, then flat out for ten minutes: the speed she averages, slams a minute, hull damage');
  console.log('  sea (height / length)     head sea               45° on the bow         beam                   following');
  for (const [h, len] of [[0.25, 5], [0.5, 10], [0.65, 23], [0.75, 15], [1, 20], [1, 30], [1.5, 30], [2, 40]]) {
    const sea: SeaSample = { height: h, length: len, dir: 0, steepness: h / len };
    const cells = [0, 45, 90, 180].map((hd) => {
      const c = comfortSpeed(boat, sea, hd * D2R) / KT;
      const r = run(env(0, sea), 4, hd, 600);
      const s = r.sim.state;
      return `${c.toFixed(0).padStart(2)} kt | ${r.kt.toFixed(0)} kt ${(s.slams / 10).toFixed(0).padStart(2)}/min ${(s.damage * 100).toFixed(0).padStart(2)}%${s.stuffs ? ` ${s.stuffs} stuffed` : ''}`.padEnd(22);
    });
    console.log(`  ${`${h} m / ${len} m`.padEnd(24)}  ${cells.join(' ')}`);
  }

  console.log('\nTurning, wheel hard over for ten seconds (speed in, fastest turn, most bank, speed out)');
  for (const kt of [5, 15, 26, 39]) {
    const r = run(env(), leverFor(p, kt), 0, 40).sim;
    const before = r.state.speed / KT;
    r.setControl('rudder', boat.helm.maxRudderDeg * D2R);
    let heel = 0;
    let yaw = 0;
    for (let i = 0; i < 600; i++) { r.step(); heel = Math.max(heel, r.state.heel); yaw = Math.max(yaw, r.state.yawRate); }
    console.log(`  ${before.toFixed(0).padStart(2)} kt   ${(yaw * R2D).toFixed(0).padStart(2)}°/s   ${(heel * R2D).toFixed(0).padStart(2)}° into the turn   ${(r.state.speed / KT).toFixed(0)} kt`);
  }

  console.log('\nA 22 mile crossing and back (44 nm)');
  const cruise = leverFor(p, p.cruiseKt);
  const calm = (lever: number) => (44 / (leverSpeed(p, lever) / KT)) * leverBurn(p, lever);
  console.log(`  at cruise, ${(leverSpeed(p, cruise) / KT).toFixed(0)} kt, flat calm: ${calm(cruise).toFixed(0)} L (${(calm(cruise) / US_GALLON).toFixed(0)} gal), ${Math.round((calm(cruise) / tank) * 100)}% of the tank`);
  console.log(`  flat out, flat calm: ${calm(4).toFixed(0)} L (${(calm(4) / US_GALLON).toFixed(0)} gal), ${Math.round((calm(4) / tank) * 100)}% of the tank`);
  const sea: SeaSample = { height: 1, length: 20, dir: 0, steepness: 0.05 };
  const out = run(env(15, sea), 4, 0, 600);
  const home = run(env(15, sea), 4, 180, 600);
  const litres = (22 / out.kt + 22 / home.kt) * leverBurn(p, 4);
  console.log(`  flat out into a 1 m chop (${out.kt.toFixed(0)} kt) and home down it (${home.kt.toFixed(0)} kt): ${litres.toFixed(0)} L (${(litres / US_GALLON).toFixed(0)} gal), ${Math.round((litres / tank) * 100)}% of the tank, and about ${Math.round((out.sim.state.damage / 10) * (22 / out.kt) * 60 * 100)}% hull damage on the way out`);
}
