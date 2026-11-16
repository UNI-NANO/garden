import { describe, expect, it } from "vitest";
import { reachable, rowOf, targetsInRange } from "../src/rules/battle/formation";
import { damageOf, enemyNumbers, hitPower, judgementWidths, masteryMultiplier, playerMaxHp, staggerDamageOf } from "../src/rules/battle/numbers";
import { enemyDef, rules, skill, table } from "./helpers/fake-battle";

describe("전투 숫자", () => {
  it("플레이어 최대 체력 = 30 + 건강 × 0.5", () => {
    expect([0, 50, 75, 100].map((h) => playerMaxHp(rules, h))).toEqual([30, 55, 67, 80]);
  });
  it("숙련도 100에서 위력 +30%", () => {
    expect(masteryMultiplier(rules, 0)).toBe(1);
    expect(masteryMultiplier(rules, 30)).toBeCloseTo(1.09, 10);
    expect(masteryMultiplier(rules, 100)).toBeCloseTo(1.3, 10);
  });
  it("판정 칸: 좋음 폭 = 16 + 숙련도 × 0.12, 완벽은 그 25%, 보통은 양옆 60%", () => {
    expect(judgementWidths(rules, 0)).toEqual({ good: 16, perfect: 4, normalEachSide: 9.6, shake: 0 });
    // 효과: 집중 2중첩(+4), 공포 3중첩, 침식
    expect(judgementWidths(rules, 0, { goodWidth: 4, shake: 3, noPerfect: true })).toEqual({ good: 20, perfect: 0, normalEachSide: 12, shake: 3 });
    expect(judgementWidths(rules, 0, { goodWidth: -99, shake: 0, noPerfect: false }).good).toBe(0);
    const w = judgementWidths(rules, 100);
    expect(w.good).toBeCloseTo(28, 10);
    expect(w.perfect).toBeCloseTo(7, 10);
    expect(w.good + w.normalEachSide * 2).toBeLessThanOrEqual(rules.judgementBar.length);
  });
  it("적의 숫자는 등급 공식으로, 정예·보스는 더 세다", () => {
    expect(enemyNumbers(rules, enemyDef("wolf"))).toEqual({ maxHp: 28, maxStagger: 13, power: 7 });
    expect(enemyNumbers(rules, enemyDef("deserter.shield"))).toEqual({ maxHp: 40, maxStagger: 18, power: 10 });
    expect(enemyNumbers(rules, enemyDef("wolf", { rank: "보스" }))).toEqual({ maxHp: 50, maxStagger: 23, power: 11 });
    expect(enemyNumbers(rules, enemyDef("wolf", { overrides: { hp: 99, power: 3 } }))).toEqual({ maxHp: 99, maxStagger: 45, power: 3 });
  });
  it("한 타의 위력 = 타 위력 × 판정 배율 × 숙련도", () => {
    const cut = skill("sword.cut");
    expect(hitPower(table, cut.baseHitPower, "빗나감")).toBe(0);
    expect(hitPower(table, cut.baseHitPower, "보통")).toBeCloseTo(4.2, 10);
    expect(hitPower(table, cut.baseHitPower, "좋음")).toBe(6);
    expect(hitPower(table, cut.baseHitPower, "완벽")).toBeCloseTo(7.8, 10);
    expect(hitPower(table, cut.baseHitPower, "좋음", masteryMultiplier(rules, 30))).toBeCloseTo(6.54, 10);
  });
  it("피해 = 위력 × 저항 − 방어, 반올림. 빗나가면 0, 맞으면 최소 1", () => {
    expect(damageOf(6.54, 1.5, 0)).toBe(10);
    expect(damageOf(13.5, 1, 0)).toBe(14);
    expect(damageOf(6.48, 1, 0)).toBe(6);
    expect(damageOf(6.54, 0.5, 2)).toBe(1);
    expect(damageOf(2, 0.5, 9)).toBe(1);
    expect(damageOf(0, 1.5, 0)).toBe(0);
    // 흐트러진 적은 1.5배
    expect(damageOf(10, 1, 2, 1.5)).toBe(12);
  });
  it("흐트러짐 피해 = 위력 × 타입 계수", () => {
    expect(staggerDamageOf(rules, 10, "파열")).toBe(12);
    expect(staggerDamageOf(rules, 10, "관통")).toBe(10);
    expect(staggerDamageOf(rules, 10, "자상")).toBe(8);
  });
  it("기술 숫자는 기술 기준표에서 온다", () => {
    expect(skill("sword.gale")).toMatchObject({ baseHitPower: 13.5, hitCount: 1, cooldown: 4, energy: 3, range: "휩쓸기", stance: false });
    expect(skill("sword.combo")).toMatchObject({ hitCount: 3, cooldown: 1, energy: 1 });
    expect(skill("sword.riposte")).toMatchObject({ baseHitPower: 11, stance: true });
  });
});

describe("진형과 범위", () => {
  const at = (...slots: number[]) => slots.map((slot) => ({ id: `u${slot}`, slot }));
  it("0·1·2는 앞줄, 3·4·5는 뒷줄", () => {
    expect([0, 2, 3, 5].map(rowOf)).toEqual(["앞줄", "앞줄", "뒷줄", "뒷줄"]);
  });
  it("근접은 앞줄만, 앞줄이 비면 뒷줄. 원거리는 어느 칸이든", () => {
    expect(reachable(at(4, 1, 0), "근접").map((u) => u.slot)).toEqual([0, 1]);
    expect(reachable(at(4, 5), "근접").map((u) => u.slot)).toEqual([4, 5]);
    expect(reachable(at(4, 1, 0), "원거리").map((u) => u.slot)).toEqual([0, 1, 4]);
    expect(reachable([], "근접")).toEqual([]);
  });
  it("휩쓸기는 고른 대상과 같은 줄의 양옆, 전체는 모두", () => {
    const all = at(0, 1, 2, 4);
    const pick = (slot: number) => all.find((u) => u.slot === slot)!;
    expect(targetsInRange(all, pick(1), "단일").map((u) => u.slot)).toEqual([1]);
    expect(targetsInRange(all, pick(1), "휩쓸기").map((u) => u.slot)).toEqual([1, 0, 2]);
    expect(targetsInRange(all, pick(0), "휩쓸기").map((u) => u.slot)).toEqual([0, 1]);
    // 뒷줄의 4는 앞줄 1의 옆이 아니다
    expect(targetsInRange(all, pick(4), "휩쓸기").map((u) => u.slot)).toEqual([4]);
    expect(targetsInRange(all, pick(2), "전체").map((u) => u.slot)).toEqual([2, 0, 1, 4]);
  });
});
