import * as THREE from 'three';
import { WAVES } from './config.js';

/**
 * Gestor de rondas.
 *
 *   countdown ──► active ──(cola vacía y 0 vivos)──► intermission ──► countdown ...
 *
 *  - Cada ronda tiene un "presupuesto" que se gasta en tipos de robot (cada tipo cuesta y se
 *    desbloquea en una ronda concreta). Cada N rondas, Titán.
 *  - Los robots no aparecen de golpe: cola con intervalo y tope de vivos simultáneos (ambos escalan).
 *  - Aparición en puntos válidos FUERA DE LA VISTA del jugador: primero portales sin línea de visión,
 *    luego cualquier celda sin línea de visión, y si no hay, la más lejana a su espalda.
 */
export class WaveManager {
  constructor({ arena, spawn, events }) {
    this.arena = arena;
    this.spawnFn = spawn;          // (typeId, position, mods) => Enemy
    this.ev = events;              // { onCountdown(n, wave), onWaveStart(w, total, boss), onWaveCleared(w, bonus), onTick(n) }
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.wave = 0;
    this.timer = 0;
    this.queue = [];
    this.spawnTimer = 0;
    this.total = 0;
    this.killed = 0;
    this._lastTick = -1;
    this._recent = [];
  }

  start() {
    this.reset();
    this._beginCountdown(WAVES.firstDelay);
  }

  get remaining() { return this.queue.length + this._alive; }

  _beginCountdown(seconds) {
    this.state = 'countdown';
    this.timer = seconds;
    this._lastTick = -1;
    this.ev.onCountdown?.(Math.ceil(seconds), this.wave + 1);
  }

  _buildQueue(w) {
    const q = [];
    let budget = WAVES.budget(w);
    const pool = WAVES.roster.filter((r) => w >= r.from);
    const totalW = pool.reduce((s, r) => s + r.weight, 0);
    while (budget > 0) {
      let roll = Math.random() * totalW, pick = pool[0];
      for (const r of pool) { roll -= r.weight; if (roll <= 0) { pick = r; break; } }
      if (pick.cost > budget) pick = pool[0];
      q.push(pick.type);
      budget -= pick.cost;
    }
    // barajar
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    // Titanes: a mitad de la cola para que lleguen con la ronda ya caliente
    const boss = w % WAVES.titanEvery === 0;
    if (boss) {
      const n = 1 + Math.floor(w / (WAVES.titanEvery * 2));
      for (let i = 0; i < n; i++) q.splice(Math.floor(q.length * (0.35 + i * 0.2)), 0, 'titan');
    }
    return { q, boss };
  }

  _startWave() {
    this.wave++;
    const { q, boss } = this._buildQueue(this.wave);
    this.queue = q;
    this.total = q.length;
    this.killed = 0;
    this.spawnTimer = 0.2;
    this.state = 'active';
    this.ev.onWaveStart?.(this.wave, this.total, boss);
  }

  notifyKill() { this.killed++; }

  update(dt, alive, player, camera) {
    this._alive = alive;
    if (this.state === 'countdown') {
      this.timer -= dt;
      const n = Math.ceil(this.timer);
      if (n !== this._lastTick && n > 0 && n <= 5) { this._lastTick = n; this.ev.onTick?.(n, this.wave + 1); }
      if (this.timer <= 0) this._startWave();
    } else if (this.state === 'active') {
      this.spawnTimer -= dt;
      if (this.queue.length && this.spawnTimer <= 0 && alive < WAVES.maxAlive(this.wave)) {
        const type = this.queue.shift();
        const pos = this._pickSpawn(player, camera, type === 'titan' ? 1.6 : 0.8);
        this.spawnFn(type, pos, {
          hpMult: WAVES.hpMult(this.wave),
          speedMult: WAVES.speedMult(this.wave),
          fireMult: WAVES.fireRateMult(this.wave),
        });
        this.spawnTimer = WAVES.spawnInterval(this.wave) * (0.7 + Math.random() * 0.6);
      }
      if (!this.queue.length && alive === 0) {
        this.state = 'intermission';
        const bonus = 250 * this.wave;
        this.ev.onWaveCleared?.(this.wave, bonus);
        this._beginCountdown(WAVES.intermission);
      }
    }
  }

  _pickSpawn(player, camera, margin) {
    const a = this.arena;
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const candidates = [];
    const consider = (p, portal) => {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < WAVES.minSpawnDist) return;
      const hidden = !a.hasLineOfSight(player, p);
      const behind = (p.x - player.x) * fwd.x + (p.z - player.z) * fwd.z < 0;
      // ideal: oculto, a su espalda, a media distancia (14-28 m) y lejos de los últimos spawns
      let score = (hidden ? 100 : 0) + (behind ? 30 : 0) + (portal ? 20 : 0) - Math.max(0, Math.abs(d - 21) - 7) * 4 + Math.random() * 12;
      for (const q of this._recent) if (Math.hypot(q.x - p.x, q.z - p.z) < 6) score -= 35;
      candidates.push({ p, score, portal });
    };
    for (const s of a.spawns) consider(s, true);
    for (const [r, c] of a.openCells) if (Math.random() < 0.35) consider(a.cellCenter(r, c), false);
    candidates.sort((x, y) => y.score - x.score);
    const best = candidates[0];
    const p = best ? best.p.clone() : a.randomOpenPoint();
    // pequeño desplazamiento dentro de la celda, respetando colisiones
    for (let i = 0; i < 6; i++) {
      const jx = p.x + (Math.random() - 0.5) * (4 - margin * 2);
      const jz = p.z + (Math.random() - 0.5) * (4 - margin * 2);
      if (!a.collides(jx, jz, margin)) { p.x = jx; p.z = jz; break; }
    }
    p.portal = !!(best && best.portal);
    this._recent.push(p.clone());
    if (this._recent.length > 4) this._recent.shift();
    return p;
  }
}
