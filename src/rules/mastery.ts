import type { SkillTable } from "../schema/defs/skill-table";

/**
 * 숙련도에서 나오는 점수 (명세서 「숙련도·나무·재능」).
 * 남은 점수는 저장하지 않고 늘 계산한다: 숙련도에서 나온 점수 − 쓴 점수.
 */
export function branchPoints(table: SkillTable, mastery: number, talentBonus = 0): number {
  return Math.floor(mastery / table.tree.masteryPerBranchPoint) + talentBonus;
}

export function rootPoints(table: SkillTable, mastery: number): number {
  return Math.floor(mastery / table.tree.masteryPerRootPoint);
}
