import * as THREE from 'three';

export class Renderer {
  constructor() {
    this.renderer = null;
  }

  async init() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.body.prepend(this.renderer.domElement);

    window.addEventListener('resize', () => this.onResize());

    return this.renderer;
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  get domElement() {
    return this.renderer.domElement;
  }
}
