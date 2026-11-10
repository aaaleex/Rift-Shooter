import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_MAP, PLAYER_SPAWN_CELL, ASSETS, ENEMY_TYPES, PICKUPS, PLAYER } from './src/config.js';
import { AssetLoader } from './src/core/AssetLoader.js';
import { PostFX } from './src/core/PostFX.js';
import { CameraShake } from './src/core/CameraShake.js';
import { Sfx } from './src/core/Sfx.js';
import { ArenaManager, SUN_DIR } from './src/world/ArenaManager.js';
import { Player } from './src/Player.js';
import { WeaponSystem } from './src/WeaponSystem.js';
import { Enemy } from './src/Enemy.js';
import { WaveManager } from './src/WaveManager.js';
import { Projectiles } from './src/Projectiles.js';
import { Particles } from './src/fx/Particles.js';
import { Pickups } from './src/fx/Pickups.js';
import { UI } from './src/ui/UI.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem('rift.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rift.' + k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

const QUALITY = {
  low: { pixelRatio: 0.85, samples: 0, shadows: false, bloom: false },
  medium: { pixelRatio: 1, samples: 2, shadows: true, bloom: true },
  high: { pixelRatio: 1.5, samples: 4, shadows: true, bloom: true },
};

class Game {
  constructor() {
    this.ui = new UI();
    this.sfx = new Sfx();
    this.shake = new CameraShake();
    this.settings = Object.assign({ sens: 1, vol: 0.6, fov: PLAYER.fov, quality: 'high', shake: true }, store.get('settings', {}));
    this.best = store.get('best', null);
    this.state = 'loading';     // loading | menu | playing | paused | dying | over
    this.enemies = [];
    this.time = 0;
    this.timeScale = 1;
    this.hitstop = 0;
    this.pendingStart = false;

    this._initRenderer();
    this._bindUI();
    this._bindInput();
    this.ui.setBest(this.best);
    this.ui.show('main');
    this._load();
    this.clock = new THREE.Clock();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
    window.__riftReady = true;
  }

