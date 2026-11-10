// =====================================================================================
//  RIFT SHOOTER · configuración central. Todo lo "tuneable" del juego vive aquí.
// =====================================================================================

// 0 = suelo · 1 = muro/cobertura · 2 = portal de aparición (todas las filas, mismas columnas)
export const ARENA_MAP = [
  '11111111111111111111',
  '12000000000000000021',
  '10000000000000000001',
  '10011000000000011001',
  '10010000000000001001',
  '10000000011000000001',
  '10000000010000000001',
  '10000100000000100001',
  '10000100000000100001',
  '12000000000000000021',
  '10000000000000000001',
  '10000100000000100001',
  '10000100000000100001',
  '10000000010000000001',
  '10000000011000000001',
  '10010000000000001001',
  '10011000000000011001',
  '10000000000000000001',
  '12000000000000000021',
  '11111111111111111111',
];
export const PLAYER_SPAWN_CELL = [12, 10]; // [fila, columna]

// ------------------------------------------------------------------ assets (LoadingManager)
export const ASSETS = {
  textures: {
    sand: 'assets/textures/desert/sand_color.jpg',
    sandNormal: 'assets/textures/desert/sand_normal.jpg',
    sandstone: 'assets/textures/desert/sandstone_color.jpg',
    stone: 'assets/textures/desert/stone_color.jpg',
    stoneNormal: 'assets/textures/desert/stone_normal.jpg',
    rock: 'assets/textures/desert/rock_color.jpg',
    rockNormal: 'assets/textures/desert/rock_normal.jpg',
    robotAtlas: 'assets/textures/robots_atlas.png',
  },
  models: {
    revolver: 'assets/models/desert/revolver.glb',
    cliff: 'assets/models/desert/cliff.glb',
    rock: 'assets/models/desert/rock.glb',
    stones: 'assets/models/desert/stones.glb',
    arch: 'assets/models/desert/arch.glb',
    statue: 'assets/models/desert/statue.glb',
    m16: 'assets/models/m16.glb',
    rifleHeavy: 'assets/models/rifle_heavy.glb',
    goldenBullet: 'assets/models/golden_bullet.glb',
    trooper: 'assets/models/robot_trooper.glb',
    hound: 'assets/models/robot_hound.glb',
    wasp: 'assets/models/robot_wasp.glb',
    titan: 'assets/models/robot_titan.glb',
  },
};

// ------------------------------------------------------------------ jugador
export const PLAYER = {
  walkSpeed: 7,
  sprintSpeed: 11,
  adsSpeed: 4.2,
  accel: 60,
  friction: 9,
  jumpSpeed: 7.2,
  gravity: 22,
  eyeHeight: 1.7,
  radius: 0.4,
  maxHealth: 100,
  regenDelay: 5,     // s sin recibir daño antes de regenerar
  regenRate: 9,      // vida / s
  fov: 75,
};

// ------------------------------------------------------------------ armas
// pos/adsPos = posición del modelo respecto a la cámara (en metros). rotY corrige la orientación del GLB.
export const WEAPONS = [
  {
    id: 'colt', name: 'REVÓLVER M1879', model: 'revolver', key: 'Digit1',
    auto: false, fireInterval: 0.26, damage: 68, critMult: 2.5,
    magSize: 6, reserve: 48, reloadTime: 1.7,
    spread: 0.006, adsSpread: 0.0012, moveSpread: 0.025,
    recoil: { kick: 0.16, pitch: 0.045, yaw: 0.01, shake: 0.26 },
    // el GLB del revólver tiene el origen en la base de la culata y el cañón hacia +Z: se gira 180º
    scale: 1, rotY: Math.PI, pos: [0.17, -0.31, -0.42], adsPos: [0, -0.178, -0.36],
    muzzle: [0, 0.155, -0.19], adsFov: 58, tracer: 0xffd08a,
    material: { color: 0x2b2e34, metalness: 0.92, roughness: 0.28 },
  },
  {
    id: 'm16', name: 'M16 · RIFT MOD', model: 'm16', key: 'Digit2',
    auto: true, fireInterval: 0.095, damage: 22, critMult: 2.2,
    magSize: 30, reserve: 180, reloadTime: 1.6,
    spread: 0.012, adsSpread: 0.002, moveSpread: 0.03,
    recoil: { kick: 0.055, pitch: 0.014, yaw: 0.006, shake: 0.12 },
    scale: 0.62, rotY: Math.PI, pos: [0.2, -0.2, -0.42], adsPos: [0, -0.072, -0.36],
    muzzle: [0, 0.03, -0.3], adsFov: 52, tracer: 0x8fe8ff,
  },
  {
    id: 'ak', name: 'VK-47 · PERFORADOR', model: 'rifleHeavy', key: 'Digit3',
    auto: true, fireInterval: 0.16, damage: 46, critMult: 2.0,
    magSize: 20, reserve: 100, reloadTime: 2.1,
    spread: 0.018, adsSpread: 0.003, moveSpread: 0.04,
    recoil: { kick: 0.09, pitch: 0.03, yaw: 0.012, shake: 0.22 },
    scale: 0.6, rotY: Math.PI, pos: [0.22, -0.21, -0.44], adsPos: [0, -0.068, -0.36],
    muzzle: [0, 0.03, -0.32], adsFov: 48, tracer: 0xffc46b,
    material: { color: 0x4a4f58, metalness: 0.85, roughness: 0.32 },
  },
];

