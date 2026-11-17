import type { Character } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import type { WorldClock } from "../schema/world";

/**
 * 세계 시계와 달 행동 (명세서 「세계 시계와 달 행동」). 현실 하루가 게임 속 한 달.
 * 모두 순수 함수다. 시각은 인자로 받는다.
 */

type Month = Character["month"];

const DAY_MS = 24 * 60 * 60 * 1000;
/** 이름 없는 다섯 날의 달 순번 */
export const NAMELESS_DAYS = 11;

/** 그 시각의 날짜 키. 하루 경계는 utcOffsetHours의 자정 (한국 시간이면 UTC 15:00) */
export function dateKeyAt(nowMs: number, utcOffsetHours: number): string {
  return new Date(nowMs + utcOffsetHours * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 날짜 키 다음 날 */
export function nextDateKey(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** 마지막으로 처리한 날 다음부터 오늘까지, 처리할 날짜들 (오래된 것부터). 이미 오늘까지 했으면 빈 목록 */
export function missingDays(lastDateKey: string, todayKey: string): string[] {
  const days: string[] = [];
  for (let day = nextDateKey(lastDateKey); day <= todayKey; day = nextDateKey(day)) days.push(day);
  return days;
}

/** 세계의 이번 달 키 (예: "514-3") */
export function monthKeyOf(clock: Pick<WorldClock, "year" | "monthIndex">): string {
  return `${clock.year}-${clock.monthIndex}`;
}

/** 처음 세계 시계: 시작 연도의 첫 달, 오늘까지 처리한 것으로 */
export function initialClock(limits: Limits, nowMs: number): WorldClock {
  const year = limits.clock.startYear;
  return { year, monthIndex: 0, monthKey: monthKeyOf({ year, monthIndex: 0 }), lastDateKey: dateKeyAt(nowMs, limits.clock.utcOffsetHours), computing: false };
}

/** 달 순번 +1. 10 다음은 11(이름 없는 다섯 날), 11 다음은 다음 해 0. 11이 되는 날은 한 해 정리 */
export function advanceMonth(clock: Pick<WorldClock, "year" | "monthIndex">): { year: number; monthIndex: number; yearEnd: boolean } {
  if (clock.monthIndex >= NAMELESS_DAYS) return { year: clock.year + 1, monthIndex: 0, yearEnd: false };
  const monthIndex = clock.monthIndex + 1;
  return { year: clock.year, monthIndex, yearEnd: monthIndex === NAMELESS_DAYS };
}

/** 저장 행동을 넘쳐 자동 처리된 행동 */
export interface AutoActions {
  work: number;
  rest: number;
}

/**
 * 캐릭터의 달 넘어감. 남은 주 행동을 저장 행동에 더하고, 상한을 넘는 몫은 자동 처리한다
 * (일터가 있으면 일하기부터 일하기·쉬기를 번갈아, 없으면 모두 쉬기). 작은 행동은 버리고, 이번 달 값을 새로 채운다.
 * 이미 그 달이면 아무것도 하지 않는다(같은 날을 두 번 처리해도 같다).
 */
export function rolloverMonth(month: Month, newKey: string, limits: Limits, hasWorkplace: boolean): { month: Month; auto: AutoActions; changed: boolean } {
  if (month.key === newKey) return { month, auto: { work: 0, rest: 0 }, changed: false };
  const pooled = month.savedActions + month.mainActions;
  const savedActions = Math.min(limits.month.savedActionsMax, pooled);
  const overflow = pooled - savedActions;
  const auto: AutoActions = hasWorkplace ? { work: Math.ceil(overflow / 2), rest: Math.floor(overflow / 2) } : { work: 0, rest: overflow };
  return {
    month: {
      key: newKey,
      mainActions: limits.month.mainActions,
      minorActions: limits.month.minorActions,
      savedActions,
      career: 0,
      learnCounts: {},
      combatMasteryGained: {},
      fatigue: {},
    },
    auto,
    changed: true,
  };
}

/** 한 해 정리에서 캐릭터에게 하는 일: 나이 +1 */
export function yearEndAge(age: number): number {
  return Math.min(150, age + 1);
}

export type ActionKind = "주 행동" | "작은 행동";

export type SpendFailure = "계산 중" | "달이 다름" | "이름 없는 다섯 날" | "행동이 없음";

export type SpendResult =
  | { ok: true; month: Month; used: { saved: number; main: number; minor: number } }
  | { ok: false; reason: SpendFailure };

/**
 * 달 행동 쓰기. 요청에 붙어 온 달 키가 세계의 달과 같아야 하고, 계산 중이 아니어야 하며, 이름 없는 다섯 날에는 달 행동이 없다.
 * 주 행동은 저장 행동부터 쓰고(오래된 것부터), 다 쓰면 이번 달 몫을 쓴다.
 */
export function spendAction(
  month: Month,
  clock: Pick<WorldClock, "year" | "monthIndex" | "computing">,
  requestMonthKey: string,
  kind: ActionKind,
): SpendResult {
  if (clock.computing) return { ok: false, reason: "계산 중" };
  const worldKey = monthKeyOf(clock);
  if (requestMonthKey !== worldKey || month.key !== worldKey) return { ok: false, reason: "달이 다름" };
  if (clock.monthIndex === NAMELESS_DAYS) return { ok: false, reason: "이름 없는 다섯 날" };
  if (kind === "작은 행동") {
    if (month.minorActions <= 0) return { ok: false, reason: "행동이 없음" };
    return { ok: true, month: { ...month, minorActions: month.minorActions - 1 }, used: { saved: 0, main: 0, minor: 1 } };
  }
  if (month.savedActions > 0) return { ok: true, month: { ...month, savedActions: month.savedActions - 1 }, used: { saved: 1, main: 0, minor: 0 } };
  if (month.mainActions > 0) return { ok: true, month: { ...month, mainActions: month.mainActions - 1 }, used: { saved: 0, main: 1, minor: 0 } };
  return { ok: false, reason: "행동이 없음" };
}

/** 쓸 수 있는 주 행동 (저장 + 이번 달) */
export function mainActionsLeft(month: Month): number {
  return month.savedActions + month.mainActions;
}
