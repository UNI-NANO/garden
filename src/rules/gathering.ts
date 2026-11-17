import type { Quality } from "../schema/character";
import type {
  GatheringRules,
  GatheringSpot,
  Herb,
  Tells,
} from "../schema/defs/gathering";
import type { Season } from "../schema/defs/fishing";
import { createRng, type Rng } from "./rng";

/**
 * 채집 (기획서 「사냥·채집·낚시」, 8단계 ② 나). 비탈에 풀이 나 있고, 비가 올 때까지 시간이 정해져 있다.
 * 약초와 닮은 독초가 섞여 있어 줄기 색·잎 가장자리로 짐작하고, 「잎 뒤 보기」(시간이 든다)로 확인한다.
 * 차례로 하는 행동이라, 행동 기록을 처음부터 다시 돌려 결과를 계산한다(저장도 같은 계산을 쓴다).
 */

const QUALITIES: readonly Quality[] = ["하", "중", "상", "최상"];

export class GatheringError extends Error {
  override name = "GatheringError";
}

export interface Plant {
  index: number;
  /** 비탈 위 자리 (0~1) */
  x: number;
  y: number;
  /** 무엇처럼 보이는가 (약초) */
  herb: Herb;
  /** 실제로는 닮은 독초 */
  poison: boolean;
  /** 보이는 생김새 (독초면 독초의 단서) */
  tells: Tells;
  /** 캐면 얻는 수량 (독초면 0) */
  quantity: number;
}

export interface Field {
  plants: Plant[];
}

const pickOne = <T>(rng: Rng, list: readonly T[]): T =>
  list[rng.int(0, list.length - 1)]!;

function pickWeighted<T extends { weight: number }>(
  rng: Rng,
  list: readonly T[],
): T {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.next() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return list[list.length - 1]!;
}

/** 비탈 하나 (같은 씨앗·계절이면 같다). 칸 4×3에 겹치지 않게 놓고 조금씩 흔든다 */
export function planField(
  seed: string,
  spot: GatheringSpot,
  season: Season,
  rules: GatheringRules,
): Field {
  const rng = createRng(`${seed}:field`);
  const inSeason = spot.herbs.filter((h) => h.seasons.includes(season));
  const common = inSeason.filter((h) => h.lookalike !== undefined);
  const rare = inSeason.filter((h) => h.lookalike === undefined);
  const count = rng.int(rules.plants.min, rules.plants.max);
  const cells = Array.from({ length: 12 }, (_, i) => i);
  const plants: Plant[] = [];
  const withRare = rare.length > 0 && rng.next() < rules.rareChance;
  for (let i = 0; i < count && cells.length > 0; i++) {
    const cell = cells.splice(rng.int(0, cells.length - 1), 1)[0]!;
    const x = ((cell % 4) + 0.2 + rng.next() * 0.6) / 4;
    const y = (Math.floor(cell / 4) + 0.2 + rng.next() * 0.6) / 3;
    const herb =
      withRare && i === 0
        ? pickOne(rng, rare)
        : pickWeighted(rng, common.length > 0 ? common : inSeason);
    const poison =
      herb.lookalike !== undefined && rng.next() < rules.lookalikeShare;
    const quantity = poison ? 0 : rng.int(herb.quantity.min, herb.quantity.max);
    plants.push({
      index: i,
      x,
      y,
      herb,
      poison,
      tells: poison && herb.lookalike ? herb.lookalike.tells : herb.tells,
      quantity,
    });
  }
  // 놓는 순서가 자리 순서가 되지 않게: 위에서 아래로 정렬하고 번호를 다시 매긴다
  plants.sort((a, b) => a.y - b.y || a.x - b.x);
  plants.forEach((plant, i) => (plant.index = i));
  return { plants };
}

export type GatherAction = {
  plant: number;
  kind: "잎 뒤 보기" | "조심히 캐기" | "빨리 뜯기";
};

export interface GatherState {
  timeLeft: number;
  /** 잎 뒤를 본 풀 */
  checked: number[];
  /** 캐거나 뜯은 풀 */
  dug: number[];
  /** 캔 약초 (물건·수량·품질) */
  gains: { item: string; quantity: number; quality: Quality; plant: number }[];
  /** 독초를 캔 풀 */
  wasted: number[];
  /** 비가 와서 끝났다 (남은 시간으로 할 수 있는 행동이 없다) */
  rained: boolean;
}

export const costOf = (kind: GatherAction["kind"], rules: GatheringRules) =>
  kind === "잎 뒤 보기"
    ? rules.cost.back
    : kind === "빨리 뜯기"
      ? rules.cost.quick
      : rules.cost.careful;

/** 처음 상태 */
export function startGathering(rules: GatheringRules): GatherState {
  return {
    timeLeft: rules.time,
    checked: [],
    dug: [],
    gains: [],
    wasted: [],
    rained: false,
  };
}

/**
 * 행동 하나. 할 수 없으면 GatheringError.
 * fatigueSteps: 피로 곡선 단계만큼 품질을 내린다(사용자 결정: 낚시와 같게).
 */
export function act(
  before: GatherState,
  field: Field,
  action: GatherAction,
  rules: GatheringRules,
  fatigueSteps = 0,
): GatherState {
  if (before.rained) throw new GatheringError("비가 쏟아진다. 더는 캘 수 없다");
  const plant = field.plants[action.plant];
  if (!plant) throw new GatheringError("없는 풀");
  if (before.dug.includes(plant.index)) throw new GatheringError("이미 캔 풀");
  const cost = costOf(action.kind, rules);
  if (cost > before.timeLeft) throw new GatheringError("시간이 모자란다");
  const state: GatherState = {
    ...before,
    checked: [...before.checked],
    dug: [...before.dug],
    gains: [...before.gains],
    wasted: [...before.wasted],
  };
  state.timeLeft -= cost;
  if (action.kind === "잎 뒤 보기") {
    if (before.checked.includes(plant.index))
      throw new GatheringError("이미 잎 뒤를 봤다");
    state.checked.push(plant.index);
  } else {
    state.dug.push(plant.index);
    if (plant.poison) state.wasted.push(plant.index);
    else {
      const seen = before.checked.includes(plant.index);
      const base =
        action.kind === "조심히 캐기"
          ? seen
            ? rules.quality.carefulChecked
            : rules.quality.careful
          : seen
            ? rules.quality.quickChecked
            : rules.quality.quick;
      const quality =
        QUALITIES[
          Math.max(0, QUALITIES.indexOf(base) - Math.max(0, fatigueSteps))
        ]!;
      state.gains.push({
        item: plant.herb.item,
        quantity: plant.quantity,
        quality,
        plant: plant.index,
      });
    }
  }
  const cheapest = Math.min(
    rules.cost.back,
    rules.cost.quick,
    rules.cost.careful,
  );
  const anyLeft = field.plants.some((p) => !state.dug.includes(p.index));
  state.rained = state.timeLeft < Math.max(1, cheapest) || !anyLeft;
  return state;
}

/** 행동 기록을 처음부터 다시 돌린다 */
export function replayGathering(
  field: Field,
  actions: readonly GatherAction[],
  rules: GatheringRules,
  fatigueSteps = 0,
): GatherState {
  return actions.reduce(
    (state, action) => act(state, field, action, rules, fatigueSteps),
    startGathering(rules),
  );
}
