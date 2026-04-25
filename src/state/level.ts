// XP curve and level lookup per docs/12_progression_system.md.
//
//   xpRequired(level) = BASE_XP * level^EXPONENT
//
// Level is the band the player is currently in (level 1 = 0..xpRequired(1)).
// We compute it from cumulative XP each time a stat changes; recomputing is
// trivial for the level cap range we care about (≤50) and keeps Player free
// of cached state that could drift from save data.

const BASE_XP = 100;
const EXPONENT = 1.6;
const MAX_LOOKUP_LEVEL = 100;

export function xpRequiredForLevel(level: number): number {
  if (level <= 0) return 0;
  return Math.round(BASE_XP * level ** EXPONENT);
}

// Cumulative XP threshold to *enter* `level`. Level 1 starts at 0; level 2
// starts at xpRequired(1); etc.
export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let i = 1; i < level; i++) total += xpRequiredForLevel(i);
  return total;
}

export function levelForXp(xp: number): number {
  if (xp < 0) return 1;
  let level = 1;
  let consumed = 0;
  while (level < MAX_LOOKUP_LEVEL) {
    const next = xpRequiredForLevel(level);
    if (consumed + next > xp) return level;
    consumed += next;
    level++;
  }
  return MAX_LOOKUP_LEVEL;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const start = xpThresholdForLevel(level);
  const xpIntoLevel = Math.max(0, xp - start);
  const xpForNextLevel = xpRequiredForLevel(level);
  return { level, xpIntoLevel, xpForNextLevel };
}
