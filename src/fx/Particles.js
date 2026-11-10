import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Sistema de partículas propio, sin librerías:
 *  - 2 InstancedMesh (1 draw call cada uno, da igual cuántas partículas haya):
 *      · debris: cubitos opacos con iluminación PBR, gravedad, rebote en el suelo, giro y encogimiento.
 *      · sparks: chispas emisivas (color HDR > 1 => el bloom las hace brillar), estiradas según la velocidad.
 *  - Pool circular: nunca se crean objetos durante la partida (cero basura para el GC).
 */
class Pool {
  constructor(scene, max, geometry, material, { gravity = 18, bounce = 0.35, drag = 0.6, stretch = false } = {}) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = !stretch;
    scene.add(this.mesh);
    this.gravity = gravity;
    this.bounce = bounce;
    this.drag = drag;
    this.stretch = stretch;

    this.alive = 0;
    this.p = []; // datos por partícula
    for (let i = 0; i < max; i++) {
      this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, life: 0, max: 1, color: new THREE.Color() });
    }
    this.cursor = 0;
  }

  spawn(pos, vel, size, life, color) {
    // si está lleno, recicla la más antigua (cursor circular)
    let idx;
    if (this.alive < this.max) idx = this.alive++;
    else { idx = this.cursor; this.cursor = (this.cursor + 1) % this.max; }
    const p = this.p[idx];
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    p.size = size;
    p.life = p.max = life;
    p.color.copy(color);
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      const p = this.p[i];
      p.life -= dt;
      if (p.life <= 0) {
        // swap-remove con la última viva
        const last = this.p[this.alive - 1];
        this.p[this.alive - 1] = p;
        this.p[i] = last;
        this.alive--;
        continue;
      }
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - this.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size * 0.5) {           // rebote en el suelo
        p.pos.y = p.size * 0.5;
        p.vel.y = -p.vel.y * this.bounce;
        p.vel.x *= 0.7; p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.addScaledVector(p.spin, dt);

      const t = p.life / p.max;                // 1 -> 0
      const k = this.stretch ? 1 : Math.min(1, t * 3); // los cubos encogen en el último tercio
      if (this.stretch) {
        const sp = p.vel.length();
        _q.setFromUnitVectors(UP, _s.copy(p.vel).divideScalar(sp || 1));
        _s.set(p.size, p.size * (1 + sp * 0.06), p.size).multiplyScalar(t);
      } else {
        _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
        _s.setScalar(p.size * k);
      }
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _c.copy(p.color);
      if (this.stretch) _c.multiplyScalar(0.4 + t * 1.6);
      this.mesh.setColorAt(i, _c);
      i++;
    }
    this.mesh.count = this.alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.alive = 0; this.mesh.count = 0; }
}
const UP = new THREE.Vector3(0, 1, 0);

export class Particles {
  constructor(scene) {
    this.debris = new Pool(
      scene, 900,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.5 }),
      { gravity: 19, bounce: 0.38, drag: 0.35 }
    );
    this.sparks = new Pool(
      scene, 900,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      { gravity: 9, bounce: 0.25, drag: 1.4, stretch: true }
    );
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._col = new THREE.Color();
  }

  /** Explosión de un robot: decenas de cubos con su paleta + chispas HDR + núcleo. */
  explode(center, palette, scale = 1) {
    const n = Math.round(46 * scale);
    for (let i = 0; i < n; i++) {
      this._p.set(center.x + (Math.random() - 0.5) * 0.8 * scale, center.y + (Math.random() - 0.3) * 1.2 * scale, center.z + (Math.random() - 0.5) * 0.8 * scale);
      const a = Math.random() * Math.PI * 2;
      const up = 3 + Math.random() * 7;
      const out = 2 + Math.random() * 6 * Math.sqrt(scale);
      this._v.set(Math.cos(a) * out, up, Math.sin(a) * out);
      this._col.setHex(palette[i % palette.length]);
      this.debris.spawn(this._p, this._v, (0.07 + Math.random() * 0.16) * Math.sqrt(scale), 2.2 + Math.random() * 1.8, this._col);
    }
    this.burst(center, 0xffa040, Math.round(60 * scale), 14 * Math.sqrt(scale), 6);
    this.burst(center, 0xffffff, Math.round(16 * scale), 9, 8);
  }

  /** Chispas en una dirección (impacto en pared, disparo enemigo...). */
  burst(pos, hex, count, speed = 10, hdr = 5, normal = null) {
    this._col.setHex(hex).multiplyScalar(hdr);
    for (let i = 0; i < count; i++) {
      this._v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      if (normal) this._v.addScaledVector(normal, 1.2).normalize();
      this._v.multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      this.sparks.spawn(pos, this._v, 0.025 + Math.random() * 0.03, 0.25 + Math.random() * 0.45, this._col);
    }
  }

  /** Impacto de bala en un muro: chispas + polvo de piedra. */
  impact(pos, normal, tint = 0xffc070) {
    this.burst(pos, tint, 9, 7, 4, normal);
    this._col.setHex(0xc9a070);
    for (let i = 0; i < 4; i++) {
      this._v.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).addScaledVector(normal, 1.5).multiplyScalar(2.5);
      this.debris.spawn(pos, this._v, 0.03 + Math.random() * 0.04, 0.7 + Math.random() * 0.5, this._col);
    }
  }

  update(dt) {
    this.debris.update(dt);
    this.sparks.update(dt);
  }

  clear() { this.debris.clear(); this.sparks.clear(); }
}
