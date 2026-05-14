import { defineCharacterRegistry } from './shared/characterContract.js';
import { spearman } from './spearman.js';
import { ronin } from './ronin.js';
import { knight } from './knight.js';
import { huscarl } from './huscarl.js';

export const DEFAULT_CHAR = 'spearman';

export const CHARACTER_DEFS = defineCharacterRegistry({
  spearman,
  ronin,
  knight,
  huscarl,
}, DEFAULT_CHAR);
