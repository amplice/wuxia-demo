// Game states
export const GameState = {
  TITLE: 'title',
  SELECT: 'select',
  ROUND_INTRO: 'round_intro',
  FIGHTING: 'fighting',
  KILL_CAM: 'kill_cam',
  ROUND_END: 'round_end',
  VICTORY: 'victory',
  ANIM_PLAYER: 'anim_player',
};

// Fighter states
export const FighterState = {
  IDLE: 'idle',
  WALK_FORWARD: 'walk_forward',
  WALK_BACK: 'walk_back',
  SIDESTEP: 'sidestep',
  ATTACK_STARTUP: 'attack_startup',
  ATTACK_ACTIVE: 'attack_active',
  ATTACK_RECOVERY: 'attack_recovery',
  BLOCK: 'block',
  BLOCK_STUN: 'block_stun',
  PARRY: 'parry',
  PARRY_SUCCESS: 'parry_success',
  DODGE: 'dodge',
  HIT_STUN: 'hit_stun',
  PARRIED_STUN: 'parried_stun',
  DYING: 'dying',
  DEAD: 'dead',
  CLASH: 'clash',
};

// Attack types
export const AttackType = {
  QUICK: 'quick',
  HEAVY: 'heavy',
};

// Hit results
export const HitResult = {
  CLASH: 'clash',
  WHIFF: 'whiff',
  PARRIED: 'parried',
  BLOCKED: 'blocked',
  CLEAN_HIT: 'clean_hit',
};

// Weapon types
export const WeaponType = {
  JIAN: 'jian',
  DAO: 'dao',
  STAFF: 'staff',
};

// Timing constants (in frames at 60fps)
export const FRAME_RATE = 60;
export const FRAME_DURATION = 1 / FRAME_RATE;

export const PARRY_WINDOW_FRAMES = 5;
export const BLOCK_STUN_FRAMES = 12;
export const HIT_STUN_FRAMES = 25;
export const PARRIED_STUN_FRAMES = 20;
export const CLASH_PUSHBACK_FRAMES = 15;
export const KILL_DAMAGE = 1;

// Sidestep
export const SIDESTEP_DASH_FRAMES = 12;
export const SIDESTEP_DASH_DISTANCE = 1.4;
export const SIDESTEP_RECOVERY_FRAMES = 4;

// Backstep
export const BACKSTEP_FRAMES = 10;
export const BACKSTEP_DISTANCE = 1.5;
export const BACKSTEP_INVULN_FRAMES = 6;

// Block pushback
export const BLOCK_PUSHBACK_SPEED = 2.0;

// Movement
export const WALK_SPEED = 3.0;
export const ARENA_RADIUS = 8.0;
export const RING_OUT_RADIUS = 8.5;
export const FIGHT_START_DISTANCE = 4.0;

// Kill cam
export const KILL_SLOWMO_SCALE = 0.3;
export const KILL_SLOWMO_DURATION = 3.0;

// Match
export const ROUNDS_TO_WIN = 3;
export const ROUND_INTRO_DURATION = 2.0;
export const ROUND_END_DELAY = 1.5;

// Input buffer
export const INPUT_BUFFER_SIZE = 8;
export const INPUT_BUFFER_WINDOW = 6;
