import * as THREE from 'three';
import { PLAYER } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Movimiento en primera persona: aceleración/fricción, sprint, salto, colisión por ejes (desliza por
 * las paredes), balanceo de cabeza, "dip" al aterrizar, FOV dinámico al esprintar y regeneración de vida.
 */
export class Player {
  constructor(camera, arena) {
    this.camera = camera;
    this.arena = arena;
    this.keys = {};
    this.health = PLAYER.maxHealth;
    this.velocity = new THREE.Vector3();
    this.velY = 0;
    this.onGround = true;
    this.feetY = 0;
    this.moveAmount = 0;
    this.sprinting = false;
    this.aiming = false;
    this.sinceHurt = 99;
    this.bobT = 0;
    this.landDip = 0;
    this.baseFov = PLAYER.fov;
    this.onStep = null;
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._lastStepSign = 1;
  }

  get position() { return this.camera.position; }

  reset(spawn) {
    this.health = PLAYER.maxHealth;
    this.velocity.set(0, 0, 0);
    this.velY = 0;
    this.feetY = 0;
    this.onGround = true;
    this.sinceHurt = 99;
    this.landDip = 0;
    this.camera.position.set(spawn.x, PLAYER.eyeHeight, spawn.z);
    this.camera.rotation.set(0, Math.PI, 0, 'YXZ'); // mirando hacia el centro de la arena (-Z => +Z)
  }

  /** Devuelve true si muere. */
  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.sinceHurt = 0;
    return this.health <= 0;
  }

  heal(n) { this.health = Math.min(PLAYER.maxHealth, this.health + n); }

  update(dt) {
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    this.sprinting = !!(k.ShiftLeft || k.ShiftRight) && fwd > 0 && !this.aiming;

    this.camera.getWorldDirection(this._dir);
    this._dir.y = 0;
    this._dir.normalize();
    this._right.crossVectors(this._dir, UP);
    this._wish.set(0, 0, 0).addScaledVector(this._dir, fwd).addScaledVector(this._right, strafe);
    const hasInput = this._wish.lengthSq() > 0;
    if (hasInput) this._wish.normalize();

    const control = this.onGround ? 1 : 0.35;               // poco control en el aire
    const damp = Math.max(0, 1 - PLAYER.friction * dt * (this.onGround ? 1 : 0.15));
    this.velocity.x *= damp;
    this.velocity.z *= damp;
    if (hasInput) {
      this.velocity.x += this._wish.x * PLAYER.accel * control * dt;
      this.velocity.z += this._wish.z * PLAYER.accel * control * dt;
    }
    const max = this.aiming ? PLAYER.adsSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > max) { this.velocity.x *= max / speed; this.velocity.z *= max / speed; }
    this.moveAmount = this.onGround ? Math.min(1.4, speed / PLAYER.walkSpeed) : 0;

    // colisión por ejes
    const p = this.camera.position;
    const nx = p.x + this.velocity.x * dt;
    if (!this.arena.collides(nx, p.z, PLAYER.radius)) p.x = nx; else this.velocity.x = 0;
    const nz = p.z + this.velocity.z * dt;
    if (!this.arena.collides(p.x, nz, PLAYER.radius)) p.z = nz; else this.velocity.z = 0;

    // salto y gravedad (sobre feetY; la cámara se coloca encima con bob/dip)
    if (k.Space && this.onGround) { this.velY = PLAYER.jumpSpeed; this.onGround = false; }
    this.velY -= PLAYER.gravity * dt;
    this.feetY += this.velY * dt;
    if (this.feetY <= 0) {
      if (!this.onGround) this.landDip = Math.min(0.22, Math.abs(this.velY) * 0.02);
      this.feetY = 0;
      this.velY = 0;
      this.onGround = true;
    }

    // balanceo de cabeza + pasos
    this.bobT += dt * (this.sprinting ? 13 : 9.5) * Math.min(1, this.moveAmount);
    const bob = Math.sin(this.bobT * 2) * 0.035 * Math.min(1, this.moveAmount) * (this.aiming ? 0.3 : 1);
    const s = Math.sign(Math.sin(this.bobT));
    if (this.moveAmount > 0.3 && s !== this._lastStepSign) { this._lastStepSign = s; this.onStep?.(this.sprinting); }
    this.landDip = Math.max(0, this.landDip - dt * 0.9);
    p.y = PLAYER.eyeHeight + this.feetY + bob - this.landDip;

    // regeneración
    this.sinceHurt += dt;
    if (this.sinceHurt > PLAYER.regenDelay && this.health < PLAYER.maxHealth) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }
  }

  /** FOV deseado (sprint lo abre; el apuntado lo gestiona WeaponSystem). */
  targetFov() { return this.baseFov + (this.sprinting ? 7 : 0); }
}
