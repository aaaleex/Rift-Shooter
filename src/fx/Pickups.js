import * as THREE from 'three';
import { PICKUPS } from '../config.js';

/**
 * Balas doradas (modelo "Golden Bullet" optimizado): las sueltan los robots al morir.
 * Recogerlas da munición a todas las armas y algo de vida. Giran, flotan, brillan (bloom)
 * y parpadean antes de desaparecer.
 */
export class Pickups {
  constructor(scene, template) {
    this.scene = scene;
    this.list = [];
    this.template = template.clone(true);
    // normalizamos el tamaño (≈0.55 m de alto) y lo dejamos de pie
    const box = new THREE.Box3().setFromObject(this.template);
    const size = box.getSize(new THREE.Vector3());
    this.baseScale = 0.55 / Math.max(size.x, size.y, size.z);
    this.template.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(0xffb020);
      o.material.emissiveIntensity = 0.55;
      o.material.metalness = 1;
      o.material.roughness = 0.22;
      o.castShadow = true;
    });
    // halo en el suelo
    this.haloGeo = new THREE.RingGeometry(0.28, 0.42, 32);
  }

  spawn(pos) {
    const g = new THREE.Group();
    const m = this.template.clone(true);
    m.scale.setScalar(this.baseScale);
    g.add(m);
    const halo = new THREE.Mesh(this.haloGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc040).multiplyScalar(2.5), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.04;
    g.add(halo);
    g.position.set(pos.x, 0, pos.z);
    this.scene.add(g);
    this.list.push({ g, m, halo, t: 0, life: PICKUPS.lifetime, phase: Math.random() * 6 });
  }

  /** onCollect() se llama al recoger. */
  update(dt, playerPos, onCollect) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.life -= dt;
      const pop = Math.min(1, p.t * 3);
      p.m.position.y = 0.55 + Math.sin(p.t * 2.6 + p.phase) * 0.12 + (1 - pop) * 0.8;
      p.m.rotation.y += dt * 2.4;
      p.m.rotation.z = 0.25;
      const s = 0.9 + 0.1 * Math.sin(p.t * 5);
      p.halo.scale.setScalar(s);
      // parpadeo los últimos 4 s
      p.g.visible = p.life > 4 || Math.sin(p.life * 18) > 0;
      const dx = playerPos.x - p.g.position.x, dz = playerPos.z - p.g.position.z;
      if (dx * dx + dz * dz < 1.6 * 1.6 && playerPos.y < 3.5) {
        onCollect(p.g.position.clone());
        this._remove(i);
      } else if (p.life <= 0) {
        this._remove(i);
      }
    }
  }

  _remove(i) {
    const p = this.list[i];
    this.scene.remove(p.g);
    p.halo.material.dispose();
    this.list.splice(i, 1);
  }

  clear() { for (let i = this.list.length - 1; i >= 0; i--) this._remove(i); }
}
