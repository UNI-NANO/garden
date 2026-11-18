import type { Character } from "../schema/character";
import type { Enemy } from "../schema/defs/battle";
import type { Tree } from "../schema/defs/tree";
import type { TrainingGround, WallTest } from "../schema/defs/training";
import { idToKey } from "../schema/keys";
import { allyOfCharacter, type AllyDefs } from "./battle/ally-of";
import type { BattleSetup } from "./battle/engine";

/**
 * 훈련장 (명세서 숙련도 「벽」, 기획서 「훈련장·투기장」). 모두 순수 함수.
 * 숙련도는 60을 통과하지 않았으면 59.99에서, 80을 통과하지 않았으면 79.99에서 멈춘다.
 * 그 자리에 막힌 기술만 교관 대련(벽 시험)을 할 수 있다.
 */

export class TrainingError extends Error {
  override name = "TrainingError";
}

export interface BlockedWall {
  /** 기술(나무) ID */
  skill: string;
  skillName: string;
  wall: WallTest;
}

/** 지금 그 벽에 막혀 있는가 (숙련도가 벽 바로 아래 59.99·79.99 이상, 아직 통과하지 않음) */
export function isBlocked(
  character: Pick<Character, "mastery">,
  skill: string,
  at: 60 | 80,
): boolean {
  const entry = character.mastery[idToKey(skill)];
  if (!entry) return false;
  const passed = at === 60 ? entry.passed60 : entry.passed80;
  // 60을 넘지 못했으면 80 벽에는 닿을 수 없다
  if (at === 80 && !entry.passed60) return false;
  return !passed && Math.round(entry.value * 100) >= at * 100 - 1;
}

/** 이 훈련장에서 도전할 수 있는 벽 시험 (전투 기술 = 나무가 있는 기술) */
export function blockedWalls(
  character: Character,
  ground: TrainingGround,
  trees: readonly Pick<Tree, "id" | "name">[],
): BlockedWall[] {
  return trees.flatMap((tree) =>
    ground.walls
      .filter((wall) => isBlocked(character, tree.id, wall.at))
      .map((wall) => ({ skill: tree.id, skillName: tree.name, wall })),
  );
}

/** 기술마다 숙련도와 벽 상태 (막힌 벽이 없을 때 보여 준다) */
export function wallStatus(
  character: Character,
  trees: readonly Pick<Tree, "id" | "name">[],
) {
  return trees.map((tree) => {
    const entry = character.mastery[idToKey(tree.id)];
    return {
      skill: tree.id,
      skillName: tree.name,
      value: entry?.value ?? 0,
      passed60: entry?.passed60 ?? false,
      passed80: entry?.passed80 ?? false,
    };
  });
}

function enemiesOf(
  members: readonly { enemy: string; slot: number }[],
  enemies: readonly Enemy[],
) {
  return members.map((m, i) => {
    const def = enemies.find((e) => e.id === m.enemy);
    if (!def) throw new TrainingError(`정의에 없는 적: ${m.enemy}`);
    return { id: `e${i}`, def, slot: m.slot };
  });
}

/** 허수아비 치기: 내 캐릭터 대 허수아비 (위력 0이라 맞아도 피해가 없다) */
export function dummyBattle(
  character: Character,
  ground: TrainingGround,
  defs: AllyDefs & { enemies: readonly Enemy[] },
  seed: string,
): BattleSetup {
  const { ally } = allyOfCharacter(character, defs);
  return {
    id: `dummy-${seed}`,
    kind: "일반",
    seed: `dummy-${seed}`,
    allies: [ally],
    enemies: enemiesOf([{ enemy: ground.dummy.enemy, slot: 0 }], defs.enemies),
  };
}

/** 교관 대련: 그 기술의 나무로 싸운다 */
export function wallBattle(
  character: Character,
  blocked: BlockedWall,
  defs: AllyDefs & { enemies: readonly Enemy[] },
  seed: string,
): BattleSetup {
  const tree = defs.trees.find((t) => t.id === blocked.skill);
  if (!tree) throw new TrainingError(`나무가 없는 기술: ${blocked.skill}`);
  const { ally } = allyOfCharacter(character, { ...defs, trees: [tree] });
  return {
    id: `wall-${seed}`,
    kind: "일반",
    seed: `wall-${seed}`,
    allies: [ally],
    enemies: enemiesOf(blocked.wall.enemies, defs.enemies),
  };
}
