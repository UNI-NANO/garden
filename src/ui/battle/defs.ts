import rawBattle from "../../../data/defs/battle.json";
import rawEffects from "../../../data/defs/effects.json";
import rawEnemies from "../../../data/defs/enemies.json";
import rawTable from "../../../data/defs/skill-table.json";
import rawSword from "../../../data/defs/trees/sword.json";
import { effectDefs } from "../../rules/battle/effects";
import type { BattleContext } from "../../rules/battle/engine";
import type { PracticeDefs } from "../../rules/battle/practice";
import { BattleRulesSchema, EnemyListSchema } from "../../schema/defs/battle";
import { EffectListSchema } from "../../schema/defs/effect";
import { SkillTableSchema } from "../../schema/defs/skill-table";
import { TreeSchema } from "../../schema/defs/tree";
import { describeEffect } from "./effect-text";

export interface BattleDefs {
  practice: PracticeDefs;
  ctx: BattleContext;
  /** 효과 ID → 이름 */
  effectNames: ReadonlyMap<string, string>;
  /** 효과 ID → 한 줄 설명 */
  effectInfo: ReadonlyMap<string, string>;
}

/** 전투에 쓰는 정의 데이터를 읽고 스키마 검사를 한다. 실패하면 던진다(화면이 안내를 띄운다) */
export function loadBattleDefs(): BattleDefs {
  const battle = BattleRulesSchema.parse(rawBattle);
  const skillTable = SkillTableSchema.parse(rawTable);
  const effects = EffectListSchema.parse(rawEffects).effects;
  const practice: PracticeDefs = { skillTable, effects, battle, enemies: EnemyListSchema.parse(rawEnemies).enemies, tree: TreeSchema.parse(rawSword) };
  return {
    practice,
    ctx: { rules: battle, table: skillTable, effects: effectDefs(effects) },
    effectNames: new Map(effects.map((e) => [e.id, e.name])),
    effectInfo: new Map(effects.map((e) => [e.id, describeEffect(e, (id) => effects.find((x) => x.id === id)?.name ?? id)])),
  };
}
