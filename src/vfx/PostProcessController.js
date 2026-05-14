import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const VISUAL_STYLE_PRESETS = Object.freeze({
  off: Object.freeze({
    bloomStrength: 0.0,
    bloomRadius: 0.0,
    bloomThreshold: 0.95,
    afterimageDamp: 0.0,
    saturation: 1.0,
    contrast: 1.0,
    exposure: 1.0,
    gamma: 1.0,
    posterize: 0.0,
    grain: 0.012,
    vignette: 0.12,
    edgeAmount: 0.0,
    edgeThreshold: 0.14,
    chroma: 0.0,
    scanline: 0.0,
    shadowTint: [1.0, 1.0, 1.0],
    highlightTint: [1.0, 1.0, 1.0],
    edgeColor: [0.0, 0.0, 0.0],
    paperStrength: 0.0,
    paperTint: [1.0, 1.0, 1.0],
    washStrength: 0.0,
  }),
  arcade_steel: Object.freeze({
    bloomStrength: 0.48,
    bloomRadius: 0.3,
    bloomThreshold: 0.72,
    afterimageDamp: 0.0,
    saturation: 1.08,
    contrast: 1.06,
    exposure: 1.0,
    gamma: 0.98,
    posterize: 0.0,
    grain: 0.015,
    vignette: 0.1,
    edgeAmount: 0.05,
    edgeThreshold: 0.14,
    chroma: 0.65,
    scanline: 0.0,
    shadowTint: [0.95, 0.98, 1.02],
    highlightTint: [1.03, 1.01, 0.97],
    edgeColor: [0.18, 0.18, 0.18],
    paperStrength: 0.0,
    paperTint: [1.0, 1.0, 1.0],
    washStrength: 0.0,
  }),
  ink_duel: Object.freeze({
    bloomStrength: 0.0,
    bloomRadius: 0.0,
    bloomThreshold: 0.95,
    afterimageDamp: 0.0,
    saturation: 0.92,
    contrast: 1.01,
    exposure: 1.08,
    gamma: 0.94,
    posterize: 0.0,
    grain: 0.003,
    vignette: 0.0,
    edgeAmount: 0.08,
    edgeThreshold: 0.12,
    chroma: 0.0,
    scanline: 0.0,
    shadowTint: [0.98, 0.985, 1.0],
    highlightTint: [1.03, 1.01, 0.98],
    edgeColor: [0.16, 0.13, 0.17],
    paperStrength: 0.24,
    paperTint: [0.98, 0.965, 0.93],
    washStrength: 0.22,
  }),
  dream_fever: Object.freeze({
    bloomStrength: 1.55,
    bloomRadius: 0.72,
    bloomThreshold: 0.56,
    afterimageDamp: 0.89,
    saturation: 1.1,
    contrast: 0.95,
    exposure: 1.0,
    gamma: 0.92,
    posterize: 0.0,
    grain: 0.028,
    vignette: 0.15,
    edgeAmount: 0.06,
    edgeThreshold: 0.13,
    chroma: 2.6,
    scanline: 0.0,
    shadowTint: [0.88, 0.95, 1.12],
    highlightTint: [1.05, 0.92, 1.06],
    edgeColor: [0.14, 0.1, 0.18],
    paperStrength: 0.0,
    paperTint: [1.0, 1.0, 1.0],
    washStrength: 0.0,
  }),
  crt_blood: Object.freeze({
    bloomStrength: 0.08,
    bloomRadius: 0.06,
    bloomThreshold: 0.88,
    afterimageDamp: 0.0,
    saturation: 0.95,
    contrast: 1.08,
    exposure: 1.0,
    gamma: 0.84,
    posterize: 0.0,
    grain: 0.018,
    vignette: 0.05,
    edgeAmount: 0.08,
    edgeThreshold: 0.14,
    chroma: 1.25,
    scanline: 0.14,
    shadowTint: [0.99, 0.98, 1.0],
    highlightTint: [1.03, 0.99, 0.99],
    edgeColor: [0.3, 0.22, 0.22],
    paperStrength: 0.0,
    paperTint: [1.0, 1.0, 1.0],
    washStrength: 0.0,
  }),
});

