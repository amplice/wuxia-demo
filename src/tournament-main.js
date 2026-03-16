import { SelfPlayRunner } from './sim/SelfPlayRunner.js';

const statusEl = document.getElementById('status');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

window.runSelfPlayTournament = async (options = {}) => {
  console.log('[selfplay-page] tournament requested', options);
  setStatus('Running self-play tournament...');
  const runner = new SelfPlayRunner();
  const result = await runner.runTournament(options);
  console.log('[selfplay-page] tournament completed', result?.summary);
  setStatus('Tournament complete.');
  return result;
};

setStatus('Self-play harness ready.');
