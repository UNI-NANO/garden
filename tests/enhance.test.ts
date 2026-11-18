import { describe, expect, it } from "vitest";
import {
  canDrop,
  enhancedName,
  enhanceRoll,
  nextStep,
  successChance,
  totalPower,
} from "../src/rules/enhance";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const table = defs.enhance;

describe("강화", () => {
  it("강화표: +1~+10 성공 확률은 사용자 표 그대로, +10에서 멈춘다", () => {
    expect(table.steps.map((s) => s.chance)).toEqual([
      100, 85, 70, 55, 40, 25, 15, 8, 4, 2,
    ]);
    expect(table.steps.map((s) => s.power)).toEqual([
      3, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    ]);
    expect(() => nextStep(10, table)).toThrow("이미 +10");
  });

  it("연속 실패 보정 +1%씩, 100을 넘지 않는다. 내려감은 +7을 노릴 때부터", () => {
    expect(successChance(9, 0, table)).toBe(2);
    expect(successChance(9, 5, table)).toBe(7);
    expect(successChance(1, 50, table)).toBe(100);
    expect([5, 6, 9].map((c) => canDrop(c, table))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("같은 씨앗이면 같은 결과. +1은 늘 성공", () => {
    expect(enhanceRoll("r1", 6, 0, false, table)).toEqual(
      enhanceRoll("r1", 6, 0, false, table),
    );
    for (let s = 0; s < 50; s++)
      expect(enhanceRoll(`a${s}`, 0, 0, false, table)).toMatchObject({
        success: true,
        level: 1,
        failStreak: 0,
        money: table.steps[0]!.money,
      });
  });

  it("많이 굴리면 성공 비율이 표와 맞고, 실패는 돈 절반·연속 실패 +1. +7부터 약 30%는 내려간다", () => {
    const n = 4000;
    for (const current of [2, 4, 6]) {
      let ok = 0;
      let dropped = 0;
      for (let s = 0; s < n; s++) {
        const r = enhanceRoll(`p${current}-${s}`, current, 0, false, table);
        if (r.success) ok++;
        else {
          expect(r.money).toBe(Math.floor(table.steps[current]!.money / 2));
          expect(r.failStreak).toBe(1);
          if (r.dropped) {
            dropped++;
            expect(r.level).toBe(current - 1);
          } else expect(r.level).toBe(current);
        }
      }
      expect(ok / n).toBeCloseTo(table.steps[current]!.chance / 100, 1);
      if (current < 6) expect(dropped).toBe(0);
      else expect(dropped / (n - ok)).toBeCloseTo(0.3, 1);
    }
  });

  it("부적은 내려갈 때만 하나 써서 막는다", () => {
    let blocked = 0;
    for (let s = 0; s < 500; s++) {
      const plain = enhanceRoll(`c${s}`, 7, 0, false, table);
      const charmed = enhanceRoll(`c${s}`, 7, 0, true, table);
      if (plain.dropped) {
        blocked++;
        expect(charmed).toMatchObject({
          dropped: false,
          charmUsed: true,
          level: 7,
        });
      } else expect(charmed.charmUsed).toBe(false);
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it("오른 힘의 합과 이름", () => {
    expect(totalPower(5, table)).toBe(15);
    expect(totalPower(10, table)).toBe(36);
    expect(enhancedName("기사의 장검", 0, table)).toBe("기사의 장검");
    expect(enhancedName("기사의 장검", 7, table)).toBe("기사의 장검 +7");
    expect(enhancedName("기사의 장검", 10, table)).toBe(
      "명장의 기사의 장검 +10",
    );
  });
});
