import * as THREE from 'three';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _box = new THREE.Box3();
const HIT_MAT = new THREE.MeshBasicMaterial();
const BODY_GEO = new THREE.CylinderGeometry(1, 1, 1, 10);
const HEAD_GEO = new THREE.SphereGeometry(1, 10, 8);
const WHITE = new THREE.Color(0xffffff);

/**
 * Robot enemigo a partir de un GLB estático (sin esqueleto): toda la animación es procedural.
 *
 *  - Material propio por instancia (comparte el atlas) para poder parpadear en blanco al recibir daño.
 *  - Hitboxes invisibles (cilindro de cuerpo + esfera en el ojo = punto crítico) para un raycast barato y justo.
 *  - Comportamientos: 'ranged' (dispara plasma con aviso previo: el ojo se carga) y 'melee' (embiste).
 *  - Navegación: directo si ve al jugador; si no, sigue el flow field de la arena. Separación entre robots.
 */
export class Enemy extends THREE.Group {
  constructor(typeId, def, template, atlas, mods, ctx) {
    super();
    this.isEnemy = true;
    this.typeId = typeId;
    this.def = def;
    this.ctx = ctx; // { arena, projectiles, sfx, onStomp }
    this.maxHp = Math.round(def.hp * mods.hpMult);
    this.hp = this.maxHp;
    this.speed = def.speed * mods.speedMult;
    this.fireInterval = (def.fireInterval || 1) * mods.fireMult;
    this.radius = def.radius;
    this.dead = false;

    this.fireTimer = Math.random() * this.fireInterval * 0.6;
    this.meleeTimer = 0;
    this.flash = 0;
    this.spawnT = 0;
    this.walkT = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.knock = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.recoil = 0;
    this.lunge = 0;
    this.yaw = 0;
    this.moving = false;
    this.wanderTarget = null;
    this.stepAcc = 0;

    // ---------------- modelo + materiales por instancia
    this.model = template.clone(true);
    this.pivot = new THREE.Group();     // el pivot recibe bob/inclinaciones; el grupo raíz, la posición
    this.pivot.add(this.model);
    this.add(this.pivot);
    this.baseY = def.fly || 0;
    this.pivot.position.y = this.baseY;   // importante: antes de medir el ojo para la hitbox

    this.mats = [];
    this.eyeMats = [];
    let eye = null;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const isEye = o.name.includes('Eye');
      const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.9 });
      if (isEye) {
        m.emissive.set(0xff2a2a);
        m.emissiveIntensity = 2.6;
        this.eyeMats.push(m);
        eye = o;
      }
      o.material = m;
      o.castShadow = true;
      this.mats.push({ m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
    });

    // ---------------- hitboxes
    const h = def.hitHeight;
    this.bodyBox = new THREE.Mesh(BODY_GEO, HIT_MAT);
    this.bodyBox.scale.set(this.radius * 0.85, h * 0.92, this.radius * 0.85);
    this.bodyBox.position.y = this.baseY + h * 0.46;
    this.bodyBox.visible = false;
    this.bodyBox.userData = { enemy: this, part: 'body' };
    this.add(this.bodyBox);

    this.headBox = new THREE.Mesh(HEAD_GEO, HIT_MAT);
    if (eye) {
      this.updateMatrixWorld(true);
      _box.setFromObject(eye);
      _box.getCenter(_v);
      const size = _box.getSize(_w);
      this.headBox.position.copy(_v);
      this.headBox.scale.setScalar(Math.max(0.16, Math.max(size.x, size.y, size.z) * 0.6));
      this.eyeLocal = _v.clone();
    } else {
      this.headBox.position.set(0, h * 0.85, 0.2);
      this.headBox.scale.setScalar(0.2);
      this.eyeLocal = this.headBox.position.clone();
    }
    this.headBox.visible = false;
    this.headBox.userData = { enemy: this, part: 'head' };
    this.add(this.headBox);
    this.hitboxes = [this.headBox, this.bodyBox];

    this.scale.setScalar(0.001); // aparece escalando desde 0
  }

  get center() { return _w.set(this.position.x, this.position.y + this.baseY + this.def.hitHeight * 0.5, this.position.z); }

  /** Devuelve true si este golpe lo mata. */
  takeDamage(amount, fromDir) {
    if (this.dead) return false;
    this.hp -= amount;
    this.flash = 0.1;
    if (fromDir && !this.def.boss) this.knock.addScaledVector(fromDir, Math.min(3.5, amount * 0.08));
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  // ------------------------------------------------------------------------------- IA
  update(dt, time, player, others, passive = false) {
    if (this.dead) return;
    const { arena } = this.ctx;
    const def = this.def;

    // aparición elástica
    if (this.spawnT < 1) {
      this.spawnT = Math.min(1, this.spawnT + dt * 1.8);
      const t = this.spawnT;
      const s = 1 + Math.sin(t * Math.PI) * 0.18 * (1 - t);
      this.scale.setScalar(Math.max(0.001, t < 1 ? t * s : 1));
    }

    const tx = passive ? this._wander(arena) : player.x;
    const tz = passive ? this.wanderTarget.z : player.z;
    const targetX = passive ? this.wanderTarget.x : tx;
    const dx = targetX - this.position.x, dz = tz - this.position.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const los = !passive && arena.hasLineOfSight(this.position, player);

    // ---------------- deseo de movimiento
    const desire = _v.set(0, 0, 0);
    if (passive) {
      desire.set(dx / dist, 0, dz / dist);
      if (dist < 1.5) this.wanderTarget = null;
    } else if (def.behavior === 'melee') {
      this._seek(desire, los, dx, dz, dist, arena);
    } else {
      const ideal = def.range * 0.6;
      if (los && dist < ideal) {
        if (dist < 4.5) desire.set(-dx / dist, 0, -dz / dist);        // retrocede si está demasiado cerca
        if (def.strafe || this.typeId === 'trooper') {                 // se mueve lateralmente
          this.strafeTimer -= dt;
          if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1.2 + Math.random() * 2; }
          const k = def.strafe ? 1 : 0.45;
          desire.x += (-dz / dist) * this.strafeDir * k;
          desire.z += (dx / dist) * this.strafeDir * k;
        }
      } else {
        this._seek(desire, los, dx, dz, dist, arena);
      }
    }

    // separación entre robots
    for (const o of others) {
      if (o === this || o.dead) continue;
      const ox = this.position.x - o.position.x, oz = this.position.z - o.position.z;
      const d2 = ox * ox + oz * oz;
      const min = this.radius + o.radius + 0.3;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        desire.x += (ox / d) * (min - d) * 1.5;
        desire.z += (oz / d) * (min - d) * 1.5;
      }
    }

    // ---------------- integrar movimiento (con aceleración => giros suaves)
    const len = Math.hypot(desire.x, desire.z);
    const spd = this.speed * (passive ? 0.45 : 1) * (this.spawnT < 1 ? 0.2 : 1);
    if (len > 0.01) { desire.x /= Math.max(1, len); desire.z /= Math.max(1, len); }
    const accel = 1 - Math.exp(-dt * 6);
    this.velocity.x += (desire.x * spd - this.velocity.x) * accel;
    this.velocity.z += (desire.z * spd - this.velocity.z) * accel;
    // empuje por impactos (se disipa rápido) + embestida del Hound
    const kx = this.knock.x, kz = this.knock.z;
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 8));

    const mvx = (this.velocity.x + kx) * dt, mvz = (this.velocity.z + kz) * dt;
    const r = this.radius;
    if (!arena.collides(this.position.x + mvx, this.position.z, r)) this.position.x += mvx; else this.velocity.x *= -0.2;
    if (!arena.collides(this.position.x, this.position.z + mvz, r)) this.position.z += mvz; else this.velocity.z *= -0.2;
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = speedNow > 0.4;

    // ---------------- orientación: mira al jugador si lo ve, si no hacia donde camina
    let wantYaw = this.yaw;
    if (los || (!passive && dist < 6)) wantYaw = Math.atan2(dx, dz);
    else if (this.moving) wantYaw = Math.atan2(this.velocity.x, this.velocity.z);
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (def.boss ? 2.5 : 7));
    this.rotation.y = this.yaw;

    // ---------------- ataques
    let charge = 0;
    if (!passive && this.spawnT >= 1) {
      if (def.behavior === 'ranged') {
        if (los && dist < def.range) {
          this.fireTimer += dt;
          const tele = Math.min(0.5, this.fireInterval * 0.4);      // aviso: el ojo se carga antes de disparar
          charge = Math.max(0, (this.fireTimer - (this.fireInterval - tele)) / tele);
          if (this.fireTimer >= this.fireInterval) { this.fireTimer = 0; this._shoot(player); }
        } else {
          this.fireTimer = Math.max(0, this.fireTimer - dt);
        }
      } else if (def.behavior === 'melee') {
        this.meleeTimer -= dt;
        if (dist < def.meleeRange + 0.6 && this.meleeTimer <= 0) {
          this.meleeTimer = def.meleeInterval;
          this.lunge = 1;
          this.knock.x += (dx / dist) * 5;
          this.knock.z += (dz / dist) * 5;
          if (dist < def.meleeRange + 0.4 && Math.abs(player.y - 1.7) < 1.4) this.ctx.onMelee?.(def.meleeDamage, this);
        }
      }
    }

    this._animate(dt, time, speedNow, charge);
  }

  _seek(desire, los, dx, dz, dist, arena) {
    if (los) { desire.set(dx / dist, 0, dz / dist); return; }
    const wp = arena.nextWaypoint(this.position.x, this.position.z, _w);
    if (wp) {
      const wx = wp.x - this.position.x, wz = wp.z - this.position.z;
      const wl = Math.hypot(wx, wz) || 1;
      desire.set(wx / wl, 0, wz / wl);
    } else desire.set(dx / dist, 0, dz / dist);
  }

  _wander(arena) {
    if (!this.wanderTarget) this.wanderTarget = arena.randomOpenPoint();
    return this.wanderTarget.x;
  }

  _shoot(player) {
    const def = this.def;
    const { projectiles, sfx } = this.ctx;
    this.updateMatrixWorld(true);
    const origin = this.localToWorld(_w.copy(this.eyeLocal));
    origin.y = Math.max(origin.y, 0.6);
    const aim = _v.set(player.x, player.y - 0.45, player.z).sub(origin).normalize();
    const n = def.burst || 1;
    for (let i = 0; i < n; i++) {
      const dir = aim.clone();
      const fan = n > 1 ? (i - (n - 1) / 2) * (def.burstSpread || 0.1) : 0;
      dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, fan + (Math.random() - 0.5) * 0.06);
      dir.y += (Math.random() - 0.5) * 0.03;
      projectiles.fire(origin, dir, def.projSpeed, def.damage, def.boss ? 0xff7a1a : 0xff3030, this);
    }
    this.recoil = 1;
    sfx?.enemyShot();
  }

  // ------------------------------------------------------------------------------- animación procedural
  _animate(dt, time, speed, charge) {
    const def = this.def;
    const p = this.pivot;
    const sNorm = Math.min(1, speed / Math.max(0.1, this.speed));
    this.walkT += dt * (2 + speed * (def.boss ? 1.2 : 2.2));
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.lunge = Math.max(0, this.lunge - dt * 3);

    if (def.fly) {
      p.position.y = this.baseY + Math.sin(time * 3 + this.phase) * 0.18;
      p.rotation.z = THREE.MathUtils.lerp(p.rotation.z, -this.strafeDir * 0.25 * sNorm, 1 - Math.exp(-dt * 4));
      p.rotation.x = 0.15 * sNorm - this.recoil * 0.25;
    } else if (this.typeId === 'hound') {
      p.position.y = Math.abs(Math.sin(this.walkT * 1.4)) * 0.12 * sNorm;
      p.rotation.x = Math.sin(this.walkT * 2.8) * 0.12 * sNorm + this.lunge * 0.35;
      p.rotation.z = 0;
    } else {
      const step = Math.sin(this.walkT);
      p.position.y = Math.abs(step) * (def.boss ? 0.09 : 0.07) * sNorm;
      p.rotation.z = step * (def.boss ? 0.035 : 0.06) * sNorm;
      p.rotation.x = 0.07 * sNorm - this.recoil * 0.12;
      // pisotones del Titán: temblor de cámara según la distancia
      if (def.boss && sNorm > 0.2) {
        const s = Math.sign(step);
        if (s !== this._lastStep) { this._lastStep = s; this.ctx.onStomp?.(this); }
      }
    }
    p.position.z = -this.recoil * 0.15;

    // aparición: emisivo blanco al materializarse; daño: parpadeo blanco
    const flashing = this.flash > 0 || this.spawnT < 1;
    this.flash = Math.max(0, this.flash - dt);
    const spawnGlow = 1 - this.spawnT;
    for (const e of this.mats) {
      if (flashing) {
        e.m.emissive.copy(WHITE);
        e.m.emissiveIntensity = this.flash > 0 ? 1.4 : spawnGlow * 3;
      } else {
        e.m.emissive.copy(e.emissive);
        e.m.emissiveIntensity = e.intensity;
      }
    }
    if (!flashing) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + this.phase);
      for (const m of this.eyeMats) {
        // el ojo pasa de rojo a amarillo/blanco mientras carga el disparo (telegrafía el ataque)
        m.emissive.setRGB(1, 0.16 + charge * 0.8, 0.12 + charge * 0.4);
        m.emissiveIntensity = 2.4 + pulse * 0.6 + charge * 5;
      }
    }
  }

  dispose() {
    for (const e of this.mats) e.m.dispose();
  }
}
