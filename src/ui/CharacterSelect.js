import { CHARACTER_DEFS, DEFAULT_CHAR } from '../entities/CharacterDefs.js';

export class CharacterSelect {
  constructor() {
    this.el = document.getElementById('select-screen');
    this.onConfirm = null;

    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Char = DEFAULT_CHAR;
    this.p2Char = DEFAULT_CHAR;
    this.p1Container = document.getElementById('p1-char-options');
    this.p2Container = document.getElementById('p2-char-options');
    this.p2Heading = document.getElementById('p2-char-heading');

    this._setupButtons();
    this._buildCharButtons();
    this._updateOpponentLabel();
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
        this._updateOpponentLabel();
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

  _buildCharButtons() {
    if (!this.p1Container || !this.p2Container) return;

    const charIds = Object.keys(CHARACTER_DEFS);

    // Hide character section if only one character
    const section = this.p1Container.closest('.select-section');
    if (charIds.length <= 1 && section) {
      section.style.display = 'none';
      return;
    }

    this.p1Container.innerHTML = '';
    this.p2Container.innerHTML = '';
    for (const id of charIds) {
      const def = CHARACTER_DEFS[id];
      this.p1Container.appendChild(this._createCharButton(id, def.displayName, 1));
      this.p2Container.appendChild(this._createCharButton(id, def.displayName, 2));
    }
  }

  _createCharButton(id, label, playerIndex) {
    const btn = document.createElement('button');
    btn.className = 'select-btn';
    btn.dataset.char = id;
    btn.textContent = label.toUpperCase();

    const isActive = playerIndex === 1 ? id === this.p1Char : id === this.p2Char;
    if (isActive) btn.classList.add('active');

    btn.addEventListener('click', () => {
      const container = playerIndex === 1 ? this.p1Container : this.p2Container;
      container.querySelectorAll('.select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (playerIndex === 1) {
        this.p1Char = id;
      } else {
        this.p2Char = id;
      }
    });

    return btn;
  }

  _updateOpponentLabel() {
    if (!this.p2Heading) return;
    this.p2Heading.textContent = this.mode === 'ai' ? 'Computer Character' : 'Player 2 Character';
  }

  show() {
    this.el.style.display = 'flex';
  }

  hide() {
    this.el.style.display = 'none';
  }
}
