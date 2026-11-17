import { describe, expect, it } from "vitest";
import { barPosition, barZones, judgeAt, sweepTime } from "../src/rules/battle/judge";
import { judgementWidths } from "../src/rules/battle/numbers";
import { rules } from "./helpers/fake-battle";

const L = 100;

describe("판정 바", () => {
  it("커서는 왼쪽 끝에서 오른쪽 끝으로 한 번 지나가고, 끝에 머문다", () => {
    expect([0, 300, 600, 1200, 5000].map((t) => barPosition(t, 1200, L))).toEqual([0, 25, 50, 100, 100]);
    expect(barPosition(-5, 1200, L)).toBe(0);
    expect(barPosition(10, 0, L)).toBe(L);
  });
  it("지나가는 시간은 기준값 ÷ 판정 바 속도", () => {
    expect(sweepTime(rules.judgementBar.sweepMs, 1)).toBe(1200);
    expect(sweepTime(1200, 1.5)).toBe(800);
  });
  it("좋음 칸은 가운데, 완벽은 그 가운데, 보통은 양옆", () => {
    const widths = { good: 20, perfect: 5, normalEachSide: 12 };
    expect(barZones(widths, L)).toEqual({ perfect: [47.5, 52.5], good: [40, 60], normal: [28, 72] });
    const at = (p: number | undefined) => judgeAt(widths, L, p);
    expect([50, 47.5, 47.4, 40, 39.9, 28, 27.9, 72, 72.1].map(at)).toEqual(["완벽", "완벽", "좋음", "좋음", "보통", "보통", "빗나감", "보통", "빗나감"]);
    // 끝까지 누르지 않음
    expect([at(undefined), at(L)]).toEqual(["빗나감", "빗나감"]);
  });
  it("완벽 칸이 없으면(침식) 가운데도 좋음, 좋음 칸이 바 전체면 어디든 좋음 이상", () => {
    expect(judgeAt({ good: 20, perfect: 0, normalEachSide: 12 }, L, 50)).toBe("좋음");
    const full = judgementWidths(rules, 30, { goodWidth: Number.POSITIVE_INFINITY, shake: 0, noPerfect: false });
    expect(full.good).toBe(L);
    expect([0, 10, 99.9].map((p) => judgeAt(full, L, p)).every((j) => j === "좋음" || j === "완벽")).toBe(true);
  });
});
