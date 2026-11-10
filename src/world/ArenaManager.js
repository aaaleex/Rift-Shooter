import * as THREE from 'three';
import { PROPS, LANTERNS } from '../config.js';

export const CELL = 4;
export const WALL_HEIGHT = 4.2;
export const SUN_DIR = new THREE.Vector3(-0.62, 0.2, -0.76).normalize(); // sol bajo de atardecer

/**
 * Arena del desierto a partir de una matriz (0 suelo, 1 muro de adobe, 2 portal del Rift).
 *  - Suelo: arena con normal map en RepeatWrapping (repeat según el tamaño => no se estira).
 *  - Muros: InstancedMesh de adobe (textura de piedra tintada) + remate + vigas de madera.
 *  - Cañón: acantilados de arenisca rodeando la arena; cielo de atardecer con sol y mesetas.
 *  - Decorado (config PROPS): estatua, arcos de roca, rocas y piedras con colisión circular.
 *  - Navegación: flow field BFS hacia la celda del jugador.
 */
export class ArenaManager {
  constructor(map, scene, textures, models) {
    this.map = map.map((row) => Array.from(row, Number));
    this.rows = this.map.length;
    this.cols = this.map[0].length;
    this.width = this.cols * CELL;
    this.depth = this.rows * CELL;
    this.center = new THREE.Vector3(this.width / 2, 0, this.depth / 2);
    this.scene = scene;
    this.tex = textures;

    this.spawns = [];
    this.openCells = [];
    this.portals = [];
    this.colliders = [];      // { x, z, r } círculos de los props
    this.lanternSpots = [];
    this.flow = new Int16Array(this.rows * this.cols).fill(-1);
    this._flowKey = -1;
    this.wind = new THREE.Vector3(1, 0, 0.35).normalize();

    this._buildFloor();
    this._buildWalls();
    this._buildCliffs(models.cliff);
    this._buildProps(models);
    this._buildLanterns();
    this._buildPortals();
    this._buildSky();
    this._buildDust();
    this._buildTumbleweeds();
  }

  _repeat(tex, x, y, srgb = true) {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(x, y);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  // ------------------------------------------------------------------ suelo
  _buildFloor() {
    const TILE = 7; // metros por repetición
    // El suelo se extiende más allá de los muros para que bajo los acantilados también haya arena
    const ext = 70;
    const W = this.width + ext * 2, D = this.depth + ext * 2;
    const mat = new THREE.MeshStandardMaterial({
      map: this._repeat(this.tex.sand, W / TILE, D / TILE),
      normalMap: this._repeat(this.tex.sandNormal, W / TILE, D / TILE, false),
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.96, metalness: 0, color: 0xf0d2a8,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.width / 2, 0, this.depth / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;
  }

  // ------------------------------------------------------------------ muros de adobe
  _buildWalls() {
    const wallCells = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.map[r][c];
        if (v === 1) wallCells.push([r, c]);
        else {
          this.openCells.push([r, c]);
          if (v === 2) this.spawns.push(this.cellCenter(r, c));
        }
      }
    }

    const mat = new THREE.MeshStandardMaterial({
      map: this._repeat(this.tex.stone, CELL / 6, WALL_HEIGHT / 6),
      normalMap: this._repeat(this.tex.stoneNormal, CELL / 6, WALL_HEIGHT / 6, false),
      normalScale: new THREE.Vector2(0.7, 0.7),
      color: 0xffe2c2, emissive: 0x3a1c0c, emissiveIntensity: 0.35, roughness: 0.95, metalness: 0,
    });
    this.wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL), mat, wallCells.length);
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;

