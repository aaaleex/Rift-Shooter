# Rift Shooter · Polvo y Plomo

FPS de arenas por rondas en el Salvaje Oeste (1879), en el navegador. HTML5 + CSS3 + JavaScript (ES Modules) + Three.js r160, sin paso de build.

## Ejecutar en local

```bash
npm start            # sirve la carpeta en http://localhost:3000
# o bien
python3 -m http.server 3000
```

No abras `index.html` con doble clic: con `file://` el navegador bloquea los módulos y las texturas.

## Estructura

```
index.html            capas: canvas, FX, HUD, pantallas (menú/pausa/fin)
styles.css            UI western (carteles de madera, SE BUSCA, grano de película, telégrafo)
main.js               Game: estados, pointer lock, bucle, combate, menú cinemático
src/config.js         TODO lo ajustable: mapa, armas, enemigos, rondas, pickups
src/core/             AssetLoader (LoadingManager), PostFX (bloom), CameraShake, Sfx (WebAudio)
src/world/            ArenaManager: arena, adobe con vigas, cañón, props, faroles, rodadoras, cielo de atardecer, flow field
src/Player.js         movimiento, salto, bob de cámara, regeneración
src/WeaponSystem.js   viewmodel 3D, apuntado, retroceso, dispersión, munición, recarga
src/Enemy.js          robots GLB con IA y animación procedural, hitbox de ojo = crítico
src/WaveManager.js    rondas, presupuesto por tipo, spawns fuera de la vista
src/Projectiles.js    plasma enemigo esquivable
src/fx/               Particles (InstancedMesh), Pickups (balas doradas)
src/ui/UI.js          HUD, anuncios, popups de daño, killfeed
assets/models         GLB optimizados (robots, M16, VK-47, bala dorada) + desert/ (revólver, acantilado, roca, piedras, arco, estatua)
assets/textures       atlas de robots + desert/ (arena, arenisca, piedra, roca; color y normal)
tools/export_assets.py  robots/armas .blend/.glb -> GLB web (Blender como módulo: pip install bpy)
tools/export_desert.py  pack del desierto (.obj/.stl/.blend) -> GLB web
```

## Controles

WASD moverse · Shift esprintar · Espacio saltar · Clic izq. disparar · Clic der. apuntar · R recargar · 1 revólver / 2 M16 / 3 VK-47 / rueda · ESC pausa

## Créditos y licencias

- Three.js (MIT) en `vendor/three/`.
- Fuentes Rye, Oswald y Special Elite (SIL OFL 1.1 / Apache 2.0) en `assets/fonts/`.
- Modelos y texturas: paquetes aportados por el autor del proyecto (Robot Enemy, Rifle M16 3D, All The Assault Rifles, Golden Bullet, pack del desierto de 3dexport: sand_01, bodes_stone, rock_03, cliff_rock, smallarch, Reichsrevolver M1879, amforma 442). Revisa la licencia de cada paquete antes de publicar.
