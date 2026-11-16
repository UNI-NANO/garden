import type { BattleRules, Enemy } from "../../schema/defs/battle";
import type { DamageType } from "../../schema/defs/skill";
import type { Judgement, SkillTable } from "../../schema/defs/skill-table";

/** 플레이어의 최대 체력 = 기본 + 건강 × 계수 (내림) */
export function playerMaxHp(rules: BattleRules, health: number): number {
  return Math.floor(rules.player.hpBase + health * rules.player.hpPerHealth);
}

/** 숙련도가 위력에 곱하는 값 */
export function masteryMultiplier(rules: BattleRules, mastery: number): number {
  return 1 + mastery * rules.player.powerPerMastery;
}

/**
 * 판정 칸의 폭 (바 길이 기준). 좋음 칸 안에 완벽 칸이 있고, 좋음 칸 양옆이 보통 칸이다.
 * `modifiers`는 효과가 바꾸는 값(집중·위압·공포·침식)이다. 화면이 바를 그릴 때 쓴다.
 */
export function judgementWidths(
  rules: BattleRules,
  mastery: number,
  modifiers: { goodWidth: number; shake: number; noPerfect: boolean; perfectWidth?: number } = { goodWidth: 0, shake: 0, noPerfect: false },
): { perfect: number; good: number; normalEachSide: number; shake: number } {
  const bar = rules.judgementBar;
  const good = Math.min(bar.length, Math.max(0, bar.goodBase + mastery * bar.goodPerMastery + modifiers.goodWidth));
  return {
    good,
    // 완벽 칸은 좋음 칸 안에 있으므로 좋음 칸보다 넓어지지 않는다
    perfect: modifiers.noPerfect ? 0 : Math.min(good, Math.max(0, good * bar.perfectShare + (modifiers.perfectWidth ?? 0))),
    normalEachSide: Math.min((bar.length - good) / 2, good * bar.normalShareEachSide),
    shake: modifiers.shake,
  };
}

/** 적의 숫자: 카드에 직접 적은 값이 있으면 그 값, 없으면 등급 공식 */
export function enemyNumbers(rules: BattleRules, enemy: Enemy): { maxHp: number; maxStagger: number; power: number } {
  const elite = enemy.rank !== "일반";
  const e = rules.enemy;
  const maxHp = enemy.overrides?.hp ?? Math.round((e.hpBase + e.hpPerTier * enemy.tier) * (elite ? e.eliteHpMultiplier : 1));
  return {
    maxHp,
    maxStagger: enemy.overrides?.stagger ?? Math.round(maxHp * e.staggerShare),
    power: enemy.overrides?.power ?? e.powerBase + e.powerPerTier * enemy.tier + (elite ? e.elitePowerAdd : 0),
  };
}

/** 한 타의 위력 = 타 위력 × 판정 배율 × 그 밖의 배율들 */
export function hitPower(table: SkillTable, baseHitPower: number, judgement: Judgement, ...multipliers: number[]): number {
  let power = baseHitPower * table.judgement[judgement];
  for (const m of multipliers) power *= m;
  return power;
}

/**
 * 피해 = (위력 × 저항 배율 − 방어) × 받는 피해 배율, 반올림. 위력이 0이면(빗나감) 0, 맞으면 최소 1.
 */
export function damageOf(power: number, resistMultiplier: number, defense: number, takenMultiplier = 1): number {
  if (power <= 0) return 0;
  return Math.max(1, Math.round((power * resistMultiplier - defense) * takenMultiplier));
}

/** 흐트러짐 피해 = 위력 × 타입 계수 */
export function staggerDamageOf(rules: BattleRules, power: number, damageType: DamageType): number {
  return power * rules.stagger.typeMultiplier[damageType];
}
