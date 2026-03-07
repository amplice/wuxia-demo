export class TitleScreen {
  constructor() {
    this.el = document.getElementById('title-screen');
    this.onStart = null;
    this.onAnimPlayer = null;
    this.onPoseBrowser = null;
    this._keyHandler = this._onKey.bind(this);

    document.getElementById('anim-player-btn').addEventListener('click', () => {
      if (this.onAnimPlayer) this.onAnimPlayer();
    });
    document.getElementById('pose-browser-btn').addEventListener('click', () => {
      if (this.onPoseBrowser) this.onPoseBrowser();
    });
  }

  show() {
    this.el.style.display = 'flex';
    window.addEventListener('keydown', this._keyHandler);
  }

  hide() {
    this.el.style.display = 'none';
    window.removeEventListener('keydown', this._keyHandler);
  }

  _onKey(e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.onStart) this.onStart();
    }
  }
}
