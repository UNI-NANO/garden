import type { ArenaBuild } from "../schema/arena";
import type { ArenaDefs } from "../schema/defs/arena";
import type { Enemy, EnemyAction } from "../schema/defs/battle";
import type { Limits } from "../schema/defs/limits";
import { TierSchema } from "../schema/defs/skill-table";
import { idToKey } from "../schema/keys";
import {
  allyOfCharacter,
  treeFor,
  type AllyDefs,
  type AllySource,
} from "./battle/ally-of";
import type { BattleSetup, BattleSkill } from "./battle/engine";
import { masteryMultiplier, playerMaxHp } from "./battle/numbers";
import { parseMonthKey, seasonOf } from "./calendar";

/**
 * 투기장 (기획서 「훈련장·투기장」). 모두 순수 함수.
 * 상대는 등록한 빌드를 「그림자 적」 하나로 바꿔 지금 전투 계산 그대로 싸운다(플레이어 대 플레이어 전용 계산은 없다).
 * 점수는 엘로식, 도전한 사람만 바뀐다. 피로 배율은 이길 때 얻는 점수에만 곱한다.
 */

export class ArenaError extends Error {
  override name = "ArenaError";
}

const SEASON_KEYS = {
  봄: "spring",
  여름: "summer",
  가을: "autumn",
  겨울: "winter",
} as const;
const SEASON_NAMES = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
} as const;

/** 계절 키 (저장 경로에 쓴다): "514-3" → "514-summer" */
export function seasonKey(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new ArenaError(`달 키가 틀리다: ${monthKey}`);
  return `${parsed.year}-${SEASON_KEYS[seasonOf(parsed.index)]}`;
}

/** 보이는 계절 이름: "514-summer" → "성력 514 여름" */
export function seasonLabel(key: string): string {
  const [year, season] = key.split("-");
  return `성력 ${year} ${SEASON_NAMES[season as keyof typeof SEASON_NAMES] ?? season}`;
}

/** 지금 캐릭터의 빌드를 찍어 둔다 (장착한 기본기가 있는 나무 기준, 전투 아군과 같은 규칙) */
export function snapshotBuild(
  character: AllySource & {
    trees: Record<
      string,
      | {
          treeVersion: number;
          picked: Record<string, true>;
          choices: Record<string, 0 | 1>;
        }
      | undefined
    >;
  },
  trees: AllyDefs["trees"],
): ArenaBuild {
  const tree = treeFor(character, trees);
  const saved = character.trees[idToKey(tree.id)];
  return {
    name: character.profile.name,
    health: character.abilities.health,
    treeId: tree.id,
    treeVersion: saved?.treeVersion ?? tree.version,
    picked: { ...(saved?.picked ?? {}) },
    choices: { ...(saved?.choices ?? {}) },
    basics: [...character.loadout.basics],
    ...(character.loadout.ultimate !== undefined
      ? { ultimate: character.loadout.ultimate }
      : {}),
    mastery: character.mastery[idToKey(tree.id)]?.value ?? 0,
  };
}

/** 빌드 → 전투 아군의 재료 */
export function sourceOf(build: ArenaBuild): AllySource {
  const key = idToKey(build.treeId);
  return {
    profile: { name: build.name },
    abilities: { health: build.health },
    loadout: {
      basics: build.basics,
      ...(build.ultimate !== undefined ? { ultimate: build.ultimate } : {}),
    },
    trees: { [key]: { picked: build.picked, choices: build.choices } },
    mastery: { [key]: { value: build.mastery } },
  };
}

const onePower = (s: BattleSkill) => s.baseHitPower * s.hitCount;

/** 등록한 빌드 → 그림자 적 하나 */
export function shadowEnemy(
  build: ArenaBuild,
  id: string,
  defs: AllyDefs & { arena: ArenaDefs },
): Enemy {
  const tree = defs.trees.find((t) => t.id === build.treeId);
  if (!tree) throw new ArenaError(`정의에 없는 나무: ${build.treeId}`);
  const { ally } = allyOfCharacter(sourceOf(build), { ...defs, trees: [tree] });
  const { shadow } = defs.arena;
  const basic = ally.basicAttack;
  const bigFrom = TierSchema.options.indexOf(shadow.bigFrom);
  const action = (s: BattleSkill, weight: number): EnemyAction => {
    const multiplier = Math.min(
      10,
      Math.round((onePower(s) / Math.max(1, onePower(basic))) * 100) / 100,
    );
    return {
      name: s.name,
      damageType: s.damageType,
      reach: s.reach,
      range: s.range,
      weight,
      ...(multiplier !== 1 ? { powerMultiplier: multiplier } : {}),
      ...(TierSchema.options.indexOf(s.tier) >= bigFrom ? { big: true } : {}),
      ...(s.effects.length > 0 ? { effects: s.effects } : {}),
    };
  };
  const skills = [
    ...ally.skills,
    ...(shadow.withUltimate && ally.ultimate ? [ally.ultimate] : []),
  ].filter((s) => !s.stance);
  return {
    id,
    name: `${build.name}의 그림자`,
    archetype: shadow.archetype,
    tier: 1,
    rank: "일반",
    row: "앞줄",
    resist: { 자상: "보통", 관통: "보통", 파열: "보통" },
    defense: 0,
    targeting: "앞줄",
    actions: [
      action(basic, shadow.basicWeight),
      ...skills.map((s) => action(s, shadow.skillWeight)),
    ],
    overrides: {
      hp: Math.max(
        1,
        Math.round(
          playerMaxHp(defs.battle, build.health) * shadow.hpMultiplier,
        ),
      ),
      power:
        Math.round(
          basic.baseHitPower *
            masteryMultiplier(defs.battle, build.mastery) *
            100,
        ) / 100,
    },
  };
}

/** 결투: 나 대 상대의 그림자 */
export function duelBattle(
  me: AllySource,
  opponent: { cid: string; build: ArenaBuild },
  defs: AllyDefs & { arena: ArenaDefs },
  seed: string,
): BattleSetup {
  const { ally } = allyOfCharacter(me, defs);
  return {
    id: `duel-${seed}`,
    kind: "결투",
    seed: `duel-${seed}`,
    allies: [ally],
    enemies: [
      {
        id: "e0",
        def: shadowEnemy(opponent.build, `shadow-${opponent.cid}`, defs),
        slot: 0,
      },
    ],
  };
}

/** 도전한 사람의 점수 변화: 이기면 +k(1−기대)×피로 배율(내림, 최소 1), 지면 −k×기대(올림). 0 아래·최대 위로는 가지 않는다 */
export function scoreChange(
  mine: number,
  theirs: number,
  won: boolean,
  fatigueMultiplier: number,
  limits: Pick<Limits, "arena">,
): number {
  const { k, scale, maxScore } = limits.arena;
  const expected = 1 / (1 + 10 ** ((theirs - mine) / scale));
  const raw = won
    ? Math.max(1, Math.floor(k * (1 - expected) * fatigueMultiplier))
    : -Math.ceil(k * expected);
  const next = Math.min(maxScore, Math.max(0, mine + raw));
  return next - mine;
}
