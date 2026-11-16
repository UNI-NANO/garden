import rawBattle from "../../data/defs/battle.json";
import rawEffects from "../../data/defs/effects.json";
import rawEnemies from "../../data/defs/enemies.json";
import rawTable from "../../data/defs/skill-table.json";
import rawSword from "../../data/defs/trees/sword.json";
import { buildSkill } from "../../src/rules/battle/build-skill";
import { effectDefs } from "../../src/rules/battle/effects";
import type { AllySetup, BattleContext, BattleSetup } from "../../src/rules/battle/engine";
import { treeBattleSkills } from "../../src/rules/battle/setup";
import { BattleRulesSchema, EnemyListSchema, type Enemy } from "../../src/schema/defs/battle";
import { EffectListSchema } from "../../src/schema/defs/effect";
import { SkillTableSchema } from "../../src/schema/defs/skill-table";
import { TreeSchema } from "../../src/schema/defs/tree";

export const rules = BattleRulesSchema.parse(rawBattle);
export const table = SkillTableSchema.parse(rawTable);
const effectList = EffectListSchema.parse(rawEffects).effects;
export const ctx: BattleContext = { rules, table, effects: effectDefs(effectList) };
const enemyDefs = EnemyListSchema.parse(rawEnemies).enemies;
export const swordTree = TreeSchema.parse(rawSword);
export const sword = treeBattleSkills(table, effectList, swordTree, "근접");

export const enemyDef = (id: string, over: Partial<Enemy> = {}): Enemy => {
  const def = enemyDefs.find((e) => e.id === id);
  if (!def) throw new Error(`적 없음: ${id}`);
  return { ...structuredClone(def), ...over };
};
export const skill = (id: string) => {
  const found = [sword.basicAttack, ...sword.basics].find((s) => s.id === id);
  if (!found) throw new Error(`기술 없음: ${id}`);
  return found;
};

/** 검술 숙련도 30 · 건강 50인 플레이어 (체력 55) */
export const hero = (over: Partial<AllySetup> = {}): AllySetup => ({
  id: "hero",
  name: "시험 플레이어",
  kind: "플레이어",
  slot: 0,
  health: 50,
  mastery: 30,
  basicAttack: sword.basicAttack,
  skills: [skill("sword.combo"), skill("sword.charge"), skill("sword.gale"), skill("sword.riposte")],
  ...over,
});

export const setup = (enemies: BattleSetup["enemies"], allies: AllySetup[] = [hero()], over: Partial<BattleSetup> = {}): BattleSetup => ({
  id: "b1",
  kind: "일반",
  seed: "씨앗",
  allies,
  enemies,
  ...over,
});

/** 칸을 찍은 검술 기술. picked에는 기본기 아래의 칸 ID를 적는다 (예: "a", "a.s1") */
export const built = (basicId: string, picked: string[] = [], choices: Record<string, 0 | 1> = {}) =>
  buildSkill(
    table,
    effectList,
    rules.words,
    swordTree,
    basicId,
    {
      picked: new Set(picked.map((id) => `${basicId}.${id}`)),
      choices: Object.fromEntries(Object.entries(choices).map(([id, side]) => [`${basicId}.${id}`, side])),
    },
    "근접",
  );
