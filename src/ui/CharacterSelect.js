export class CharacterSelect {
  constructor() {
    this.el = document.getElementById('select-screen');
    this.onConfirm = null;

    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Char = 'spear';
    this.p2Char = 'spear';

    this._setupButtons();
  }

  _setupButtons() {
    // Mode buttons
    document.querySelectorAll('#mode-options .select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#mode-options .select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        document.getElementById('difficulty-section').style.display =
          this.mode === 'ai' ? 'block' : 'none';
      });
    });

    // Difficulty buttons
    document.querySelectorAll('#difficulty-options .select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#difficulty-options .select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.difficulty = btn.dataset.diff;
      });
    });

    // Start button
    document.getElementById('start-fight-btn').addEventListener('click', () => {
      if (this.onConfirm) {
        this.onConfirm({
          mode: this.mode,
          difficulty: this.difficulty,
          p1Char: this.p1Char,
          p2Char: this.p2Char,
        });
      }
    });
  }

  show() {
    this.el.style.display = 'flex';
  }

  hide() {
    this.el.style.display = 'none';
  }
}
