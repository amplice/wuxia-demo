export class TitleScreen {
  constructor() {
    this.el = document.getElementById('title-screen');
    this.onStart = null;
    this._keyHandler = this._onKey.bind(this);
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
