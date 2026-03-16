import { Game } from './Game.js';

const game = new Game();
window.__wuxiaGame = game;
window.runSelfPlayTournament = async (options = {}) => {
  console.log('[selfplay] tournament requested', options);
  const { SelfPlayRunner } = await import('./sim/SelfPlayRunner.js');
  const runner = new SelfPlayRunner();
  const result = await runner.runTournament(options);
  console.log('[selfplay] tournament completed', result?.summary);
  return result;
};

game.init().catch(err => {
  console.error('Failed to initialize game:', err);
  document.body.innerHTML = `<div style="color:red;padding:20px;font-family:monospace">
    Failed to initialize: ${err.message}
  </div>`;
});
