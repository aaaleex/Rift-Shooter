import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

const TIPS = [
  'APUNTEN AL OJO DE LOS AUTOMATAS',
  'EL SHERIFF DE HIERRO SIEMPRE SUELTA UNA BALA DORADA',
  'CUANDO EL OJO SE PONE AMARILLO VA A DISPARAR',
  'LOS COYOTES MUERDEN DE CERCA NO SE QUEDE QUIETO',
  'BAJAS RAPIDAS SUBEN LA RACHA Y LA RECOMPENSA',
  'EL REVOLVER CASTIGA DOBLE SI ACIERTA EN LA CABEZA',
  'CINCO SEGUNDOS A CUBIERTO Y SANARA SUS HERIDAS',
  'LOS BUITRES DISPARAN DESDE EL AIRE MIRE ARRIBA',
];

/** Toda la manipulación del DOM (menús, HUD, anuncios, popups) vive aquí. */
export class UI {
  constructor() {
    this.el = {
      body: document.body,
      hud: $('hud'), round: $('round-num'), left: $('enemies-left'), waveProg: $('wave-progress'),
      score: $('score'), combo: $('combo'),
      hpText: $('hp-text'), hpBar: $('hp-bar'), hpPanel: $('hud-health'),
      weaponName: $('weapon-name'), mag: $('ammo-mag'), res: $('ammo-res'), reload: $('reload-fill'), slots: $('weapon-slots'),
      cross: $('crosshair'), hit: $('hitmarker'), dirs: $('dmg-dirs'),
      ann: $('announcer'), annTop: $('ann-top'), annMain: $('ann-main'), annSub: $('ann-sub'),
      feed: $('killfeed'), popups: $('popups'), hint: $('hint'),
      boss: $('boss'), bossFill: $('boss-fill'), bossLabel: $('boss-label'),
      lowhp: $('lowhp'), dmgFlash: $('dmg-flash'), healFlash: $('heal-flash'), wipe: $('wipe'),
      loader: $('loader'), loadFill: $('load-fill'), loadPct: $('load-pct'), loadFile: $('load-file'), loadText: $('load-text'),
      play: $('btn-play'), sysStatus: $('sys-status'), best: $('best'), ticker: $('ticker'),
      screens: { main: $('screen-main'), pause: $('screen-pause'), over: $('screen-over') },
    };
    // segmentos de la barra de vida
    for (let i = 0; i < 20; i++) this.el.hpBar.appendChild(document.createElement('i'));
    this.hpSegs = [...this.el.hpBar.children];
    // telegrama: los consejos se separan con STOP
    const t = TIPS.map((s) => `<span>${s}</span><em>STOP</em>`).join('');
    this.el.ticker.innerHTML = '<span>TELEGRAMA URGENTE PARA EL FORASTERO</span><em>STOP</em>' + t + t;
    // tambor del revólver (6 recámaras)
    this.el.cyl = document.getElementById('cylinder');
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('i');
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      c.style.transform = `translate(${Math.cos(a) * 17}px, ${Math.sin(a) * 17}px)`;
      this.el.cyl.appendChild(c);
    }
    this.cylChambers = [...this.el.cyl.children];
    this._annTimer = 0;
    this._hintTimer = 0;
    this._last = {};
  }

  // ------------------------------------------------------------------ pantallas
  show(name) {
    for (const [k, s] of Object.entries(this.el.screens)) s.classList.toggle('active', k === name);
    const b = this.el.body;
    b.classList.toggle('menu-open', name === 'main' || name === 'over');
    b.classList.toggle('paused', name === 'pause');
    this.el.hud.classList.toggle('hidden', name === 'main');
  }

  hideScreens() {
    for (const s of Object.values(this.el.screens)) s.classList.remove('active');
    this.el.body.classList.remove('menu-open', 'paused');
    this.el.hud.classList.remove('hidden');
  }

  wipe() {
    const w = this.el.wipe;
    w.classList.remove('go');
    void w.offsetWidth;
    w.classList.add('go');
  }

  cooldownButton(btn, ms = 1100) {
    btn.disabled = true;
    btn.classList.remove('cooling');
    void btn.offsetWidth;
    btn.classList.add('cooling');
    setTimeout(() => { btn.disabled = false; btn.classList.remove('cooling'); }, ms);
  }

  // ------------------------------------------------------------------ carga
  setLoading(pct, file) {
    const p = Math.round(pct * 100);
    this.el.loadFill.style.transform = `scaleX(${pct})`;
    this.el.loadPct.textContent = `${p}%`;
    if (file) this.el.loadFile.textContent = '> ' + file.split('/').pop();
  }

  setReady() {
    this.el.loadText.textContent = 'TODO LISTO, FORASTERO';
    this.el.loadFile.textContent = '> revólveres cargados, caballos ensillados';
    setTimeout(() => this.el.loader.classList.add('done'), 500);
    this.el.play.disabled = false;
    this.el.play.querySelector('.btn-label').textContent = 'DESENFUNDAR';
    this.el.sysStatus.textContent = 'EL PUEBLO TE ESPERA';
    this.el.sysStatus.parentElement.classList.add('ready');
  }

  setBest(best) {
    this.el.best.textContent = best ? `★ MEJOR RECOMPENSA: $${best.score.toLocaleString('es-ES')} · RONDA ${best.wave}` : '';
  }

  // ------------------------------------------------------------------ HUD
  setRound(n, bump = true) {
    this.el.round.textContent = String(n).padStart(2, '0');
    if (bump) { this.el.round.classList.remove('bump'); void this.el.round.offsetWidth; this.el.round.classList.add('bump'); }
  }

  setEnemies(left, total) {
    if (this._last.left !== left) { this.el.left.textContent = left; this._last.left = left; }
    const p = total ? 1 - left / total : 0;
    this.el.waveProg.style.transform = `scaleX(${p})`;
  }

  setScore(score, mult) {
    if (this._last.score !== score) { this.el.score.textContent = score.toLocaleString('es-ES'); this._last.score = score; }
    if (this._last.mult !== mult) {
      this._last.mult = mult;
      this.el.combo.classList.toggle('hidden', mult <= 1);
      this.el.combo.querySelector('b').textContent = 'x' + mult;
      this.el.combo.classList.remove('pop'); void this.el.combo.offsetWidth; this.el.combo.classList.add('pop');
    }
  }

  setHealth(hp, max) {
    const v = Math.ceil(hp);
    if (this._last.hp === v) return;
    this._last.hp = v;
    this.el.hpText.textContent = v;
    const on = Math.ceil((hp / max) * 20);
    this.hpSegs.forEach((s, i) => s.classList.toggle('off', i >= on));
    const low = hp / max < 0.3;
    this.el.hpPanel.classList.toggle('low', low);
    this.el.lowhp.classList.toggle('on', low && hp > 0);
  }

  hurt(amount) {
    this.el.dmgFlash.animate([{ opacity: Math.min(0.9, 0.3 + amount * 0.03) }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
    this.el.hpPanel.classList.remove('hurt'); void this.el.hpPanel.offsetWidth; this.el.hpPanel.classList.add('hurt');
  }

  healFlash() { this.el.healFlash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' }); }

  damageDirection(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-dir';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dirs.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  setWeapon(ws) {
    const w = ws.current;
    const key = `${ws.index}|${w.mag}|${w.reserve}`;
    if (this._last.weapon !== key) {
      this._last.weapon = key;
      this.el.weaponName.textContent = w.cfg.name;
      this.el.mag.textContent = w.mag;
      this.el.res.textContent = w.reserve;
      this.el.mag.classList.toggle('low', w.mag <= Math.ceil(w.cfg.magSize * 0.2));
      this.el.slots.innerHTML = ws.weapons.map((x, i) => `<span class="${i === ws.index ? 'on' : ''}">${i + 1} · ${x.cfg.id.toUpperCase()}</span>`).join('');
      // tambor visible solo con el revólver: cada disparo lo gira 60º
      const isRevolver = w.cfg.magSize === 6 && !w.cfg.auto;
      this.el.cyl.classList.toggle('hidden', !isRevolver);
      if (isRevolver) {
        this.cylChambers.forEach((c, i) => c.classList.toggle('empty', i >= w.mag));
        this.el.cyl.style.transform = `rotate(${(6 - w.mag) * 60}deg)`;
      }
    }
    const r = ws.reloading > 0 ? 1 - ws.reloading / w.cfg.reloadTime : 0;
    this.el.reload.style.transform = `scaleX(${r})`;
    // aviso de recarga
    if (w.mag === 0 && ws.reloading <= 0 && w.reserve === 0) this.hint('¡SIN BALAS! BUSCA BALAS DORADAS', 0.2);
    else if (w.mag <= Math.ceil(w.cfg.magSize * 0.2) && ws.reloading <= 0 && w.reserve > 0) this.hint('[R] RECARGAR', 0.2);
  }

  /** Mirilla dinámica: el hueco depende de la dispersión real del arma. */
  setCrosshair(spreadRad, fovDeg, aim, firing, overEnemy) {
    const px = (spreadRad / (fovDeg * Math.PI / 180)) * window.innerHeight;
    const gap = 5 + px * 1.1;
    this.el.cross.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this.el.cross.classList.toggle('ads', aim > 0.6);
    this.el.cross.classList.toggle('fire', firing);
    this.el.cross.classList.toggle('enemy', overEnemy);
  }

  hitmarker(kind) {
    const h = this.el.hit;
    h.className = '';
    void h.offsetWidth;
    h.className = 'show ' + (kind || '');
  }

  setBoss(enemy) {
    if (!enemy) { this.el.boss.classList.add('hidden'); return; }
    this.el.boss.classList.remove('hidden');
    this.el.bossLabel.textContent = enemy.def.label.toUpperCase();
    this.el.bossFill.style.transform = `scaleX(${Math.max(0, enemy.hp / enemy.maxHp)})`;
  }

  // ------------------------------------------------------------------ anuncios y popups
  announce(top, main, sub = '', kind = '', duration = 2.2) {
    const a = this.el.ann;
    this.el.annTop.textContent = top;
    this.el.annMain.textContent = main;
    this.el.annSub.innerHTML = sub;
    a.className = 'show ' + kind;
    // reinicia la animación del texto principal
    const m = this.el.annMain; m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
    this._annTimer = duration;
  }

  announceSub(sub) { this.el.annSub.innerHTML = sub; }

  hint(text, dur = 1.5) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    this._hintTimer = dur;
  }

  killfeed(text, pts, crit) {
    const d = document.createElement('div');
    d.className = 'kf' + (crit ? ' crit' : '');
    d.innerHTML = `${text}<b>+${pts}</b>`;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 3200);
  }

  /** Número flotante en la posición 3D proyectada a pantalla. */
  popup(worldPos, camera, text, cls = '') {
    if (this.el.popups.childElementCount > 26) return;
    _p.copy(worldPos).project(camera);
    if (_p.z > 1) return;
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    d.style.left = ((_p.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 30) + 'px';
    d.style.top = ((-_p.y * 0.5 + 0.5) * window.innerHeight - 20) + 'px';
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  update(dt) {
    if (this._annTimer > 0) {
      this._annTimer -= dt;
      if (this._annTimer <= 0) this.el.ann.classList.remove('show');
    }
    if (this._hintTimer > 0) {
      this._hintTimer -= dt;
      if (this._hintTimer <= 0) this.el.hint.classList.remove('show');
    }
  }

  stats(target, items) {
    target.innerHTML = items.map(([label, value, hl]) => `<div class="stat ${hl ? 'hl' : ''}"><b>${value}</b><span>${label}</span></div>`).join('');
  }

  clearTransient() {
    this.el.popups.innerHTML = '';
    this.el.feed.innerHTML = '';
    this.el.dirs.innerHTML = '';
    this.el.ann.className = '';
    this.el.hint.classList.remove('show');
    this._annTimer = 0;
    this._last = {};
  }
}
