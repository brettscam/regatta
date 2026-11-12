import { Sim, KT, D2R, R2D } from '../packages/sim/src';
import { boat, northWind, settle } from '../packages/sim/test/helpers';
import { runScript, SCRIPT } from '../packages/sim/test/script';

const f = (n: number, d = 1) => n.toFixed(d).padStart(6);
function row(sim: Sim) {
  const s = sim.state, o = sim.out;
  return `t${f(s.t)} hdg${f(s.heading * R2D, 0)} twa${f(o.twa * R2D, 0)} kt${f(s.speed / KT)} tgt${f(o.targetSpeed / KT)} rud${f(s.rudder * R2D, 0)} yaw${f(s.yawRate * R2D)} heel${f(s.heel * R2D, 0)} boom${f(s.boomAngle * R2D, 0)} jib${f(s.jibAngle * R2D, 0)} mE${f(o.main.eff, 2)} jE${f(o.jib.eff, 2)} bk${f(o.jib.backed, 2)} ${s.maneuver ? 'MAN' : s.helmMode}`;
}
console.log('--- crew tack from 45 in 12 kt');
{
  const sim = settle(12, 45, { seconds: 120 }).sim; sim.state.crewTrim = false; sim.tack();
  for (let i = 0; i < 30; i++) { console.log(row(sim)); sim.advance(1); }
}
console.log('--- irons');
{
  const sim = new Sim(boat, northWind(12), { headingDeg: 2, speedKt: 3 });
  sim.setControl('mainsheet', 10 * D2R); sim.setControl('jibsheet_port', 3 * D2R);
  for (let i = 0; i < 40; i++) { console.log(row(sim)); sim.advance(3); }
}
console.log('--- golden');
for (const p of runScript(SCRIPT).track) console.log(`t${f(p.t, 0)} x${f(p.x, 0)} y${f(p.y, 0)} hdg${f(p.hdg * R2D, 0)} kt${f(p.kt)} heel${f(p.heel * R2D, 0)}`);
