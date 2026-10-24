// Simule des matchs IA contre IA en accéléré et vérifie qu'ils se déroulent sans erreur.
import { Match, PITCH } from '../public/shared/sim.js';

let totalGoals = 0;
const stats = { kick: 0, goal: 0, save: 0, tackle: 0, post: 0, whistle: 0 };
for (let m = 0; m < 4; m++) {
  const match = new Match({ halfLength: 300 });
  let steps = 0;
  const outs = {};
  while (match.phase !== 'fulltime' && steps < 200000) {
    match.step(1 / 60, []);
    steps++;
    if (match.phase === 'out' && match.phaseT < 1 / 59) outs[match.pending.type] = (outs[match.pending.type] || 0) + 1;
    for (const e of match.events) stats[e.t] = (stats[e.t] || 0) + 1;
    match.events = [];
    const b = match.ball;
    for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz]) if (!Number.isFinite(v)) throw new Error('NaN dans le ballon');
    for (const p of match.players) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error('NaN joueur');
  }
  if (match.phase !== 'fulltime') throw new Error('Le match ne s\'est pas terminé');
  totalGoals += match.score[0] + match.score[1];
  console.log(`Match ${m + 1}: ${match.score.join(' - ')}  remises:`, JSON.stringify(outs));
}
console.log('Évènements:', JSON.stringify(stats));
if (totalGoals === 0) throw new Error('Aucun but marqué en 4 matchs');

// Un humain qui ne touche rien ne doit pas casser la simulation.
const hm = new Match({ halfLength: 60 });
hm.addHuman(0, 0);
for (let i = 0; i < 60 * 130; i++) hm.step(1 / 60, [{ mx: 1, mz: 0, held: 32, pressed: i % 90 === 0 ? 1 : 0, released: 0 }]);
console.log('Match avec humain:', hm.phase, hm.score.join('-'));
console.log('OK');
