import { describe, expect, it } from "vitest";
import { autoReturnDue, fatigueMultiplier, firstClearGains, settle, wipeLoss } from "../src/rules/dungeon/end";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const items = new Map([
  ["a", { id: "a", name: "가", kind: "낱개" as const, weight: 1, value: 100 }],
  ["b", { id: "b", name: "나", kind: "낱개" as const, weight: 1, value: 50 }],
  ["c", { id: "c", name: "다", kind: "낱개" as const, weight: 1, value: 80 }],
  ["d", { id: "d", name: "라", kind: "낱개" as const, weight: 1 }],
  ["s", { id: "s", name: "묶", kind: "묶음" as const, weight: 1, value: 5 }],
]);

describe("탐험의 끝", () => {
  it("보상 곡선: 1~2번째 100%, 3번째 70%, 4번째 50%, 그 뒤 30%", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => fatigueMultiplier(n, defs.limits))).toEqual([1, 1, 0.7, 0.5, 0.3, 0.3]);
  });

  it("전멸: 낱개는 값어치 순 2·4번째를 잃고(가장 비싼 건 남음), 묶음·잎전은 절반(내림)", () => {
    const result = wipeLoss(
      [
        { kind: "낱개", item: "b" },
        { kind: "낱개", item: "a" },
        { kind: "묶음", item: "s", quantity: 5 },
        { kind: "낱개", item: "d" },
        { kind: "낱개", item: "c" },
        { kind: "잎전", quantity: 31 },
        { kind: "묶음", item: "s2", quantity: 1 },
      ],
      items,
    );
    // 값어치 순: a(100) c(80) b(50) d(0) → c, d를 잃는다
    expect(result.kept).toEqual([
      { kind: "낱개", item: "a" },
      { kind: "낱개", item: "b" },
      { kind: "묶음", item: "s", quantity: 3 },
      { kind: "잎전", quantity: 16 },
      { kind: "묶음", item: "s2", quantity: 1 },
    ]);
    expect(result.lost).toEqual([
      { kind: "낱개", item: "c" },
      { kind: "낱개", item: "d" },
      { kind: "묶음", item: "s", quantity: 2 },
      { kind: "잎전", quantity: 15 },
    ]);
  });

  it("귀환·보스는 전부 가져간다", () => {
    const gains = [{ kind: "잎전" as const, quantity: 7 }];
    expect(settle({ status: "귀환", gains }, items)).toEqual({ kept: gains, lost: [] });
    expect(settle({ status: "보스", gains }, items)).toEqual({ kept: gains, lost: [] });
  });

  it("자동 귀환: 시작부터 정한 시간이 지나면", () => {
    const hours = defs.limits.dungeon.autoReturnHours * 3_600_000;
    expect(autoReturnDue({ startedAt: 0, status: "탐험" }, hours - 1, defs.limits)).toBe(false);
    expect(autoReturnDue({ startedAt: 0, status: "탐험" }, hours, defs.limits)).toBe(true);
    expect(autoReturnDue({ startedAt: 0, status: "귀환" }, hours, defs.limits)).toBe(false);
  });

  it("첫 클리어 보상", () => {
    const forest = defs.dungeons.find((d) => d.id === "border-forest")!;
    expect(firstClearGains(forest, defs.itemMap)).toEqual([
      { kind: "잎전", quantity: 200 },
      { kind: "낱개", item: "wolf-king-fang" },
    ]);
  });
});