const VISUAL_STYLE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uExposure: { value: 1 },
    uGamma: { value: 1 },
    uPosterize: { value: 0 },
    uGrain: { value: 0.01 },
    uVignette: { value: 0.1 },
    uEdgeAmount: { value: 0 },
    uEdgeThreshold: { value: 0.1 },
    uChroma: { value: 0 },
    uScanline: { value: 0 },
    uShadowTint: { value: new THREE.Color(0xffffff) },
    uHighlightTint: { value: new THREE.Color(0xffffff) },
    uEdgeColor: { value: new THREE.Color(0x000000) },
    uPaperStrength: { value: 0 },
    uPaperTint: { value: new THREE.Color(0xffffff) },
    uWashStrength: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uExposure;
    uniform float uGamma;
    uniform float uPosterize;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uEdgeAmount;
    uniform float uEdgeThreshold;
    uniform float uChroma;
    uniform float uScanline;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform vec3 uEdgeColor;
    uniform float uPaperStrength;
    uniform vec3 uPaperTint;
    uniform float uWashStrength;
    varying vec2 vUv;

    float rosLuminance(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise2d(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
        mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    vec3 sampleColor(vec2 uv, vec2 centerOffset) {
      vec2 pixel = 1.0 / uResolution;
      vec2 shift = centerOffset * pixel;
      float r = texture2D(tDiffuse, uv + shift).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - shift).b;
      return vec3(r, g, b);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float distFromCenter = length(centered);
      vec2 chromaDir = distFromCenter > 0.0001 ? normalize(centered) : vec2(1.0, 0.0);
      vec2 chromaOffset = chromaDir * (uChroma * (0.5 + distFromCenter * 1.4));
      vec3 color = sampleColor(uv, chromaOffset);

      vec2 pixel = 1.0 / uResolution;
      float c = rosLuminance(texture2D(tDiffuse, uv).rgb);
      float n = rosLuminance(texture2D(tDiffuse, uv + vec2(0.0, pixel.y)).rgb);
      float s = rosLuminance(texture2D(tDiffuse, uv - vec2(0.0, pixel.y)).rgb);
      float e = rosLuminance(texture2D(tDiffuse, uv + vec2(pixel.x, 0.0)).rgb);
      float w = rosLuminance(texture2D(tDiffuse, uv - vec2(pixel.x, 0.0)).rgb);
      float edge = length(vec2(e - w, n - s));
      edge = smoothstep(uEdgeThreshold, uEdgeThreshold + 0.18, edge);

      float luma = rosLuminance(color);
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;

      vec3 shadowMix = mix(vec3(1.0), uShadowTint, clamp((1.0 - luma) * 0.95, 0.0, 1.0));
      vec3 highlightMix = mix(vec3(1.0), uHighlightTint, clamp(luma * 0.95, 0.0, 1.0));
      color *= shadowMix;
      color = mix(color, color * highlightMix, 0.48);
      color *= uExposure;

      if (uPaperStrength > 0.001 || uWashStrength > 0.001) {
        vec2 paperUv = uv * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
        float paperBroad = noise2d(paperUv * 7.0 + vec2(8.1, 3.7));
        float paperFine = noise2d(paperUv * 42.0 + vec2(17.0, 11.0));
        float paperFibers = noise2d(paperUv * vec2(12.0, 96.0) + vec2(2.7, 19.3));
        float paper = (paperBroad * 0.45 + paperFine * 0.35 + paperFibers * 0.20) - 0.5;
        vec3 papered = color * mix(vec3(1.0), uPaperTint, 0.34);
        papered *= 1.0 + paper * 0.12;
        color = mix(color, papered, clamp(uPaperStrength, 0.0, 1.0));

        float washNoise = noise2d(paperUv * 5.0 + vec2(31.0, 9.0));
        float washLuma = rosLuminance(color);
        vec3 washColor = mix(vec3(washLuma), color, 0.72);
        washColor *= 0.94 + washNoise * 0.10;
        color = mix(color, washColor, clamp(uWashStrength, 0.0, 1.0));
      }

      if (uPosterize > 1.0) {
        float levels = max(uPosterize, 2.0);
        color = floor(color * (levels - 1.0) + 0.5) / (levels - 1.0);
      }

      color = mix(color, uEdgeColor, clamp(edge * uEdgeAmount, 0.0, 1.0));

      float scan = 0.5 + 0.5 * sin((uv.y * uResolution.y * 0.72) + uTime * 10.0);
      color *= 1.0 - (scan * 0.14 + 0.02) * uScanline;

      float grain = (rand(uv + fract(uTime * 0.37)) - 0.5) * uGrain;
      color += grain;

      float vignette = smoothstep(0.28, 0.98, distFromCenter);
      color *= 1.0 - vignette * uVignette;

      color = pow(max(color, 0.0), vec3(uGamma));
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostProcessController {
  constructor(renderer) {
    this.renderer = renderer;
    this.styleId = 'off';
    this.time = 0;

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(null, null);
    this.bloomPass = new UnrealBloomPass(size, 0, 0, 1);
    this.afterimagePass = new AfterimagePass();
    this.stylePass = new ShaderPass(VISUAL_STYLE_SHADER);
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.afterimagePass);
    this.composer.addPass(this.stylePass);
    this.composer.addPass(this.outputPass);

    this.setStyle('off');
    this.onResize();
  }

  setStyle(styleId = 'off') {
    const preset = VISUAL_STYLE_PRESETS[styleId] ?? VISUAL_STYLE_PRESETS.off;
    this.styleId = styleId in VISUAL_STYLE_PRESETS ? styleId : 'off';

    this.bloomPass.enabled = preset.bloomStrength > 0.001;
    this.bloomPass.strength = preset.bloomStrength;
    this.bloomPass.radius = preset.bloomRadius;
    this.bloomPass.threshold = preset.bloomThreshold;

    this.afterimagePass.enabled = preset.afterimageDamp > 0.001;
    this.afterimagePass.uniforms.damp.value = preset.afterimageDamp;

    const uniforms = this.stylePass.uniforms;
    uniforms.uSaturation.value = preset.saturation;
    uniforms.uContrast.value = preset.contrast;
    uniforms.uExposure.value = preset.exposure;
    uniforms.uGamma.value = preset.gamma;
    uniforms.uPosterize.value = preset.posterize;
    uniforms.uGrain.value = preset.grain;
    uniforms.uVignette.value = preset.vignette;
    uniforms.uEdgeAmount.value = preset.edgeAmount;
    uniforms.uEdgeThreshold.value = preset.edgeThreshold;
    uniforms.uChroma.value = preset.chroma;
    uniforms.uScanline.value = preset.scanline;
    uniforms.uShadowTint.value.setRGB(...preset.shadowTint);
    uniforms.uHighlightTint.value.setRGB(...preset.highlightTint);
    uniforms.uEdgeColor.value.setRGB(...preset.edgeColor);
    uniforms.uPaperStrength.value = preset.paperStrength ?? 0;
    uniforms.uPaperTint.value.setRGB(...(preset.paperTint ?? [1, 1, 1]));
    uniforms.uWashStrength.value = preset.washStrength ?? 0;
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.composer.setSize(width, height);
    this.stylePass.uniforms.uResolution.value.set(width, height);
  }

  render(scene, camera, dt = 0) {
    this.time += dt;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.stylePass.uniforms.uTime.value = this.time;
    this.composer.render();
  }
}
