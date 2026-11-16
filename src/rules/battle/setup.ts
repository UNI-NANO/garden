import type { Reach } from "../../schema/defs/battle";
import type { Effect } from "../../schema/defs/effect";
import type { SkillSpec } from "../../schema/defs/skill";
import type { SkillTable } from "../../schema/defs/skill-table";
import type { Tree } from "../../schema/defs/tree";
import { computeSkillNumbersFromSpec } from "../skill-table";
import type { BattleSkill } from "./engine";

/** 기술 항목에서 전투용 기술을 만든다. 숫자는 기술 기준표가 계산한다 */
export function battleSkillOf(
  table: SkillTable,
  effects: readonly Effect[],
  card: { id: string; name: string; skill: SkillSpec },
  reach: Reach,
): BattleSkill {
  const numbers = computeSkillNumbersFromSpec(table, effects, card.skill);
  return {
    id: card.id,
    name: card.name,
    tier: card.skill.tier,
    baseHitPower: numbers.hitPower,
    hitCount: numbers.hitCount,
    cooldown: numbers.cooldown,
    energy: numbers.energy,
    range: card.skill.range,
    damageType: card.skill.damageType,
    reach,
    stance: card.skill.hits === "자세",
  };
}

/** 나무의 기본 공격과 기본기(기본 모양)를 전투용 기술로. 갈래·보완 칸은 아직 반영하지 않는다 */
export function treeBattleSkills(table: SkillTable, effects: readonly Effect[], tree: Tree, reach: Reach): { basicAttack: BattleSkill; basics: BattleSkill[] } {
  const basics: BattleSkill[] = [];
  for (const node of tree.nodes) {
    if (node.kind === "기본기" && node.skill) basics.push(battleSkillOf(table, effects, { id: node.id, name: node.name, skill: node.skill }, reach));
  }
  return { basicAttack: battleSkillOf(table, effects, tree.basicAttack, reach), basics };
}
