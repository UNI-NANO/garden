import type { Quality } from "../schema/character";
import type { Season } from "../schema/defs/fishing";
import type {
  HuntingGround,
  HuntingRules,
  Prey,
  Track,
} from "../schema/defs/hunting";
import type { Judgement } from "../schema/defs/skill-table";
import { judgeAt, type BarWidths } from "./battle/judge";
import { createRng, type Rng } from "./rng";

/**
 * 사냥 (기획서 「사냥·채집·낚시」, 8단계 ② 다). 흔적을 읽어 갈림길마다 길을 고르고(바람·걸음 빠르기),
 * 짐승이 보이면 더 다가가거나 쏜다(전투의 판정 바, 가까울수록 칸이 넓다). 위험한 짐승은 스치면 달려든다.
 * 차례로 하는 행동이라 기록을 다시 돌려 계산한다. 판정 바는 눌린 자리로 판정을 다시 계산한다.
 */

export const DIRECTIONS = ["북", "동", "남", "서"] as const;
export type Direction = (typeof DIRECTIONS)[number];
const OPPOSITE: Record<Direction, Direction> = {
  북: "남",
  남: "북",
  동: "서",
  서: "동",
};
const QUALITIES: readonly Quality[] = ["하", "중", "상", "최상"];
export const BAR_LENGTH = 100;

export class HuntingError extends Error {
  override name = "HuntingError";
}

export interface Fork {
  /** 바람이 불어오는 쪽. 그 반대쪽으로 가면 바람을 등진다(냄새가 짐승에게 간다) */
  windFrom: Direction;
  paths: { dir: Direction; track: Track; right: boolean }[];
}

