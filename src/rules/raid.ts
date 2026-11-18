import type { Enemy } from "../schema/defs/battle";
import type { Limits } from "../schema/defs/limits";
import type { RaidBoss, RaidDefs, RaidReward } from "../schema/defs/raid";
import {
  allyOfCharacter,
  type AllyDefs,
  type AllySource,
} from "./battle/ally-of";
import type { BattleEvent, BattleSetup } from "./battle/engine";
import type { Gain } from "./dungeon/explore";

/**
 * 반복 레이드 (명세서 「레이드와 기여도」). 모두 순수 함수.
 * 보스는 기준일부터 정해진 날수마다 차례로 바뀐다(한국 시간 하루 경계). 지금은 혼자 도전한다.
 */

export class RaidError extends Error {
  override name = "RaidError";
}

const DAY = 24 * 60 * 60 * 1000;

export interface RaidWeek {
  index: number;
  /** 저장 경로·보상 출처에 쓰는 키 (예: "w3") */
  key: string;
  boss: RaidBoss;
  /** 다음 교대 시각 (ms) */
  nextChangeAt: number;
}

/** 지금 몇 번째 주이고 이번 주 보스는 누구인가 */
export function raidWeek(
  now: number,
  defs: RaidDefs,
  limits: Pick<Limits, "clock">,
): RaidWeek {
  const { epoch, days, order } = defs.rotation;
  const offset = limits.clock.utcOffsetHours * 60 * 60 * 1000;
  const start = Date.parse(`${epoch}T00:00:00Z`) - offset;
  const span = days * DAY;
  const index = Math.floor((now - start) / span);
  const bossId = order[((index % order.length) + order.length) % order.length]!;
  const boss = defs.bosses.find((b) => b.id === bossId);
  if (!boss) throw new RaidError(`정의에 없는 보스: ${bossId}`);
  return {
    index,
    key: `w${index}`,
    boss,
    nextChangeAt: start + (index + 1) * span,
  };
}

export interface Contribution {
  damage: number;
  stagger: number;
  prevented: number;
  reactions: number;
  score: number;
}

/** 한 판의 기여 점수: 전투 기록에서 그 사람이 준 피해·흐트러짐·막아준 피해·받아치기와 피하기 성공을 센다 */
export function contribution(
  events: readonly BattleEvent[],
  unitId: string,
  enemyIds: ReadonlySet<string>,
  weights: RaidDefs["contribution"],
): Contribution {
  let damage = 0;
  let stagger = 0;
  let prevented = 0;
  let reactions = 0;
  for (const e of events) {
    if (e.type === "피해" && e.from === unitId && enemyIds.has(e.to)) {
      damage += e.amount;
      stagger += e.stagger ?? 0;
    } else if (e.type === "반응" && e.ally === unitId) {
      prevented += e.prevented ?? 0;
      if (e.result === "받아치기 성공" || e.result === "피하기 성공")
        reactions += 1;
    }
  }
  stagger = Math.round(stagger * 100) / 100;
  const score = Math.round(
    damage +
      stagger * weights.stagger +
      prevented * weights.prevented +
      reactions * weights.reaction,
  );
  return { damage, stagger, prevented, reactions, score };
}

/** 점수의 절대 기준으로 나눈 등급 */
export function gradeOf(
  score: number,
  grades: RaidDefs["contribution"]["grades"],
): "금" | "은" | "동" | "참가" {
  if (score >= grades.금) return "금";
  if (score >= grades.은) return "은";
  if (score >= grades.동) return "동";
  return "참가";
}

/** 레이드 전투: 나 대 이번 주 보스 무리 */
export function raidBattle(
  character: AllySource,
  boss: RaidBoss,
  defs: AllyDefs & { enemies: readonly Enemy[] },
  seed: string,
): BattleSetup {
  const { ally } = allyOfCharacter(character, defs);
  return {
    id: `raid-${seed}`,
    kind: "레이드",
    seed: `raid-${seed}`,
    allies: [ally],
    enemies: boss.enemies.map((m, i) => {
      const def = defs.enemies.find((e) => e.id === m.enemy);
      if (!def) throw new RaidError(`정의에 없는 적: ${m.enemy}`);
      return { id: `e${i}`, def, slot: m.slot };
    }),
  };
}

const toGain = (r: RaidReward, quantity: number): Gain =>
  r.kind === "잎전"
    ? { kind: "잎전", quantity }
    : { kind: "묶음", item: r.item, quantity };

/** 이겼을 때의 보상: 그 주 처음이면 주간 보상, 아니면 피로 배율을 곱한 일반 보상(내림, 최소 1) */
export function raidGains(
  boss: RaidBoss,
  firstThisWeek: boolean,
  fatigueMultiplier: number,
): Gain[] {
  if (firstThisWeek) return boss.weekly.map((r) => toGain(r, r.quantity));
  return boss.repeat.map((r) =>
    toGain(r, Math.max(1, Math.floor(r.quantity * fatigueMultiplier))),
  );
}
