import type { Character } from "../../schema/character";
import type { BattleRules } from "../../schema/defs/battle";
import type { Effect } from "../../schema/defs/effect";
import type { SkillTable } from "../../schema/defs/skill-table";
import type { Tree } from "../../schema/defs/tree";
import { idToKey, keyToId } from "../../schema/keys";
import { buildSkill, buildUltimate } from "./build-skill";
import type { AllySetup } from "./engine";
import { playerMaxHp } from "./numbers";
import { battleSkillOf } from "./setup";

/**
 * 캐릭터를 전투의 아군으로 (던전 등 실제 전투). 쓰는 것: 장착한 기본기·궁극기, 그 나무에서 찍은 칸, 그 나무의 숙련도, 건강.
 * 장비는 아직 없다. 지금 나무는 모두 근접이다.
 * 장착이 정의와 맞지 않으면 그 기술만 빼고 problems에 적는다(전투는 열린다).
 */

export interface AllyDefs {
  skillTable: SkillTable;
  effects: readonly Effect[];
  battle: BattleRules;
  trees: readonly Tree[];
}

export interface AllyResult {
  ally: AllySetup;
  problems: string[];
}

/** 장착한 기본기가 있는 나무, 없으면 찍은 나무, 없으면 첫 나무 */
function treeFor(character: Character, trees: readonly Tree[]): Tree {
  const first = character.loadout.basics[0];
  const byBasic = first ? trees.find((t) => t.nodes.some((n) => n.id === first)) : undefined;
  const byPicked = trees.find((t) => character.trees[idToKey(t.id)] !== undefined);
  const tree = byBasic ?? byPicked ?? trees[0];
  if (!tree) throw new Error("기술 나무 정의가 없다");
  return tree;
}

/** 던전을 시작할 때의 최대 체력·기력 */
export function allyVitals(character: Character, defs: Pick<AllyDefs, "battle" | "skillTable">): { maxHp: number; maxEnergy: number } {
  return { maxHp: playerMaxHp(defs.battle, character.abilities.health), maxEnergy: defs.skillTable.energy.max };
}

export function allyOfCharacter(character: Character, defs: AllyDefs, options: { hp?: number; energy?: number } = {}): AllyResult {
  const problems: string[] = [];
  const tree = treeFor(character, defs.trees);
  const saved = character.trees[idToKey(tree.id)];
  const picked = new Set([...Object.keys(saved?.picked ?? {})].map(keyToId));
  const choices: Record<string, 0 | 1> = {};
  for (const [key, side] of Object.entries(saved?.choices ?? {})) choices[keyToId(key)] = side;
  const words = defs.battle.words;

  const skills = character.loadout.basics.flatMap((basicId) => {
    try {
      return [buildSkill(defs.skillTable, defs.effects, words, tree, basicId, { picked, choices }, "근접")];
    } catch (error) {
      problems.push(`기본기 ${basicId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });

  let ultimate;
  const ultimateId = character.loadout.ultimate;
  if (ultimateId !== undefined) {
    try {
      ultimate = buildUltimate(defs.skillTable, defs.effects, words, tree, ultimateId, picked, "근접");
    } catch (error) {
      problems.push(`궁극기 ${ultimateId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ally: AllySetup = {
    id: "player",
    name: character.profile.name,
    kind: "플레이어",
    slot: 1,
    health: character.abilities.health,
    mastery: character.mastery[idToKey(tree.id)]?.value ?? 0,
    basicAttack: battleSkillOf(defs.skillTable, defs.effects, tree.basicAttack, "근접"),
    skills,
    ...(ultimate ? { ultimate } : {}),
    ...(options.hp !== undefined ? { hp: options.hp } : {}),
    ...(options.energy !== undefined ? { energy: options.energy } : {}),
  };
  return { ally, problems };
}
