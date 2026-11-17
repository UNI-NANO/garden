import {
  CAST_ZONES,
  type CastZone,
  type Fish,
  type FishingRules,
  type FishingSpot,
  type Season,
} from "../schema/defs/fishing";
import type { Quality } from "../schema/character";
import { createRng, type Rng } from "./rng";

/**
 * 낚시 (기획서 「사냥·채집·낚시」: 찌 타이밍 + 줄 당기기). 모두 순수 함수, 같은 씨앗이면 같은 결과.
 * 던지기(힘 → 구역) → 기다리기(톡톡 가짜 입질 뒤 푹 잠김, 그 틈에 채기) → 씨름(누르면 감기, 떼면 풀기) → 결과.
 */

const QUALITIES: readonly Quality[] = ["하", "중", "상", "최상"];

/** 누르고 있던 시간 → 던지기 힘 (0→1→0 으로 오가는 막대) */
export function castPower(heldMs: number, rules: FishingRules): number {
  const phase = (Math.max(0, heldMs) % rules.castCycleMs) / rules.castCycleMs;
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

export function castZone(power: number, rules: FishingRules): CastZone {
  const [shallow, reeds] = rules.zoneEdges;
  return power < shallow
    ? CAST_ZONES[0]
    : power < reeds
      ? CAST_ZONES[1]
      : CAST_ZONES[2];
}

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

const between = (rng: Rng, r: { min: number; max: number }) =>
  r.min + rng.next() * (r.max - r.min);

export interface Cast {
  zone: CastZone;
  fish: Fish;
  /** 크기 (cm, 0.5 단위) */
  size: number;
  /** 씨름이 시작될 때의 거리 (m) */
  distance: number;
  /** 던진 뒤부터 톡톡이 오는 시각들(ms), 푹 잠기는 시각 */
  nibbles: number[];
  biteAt: number;
  /** 씨름이 시작된 뒤부터 차고 나가는 시각들(ms) */
  surges: number[];
}

/**
 * 한 번 던졌을 때 무엇이 어떻게 무는지. 그 구역·계절의 물고기에서 무게대로 고른다.
 * 그 계절에 나오는 고기가 없으면(정의 검사가 막는다) 구역 전부에서 고른다.
 */
export function planCast(
  seed: string,
  power: number,
  spot: FishingSpot,
  season: Season,
  rules: FishingRules,
): Cast {
  const rng = createRng(`${seed}:fish`);
  const zone = castZone(power, rules);
  const here = spot.zones[zone].filter((f) => f.seasons.includes(season));
  const fish = pickWeighted(rng, here.length > 0 ? here : spot.zones[zone]);
  const size = Math.round(between(rng, fish.size) * 2) / 2;
  const distance =
    rules.startDistance.min +
    power * (rules.startDistance.max - rules.startDistance.min);

  const nibbles: number[] = [];
  let at = between(rng, rules.firstWaitMs);
  const nibbleCount = rng.int(rules.nibbles.min, rules.nibbles.max);
  for (let i = 0; i < nibbleCount; i++) {
    nibbles.push(Math.round(at));
    at += between(rng, rules.nibbleGapMs);
  }
  const biteAt = Math.round(at);

  const surges: number[] = [];
  let surgeAt = between(rng, rules.surgeFirstMs);
  const surgeCount = rng.int(fish.surges.min, fish.surges.max);
  for (let i = 0; i < surgeCount; i++) {
    surges.push(Math.round(surgeAt));
    surgeAt += rules.surgeMs + between(rng, rules.surgeGapMs);
  }
  return { zone, fish, size, distance, nibbles, biteAt, surges };
}

export type StrikeResult =
  | { kind: "걸림"; accuracy: number }
  | { kind: "놓침"; reason: "너무 일찍" | "너무 늦게" };

/**
 * 던진 뒤 pressedAt(ms)에 채었을 때. 푹 잠기기 전(톡톡 포함)이면 고기가 놀라 달아나고,
 * 잠긴 뒤 틈 안이면 걸린다(빨리 챌수록 정확함 1에 가깝다). 누르지 않았으면 pressedAt은 undefined.
 */
export function strike(
  cast: Cast,
  pressedAt: number | undefined,
  rules: FishingRules,
): StrikeResult {
  if (pressedAt === undefined || pressedAt > cast.biteAt + rules.biteWindowMs)
    return { kind: "놓침", reason: "너무 늦게" };
  if (pressedAt < cast.biteAt) return { kind: "놓침", reason: "너무 일찍" };
  return {
    kind: "걸림",
    accuracy: 1 - (pressedAt - cast.biteAt) / rules.biteWindowMs,
  };
}

/** 지금 찌의 모습 (던진 뒤 t ms) */
export function bobberAt(
  cast: Cast,
  t: number,
  rules: FishingRules,
): "고요" | "톡톡" | "잠김" | "떠남" {
  if (t >= cast.biteAt + rules.biteWindowMs) return "떠남";
  if (t >= cast.biteAt) return "잠김";
  return cast.nibbles.some((n) => t >= n && t < n + 250) ? "톡톡" : "고요";
}

export interface Fight {
  /** 씨름이 시작된 뒤 흐른 시간 (ms) */
  t: number;
  /** 남은 거리 (m) */
  distance: number;
  /** 줄의 팽팽함 0~1 (1이면 끊어짐) */
  tension: number;
  maxTension: number;
  outcome?: "낚음" | "끊어짐" | "빠져나감";
}

export function startFight(cast: Cast): Fight {
  return { t: 0, distance: cast.distance, tension: 0, maxTension: 0 };
}

/** 지금 차고 나가는 중인가, 곧 차고 나갈 예고인가 */
export function surgeAt(
  cast: Cast,
  t: number,
  rules: FishingRules,
): "없음" | "예고" | "차고 나감" {
  for (const at of cast.surges) {
    if (t >= at && t < at + rules.surgeMs) return "차고 나감";
    if (t >= at - rules.surgeWarnMs && t < at) return "예고";
  }
  return "없음";
}

/**
 * 씨름 한 걸음. reeling: 누르고 있나. dtMs는 짧게(화면은 한 프레임) 나눠 부른다.
 * 감으면 가까워지지만 팽팽함이 오르고(차고 나갈 때는 훨씬 많이), 풀면 팽팽함이 내리지만 줄이 나간다.
 */
export function stepFight(
  before: Fight,
  cast: Cast,
  reeling: boolean,
  dtMs: number,
  rules: FishingRules,
): Fight {
  if (before.outcome) return before;
  const dt = Math.max(0, dtMs) / 1000;
  const surging = surgeAt(cast, before.t, rules) === "차고 나감";
  const pull = cast.fish.pull * (surging ? rules.surgePullMultiplier : 1);
  const next: Fight = { ...before, t: before.t + dtMs };
  if (reeling) {
    next.distance = before.distance - rules.reelSpeed * dt;
    next.tension =
      before.tension +
      (rules.tensionUp * pull + (surging ? rules.surgeTensionUp : 0)) * dt;
  } else {
    next.distance = before.distance + rules.payoutSpeed * pull * dt;
    next.tension = Math.max(0, before.tension - rules.tensionDown * dt);
  }
  next.maxTension = Math.max(before.maxTension, Math.min(1, next.tension));
  if (next.tension >= 1) next.outcome = "끊어짐";
  else if (next.distance >= rules.lineLength) next.outcome = "빠져나감";
  else if (next.distance <= 0) next.outcome = "낚음";
  next.distance = Math.min(rules.lineLength, Math.max(0, next.distance));
  next.tension = Math.min(1, next.tension);
  return next;
}

/**
 * 품질: 채는 정확함과 씨름에서 줄을 얼마나 아꼈는지(가장 높았던 팽팽함이 낮을수록 좋음).
 * 그다음 피로 곡선 단계만큼 내린다 (사용자 결정: 100% 그대로, 70% 한 단계, 50% 두 단계, 30% 세 단계).
 */
export function catchQuality(
  accuracy: number,
  maxTension: number,
  fatigueSteps: number,
  rules: FishingRules,
): Quality {
  const score =
    0.5 * Math.min(1, Math.max(0, accuracy)) +
    0.5 * (1 - Math.min(1, Math.max(0, maxTension)));
  const base =
    score >= rules.quality.최상
      ? 3
      : score >= rules.quality.상
        ? 2
        : score >= rules.quality.중
          ? 1
          : 0;
  return QUALITIES[Math.max(0, base - Math.max(0, fatigueSteps))]!;
}

/** 보상 곡선에서 그 배율이 몇 단계 내려간 것인가 (곡선 [1,1,0.7,0.5,0.3]: 1→0, 0.7→1, 0.5→2, 0.3→3) */
export function curveSteps(
  multiplier: number,
  curve: readonly number[],
): number {
  return new Set(curve.filter((value) => value > multiplier)).size;
}
