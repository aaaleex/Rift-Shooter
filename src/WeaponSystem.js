import * as THREE from 'three';
import { WEAPONS } from './config.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const CENTER = new THREE.Vector2();
const UP = new THREE.Vector3(0, 1, 0);

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,220,150,0.9)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.25)');
  grd.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // destellos en estrella
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,230,180,0.8)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Armas en primera persona.
 *  - El modelo vive en una escena aparte (viewScene) que se pinta encima del mundo con el depth limpio.
 *  - Retroceso en dos capas: el modelo (spring de posición/rotación) y la cámara (pitch/yaw con recuperación parcial).
 *  - Dispersión dinámica (disparo continuo + movimiento - apuntado) que también alimenta la mirilla del HUD.
 *  - Apuntado (clic derecho): el arma se centra, baja el FOV y la sensibilidad.
 */
export class WeaponSystem {
  constructor({ camera, viewScene, worldScene, models, arena, particles, sfx, shake, controls }) {
    this.camera = camera;
    this.viewScene = viewScene;
    this.worldScene = worldScene;
    this.arena = arena;
    this.particles = particles;
    this.sfx = sfx;
    this.shake = shake;
    this.controls = controls;

    this.root = new THREE.Group();           // sigue a la cámara cada frame
    this.viewScene.add(this.root);
    this.holder = new THREE.Group();         // recibe sway, bob, retroceso, recarga
    this.root.add(this.holder);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 200;

    // fogonazo: sprite aditivo en el arma + luz en el mundo (preasignada: no cambia el nº de luces)
    this.flashTex = makeFlashTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(3, 2.4, 1.6) }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    worldScene.add(this.flashLight);
    this.viewFlashLight = new THREE.PointLight(0xffb060, 0, 2, 2);
    this.holder.add(this.viewFlashLight);

