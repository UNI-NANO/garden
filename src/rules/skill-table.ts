import type { EffectWeight, Potency, Range, SkillTable, Tier } from "../schema/defs/skill-table";

/** 기술의 숫자를 정하는 항목. 숫자 자체는 적지 않는다. */
export interface SkillNumbersInput {
  tier: Tier;
  potency: Potency;
  /** 타수. 자세 기술은 "자세" (한 번의 반격으로 계산한다) */
  hits: number | "자세";
  range: Range;
  /** 붙은 효과들의 무게 */
  effectWeights: readonly EffectWeight[];
  /** 개성 보정. 위력에 곱하는 배율. 없으면 1 */
  personality?: number | undefined;
}

export interface SkillNumbers {
  /** 모든 타를 합친 위력 (판정 "좋음" 기준). 반올림하지 않는다 */
  totalPower: number;
  /** 한 타의 위력 */
  hitPower: number;
  hitCount: number;
  cooldown: number;
  energy: number;
}

export class SkillTableError extends Error {
  override name = "SkillTableError";
}

/** 기준표에 그 타수의 배율이 있는지. 자세는 1타로 본다. */
export function hitCountOf(hits: number | "자세"): number {
  return hits === "자세" ? 1 : hits;
}

export function hasHitMultiplier(table: SkillTable, hits: number | "자세"): boolean {
  return String(hitCountOf(hits)) in table.hits;
}

/**
 * 기준표로 기술의 숫자를 계산한다.
 * 총 위력 = 단계 위력 × 위력 성격 × 타수 배율 × 범위 × (1 − 효과 예산 합) × 개성 보정
 * 쿨다운 = 단계 쿨다운 + 위력 성격 가산 + 범위 가산
 */
export function computeSkillNumbers(table: SkillTable, input: SkillNumbersInput): SkillNumbers {
  const hitCount = hitCountOf(input.hits);
  const hitMultiplier = table.hits[String(hitCount)];
  if (!Number.isInteger(hitCount) || hitCount < 1 || hitMultiplier === undefined) {
    throw new SkillTableError(`기준표에 ${String(input.hits)}타의 배율이 없다`);
  }
  const personality = input.personality ?? 1;
  if (!(personality > 0)) {
    throw new SkillTableError(`개성 보정은 0보다 커야 한다 (${personality})`);
  }

  const tier = table.tiers[input.tier];
  const potency = table.potency[input.potency];
  const range = table.range[input.range];

  let budget = 0;
  for (const weight of input.effectWeights) budget += table.effectBudget[weight];
  const budgetMultiplier = Math.max(0, 1 - budget);

  const totalPower =
    tier.power * potency.multiplier * hitMultiplier * range.multiplier * budgetMultiplier * personality;

  return {
    totalPower,
    hitPower: totalPower / hitCount,
    hitCount,
    cooldown: Math.max(0, tier.cooldown + potency.cooldownAdd + range.cooldownAdd),
    energy: tier.energy,
  };
}

/** 기술 항목(SkillSpec)과 효과 목록으로 숫자를 계산한다. 없는 효과 ID는 오류. */
export function computeSkillNumbersFromSpec(
  table: SkillTable,
  effects: readonly { id: string; weight: EffectWeight }[],
  spec: {
    tier: Tier;
    potency: Potency;
    hits: number | "자세";
    range: Range;
    effects: readonly string[];
    personality?: number | undefined;
  },
): SkillNumbers {
  const effectWeights = spec.effects.map((id) => {
    const effect = effects.find((e) => e.id === id);
    if (effect === undefined) throw new SkillTableError(`없는 효과: ${id}`);
    return effect.weight;
  });
  return computeSkillNumbers(table, {
    tier: spec.tier,
    potency: spec.potency,
    hits: spec.hits,
    range: spec.range,
    effectWeights,
    personality: spec.personality,
  });
}
