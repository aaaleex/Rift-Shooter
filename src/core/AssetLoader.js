import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Carga TODOS los assets del juego a través de un único THREE.LoadingManager.
 * Informa del progreso real (ítems completados + bytes de los que están en vuelo)
 * para que el menú muestre una barra de carga fiable.
 */
export class AssetLoader {
  constructor(manifest, renderer) {
    this.manifest = manifest;
    this.renderer = renderer;
    this.manager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);

    this.textures = {};
    this.models = {};
    this.onProgress = () => {};
    this._partial = new Map(); // url -> fracción 0..1 de los archivos en descarga
    this._done = 0;
    this._total = 0;
  }

  _emit(url) {
    let inflight = 0;
    for (const f of this._partial.values()) inflight += f;
    const pct = this._total ? Math.min(1, (this._done + inflight) / this._total) : 0;
    this.onProgress(pct, url);
  }

  _track(url) {
    return (e) => {
      if (e && e.lengthComputable && e.total) {
        this._partial.set(url, e.loaded / e.total);
        this._emit(url);
      }
    };
  }

  load() {
    const { textures, models } = this.manifest;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const jobs = [];

    this.manager.onLoad = () => this.onProgress(1, '');
    this.manager.onProgress = (url, loaded, total) => {
      this._done = loaded;
      this._total = Math.max(this._total, total);
      this._partial.delete(url);
      this._emit(url);
    };

    for (const [key, url] of Object.entries(textures)) {
      this._total++;
      jobs.push(new Promise((resolve, reject) => {
        this.textureLoader.load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = maxAniso;
          this.textures[key] = tex;
          resolve();
        }, undefined, (err) => reject(new Error(`No se pudo cargar ${url}`)));
      }));
    }

    for (const [key, url] of Object.entries(models)) {
      this._total++;
      jobs.push(new Promise((resolve, reject) => {
        this.gltfLoader.load(url, (gltf) => {
          this.models[key] = gltf.scene;
          resolve();
        }, this._track(url), () => reject(new Error(`No se pudo cargar ${url}`)));
      }));
    }

    return Promise.all(jobs).then(() => this);
  }
}
