import * as THREE from 'three';

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this._setupLights();
    this._setupFog();
    this._setupParticles();
  }

  _setupLights() {
    // Hemisphere light (sky/ground)
    const hemi = new THREE.HemisphereLight(0x8888aa, 0x333322, 0.6);
    this.scene.add(hemi);

    // Main directional (sun-like, for shadows)
    const dir = new THREE.DirectionalLight(0xffeedd, 1.2);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 30;
    dir.shadow.camera.left = -12;
    dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12;
    dir.shadow.camera.bottom = -12;
    dir.shadow.bias = -0.00035;
    dir.shadow.normalBias = 0.008;
    this.scene.add(dir);

    // Rim light (from behind)
    const rim = new THREE.DirectionalLight(0x6688aa, 0.4);
    rim.position.set(-3, 5, -8);
    this.scene.add(rim);

    // Ambient fill
    const ambient = new THREE.AmbientLight(0x222233, 0.3);
    this.scene.add(ambient);
  }

  _setupFog() {
    this.scene.fog = new THREE.FogExp2(0x111118, 0.04);
    this.scene.background = new THREE.Color(0x111118);
  }

  _setupParticles() {
    // Floating dust / petal particles
    const count = 40;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = Math.random() * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      sizes[i] = Math.random() * 3 + 1;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xaa9977,
      size: 0.05,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  update(dt) {
    // Slowly drift particles
    if (this.particles) {
      const posAttr = this.particles.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i);
        y += dt * 0.1;
        if (y > 8) y = 0;
        posAttr.setY(i, y);

        let x = posAttr.getX(i);
        x += Math.sin(y * 0.5 + i) * dt * 0.05;
        posAttr.setX(i, x);
      }
      posAttr.needsUpdate = true;
    }
  }
}