    // trazadores (pool)
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false;
      worldScene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }

    // armas
    this.weapons = WEAPONS.map((cfg) => this._buildWeapon(cfg, models[cfg.model]));
    this.index = 0;
    this.weapons.forEach((w, i) => { w.group.visible = i === 0; });

    // estado
    this.trigger = false;
    this.aimHeld = false;
    this.aim = 0;              // 0 cadera .. 1 apuntando
    this.cooldown = 0;
    this.reloading = 0;        // tiempo restante
    this.switching = 0;        // 0..1 animación de cambio
    this.pendingIndex = -1;
    this.bloomSpread = 0;
    this.kick = 0;             // retroceso del modelo
    this.kickRot = 0;
    this.recoverPitch = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.bobT = 0;
    this.flashT = 0;
    this.stats = { fired: 0, hit: 0, crits: 0 };
    this.onShot = null;        // (result) => {}
  }

  _buildWeapon(cfg, template) {
    const group = new THREE.Group();
    const model = template.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (cfg.material) {
        o.material = new THREE.MeshStandardMaterial({ ...cfg.material, envMapIntensity: 1.2 });
      } else {
        o.material = o.material.clone();
        o.material.envMapIntensity = 1.3;
        // la mira roja del M16 brilla con el bloom
        if (o.material.name === 'luz roja' || (o.material.emissive && o.material.emissive.r > 0.5)) {
          o.material.emissive.set(0xff1010);
          o.material.emissiveIntensity = 6;
        }
      }
      o.frustumCulled = false;
    });
    model.scale.setScalar(cfg.scale);
    model.rotation.y = cfg.rotY;
    group.add(model);
    const muzzle = new THREE.Object3D();
    muzzle.position.fromArray(cfg.muzzle);
    group.add(muzzle);
    this.holder.add(group);
    return { cfg, group, model, muzzle, mag: cfg.magSize, reserve: cfg.reserve };
  }

  get current() { return this.weapons[this.index]; }

  reset() {
    for (const w of this.weapons) { w.mag = w.cfg.magSize; w.reserve = w.cfg.reserve; }
    this.index = 0;
    this.weapons.forEach((w, i) => { w.group.visible = i === 0; });
    this.reloading = 0;
    this.switching = 0;
    this.pendingIndex = -1;
    this.trigger = false;
    this.aimHeld = false;
    this.aim = 0;
    this.bloomSpread = 0;
    this.recoverPitch = 0;
    this.stats = { fired: 0, hit: 0, crits: 0 };
    for (const t of this.tracers) t.mesh.visible = false;
  }

  addAmmo(mags) {
    for (const w of this.weapons) w.reserve += w.cfg.magSize * mags;
  }

  // ------------------------------------------------------------------ entrada
  onMouseMove(dx, dy) {
    this.swayTarget.x = THREE.MathUtils.clamp(this.swayTarget.x - dx * 0.0009, -0.06, 0.06);
    this.swayTarget.y = THREE.MathUtils.clamp(this.swayTarget.y + dy * 0.0009, -0.05, 0.05);
  }

  requestReload() {
    const w = this.current;
    if (this.reloading > 0 || this.switching > 0 || w.mag >= w.cfg.magSize || w.reserve <= 0) return false;
    this.reloading = w.cfg.reloadTime;
    this.sfx.reload();
    return true;
  }

  switchTo(i) {
    if (i === this.index || i < 0 || i >= this.weapons.length || this.switching > 0) return;
    this.reloading = 0;
    this.pendingIndex = i;
    this.switching = 1;
    this.sfx.ui();
  }

  cycle(dir) { this.switchTo((this.index + dir + this.weapons.length) % this.weapons.length); }

  /** Dispersión actual en radianes (la usa también la mirilla dinámica). */
  spreadNow(player) {
    const c = this.current.cfg;
    const base = THREE.MathUtils.lerp(c.spread, c.adsSpread, this.aim);
    const move = c.moveSpread * Math.min(1, player.moveAmount) * (1 - this.aim * 0.7) + (player.onGround ? 0 : 0.05);
    return base + move + this.bloomSpread;
  }

  // ------------------------------------------------------------------ por frame
  update(dt, player, enemies) {
    const w = this.current;
    const c = w.cfg;
    this.cooldown -= dt;
    this.bloomSpread = Math.max(0, this.bloomSpread - dt * 0.12);

    // cambio de arma: baja (switching 1 -> 0.5), cambia, sube (0.5 -> 0)
    if (this.switching > 0) {
      const prev = this.switching;
      this.switching = Math.max(0, this.switching - dt / 0.45);
      if (prev > 0.5 && this.switching <= 0.5 && this.pendingIndex >= 0) {
        this.current.group.visible = false;
        this.index = this.pendingIndex;
        this.pendingIndex = -1;
        this.current.group.visible = true;
      }
    }

    // recarga
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = c.magSize - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        this.reloading = 0;
      }
    }

    // apuntado
    const wantAim = this.aimHeld && this.reloading <= 0 && this.switching <= 0 && !player.sprinting ? 1 : 0;
    this.aim += (wantAim - this.aim) * (1 - Math.exp(-dt * 14));
    player.aiming = this.aim > 0.5;

    // disparo
    let result = null;
    const canFire = this.reloading <= 0 && this.switching <= 0 && !player.sprinting;
    if (this.trigger && canFire && this.cooldown <= 0) {
      if (w.mag > 0) {
        this.cooldown = c.fireInterval;
        if (!c.auto) this.trigger = false;
        result = this._fire(player, enemies);
      } else {
        this.cooldown = 0.25;
        this.sfx.dryFire();
        if (w.reserve > 0) this.requestReload();
      }
    }

    // recuperación del retroceso de cámara (vuelve un 65 % de lo que subió)
    if (this.recoverPitch > 0) {
      const r = Math.min(this.recoverPitch, dt * 0.55);
      this.recoverPitch -= r;
      this._addPitch(-r, 0);
    }

    this._animate(dt, player);
    this._updateTracers(dt);
    return result;
  }

  _addPitch(pitch, yaw) {
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    _e.x = THREE.MathUtils.clamp(_e.x + pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    _e.y += yaw;
    this.camera.quaternion.setFromEuler(_e);
  }

  _fire(player, enemies) {
    const w = this.current;
    const c = w.cfg;
    w.mag--;
    this.stats.fired++;

    // rayo con dispersión
    const spread = this.spreadNow(player);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(CENTER, this.camera);
    const dir = this.raycaster.ray.direction;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _v.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(this.camera.quaternion);
    dir.add(_v).normalize();

    const targets = [this.arena.wallMesh];
    for (const e of enemies) if (!e.dead) targets.push(e.bodyBox, e.headBox);
    const hits = this.raycaster.intersectObjects(targets, false);

    let res = { enemy: null, crit: false, killed: false, damage: 0, point: null, normal: null };
    const first = hits[0];
    if (first) {
      res.point = first.point.clone();
      const ud = first.object.userData;
      if (ud && ud.enemy) {
        const enemy = ud.enemy;
        // crítico: si el rayo también atraviesa el ojo de ESE enemigo cerca del primer impacto
        let crit = ud.part === 'head';
        if (!crit) crit = hits.some((h) => h.object === enemy.headBox && h.distance < first.distance + enemy.radius * 2.2);
        const dmg = Math.round(c.damage * (crit ? c.critMult : 1) * (0.9 + Math.random() * 0.2));
        res.enemy = enemy;
        res.crit = crit;
        res.damage = dmg;
        res.killed = enemy.takeDamage(dmg, _v2.copy(dir).setY(0).normalize());
        this.stats.hit++;
        if (crit) this.stats.crits++;
      } else {
        res.normal = first.face ? first.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        this.particles.impact(res.point, res.normal);
        if (Math.random() < 0.35) this.sfx.ricochet();   // el clásico "piiiu" del western
      }
    }

    // efectos
    this.bloomSpread = Math.min(0.06, this.bloomSpread + c.spread * 0.55);
    this.kick = Math.min(1.6, this.kick + 1);
    this.kickRot = Math.min(1.6, this.kickRot + 1);
    const pitch = c.recoil.pitch * (1 - this.aim * 0.4) * (0.8 + Math.random() * 0.4);
    const yaw = (Math.random() - 0.5) * 2 * c.recoil.yaw;
    this._addPitch(pitch, yaw);
    this.recoverPitch += pitch * 0.65;
    this.shake.add(c.recoil.shake * (1 - this.aim * 0.5));
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.sfx.shot(c.id);

    // trazador desde la boca del arma
    w.group.updateMatrixWorld(true);
    const muzzleWorld = w.muzzle.getWorldPosition(new THREE.Vector3());
    const end = res.point || this.raycaster.ray.at(120, new THREE.Vector3());
    this._spawnTracer(muzzleWorld, end, c.tracer);
    this.flashLight.position.copy(muzzleWorld);

    if (w.mag === 0 && w.reserve > 0) setTimeout(() => this.requestReload(), 120);
    return res;
  }

  _spawnTracer(from, to, hex) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const d = _v.copy(to).sub(from);
    const len = d.length();
    if (len < 0.5) return;
    d.divideScalar(len);
    const m = t.mesh;
    m.visible = true;
    m.position.copy(from).addScaledVector(d, len / 2);
    m.quaternion.setFromUnitVectors(UP, d);
    m.scale.set(1, len, 1);
    m.material.color.setHex(hex).multiplyScalar(4);
    m.material.opacity = 1;
    t.life = 0.06;
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.06);
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------------ animación del viewmodel
  _animate(dt, player) {
    const c = this.current.cfg;
    const k = 1 - Math.exp(-dt * 10);

    // muelles del retroceso
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);

    // sway (inercia del ratón) y bob al andar
    this.swayTarget.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.sway.lerp(this.swayTarget, k);
    const move = Math.min(1, player.moveAmount);
    this.bobT += dt * (player.sprinting ? 12 : 8.5) * move;
    const bobAmt = (1 - this.aim * 0.85) * move;
    const bx = Math.sin(this.bobT) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt;

    // posición base: cadera <-> apuntado
    const hip = c.pos, ads = c.adsPos;
    const px = THREE.MathUtils.lerp(hip[0], ads[0], this.aim);
    const py = THREE.MathUtils.lerp(hip[1], ads[1], this.aim);
    const pz = THREE.MathUtils.lerp(hip[2], ads[2], this.aim);

    // sprint: arma inclinada hacia abajo/lado
    this._sprint = THREE.MathUtils.lerp(this._sprint || 0, player.sprinting ? 1 : 0, k);
    // recarga: el arma baja y gira
    const rl = this.reloading > 0 ? Math.sin(Math.min(1, 1 - this.reloading / c.reloadTime) * Math.PI) : 0;
    // cambio de arma: baja y sube
    const sw = this.switching > 0 ? Math.sin(this.switching * Math.PI) : 0;

    const h = this.holder;
    h.position.set(
      px + bx + this.sway.x * 0.6 - this._sprint * 0.05,
      py + by + this.sway.y * 0.6 - rl * 0.12 - sw * 0.35 - this._sprint * 0.04 - player.landDip * 0.3,
      pz + this.kick * c.recoil.kick * (1 - this.aim * 0.5)
    );
    h.rotation.set(
      this.kickRot * c.recoil.kick * 1.2 + this.sway.y * 1.5 - rl * 0.5 - this._sprint * 0.25,
      this.sway.x * 1.5 + this._sprint * 0.55,
      this.sway.x * 0.8 + rl * 0.6 + this._sprint * 0.2
    );

    // fogonazo
    this.flashT -= dt;
    const on = this.flashT > 0;
    const w = this.current;
    if (on) {
      if (this.flash.parent !== w.muzzle) w.muzzle.add(this.flash);
      this.flash.scale.setScalar(0.22 + Math.random() * 0.1);
    }
    this.flash.visible = on;
    this.flashLight.intensity = on ? 30 : 0;
    this.viewFlashLight.position.fromArray(c.muzzle);
    this.viewFlashLight.intensity = on ? 3 : 0;

    // FOV
    const targetFov = THREE.MathUtils.lerp(player.targetFov(), c.adsFov, this.aim);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 12));
      this.camera.updateProjectionMatrix();
    }
    if (this.controls) this.controls.pointerSpeed = (this.baseSensitivity || 1) * (1 - this.aim * 0.45);
  }

  /** Coloca el viewmodel en la pose de la cámara (llamar justo antes de renderizar). */
  syncToCamera() {
    this.root.position.copy(this.camera.position);
    this.root.quaternion.copy(this.camera.quaternion);
  }
}
