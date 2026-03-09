export class ScreenEffects {
  constructor() {
    this.flashEl = document.getElementById('screen-flash');
    this.vignetteEl = document.getElementById('kill-vignette');
    this.linesEl = document.getElementById('kill-lines');
    this.killTextEl = document.getElementById('kill-text');
    this.shakeOffset = { x: 0, y: 0 };
    this.hitstopFrames = 0;
    this.onHitstop = false;
    this._linesBuilt = false;
  }

  flash(color = 'white', duration = 0.1) {
    if (!this.flashEl) return;
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = '0.6';
    this.flashEl.style.transition = 'none';

    requestAnimationFrame(() => {
      this.flashEl.style.transition = `opacity ${duration}s ease-out`;
      this.flashEl.style.opacity = '0';
    });
  }

  flashRed() {
    this.flash('rgba(180, 20, 20, 0.5)', 0.3);
  }

  flashWhite() {
    this.flash('rgba(255, 255, 255, 0.4)', 0.15);
  }

  startHitstop(frames) {
    this.hitstopFrames = frames;
    this.onHitstop = true;
  }

  update() {
    if (this.hitstopFrames > 0) {
      this.hitstopFrames--;
      this.onHitstop = true;
    } else {
      this.onHitstop = false;
    }
    return this.onHitstop;
  }

  // --- Kill cam effects ---

  startKillEffects() {
    // Big white flash first
    this.flash('rgba(255, 255, 255, 0.8)', 0.5);

    // Vignette
    if (this.vignetteEl) this.vignetteEl.classList.add('active');

    // Speed lines
    this._buildSpeedLines();
    if (this.linesEl) this.linesEl.classList.add('active');

    // Kill text appears after a beat
    if (this.killTextEl) {
      this.killTextEl.classList.remove('active');
      setTimeout(() => {
        if (this.killTextEl) this.killTextEl.classList.add('active');
      }, 200);
      // Fade out after a while
      setTimeout(() => {
        if (this.killTextEl) this.killTextEl.classList.remove('active');
      }, 2000);
    }
  }

  stopKillEffects() {
    if (this.vignetteEl) this.vignetteEl.classList.remove('active');
    if (this.linesEl) this.linesEl.classList.remove('active');
    if (this.killTextEl) this.killTextEl.classList.remove('active');
  }

  _buildSpeedLines() {
    if (!this.linesEl) return;
    // Only build once
    if (this._linesBuilt) return;
    this._linesBuilt = true;

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const count = 40;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const line = document.createElement('div');
      line.className = 'line';

      // Random length and distance from center
      const innerDist = 200 + Math.random() * 150;
      const length = 200 + Math.random() * 400;
      const width = 1 + Math.random() * 2;

      const x = cx + Math.cos(angle) * (innerDist + length / 2) - length / 2;
      const y = cy + Math.sin(angle) * (innerDist + length / 2) - width / 2;

      line.style.width = `${length}px`;
      line.style.height = `${width}px`;
      line.style.left = `${x}px`;
      line.style.top = `${y}px`;
      line.style.transform = `rotate(${angle}rad)`;
      line.style.opacity = 0.08 + Math.random() * 0.12;

      this.linesEl.appendChild(line);
    }
  }

  reset() {
    this.hitstopFrames = 0;
    this.onHitstop = false;
    if (this.flashEl) this.flashEl.style.opacity = '0';
    this.stopKillEffects();
  }
}
