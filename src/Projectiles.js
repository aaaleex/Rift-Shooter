import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Proyectiles de plasma enemigos (esquivables). Pool fijo de mallas: núcleo HDR + estela estirada.
 * El bloom hace el resto. Colisionan con muros (chispas) y con el jugador (daño + indicador de dirección).
 */
export class Projectiles {
  constructor(scene, arena, particles) {
    this.arena = arena;
    this.particles = particles;
    this.max = 120;
    this.list = [];
    const coreGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const trailGeo = new THREE.CylinderGeometry(0.07, 0.0, 1, 6, 1, true);
    trailGeo.translate(0, -0.5, 0);
    trailGeo.rotateX(Math.PI / 2);   // estela a lo largo de +Z local, detrás del núcleo
    for (let i = 0; i < this.max; i++) {
      const color = new THREE.Color(0xff3030);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(6), toneMapped: false }));
      const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.5), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
      trail.scale.set(1, 1, 1.4);
      core.add(trail);
      core.visible = false;
      scene.add(core);
      this.list.push({ mesh: core, trail, vel: new THREE.Vector3(), damage: 0, life: 0, active: false, owner: null, color });
    }
  }

  fire(origin, dir, speed, damage, hex = 0xff3030, owner = null) {
    const p = this.list.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.position.copy(origin);
    p.vel.copy(dir).normalize().multiplyScalar(speed);
    p.mesh.lookAt(_v.copy(origin).add(p.vel)); // +Z hacia delante => la estela (-Z) queda detrás
    p.damage = damage;
    p.life = 4;
    p.owner = owner;
    p.color.setHex(hex);
    p.mesh.material.color.copy(p.color).multiplyScalar(6);
    p.trail.material.color.copy(p.color).multiplyScalar(2.5);
  }

  /** onHitPlayer(damage, fromPosition) */
  update(dt, playerPos, playerRadius, onHitPlayer) {
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      const pos = p.mesh.position;
      // sub-pasos para que no atraviese al jugador a alta velocidad
      const steps = 3;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        pos.addScaledVector(p.vel, dt / steps);
        // jugador = cápsula vertical aproximada (de los pies a los ojos)
        const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z;
        const yIn = pos.y > playerPos.y - 1.8 && pos.y < playerPos.y + 0.25;
        if (yIn && dx * dx + dz * dz < (playerRadius + 0.15) ** 2) {
          onHitPlayer(p.damage, _v.copy(pos).sub(p.vel));
          this.particles.burst(pos, p.color.getHex(), 10, 6, 5);
          dead = true;
        } else if (pos.y < 0.05 || this.arena.isSolidCell(Math.floor(pos.z / 4), Math.floor(pos.x / 4))) {
          this.particles.burst(pos, p.color.getHex(), 14, 6, 5);
          dead = true;
        }
      }
      if (dead || p.life <= 0) { p.active = false; p.mesh.visible = false; }
    }
  }

  clear() { for (const p of this.list) { p.active = false; p.mesh.visible = false; } }
}
