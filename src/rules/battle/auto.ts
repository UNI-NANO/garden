import { reachable, rowOf } from "./formation";
import { canUseSkill, chainBonus, defenseKey, skillHitCount, skillHitPowers, type AllyAction, type BattleContext, type BattleSkill, type BattleState, type Defenses } from "./engine";

/**
 * 스스로 고르는 규칙 (명세서 「자동 전투」). 자동 전투, 동료, 시간 초과 때 함께 쓴다.
 * - 판정은 모두 "좋음"
 * - 쓸 수 있는 연계를 먼저, 그다음 위력이 가장 큰 기술
 * - 대상은 닿는 적 가운데 체력이 가장 낮은 쪽
 * - 합은 이길 수 있을 때만 건다
 */
export function autoAllyActions(state: BattleState, ctx: BattleContext): AllyAction[] {
  const actions: AllyAction[] = [];
  const enemies = state.enemies.filter((e) => !e.down);
  for (const ally of state.allies) {
    if (ally.down || ally.fled) continue;
    const usable = [ally.basicAttack, ...ally.skills]
      .filter((skill) => !skill.stance && canUseSkill(ally, skill))
      .filter((skill) => skill.reach === "원거리" || rowOf(ally.slot) === "앞줄");
    // 쓸 수 있는 연계를 먼저, 그다음 위력이 가장 큰 기술
    const score = (skill: BattleSkill) => skill.baseHitPower * skillHitCount(state, ally, skill, undefined) * (1 + chainBonus(state, ctx, ally, skill));
    const linked = usable.filter((skill) => chainBonus(state, ctx, ally, skill) > 0);
    const skill = (linked.length > 0 ? linked : usable).sort((a, b) => score(b) - score(a))[0];
    const target = skill ? [...reachable(enemies, skill.reach)].sort((a, b) => a.hp - b.hp || a.slot - b.slot)[0] : undefined;
    if (!skill || !target) {
      actions.push({ unitId: ally.id, type: "쉬기" });
      continue;
    }
    const judgements = Array.from({ length: skillHitCount(state, ally, skill, target) }, () => "좋음" as const);
    const mine = skillHitPowers(state, ctx, ally, skill, target, judgements).reduce((sum, p) => sum + p, 0);
    const intent = state.intents.find((i) => i.enemyId === target.id && !i.cancelled);
    actions.push({ unitId: ally.id, type: "기술", skillId: skill.id, targetId: target.id, judgements, clash: intent !== undefined && mine > intent.power });
  }
  return actions;
}

/** 적 차례에 어떻게 반응할지 */
export type DefensePolicy = "안 누름" | "자동" | "늘 막기";

/**
 * 반응을 정한다. "자동"은 체력이 기준 비율 이하일 때만 막는다(명세서 「자동 전투」: 체력 30% 이하면 막기).
 * 막기는 늘 성공하는 것으로 본다.
 */
export function autoDefenses(state: BattleState, ctx: BattleContext, policy: DefensePolicy): Defenses {
  const defenses: Defenses = {};
  if (policy === "안 누름") return defenses;
  for (const ally of state.allies) {
    if (ally.down || ally.fled) continue;
    const low = ally.hp <= ally.maxHp * ctx.rules.auto.guardBelowHpShare;
    if (policy === "늘 막기" || low) {
      for (const enemy of state.enemies) defenses[defenseKey(enemy.id, ally.id)] = "막기 성공";
    }
  }
  return defenses;
}
