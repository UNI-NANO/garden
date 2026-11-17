import type { BattleRules, Enemy } from "../../schema/defs/battle";
import type { Effect } from "../../schema/defs/effect";
import type { SkillTable } from "../../schema/defs/skill-table";
import type { Tree } from "../../schema/defs/tree";
import { buildSkill, buildUltimate } from "./build-skill";
import type { AllySetup, BattleSetup } from "./engine";
import { battleSkillOf } from "./setup";

/**
 * 연습 전투 (시험 환경에만). 장착 화면이 생기기 전에 화면과 숫자를 직접 쳐 보려고,
 * 기본기·루트·궁극기·상대·편성을 골라 전투를 연다. 캐릭터 데이터는 읽지 않는다.
 */

export class PracticeError extends Error {
  override name = "PracticeError";
}

/** 연습 전투의 플레이어 (균형 시험과 같은 값) */
export const PRACTICE_PLAYER = { mastery: 30, health: 50 } as const;

export const PRACTICE_FOES = ["늑대 하나", "늑대 셋", "방패병 + 석궁병"] as const;
export type PracticeFoes = (typeof PRACTICE_FOES)[number];
export const PRACTICE_PARTIES = ["혼자", "동료 둘과"] as const;
export type PracticeParty = (typeof PRACTICE_PARTIES)[number];

export interface PracticeDefs {
  skillTable: SkillTable;
  effects: readonly Effect[];
  battle: BattleRules;
  enemies: readonly Enemy[];
  tree: Tree;
}

export interface PracticeChoice {
  /** 기본기 셋. route는 끝갈래 ID, 없으면 기본 모양 */
  basics: { id: string; route?: string }[];
  /** 드는 궁극기: 고른 루트 가운데 하나의 끝갈래 ID */
  ultimateRoute?: string;
  foes: PracticeFoes;
  party: PracticeParty;
  seed: string;
}

/** 기본기 하나에서 고를 수 있는 루트: 끝갈래마다 하나 (숨은 갈래 포함) */
export function practiceRoutes(tree: Tree, basicId: string): { endId: string; name: string; ultimateId: string; ultimateName: string }[] {
  const ends = tree.nodes.filter((node) => node.kind === "끝갈래" && node.id.startsWith(`${basicId}.`));
  return ends.map((end) => {
    const ultimate = tree.nodes.find((node) => node.kind === "궁극기" && routeOf(tree, node.id).includes(end.id));
    if (!ultimate) throw new PracticeError(`${end.name}: 궁극기가 없는 끝갈래`);
    return { endId: end.id, name: end.name, ultimateId: ultimate.id, ultimateName: ultimate.name };
  });
}

/** 칸에서 기본기까지 거슬러 올라간 칸들 */
function routeOf(tree: Tree, nodeId: string): string[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const ids: string[] = [];
  for (let at: string | null = nodeId; at !== null; at = byId.get(at)?.prev ?? null) ids.push(at);
  return ids;
}

export function buildPractice(defs: PracticeDefs, choice: PracticeChoice): BattleSetup {
  const { tree } = defs;
  if (choice.basics.length !== defs.skillTable.tree.equippedBasics) {
    throw new PracticeError(`기본기는 ${defs.skillTable.tree.equippedBasics}개를 고른다 (지금 ${choice.basics.length})`);
  }
  if (new Set(choice.basics.map((b) => b.id)).size !== choice.basics.length) throw new PracticeError("같은 기본기를 두 번 골랐다");

  /** 끝갈래까지 찍은 칸 (궁극기 포함, 고르는 칸은 첫째 쪽) */
  const pickedFor = (basicId: string, route: string | undefined) => {
    if (route === undefined) return new Set<string>();
    const found = practiceRoutes(tree, basicId).find((r) => r.endId === route);
    if (!found) throw new PracticeError(`${basicId}에 없는 루트: ${route}`);
    return new Set(routeOf(tree, found.ultimateId));
  };
  const skills = choice.basics.map((basic) =>
    buildSkill(defs.skillTable, defs.effects, defs.battle.words, tree, basic.id, { picked: pickedFor(basic.id, basic.route), choices: {} }, "근접"),
  );

  let ultimate;
  if (choice.ultimateRoute !== undefined) {
    const owner = choice.basics.find((b) => b.route === choice.ultimateRoute);
    if (!owner) throw new PracticeError("궁극기는 끝까지 고른 루트에서만 든다");
    const found = practiceRoutes(tree, owner.id).find((r) => r.endId === choice.ultimateRoute);
    if (!found) throw new PracticeError(`없는 루트: ${choice.ultimateRoute}`);
    ultimate = buildUltimate(defs.skillTable, defs.effects, defs.battle.words, tree, found.ultimateId, pickedFor(owner.id, owner.route), "근접");
  }

  const basicAttack = battleSkillOf(defs.skillTable, defs.effects, tree.basicAttack, "근접");
  const player: AllySetup = {
    id: "player",
    name: "나",
    kind: "플레이어",
    slot: 1,
    health: PRACTICE_PLAYER.health,
    mastery: PRACTICE_PLAYER.mastery,
    basicAttack,
    skills,
    ...(ultimate ? { ultimate } : {}),
  };
  const mate = (n: number, slot: number): AllySetup => ({ ...player, id: `mate${n}`, name: `동료 ${n}`, kind: "동료", slot, skills: [] });
  const allies = choice.party === "혼자" ? [player] : [player, mate(1, 0), mate(2, 2)];

  const enemy = (id: string) => {
    const found = defs.enemies.find((e) => e.id === id);
    if (!found) throw new PracticeError(`적 없음: ${id}`);
    return found;
  };
  const enemies: BattleSetup["enemies"] =
    choice.foes === "늑대 하나"
      ? [{ id: "wolf1", def: enemy("wolf"), slot: 1 }]
      : choice.foes === "늑대 셋"
        ? [0, 1, 2].map((slot) => ({ id: `wolf${slot + 1}`, def: enemy("wolf"), slot }))
        : [
            { id: "shield1", def: enemy("deserter.shield"), slot: 1 },
            { id: "crossbow1", def: enemy("deserter.crossbow"), slot: 4 },
          ];

  return { id: "practice", kind: "일반", seed: choice.seed, allies, enemies };
}