export interface Hunt {
  prey: Prey;
  forks: Fork[];
  /** 잡으면 얻는 수량 (drops 순서대로) */
  quantities: number[];
  /** 처음 발견한 흔적 (쫓는 짐승의 흔적 가운데 하나) */
  startTrack: Track;
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

/** 한 번의 사냥: 쫓을 짐승과 흔적 갈림길 (같은 씨앗·계절이면 같다) */
export function planHunt(
  seed: string,
  ground: HuntingGround,
  season: Season,
  rules: HuntingRules,
): Hunt {
  const rng = createRng(`${seed}:hunt`);
  const here = ground.prey.filter((p) => p.seasons.includes(season));
  const prey = pickWeighted(rng, here.length > 0 ? here : ground.prey);
  const otherTracks = [...new Set(ground.prey.flatMap((p) => p.tracks))].filter(
    (t) => !prey.tracks.includes(t),
  );
  const forks: Fork[] = [];
  for (let f = 0; f < rules.forks; f++) {
    const count = rng.int(rules.paths.min, rules.paths.max);
    const dirs = [...DIRECTIONS];
    const chosen: Direction[] = [];
    for (let i = 0; i < Math.min(count, dirs.length); i++)
      chosen.push(dirs.splice(rng.int(0, dirs.length - 1), 1)[0]!);
    const right = rng.int(0, chosen.length - 1);
    const paths = chosen.map((dir, i) => ({
      dir,
      right: i === right,
      track:
        i === right || otherTracks.length === 0
          ? pickOne(rng, prey.tracks)
          : pickOne(rng, otherTracks),
    }));
    forks.push({ windFrom: pickOne(rng, DIRECTIONS), paths });
  }
  const quantities = prey.drops.map((d) =>
    rng.int(d.quantity.min, d.quantity.max),
  );
  return { prey, forks, quantities, startTrack: pickOne(rng, prey.tracks) };
}

export type HuntAction =
  | { kind: "길"; path: number; pace: "조용히" | "빠르게" }
  | { kind: "다가가기" }
  | { kind: "쏘기"; position: number | null };

export type HuntOutcome = "잡음" | "달아남" | "놓침" | "달려듦";

export interface HuntState {
  phase: "추적" | "조준" | "끝";
  /** 지금 갈림길 */
  fork: number;
  /** 남은 걸음 (반 걸음 단위: 조용히 2, 빠르게 1) */
  halfSteps: number;
  /** 경계 0~100. 100이면 달아난다 */
  alert: number;
  /** 지금 갈림길에서 이미 틀린 길 */
  tried: number[];
  /** 조준할 때 거리 (m) */
  distance: number;
  judgement?: Judgement;
  /** 쏠 때의 경계 */
  alertAtShot?: number;
  outcome?: HuntOutcome;
}

export function startHunt(rules: HuntingRules): HuntState {
  return {
    phase: "추적",
    fork: 0,
    halfSteps: rules.steps * 2,
    alert: 0,
    tried: [],
    distance: rules.distance.start,
  };
}

/** 바람을 등지고 가는 길인가 */
export const isDownwind = (fork: Fork, dir: Direction) =>
  dir === OPPOSITE[fork.windFrom];

/** 거리에 따른 판정 바 칸 폭: 가장 먼 거리 → far, 가장 가까운 거리 → near 사이를 곧게 */
export function barWidths(distance: number, rules: HuntingRules): BarWidths {
  const { start, min } = rules.distance;
  const t =
    start === min
      ? 1
      : Math.min(1, Math.max(0, (start - distance) / (start - min)));
  const mix = (a: number, b: number) => a + (b - a) * t;
  const { far, near } = rules.bar;
  return {
    good: mix(far.good, near.good),
    perfect: mix(far.perfect, near.perfect),
    normalEachSide: mix(far.normalEachSide, near.normalEachSide),
  };
}

/** 다가가기 한 번에 오르는 경계 (예민할수록 많이) */
export const approachAlert = (prey: Prey, rules: HuntingRules) =>
  Math.round(rules.alert.approach * (0.5 + prey.wariness));

export function act(
  before: HuntState,
  hunt: Hunt,
  action: HuntAction,
  rules: HuntingRules,
): HuntState {
  if (before.phase === "끝") throw new HuntingError("사냥이 끝났다");
  const state: HuntState = { ...before, tried: [...before.tried] };
  const flee = () => {
    if (state.alert >= 100) {
      state.alert = 100;
      state.phase = "끝";
      state.outcome = "달아남";
    }
  };
  if (action.kind === "길") {
    if (before.phase !== "추적")
      throw new HuntingError("흔적을 따라가는 중이 아니다");
    const fork = hunt.forks[before.fork]!;
    const path = fork.paths[action.path];
    if (!path) throw new HuntingError("없는 길");
    if (before.tried.includes(action.path))
      throw new HuntingError("이미 틀린 길");
    const cost = action.pace === "빠르게" ? 1 : 2;
    if (cost > before.halfSteps) throw new HuntingError("걸음이 모자란다");
    state.halfSteps -= cost;
    state.alert +=
      (action.pace === "빠르게" ? rules.alert.fast : rules.alert.quiet) +
      (isDownwind(fork, path.dir) ? rules.alert.downwind : 0);
    if (path.right) {
      state.fork += 1;
      state.tried = [];
      if (state.fork >= hunt.forks.length) state.phase = "조준";
    } else {
      state.alert += rules.alert.wrong;
      state.tried.push(action.path);
    }
    flee();
    if (state.phase === "추적" && state.halfSteps < 1) {
      state.phase = "끝";
      state.outcome = "놓침";
    }
    return state;
  }
  if (before.phase !== "조준")
    throw new HuntingError("아직 짐승이 보이지 않는다");
  if (action.kind === "다가가기") {
    if (before.distance <= rules.distance.min)
      throw new HuntingError("더 다가갈 수 없다");
    state.distance = Math.max(
      rules.distance.min,
      before.distance - rules.distance.step,
    );
    state.alert += approachAlert(hunt.prey, rules);
    flee();
    return state;
  }
  const judgement = judgeAt(
    barWidths(before.distance, rules),
    BAR_LENGTH,
    action.position ?? undefined,
  );
  state.judgement = judgement;
  state.alertAtShot = before.alert;
  state.phase = "끝";
  state.outcome =
    judgement === "완벽" || judgement === "좋음"
      ? "잡음"
      : judgement === "보통" && hunt.prey.danger
        ? "달려듦"
        : "달아남";
  return state;
}

export function replayHunt(
  hunt: Hunt,
  actions: readonly HuntAction[],
  rules: HuntingRules,
): HuntState {
  return actions.reduce(
    (state, action) => act(state, hunt, action, rules),
    startHunt(rules),
  );
}

/**
 * 얻는 것. 잡았으면 짐승의 물건을 품질과 함께, 달려들었으면 전투에서 이겼을 때만(전투 품질).
 * 쏠 때 경계가 높았으면 한 단계 낮고, 피로 곡선 단계만큼 더 낮다.
 */
export function huntGains(
  state: HuntState,
  hunt: Hunt,
  rules: HuntingRules,
  fatigueSteps: number,
  battleWon?: boolean,
): { item: string; quantity: number; quality: Quality }[] {
  let base: Quality;
  if (state.outcome === "잡음")
    base = state.judgement === "완벽" ? rules.quality.완벽 : rules.quality.좋음;
  else if (state.outcome === "달려듦" && battleWon) base = rules.quality.전투;
  else return [];
  const nervous =
    state.outcome === "잡음" &&
    (state.alertAtShot ?? 0) >= rules.quality.nervousAlert
      ? 1
      : 0;
  const quality =
    QUALITIES[
      Math.max(0, QUALITIES.indexOf(base) - nervous - Math.max(0, fatigueSteps))
    ]!;
  return hunt.prey.drops.map((drop, i) => ({
    item: drop.item,
    quantity: hunt.quantities[i]!,
    quality,
  }));
}
