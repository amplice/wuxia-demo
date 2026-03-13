export class TitleScreen {
  constructor() {
    this.el = document.getElementById('title-screen');
    this.onStart = null;
    this.onAnimPlayer = null;
    this.animPlayerBtn = document.getElementById('anim-player-btn');
    this._keyHandler = this._onKey.bind(this);
    this._bindButtons();
  }

  _bindButtons() {
    if (!this.animPlayerBtn) return;
    this.animPlayerBtn.addEventListener('click', () => {
      if (this.onAnimPlayer) this.onAnimPlayer();
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
    if (e.code === 'KeyP') {
      if (this.onAnimPlayer) this.onAnimPlayer();
    }
  }
}
