import type { Reach, Row } from "../../schema/defs/battle";
import type { Range } from "../../schema/defs/skill-table";

/** 한쪽 진형은 여섯 칸: 0·1·2가 앞줄, 3·4·5가 뒷줄 */
export const SLOTS = 6;
export const ROW_SIZE = 3;

export function rowOf(slot: number): Row {
  return slot < ROW_SIZE ? "앞줄" : "뒷줄";
}

export function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < SLOTS;
}

export interface Placed {
  id: string;
  slot: number;
}

/**
 * 칠 수 있는 대상. 근접은 앞줄만(앞줄이 비면 뒷줄), 원거리는 어느 칸이든.
 * `standing`은 서 있는(쓰러지지 않은) 상대만 넘긴다. 칸 번호 순으로 돌려준다.
 */
export function reachable<T extends Placed>(standing: readonly T[], reach: Reach): T[] {
  const sorted = [...standing].sort((a, b) => a.slot - b.slot);
  if (reach === "원거리") return sorted;
  const front = sorted.filter((u) => rowOf(u.slot) === "앞줄");
  return front.length > 0 ? front : sorted;
}

/**
 * 범위에 드는 대상. 첫 번째가 고른 대상이고 나머지는 덤으로 맞는 쪽이다.
 * 휩쓸기: 고른 대상과 같은 줄의 양옆. 전체: 서 있는 모두.
 */
export function targetsInRange<T extends Placed>(standing: readonly T[], main: T, range: Range): T[] {
  const others = standing.filter((u) => u.id !== main.id).sort((a, b) => a.slot - b.slot);
  if (range === "단일") return [main];
  if (range === "전체") return [main, ...others];
  return [main, ...others.filter((u) => rowOf(u.slot) === rowOf(main.slot) && Math.abs(u.slot - main.slot) === 1)];
}
