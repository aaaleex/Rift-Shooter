import * as THREE from 'three';

/**
 * Temblor de cámara basado en "trauma" (técnica de Squirrel Eiserloh, GDC 2016):
 *  - Cada evento suma trauma (0..1). La intensidad visible es trauma², así los golpes
 *    pequeños apenas se notan y los grandes se sienten de verdad.
 *  - Se usa ruido suave (suma de senos desfasados), no aleatorio puro: tiembla sin "vibrar".
 *  - Se aplica justo antes de renderizar y se deshace justo después, de modo que nunca
 *    contamina la orientación real que controla el ratón (PointerLockControls).
 */
export class CameraShake {
  constructor() {
    this.trauma = 0;
    this.decay = 1.6;           // trauma que se pierde por segundo
    this.maxAngle = 0.045;      // radianes
    this.maxOffset = 0.07;      // metros
    this.time = 0;
    this._saveQ = new THREE.Quaternion();
    this._saveP = new THREE.Vector3();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._q = new THREE.Quaternion();
    this.enabled = true;
  }

  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }

  _noise(seed) {
    const t = this.time * 22;
    return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.3 + seed * 1.7) * 0.3 + Math.sin(t * 4.1 + seed * 3.1) * 0.2);
  }

  apply(camera) {
    this._saveQ.copy(camera.quaternion);
    this._saveP.copy(camera.position);
    if (!this.enabled || this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    this._e.set(this.maxAngle * s * this._noise(1), this.maxAngle * s * this._noise(7), this.maxAngle * 0.6 * s * this._noise(13));
    camera.quaternion.multiply(this._q.setFromEuler(this._e));
    camera.position.x += this.maxOffset * s * this._noise(21);
    camera.position.y += this.maxOffset * s * this._noise(29);
    camera.updateMatrixWorld();
  }

  restore(camera) {
    camera.quaternion.copy(this._saveQ);
    camera.position.copy(this._saveP);
    camera.updateMatrixWorld();
  }
}
