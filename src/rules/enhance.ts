import type { EnhanceDefs, EnhanceStep } from "../schema/defs/enhance";
import { createRng } from "./rng";

/**
 * 강화 (명세서 「가방·신선도·제작·강화」 → 강화, 강화표는 사용자 기획서). 모두 순수 함수, 씨앗으로 결과가 정해진다.
 * 성공 확률 = 표 + 연속 실패 × 보정. 실패하면 재료 전부와 돈 일부를 내고, 정한 단계부터는 일정 확률로 한 단계 내려간다.
 * 부적이 있으면 내려갈 때 하나를 써서 막는다. +10이 끝(그 너머는 유일물 단계에서).
 */

export const MAX_ENHANCE = 10;

export class EnhanceError extends Error {
  override name = "EnhanceError";
}

/** 지금 단계에서 다음 단계로 오를 때의 표 한 줄 */
export function nextStep(current: number, defs: EnhanceDefs): EnhanceStep {
  if (!Number.isInteger(current) || current < 0)
    throw new EnhanceError("잘못된 강화 단계");
  if (current >= MAX_ENHANCE) throw new EnhanceError("이미 +10이다");
  return defs.steps[current]!;
}

/** 다음 단계의 성공 확률 (%): 표 + 연속 실패 보정, 100을 넘지 않는다 */
export function successChance(
  current: number,
  failStreak: number,
  defs: EnhanceDefs,
): number {
  return Math.min(
    100,
    nextStep(current, defs).chance +
      Math.max(0, failStreak) * defs.fail.pityPerFail,
  );
}

/** 실패하면 내려갈 수 있는가 (그 단계를 노릴 때) */
export const canDrop = (current: number, defs: EnhanceDefs) =>
  current + 1 >= defs.fail.dropFrom && current > 0;

export interface EnhanceRoll {
  success: boolean;
  /** 결과 단계 */
  level: number;
  failStreak: number;
  /** 부적이 내려감을 막아 하나 썼다 */
  charmUsed: boolean;
  /** 실패해서 내려갔다 */
  dropped: boolean;
  /** 낸 돈 */
  money: number;
}

/**
 * 한 번 맡긴다. seed는 요청 ID(같은 요청이면 같은 결과 — 끊겨도 다시 굴릴 수 없다).
 * withCharm: 부적을 가지고 있고 쓰기로 했다(내려갈 때만 실제로 쓴다).
 */
export function enhanceRoll(
  seed: string,
  current: number,
  failStreak: number,
  withCharm: boolean,
  defs: EnhanceDefs,
): EnhanceRoll {
  const step = nextStep(current, defs);
  const rng = createRng(`${seed}:enhance`);
  const chance = successChance(current, failStreak, defs);
  if (rng.next() * 100 < chance)
    return {
      success: true,
      level: current + 1,
      failStreak: 0,
      charmUsed: false,
      dropped: false,
      money: step.money,
    };
  const money = Math.floor(step.money * defs.fail.moneyShare);
  const wouldDrop =
    canDrop(current, defs) && rng.next() * 100 < defs.fail.dropChance;
  if (wouldDrop && withCharm)
    return {
      success: false,
      level: current,
      failStreak: failStreak + 1,
      charmUsed: true,
      dropped: false,
      money,
    };
  return {
    success: false,
    level: wouldDrop ? current - 1 : current,
    failStreak: failStreak + 1,
    charmUsed: false,
    dropped: wouldDrop,
    money,
  };
}

/** 그 단계까지 오른 힘의 합 (%) */
export function totalPower(level: number, defs: EnhanceDefs): number {
  return defs.steps
    .slice(0, Math.max(0, Math.min(MAX_ENHANCE, level)))
    .reduce((sum, s) => sum + s.power, 0);
}

/** 보이는 이름: +10이면 「명장의」를 앞에, 단계가 있으면 뒤에 +n */
export function enhancedName(
  name: string,
  level: number,
  defs: EnhanceDefs,
): string {
  if (level <= 0) return name;
  return `${level >= MAX_ENHANCE ? `${defs.maxTitle} ` : ""}${name} +${level}`;
}
