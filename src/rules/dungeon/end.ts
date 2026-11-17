import type { Dungeon } from "../../schema/defs/dungeon";
import type { Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import type { Expedition, Gain } from "./explore";

/**
 * 탐험의 끝 (명세서 「던전」 → 끝). 무엇을 가져가고 무엇을 잃는가.
 * - 귀환·보스 클리어·자동 귀환: 전부 가져간다.
 * - 전멸: 낱개 물건은 값어치가 높은 순으로 줄 세워 2·4·6…번째를 잃는다(가장 비싼 건 남음).
 *   묶음 물건과 잎전은 수량의 절반(내림)을 잃는다. 열쇠·폭약은 끝나면 늘 사라진다.
 */

export interface Settlement {
  kept: Gain[];
  lost: Gain[];
}

/** 보상 곡선: 그날 그 분야 n번째(1부터)의 배율. 곡선 끝 값이 이후에도 이어진다 */
export function fatigueMultiplier(index: number, limits: Limits): number {
  const curve = limits.dungeon.fatigueCurve;
  return curve[Math.min(Math.max(index, 1), curve.length) - 1]!;
}

/** 시작부터 자동 귀환 시간이 지났는가 */
export function autoReturnDue(state: Pick<Expedition, "startedAt" | "status">, now: number, limits: Limits): boolean {
  return state.status === "탐험" && now - state.startedAt >= limits.dungeon.autoReturnHours * 60 * 60 * 1000;
}

export function wipeLoss(gains: readonly Gain[], items: ReadonlyMap<string, Item>): Settlement {
  const kept: Gain[] = [];
  const lost: Gain[] = [];
  const singles = gains
    .filter((g): g is Extract<Gain, { kind: "낱개" }> => g.kind === "낱개")
    .map((g, order) => ({ g, order, value: items.get(g.item)?.value ?? 0 }))
    // 값어치가 같으면 주운 순서대로 (무작위 없음)
    .sort((a, b) => b.value - a.value || a.order - b.order);
  singles.forEach(({ g }, i) => (i % 2 === 1 ? lost : kept).push(g));
  for (const g of gains) {
    if (g.kind === "낱개") continue;
    const lose = Math.floor(g.quantity / 2);
    if (g.quantity - lose > 0) kept.push({ ...g, quantity: g.quantity - lose });
    if (lose > 0) lost.push({ ...g, quantity: lose });
  }
  return { kept, lost };
}

/** 끝난 탐험의 정산 */
export function settle(state: Pick<Expedition, "status" | "gains">, items: ReadonlyMap<string, Item>): Settlement {
  if (state.status === "전멸") return wipeLoss(state.gains, items);
  return { kept: state.gains.map((g) => ({ ...g })), lost: [] };
}

/** 첫 클리어 보상을 얻은 것의 모양으로 (피로 곡선 없음) */
export function firstClearGains(dungeon: Dungeon, items: ReadonlyMap<string, Item>): Gain[] {
  return dungeon.firstClear.flatMap((reward): Gain[] => {
    if (reward.kind === "잎전") return [{ kind: "잎전", quantity: reward.quantity }];
    if (items.get(reward.item)?.kind === "낱개") return Array.from({ length: reward.quantity }, () => ({ kind: "낱개" as const, item: reward.item }));
    return [{ kind: "묶음", item: reward.item, quantity: reward.quantity }];
  });
}
