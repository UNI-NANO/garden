import { describe, expect, it } from "vitest";
import { seasonOf } from "../src/rules/calendar";
import {
  bobberAt,
  castPower,
  castZone,
  catchQuality,
  curveSteps,
  planCast,
  startFight,
  stepFight,
  strike,
  surgeAt,
  type Cast,
  type Fight,
} from "../src/rules/fishing";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const { rules } = defs.fishing;
const spot = defs.fishing.spots[0]!;

/** 씨름을 끝까지: policy가 이번 걸음에 감을지 정한다 */
function fight(cast: Cast, policy: (f: Fight) => boolean): Fight {
  let f = startFight(cast);
  for (let i = 0; i < 2000 && !f.outcome; i++)
    f = stepFight(f, cast, policy(f), 50, rules);
  return f;
}

/** 슬기로운 낚시꾼: 차고 나가거나 예고가 보이거나 줄이 팽팽하면 풀고, 아니면 감는다 */
const wise = (cast: Cast) => (f: Fight) =>
  surgeAt(cast, f.t, rules) === "없음" && f.tension < 0.7;

describe("낚시", () => {
  it("계절: 총람 달 표대로", () => {
    expect([0, 2, 3, 6, 7, 9, 10, 11].map(seasonOf)).toEqual([
      "봄",
      "봄",
      "여름",
      "여름",
      "가을",
      "가을",
      "겨울",
      "겨울",
    ]);
  });

  it("던지기: 누르는 시간이 힘 막대를 오가고, 힘이 구역을 정한다", () => {
    expect(castPower(0, rules)).toBe(0);
    expect(castPower(rules.castCycleMs / 2, rules)).toBe(1);
    expect(castPower(rules.castCycleMs, rules)).toBe(0);
    expect([0.1, 0.5, 0.9].map((p) => castZone(p, rules))).toEqual([
      "얕은 곳",
      "갈대 사이",
      "깊은 곳",
    ]);
  });

  it("같은 씨앗·힘·계절이면 같은 고기와 일정, 계절에 맞는 고기만", () => {
    expect(planCast("s1", 0.9, spot, "가을", rules)).toEqual(
      planCast("s1", 0.9, spot, "가을", rules),
    );
    const caught = new Set<string>();
    for (let s = 0; s < 500; s++) {
      const cast = planCast(`s${s}`, 0.9, spot, "봄", rules);
      caught.add(cast.fish.item);
      expect(cast.fish.seasons).toContain("봄");
      expect(cast.size).toBeGreaterThanOrEqual(cast.fish.size.min);
      expect(cast.size).toBeLessThanOrEqual(cast.fish.size.max);
      expect(cast.nibbles.every((n) => n < cast.biteAt)).toBe(true);
    }
    // 안개송어는 가을에만
    expect(caught.has("mist-trout")).toBe(false);
    const autumn = new Set(
      Array.from(
        { length: 500 },
        (_, s) => planCast(`s${s}`, 0.9, spot, "가을", rules).fish.item,
      ),
    );
    expect(autumn.has("mist-trout")).toBe(true);
  });

  it("채기: 톡톡에 채면 달아나고, 잠긴 뒤 틈 안이면 걸리고, 늦으면 놓친다", () => {
    const cast = [...Array(200).keys()]
      .map((s) => planCast(`n${s}`, 0.5, spot, "여름", rules))
      .find((c) => c.nibbles.length > 0)!;
    const nibble = cast.nibbles[0]!;
    expect(bobberAt(cast, nibble + 10, rules)).toBe("톡톡");
    expect(strike(cast, nibble + 10, rules)).toEqual({
      kind: "놓침",
      reason: "너무 일찍",
    });
    expect(bobberAt(cast, cast.biteAt, rules)).toBe("잠김");
    expect(strike(cast, cast.biteAt, rules)).toEqual({
      kind: "걸림",
      accuracy: 1,
    });
    expect(strike(cast, cast.biteAt + rules.biteWindowMs / 2, rules)).toEqual({
      kind: "걸림",
      accuracy: 0.5,
    });
    expect(strike(cast, cast.biteAt + rules.biteWindowMs + 1, rules)).toEqual({
      kind: "놓침",
      reason: "너무 늦게",
    });
    expect(strike(cast, undefined, rules)).toEqual({
      kind: "놓침",
      reason: "너무 늦게",
    });
    expect(bobberAt(cast, cast.biteAt + rules.biteWindowMs, rules)).toBe(
      "떠남",
    );
  });

  it("씨름: 순한 고기는 계속 감아도 낚인다", () => {
    for (let s = 0; s < 100; s++) {
      const cast = planCast(`c${s}`, 0.1, spot, "겨울", rules);
      expect(cast.fish.item).toBe("reed-minnow");
      expect(fight(cast, () => true).outcome).toBe("낚음");
    }
  });

  it("씨름: 깊은 곳 고기는 계속 감으면 줄이 끊어지고, 차고 나갈 때 풀어 주면 낚인다", () => {
    let broke = 0;
    for (let s = 0; s < 200; s++) {
      const cast = planCast(`d${s}`, 0.95, spot, "가을", rules);
      if (fight(cast, () => true).outcome === "끊어짐") broke++;
      expect(fight(cast, wise(cast)).outcome).toBe("낚음");
    }
    expect(broke).toBeGreaterThan(190);
  });

  it("씨름: 계속 풀기만 하면 빠져나간다", () => {
    const cast = planCast("r1", 0.9, spot, "여름", rules);
    expect(fight(cast, () => false).outcome).toBe("빠져나감");
  });

  it("품질: 정확하게 채고 줄을 아낄수록 좋고, 피로 곡선 단계만큼 내려간다", () => {
    expect(catchQuality(1, 0.1, 0, rules)).toBe("최상");
    expect(catchQuality(0.5, 0.5, 0, rules)).toBe("중");
    expect(catchQuality(0, 0.95, 0, rules)).toBe("하");
    expect(catchQuality(1, 0.1, 2, rules)).toBe("중");
    expect(catchQuality(1, 0.1, 9, rules)).toBe("하");
    const curve = defs.limits.dungeon.fatigueCurve;
    expect([1, 0.7, 0.5, 0.3].map((m) => curveSteps(m, curve))).toEqual([
      0, 1, 2, 3,
    ]);
  });
});
