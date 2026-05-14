import * as THREE from 'three';

export class Renderer {
  constructor() {
    this.renderer = null;
    this.postProcessor = null;
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
    this.postProcessor?.onResize?.();
  }

  setPostProcessor(postProcessor) {
    this.postProcessor = postProcessor ?? null;
    this.postProcessor?.onResize?.();
  }

  render(scene, camera, dt = 0) {
    if (this.postProcessor) {
      this.postProcessor.render(scene, camera, dt);
      return;
    }
    this.renderer.render(scene, camera);
  }

  get domElement() {
    return this.renderer.domElement;
  }
}
