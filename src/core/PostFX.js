import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Cadena de post-procesado:
 *   1. RenderPass  -> mundo
 *   2. RenderPass  -> arma en primera persona (escena aparte, limpia el depth: nunca atraviesa paredes)
 *   3. UnrealBloomPass -> solo brilla lo que supera el umbral (emisivos HDR: ojos, neones, balas)
 *   4. OutputPass  -> tone mapping ACES + sRGB
 */
export class PostFX {
  constructor(renderer, worldScene, viewmodelScene, camera, samples = 4) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();

    // Render target HDR (HalfFloat) con MSAA: antialiasing real aunque haya post-procesado
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.worldPass = new RenderPass(worldScene, camera);
    this.viewPass = new RenderPass(viewmodelScene, camera);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.75, 0.45, 0.82);
    this.output = new OutputPass();

    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  setCamera(camera) {
    this.worldPass.camera = camera;
    this.viewPass.camera = camera;
  }

  setViewmodelVisible(v) { this.viewPass.enabled = v; }
  setBloom(enabled) { this.bloom.enabled = enabled; }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) { this.composer.render(dt); }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