// ------------------------------------------------------------------ enemigos
// colors = paleta para los fragmentos de la explosión
export const ENEMY_TYPES = {
  trooper: {
    label: 'Pistolero', model: 'trooper', hp: 70, speed: 3.9, radius: 0.6, hitHeight: 2.0,
    behavior: 'ranged', range: 17, fireInterval: 1.8, burst: 1, projSpeed: 17, damage: 7,
    score: 100, colors: [0x9aa3b5, 0x5c6274, 0xd94b4b, 0xffb347],
  },
  hound: {
    label: 'Coyote', model: 'hound', hp: 45, speed: 6.4, radius: 0.45, hitHeight: 1.15,
    behavior: 'melee', meleeRange: 1.7, meleeDamage: 11, meleeInterval: 0.85,
    score: 120, colors: [0x3a3f4b, 0xd58a2f, 0x6b7280, 0xff5a3c],
  },
  wasp: {
    label: 'Buitre', model: 'wasp', hp: 40, speed: 4.6, radius: 0.55, hitHeight: 1.3, fly: 2.4,
    behavior: 'ranged', range: 19, fireInterval: 1.25, burst: 1, projSpeed: 21, damage: 6, strafe: true,
    score: 150, colors: [0xf2c14e, 0x2e2e38, 0xd94b4b, 0xc0c4cc],
  },
  titan: {
    label: 'Sheriff de Hierro', model: 'titan', hp: 650, speed: 1.9, radius: 1.25, hitHeight: 3.1,
    behavior: 'ranged', range: 24, fireInterval: 2.5, burst: 5, burstSpread: 0.22, projSpeed: 13, damage: 13,
    score: 1000, boss: true, colors: [0x4b3a78, 0xe8b04a, 0xbfc3cc, 0xff4040],
  },
};

// ------------------------------------------------------------------ rondas
export const WAVES = {
  firstDelay: 3,          // cuenta atrás antes de la ronda 1
  intermission: 5,        // descanso entre rondas
  budget: (w) => 4 + w * 3,
  maxAlive: (w) => Math.min(3 + w, 16),
  spawnInterval: (w) => Math.max(0.45, 2.1 - w * 0.15),
  hpMult: (w) => 1 + 0.12 * (w - 1),
  speedMult: (w) => Math.min(1.45, 1 + 0.04 * (w - 1)),
  fireRateMult: (w) => Math.max(0.55, 1 - 0.05 * (w - 1)), // multiplica el intervalo de disparo
  // coste en presupuesto y ronda a partir de la que aparece cada tipo
  roster: [
    { type: 'trooper', cost: 1, from: 1, weight: 5 },
    { type: 'hound', cost: 1, from: 2, weight: 3 },
    { type: 'wasp', cost: 2, from: 3, weight: 2 },
  ],
  titanEvery: 5,          // cada N rondas aparece un Titán (más uno extra cada 2 ciclos)
  minSpawnDist: 11,
};

export const PICKUPS = {
  dropChance: 0.16,        // probabilidad de soltar una bala dorada (el Titán siempre suelta)
  heal: 20,
  ammoMags: 2,             // cargadores extra que da a cada arma
  lifetime: 22,
};

// ------------------------------------------------------------------ decorado del desierto
// type: modelo · x,z en metros · rot en grados · s escala · r radio de colisión (0 = sin colisión)
// legs: colisionadores extra (arcos de roca: se puede pasar por debajo)
export const PROPS = [
  { type: 'statue', x: 40, z: 40, rot: 200, s: 2.4, r: 1.5, pedestal: true },
  { type: 'arch', x: 40, z: 9.5, rot: 0, s: 1.8, r: 0, legs: [[-2.9, 0, 0.9], [2.9, 0, 0.9]] },
  { type: 'arch', x: 40, z: 70.5, rot: 180, s: 1.8, r: 0, legs: [[-2.9, 0, 0.9], [2.9, 0, 0.9]] },
  { type: 'rock', x: 14, z: 40, rot: 30, s: 1.3, r: 0.95 },
  { type: 'rock', x: 66, z: 40, rot: 200, s: 1.3, r: 0.95 },
  { type: 'rock', x: 43.5, z: 26, rot: 90, s: 1.0, r: 0.75 },
  { type: 'rock', x: 34, z: 54, rot: 300, s: 1.0, r: 0.75 },
  { type: 'stones', x: 26, z: 62, rot: 20, s: 1, r: 1.2 },
  { type: 'stones', x: 54, z: 18, rot: 200, s: 1, r: 1.2 },
  { type: 'stones', x: 9.5, z: 70, rot: 120, s: 0.8, r: 1.0 },
  { type: 'stones', x: 70.5, z: 10, rot: 300, s: 0.8, r: 1.0 },
];
// Faroles (luz real cálida). Número fijo para no recompilar shaders.
export const LANTERNS = [[9.6, 9.6], [70.4, 9.6], [9.6, 70.4], [70.4, 70.4]];