  // =================================================================================== setup
  _initRenderer() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd89a6a, 0.0105);   // calima de polvo al atardecer
    this.viewScene = new THREE.Scene();

    // Iluminación basada en imagen: da reflejos creíbles al metal del M16 y de los robots
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    this.viewScene.environment = this.env;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, aspect, 0.05, 900);
    this.menuCam = new THREE.PerspectiveCamera(50, aspect, 0.1, 900);
    this.scene.add(this.camera);

    // luces del mundo (número FIJO: cambiarlo en partida obligaría a recompilar shaders)
    this.scene.add(new THREE.HemisphereLight(0xffd2a8, 0x8a5634, 1.05));
    this.fill = new THREE.DirectionalLight(0x9db4ff, 0.55);   // contraluz frío del cielo: las caras a la sombra no quedan negras
    this.moon = new THREE.DirectionalLight(0xffb878, 3.0);    // sol bajo de atardecer (sombras largas)
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    Object.assign(this.moon.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 1, far: 260 });
    this.moon.shadow.bias = -0.0005;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon, this.moon.target, this.fill, this.fill.target);
    this.boomLights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffa050, 0, 16, 1.8);
      this.scene.add(l);
      return l;
    });
    this._boomIdx = 0;

    // luces del arma (escena del viewmodel)
    this.viewScene.add(new THREE.HemisphereLight(0xcfe6ff, 0x30302c, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1, 2, 1);
    this.viewScene.add(key);

    this._applyQuality();

    window.addEventListener('resize', () => this._resize());
  }

  _applyQuality() {
    const q = QUALITY[this.settings.quality] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.moon.castShadow = q.shadows;
    this.postfx?.dispose();
    this.postfx = new PostFX(this.renderer, this.scene, this.viewScene, this.camera, q.samples);
    this.postfx.setBloom(q.bloom);
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
    for (const c of [this.camera, this.menuCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  }

  async _load() {
    const loader = new AssetLoader(ASSETS, this.renderer);
    loader.onProgress = (p, url) => this.ui.setLoading(p, url);
    try {
      this.assets = await loader.load();
    } catch (err) {
      const box = document.getElementById('boot-error');
      box.textContent = `${err.message}. Comprueba que la carpeta assets/ está completa y que usas un servidor HTTP.`;
      box.classList.remove('hidden');
      throw err;
    }
    this._buildWorld();
    this.state = 'menu';
    this.ui.setReady();
    this._startAttract();
  }

  _buildWorld() {
    const { textures, models } = this.assets;
    this.atlas = textures.robotAtlas;
    this.atlas.flipY = false;              // UVs de glTF
    this.atlas.needsUpdate = true;

    this.arena = new ArenaManager(ARENA_MAP, this.scene, textures, models);
    this.arena.floor.material.envMapIntensity = 0.15;
    this.arena.wallMesh.material.envMapIntensity = 0.35;
    // el sol del cielo y la luz direccional apuntan igual: las sombras cuadran con el disco solar
    const sunPos = SUN_DIR.clone().multiplyScalar(120);
    sunPos.y = Math.max(sunPos.y, 32);               // un poco más alto que el disco para no dejar todo en sombra
    this.moon.position.copy(this.arena.center).add(sunPos);
    this.moon.target.position.copy(this.arena.center);
    this.fill.position.copy(this.arena.center).add(new THREE.Vector3(40, 30, 50));
    this.fill.target.position.copy(this.arena.center);

    // faroles: luz real cálida (sustituyen a los neones)
    for (const p of this.arena.lanternSpots) {
      const l = new THREE.PointLight(0xffa04a, 32, 20, 1.7);
      l.position.copy(p);
      this.scene.add(l);
    }

    this.particles = new Particles(this.scene);
    this.projectiles = new Projectiles(this.scene, this.arena, this.particles);
    this.pickups = new Pickups(this.scene, models.goldenBullet);
    this.player = new Player(this.camera, this.arena);
    this.player.baseFov = this.settings.fov;
    this.player.onStep = (sprint) => this.sfx.step(false);
    this.spawnPoint = this.arena.cellCenter(...PLAYER_SPAWN_CELL);
    this.player.reset(this.spawnPoint);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('lock', () => this._onLock());
    this.controls.addEventListener('unlock', () => this._onUnlock());

    this.weapons = new WeaponSystem({
      camera: this.camera, viewScene: this.viewScene, worldScene: this.scene, models,
      arena: this.arena, particles: this.particles, sfx: this.sfx, shake: this.shake, controls: this.controls,
    });
    this.weapons.baseSensitivity = this.settings.sens;

    this.enemyCtx = {
      arena: this.arena, projectiles: this.projectiles, sfx: this.sfx,
      onMelee: (dmg, e) => this._hurtPlayer(dmg, e.position),
      onStomp: (e) => {
        if (this.state !== 'playing') return;
        const d = e.position.distanceTo(this.player.position);
        if (d < 26) { this.shake.add(0.16 * (1 - d / 26)); this.sfx.step(true); }
      },
    };

    this.waves = new WaveManager({
      arena: this.arena,
      spawn: (type, pos, mods) => this._spawnEnemy(type, pos, mods),
      events: {
        onCountdown: (n, wave) => {
          if (wave === 1) this.ui.announce('DESENFUNDA, FORASTERO', 'RONDA 1', `<b>${n}</b>`, '', n + 0.4);
        },
        onTick: (n, next) => {
          this.sfx.tick();
          if (next === 1) this.ui.announceSub(`<b>${n}</b>`);
          else if (n === 3) this.ui.announce('CARGA EL TAMBOR · SE ACERCA LA', `RONDA ${next}`, `<b>${n}</b>`, '', 3.4);
          else if (n < 3) this.ui.announceSub(`<b>${n}</b>`);
        },
        onWaveStart: (w, total, boss) => {
          this.ui.setRound(w);
          this.sfx.waveStart();
          if (boss) this.ui.announce('★ LLEGA EL FORAJIDO MÁS BUSCADO ★', 'SHERIFF DE HIERRO', `RONDA ${w} · ${total} FORAJIDOS`, 'danger', 2.6);
          else this.ui.announce(`RONDA ${w}`, '¡A POR ELLOS!', `${total} FORAJIDOS`, '', 1.5);
        },
        onWaveCleared: (w, bonus) => {
          this.score += bonus;
          this.player.heal(30);
          this.ui.healFlash();
          this.sfx.waveClear();
          this.ui.announce(`RONDA ${w}`, 'SUPERADA', `RECOMPENSA +$${bonus.toLocaleString('es-ES')} · +30 VIDA`, 'good', 2.2);
        },
      },
    });

    this._cross = new THREE.Raycaster();
    this._tmp = new THREE.Vector3();
  }

  // =================================================================================== UI / entrada
  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const click = (el, fn) => el.addEventListener('click', (e) => { this.sfx.unlock(); this.sfx.uiConfirm(); fn(e); });
    document.querySelectorAll('.btn').forEach((b) => b.addEventListener('mouseenter', () => this.sfx.ui()));

    // JUGAR / REINTENTAR / REINICIAR -> nueva partida. controls.lock() SIEMPRE dentro del clic (gesto real).
    const start = () => { if (!this.controls) return; this.pendingStart = true; this.controls.lock(); };
    click($('btn-play'), start);
    click($('btn-retry'), start);
    click($('btn-restart'), start);
    click($('btn-resume'), () => this.controls.lock());
    click($('btn-quit'), () => this._toMenu());
    click($('btn-menu'), () => this._toMenu());

    document.addEventListener('pointerlockerror', () => {
      this.pendingStart = false;
      this.ui.hint('EL NAVEGADOR HA BLOQUEADO EL RATÓN · ESPERA 1 S Y VUELVE A PULSAR', 3);
      this.ui.el.sysStatus.textContent = 'RATÓN BLOQUEADO · ABRE EL JUEGO EN SU PROPIA PESTAÑA SI SIGUE FALLANDO';
    });

    // paneles laterales / ajustes
    const pSettings = $('panel-settings'), pControls = $('panel-controls'), pWanted = $('panel-wanted'), side = document.querySelector('.side');
    let openPanel = 'wanted';
    document.querySelectorAll('[data-open]').forEach((b) => click(b, () => {
      const what = b.dataset.open;
      if (what === 'settings-pause') {
        const slot = $('pause-settings-slot');
        if (pSettings.parentElement !== slot) slot.appendChild(pSettings);
        pSettings.classList.remove('hidden');
        slot.classList.toggle('hidden');
        return;
      }
      if (pSettings.parentElement !== side) side.appendChild(pSettings);
      openPanel = openPanel === what ? 'wanted' : what;   // segundo clic: vuelve el cartel de SE BUSCA
      pSettings.classList.toggle('hidden', openPanel !== 'settings');
      pControls.classList.toggle('hidden', openPanel !== 'controls');
      pWanted.classList.toggle('hidden', openPanel !== 'wanted');
    }));

    const bindRange = (id, out, key, fmt, apply) => {
      const input = $(id), o = $(out);
      input.value = this.settings[key];
      o.textContent = fmt(this.settings[key]);
      input.addEventListener('input', () => {
        this.settings[key] = parseFloat(input.value);
        o.textContent = fmt(this.settings[key]);
        store.set('settings', this.settings);
        apply(this.settings[key]);
      });
      apply(this.settings[key]);
    };
    bindRange('s-sens', 'o-sens', 'sens', (v) => v.toFixed(1), (v) => { if (this.weapons) this.weapons.baseSensitivity = v; });
    bindRange('s-vol', 'o-vol', 'vol', (v) => Math.round(v * 100), (v) => this.sfx.setVolume(v));
    bindRange('s-fov', 'o-fov', 'fov', (v) => Math.round(v), (v) => { if (this.player) this.player.baseFov = v; });
    const qBtns = document.querySelectorAll('#s-quality button');
    const markQ = () => qBtns.forEach((b) => b.classList.toggle('on', b.dataset.q === this.settings.quality));
    qBtns.forEach((b) => click(b, () => { this.settings.quality = b.dataset.q; store.set('settings', this.settings); markQ(); this._applyQuality(); }));
    markQ();
    const shake = $('s-shake');
    shake.checked = this.settings.shake;
    this.shake.enabled = this.settings.shake;
    shake.addEventListener('change', () => { this.settings.shake = shake.checked; this.shake.enabled = shake.checked; store.set('settings', this.settings); });
  }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      if (!this.player) return;
      this.player.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      if (this.state !== 'playing') return;
      if (e.code === 'KeyR') this.weapons.requestReload();
      if (e.code === 'Digit1') this.weapons.switchTo(0);
      if (e.code === 'Digit2') this.weapons.switchTo(1);
      if (e.code === 'Digit3') this.weapons.switchTo(2);
    });
    document.addEventListener('keyup', (e) => { if (this.player) this.player.keys[e.code] = false; });
    window.addEventListener('blur', () => this._releaseInput());
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || !this.controls?.isLocked) return;
      if (e.button === 0) this.weapons.trigger = true;
      if (e.button === 2) this.weapons.aimHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (!this.weapons) return;
      if (e.button === 0) this.weapons.trigger = false;
      if (e.button === 2) this.weapons.aimHeld = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.state === 'playing' && this.controls?.isLocked) this.weapons.onMouseMove(e.movementX || 0, e.movementY || 0);
    });
    document.addEventListener('wheel', (e) => { if (this.state === 'playing') this.weapons.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _releaseInput() {
    if (!this.player) return;
    this.player.keys = {};
    this.weapons.trigger = false;
    this.weapons.aimHeld = false;
  }

  // =================================================================================== flujo de estados
  _onLock() {
    if (this.pendingStart) { this.pendingStart = false; this._beginRun(); return; }
    if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.hideScreens();
    }
  }

  _onUnlock() {
    this._releaseInput();
    if (this.state === 'playing') {
      this.state = 'paused';
      this.ui.show('pause');
      this.ui.stats(document.getElementById('pause-stats'), [
        ['Ronda', this.waves.wave], ['Bajas', this.stats.kills], ['Recompensa', '$' + this.score.toLocaleString('es-ES')],
      ]);
      // Chrome no deja recapturar el ratón durante ~1 s tras pulsar ESC
      this.ui.cooldownButton(document.getElementById('btn-resume'));
      this.ui.cooldownButton(document.getElementById('btn-restart'));
    }
  }

  _clearCombat() {
    for (const e of this.enemies) { this.scene.remove(e); e.dispose(); }
    this.enemies.length = 0;
    this.projectiles.clear();
    this.particles.clear();
    this.pickups.clear();
  }

  _beginRun() {
    this._clearCombat();
    this.player.reset(this.spawnPoint);
    this.weapons.reset();
    this.camera.fov = this.player.baseFov;
    this.camera.updateProjectionMatrix();
    this.score = 0;
    this.combo = 1;
    this.lastKill = -99;
    this.stats = { kills: 0, start: performance.now() };
    this.timeScale = 1;
    this.hitstop = 0;
    this.shake.trauma = 0;
    this.ui.clearTransient();
    this.ui.setRound(0, false);
    this.ui.setBoss(null);
    this.ui.hideScreens();
    this.ui.wipe();
    document.body.classList.remove('dying');
    this.postfx.setViewmodelVisible(true);
    this.state = 'playing';
    this.waves.start();
  }

  _toMenu() {
    this.state = 'menu';
    this.ui.show('main');
    this.ui.setBest(this.best);
    document.body.classList.remove('dying');
    this._startAttract();
  }

  _startAttract() {
    // modo "attract": unos robots patrullan la arena de fondo mientras el menú está abierto
    this._clearCombat();
    const types = ['trooper', 'trooper', 'hound', 'wasp', 'titan', 'hound'];
    for (const t of types) {
      const p = this.arena.randomOpenPoint();
      this._spawnEnemy(t, p, { hpMult: 1, speedMult: 1, fireMult: 1 }, true);
    }
  }

  _die() {
    this.state = 'dying';
    this.dyingT = 0;
    this.timeScale = 0.3;
    this._releaseInput();
    document.body.classList.add('dying');
    this.ui.setBoss(null);
    this.ui.announce('', 'MORDISTE EL POLVO', '', 'danger', 2);
    this.sfx.explosion(true);
    this.shake.add(0.8);
  }

  _gameOver() {
    this.state = 'over';
    this.timeScale = 1;
    document.body.classList.remove('dying');
    this.postfx.setViewmodelVisible(true);
    if (this.controls.isLocked) this.controls.unlock();
    const secs = Math.round((performance.now() - this.stats.start) / 1000);
    const ws = this.weapons.stats;
    const acc = ws.fired ? Math.round((ws.hit / ws.fired) * 100) : 0;
    const record = !this.best || this.score > this.best.score;
    if (record) { this.best = { score: this.score, wave: this.waves.wave }; store.set('best', this.best); }
    document.getElementById('new-record').classList.toggle('hidden', !record || this.score === 0);
    this.ui.stats(document.getElementById('over-stats'), [
      ['Recompensa', '$' + this.score.toLocaleString('es-ES'), true],
      ['Ronda alcanzada', this.waves.wave, true],
      ['Bajas', this.stats.kills],
      ['Precisión', acc + '%'],
      ['Críticos', ws.crits],
      ['Tiempo', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ]);
    this.ui.clearTransient();
    this.ui.show('over');
    this.ui.cooldownButton(document.getElementById('btn-retry'));
  }

  // =================================================================================== combate
  _spawnEnemy(type, pos, mods, passive = false) {
    const def = ENEMY_TYPES[type];
    const e = new Enemy(type, def, this.assets.models[def.model], this.atlas, mods, this.enemyCtx);
    e.passive = passive;
    e.position.set(pos.x, 0, pos.z);
    e.yaw = Math.atan2(this.player.position.x - pos.x, this.player.position.z - pos.z);
    e.rotation.y = e.yaw;
    this.scene.add(e);
    this.enemies.push(e);
    if (!passive) {
      this.arena.flashPortalNear(pos);
      this.particles.burst(this._tmp.set(pos.x, 1, pos.z), 0xff7a2a, def.boss ? 90 : 36, def.boss ? 12 : 7, 5);
      this.sfx.spawn();
      if (def.boss) this.ui.hint('★ EL SHERIFF DE HIERRO HA LLEGADO ★', 2.5);
    }
    return e;
  }

  _hurtPlayer(dmg, from) {
    if (this.state !== 'playing') return;
    const dead = this.player.takeDamage(dmg);
    this.ui.hurt(dmg);
    this.sfx.hurt();
    this.shake.add(0.22 + dmg * 0.012);
    // indicador de dirección del daño
    const p = this.player.position;
    const fwd = this.camera.getWorldDirection(this._tmp);
    const angle = Math.atan2(fwd.x, fwd.z) - Math.atan2(from.x - p.x, from.z - p.z);
    this.ui.damageDirection(angle);
    if (dead) this._die();
  }

  _boom(pos, big) {
    const l = this.boomLights[this._boomIdx++ % this.boomLights.length];
    l.position.copy(pos);
    l.intensity = big ? 260 : 90;
    l.distance = big ? 30 : 16;
  }

  _killEnemy(e, crit) {
    const def = e.def;
    const c = e.center.clone();
    const scale = def.boss ? 2.6 : e.typeId === 'hound' ? 0.8 : 1;
    this.particles.explode(c, def.colors, scale);
    this._boom(c, def.boss);
    this.sfx.explosion(def.boss);
    this.sfx.kill();
    const d = c.distanceTo(this.player.position);
    this.shake.add(def.boss ? 0.75 : Math.max(0.08, 0.3 - d * 0.01));
    // hitstop: un instante de cámara lenta vende el impacto
    this.timeScale = def.boss ? 0.15 : 0.3;
    this.hitstop = def.boss ? 0.45 : 0.07;

    // combo
    this.combo = this.time - this.lastKill < 3.5 ? Math.min(5, this.combo + 1) : 1;
    this.lastKill = this.time;
    const pts = Math.round(def.score * this.combo * (crit ? 1.25 : 1));
    this.score += pts;
    this.stats.kills++;
    this.ui.killfeed(`${def.label.toUpperCase()} ${crit ? '· DISPARO CERTERO' : 'ABATIDO'}`, pts, crit);
    this.ui.popup(c, this.camera, `+$${pts}`, 'big');
    if (this.combo >= 2) this.ui.hint(['', '', 'DOBLE BAJA', 'TRIPLE BAJA', 'EL MÁS RÁPIDO DEL OESTE', 'LEYENDA DEL DESIERTO'][this.combo], 1.2);

    if (def.boss || Math.random() < PICKUPS.dropChance) this.pickups.spawn(c);

    this.scene.remove(e);
    e.dispose();
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.waves.notifyKill();
  }

  // =================================================================================== bucle
  _frame() {
    requestAnimationFrame(this._frame);
    const raw = Math.min(this.clock.getDelta(), 0.05);

    if (this.hitstop > 0) {
      this.hitstop -= raw;
      if (this.hitstop <= 0 && this.state === 'playing') this.timeScale = 1;
    }
    const dt = raw * this.timeScale;
    this.time += dt;

    if (!this.arena) { this.renderer.clear(); return; }

    let cam = this.camera;
    if (this.state === 'menu' || this.state === 'over' || this.state === 'loading') {
      this._updateMenu(dt);
      cam = this.menuCam;
    } else if (this.state === 'playing' || this.state === 'dying') {
      this._updateGame(dt, raw);
    }

    // decaimiento de los destellos de explosión
    for (const l of this.boomLights) l.intensity = Math.max(0, l.intensity - raw * l.intensity * 7);

    this.shake.update(raw);
    this.postfx.setCamera(cam);
    this.postfx.setViewmodelVisible(cam === this.camera && this.state !== 'dying');
    if (cam === this.camera) this.shake.apply(cam);
    this.weapons.syncToCamera();
    this.postfx.render(raw);
    if (cam === this.camera) this.shake.restore(cam);
    this.ui.update(raw);
  }

  _updateMenu(dt) {
    // paneo cinemático lento alrededor de la arena
    const t = this.time * 0.07;
    const c = this.arena.center;
    const R = 31 + Math.sin(this.time * 0.11) * 4;
    this.menuCam.position.set(c.x + Math.cos(t) * R, 9.5 + Math.sin(this.time * 0.17) * 2.5, c.z + Math.sin(t) * R);
    this.menuCam.lookAt(c.x + Math.sin(this.time * 0.09) * 4, 1.2, c.z + Math.cos(this.time * 0.08) * 4);
    for (const e of this.enemies) e.update(dt, this.time, this.player.position, this.enemies, true);
    this.arena.update(dt, this.time);
    this.particles.update(dt);
  }

  _updateGame(dt, raw) {
    const dying = this.state === 'dying';
    const p = this.player.position;

    if (!dying) {
      this.player.update(dt);
      const res = this.weapons.update(dt, this.player, this.enemies);
      if (res && res.enemy) {
        this.sfx.hit(res.crit);
        this.ui.hitmarker(res.killed ? 'kill' : res.crit ? 'crit' : '');
        this.ui.popup(res.point, this.camera, res.crit ? `${res.damage}!` : `${res.damage}`, res.crit ? 'crit' : '');
        this.particles.burst(res.point, res.crit ? 0xffd040 : 0x9fe8ff, res.crit ? 12 : 6, 6, 4);
        if (res.killed) this._killEnemy(res.enemy, res.crit);
      }
    } else {
      // muerte: la cámara cae y gira lentamente
      this.dyingT += raw;
      p.y = Math.max(0.35, p.y - raw * 1.6);
      this.camera.rotateZ(raw * 0.5);
      if (this.dyingT > 1.8) { this._gameOver(); return; }
    }

    this.arena.updateFlowField(p);
    for (const e of this.enemies) e.update(dt, this.time, p, this.enemies, false);
    this.projectiles.update(dt, p, 0.45, (dmg, from) => this._hurtPlayer(dmg, from));
    this.pickups.update(dt, p, (at) => {
      this.weapons.addAmmo(PICKUPS.ammoMags);
      this.player.heal(PICKUPS.heal);
      this.sfx.pickup();
      this.ui.healFlash();
      this.ui.popup(at.setY(1.2), this.camera, `+BALAS +${PICKUPS.heal} VIDA`, 'big');
      this.particles.burst(at, 0xffc040, 30, 6, 5);
    });
    if (!dying) this.waves.update(dt, this.enemies.length, p, this.camera);
    this.particles.update(dt);
    this.arena.update(dt, this.time);

    // combo caduca
    if (this.time - this.lastKill > 3.5) this.combo = 1;

    // ---------------- HUD
    const ui = this.ui;
    ui.setHealth(this.player.health, PLAYER.maxHealth);
    ui.setWeapon(this.weapons);
    ui.setScore(this.score, this.combo);
    ui.setEnemies(this.waves.remaining, this.waves.total);
    const boss = this.enemies.find((e) => e.def.boss);
    ui.setBoss(boss || null);

    // mirilla: ¿estoy apuntando a un enemigo?
    let over = false;
    if (this.enemies.length) {
      this._cross.setFromCamera({ x: 0, y: 0 }, this.camera);
      const targets = [this.arena.wallMesh];
      for (const e of this.enemies) targets.push(e.bodyBox);
      const h = this._cross.intersectObjects(targets, false)[0];
      over = !!(h && h.object.userData.enemy && h.distance < 60);
    }
    ui.setCrosshair(this.weapons.spreadNow(this.player), this.camera.fov, this.weapons.aim, this.weapons.cooldown > 0, over);
  }
}

window.rift = new Game();
