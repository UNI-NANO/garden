import type { Effect, EffectDecay } from "../../schema/defs/effect";
import type { Judgement, SkillTable } from "../../schema/defs/skill-table";

/**
 * 효과 계산. 효과는 "효과 ID → 중첩 수"로 들고 다닌다.
 * 무엇을 하는지는 효과 카드의 규칙(rule.kind)이 정하고, 여기서는 이름을 보지 않는다.
 */
export type EffectStacks = Record<string, number>;
export type EffectDefs = ReadonlyMap<string, Effect>;

export function effectDefs(effects: readonly Effect[]): EffectDefs {
  return new Map(effects.map((effect) => [effect.id, effect]));
}

/** 지금 걸려 있는 효과와 그 카드 */
function* active(defs: EffectDefs, stacks: EffectStacks): Generator<[Effect, number]> {
  for (const [id, count] of Object.entries(stacks)) {
    const def = defs.get(id);
    if (def !== undefined && count > 0) yield [def, count];
  }
}

/** 지금 걸린 효과가 막아 주는 효과들 */
function immunities(defs: EffectDefs, stacks: EffectStacks): Set<string> {
  const blocked = new Set<string>();
  for (const [def] of active(defs, stacks)) {
    if (def.rule.kind === "면역") for (const id of def.rule.effects) blocked.add(id);
  }
  return blocked;
}

/**
 * 효과를 붙인다. 최대 중첩에서 멈추고, 면역이면 붙지 않는다.
 * 면역 효과가 새로 붙으면 이미 걸려 있던 그 효과들도 사라진다. 실제로 붙은 중첩 수를 돌려준다.
 */
export function addEffect(defs: EffectDefs, stacks: EffectStacks, id: string, amount: number, alwaysImmune: readonly string[] = []): number {
  const def = defs.get(id);
  if (def === undefined || amount <= 0) return 0;
  if (alwaysImmune.includes(id) || immunities(defs, stacks).has(id)) return 0;
  const before = stacks[id] ?? 0;
  const after = Math.min(def.max, before + Math.floor(amount));
  if (after > 0) stacks[id] = after;
  if (def.rule.kind === "면역") for (const blocked of def.rule.effects) delete stacks[blocked];
  return after - before;
}

/** 줄어드는 때가 `when`인 효과를 줄인다 */
export function decayEffects(defs: EffectDefs, stacks: EffectStacks, when: Exclude<EffectDecay, "줄지 않음" | "턴 끝 절반" | "턴 끝 모두" | "턴 끝 −1"> | "턴 끝"): void {
  for (const [def, count] of [...active(defs, stacks)]) {
    let next = count;
    if (when === "턴 끝") {
      if (def.decay === "턴 끝 −1") next = count - 1;
      else if (def.decay === "턴 끝 절반") next = Math.floor(count / 2);
      else if (def.decay === "턴 끝 모두") next = 0;
    } else if (def.decay === when) {
      next = count - 1;
    }
    if (next <= 0) delete stacks[def.id];
    else stacks[def.id] = next;
  }
}

/** 턴 끝에 받는 지속 피해의 합 */
export function ongoingDamage(defs: EffectDefs, stacks: EffectStacks): number {
  let total = 0;
  for (const [def, count] of active(defs, stacks)) if (def.rule.kind === "지속 피해") total += count;
  return total;
}

/**
 * 주는 위력에 곱하는 값.
 * - 치는 쪽의 "주는 위력"(사기)
 * - 치는 쪽이 적이면: 자기에게 걸린 공포, 맞는 쪽이 가진 위압
 */
export function powerMultiplier(defs: EffectDefs, attacker: EffectStacks, defender: EffectStacks, attackerIsEnemy: boolean): number {
  let pct = 0;
  for (const [def, count] of active(defs, attacker)) {
    if (def.rule.kind === "주는 위력") pct += def.rule.perStack * count;
    if (attackerIsEnemy && def.rule.kind === "공포") pct += def.rule.enemyPowerPerStack * count;
  }
  if (attackerIsEnemy) {
    for (const [def, count] of active(defs, defender)) {
      if (def.rule.kind === "위압") pct += def.rule.enemyPowerPerStack * count;
    }
  }
  return Math.max(0, 1 + pct);
}

/** 맞을 때 받는 피해에 더하는 값 (취약은 +, 수호는 −) */
export function damageTakenBonus(defs: EffectDefs, defender: EffectStacks): number {
  let bonus = 0;
  for (const [def, count] of active(defs, defender)) if (def.rule.kind === "받는 피해") bonus += def.rule.perStack * count;
  return bonus;
}

/** 판정을 고친다: 완벽 칸이 사라졌으면 완벽으로 쳐도 좋음 */
export function adjustJudgement(defs: EffectDefs, attacker: EffectStacks, judgement: Judgement): Judgement {
  if (judgement !== "완벽") return judgement;
  for (const [def] of active(defs, attacker)) if (def.rule.kind === "완벽 없음") return "좋음";
  return judgement;
}

/** 판정 배율. '보통'은 자신감이 있으면 올라간다 */
export function judgementMultiplier(defs: EffectDefs, table: SkillTable, attacker: EffectStacks, judgement: Judgement): number {
  const base = table.judgement[judgement];
  if (judgement !== "보통") return base;
  let value = base;
  for (const [def, count] of active(defs, attacker)) {
    if (def.rule.kind === "보통 배율") value = Math.max(value, Math.min(def.rule.max, value + def.rule.addPerStack * count));
  }
  return value;
}

/** 판정 바를 그릴 때 화면이 쓰는 값: 좋음 칸의 폭에 더할 값, 흔들림의 폭, 완벽 칸이 없는지 */
export function barModifiers(defs: EffectDefs, attacker: EffectStacks, target: EffectStacks): { goodWidth: number; shake: number; noPerfect: boolean } {
  let goodWidth = 0;
  let shake = 0;
  let noPerfect = false;
  for (const [def, count] of active(defs, attacker)) {
    if (def.rule.kind === "좋음 칸") goodWidth += def.rule.widthPerStack * count;
    if (def.rule.kind === "공포") shake += def.rule.barShakePerStack * count;
    if (def.rule.kind === "완벽 없음") noPerfect = true;
  }
  for (const [def, count] of active(defs, target)) {
    if (def.rule.kind === "위압") goodWidth += def.rule.attackerWidthPerStack * count;
  }
  return { goodWidth, shake, noPerfect };
}

/** 움직일 수 있는가 (자리 옮기기·도망·피하기) */
export function canMove(defs: EffectDefs, stacks: EffectStacks): boolean {
  for (const [def] of active(defs, stacks)) if (def.rule.kind === "움직임 불가") return false;
  return true;
}

/** 턴 끝에 쿨다운이 더 줄어드는 양 */
export function extraCooldown(defs: EffectDefs, stacks: EffectStacks): number {
  let amount = 0;
  for (const [def] of active(defs, stacks)) if (def.rule.kind === "쿨다운 더 줄임") amount = Math.max(amount, def.rule.amount);
  return amount;
}

/**
 * 쓰러질 한 방을 버틴다. 버틸 효과가 있으면 그 효과를 하나 쓰고 남는 체력을 돌려준다. 없으면 undefined.
 */
export function endure(defs: EffectDefs, stacks: EffectStacks): number | undefined {
  for (const [def, count] of active(defs, stacks)) {
    if (def.rule.kind !== "버티기") continue;
    if (count <= 1) delete stacks[def.id];
    else stacks[def.id] = count - 1;
    return def.rule.hpLeft;
  }
  return undefined;
}