    // remate superior (adobe algo más oscuro y sobresaliente)
    const capMat = new THREE.MeshStandardMaterial({ map: this._repeat(this.tex.stone, 1, 0.1), color: 0xc98a5c, roughness: 0.95 });
    this.capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL + 0.18, 0.32, CELL + 0.18), capMat, wallCells.length);
    this.capMesh.castShadow = true;
    this.capMesh.receiveShadow = true;

    // vigas de madera asomando por las caras que dan a zonas abiertas (arquitectura de adobe)
    const vigaPos = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [r, c] of wallCells) {
      for (const [dr, dc] of dirs) {
        if (this.isSolidCell(r + dr, c + dc)) continue;
        for (const k of [-1.2, 0, 1.2]) vigaPos.push({ r, c, dr, dc, k });
      }
    }
    const vigaMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 });
    this.vigaMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.12, 0.7, 7), vigaMat, vigaPos.length);
    this.vigaMesh.castShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    wallCells.forEach(([r, c], i) => {
      const x = c * CELL + CELL / 2, z = r * CELL + CELL / 2;
      m.makeTranslation(x, WALL_HEIGHT / 2, z);
      this.wallMesh.setMatrixAt(i, m);
      m.makeTranslation(x, WALL_HEIGHT + 0.12, z);
      this.capMesh.setMatrixAt(i, m);
    });
    const ex = new THREE.Euler();
    vigaPos.forEach(({ r, c, dr, dc, k }, i) => {
      const x = c * CELL + CELL / 2 + dc * (CELL / 2 + 0.25) + (dr ? k : 0);
      const z = r * CELL + CELL / 2 + dr * (CELL / 2 + 0.25) + (dc ? k : 0);
      p.set(x, WALL_HEIGHT - 0.55, z);
      ex.set(dr ? Math.PI / 2 : 0, 0, dc ? Math.PI / 2 : 0);
      q.setFromEuler(ex);
      m.compose(p, q, s);
      this.vigaMesh.setMatrixAt(i, m);
    });
    for (const im of [this.wallMesh, this.capMesh, this.vigaMesh]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    this.scene.add(this.wallMesh, this.capMesh, this.vigaMesh);
  }

  // ------------------------------------------------------------------ cañón de acantilados
  _buildCliffs(template) {
    const mat = new THREE.MeshStandardMaterial({ map: this._repeat(this.tex.sandstone, 3, 3), roughness: 0.95, color: 0xffd2b0 });
    const rand = mulberry32(7);
    const per = 9; // por lado
    const sides = [
      (t) => [t * this.width, -9 - rand() * 6],
      (t) => [t * this.width, this.depth + 9 + rand() * 6],
      (t) => [-9 - rand() * 6, t * this.depth],
      (t) => [this.width + 9 + rand() * 6, t * this.depth],
    ];
    this.cliffs = new THREE.Group();
    for (const side of sides) {
      for (let i = 0; i <= per; i++) {
        const [x, z] = side((i + rand() * 0.6) / per);
        const g = template.clone(true);
        g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
        const sc = 0.85 + rand() * 0.9;
        g.scale.set(sc * (0.9 + rand() * 0.5), sc * (0.7 + rand() * 0.7), sc * (0.9 + rand() * 0.5));
        g.rotation.y = rand() * Math.PI * 2;
        g.position.set(x, -0.3, z);
        this.cliffs.add(g);
      }
    }
    this.scene.add(this.cliffs);
  }

  // ------------------------------------------------------------------ decorado
  _buildProps(models) {
    const T = this.tex;
    const mats = {
      rock: new THREE.MeshStandardMaterial({ map: T.rock, normalMap: this._repeat(T.rockNormal, 1, 1, false), roughness: 0.92 }),
      stones: new THREE.MeshStandardMaterial({ map: T.stone, normalMap: this._repeat(T.stoneNormal, 1, 1, false), color: 0xf0c49a, roughness: 0.92 }),
      arch: new THREE.MeshStandardMaterial({ map: this._repeat(T.sandstone, 2, 2), color: 0xffd8b8, roughness: 0.95 }),
      statue: new THREE.MeshStandardMaterial({ color: 0x8c5a32, metalness: 0.85, roughness: 0.42 }), // bronce envejecido
      pedestal: new THREE.MeshStandardMaterial({ map: this._repeat(T.stone, 1.5, 0.5), color: 0xe8c9a6, roughness: 0.9 }),
    };
    for (const p of PROPS) {
      const g = models[p.type].clone(true);
      g.traverse((o) => { if (o.isMesh) { o.material = mats[p.type]; o.castShadow = true; o.receiveShadow = true; } });
      g.scale.setScalar(p.s);
      g.rotation.y = THREE.MathUtils.degToRad(p.rot);
      g.position.set(p.x, 0, p.z);
      if (p.pedestal) {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.8, 24), mats.pedestal);
        ped.position.set(p.x, 0.4, p.z);
        ped.castShadow = ped.receiveShadow = true;
        this.scene.add(ped);
        g.position.y = 0.8;
      }
      this.scene.add(g);
      if (p.r > 0) this.colliders.push({ x: p.x, z: p.z, r: p.r });
      if (p.legs) {
        const a = g.rotation.y;
        for (const [lx, lz, lr] of p.legs) {
          this.colliders.push({ x: p.x + lx * Math.cos(a) + lz * Math.sin(a), z: p.z - lx * Math.sin(a) + lz * Math.cos(a), r: lr });
        }
      }
    }
  }

  _buildLanterns() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(4), toneMapped: false });
    const iron = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.5 });
    this.lanternGlass = glass;
    for (const [x, z] of LANTERNS) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), wood);
      post.position.y = 1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), wood);
      arm.position.set(0.4, 3.1, 0);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), glass);
      lamp.position.set(0.75, 2.8, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 4), iron);
      cap.position.set(0.75, 3.05, 0);
      cap.rotation.y = Math.PI / 4;
      for (const m of [post, arm, cap]) m.castShadow = true;
      g.add(post, arm, lamp, cap);
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(this.center.x - x, this.center.z - z) - Math.PI / 2;
      this.scene.add(g);
      g.updateMatrixWorld(true);
      this.lanternSpots.push(lamp.getWorldPosition(new THREE.Vector3()));
      this.colliders.push({ x, z, r: 0.3 });
    }
  }

  _buildPortals() {
    const ringGeo = new THREE.TorusGeometry(1.15, 0.06, 8, 48);
    const discGeo = new THREE.CircleGeometry(1.1, 40);
    for (const p of this.spawns) {
      const g = new THREE.Group();
      g.position.set(p.x, 0.03, p.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(2.2), toneMapped: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      const discMat = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.12, depthWrite: false });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.01;
      g.add(ring, disc);
      this.scene.add(g);
      this.portals.push({ group: g, ring, ringMat, discMat, flash: 0, pos: p });
    }
  }

  _buildSky() {
    // Atardecer procedural: degradado, disco solar, mesetas recortadas en el horizonte y primeras estrellas
    const geo = new THREE.SphereGeometry(450, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float uTime; uniform vec3 uSun;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(float x){ float i=floor(x), f=fract(x); return mix(h(vec2(i,0.)), h(vec2(i+1.,0.)), smoothstep(0.,1.,f)); }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 top = vec3(0.16, 0.18, 0.38);
          vec3 mid = vec3(0.86, 0.46, 0.36);
          vec3 hor = vec3(1.0, 0.66, 0.36);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.16, y));
          col = mix(col, top, smoothstep(0.12, 0.65, y));
          float sd = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.55, 0.25) * pow(sd, 6.0) * 0.4;             // halo
          col += vec3(1.0, 0.85, 0.55) * pow(sd, 80.0) * 1.2;
          col += vec3(3.0, 2.2, 1.3) * smoothstep(0.9993, 0.9996, sd);    // disco solar (HDR => bloom)
          // mesetas: silueta por acimut
          float az = atan(d.z, d.x);
          float m = n(az * 6.0) * 0.6 + n(az * 17.0) * 0.3 + n(az * 41.0) * 0.1;
          float mesa = 0.012 + pow(m, 2.2) * 0.085;
          mesa = floor(mesa * 90.0) / 90.0;                                // cimas planas
          float hill = step(y, mesa) * step(-0.05, y);
          vec3 mesaCol = mix(vec3(0.42, 0.2, 0.16), vec3(0.62, 0.32, 0.22), smoothstep(0.0, 0.08, y));
          mesaCol = mix(mesaCol, hor, 0.35);                               // perspectiva aérea
          col = mix(col, mesaCol, hill);
          // estrellas tenues arriba
          vec3 c = floor(d * 200.0);
          float st = step(0.9985, h(c.xy + c.z)) * smoothstep(0.35, 0.8, y);
          col += vec3(1.0) * st * (0.4 + 0.3 * sin(uTime * 2.0 + h(c.yz) * 30.0));
          if (y < -0.05) col = vec3(0.55, 0.36, 0.22);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.position.copy(this.center);
    this.scene.add(this.sky);
  }

  _buildDust() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * this.width;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = Math.random() * this.depth;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  _buildTumbleweeds() {
    // rodadoras procedurales: maraña de ramas (LineSegments), ruedan con el viento y botan
    this.tumbleweeds = [];
    const mat = new THREE.LineBasicMaterial({ color: 0x8a6a3a, transparent: true, opacity: 0.9 });
    for (let k = 0; k < 4; k++) {
      const pts = [];
      for (let i = 0; i < 260; i++) {
        const a = new THREE.Vector3().randomDirection().multiplyScalar(0.25 + Math.random() * 0.3);
        const b = a.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.18));
        pts.push(a, b);
      }
      const mesh = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
      mesh.scale.setScalar(0.8 + Math.random() * 0.5);
      this.scene.add(mesh);
      const tw = { mesh, vel: new THREE.Vector3(), vy: 0 };
      this._respawnTumbleweed(tw, true);
      this.tumbleweeds.push(tw);
    }
  }

  _respawnTumbleweed(tw, anywhere = false) {
    const p = this.randomOpenPoint();
    if (!anywhere) { p.x = 5; p.z = 6 + Math.random() * (this.depth - 12); }
    tw.mesh.position.set(p.x, 0.5, p.z);
    tw.vel.copy(this.wind).multiplyScalar(2 + Math.random() * 2.5);
  }

  // ------------------------------------------------------------------ por frame
  update(dt, time) {
    this.sky.material.uniforms.uTime.value = time;
    // polvo arrastrado por el viento (envuelve dentro de la arena)
    const pa = this.dust.geometry.attributes.position;
    const arr = pa.array;
    const wx = this.wind.x * dt * 1.6, wz = this.wind.z * dt * 1.6;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += wx; arr[i + 2] += wz;
      arr[i + 1] += Math.sin(time * 0.7 + i) * dt * 0.08;
      if (arr[i] > this.width) arr[i] -= this.width;
      if (arr[i + 2] > this.depth) arr[i + 2] -= this.depth;
    }
    pa.needsUpdate = true;

    // rodadoras
    const gust = 0.6 + 0.4 * Math.sin(time * 0.37) + 0.25 * Math.sin(time * 1.3);
    for (const tw of this.tumbleweeds) {
      const p = tw.mesh.position;
      const v = tw.vel;
      const nx = p.x + v.x * dt * gust, nz = p.z + v.z * dt * gust;
      if (this.collides(nx, nz, 0.45)) { v.x *= -0.5; v.z = (Math.random() - 0.5) * 3; } else { p.x = nx; p.z = nz; }
      v.x += (this.wind.x * 3.2 - v.x) * dt * 0.4;
      v.z += (this.wind.z * 3.2 - v.z) * dt * 0.4;
      tw.vy -= 9.8 * dt;
      p.y += tw.vy * dt;
      if (p.y < 0.45) { p.y = 0.45; tw.vy = 1.2 + Math.random() * 2.6 * gust; }
      const speed = Math.hypot(v.x, v.z) * gust;
      tw.mesh.rotation.z -= v.x * dt * 1.6 * gust;
      tw.mesh.rotation.x += v.z * dt * 1.6 * gust;
      if (p.x > this.width - 4.5 || p.z > this.depth - 4.5 || p.z < 4.5 || speed < 0.05) this._respawnTumbleweed(tw);
    }

    for (const p of this.portals) {
      p.flash = Math.max(0, p.flash - dt * 1.4);
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + p.pos.x);
      p.ring.rotation.z += dt * (0.6 + p.flash * 6);
      p.ringMat.color.setRGB(1, 0.42, 0.1).multiplyScalar(1.4 + pulse * 0.8 + p.flash * 6);
      p.discMat.opacity = 0.08 + pulse * 0.05 + p.flash * 0.45;
      const s = 1 + p.flash * 0.35;
      p.group.scale.set(s, 1, s);
    }
    // parpadeo de faroles
    const fl = 3.6 + Math.sin(time * 13) * 0.25 + Math.sin(time * 7.3) * 0.2;
    this.lanternGlass.color.setRGB(1, 0.63, 0.25).multiplyScalar(fl);
  }

  flashPortalNear(pos) {
    let best = null, bd = 9;
    for (const p of this.portals) {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) best.flash = 1;
  }

  // ------------------------------------------------------------------ consultas
  cellCenter(r, c) { return new THREE.Vector3(c * CELL + CELL / 2, 0, r * CELL + CELL / 2); }
  cellOf(x, z) { return [Math.floor(z / CELL), Math.floor(x / CELL)]; }

  isSolidCell(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return true;
    return this.map[r][c] === 1;
  }

  collides(x, z, radius = 0.4) {
    for (const k of this.colliders) {
      const dx = x - k.x, dz = z - k.z, rr = radius + k.r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((z - radius) / CELL), r1 = Math.floor((z + radius) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.isSolidCell(r, c)) continue;
        const minX = c * CELL, minZ = r * CELL;
        const nx = Math.max(minX, Math.min(x, minX + CELL));
        const nz = Math.max(minZ, Math.min(z, minZ + CELL));
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < radius * radius) return true;
      }
    }
    return false;
  }

  /** Línea de visión en planta (los props bajos no la bloquean). */
  hasLineOfSight(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (CELL / 5)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidCell(Math.floor((a.z + dz * t) / CELL), Math.floor((a.x + dx * t) / CELL))) return false;
    }
    return true;
  }

  updateFlowField(target) {
    const [tr, tc] = this.cellOf(target.x, target.z);
    const key = tr * this.cols + tc;
    if (key === this._flowKey) return;
    this._flowKey = key;
    const f = this.flow.fill(-1);
    if (this.isSolidCell(tr, tc)) return;
    const q = [key];
    f[key] = 0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      const r = (k / this.cols) | 0, c = k % this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (this.isSolidCell(nr, nc)) continue;
          if (dr && dc && (this.isSolidCell(r + dr, c) || this.isSolidCell(r, c + dc))) continue;
          const nk = nr * this.cols + nc;
          if (f[nk] !== -1) continue;
          f[nk] = f[k] + 1;
          q.push(nk);
        }
      }
    }
  }

  nextWaypoint(x, z, out) {
    const [r, c] = this.cellOf(x, z);
    let best = -1, bestVal = 1e9;
    const here = this.flow[r * this.cols + c];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (this.isSolidCell(nr, nc)) continue;
        if (dr && dc && (this.isSolidCell(r + dr, c) || this.isSolidCell(r, c + dc))) continue;
        const v = this.flow[nr * this.cols + nc];
        if (v >= 0 && v < bestVal) { bestVal = v; best = nr * this.cols + nc; }
      }
    }
    if (best < 0 || (here >= 0 && bestVal >= here)) return null;
    const br = (best / this.cols) | 0, bc = best % this.cols;
    return out.set(bc * CELL + CELL / 2, 0, br * CELL + CELL / 2);
  }

  randomOpenPoint() {
    for (let i = 0; i < 20; i++) {
      const [r, c] = this.openCells[Math.floor(Math.random() * this.openCells.length)];
      const p = this.cellCenter(r, c);
      if (!this.collides(p.x, p.z, 1.2)) return p;
    }
    return this.cellCenter(...this.openCells[0]);
  }
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
